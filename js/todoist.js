/* חיבור ל־Todoist: כל משתמש מחבר את החשבון שלו.
   הדפדפן מחזיק רק מזהה חיבור אקראי, לא את הטוקן של Todoist. */
(function () {
  'use strict';
  var cfg = window.HABITS_CONFIG || {};
  var proxy = typeof cfg.proxyUrl === 'string' ? cfg.proxyUrl.replace(/\/+$/, '') : '';
  var KEY = 'ah-todoist';
  var sid = '';
  try { sid = localStorage.getItem(KEY) || ''; } catch (e) {}
  var listeners = [];
  var lastEvent = '';

  // returning from Todoist sign-in: #todoist-<id> / #todoist-denied / #todoist-error
  var m = /^#todoist-(.+)$/.exec(location.hash);
  if (m) {
    if (/^[0-9a-f]{64}$/.test(m[1])) {
      sid = m[1];
      try { localStorage.setItem(KEY, sid); } catch (e) {}
      lastEvent = 'connected';
    } else {
      lastEvent = m[1] === 'denied' ? 'denied' : 'error';
    }
    try { history.replaceState(null, '', location.pathname + location.search + '#tracker'); } catch (e) {}
  }

  function available() { return /^https:\/\/[^\s/]+/.test(proxy); }
  function connected() { return !!sid; }
  function emit() { listeners.forEach(function (f) { f(); }); }

  function post(path, body) {
    return fetch(proxy + path, {
      method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 && d.error === 'todoist_not_connected') { forget(); throw new Error('החיבור ל־Todoist פג. חבר שוב.'); }
        if (!r.ok || d.error) throw new Error(r.status === 429 ? 'יותר מדי בקשות. נסה שוב בעוד דקה.' : 'לא הצלחנו לדבר עם Todoist. נסה שוב.');
        return d;
      });
    }, function () { throw new Error('אין חיבור לשרת. בדוק את האינטרנט.'); });
  }
  function forget() {
    sid = '';
    try { localStorage.removeItem(KEY); } catch (e) {}
    emit();
  }

  // "X (cue)" from the 2-minute habit becomes task "X" with note "אחרי ש<cue>"
  function toTask(item) {
    var text = typeof item === 'string' ? item : item.text;
    var schedule = item && item.schedule ? item.schedule : { freq: 'daily', days: [], time: '' };
    var mm = /^(.*) \((.+)\)$/.exec(text);
    return mm
      ? { content: mm[1], note: 'הרגל של שתי דקות: אחרי ש' + mm[2] + ', ' + mm[1] + '.', schedule: schedule }
      : { content: text, note: '', schedule: schedule };
  }

  window.HabitTodoist = {
    available: available,
    connected: connected,
    lastEvent: function () { var e = lastEvent; lastEvent = ''; return e; },
    onChange: function (f) { listeners.push(f); },
    connect: function () {
      var back = location.origin + location.pathname;
      location.href = proxy + '/todoist/start?return=' + encodeURIComponent(back);
    },
    disconnect: function () {
      var s = sid;
      forget();
      return s ? post('/todoist/disconnect', { sid: s }).catch(function () {}) : Promise.resolve();
    },
    check: function () {
      if (!sid || !available()) return Promise.resolve(false);
      return post('/todoist/status', { sid: sid }).then(function (d) { if (!d.connected) forget(); return !!d.connected; }, function () { return connected(); });
    },
    // items: [{ text, schedule: { freq: 'daily'|'days', days: [0-6], time: 'HH:MM'|'' } }]
    add: function (items) {
      if (!sid) return Promise.reject(new Error('Todoist לא מחובר.'));
      return post('/todoist/add', { sid: sid, habits: items.slice(0, 20).map(toTask) });
    }
  };
})();
