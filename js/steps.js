/* האתר כאשף: צעד אחד בכל מסך, עם פס שלבים למעלה ו"חזרה" / "הבא" למטה.
   כל צעד הוא אלמנט עם data-step. הכתובת זוכרת את הצעד (#s2), כך שכפתור "אחורה" של הדפדפן עובד. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var N = 5;
  var NEXT = { 2: 'הבא: מתי לעשות', 3: 'הבא: שליחה', 4: 'הבא: סידור הטלפון' };
  var cur = 0;

  /* ---------- anonymous counts: how far people get ----------
     No cookies, no id, no IP: once the page is hidden, one request says which steps this
     visit reached (for example ["v","q2","s2","built"]). The server only adds to daily totals. */
  var EVENTS = /^(v|q[2-5]|s[2-5]|built|td|ics|file|tip)$/;
  var seenEv = {}, sentEv = {};
  var cfg = window.HABITS_CONFIG || {};
  var base = typeof cfg.proxyUrl === 'string' ? cfg.proxyUrl.replace(/\/+$/, '') : '';
  var optOut = navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  window.HabitStats = { mark: function (e) { if (EVENTS.test(e)) seenEv[e] = 1; } };
  function flush() {
    var f = Object.keys(seenEv).filter(function (e) { return !sentEv[e]; });
    if (!f.length || !base || optOut || !navigator.sendBeacon) return;
    try { if (navigator.sendBeacon(base + '/hit', JSON.stringify({ f: f }))) f.forEach(function (e) { sentEv[e] = 1; }); } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  window.HabitStats.mark('v');

  /* ---------- "buy me a coffee": shown only when config.js has an https link ---------- */
  var tipUrl = typeof cfg.donateUrl === 'string' ? cfg.donateUrl.trim() : '';
  if (/^https:\/\/[^\s"'<>]+$/.test(tipUrl)) {
    $('tipLink').href = tipUrl;
    $('tipBox').hidden = false;
    $('tipLink').addEventListener('click', function () { window.HabitStats.mark('tip'); });
  }

  function apply(n, push) {
    n = Math.min(N, Math.max(1, n | 0));
    var changed = n !== cur;
    cur = n;
    if (n > 1) window.HabitStats.mark('s' + n);
    document.querySelectorAll('[data-step]').forEach(function (el) {
      el.classList.toggle('cur', +el.getAttribute('data-step') === n);
    });
    document.querySelectorAll('#stepper button').forEach(function (b) {
      var k = +b.getAttribute('data-go');
      b.classList.toggle('done', k < n);
      if (k === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    $('stepBack').hidden = n === 1;
    $('stepNext').hidden = !NEXT[n];
    $('stepNext').textContent = NEXT[n] || '';
    $('stepNav').hidden = n === 1; // step 1 has its own button: "בנה לי הרגלים"
    if (push) { try { history.pushState({ s: n }, '', location.pathname + location.search + '#s' + n); } catch (e) {} }
    if (changed) {
      window.scrollTo(0, 0);
      var h = document.querySelector('[data-step="' + n + '"].cur h1, [data-step="' + n + '"].cur h2, [data-step="' + n + '"].cur .identity');
      if (h && push) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }
  window.HabitSteps = { go: function (n) { apply(n, true); }, current: function () { return cur; } };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-go]');
    if (b) { e.preventDefault(); apply(+b.getAttribute('data-go'), true); }
  });
  $('stepBack').addEventListener('click', function () { apply(cur - 1, true); });
  $('stepNext').addEventListener('click', function () { apply(cur + 1, true); });
  window.addEventListener('popstate', function () { apply(fromHash() || 1, false); });

  function fromHash() { var m = /^#s([1-5])$/.exec(location.hash); return m ? +m[1] : 0; }


  /* ---------- step 1: one question per screen ---------- */
  var form = $('build');
  var QS = [
    form.querySelector('#areas').closest('.q'),
    $('qFuture').closest('.q'),
    $('qBlock').closest('.q'),
    form.querySelector('input[name="when"]').closest('.q'),
    form.querySelector('input[name="time"]').closest('fieldset')
  ];
  QS[0].setAttribute('data-q', 1); $('freeBox').setAttribute('data-q', 1);
  QS.forEach(function (el, i) { el.setAttribute('data-q', i + 1); });
  form.querySelector('.actions').setAttribute('data-q', 5);
  if ($('captcha')) $('captcha').setAttribute('data-q', 5);
  var qn = document.createElement('div');
  qn.className = 'q-nav';
  qn.innerHTML = '<span class="q-count" id="qCount"></span><span class="q-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' +
    '<button type="button" class="btn ghost small" id="qBack">חזרה</button><button type="button" class="btn primary small" id="qNext">הבא</button>';
  form.insertBefore(qn, $('status'));
  var q = 1;
  function showQ(n, focus) {
    q = Math.min(5, Math.max(1, n));
    if (q > 1) window.HabitStats.mark('q' + q);
    form.querySelectorAll('[data-q]').forEach(function (el) { el.classList.toggle('qcur', +el.getAttribute('data-q') === q); });
    $('qCount').textContent = 'שאלה ' + q + ' מתוך 5';
    qn.querySelectorAll('.q-dots i').forEach(function (d, i) { d.classList.toggle('on', i < q); });
    $('qBack').hidden = q === 1;
    $('qNext').hidden = q === 5;
    if (focus) {
      var f = form.querySelector('.qcur input[type="text"], .qcur input:not([type]), .qcur legend, .qcur label');
      if (f) { if (!/INPUT/.test(f.tagName)) f.setAttribute('tabindex', '-1'); f.focus({ preventScroll: true }); }
    }
  }
  $('qNext').addEventListener('click', function () { showQ(q + 1, true); });
  $('qBack').addEventListener('click', function () { showQ(q - 1, true); });
  // Enter in a text field moves on instead of building half-way
  form.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && q < 5 && e.target.tagName === 'INPUT') { e.preventDefault(); showQ(q + 1, true); }
  });
  // choosing a time of day is the whole answer: move on by itself
  form.querySelectorAll('input[name="when"]').forEach(function (r) {
    r.addEventListener('change', function () { if (q === 4) setTimeout(function () { showQ(5, true); }, 250); });
  });
  showQ(1, false);
  window.HabitSteps.question = function (n) { showQ(n, true); };

  // where to start: back from Todoist sign-in -> sending; a shared link -> the traits; otherwise the hash or step 1
  var start = fromHash();
  if (window.HABIT_TODOIST_RETURN || location.hash === '#tracker') start = 4;
  else if (!start && /[?&](a|f|b|g)=/.test(location.search)) start = 2;
  apply(start || 1, false);
  try { history.replaceState({ s: cur }, '', location.pathname + location.search + '#s' + cur); } catch (e) {}
})();
