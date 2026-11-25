(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var cfg = window.HABITS_CONFIG || {};
  var proxy = typeof cfg.proxyUrl === 'string' ? cfg.proxyUrl.replace(/\/+$/, '') : '';
  var TOKEN_KEY = 'ah-admin-token';
  var token = '';
  try { token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  var items = [], tab = 'pending', busy = {};

  var existingNames = (function () {
    var names = [];
    (window.HABIT_DATA ? window.HABIT_DATA.domains : []).forEach(function (d) { names.push(d.name + ' (' + d.id + ')'); });
    (Array.isArray(window.HABIT_EXTRA) ? window.HABIT_EXTRA : []).forEach(function (d) { if (d && d.name) names.push(d.name + ' (' + d.id + ')'); });
    return names;
  })();

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function status(msg) { $('status').textContent = msg || ''; }

  function api(path, body) {
    return fetch(proxy + path, {
      method: body ? 'POST' : 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { signOut(); throw new Error('הסיסמה לא נכונה.'); }
        if (r.status === 429) throw new Error('יותר מדי ניסיונות. חכה דקה ונסה שוב.');
        if (!r.ok || data.error) throw new Error(errorText(data.error));
        return data;
      });
    }, function () { throw new Error('אין חיבור ל־Worker. בדוק את proxyUrl ב־config.js.'); });
  }
  function errorText(code) {
    return ({
      not_configured: 'ה־Worker לא מוגדר עד הסוף (KV, GITHUB_TOKEN או ANTHROPIC_API_KEY). ראו README.',
      bad_domain: 'הנושא לא תקין: צריך id באנגלית, שם, לפחות 3 מילות מפתח ו־2 תכונות עם 3 הרגלים כל אחת.',
      invalid: 'הטיוטה לא הגיעה במבנה הנכון. נסה לנסח שוב.',
      refused: 'Claude סירב לנסח נושא לבקשה הזאת.',
      rejected_by_model: 'Claude סימן את הבקשה כלא מתאימה (ספאם, לא מטרה אישית או מזיקה). אפשר לדחות אותה.',
      upstream: 'השירות (Claude או GitHub) החזיר שגיאה. נסה שוב.',
      not_found: 'הבקשה לא נמצאה. רענן את הרשימה.'
    })[code] || 'משהו השתבש. נסה שוב.';
  }

  /* ---------- sign in ---------- */
  function signOut() {
    token = '';
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    $('board').hidden = true; $('signIn').hidden = false; $('signOut').hidden = true;
  }
  $('signOut').addEventListener('click', signOut);
  $('signInForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!proxy) { $('signInErr').textContent = 'אין כתובת Worker ב־config.js.'; return; }
    token = $('token').value.trim();
    $('token').value = '';
    if (!token) return;
    $('signInErr').textContent = '';
    loadItems().then(function () {
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    }, function (e) { $('signInErr').textContent = e.message; });
  });

  function loadItems() {
    status('טוען...');
    return api('/admin/suggestions').then(function (data) {
      items = data.items || [];
      $('signIn').hidden = true; $('board').hidden = false; $('signOut').hidden = false;
      status('');
      render();
    });
  }

  /* ---------- tabs ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.addEventListener('click', function () {
      tab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      render();
    });
  });

  /* ---------- render ---------- */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function renderDraft(d) {
    var box = el('div', 'draft');
    var h = el('h3', null, d.name); h.appendChild(el('span', 'id', '  ' + d.id)); box.appendChild(h);
    box.appendChild(el('p', null, 'אני אדם ' + d.identity));
    var chips = el('div', 'chips');
    d.keywords.forEach(function (k) { chips.appendChild(el('span', null, k)); });
    box.appendChild(chips);
    d.traits.forEach(function (t) {
      var tr = el('div', 'trait');
      var p = el('p'); p.appendChild(el('b', null, t.name)); p.appendChild(document.createTextNode(': ' + t.how)); tr.appendChild(p);
      tr.appendChild(el('p', null, 'שתי דקות: אחרי ש' + t.starter.cue + ', ' + t.starter.text + '.'));
      var ul = el('ul'); t.habits.forEach(function (x) { ul.appendChild(el('li', null, x)); }); ul.appendChild(el('li', null, 'העמקה: ' + t.stretch));
      tr.appendChild(ul); box.appendChild(tr);
    });
    box.appendChild(el('p', 'muted', 'מה אני לא עושה: ' + d.avoid));
    return box;
  }

  function render() {
    var counts = { pending: 0, approved: 0, rejected: 0 };
    items.forEach(function (i) { counts[i.status] = (counts[i.status] || 0) + 1; });
    $('cPending').textContent = counts.pending ? '(' + counts.pending + ')' : '';
    $('cApproved').textContent = counts.approved ? '(' + counts.approved + ')' : '';
    $('cRejected').textContent = counts.rejected ? '(' + counts.rejected + ')' : '';

    var list = $('items'); list.textContent = '';
    var shown = items.filter(function (i) { return i.status === tab; });
    if (!shown.length) {
      list.appendChild(el('li', 'empty-state', tab === 'pending' ? 'אין בקשות שמחכות לאישור.' : 'אין כאן כלום עדיין.'));
      return;
    }
    shown.forEach(function (it) {
      var li = el('li', 'item');
      var head = el('div', 'item-head');
      head.appendChild(el('p', 'goal', it.goal));
      var meta = el('span', 'meta');
      var c = el('span', 'count', '×' + (it.count || 1)); c.title = 'כמה פעמים ביקשו';
      meta.appendChild(c);
      meta.appendChild(document.createTextNode(new Date(it.created).toLocaleDateString('he-IL')));
      head.appendChild(meta);
      li.appendChild(head);

      var err = el('p', 'err-inline'); err.hidden = true;

      if (it.draft) li.appendChild(renderDraft(it.draft));

      if (it.status === 'approved' && it.pr) {
        var a = el('a', null, 'Pull Request #' + it.pr.number + ' — ממתין למיזוג ב־GitHub');
        a.href = it.pr.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        li.appendChild(a);
      }

      if (it.status === 'pending') {
        var actions = el('div', 'row-actions');
        var draftBtn = el('button', 'btn small', it.draft ? 'נסח מחדש' : 'נסח נושא עם Claude');
        draftBtn.type = 'button';
        draftBtn.disabled = !!busy[it.id];
        draftBtn.addEventListener('click', function () {
          busy[it.id] = 1; draftBtn.disabled = true; draftBtn.textContent = 'Claude מנסח...'; err.hidden = true;
          api('/admin/draft', { id: it.id, existing: existingNames }).then(function (data) {
            delete busy[it.id]; replace(data.item); toast('הטיוטה מוכנה');
          }, function (e) { delete busy[it.id]; err.textContent = e.message; err.hidden = false; draftBtn.disabled = false; draftBtn.textContent = 'נסח נושא עם Claude'; });
        });
        actions.appendChild(draftBtn);

        var editor = null;
        if (it.draft) {
          var editBtn = el('button', 'btn small ghost', 'ערוך');
          editBtn.type = 'button';
          editor = el('textarea', 'json'); editor.hidden = true; editor.spellcheck = false;
          editor.setAttribute('aria-label', 'עריכת הנושא כ־JSON');
          editor.id = 'json-' + it.id;
          editor.value = JSON.stringify(it.draft, null, 2);
          editBtn.addEventListener('click', function () { editor.hidden = !editor.hidden; editBtn.textContent = editor.hidden ? 'ערוך' : 'סגור עריכה'; });
          actions.appendChild(editBtn);

          var approveBtn = el('button', 'btn small primary', 'אשר ופתח PR');
          approveBtn.type = 'button';
          approveBtn.addEventListener('click', function () {
            var domain;
            try { domain = JSON.parse(editor.value); } catch (e) { err.textContent = 'ה־JSON לא תקין: ' + e.message; err.hidden = false; return; }
            approveBtn.disabled = true; approveBtn.textContent = 'פותח PR...'; err.hidden = true;
            api('/admin/approve', { id: it.id, domain: domain }).then(function (data) {
              replace(data.item); toast('נפתח PR #' + data.item.pr.number);
            }, function (e) { err.textContent = e.message; err.hidden = false; approveBtn.disabled = false; approveBtn.textContent = 'אשר ופתח PR'; });
          });
          actions.appendChild(approveBtn);
        }

        var rejectBtn = el('button', 'btn small ghost danger', 'דחה');
        rejectBtn.type = 'button';
        rejectBtn.addEventListener('click', function () {
          if (!rejectBtn.classList.contains('armed')) { rejectBtn.classList.add('armed'); rejectBtn.textContent = 'לדחות? לחץ שוב'; setTimeout(function () { rejectBtn.classList.remove('armed'); rejectBtn.textContent = 'דחה'; }, 3000); return; }
          rejectBtn.disabled = true;
          api('/admin/reject', { id: it.id }).then(function (data) { replace(data.item); toast('נדחתה'); },
            function (e) { err.textContent = e.message; err.hidden = false; rejectBtn.disabled = false; });
        });
        actions.appendChild(rejectBtn);
        li.appendChild(actions);
        if (editor) li.appendChild(editor);
      }
      li.appendChild(err);
      list.appendChild(li);
    });
  }

  function replace(item) {
    items = items.map(function (i) { return i.id === item.id ? item : i; });
    render();
  }

  if (token && proxy) loadItems().catch(function () { signOut(); });
})();
