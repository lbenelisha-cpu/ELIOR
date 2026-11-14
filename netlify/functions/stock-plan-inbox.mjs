import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { runtimeEnvironment } from '../../lib/colmex-auto-policy.mjs';
import { deviceConfigured, deviceStoreName, requireDevice, sameOrigin } from '../../lib/colmex-device-access.mjs';
import { mergeStockAlert, parseStockAlert } from '../../stock-alert-plan.js';

const inboxStoreName = 'levi-manual-stock-alerts-v1';
const tokenPattern = /^[a-f0-9]{64}$/;
const maxBodyBytes = 8192;
const json = (status, data) => Response.json(data, {
  status, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
});

async function openStore(name) {
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name, consistency: 'strong' });
}

function inboxKey(env) {
  const authority = [env.COLMEX_API_LOGIN, env.COLMEX_API_PASSWORD, env.COLMEX_AUTO_ACCOUNT_ID];
  return 'account-' + createHash('sha256').update(authority.join('\0')).digest('hex');
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > maxBodyBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return Buffer.concat(chunks).toString('utf8');
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

async function getWebhook(store, key, requestUrl) {
  let saved = await store.get(key, { type: 'json' });
  if (!saved) {
    const candidate = { token: randomBytes(32).toString('hex'), plans: [] };
    const result = await store.setJSON(key, candidate, { onlyIfNew: true });
    saved = result.modified ? candidate : await store.get(key, { type: 'json' });
  }
  if (!tokenPattern.test(saved?.token)) return json(503, { error: 'INBOX_UNAVAILABLE' });
  const url = new URL('/.netlify/functions/stock-plan-inbox', requestUrl);
  url.searchParams.set('key', saved.token);
  return json(200, { url: url.href });
}

async function receiveAlert(request, store, key, suppliedToken) {
  if (!tokenPattern.test(suppliedToken)) return json(401, { error: 'WEBHOOK_REQUIRED' });
  let plan;
  for (let attempt = 0; attempt < 6; attempt++) {
    const saved = await store.getWithMetadata(key, { type: 'json' });
    const current = saved?.data;
    if (!tokenPattern.test(current?.token) ||
        !timingSafeEqual(Buffer.from(current.token), Buffer.from(suppliedToken))) {
      return json(401, { error: 'WEBHOOK_REQUIRED' });
    }
    if (!plan) {
      const body = await readBody(request);
      if (body === null) return json(413, { error: 'BODY_TOO_LARGE' });
      plan = parseStockAlert(body);
      if (!plan) return json(400, { error: 'INVALID_STOCK_ALERT' });
    }
    const plans = mergeStockAlert(current.plans, plan);
    if (!plans.includes(plan)) return json(200, { ok: true });
    const result = await store.setJSON(key, { token: current.token, plans }, { onlyIfMatch: saved.etag });
    if (result.modified) return json(200, { ok: true });
  }
  return json(503, { error: 'RETRY_DELIVERY' });
}

export function makeStockPlanInbox({ env = process.env, storeFactory = openStore } = {}) {
  return async (request, context) => {
    const vars = runtimeEnvironment(env, context);
    const url = new URL(request.url);
    if (!['GET', 'POST'].includes(request.method)) return json(405, { error: 'METHOD_NOT_ALLOWED' });
    if (!deviceConfigured(vars)) return json(401, { error: 'DEVICE_REQUIRED' });
    try {
      const key = inboxKey(vars);
      if (url.searchParams.has('key')) {
        if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
        return await receiveAlert(request, await storeFactory(inboxStoreName), key, url.searchParams.get('key'));
      }
      await requireDevice(await storeFactory(deviceStoreName), vars, request.headers.get('authorization'));
      const store = await storeFactory(inboxStoreName);
      if (request.method === 'GET') {
        const saved = await store.get(key, { type: 'json' });
        return json(200, { plans: saved?.plans ?? [], connected: !!saved?.token });
      }
      if (!sameOrigin(request)) return json(403, { error: 'ORIGIN_REQUIRED' });
      const body = await readBody(request);
      if (body === null) return json(413, { error: 'BODY_TOO_LARGE' });
      let action;
      try { action = JSON.parse(body)?.action; } catch { /* Invalid action */ }
      if (action !== 'webhook') return json(400, { error: 'INVALID_REQUEST' });
      return await getWebhook(store, key, url);
    } catch (error) {
      if (error.code === 'DEVICE_REQUIRED') return json(401, { error: 'DEVICE_REQUIRED' });
      return json(503, { error: 'INBOX_UNAVAILABLE' });
    }
  };
}

export default makeStockPlanInbox();
