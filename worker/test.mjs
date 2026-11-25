// Security tests for the Worker. The Claude API is stubbed; no key or network needed.
import assert from 'node:assert/strict';
import worker from './worker.js';

const ORIGIN = 'https://itayweiss01.github.io';
const env = { ANTHROPIC_API_KEY: 'sk-ant-test-secret-DO-NOT-LEAK', ALLOWED_ORIGINS: ORIGIN };
const plan = { unsafe: false, message: '', identity: 'אני אדם ש...', domains: [], traits: [], avoid: '', first_step: '' };

let upstream = [];
let upstreamStatus = 200;
globalThis.fetch = async (url, init) => {
  const req = new Request(url, init);
  upstream.push({ url: req.url, headers: Object.fromEntries(req.headers), body: init.body ? JSON.parse(init.body) : null });
  if (upstreamStatus !== 200) {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key sk-ant-test-secret' } }), { status: upstreamStatus, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(plan) }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};

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
  assert.ok(!text.includes('sk-ant'), 'key leaked'); assert.ok(!text.includes('x-api-key'));
  assert.deepEqual(JSON.parse(text), { error: 'upstream' });
});
await t('missing key returns not_configured without calling upstream', async () => {
  const r = await call(ok, { e: { ALLOWED_ORIGINS: ORIGIN } });
  assert.equal(r.status, 500); assert.equal(upstream.length, 0);
});

console.log(results.map((n) => 'ok - ' + n).join('\n'));
console.log(`\n${results.length} passed`);
