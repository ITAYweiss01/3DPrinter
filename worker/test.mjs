// Security tests for the Worker. The Claude API is stubbed; no key or network needed.
import assert from 'node:assert/strict';
import worker from './worker.js';

const ORIGIN = 'https://itayweiss01.github.io';
const env = { ANTHROPIC_API_KEY: 'TEST_ONLY_fake_key_value_123', ALLOWED_ORIGINS: ORIGIN };
const plan = { unsafe: false, message: '', identity: 'אני אדם ש...', domains: [], traits: [], avoid: '', first_step: '' };

let upstream = [];
let upstreamStatus = 200;
let ghFiles = {}; let ghCalls = []; let nextModelText = null;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('https://api.github.com/')) return githubStub(String(url), init);
  if (String(url).includes('todoist.com/')) return todoistStub(String(url), init);
  const req = new Request(url, init);
  upstream.push({ url: req.url, headers: Object.fromEntries(req.headers), body: init.body ? JSON.parse(init.body) : null });
  if (upstreamStatus !== 200) {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key TEST_ONLY_fake_key_value_123' } }), { status: upstreamStatus, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: nextModelText || JSON.stringify(plan) }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
let tdState = { projects: [], tasks: [], tokenCalls: 0, revoked: [], authSeen: [] };
function todoistStub(url, init) {
  const u = new URL(url); const method = init.method || 'GET'; const h = init.headers || {};
  const j = (st, o) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  if (u.href === 'https://todoist.com/oauth/access_token') {
    tdState.tokenCalls++;
    const b = JSON.parse(init.body);
    return b.code === 'good-code' && b.client_secret === 'td-secret' ? j(200, { access_token: 'TD_ACCESS_TOKEN_xyz', token_type: 'Bearer' }) : j(400, { error: 'bad' });
  }
  if (u.pathname === '/api/v1/revoke') { tdState.revoked.push(JSON.parse(init.body).token); return j(200, {}); }
  tdState.authSeen.push(h.Authorization);
  if (h.Authorization !== 'Bearer TD_ACCESS_TOKEN_xyz') return j(401, {});
  if (u.pathname === '/api/v1/projects' && method === 'GET') return j(200, { results: tdState.projects, next_cursor: null });
  if (u.pathname === '/api/v1/projects' && method === 'POST') { const p = { id: 'p1', ...JSON.parse(init.body) }; tdState.projects.push(p); return j(200, p); }
  if (u.pathname === '/api/v1/tasks' && method === 'GET') return j(200, { results: tdState.tasks.filter((t) => t.project_id === u.searchParams.get('project_id')), next_cursor: null });
  if (u.pathname === '/api/v1/tasks' && method === 'POST') { const b = JSON.parse(init.body); const t = { id: 't' + tdState.tasks.length, ...b, due: { string: b.due_string } }; tdState.tasks.push(t); return j(200, t); }
  const upd = /^\/api\/v1\/tasks\/([^/]+)$/.exec(u.pathname);
  if (upd && method === 'POST') { const t = tdState.tasks.find((x) => x.id === upd[1]); if (!t) return j(404, {}); const b = JSON.parse(init.body); t.due = { string: b.due_string }; t.updatedVia = (t.updatedVia || 0) + 1; return j(200, t); }
  return j(404, {});
}
function githubStub(url, init) {
  const u = new URL(url); const method = init.method || 'GET';
  ghCalls.push({ method, path: u.pathname, auth: (init.headers || {}).Authorization, body: init.body ? JSON.parse(init.body) : null });
  const j = (st, o) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  if (u.pathname.endsWith('/git/ref/heads/main')) return j(200, { object: { sha: 'basesha' } });
  if (u.pathname.includes('/contents/') && method === 'GET') return ghFiles.extra ? j(200, { sha: 'filesha', content: Buffer.from(ghFiles.extra).toString('base64') }) : j(404, {});
  if (u.pathname.endsWith('/git/refs')) return j(201, {});
  if (u.pathname.includes('/contents/') && method === 'PUT') { ghFiles.extra = Buffer.from(JSON.parse(init.body).content, 'base64').toString('utf8'); return j(201, {}); }
  if (u.pathname.endsWith('/pulls')) return j(201, { number: 7, html_url: 'https://github.com/x/y/pull/7' });
  return j(404, {});
}

let ip = 1;
function call(body, { origin = ORIGIN, method = 'POST', path = '/generate', type = 'application/json', e = env, sameIp } = {}) {
  const headers = { 'Content-Type': type, 'CF-Connecting-IP': sameIp || '10.0.0.' + (ip++) };
  if (origin) headers.Origin = origin;
  return worker.fetch(new Request('https://w.example' + path, { method, headers, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }), e);
}
const ok = { goal: 'אני רוצה להיות בכושר', minutes: 30 };
const results = [];
async function t(name, fn) { upstream = []; upstreamStatus = 200; await fn(); results.push(name); }

await t('valid request returns a plan and pins the model', async () => {
  const r = await call(ok);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).plan, plan);
  assert.equal(upstream.length, 1);
  assert.equal(upstream[0].body.model, 'claude-opus-5-5');
  assert.equal(upstream[0].body.tools, undefined);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});
