/* הפתיח "נתקעת?" והדמיית מסך הבית: לפני (4 מסכים עמוסים) ואחרי (מסך אחד, וידג'ט ההרגלים ו־8 אפליקציות). */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- intro: "נשמע מוכר?" ---------- */
  var items = document.querySelectorAll('.stuck-item');
  var bars = document.querySelectorAll('.stuck-bar span');
  Array.prototype.forEach.call(items, function (b) {
    b.addEventListener('click', function () {
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      var n = document.querySelectorAll('.stuck-item[aria-pressed="true"]').length;
      Array.prototype.forEach.call(bars, function (s, i) { s.classList.toggle('on', i < n); });
      $('stuckPunch').hidden = n === 0;
      $('stuckSub').hidden = n > 0;
    });
  });

  /* ---------- home screen demo ---------- */
  var stage = $('phStage');
  if (!stage) return;
  // [icon, colour, badge]: generic apps, no brands. keep: 'dock' stays in the dock, a number is its slot in the row under the widget
  var APPS = [
    ['📰', 'c1', 3], ['🖼️', 'c2', 0, 0], ['🎮', 'c3', 2], ['🗺️', 'c4', 0, 1],
    ['📺', 'c5', 0], ['🛒', 'c6', 0], ['📅', 'c7', 0, 2], ['💳', 'c8', 0],
    ['🎬', 'c1', 0], ['🍔', 'c3', 1], ['🎵', 'c2', 0, 3], ['🌤️', 'c4', 0],
    ['📱', 'c5', 2], ['🎧', 'c6', 0], ['🧮', 'c7', 0], ['🏃', 'c8', 0],
    ['📸', 'c1', 1], ['🛍️', 'c2', 0], ['🎲', 'c3', 0], ['⏰', 'c4', 0],
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
    var to = dock ? from : typeof a[3] === 'number' ? { x: COL(a[3]), y: 47 } : null;
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

  function fillWidget() {
    var hs = (window.HabitPlan && window.HabitPlan.habits()) || [];
    var sample = !hs.length;
    if (sample) hs = [{ text: 'כוס מים מיד כשקמים', time: '07:00' }, { text: 'לקרוא עמוד אחד לפני השינה', time: '22:30' }];
    widget.textContent = '';
    var h = document.createElement('div'); h.className = 'ph-w-h';
    h.textContent = 'הרגלים'; var c = document.createElement('span'); c.textContent = hs.length; h.appendChild(c);
    widget.appendChild(h);
    hs.slice(0, 3).forEach(function (x) {
      var r = document.createElement('div'); r.className = 'ph-w-row';
      var o = document.createElement('i'); r.appendChild(o);
      var t = document.createElement('span'); t.textContent = x.text; r.appendChild(t);
      var tm = document.createElement('small'); tm.textContent = x.time || 'היום'; r.appendChild(tm);
      widget.appendChild(r);
    });
    $('screenNote').textContent = sample
      ? 'זו דוגמה. בחר הרגלים בתוכנית למעלה, והם יופיעו כאן בווידג\'ט.'
      : 'אלה ההרגלים מהתוכנית שלך, כמו שהם ייראו בווידג\'ט של Todoist.';
  }
  document.addEventListener('habits-change', fillWidget);
  fillWidget();

  function seg(p, a, b) { return Math.min(1, Math.max(0, (p - a) / (b - a))); }
  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  var dots = $('phDots').children;
  var P = 0;
  function draw(p) {
    P = p;
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
    var after = p >= .5;
    $('screenState').textContent = after
      ? 'אחרי: מסך אחד, וידג\'ט עם ההרגלים שלך ו־8 אפליקציות.'
      : 'לפני: 4 מסכים, 24 אפליקציות, 9 התראות.';
    $('cleanBtn').textContent = p >= .99 ? 'תראה שוב' : 'נקה לי את המסך';
    $('scrub').value = Math.round(p * 100);
  }

  var raf = 0;
  function play() {
    cancelAnimationFrame(raf);
    var from = P >= .99 ? 0 : P;
    if (reduce) { draw(1); return; }
    var t0 = null, dur = 2600 * (1 - from);
    draw(from);
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = from + (1 - from) * Math.min(1, (ts - t0) / dur);
      draw(p);
      if (p < 1) raf = requestAnimationFrame(step);
    }
    // a short pause on the cluttered screen before cleaning it
    setTimeout(function () { raf = requestAnimationFrame(step); }, from === 0 ? 350 : 0);
  }
  $('cleanBtn').addEventListener('click', play);
  $('scrub').addEventListener('input', function () { cancelAnimationFrame(raf); draw(this.value / 100); });
  draw(0);

  // play once the first time the phone scrolls into view
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { io.disconnect(); if (P === 0) play(); }
    }, { threshold: .35 });
    io.observe($('phone'));
  }
})();
