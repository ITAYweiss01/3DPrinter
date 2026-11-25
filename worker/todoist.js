/* Todoist connection: each visitor connects their own Todoist account (OAuth),
 * and the site adds their habits as daily recurring tasks in a "הרגלים" project.
 *
 * Security
 *  - The Todoist access token never reaches the browser. It is stored in KV
 *    encrypted with AES-GCM (secret TOKEN_KEY). The browser holds only a random
 *    connection id that can do three things: add habits, check status, disconnect.
 *  - OAuth "state" is random, single-use and expires after 10 minutes (CSRF).
 *  - Redirects go back only to an origin on ALLOWED_ORIGINS.
 *  - Scope is data:read_write (needed to find/create the project, avoid duplicates and update schedules).
 *  - Disconnect revokes the token at Todoist and deletes it here.
 *
 * Endpoints (from Todoist's official SDK, @doist/todoist-sdk):
 *  authorize:    https://todoist.com/oauth/authorize
 *  token:        https://todoist.com/oauth/access_token
 *  revoke:       https://api.todoist.com/api/v1/revoke
 *  REST:         https://api.todoist.com/api/v1/{projects,tasks}
 */
const AUTH_URL = 'https://todoist.com/oauth/authorize';
const TOKEN_URL = 'https://todoist.com/oauth/access_token';
const API = 'https://api.todoist.com/api/v1/';
const SCOPE = 'data:read_write';
const PROJECT_NAME = 'הרגלים';
const MAX_HABITS = 20;

/* ---------- schedule -> Todoist due_string ----------
 * Todoist parses English recurring dates ("every day", "every sun, wed at 18:00").
 * The client sends a structured schedule; the string is built here, so nothing the
 * browser sends goes into due_string as free text.
 *   { freq: 'daily' }                          -> "every day"
 *   { freq: 'days', days: [0, 3] }             -> "every sun, wed"   (0 = Sunday)
 *   { ..., time: '07:30' }                     -> "... at 07:30"
 */
const DAY_EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export function dueString(schedule) {
  const sc = schedule && typeof schedule === 'object' ? schedule : {};
  const days = Array.isArray(sc.days)
    ? [...new Set(sc.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  const time = typeof sc.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(sc.time) ? sc.time : '';
  const base = sc.freq === 'days' && days.length && days.length < 7
    ? 'every ' + days.map((d) => DAY_EN[d]).join(', ')
    : 'every day';
  return base + (time ? ' at ' + time : '');
}

/* ---------- helpers ---------- */
function randomId(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
function b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(str) { return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)); }

async function aesKey(env) {
  const raw = unb64(env.TOKEN_KEY || '');
  if (raw.length !== 32) throw Object.assign(new Error('TOKEN_KEY must be 32 bytes, base64'), { code: 'not_configured' });
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text)));
  return b64(iv) + '.' + b64(ct);
}
export async function decrypt(env, blob) {
  const [iv, ct] = String(blob).split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

function allowedReturn(env, url) {
  try {
    const u = new URL(url);
    const origins = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    return origins.includes(u.origin) ? u.origin + u.pathname : null;
  } catch { return null; }
}

function redirect(to) {
  return new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

async function td(token, path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + token, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error('todoist auth'), { code: 'todoist_auth' });
  if (!res.ok) { console.error('todoist error', res.status, path.split('?')[0]); throw Object.assign(new Error('todoist'), { code: 'upstream' }); }
  return res.status === 204 ? {} : res.json();
}

async function listAll(token, path) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await td(token, path + (cursor ? sep + 'cursor=' + encodeURIComponent(cursor) : ''));
    const results = Array.isArray(data) ? data : (data.results || []);
    out.push(...results);
    cursor = Array.isArray(data) ? null : data.next_cursor;
    if (!cursor) break;
  }
  return out;
}

async function tokenFor(env, sid) {
  if (typeof sid !== 'string' || !/^[0-9a-f]{64}$/.test(sid)) return null;
  const blob = await env.TODOIST.get('ts:' + sid);
  return blob ? decrypt(env, blob) : null;
}