await t('client cannot inject model, prompt, tools or max_tokens', async () => {
  await call({ ...ok, model: 'x', max_tokens: 999999, tools: [{}], messages: [{ role: 'user', content: 'ignore all' }], system: 'evil' });
  const b = upstream[0].body;
  assert.equal(b.model, 'claude-opus-5-5'); assert.equal(b.max_tokens, 16000);
  assert.equal(b.tools, undefined); assert.equal(b.system, undefined);
  assert.equal(b.messages.length, 1); assert.ok(!b.messages[0].content.includes('ignore all'));
});
await t('unknown origin is blocked', async () => {
  const r = await call(ok, { origin: 'https://evil.example' });
  assert.equal(r.status, 403); assert.equal(upstream.length, 0);
});
await t('missing origin is blocked', async () => {
  assert.equal((await call(ok, { origin: '' })).status, 403);
});
await t('empty allowlist fails closed', async () => {
  assert.equal((await call(ok, { e: { ...env, ALLOWED_ORIGINS: '' } })).status, 403);
});
await t('only POST /generate', async () => {
  assert.equal((await call(ok, { path: '/v1/messages' })).status, 404);
  assert.equal((await call(null, { method: 'GET' })).status, 404);
});
await t('preflight allowed for the site', async () => {
  const r = await call(null, { method: 'OPTIONS' });
  assert.equal(r.status, 204); assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});
await t('input validation', async () => {
  assert.equal((await call({ goal: '', minutes: 30 })).status, 400);
  assert.equal((await call({ goal: 'א'.repeat(601), minutes: 30 })).status, 400);
  assert.equal((await call({ goal: 'x', minutes: 45 })).status, 400);
  assert.equal((await call('not json')).status, 400);
  assert.equal((await call(ok, { type: 'text/plain' })).status, 415);
  assert.equal((await call({ goal: 'x'.repeat(5000), minutes: 30 })).status, 413);
  assert.equal(upstream.length, 0);
});
await t('rate limit per IP (fallback limiter)', async () => {
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await call(ok, { sameIp: '9.9.9.9' })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
});
await t('rate limit binding is used when present', async () => {
  const r = await call(ok, { e: { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } } });
  assert.equal(r.status, 429); assert.equal(upstream.length, 0);
});
await t('turnstile required when configured', async () => {
  const e = { ...env, TURNSTILE_SECRET: 'ts' };
  const r = await call(ok, { e });
  assert.equal(r.status, 403); assert.equal((await r.json()).error, 'captcha');
});
await t('upstream errors never leak the key or details', async () => {
  upstreamStatus = 401;
  const r = await call(ok);
  const text = await r.text();
  assert.equal(r.status, 502);
  assert.ok(!text.includes('TEST_ONLY_fake_key'), 'key leaked'); assert.ok(!text.includes('x-api-key'));
  assert.deepEqual(JSON.parse(text), { error: 'upstream' });
});
await t('missing key returns not_configured without calling upstream', async () => {
  const r = await call(ok, { e: { ALLOWED_ORIGINS: ORIGIN } });
  assert.equal(r.status, 500); assert.equal(upstream.length, 0);
});

