(function () {
  'use strict';

  var D = window.HABIT_DATA;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- storage (safe) ---------- */
  var mem = {};
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return mem[key] || fallback; }
  }
  function save(key, val) {
    mem[key] = val;
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  /* ---------- dates ---------- */
  function key(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function daysAgo(n) { var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; }
  var DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  /* ---------- generator ---------- */
  function clean(s) {
    return String(s || '').replace(/[֑-ׇ]/g, '').replace(/[״"׳'`]/g, '').toLowerCase();
  }

  function matchDomains(goal) {
    var text = clean(goal);
    return D.domains
      .map(function (d, i) {
        var score = 0;
        d.keywords.forEach(function (k) { if (text.indexOf(clean(k)) !== -1) score++; });
        return { d: d, score: score, i: i };
      })
      .filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.i - b.i; })
      .map(function (x) { return x.d; });
  }

  function joinHe(parts) {
    if (parts.length < 2) return parts.join('');
    return parts.slice(0, -1).join(', ') + ' ו' + parts[parts.length - 1];
  }

  function habitsFor(t, minutes) {
    var list = [];
    var n = minutes >= 60 ? 3 : minutes >= 30 ? 2 : 1;
    t.habits.slice(0, n).forEach(function (h) { list.push({ text: h }); });
    if (minutes >= 60 && t.stretch) list.push({ text: t.stretch, lvl: 'העמקה' });
    return list;
  }

  function stackLine(t) { return 'אחרי ש' + t.starter.cue + ', ' + t.starter.text + '.'; }

  function generate(goal, minutes) {
    var matched = matchDomains(goal);
    var fallback = matched.length === 0;
    var doms = fallback ? D.domains.filter(function (d) { return ['fitness', 'study', 'focus'].indexOf(d.id) !== -1; }) : matched;

    var traits = [], seen = {};
    function push(t, dom) {
      if (traits.length >= 6 || seen[t.name]) return;
      seen[t.name] = 1;
      traits.push(Object.assign({ domain: dom ? dom.name : 'כללי' }, t));
    }
    // first trait of every domain, then second traits
    doms.forEach(function (d) { push(d.traits[0], d); });
    doms.forEach(function (d) { if (traits.length < 5) push(d.traits[1], d); });
    D.general.forEach(function (t) { if (traits.length < 5) push(t, null); });

    var top = doms.slice(0, 3);
    return {
      fallback: fallback,
      domains: top.map(function (d) { return d.name; }),
      identity: 'אני אדם ' + joinHe(top.map(function (d) { return d.identity; })) + '.',
      traits: traits.map(function (t) {
        return { name: t.name, how: t.how, starter: t.starter, habits: habitsFor(t, minutes), domain: t.domain };
      }),
      avoid: top[0].avoid,
      first_step: 'היום: ' + stackLine(traits[0])
    };
  }

  /* ---------- tracker state ---------- */
  var T = load('ah-tracker', { habits: [] });
  if (!Array.isArray(T.habits)) T.habits = [];
  function saveT() { save('ah-tracker', T); }
  function hasHabit(text) { return T.habits.some(function (h) { return h.text === text; }); }
  function addHabit(text, trait) {
    text = String(text).trim().slice(0, 120);
    if (!text) return false;
    if (hasHabit(text)) { removeHabit(T.habits.filter(function (h) { return h.text === text; })[0].id); return false; }
    T.habits.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: text, trait: trait || '', created: key(new Date()), done: {} });
    saveT(); renderTracker(); refreshAddButtons();
    return true;
  }
  function removeHabit(id) {
    T.habits = T.habits.filter(function (h) { return h.id !== id; });
    saveT(); renderTracker(); refreshAddButtons();
  }
  function streakOf(h) {
    var n = 0, i = h.done[key(daysAgo(0))] ? 0 : 1;
    while (h.done[key(daysAgo(i))]) { n++; i++; }
    return n;
  }

  /* ---------- UI: result ---------- */
  var current = null, selected = 0;

  function sv(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function labelLines(name) {
    var w = String(name).trim().split(/\s+/);
    return w.length > 1 ? [w[0], w.slice(1).join(' ')] : [w[0]];
  }
  function traitTracked(t) {
    return T.habits.some(function (h) { return h.trait === t.name; });
  }

  function buildMap(data) {
    var svg = $('map');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var n = data.traits.length, R = 125, cx = 190, cy = 170, r = n > 5 ? 36 : 40;
    var lines = sv('g', {}), bubbles = sv('g', {});
    svg.appendChild(lines);
    var center = sv('g', { 'class': 'center' });
    center.appendChild(sv('circle', { cx: cx, cy: cy, r: 48 }));
    var ct = sv('text', { x: cx, y: cy - 8 }); ct.textContent = 'האני';
    var ct2 = sv('text', { x: cx, y: cy + 9 }); ct2.textContent = 'הרצוי';
    center.appendChild(ct); center.appendChild(ct2);
    svg.appendChild(center);
    svg.appendChild(bubbles);

    data.traits.forEach(function (t, i) {
      var a = (-90 + i * 360 / n) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
      lines.appendChild(sv('line', {
        x1: (cx + 48 * dx).toFixed(1), y1: (cy + 48 * dy).toFixed(1),
        x2: (cx + (R - r) * dx).toFixed(1), y2: (cy + (R - r) * dy).toFixed(1)
      }));
      var bx = cx + R * dx, by = cy + R * dy;
      var g = sv('g', { 'class': 'bubble pop', tabindex: '0', role: 'button', 'aria-label': t.name, 'data-i': i, style: 'animation-delay:' + (i * 50) + 'ms' });
      g.appendChild(sv('circle', { cx: bx.toFixed(1), cy: by.toFixed(1), r: r }));
      var ls = labelLines(t.name);
      ls.forEach(function (line, k) {
        var tx = sv('text', { x: bx.toFixed(1), y: (by + (ls.length === 1 ? 0 : (k === 0 ? -8.5 : 8.5))).toFixed(1) });
        tx.textContent = line;
        g.appendChild(tx);
      });
      var dot = sv('circle', { 'class': 'dot', cx: (bx + r * .7).toFixed(1), cy: (by - r * .7).toFixed(1), r: 6 });
      dot.style.display = traitTracked(t) ? '' : 'none';
      g.appendChild(dot);
      g.addEventListener('click', function () { select(i); });
      g.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(i); }
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); focusBubble((i + 1) % n); }
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); focusBubble((i - 1 + n) % n); }
      });
      bubbles.appendChild(g);
    });
  }
  function focusBubble(i) { var b = document.querySelectorAll('#map .bubble')[i]; if (b) { b.focus(); select(i); } }

  function addBtn(text, trait) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'add'; b.dataset.text = text;
    b.addEventListener('click', function () {
      var added = addHabit(text, trait);
      toast(added ? 'נוסף למעקב' : 'הוסר מהמעקב');
    });
    return b;
  }
  function refreshAddButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('.add'), function (b) {
      var on = hasHabit(b.dataset.text);
      b.classList.toggle('done', on);
      b.textContent = on ? '✓' : '+';
      b.setAttribute('aria-label', (on ? 'הסר מהמעקב: ' : 'הוסף למעקב: ') + b.dataset.text);
    });
    if (current) {
      var t = current.traits[selected], s = $('addStarter'), on = hasHabit(t.starter.text + ' (' + t.starter.cue + ')');
      s.textContent = on ? '✓ במעקב' : '+ הוסף למעקב';
      s.classList.toggle('done', on);
      var dots = document.querySelectorAll('#map .bubble .dot');
      current.traits.forEach(function (tr, k) { if (dots[k]) dots[k].style.display = traitTracked(tr) ? '' : 'none'; });
    }
  }
  function markSel() {
    var bs = document.querySelectorAll('#map .bubble');
    for (var k = 0; k < bs.length; k++) {
      bs[k].classList.toggle('sel', k === selected);
      bs[k].setAttribute('aria-pressed', k === selected ? 'true' : 'false');
    }
  }

  function select(i) {
    selected = i;
    markSel();
    var t = current.traits[i];
    $('dtitle').textContent = t.name;
    $('dhow').textContent = t.how;
    var sl = $('dstack');
    sl.textContent = '';
    var b1 = document.createElement('b'); b1.textContent = 'אחרי ש' + t.starter.cue;
    sl.appendChild(b1);
    sl.appendChild(document.createTextNode(', ' + t.starter.text + '.'));

    var ul = $('dhabits');
    ul.textContent = '';
    t.habits.forEach(function (h) {
      var li = document.createElement('li');
      var sp = document.createElement('span');
      sp.textContent = h.text;
      if (h.lvl) { var l = document.createElement('span'); l.className = 'lvl'; l.textContent = h.lvl; sp.appendChild(l); }
      li.appendChild(sp);
      li.appendChild(addBtn(h.text, t.name));
      ul.appendChild(li);
    });
    refreshAddButtons();
  }

  function render(data, example) {
    current = data;
    $('tag').textContent = example ? 'דוגמה' : 'ההרגלים שלך';
    $('domains').textContent = data.domains.length ? 'תחומים: ' + data.domains.join(' · ') : '';
    $('identity').textContent = data.identity;
    $('first').textContent = data.first_step;
    $('avoid').textContent = data.avoid;
    selected = 0;
    buildMap(data);
    select(0);
    $('copybox').hidden = true;
  }

  $('addStarter').addEventListener('click', function () {
    var t = current.traits[selected];
    var added = addHabit(t.starter.text + ' (' + t.starter.cue + ')', t.name);
    toast(added ? 'נוסף למעקב' : 'הוסר מהמעקב');
  });

  /* ---------- UI: tracker ---------- */
  function renderTracker() {
    var days = [];
    for (var i = 6; i >= 0; i--) days.push(daysAgo(i));
    var today = key(daysAgo(0));

    var head = $('trDays');
    head.textContent = '';
    var h0 = document.createElement('span'); h0.textContent = 'הרגל'; head.appendChild(h0);
    days.forEach(function (d) {
      var s = document.createElement('span');
      s.textContent = DAY_NAMES[d.getDay()];
      if (key(d) === today) s.className = 'today';
      head.appendChild(s);
    });
    var hs = document.createElement('span'); hs.textContent = 'רצף'; head.appendChild(hs);
    head.hidden = T.habits.length === 0;

    var list = $('trList');
    list.textContent = '';
    if (!T.habits.length) {
      var e = document.createElement('li');
      e.className = 'empty';
      e.textContent = 'עוד אין הרגלים במעקב. לחץ + ליד הרגל במפה למעלה.';
      list.appendChild(e);
    }
    var votes = 0;
    T.habits.forEach(function (h) {
      votes += Object.keys(h.done).length;
      var li = document.createElement('li'); li.className = 'tr-row';
      var nm = document.createElement('div'); nm.className = 'tr-name';
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'tr-del'; del.textContent = '×';
      del.setAttribute('aria-label', 'מחק: ' + h.text);
      del.addEventListener('click', function () {
        if (Object.keys(h.done).length && !confirm('למחוק את "' + h.text + '" ואת כל הסימונים שלו?')) return;
        removeHabit(h.id);
      });
      var tx = document.createElement('span'); tx.textContent = h.text;
      nm.appendChild(del); nm.appendChild(tx);
      li.appendChild(nm);
      days.forEach(function (d) {
        var k = key(d), b = document.createElement('button');
        b.type = 'button';
        b.className = 'day' + (h.done[k] ? ' on' : '') + (k === today ? ' today' : '');
        b.setAttribute('aria-pressed', h.done[k] ? 'true' : 'false');
        b.setAttribute('aria-label', h.text + ', ' + d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' }));
        b.addEventListener('click', function () {
          if (h.done[k]) delete h.done[k]; else h.done[k] = 1;
          saveT(); renderTracker();
          if (h.done[k] && k === today) toast('עוד הצבעה בשביל מי שאתה רוצה להיות ✓');
        });
        li.appendChild(b);
      });
      var st = streakOf(h), sp = document.createElement('span');
      sp.className = 'streak' + (st >= 3 ? ' hot' : '');
      sp.textContent = st ? st + (st >= 3 ? '🔥' : '') : '–';
      sp.title = 'רצף ימים';
      li.appendChild(sp);
      list.appendChild(li);
    });

    $('votes').textContent = votes;
    var nc = $('navCount');
    nc.hidden = !T.habits.length;
    nc.textContent = T.habits.length;

    // "never miss twice"
    var y = key(daysAgo(1)), y2 = key(daysAgo(2)), msg = '';
    for (var j = 0; j < T.habits.length && !msg; j++) {
      var hb = T.habits[j];
      if (hb.done[today] || hb.created >= y) continue;
      if (!hb.done[y] && !hb.done[y2] && hb.created < y2) msg = 'פספסת יומיים ברצף את "' + hb.text + '". זה לא נורא, רק תחזור היום, גם בגרסה של שתי דקות.';
      else if (!hb.done[y]) msg = 'פספסת אתמול את "' + hb.text + '". הכלל: לעולם לא מפספסים פעמיים.';
    }
    $('warn').hidden = !msg;
    $('warn').textContent = msg;
  }

  $('trAdd').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = $('newHabit').value.trim();
    if (!v) { $('newHabit').focus(); return; }
    if (hasHabit(v)) { toast('ההרגל הזה כבר במעקב'); return; }
    addHabit(v, '');
    $('newHabit').value = '';
    toast('נוסף למעקב');
  });

  /* ---------- laws ---------- */
  D.laws.forEach(function (l) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="n"></span><div><h3></h3><p></p></div>';
    li.querySelector('.n').textContent = l.n;
    li.querySelector('h3').textContent = l.title;
    li.querySelector('p').textContent = l.tip;
    $('lawGrid').appendChild(li);
  });

  /* ---------- form ---------- */
  function minutes() { var c = document.querySelector('input[name="time"]:checked'); return c ? +c.value : 30; }
  function setMinutes(m) { var c = document.querySelector('input[name="time"][value="' + m + '"]'); if (c) c.checked = true; }

  function status(msg, isErr) { var s = $('status'); s.textContent = msg || ''; s.className = isErr ? 'err' : ''; }

  function build(goal, m, scroll) {
    var data = generate(goal, m);
    render(data, false);
    status(data.fallback ? 'לא זיהיתי תחום מוכר, אז הנה תוכנית כללית. נסה להוסיף מילים כמו כושר, לימודים, שינה, כסף או חברים.' : '');
    save('ah-last', { goal: goal, m: m });
    var q = '?g=' + encodeURIComponent(goal) + '&t=' + m;
    try { history.replaceState(null, '', q); } catch (e) {}
    $('share').hidden = false;
    if (scroll) $('result').scrollIntoView({ block: 'start' });
  }

  $('build').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var goal = $('goal').value.trim();
    if (!goal) { status('כתוב קודם מה אתה רוצה לעשות או להיות.', true); $('goal').focus(); return; }
    build(goal, minutes(), true);
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="time"]'), function (r) {
    r.addEventListener('change', function () { var g = $('goal').value.trim(); if (g && current && $('tag').textContent !== 'דוגמה') build(g, minutes(), false); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
    c.addEventListener('click', function () { $('goal').value = c.getAttribute('data-ex'); $('goal').focus(); });
  });

  $('share').addEventListener('click', function () {
    var url = location.href;
    if (navigator.share) { navigator.share({ title: document.title, url: url }).catch(function () {}); return; }
    copyText(url, 'הקישור הועתק');
  });

  /* ---------- copy / print ---------- */
  function toText() {
    var d = current, out = ['מי אני רוצה להיות', '', d.identity, ''];
    d.traits.forEach(function (t) {
      out.push(t.name + ' — ' + t.how);
      out.push('• שתי דקות: ' + stackLine(t));
      t.habits.forEach(function (h) { out.push('• ' + h.text); });
      out.push('');
    });
    out.push('מה אני לא עושה: ' + d.avoid);
    out.push(d.first_step);
    return out.join('\n');
  }
  function copyText(text, okMsg) {
    var done = function () { toast(okMsg); };
    var fail = function () { var box = $('copybox'); box.value = text; box.hidden = false; box.focus(); box.select(); };
    try { navigator.clipboard.writeText(text).then(done, fail); } catch (e) { fail(); }
  }
  $('copy').addEventListener('click', function () { copyText(toText(), 'הועתק'); });
  $('print').addEventListener('click', function () { window.print(); });

  /* ---------- toast ---------- */
  var tt;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(tt); tt = setTimeout(function () { t.hidden = true; }, 1800);
  }

  /* ---------- theme ---------- */
  $('theme').addEventListener('click', function () {
    var root = document.documentElement;
    var cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('ah-theme', next); } catch (e) {}
  });

  /* ---------- init ---------- */
  renderTracker();
  var params = new URLSearchParams(location.search);
  var g = params.get('g'), tm = params.get('t'), last = load('ah-last', null);
  if (g) {
    $('goal').value = g.slice(0, 600); setMinutes(tm || 30);
    build($('goal').value, minutes(), false);
  } else if (last && last.goal) {
    $('goal').value = last.goal; setMinutes(last.m);
    build(last.goal, minutes(), false);
  } else {
    render(generate('בריא מסודר ללמוד חברים ריכוז', 30), true);
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
