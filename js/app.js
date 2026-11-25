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

  /* ---------- dates & schedules ---------- */
  function key(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  var DAY_LONG = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  // 2-minute habits keep their trigger in h.cue; show them as one sentence
  function displayHabit(h) {
    return h.cue ? 'אחרי ש' + h.cue + ', ' + h.text : h.text;
  }
  function cleanSchedule(sc) {
    sc = sc || {};
    var days = Array.isArray(sc.days) ? sc.days.filter(function (d) { return d >= 0 && d <= 6; }) : [];
    days = days.filter(function (d, i) { return days.indexOf(d) === i; }).sort();
    var time = /^([01]\d|2[0-3]):[0-5]\d$/.test(sc.time || '') ? sc.time : '';
    var freq = sc.freq === 'days' && days.length && days.length < 7 ? 'days' : 'daily';
    return { freq: freq, days: freq === 'days' ? days : [], time: time };
  }
  function scheduleText(sc) {
    sc = cleanSchedule(sc);
    var t = sc.freq === 'daily' ? 'כל יום'
      : sc.days.length === 1 ? 'כל יום ' + DAY_LONG[sc.days[0]]
      : 'בימים ' + sc.days.map(function (d) { return DAY_LONG[d]; }).join(', ');
    return t + (sc.time ? ' בשעה ' + sc.time : '');
  }

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
        // a two-word keyword ("אבא טוב") is more specific than a single word, so it counts double
        d.keywords.forEach(function (k) { if (hasKeyword(text, tokens, k)) score += k.indexOf(' ') === -1 ? 1 : 2; });
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
    // 10 min: 2 habits, 30 min: 3, an hour or more: all of them (up to 5) + the stretch habit
    var n = minutes >= 60 ? 5 : minutes >= 30 ? 3 : 2;
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
    // round-robin: the first trait of every matched domain, then the second, and so on
    var target = doms.length > 2 ? 6 : 5;
    for (var r = 0; r < 3; r++) {
      doms.forEach(function (d) { if (traits.length < target && d.traits[r]) push(d.traits[r], d); });
    }
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

  /* ---------- plan state ---------- */
  // stored under the old key so earlier visitors keep their habits
  var T = load('ah-tracker', { habits: [] });
  if (!Array.isArray(T.habits)) T.habits = [];
  // older versions stored a 2-minute habit as "action (cue)"; split it only when the
  // part in parentheses is a known cue, so habits like "25 דקות לימוד (פומודורו)" stay intact
  var KNOWN_CUES = {};
  D.domains.concat([{ traits: D.general }]).forEach(function (d) { d.traits.forEach(function (t) { KNOWN_CUES[t.starter.cue] = 1; }); });
  T.habits.forEach(function (h) {
    h.schedule = cleanSchedule(h.schedule); delete h.done;
    var m = !h.cue && /^(.*) \((.+)\)$/.exec(h.text);
    if (m && KNOWN_CUES[m[2]]) { h.text = m[1]; h.cue = m[2]; }
  });
  save('ah-tracker', T);
  function saveT() { save('ah-tracker', T); }
  function hasHabit(text) { return T.habits.some(function (h) { return h.text === text; }); }
  function addHabit(text, trait, cue) {
    text = String(text).trim().slice(0, 120);
    if (!text) return false;
    if (hasHabit(text)) { removeHabit(T.habits.filter(function (h) { return h.text === text; })[0].id); return false; }
    if (T.habits.length >= 20) { toast('אפשר עד 20 הרגלים בתוכנית. כדאי להתחיל קטן.'); return false; }
    T.habits.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: text, trait: trait || '', cue: cue || '', created: key(new Date()), schedule: cleanSchedule() });
    saveT(); renderPlan(); refreshAddButtons();
    return true;
  }
  function removeHabit(id) {
    T.habits = T.habits.filter(function (h) { return h.id !== id; });
    saveT(); renderPlan(); refreshAddButtons();
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
      toast(added ? 'נוסף לתוכנית' : 'הוסר מהתוכנית');
    });
    return b;
  }
  function refreshAddButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('.add'), function (b) {
      var on = hasHabit(b.dataset.text);
      b.classList.toggle('done', on);
      b.textContent = on ? '✓' : '+';
      b.setAttribute('aria-label', (on ? 'הסר מהתוכנית: ' : 'הוסף לתוכנית: ') + b.dataset.text);
    });
    if (current) {
      var t = current.traits[selected], s = $('addStarter'), on = hasHabit(t.starter.text);
      s.textContent = on ? '✓ בתוכנית' : '+ הוסף לתוכנית';
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
    var added = addHabit(t.starter.text, t.name, t.starter.cue);
    toast(added ? 'נוסף לתוכנית' : 'הוסר מהתוכנית');
  });

  /* ---------- UI: plan ---------- */
  function renderPlan() {
    var list = $('planList');
    list.textContent = '';
    var nc = $('navCount');
    nc.hidden = !T.habits.length;
    nc.textContent = T.habits.length;
    if (!T.habits.length) {
      var e = document.createElement('li');
      e.className = 'empty';
      e.textContent = 'עוד אין הרגלים בתוכנית. לחץ + ליד הרגל במפה למעלה, או כתוב הרגל משלך.';
      list.appendChild(e);
      return;
    }
    T.habits.forEach(function (h) {
      var sc = h.schedule;
      var li = document.createElement('li'); li.className = 'plan-row';

      var top = document.createElement('div'); top.className = 'pr-top';
      var tx = document.createElement('span'); tx.className = 'pr-text'; tx.textContent = displayHabit(h);
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'tr-del'; del.textContent = '×';
      del.setAttribute('aria-label', 'הסר מהתוכנית: ' + h.text);
      del.addEventListener('click', function () { removeHabit(h.id); });
      top.appendChild(tx); top.appendChild(del);
      li.appendChild(top);

      var row = document.createElement('div'); row.className = 'pr-sched';
      var fid = 'freq-' + h.id;
      var freq = document.createElement('select');
      freq.id = fid;
      freq.setAttribute('aria-label', 'תדירות: ' + h.text);
      [['daily', 'כל יום'], ['days', 'בימים מסוימים']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1];
        if ((sc.freq === 'days' ? 'days' : 'daily') === o[0]) op.selected = true;
        freq.appendChild(op);
      });
      row.appendChild(freq);

      var days = document.createElement('div'); days.className = 'days';
      days.setAttribute('role', 'group'); days.setAttribute('aria-label', 'ימים: ' + h.text);
      var picked = sc.freq === 'days' ? sc.days.slice() : [];
      days.hidden = sc.freq !== 'days';
      DAY_SHORT.forEach(function (name, d) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'day-chip'; b.textContent = name;
        b.setAttribute('aria-label', 'יום ' + DAY_LONG[d]);
        b.setAttribute('aria-pressed', picked.indexOf(d) !== -1 ? 'true' : 'false');
        b.addEventListener('click', function () {
          var i = picked.indexOf(d);
          if (i === -1) picked.push(d); else picked.splice(i, 1);
          b.setAttribute('aria-pressed', i === -1 ? 'true' : 'false');
          update();
        });
        days.appendChild(b);
      });
      row.appendChild(days);

      var tl = document.createElement('label'); tl.className = 'pr-time';
      tl.appendChild(document.createTextNode('בשעה '));
      var time = document.createElement('input');
      time.type = 'time'; time.id = 'time-' + h.id; time.value = sc.time || '';
      time.setAttribute('aria-label', 'שעה (לא חובה): ' + h.text);
      tl.appendChild(time);
      row.appendChild(tl);
      li.appendChild(row);

      var due = document.createElement('p'); due.className = 'pr-due'; due.textContent = scheduleText(sc);
      li.appendChild(due);

      function update() {
        if (freq.value === 'days' && !picked.length && this === freq) picked = [new Date().getDay()];
        days.hidden = freq.value !== 'days';
        Array.prototype.forEach.call(days.children, function (b, d) { b.setAttribute('aria-pressed', picked.indexOf(d) !== -1 ? 'true' : 'false'); });
        h.schedule = cleanSchedule({ freq: freq.value, days: picked, time: time.value });
        due.textContent = freq.value === 'days' && !picked.length ? 'בחר לפחות יום אחד (עד אז: כל יום)' : scheduleText(h.schedule);
        saveT();
      }
      freq.addEventListener('change', update);
      time.addEventListener('change', update);
      list.appendChild(li);
    });
  }

  $('trAdd').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = $('newHabit').value.trim();
    if (!v) { $('newHabit').focus(); return; }
    if (hasHabit(v)) { toast('ההרגל הזה כבר בתוכנית'); return; }
    if (addHabit(v, '')) { $('newHabit').value = ''; toast('נוסף לתוכנית'); }
  });

  /* ---------- Todoist ---------- */
  // direct mode: no Worker yet -> one-time personal token, sent straight to Todoist
  function setupTodoistDirect() {
    var TD = window.HabitTodoist;
    if (!TD) return;
    $('todoistBox').hidden = false;
    $('tdDirect').hidden = false;
    function send(ev) {
      if (ev) ev.preventDefault();
      if (TD.available()) return; // OAuth mode took over
      if (!T.habits.length) { $('tdStatus').textContent = 'קודם הוסף הרגלים לתוכנית (שלב 2).'; location.hash = '#plan'; return; }
      var token = $('tdToken').value;
      if (!token.trim()) { $('tdStatus').textContent = 'הדבק את הטוקן של Todoist.'; $('tdToken').focus(); return; }
      $('tdSend').disabled = true;
      $('tdStatus').textContent = 'שולח...';
      TD.directAdd(token, T.habits.map(function (h) { return { text: h.text, cue: h.cue, schedule: h.schedule }; })).then(function (r) {
        $('tdToken').value = '';
        var parts = [];
        if (r.added) parts.push('נוספו ' + r.added);
        if (r.updated) parts.push('עודכנו ' + r.updated);
        $('tdStatus').textContent = (parts.length ? parts.join(', ') + '. ' : 'הכל כבר היה ב־Todoist. ') +
          'ההרגלים בפרויקט "הרגלים". בווידג\'ט של Todoist אפשר לבחור את הפרויקט הזה. הטוקן נמחק מהדף.';
        toast('נשלח ל־Todoist');
      }, function (e) { $('tdStatus').textContent = e.message; }).then(function () { $('tdSend').disabled = false; });
      token = '';
    }
    $('tdSend').addEventListener('click', send);
    $('tdDirect').addEventListener('submit', send);
  }

  function setupTodoistOAuth() {
    var TD = window.HabitTodoist;
    if (!TD || !TD.available()) return;
    $('todoistBox').hidden = false;
    $('tdDirect').hidden = true;
    var PENDING = 'ah-td-send';
    function paint() {
      var on = TD.connected();
      $('tdDisconnect').hidden = !on;
      $('tdSend').textContent = on ? 'שלח ל־Todoist' : 'חבר את Todoist ושלח';
      $('tdTitle').textContent = on ? 'Todoist מחובר' : 'המשך ב־Todoist';
    }
    function send() {
      if (!T.habits.length) { $('tdStatus').textContent = 'קודם הוסף הרגלים לתוכנית (שלב 2).'; location.hash = '#plan'; return; }
      $('tdSend').disabled = true;
      $('tdStatus').textContent = 'שולח...';
      TD.add(T.habits.map(function (h) { return { text: h.text, cue: h.cue, schedule: h.schedule }; })).then(function (r) {
        var parts = [];
        if (r.added) parts.push('נוספו ' + r.added);
        if (r.updated) parts.push('עודכנו ' + r.updated);
        $('tdStatus').textContent = (parts.length ? parts.join(', ') + '. ' : 'הכל כבר היה ב־Todoist. ') +
          'ההרגלים נמצאים בפרויקט "הרגלים". בווידג\'ט של Todoist אפשר לבחור את הפרויקט הזה.';
        toast('נשלח ל־Todoist');
      }, function (e) { $('tdStatus').textContent = e.message; }).then(function () { $('tdSend').disabled = false; paint(); });
    }
    TD.onChange(paint);
    paint();
    var ev = TD.lastEvent(), pending = false;
    try { pending = sessionStorage.getItem(PENDING) === '1'; sessionStorage.removeItem(PENDING); } catch (e) {}
    if (ev === 'connected') { toast('Todoist מחובר'); if (pending) send(); }
    else if (ev === 'denied') $('tdStatus').textContent = 'החיבור ל־Todoist בוטל.';
    else if (ev === 'error') $('tdStatus').textContent = 'החיבור ל־Todoist נכשל. נסה שוב.';
    else TD.check().then(paint);
    $('tdSend').addEventListener('click', function () {
      if (TD.connected()) { send(); return; }
      try { sessionStorage.setItem(PENDING, '1'); } catch (e) {}
      TD.connect();
    });
    $('tdDisconnect').addEventListener('click', function () {
      var b = $('tdDisconnect');
      if (!b.classList.contains('armed')) {
        b.classList.add('armed'); b.textContent = 'לנתק? לחץ שוב';
        setTimeout(function () { b.classList.remove('armed'); b.textContent = 'נתק'; }, 3000);
        return;
      }
      b.classList.remove('armed'); b.textContent = 'נתק';
      TD.disconnect().then(function () { $('tdStatus').textContent = 'Todoist נותק. המשימות שכבר נוספו נשארות אצלך.'; });
    });
  }

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
    var canSend = !!(ai && ai.suggest && window.HabitFeatures && window.HabitFeatures.get().suggest);
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
  /* ---------- ideas: 6 random thought-starters, refreshed on demand ---------- */
  var IDEAS = Array.isArray(window.HABIT_IDEAS) ? window.HABIT_IDEAS.slice() : [];
  var ideaPos = 0;
  (function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } })(IDEAS);
  function showIdeas() {
    var box = $('ideas');
    box.textContent = '';
    for (var k = 0; k < 6 && IDEAS.length; k++) {
      var idea = IDEAS[(ideaPos + k) % IDEAS.length];
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.textContent = idea.label;
      b.addEventListener('click', (function (goal) {
        return function () { $('goal').value = goal; $('goal').focus(); };
      })(idea.goal));
      box.appendChild(b);
    }
    ideaPos = (ideaPos + 6) % Math.max(IDEAS.length, 1);
  }
  showIdeas();
  $('moreIdeas').addEventListener('click', showIdeas);

  /* ---------- AI mode ---------- */
  function refreshModeLabel() {
    var on = !!(window.HabitAI && window.HabitAI.configured());
    $('modeLabel').textContent = on ? 'Claude מחובר: כל מטרה מקבלת תוכנית אישית' : 'מצב מקומי: ספרייה של ' + D.domains.length + ' תחומים';
    $('modeDot').classList.toggle('on', on);
  }
  refreshModeLabel();
  setupTodoistDirect(); // always available at once; replaced by OAuth if the server supports it
  var FEAT = window.HabitFeatures ? window.HabitFeatures.ready : Promise.resolve({});
  FEAT.then(function () {
    refreshModeLabel();
    setupTodoistOAuth();
    var g = $('goal').value.trim();
    if (g && current && !isExample) offerSuggest(g);
  });

  $('share').addEventListener('click', function () {
    var url = location.href;
    if (navigator.share) { navigator.share({ title: document.title, url: url }).catch(function () {}); return; }
    copyText(url, 'הקישור הועתק');
  });

  /* ---------- summary: text, file, PDF ---------- */
  function planLines() {
    return T.habits.map(function (h) { return displayHabit(h) + ' · ' + scheduleText(h.schedule); });
  }
  function toText() {
    var d = current, out = ['מי אני רוצה להיות', new Date().toLocaleDateString('he-IL'), '', d.identity, ''];
    if (isExample) out.splice(2, 0, '(דוגמה)');
    var goal = $('goal').value.trim();
    if (goal && !isExample) out.push('המטרה שכתבתי: ' + goal, '');
    out.push('התכונות שלי');
    d.traits.forEach(function (t) {
      out.push('• ' + t.name + ': ' + t.how);
      out.push('  שתי דקות: ' + stackLine(t));
    });
    out.push('');
    if (T.habits.length) {
      out.push('התוכנית שלי');
      planLines().forEach(function (l) { out.push('☐ ' + l); });
      out.push('');
    }
    out.push('הצעד הראשון: ' + d.first_step.replace(/^היום:\s*/, ''));
    out.push('מה אני לא עושה: ' + d.avoid);
    out.push('');
    out.push('ארבעת החוקים: ' + D.laws.map(function (l) { return l.title; }).join(' · '));
    return out.join('\n');
  }
  function copyText(text, okMsg) {
    var done = function () { toast(okMsg); };
    var fail = function () { var box = $('copybox'); box.value = text; box.hidden = false; box.focus(); box.select(); };
    try { navigator.clipboard.writeText(text).then(done, fail); } catch (e) { fail(); }
  }
  $('copy').addEventListener('click', function () { copyText(toText(), 'הועתק'); });

  $('dl').addEventListener('click', function () {
    var blob = new Blob(['\ufeff' + toText()], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-habits-plan.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function buildPrintSummary() {
    var d = current, box = $('printSummary');
    box.textContent = '';
    var head = el('header', 'ps-head');
    head.appendChild(el('p', 'ps-eyebrow', 'מי אני רוצה להיות · ' + new Date().toLocaleDateString('he-IL')));
    head.appendChild(el('h1', null, d.identity));
    var goal = $('goal').value.trim();
    if (goal && !isExample) head.appendChild(el('p', 'ps-goal', 'המטרה שכתבתי: ' + goal));
    box.appendChild(head);

    box.appendChild(el('h2', null, 'התכונות שלי'));
    var tr = el('div', 'ps-traits');
    d.traits.forEach(function (t) {
      var c = el('div', 'ps-trait');
      c.appendChild(el('h3', null, t.name));
      c.appendChild(el('p', null, t.how));
      c.appendChild(el('p', 'ps-stack', 'שתי דקות: ' + stackLine(t)));
      tr.appendChild(c);
    });
    box.appendChild(tr);

    if (T.habits.length) {
      box.appendChild(el('h2', null, 'התוכנית שלי'));
      var ul = el('ul', 'ps-plan');
      T.habits.forEach(function (h) {
        var li = el('li');
        li.appendChild(el('span', 'ps-box'));
        li.appendChild(el('span', 'ps-habit', displayHabit(h)));
        li.appendChild(el('span', 'ps-when', scheduleText(h.schedule)));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    var two = el('div', 'ps-two');
    var a = el('div'); a.appendChild(el('h2', null, 'הצעד הראשון')); a.appendChild(el('p', null, d.first_step.replace(/^היום:\s*/, '')));
    var b = el('div'); b.appendChild(el('h2', null, 'מה אני לא עושה')); b.appendChild(el('p', null, d.avoid));
    two.appendChild(a); two.appendChild(b);
    box.appendChild(two);

    var laws = el('ol', 'ps-laws');
    D.laws.forEach(function (l) { var li = el('li'); li.appendChild(el('b', null, l.title + '. ')); li.appendChild(document.createTextNode(l.tip)); laws.appendChild(li); });
    box.appendChild(el('h2', null, 'ארבעת החוקים'));
    box.appendChild(laws);
    box.appendChild(el('p', 'ps-foot', 'בהשראת Atomic Habits מאת ג\'יימס קליר'));
  }
  $('pdf').addEventListener('click', function () {
    buildPrintSummary();
    window.print();
  });
  window.addEventListener('beforeprint', buildPrintSummary);

  /* ---------- widget guide tabs (iPhone / Android) ---------- */
  (function () {
    var tabs = [[$('tabIos'), $('guideIos')], [$('tabAndroid'), $('guideAndroid')]];
    if (/Android/i.test(navigator.userAgent)) choose(1);
    tabs.forEach(function (t, i) { t[0].addEventListener('click', function () { choose(i); }); });
    function choose(i) {
      tabs.forEach(function (t, k) { t[0].setAttribute('aria-selected', k === i ? 'true' : 'false'); t[1].hidden = k !== i; });
    }
  })();

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
  renderPlan();
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
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () {});
  }
})();
