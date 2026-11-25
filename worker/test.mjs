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
  const req = new Request(url, init);
  upstream.push({ url: req.url, headers: Object.fromEntries(req.headers), body: init.body ? JSON.parse(init.body) : null });
  if (upstreamStatus !== 200) {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key TEST_ONLY_fake_key_value_123' } }), { status: upstreamStatus, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: nextModelText || JSON.stringify(plan) }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
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
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
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

console.log(results.map((n) => 'ok - ' + n).join('\n'));
console.log(`\n${results.length} passed`);
