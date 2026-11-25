/* אנימציית הפתיחה: "רוצה לבנות הרגלים, ומשהו תמיד נתקע?", ואז מסך בית עמוס שמתנקה
   למסך אחד עם וידג'ט ההרגלים ו־12 אפליקציות. מוצגת פעם אחת, אפשר לדלג ולצפות שוב. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var intro = $('intro');
  if (!intro) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SEEN = 'ah-intro-seen';

  /* ---------- the phone ---------- */
  var stage = $('phStage');
  // [icon, colour, badge, keep]: generic apps, no brands. 'dock' stays, a number is its slot under the widget
  var APPS = [
    ['📰', 'c1', 3], ['🖼️', 'c2', 0, 0], ['🎮', 'c3', 2], ['🗺️', 'c4', 0, 1],
    ['📺', 'c5', 0], ['🛒', 'c6', 0], ['📅', 'c7', 0, 2], ['💳', 'c8', 0, 4],
    ['🎬', 'c1', 0], ['🍔', 'c3', 1], ['🎵', 'c2', 0, 3], ['🌤️', 'c4', 0, 5],
    ['📱', 'c5', 2], ['🎧', 'c6', 0], ['🧮', 'c7', 0], ['🏃', 'c8', 0, 6],
    ['📸', 'c1', 1], ['🛍️', 'c2', 0], ['🎲', 'c3', 0], ['⏰', 'c4', 0, 7],
    ['📞', 'c5', 0, 'dock'], ['💬', 'c6', 0, 'dock'], ['🌐', 'c7', 0, 'dock'], ['📷', 'c8', 0, 'dock']
  ];
  var COL = function (c) { return 6 + c * 23.5; };
  var apps = APPS.map(function (a, i) {
    var el = document.createElement('div');
    el.className = 'ph-app ' + a[1];
    el.textContent = a[0];
    if (a[2]) { var bd = document.createElement('b'); bd.className = 'ph-badge'; bd.textContent = a[2]; el.appendChild(bd); }
    stage.appendChild(el);
    var dock = a[3] === 'dock';
    var from = dock ? { x: COL(i - 20), y: 81 } : { x: COL(i % 4), y: 4 + Math.floor(i / 4) * 11.5 };
    // 8 apps in two rows under the widget, 4 more in the dock: 12 in all
    var to = dock ? from : typeof a[3] === 'number' ? { x: COL(a[3] % 4), y: 45 + Math.floor(a[3] / 4) * 11.5 } : null;
    return { el: el, from: from, to: to, badge: el.querySelector('.ph-badge') };
  });
  var gone = apps.filter(function (a) { return !a.to; });
  gone.forEach(function (a, k) { a.start = k / gone.length * 0.45; });

  var widget = document.createElement('div');
  widget.className = 'ph-widget';
  stage.appendChild(widget);
  var lib = document.createElement('div');
  lib.className = 'ph-lib';
  lib.textContent = '🔍 כל השאר בחיפוש';
  stage.appendChild(lib);

  // the plan's own habits when there are any (a returning visitor), otherwise an example
  function fillWidget() {
    var hs = (window.HabitPlan && window.HabitPlan.habits()) || [];
    if (!hs.length) hs = [{ text: 'כוס מים מיד כשקמים', time: '07:00' }, { text: 'לקרוא עמוד אחד לפני השינה', time: '22:30' }];
    widget.textContent = '';
    var h = document.createElement('div'); h.className = 'ph-w-h';
    h.textContent = 'הרגלים'; var c = document.createElement('span'); c.textContent = hs.length; h.appendChild(c);
    widget.appendChild(h);
    hs.slice(0, 3).forEach(function (x) {
      var r = document.createElement('div'); r.className = 'ph-w-row';
      r.appendChild(document.createElement('i'));
      var t = document.createElement('span'); t.textContent = x.text; r.appendChild(t);
      var tm = document.createElement('small'); tm.textContent = x.time || 'היום'; r.appendChild(tm);
      widget.appendChild(r);
    });
  }

  function seg(p, a, b) { return Math.min(1, Math.max(0, (p - a) / (b - a))); }
  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  var dots = $('phDots').children;
  function draw(p) {
    apps.forEach(function (a) {
      var x = a.from.x, y = a.from.y, s = 1, o = 1;
      if (a.to) {
        var t = ease(seg(p, .45, .8));
        x += (a.to.x - x) * t; y += (a.to.y - y) * t;
      } else {
        var g = ease(seg(p, a.start, a.start + .3));
        x += (40 - x) * g; y += (96 - y) * g; s = 1 - .8 * g; o = 1 - g;
      }
      a.el.style.insetInlineStart = x + '%';
      a.el.style.top = y + '%';
      a.el.style.transform = 'scale(' + s + ')';
      a.el.style.opacity = o;
      a.el.style.visibility = o < .02 ? 'hidden' : '';
      if (a.badge) a.badge.style.opacity = 1 - seg(p, 0, .2);
    });
    var w = ease(seg(p, .6, 1));
    widget.style.opacity = w;
    widget.style.transform = 'translateY(' + (1 - w) * 12 + '%) scale(' + (.94 + .06 * w) + ')';
    lib.style.opacity = seg(p, .85, 1);
    for (var i = 1; i < dots.length; i++) dots[i].style.opacity = 1 - seg(p, .3, .6);
    $('introCap').textContent = p < .5 ? '4 מסכים. 24 אפליקציות. 9 התראות.' : 'מסך אחד. וידג\'ט אחד. 12 אפליקציות.';
  }

  /* ---------- the sequence ---------- */
  var timers = [], raf = 0;
  function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clean(dur) {
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      draw(p);
      if (p < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
  }
  var lines = intro.querySelectorAll('.intro-list li');
  var lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    fillWidget();
    draw(0);
    intro.hidden = false;
    document.documentElement.classList.add('intro-on');
    $('sceneA').hidden = false; $('sceneB').hidden = true;
    intro.classList.remove('b');
    Array.prototype.forEach.call(lines, function (l) { l.classList.remove('in', 'on'); });
    intro.focus();
    if (reduce) {
      // no motion: the question, then the clean screen
      Array.prototype.forEach.call(lines, function (l) { l.classList.add('in', 'on'); });
      later(2600, function () { showB(); draw(1); });
      return;
    }
    Array.prototype.forEach.call(lines, function (l, i) {
      // each moment gets time to be read before it is ticked
      later(900 + i * 2500, function () { l.classList.add('in'); });
      later(2200 + i * 2500, function () { l.classList.add('on'); });
    });
    later(8800, showB);
    later(10600, function () { clean(3800); });
  }
  function showB() {
    $('sceneA').hidden = true; $('sceneB').hidden = false;
    intro.classList.add('b');
  }
  function close() {
    timers.forEach(clearTimeout); timers = [];
    cancelAnimationFrame(raf);
    intro.hidden = true;
    document.documentElement.classList.remove('intro-on');
    try { localStorage.setItem(SEEN, '1'); } catch (e) {}
    if (lastFocus && lastFocus.focus && lastFocus !== document.body) lastFocus.focus();
  }
  $('introSkip').addEventListener('click', close);
  $('introGo').addEventListener('click', close);
  intro.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // keep focus inside the dialog
      var f = Array.prototype.filter.call(intro.querySelectorAll('button'), function (b) { return b.offsetParent; });
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  $('replayIntro').addEventListener('click', open);

  // first visit only, and not when arriving from a shared link or the Todoist login
  var seen = false;
  try { seen = !!localStorage.getItem(SEEN); } catch (e) {}
  var q = location.search;
  if (!seen && !/[?&](a|f|b|g|todoist|t)=/.test(q)) open();
})();
