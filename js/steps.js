/* האתר כאשף: צעד אחד בכל מסך, עם פס שלבים למעלה ו"חזרה" / "הבא" למטה.
   כל צעד הוא אלמנט עם data-step. הכתובת זוכרת את הצעד (#s2), כך שכפתור "אחורה" של הדפדפן עובד. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var N = 5;
  var NEXT = { 2: 'הבא: מתי לעשות', 3: 'הבא: שליחה', 4: 'הבא: סידור הטלפון' };
  var cur = 0;

  function apply(n, push) {
    n = Math.min(N, Math.max(1, n | 0));
    var changed = n !== cur;
    cur = n;
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

  // where to start: back from Todoist sign-in -> sending; a shared link -> the traits; otherwise the hash or step 1
  var start = fromHash();
  if (window.HABIT_TODOIST_RETURN || location.hash === '#tracker') start = 4;
  else if (!start && /[?&](a|f|b|g)=/.test(location.search)) start = 2;
  apply(start || 1, false);
  try { history.replaceState({ s: cur }, '', location.pathname + location.search + '#s' + cur); } catch (e) {}
})();