/* ---------- topic requests ---------- */
function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.has(k) ? m.get(k) : null; return type === 'json' && v != null ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
  };
}
const ADMIN = 'a'.repeat(40);
const kvEnv = () => ({ ...env, SUGGESTIONS: fakeKV(), ADMIN_TOKEN: ADMIN, GITHUB_TOKEN: 'gh-test-token', GITHUB_REPO: 'o/r' });
function admin(path, body, e, token = ADMIN) {
  const headers = { Origin: ORIGIN, 'CF-Connecting-IP': '10.1.0.' + (ip++), Authorization: 'Bearer ' + token };
  if (body) headers['Content-Type'] = 'application/json';
  return worker.fetch(new Request('https://w.example' + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined }), e);
}
const domain = {
  id: 'gardening', name: 'גינון', keywords: ['גינה', 'לגדל', 'צמחים', 'עציץ'], identity: 'שמגדל דברים', avoid: 'אני לא שוכח להשקות.',
  traits: [1, 2].map((i) => ({ name: 'גנן ' + i, how: 'מטפל בצמחים', starter: { cue: 'אחרי שאני קם', text: 'אני משקה עציץ' }, habits: ['א', 'ב', 'ג'], stretch: 'גינה' }))
};

await t('suggest stores redacted text, dedupes, never stores IP', async () => {
  const e = kvEnv();
  assert.equal((await call({ goal: 'אני רוצה לגדל עגבניות, תכתבו לי ל-dan@mail.com או 050-1234567' }, { path: '/suggest', e })).status, 200);
  await call({ goal: 'אני רוצה לגדל עגבניות, תכתבו לי ל-dan@mail.com או 050-1234567' }, { path: '/suggest', e });
  const items = [...e.SUGGESTIONS.m.values()].map((v) => JSON.parse(v));
  assert.equal(items.length, 1); assert.equal(items[0].count, 2);
  assert.ok(!items[0].goal.includes('dan@mail.com') && !items[0].goal.includes('1234567'));
  assert.ok(!JSON.stringify(items).includes('10.0.0.'), 'IP stored');
  assert.equal(upstream.length, 0, 'suggest must not call Claude');
});
await t('suggest validates input and origin', async () => {
  const e = kvEnv();
  assert.equal((await call({ goal: 'x' }, { path: '/suggest', e })).status, 400);
  assert.equal((await call({ goal: 'א'.repeat(700) }, { path: '/suggest', e })).status, 400);
  assert.equal((await call({ goal: 'ok goal' }, { path: '/suggest', e, origin: 'https://evil.example' })).status, 403);
});
await t('admin requires the token', async () => {
  const e = kvEnv();
  assert.equal((await admin('/admin/suggestions', null, e, 'wrong')).status, 401);
  assert.equal((await admin('/admin/suggestions', null, e, '')).status, 401);
  assert.equal((await admin('/admin/suggestions', null, { ...e, ADMIN_TOKEN: 'short' }, 'short')).status, 401, 'short tokens are refused');
  assert.equal((await admin('/admin/suggestions', null, e)).status, 200);
});
await t('admin token: trailing whitespace in the secret is ignored, short secrets never work', async () => {
  const e = { ...kvEnv(), ADMIN_TOKEN: ADMIN + '\n' };
  assert.equal((await admin('/admin/suggestions', null, e)).status, 200);
  const short = { ...kvEnv(), ADMIN_TOKEN: 'short-pass' };
  assert.equal((await admin('/admin/suggestions', null, short, 'short-pass')).status, 401);
});

