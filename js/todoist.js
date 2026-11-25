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

  // OAuth mode only when the Worker says Todoist is configured (see HabitFeatures in ai.js)
  function available() { return !!(window.HabitFeatures && window.HabitFeatures.get().todoist); }
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

  // plan item -> Todoist task; a 2-minute habit carries its full sentence as the description
  function toTask(item) {
    var schedule = item && item.schedule ? item.schedule : { freq: 'daily', days: [], time: '' };
    return { content: item.text, note: item.note ? 'הרגל של שתי דקות: ' + item.note : '', schedule: schedule };
  }

  /* ---------- direct mode (no server yet) ----------
     The visitor pastes their personal Todoist API token. It is used only for this
     one send, straight from the browser to api.todoist.com, and is never stored. */
  var API = 'https://api.todoist.com/api/v1/';
  var DAY_EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  function dueString(sc) {
    sc = sc || {};
    var days = Array.isArray(sc.days) ? sc.days.filter(function (d, i, a) { return d >= 0 && d <= 6 && a.indexOf(d) === i; }).sort() : [];
    var time = /^([01]\d|2[0-3]):[0-5]\d$/.test(sc.time || '') ? sc.time : '';
    var base = sc.freq === 'days' && days.length && days.length < 7 ? 'every ' + days.map(function (d) { return DAY_EN[d]; }).join(', ') : 'every day';
    return base + (time ? ' at ' + time : '');
  }
  function directAdd(token, items) {
    token = String(token || '').trim();
    if (!/^[0-9a-f]{40}$/i.test(token)) return Promise.reject(new Error('זה לא נראה כמו טוקן של Todoist (40 תווים של אותיות ומספרים).'));
    function call(path, method, body) {
      return fetch(API + path, {
        method: method || 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('Todoist לא קיבל את הטוקן. בדוק שהעתקת אותו נכון.');
        if (r.status === 429) throw new Error('Todoist מגביל כרגע. נסה שוב בעוד דקה.');
        if (!r.ok) throw new Error('Todoist החזיר שגיאה (' + r.status + '). נסה שוב.');
        return r.status === 204 ? {} : r.json();
      }, function () { throw new Error('אין חיבור ל־Todoist. בדוק את האינטרנט.'); });
    }
    function listAll(path, acc, cursor, n) {
      acc = acc || []; n = n || 0;
      var sep = path.indexOf('?') === -1 ? '?' : '&';
      return call(path + (cursor ? sep + 'cursor=' + encodeURIComponent(cursor) : '')).then(function (d) {
        var res = Array.isArray(d) ? d : (d.results || []);
        acc = acc.concat(res);
        var next = Array.isArray(d) ? null : d.next_cursor;
        return next && n < 20 ? listAll(path, acc, next, n + 1) : acc;
      });
    }
    var tasks = items.slice(0, 20).map(toTask).map(function (t) { return { content: t.content.slice(0, 120), note: t.note, due: dueString(t.schedule) }; });
    var project, result = { added: 0, updated: 0, skipped: 0 };
    return listAll('projects').then(function (ps) {
      project = ps.filter(function (p) { return p.name === 'הרגלים' && !p.is_archived; })[0];
      return project || call('projects', 'POST', { name: 'הרגלים', color: 'green' });
    }).then(function (p) {
      project = p;
      return listAll('tasks?project_id=' + encodeURIComponent(p.id));
    }).then(function (existing) {
      var by = {};
      existing.forEach(function (t) { by[t.content] = t; });
      return tasks.reduce(function (chain, t) {
        return chain.then(function () {
          var found = by[t.content];
          if (found) {
            if (found.due && found.due.string === t.due) { result.skipped++; return; }
            return call('tasks/' + encodeURIComponent(found.id), 'POST', { due_string: t.due, due_lang: 'en' }).then(function () { result.updated++; });
          }
          return call('tasks', 'POST', {
            content: t.content,
            description: (t.note ? t.note + '\n' : '') + 'נוסף מ־habits',
            project_id: project.id, due_string: t.due, due_lang: 'en'
          }).then(function (nt) { by[t.content] = nt; result.added++; });
        });
      }, Promise.resolve());
    }).then(function () { token = ''; return result; }, function (e) { token = ''; throw e; });
  }

  window.HabitTodoist = {
    directAdd: directAdd,
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