/* ---------- navigations (no Origin header): start + callback ---------- */
export async function handleTodoistNav(url, env) {
  if (!env.TODOIST || !env.TODOIST_CLIENT_ID || !env.TODOIST_CLIENT_SECRET || !env.TOKEN_KEY) {
    return new Response('Todoist is not configured on this server.', { status: 500 });
  }

  if (url.pathname === '/todoist/start') {
    const back = allowedReturn(env, url.searchParams.get('return') || '');
    if (!back) return new Response('Bad return address.', { status: 400 });
    const state = randomId(24);
    await env.TODOIST.put('st:' + state, JSON.stringify({ back }), { expirationTtl: 600 });
    return redirect(AUTH_URL + '?client_id=' + encodeURIComponent(env.TODOIST_CLIENT_ID) +
      '&scope=' + encodeURIComponent(SCOPE) + '&state=' + state);
  }

  if (url.pathname === '/todoist/callback') {
    const state = url.searchParams.get('state') || '';
    const saved = /^[0-9a-f]{48}$/.test(state) ? await env.TODOIST.get('st:' + state) : null;
    if (!saved) return new Response('This sign-in link expired. Go back to the site and connect again.', { status: 400 });
    await env.TODOIST.delete('st:' + state); // single use
    const { back } = JSON.parse(saved);
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error') || !code) return redirect(back + '#todoist-denied');

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.TODOIST_CLIENT_ID, client_secret: env.TODOIST_CLIENT_SECRET, code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) { console.error('todoist token exchange failed', res.status); return redirect(back + '#todoist-error'); }

    const sid = randomId(32);
    await env.TODOIST.put('ts:' + sid, await encrypt(env, data.access_token), { expirationTtl: 60 * 60 * 24 * 365 });
    return redirect(back + '#todoist-' + sid);
  }

  return new Response('Not found', { status: 404 });
}

/* ---------- API calls from the site (Origin-checked by the caller) ---------- */
export async function handleTodoistApi(path, body, env) {
  if (!env.TODOIST || !env.TOKEN_KEY) return [500, { error: 'not_configured' }];
  const sid = body && body.sid;

  if (path === '/todoist/status') {
    const token = await tokenFor(env, sid);
    return [200, { connected: !!token }];
  }

  if (path === '/todoist/disconnect') {
    const token = await tokenFor(env, sid);
    if (token) {
      try {
        await fetch(API + 'revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(env.TODOIST_CLIENT_ID + ':' + env.TODOIST_CLIENT_SECRET) },
          body: JSON.stringify({ token, token_type_hint: 'access_token' })
        });
      } catch (e) { console.error('todoist revoke failed'); }
      await env.TODOIST.delete('ts:' + sid);
    }
    return [200, { connected: false }];
  }

  if (path === '/todoist/add') {
    const token = await tokenFor(env, sid);
    if (!token) return [401, { error: 'todoist_not_connected' }];
    const habits = Array.isArray(body.habits) ? body.habits.slice(0, MAX_HABITS).map((h) => ({
      content: typeof h.content === 'string' ? h.content.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 120) : '',
      note: typeof h.note === 'string' ? h.note.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim().slice(0, 300) : '',
      due: dueString(h.schedule)
    })).filter((h) => h.content) : [];
    if (!habits.length) return [400, { error: 'bad_input' }];

    try {
      const projects = await listAll(token, 'projects');
      let project = projects.find((p) => p.name === PROJECT_NAME && !p.is_archived);
      if (!project) project = await td(token, 'projects', { method: 'POST', body: JSON.stringify({ name: PROJECT_NAME, color: 'green' }) });
      const existing = await listAll(token, 'tasks?project_id=' + encodeURIComponent(project.id));
      const byContent = new Map(existing.map((t) => [t.content, t]));
      let added = 0, updated = 0, skipped = 0;
      for (const h of habits) {
        const found = byContent.get(h.content);
        if (found) {
          // already there: keep the task (and its history), only update the schedule if it changed
          if (!found.due || found.due.string !== h.due) {
            await td(token, 'tasks/' + encodeURIComponent(found.id), { method: 'POST', body: JSON.stringify({ due_string: h.due, due_lang: 'en' }) });
            found.due = { string: h.due };
            updated++;
          } else skipped++;
          continue;
        }
        const task = await td(token, 'tasks', {
          method: 'POST',
          body: JSON.stringify({
            content: h.content,
            description: (h.note ? h.note + '\n' : '') + 'נוסף מ־habits',
            project_id: project.id,
            due_string: h.due,
            due_lang: 'en'
          })
        });
        byContent.set(h.content, { ...task, due: { string: h.due } });
        added++;
      }
      return [200, { added, updated, skipped, project: PROJECT_NAME }];
    } catch (e) {
      if (e.code === 'todoist_auth') { await env.TODOIST.delete('ts:' + sid); return [401, { error: 'todoist_not_connected' }]; }
      return [502, { error: 'upstream' }];
    }
  }

  return [404, { error: 'not_found' }];
}