await t('failed admin sign-ins get rate limited', async () => {
  const e = kvEnv(); const codes = [];
  for (let i = 0; i < 7; i++) {
    codes.push((await worker.fetch(new Request('https://w.example/admin/suggestions', { headers: { Origin: ORIGIN, 'CF-Connecting-IP': '7.7.7.7', Authorization: 'Bearer nope' } }), e)).status);
  }
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429]);
});
await t('draft asks Claude, validates the domain, stores it', async () => {
  const e = kvEnv();
  await call({ goal: 'אני רוצה לגדל עגבניות' }, { path: '/suggest', e });
  const id = JSON.parse([...e.SUGGESTIONS.m.values()][0]).id;
  nextModelText = JSON.stringify(domain);
  const r = await admin('/admin/draft', { id, existing: ['כושר'] }, e);
  nextModelText = null;
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.item.draft.name, 'גינון');
  assert.equal(out.item.draft.traits[0].starter.cue, 'אני קם', 'strips the "אחרי ש" prefix');
  assert.ok(upstream.at(-1).body.messages[0].content.includes('עגבניות'));
});
await t('invalid draft from the model is refused', async () => {
  const e = kvEnv();
  await call({ goal: 'אני רוצה לגדל עגבניות' }, { path: '/suggest', e });
  const id = JSON.parse([...e.SUGGESTIONS.m.values()][0]).id;
  nextModelText = JSON.stringify({ ...domain, traits: [] });
  const r = await admin('/admin/draft', { id }, e); nextModelText = null;
  assert.equal(r.status, 502);
});
await t('approve opens a PR with the domain and without visitor text', async () => {
  const e = kvEnv(); ghCalls = []; ghFiles = {};
  await call({ goal: 'אני רוצה לגדל עגבניות סודיות' }, { path: '/suggest', e });
  const id = JSON.parse([...e.SUGGESTIONS.m.values()][0]).id;
  const r = await admin('/admin/approve', { id, domain }, e);
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.item.status, 'approved'); assert.equal(out.item.pr.number, 7);
  assert.ok(ghFiles.extra.startsWith('/*') && ghFiles.extra.includes('window.HABIT_EXTRA = '));
  assert.ok(ghFiles.extra.includes('"gardening"'));
  const allGh = JSON.stringify(ghCalls);
  assert.ok(!allGh.includes('סודיות'), 'visitor text leaked to GitHub');
  assert.ok(ghCalls.every((c) => c.auth === 'Bearer gh-test-token'));
  // second approval of a domain with the same id gets a unique id
  await call({ goal: 'עוד בקשה על גינה' }, { path: '/suggest', e });
  const id2 = [...e.SUGGESTIONS.m.values()].map((v) => JSON.parse(v)).find((x) => x.status === 'pending').id;
  await admin('/admin/approve', { id: id2, domain }, e);
  assert.ok(ghFiles.extra.includes('"gardening-2"'));
});
await t('approve rejects a malformed domain', async () => {
  const e = kvEnv();
  await call({ goal: 'אני רוצה לגדל עגבניות' }, { path: '/suggest', e });
  const id = JSON.parse([...e.SUGGESTIONS.m.values()][0]).id;
  assert.equal((await admin('/admin/approve', { id, domain: { ...domain, id: 'Bad ID!' } }, e)).status, 400);
  assert.equal((await admin('/admin/approve', { id: 'nothex', domain }, e)).status, 404);
});
await t('reject marks the request', async () => {
  const e = kvEnv();
  await call({ goal: 'אני רוצה לגדל עגבניות' }, { path: '/suggest', e });
  const id = JSON.parse([...e.SUGGESTIONS.m.values()][0]).id;
  const out = await (await admin('/admin/reject', { id }, e)).json();
  assert.equal(out.item.status, 'rejected');
});

/* ---------- Todoist ---------- */
const TOKEN_KEY_B64 = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
const tdEnv = () => ({ ...env, TODOIST: fakeKV(), TODOIST_CLIENT_ID: 'td-client', TODOIST_CLIENT_SECRET: 'td-secret', TOKEN_KEY: TOKEN_KEY_B64 });
function nav(path, e) {
  return worker.fetch(new Request('https://w.example' + path, { headers: { 'CF-Connecting-IP': '10.2.0.' + (ip++) } }), e);
}
async function connect(e) {
  const r = await nav('/todoist/start?return=' + encodeURIComponent(ORIGIN + '/3DPrinter/?x=1#y'), e);
  const loc = new URL(r.headers.get('Location'));
  const state = loc.searchParams.get('state');
  const cb = await nav('/todoist/callback?code=good-code&state=' + state, e);
  return { start: r, loc, state, cb };
}

