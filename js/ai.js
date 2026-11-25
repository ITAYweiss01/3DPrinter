/* מצב Claude: הדפדפן שולח רק את המטרה ואת הזמן ל־Worker.
   אין כאן מפתח, אין פרומפט ואין גישה ישירה ל־API. */
(function () {
  'use strict';
  var cfg = window.HABITS_CONFIG || {};
  var proxy = typeof cfg.proxyUrl === 'string' ? cfg.proxyUrl.replace(/\/+$/, '') : '';
  var siteKey = typeof cfg.turnstileSiteKey === 'string' ? cfg.turnstileSiteKey : '';

  // ניקוי: גרסה קודמת שמרה מפתח API בדפדפן. מוחקים אותו.
  try { localStorage.removeItem('ah-ai'); } catch (e) {}

  // Ask the Worker which features are set up; until it answers, everything is off.
  var features = { claude: false, todoist: false, suggest: false };
  var hasProxy = /^https:\/\/[^\s/]+/.test(proxy);
  var ready = !hasProxy ? Promise.resolve(features) : fetch(proxy + '/features', {
    mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'
  }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (f) {
    features = { claude: f.claude === true, todoist: f.todoist === true, suggest: f.suggest === true };
    return features;
  }, function () { return features; });
  window.HabitFeatures = { ready: ready, get: function () { return features; }, proxy: hasProxy ? proxy : '' };

  function configured() { return features.claude; }

  /* ---------- Turnstile (optional) ---------- */
  var widgetId = null, tsReady = null;
  function loadTurnstile() {
    if (!siteKey) return Promise.resolve(null);
    if (tsReady) return tsReady;
    tsReady = new Promise(function (resolve) {
      window.__tsLoaded = function () {
        widgetId = window.turnstile.render('#captcha', { sitekey: siteKey, size: 'flexible', appearance: 'interaction-only', language: 'he' });
        resolve(widgetId);
      };
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__tsLoaded&render=explicit';
      s.async = true;
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
    return tsReady;
  }
  function captchaToken() {
    if (!siteKey) return Promise.resolve('');
    return loadTurnstile().then(function () {
      if (widgetId === null || !window.turnstile) return '';
      var t = window.turnstile.getResponse(widgetId);
      if (t) return t;
      return new Promise(function (resolve) {
        var n = 0, iv = setInterval(function () {
          var v = window.turnstile.getResponse(widgetId);
          if (v || ++n > 60) { clearInterval(iv); resolve(v || ''); }
        }, 250);
      });
    });
  }

  function err(code) { var e = new Error(code); e.code = code; return e; }

  function generate(goal, minutes, signal) {
    return captchaToken().then(function (token) {
      return fetch(proxy + '/generate', {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal, minutes: minutes, captcha: token }),
        signal: signal
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (siteKey && widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
        if (data && data.plan) return data.plan;
        throw err((data && data.error) || (r.status === 429 ? 'rate_limited' : 'upstream'));
      });
    }, function (e) {
      if (e && e.name === 'AbortError') throw err('cancelled');
      throw err(e && e.code ? e.code : 'network');
    });
  }

  // topic request: sent only when the visitor clicks "send"
  function suggest(goal) {
    return fetch(proxy + '/suggest', {
      method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: goal })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.ok && data && data.ok) return true;
        throw err((data && data.error) || (r.status === 429 ? 'rate_limited' : 'upstream'));
      });
    }, function () { throw err('network'); });
  }

  function errorCopy(e) {
    switch (e && e.code) {
      case 'cancelled': return '';
      case 'rate_limited': return 'יותר מדי בקשות. נסה שוב בעוד דקה.';
      case 'busy': return 'Claude עמוס כרגע. נסה שוב עוד מעט.';
      case 'captcha': return 'בדיקת האבטחה נכשלה. רענן את הדף ונסה שוב.';
      case 'bad_input': return 'הטקסט ארוך מדי או לא תקין. נסה לקצר.';
      case 'forbidden': return 'השרת לא מאשר בקשות מהאתר הזה.';
      case 'refused': return 'Claude לא יכול לעזור עם הבקשה הזאת. אפשר לנסח אחרת.';
      case 'invalid': return 'התשובה לא הגיעה במבנה הנכון. נסה שוב.';
      case 'network': return 'אין חיבור לשרת. בדוק את האינטרנט.';
      case 'full': return 'יש כרגע הרבה בקשות שמחכות לאישור. נסה שוב בעוד כמה ימים.';
      default: return 'משהו השתבש. נסה שוב.';
    }
  }

  window.HabitAI = { configured: configured, generate: generate, suggest: suggest, errorCopy: errorCopy };
  ready.then(function () { if (configured() && siteKey) loadTurnstile(); });
})();
