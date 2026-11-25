/* Cloudflare Worker: proxy between the site and the Claude API.
   The API key stays here (secret ANTHROPIC_API_KEY) and never reaches the browser.
   It only forwards POST /v1/messages, pins the model and caps max_tokens so the key
   can't be used for anything else. */
const API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 16000;
const MAX_BODY = 20000; // bytes

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? (origin || '*') : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') || 'content-type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    }
  };
}

function json(status, obj, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });
    if (!cors.ok) return json(403, { type: 'error', error: { type: 'permission_error', message: 'origin not allowed' } }, cors.headers);

    const url = new URL(req.url);
    if (req.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) {
      return json(404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } }, cors.headers);
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY) {
      return json(413, { type: 'error', error: { type: 'request_too_large', message: 'request too large' } }, cors.headers);
    }
    let body;
    try { body = JSON.parse(raw); } catch {
      return json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'invalid JSON' } }, cors.headers);
    }

    // Only what the site needs: one user message, JSON output, no tools.
    body.model = MODEL;
    body.max_tokens = Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS);
    delete body.tools; delete body.mcp_servers; delete body.container; delete body.stream; delete body.speed;

    const headers = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': req.headers.get('anthropic-version') || '2026-10-21'
    };
    const beta = req.headers.get('anthropic-beta');
    if (beta) headers['anthropic-beta'] = beta;

    const res = await fetch(API + url.search, { method: 'POST', headers, body: JSON.stringify(body) });
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors.headers)) out.headers.set(k, v);
    return out;
  }
};