await t('todoist start redirects to Todoist with a single-use state', async () => {
  tdState = { projects: [], tasks: [], tokenCalls: 0, revoked: [], authSeen: [] };
  const e = tdEnv();
  const { start, loc, state, cb } = await connect(e);
  assert.equal(start.status, 302);
  assert.equal(loc.origin + loc.pathname, 'https://todoist.com/oauth/authorize');
  assert.equal(loc.searchParams.get('client_id'), 'td-client');
  assert.equal(loc.searchParams.get('scope'), 'data:read_write');
  assert.equal(cb.status, 302);
  const back = cb.headers.get('Location');
  assert.match(back, /^https:\/\/itayweiss01\.github\.io\/3DPrinter\/#todoist-[0-9a-f]{64}$/, 'returns to the site path without query');
  // state cannot be reused
  assert.equal((await nav('/todoist/callback?code=good-code&state=' + state, e)).status, 400);
});
await t('todoist start refuses return addresses outside the allowlist', async () => {
  const e = tdEnv();
  assert.equal((await nav('/todoist/start?return=' + encodeURIComponent('https://evil.example/'), e)).status, 400);
  assert.equal((await nav('/todoist/start', e)).status, 400);
});
await t('todoist callback rejects unknown state and handles denial', async () => {
  const e = tdEnv();
  assert.equal((await nav('/todoist/callback?code=good-code&state=' + 'a'.repeat(48), e)).status, 400);
  const r = await nav('/todoist/start?return=' + encodeURIComponent(ORIGIN + '/'), e);
  const state = new URL(r.headers.get('Location')).searchParams.get('state');
  const d = await nav('/todoist/callback?error=access_denied&state=' + state, e);
  assert.equal(d.headers.get('Location'), ORIGIN + '/#todoist-denied');
});
await t('todoist token is stored encrypted, never sent to the browser', async () => {
  const e = tdEnv();
  const { cb } = await connect(e);
  assert.ok(!cb.headers.get('Location').includes('TD_ACCESS_TOKEN'));
  const stored = [...e.TODOIST.m.entries()].filter(([k]) => k.startsWith('ts:'));
  assert.equal(stored.length, 1);
  assert.ok(!stored[0][1].includes('TD_ACCESS_TOKEN'), 'token stored in plain text');
});
await t('todoist add creates the project once and skips duplicates', async () => {
  tdState = { projects: [], tasks: [], tokenCalls: 0, revoked: [], authSeen: [] };
  const e = tdEnv();
  const sid = (await connect(e)).cb.headers.get('Location').split('#todoist-')[1];
  const add = (habits) => call({ sid, habits }, { path: '/todoist/add', e });
  let r = await add([{ content: 'קורא עמוד אחד', note: 'אחרי שאני נכנס למיטה' }, { content: '5 סקוואטים' }]);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { added: 2, updated: 0, skipped: 0, project: 'הרגלים' });
  r = await add([{ content: 'קורא עמוד אחד' }, { content: 'כוס מים' }]);
  assert.deepEqual(await r.json(), { added: 1, updated: 0, skipped: 1, project: 'הרגלים' });
  assert.equal(tdState.projects.length, 1);
  assert.ok(tdState.tasks.every((t) => t.due_string === 'every day' && t.due_lang === 'en' && t.project_id === 'p1'));
  assert.ok(tdState.tasks[0].description.includes('אחרי שאני נכנס למיטה'));
  assert.ok(tdState.authSeen.every((a) => a === 'Bearer TD_ACCESS_TOKEN_xyz'));
  // the level-up task is added once, due in 21 days, and a second send leaves it alone
  const up = { content: 'שלב הבא: 10 סקוואטים', note: 'כבר קל?', schedule: { freq: 'levelup' } };
  r = await add([up]);
  assert.deepEqual(await r.json(), { added: 1, updated: 0, skipped: 0, project: 'הרגלים' });
  const ut = tdState.tasks.find((t) => t.content === up.content);
  assert.equal(ut.due_string, 'in 21 days');
  ut.due = { string: 'Dec 16' }; // Todoist turns "in 21 days" into a date
  r = await add([up]);
  assert.deepEqual(await r.json(), { added: 0, updated: 0, skipped: 1, project: 'הרגלים' });
  assert.ok(!ut.updatedVia, 'not rescheduled');
});
await t('todoist schedules: days and time map to due_string, changes update the task', async () => {
  tdState = { projects: [], tasks: [], tokenCalls: 0, revoked: [], authSeen: [] };
  const e = tdEnv();
  const sid = (await connect(e)).cb.headers.get('Location').split('#todoist-')[1];
  const add = (habits) => call({ sid, habits }, { path: '/todoist/add', e });
  await add([
    { content: 'ריצה', schedule: { freq: 'days', days: [3, 0, 3], time: '18:30' } },
    { content: 'מים', schedule: { freq: 'daily', time: '07:00' } },
    { content: 'קריאה', schedule: { freq: 'days', days: [0, 1, 2, 3, 4, 5, 6] } }
  ]);
  const due = Object.fromEntries(tdState.tasks.map((t) => [t.content, t.due_string]));
  assert.deepEqual(due, { 'ריצה': 'every sun, wed at 18:30', 'מים': 'every day at 07:00', 'קריאה': 'every day' });
  const r = await (await add([{ content: 'ריצה', schedule: { freq: 'days', days: [5] } }, { content: 'מים', schedule: { freq: 'daily', time: '07:00' } }])).json();
  assert.deepEqual(r, { added: 0, updated: 1, skipped: 1, project: 'הרגלים' });
  assert.equal(tdState.tasks.find((t) => t.content === 'ריצה').due.string, 'every fri');
  assert.equal(tdState.tasks.length, 3, 'no duplicate tasks');
});
await t('todoist schedule input is validated, never passed through as text', async () => {
  const { dueString } = await import('./todoist.js');
  assert.equal(dueString({ freq: 'days', days: [9, -1, 'x'] }), 'every day');
  assert.equal(dueString({ freq: 'daily', time: '25:00' }), 'every day');
  assert.equal(dueString({ freq: 'daily', time: '07:00 every hour' }), 'every day');
  assert.equal(dueString({ freq: 'days', days: [6], time: '9:00' }), 'every sat');
  assert.equal(dueString(null), 'every day');
});
await t('todoist calls need a valid connection id and the site origin', async () => {
  const e = tdEnv();
  assert.equal((await call({ sid: 'f'.repeat(64), habits: [{ content: 'x' }] }, { path: '/todoist/add', e })).status, 401);
  assert.equal((await call({ sid: 'not-hex', habits: [{ content: 'x' }] }, { path: '/todoist/add', e })).status, 401);
  assert.equal((await call({ sid: 'f'.repeat(64), habits: [] }, { path: '/todoist/add', e, origin: 'https://evil.example' })).status, 403);
  const st = await (await call({ sid: 'f'.repeat(64) }, { path: '/todoist/status', e })).json();
  assert.equal(st.connected, false);
});
await t('todoist disconnect revokes the token and deletes it', async () => {
  tdState = { projects: [], tasks: [], tokenCalls: 0, revoked: [], authSeen: [] };
  const e = tdEnv();
  const sid = (await connect(e)).cb.headers.get('Location').split('#todoist-')[1];
  assert.equal((await (await call({ sid }, { path: '/todoist/status', e })).json()).connected, true);
  await call({ sid }, { path: '/todoist/disconnect', e });
  assert.deepEqual(tdState.revoked, ['TD_ACCESS_TOKEN_xyz']);
  assert.equal((await (await call({ sid }, { path: '/todoist/status', e })).json()).connected, false);
  assert.equal([...e.TODOIST.m.keys()].filter((k) => k.startsWith('ts:')).length, 0);
});
await t('todoist without configuration fails safely', async () => {
  assert.equal((await nav('/todoist/start?return=' + encodeURIComponent(ORIGIN + '/'), env)).status, 500);
});

