(function () {
  'use strict';

  var D = window.HABIT_DATA;

  // approved topics from visitor requests (js/data-extra.js)
  (function mergeExtra() {
    var extra = window.HABIT_EXTRA;
    if (!Array.isArray(extra)) return;
    var ids = {};
    D.domains.forEach(function (d) { ids[d.id] = 1; });
    extra.forEach(function (d) {
      var ok = d && typeof d.id === 'string' && !ids[d.id] && typeof d.name === 'string' &&
        Array.isArray(d.keywords) && d.keywords.length && typeof d.identity === 'string' && typeof d.avoid === 'string' &&
        Array.isArray(d.traits) && d.traits.length >= 2 && d.traits.every(function (t) {
          return t && t.name && t.how && t.starter && t.starter.cue && t.starter.text && Array.isArray(t.habits) && t.habits.length && t.stretch;
        });
      if (ok) { D.domains.push(d); ids[d.id] = 1; }
    });
  })();
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

  // Hebrew-aware keyword match: whole words, optional one- or two-letter prefixes
  // (ו ה ב ל מ ש כ) and short suffixes, so "ים" never matches inside "ימים".
  var PREFIX = 'והבלמשכ';
  function tokenVariants(tok) {
    var v = [tok];
    if (tok.length > 3 && PREFIX.indexOf(tok[0]) !== -1) {
      v.push(tok.slice(1));
      if (tok.length > 4 && PREFIX.indexOf(tok[1]) !== -1) v.push(tok.slice(2));
    }
    return v;
  }
  function hasKeyword(text, tokens, kw) {
    kw = clean(kw);
    if (kw.indexOf(' ') !== -1) return text.indexOf(kw) !== -1;
    for (var i = 0; i < tokens.length; i++) {
      var vs = tokenVariants(tokens[i]);
      for (var j = 0; j < vs.length; j++) {
        var w = vs[j];
        if (w === kw) return true;
        if (kw.length >= 3 && w.indexOf(kw) === 0 && w.length - kw.length <= 3) return true;
      }
    }
    return false;
  }

  function matchDomains(goal) {
    var text = clean(goal);
    var tokens = text.split(/[^\u05d0-\u05eaa-z0-9]+/).filter(Boolean);
    return D.domains
      .map(function (d, i) {
        var score = 0;
        d.keywords.forEach(function (k) { if (hasKeyword(text, tokens, k)) score++; });
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
    if (typeof t.habits[0] === 'object') t = Object.assign({}, t, { habits: t.habits.map(function (h) { return h.text; }) });
    var n = minutes >= 60 ? 3 : minutes >= 30 ? 2 : 1;
    t.habits.slice(0, n).forEach(function (h) { list.push({ text: h }); });
    if (minutes >= 60 && t.stretch) list.push({ text: t.stretch, lvl: 'העמקה' });
    return list;
  }

  function stackLine(t) { return 'אחרי ש' + t.starter.cue + ', ' + t.starter.text + '.'; }

  function generate(goal) {
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
      source: 'lib',
      traits: traits.map(function (t) {
        return { name: t.name, how: t.how, starter: t.starter, habits: t.habits.slice(), stretch: t.stretch };
      }),
      avoid: top[0].avoid,
      first_step: 'היום: ' + stackLine(traits[0])
    };
  }

  function txt(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
  function normalizeAI(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.traits)) return null;
    var traits = [];
    d.traits.slice(0, 6).forEach(function (t) {
      if (!t || !t.starter) return;
      var name = txt(t.name, 24), how = txt(t.how, 220);
      var cue = txt(t.starter.cue, 90).replace(/^אחרי\s*ש/, ''), st = txt(t.starter.text, 90).replace(/[.。]$/, '');
      var habits = Array.isArray(t.habits) ? t.habits.map(function (h) { return txt(h, 120); }).filter(Boolean).slice(0, 3) : [];
      if (name && how && cue && st && habits.length) traits.push({ name: name, how: how, starter: { cue: cue, text: st }, habits: habits, stretch: txt(t.stretch, 120) });
    });
    if (traits.length < 3) return null;
    return {
      source: 'ai',
      fallback: false,
      domains: Array.isArray(d.domains) ? d.domains.map(function (x) { return txt(x, 20); }).filter(Boolean).slice(0, 3) : [],
      identity: txt(d.identity, 220) || 'אני אדם שבוחר בעצמו כל יום.',
      traits: traits,
      avoid: txt(d.avoid, 240),
      first_step: txt(d.first_step, 240) || 'היום: ' + stackLine(traits[0])
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
    var TD = window.HabitTodoist;
    if (TD && TD.available() && TD.connected()) {
      TD.add([text]).then(function (r) { if (r.added) toast('נוסף גם ל־Todoist'); }, function (e) { toast(e.message); });
    }
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
      var g = sv('g', { 'class': 'bubble pop', tabindex: '0', role: 'button', 'aria-label': t.name, 'data-i': i });
      g.style.animationDelay = (i * 50) + 'ms';
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

  var currentPlan = null, isExample = true;
  function render(plan, example) {
    currentPlan = plan; isExample = example;
    var m = minutes();
    var data = Object.assign({}, plan, {
      traits: plan.traits.map(function (t) { return Object.assign({}, t, { habits: habitsFor(t, m) }); })
    });
    current = data;
    var src = $('source');
    src.hidden = example;
    src.textContent = plan.source === 'ai' ? 'נוצר עם Claude' : 'מהספרייה המקומית';
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
      // two-step delete inside the page (no browser confirm dialog)
      del.addEventListener('click', function () {
        if (!Object.keys(h.done).length || del.classList.contains('armed')) { removeHabit(h.id); return; }
        del.classList.add('armed');
        del.textContent = 'למחוק?';
        del.setAttribute('aria-label', 'לחץ שוב כדי למחוק את ' + h.text + ' ואת כל הסימונים שלו');
        setTimeout(function () {
          if (!del.isConnected) return;
          del.classList.remove('armed'); del.textContent = '×'; del.setAttribute('aria-label', 'מחק: ' + h.text);
        }, 3000);
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

  /* ---------- Todoist ---------- */
  (function () {
    var TD = window.HabitTodoist;
    if (!TD || !TD.available()) return;
    $('todoistBox').hidden = false;
    function paint() {
      var on = TD.connected();
      $('tdConnect').hidden = on;
      $('tdSync').hidden = !on;
      $('tdDisconnect').hidden = !on;
      $('tdTitle').textContent = on ? 'Todoist מחובר' : "ההרגלים שלך בווידג'ט של Todoist";
      $('tdSub').textContent = on
        ? 'כל הרגל חדש שתוסיף כאן נכנס אוטומטית לפרויקט "הרגלים" כמשימה יומית. בווידג\'ט של Todoist בחר את הפרויקט "הרגלים".'
        : 'מחברים פעם אחת, וכל הרגל שמוסיפים כאן נכנס לפרויקט "הרגלים" כמשימה יומית. אפשר לסמן אותו ישר מהמסך הבית.';
    }
    TD.onChange(paint);
    paint();
    var ev = TD.lastEvent();
    if (ev === 'connected') {
      toast('Todoist מחובר');
      if (T.habits.length) TD.add(T.habits.map(function (h) { return h.text; })).then(function (r) {
        toast('נשלחו ' + r.added + ' הרגלים ל־Todoist');
      }, function (e) { toast(e.message); });
    } else if (ev === 'denied') toast('החיבור ל־Todoist בוטל');
    else if (ev === 'error') toast('החיבור ל־Todoist נכשל. נסה שוב.');
    else TD.check().then(paint);
    $('tdConnect').addEventListener('click', function () { TD.connect(); });
    $('tdSync').addEventListener('click', function () {
      if (!T.habits.length) { toast('אין עדיין הרגלים במעקב'); return; }
      $('tdSync').disabled = true;
      TD.add(T.habits.map(function (h) { return h.text; })).then(function (r) {
        toast(r.added ? 'נשלחו ' + r.added + ' הרגלים ל־Todoist' : 'כל ההרגלים כבר נמצאים ב־Todoist');
      }, function (e) { toast(e.message); }).then(function () { $('tdSync').disabled = false; paint(); });
    });
    $('tdDisconnect').addEventListener('click', function () {
      if (!$('tdDisconnect').classList.contains('armed')) {
        $('tdDisconnect').classList.add('armed'); $('tdDisconnect').textContent = 'לנתק? לחץ שוב';
        setTimeout(function () { $('tdDisconnect').classList.remove('armed'); $('tdDisconnect').textContent = 'נתק'; }, 3000);
        return;
      }
      $('tdDisconnect').classList.remove('armed'); $('tdDisconnect').textContent = 'נתק';
      TD.disconnect().then(function () { toast('Todoist נותק. המשימות שכבר נוספו נשארות אצלך.'); });
    });
  })();

  /* ---------- laws ---------- */
  D.laws.forEach(function (l) {
    var li = document.createElement('li');
    var n0 = document.createElement('span'); n0.className = 'n';
    var d0 = document.createElement('div');
    d0.appendChild(document.createElement('h3')); d0.appendChild(document.createElement('p'));
    li.appendChild(n0); li.appendChild(d0);
    li.querySelector('.n').textContent = l.n;
    li.querySelector('h3').textContent = l.title;
    li.querySelector('p').textContent = l.tip;
    $('lawGrid').appendChild(li);
  });

  /* ---------- form ---------- */
  function minutes() { var c = document.querySelector('input[name="time"]:checked'); return c ? +c.value : 30; }
  function setMinutes(m) { var c = document.querySelector('input[name="time"][value="' + m + '"]'); if (c) c.checked = true; }

  function status(msg, isErr) { var s = $('status'); s.textContent = msg || ''; s.className = isErr ? 'err' : ''; }

  var CACHE_KEY = 'ah-cache';
  function cacheGet(goal) { var c = load(CACHE_KEY, {}); return c[goal] || null; }
  function cachePut(goal, plan) {
    var c = load(CACHE_KEY, {}), keys = Object.keys(c);
    c[goal] = plan;
    keys = Object.keys(c);
    while (keys.length > 10) { delete c[keys.shift()]; }
    save(CACHE_KEY, c);
  }

  /* ---------- topic requests ---------- */
  var SENT_KEY = 'ah-suggested';
  function offerSuggest(goal) {
    var box = $('suggest');
    var ai = window.HabitAI;
    var sent = load(SENT_KEY, []);
    var canSend = !!(ai && ai.configured() && ai.suggest);
    if (!canSend || matchDomains(goal).length || sent.indexOf(goal) !== -1) { box.hidden = true; return; }
    box.hidden = false;
    $('suggestSend').disabled = false;
    $('suggestSend').hidden = false;
    $('suggestMsg').textContent = '';
    $('suggestSend').onclick = function () {
      $('suggestSend').disabled = true;
      ai.suggest(goal).then(function () {
        sent.push(goal); save(SENT_KEY, sent.slice(-50));
        $('suggestSend').hidden = true;
        $('suggestMsg').textContent = 'תודה! הבקשה נשלחה לאישור. אם הנושא יאושר, הוא יופיע באתר.';
      }, function (e) {
        $('suggestSend').disabled = false;
        $('suggestMsg').textContent = ai.errorCopy(e) || 'לא הצלחנו לשלוח. נסה שוב.';
      });
    };
  }

  function show(goal, plan, scroll) {
    render(plan, false);
    offerSuggest(goal);
    save('ah-last', { goal: goal, m: minutes() });
    try { history.replaceState(null, '', '?g=' + encodeURIComponent(goal) + '&t=' + minutes()); } catch (e) {}
    $('share').hidden = false;
    if (scroll) $('result').scrollIntoView({ block: 'start' });
  }

  function buildLocal(goal, scroll, note) {
    var plan = generate(goal);
    show(goal, plan, scroll);
    status(note || (plan.fallback ? 'לא זיהיתי תחום מוכר, אז הנה תוכנית כללית. חבר את Claude בהגדרות כדי לקבל תוכנית שמתאימה בדיוק למה שכתבת.' : ''), !!note);
  }

  var ctl = null;
  function setBusy(b) {
    $('go').disabled = b;
    $('stop').hidden = !b;
    $('result').classList.toggle('busy', b);
  }

  async function build(goal, scroll) {
    var ai = window.HabitAI;
    if (!ai || !ai.configured() || navigator.onLine === false) { buildLocal(goal, scroll); return; }
    ctl = new AbortController();
    setBusy(true);
    status('Claude בונה לך תוכנית אישית. זה לוקח בערך חצי דקה...');
    try {
      var raw = await ai.generate(goal, minutes(), ctl.signal);
      if (raw && raw.unsafe === true) {
        status(txt(raw.message, 300) || 'כדאי לדבר על זה עם מישהו קרוב או עם איש מקצוע.');
        return;
      }
      var plan = normalizeAI(raw);
      if (!plan) { status(ai.errorCopy({ code: 'invalid' }), true); return; }
      cachePut(goal, plan);
      show(goal, plan, scroll);
      status('');
    } catch (e) {
      var msg = ai.errorCopy(e);
      if (msg) buildLocal(goal, scroll, msg + ' בינתיים, הנה תוכנית מהספרייה המקומית.');
      else status('');
    } finally {
      setBusy(false);
      ctl = null;
    }
  }

  $('build').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (ctl) return;
    var goal = $('goal').value.trim();
    if (!goal) { status('כתוב קודם מה אתה רוצה לעשות או להיות.', true); $('goal').focus(); return; }
    build(goal, true);
  });
  $('stop').addEventListener('click', function () { if (ctl) ctl.abort(); });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="time"]'), function (r) {
    r.addEventListener('change', function () {
      if (!currentPlan) return;
      var keep = selected;
      render(currentPlan, isExample);
      if (keep < current.traits.length) select(keep);
      if (!isExample) {
        save('ah-last', { goal: $('goal').value.trim(), m: minutes() });
        try { history.replaceState(null, '', '?g=' + encodeURIComponent($('goal').value.trim()) + '&t=' + minutes()); } catch (e) {}
      }
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
    c.addEventListener('click', function () { $('goal').value = c.getAttribute('data-ex'); $('goal').focus(); });
  });

  /* ---------- AI mode ---------- */
  (function () {
    var on = !!(window.HabitAI && window.HabitAI.configured());
    $('modeLabel').textContent = on ? 'Claude מחובר: כל מטרה מקבלת תוכנית אישית' : 'מצב מקומי: ספרייה של ' + D.domains.length + ' תחומים';
    $('modeDot').classList.toggle('on', on);
  })();

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
  var startGoal = g ? g.slice(0, 600) : (last && last.goal);
  if (startGoal) {
    $('goal').value = startGoal; setMinutes(g ? (tm || 30) : last.m);
    // never spend an API call on page load: use the cached Claude plan or the local library
    var cached = cacheGet(startGoal);
    if (cached) show(startGoal, cached, false); else buildLocal(startGoal, false);
  } else {
    render(generate('בריא מסודר ללמוד חברים ריכוז'), true);
    $('suggest').hidden = true;
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