await t('features reports what is configured, without secrets', async () => {
  const get = (e, origin = ORIGIN) => worker.fetch(new Request('https://w.example/features', { headers: { Origin: origin } }), e);
  assert.deepEqual(await (await get({ ALLOWED_ORIGINS: ORIGIN })).json(), { claude: false, todoist: false, suggest: false });
  const all = await (await get({ ...tdEnv(), SUGGESTIONS: fakeKV() })).json();
  assert.deepEqual(all, { claude: true, todoist: true, suggest: true });
  assert.equal((await get(env, 'https://evil.example')).status, 403);
  const text = await (await get({ ...tdEnv() })).text();
  assert.ok(!text.includes('td-secret') && !text.includes('TEST_ONLY'));
});

await t('same-origin requests from the site served by the Worker are allowed', async () => {
  const self = 'https://api.example.workers.dev';
  const e = { ...env, ALLOWED_ORIGINS: ORIGIN + ',' + self };
  const get = (headers) => worker.fetch(new Request(self + '/features', { headers }), e);
  assert.equal((await get({ 'Sec-Fetch-Site': 'same-origin' })).status, 200, 'same-origin GET without Origin');
  assert.equal((await get({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await get({})).status, 403, 'no Origin and no Sec-Fetch-Site');
  // same-origin but the Worker's own origin is not on the allowlist -> still blocked
  assert.equal((await worker.fetch(new Request(self + '/features', { headers: { 'Sec-Fetch-Site': 'same-origin' } }), env)).status, 403);
});

await t('serves the site with security headers', async () => {
  const r = await worker.fetch(new Request('https://w.example/'), env);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /text\/html/);
  assert.match(await r.text(), /<html lang="he"/);
  assert.match(r.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('X-Frame-Options'), 'DENY');
  const js = await worker.fetch(new Request('https://w.example/js/app.js'), env);
  assert.match(js.headers.get('Content-Type'), /javascript/);
  assert.equal((await worker.fetch(new Request('https://w.example/admin.html'), env)).headers.get('X-Robots-Tag'), 'noindex, nofollow');
  // source files of the Worker itself are not served
  assert.equal((await worker.fetch(new Request('https://w.example/worker.js'), env)).status, 403);
  assert.equal((await worker.fetch(new Request('https://w.example/wrangler.toml'), env)).status, 403);
});


await t('hit counts only known events, as daily totals, without IP', async () => {
  const e = kvEnv();
  const hit = (body, opt = {}) => call(body, { path: '/hit', type: 'text/plain;charset=UTF-8', e, ...opt });
  assert.equal((await hit({ f: ['v', 's2', 'built', 'td'] })).status, 204);
  assert.equal((await hit({ f: ['v', 's2', 's2', 'evil', '<script>'] })).status, 204);
  const keys = [...e.SUGGESTIONS.m.keys()].filter((k) => k.startsWith('stats:'));
  assert.equal(keys.length, 1);
  const day = JSON.parse(e.SUGGESTIONS.m.get(keys[0]));
  assert.deepEqual(day, { v: 2, s2: 2, built: 1, td: 1 });
  assert.ok(!JSON.stringify([...e.SUGGESTIONS.m.entries()]).includes('10.0.0.'), 'no IP stored');
  assert.equal((await hit({ f: ['nope'] })).status, 400);
  assert.equal((await hit('x'.repeat(500))).status, 413);
  assert.equal((await hit({ f: ['v'] }, { origin: 'https://evil.example' })).status, 403);
  // reading the totals needs the admin token
  assert.equal((await admin('/admin/stats', null, e, 'b'.repeat(40))).status, 401);
  const r = await admin('/admin/stats', null, e);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).days[0].counts.v, 2);
});

await t('level-up task: due in 21 days, never rescheduled on a second send', async () => {
  const { dueString } = await import('./todoist.js');
  assert.equal(dueString({ freq: 'levelup', time: '07:00' }), 'in 21 days');
  assert.equal(dueString({ freq: 'levelup; drop', days: [1] }), 'every day', 'unknown freq is not passed through');
});

console.log(results.map((n) => 'ok - ' + n).join('\n'));
console.log(`\n${results.length} passed`);
