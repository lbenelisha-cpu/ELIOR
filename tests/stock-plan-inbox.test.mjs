import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStockPlanInbox } from '../netlify/functions/stock-plan-inbox.mjs';
import { deviceStoreName, pairDevice } from '../lib/colmex-device-access.mjs';

const api = 'https://stock.test/.netlify/functions/stock-plan-inbox';
const prod = { deploy: { context: 'production' } };
const env = { CONTEXT: 'production', COLMEX_API_LOGIN: 'example', COLMEX_API_PASSWORD: 'example',
  COLMEX_AUTO_ACCOUNT_ID: '123', COLMEX_DEVICE_PAIR_CODE: '123456' };
const alert = `LEVI · איתות לבדיקה ידנית · NYSE:ORCL · LONG
סגירת נר 5 דקות: 2026-11-13 15:55 (ניו יורק)
מחיר ייחוס: 125.00 USD · סטופ התחלתי: 123.75 (1%)
יעד מימוש: 187.50 (50%)
הפעלת הגנה לפי ממוצע 5 גלים: 127.13 (1.7% מהכניסה)
אחרי ההפעלה: מרחק סטופ של 1.25 USD מתחת לשיא (1 נקודות אחוז ממחיר הכניסה)`;

function memoryStore() {
  const blobs = new Map();
  return {
    get: async key => blobs.get(key)?.data ?? null,
    getWithMetadata: async key => blobs.get(key) ?? null,
    async setJSON(key, data, { onlyIfNew = false, onlyIfMatch } = {}) {
      const old = blobs.get(key);
      if ((onlyIfNew && old) || (onlyIfMatch && old?.etag !== onlyIfMatch)) return { modified: false };
      const etag = String(Number(old?.etag ?? 0) + 1);
      blobs.set(key, { data, etag });
      return { modified: true, etag };
    },
  };
}

async function setup() {
  const stores = new Map();
  const storeFactory = name => {
    if (!stores.has(name)) stores.set(name, memoryStore());
    return stores.get(name);
  };
  const { token } = await pairDevice(storeFactory(deviceStoreName), env, env.COLMEX_DEVICE_PAIR_CODE);
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', origin: new URL(api).origin };
  const handle = makeStockPlanInbox({ env, storeFactory });
  const read = () => handle(new Request(api, { headers }), prod);
  const connect = () => handle(new Request(api, { method: 'POST', headers, body: JSON.stringify({ action: 'webhook' }) }), prod);
  const send = (url, body) => handle(new Request(url, { method: 'POST', body }), prod);
  return { headers, handle, read, connect, send, storeFactory };
}

test('only a production paired device may read plans or provision the same-origin webhook', async () => {
  const { headers, handle, read, connect } = await setup();
  assert.equal((await handle(new Request(api), prod)).status, 401);
  assert.equal((await handle(new Request(api, { headers }), { deploy: { context: 'deploy-preview' } })).status, 401);
  assert.equal((await handle(new Request(api, { method: 'POST', headers: { ...headers, origin: 'https://other.test' }, body: '{"action":"webhook"}' }), prod)).status, 403);
  assert.deepEqual(await (await read()).json(), { connected: false, plans: [] });
  const [a, b] = await Promise.all([connect(), connect()]);
  const { url } = await a.json();
  assert.equal((await b.json()).url, url);
  assert.match(new URL(url).searchParams.get('key'), /^[a-f0-9]{64}$/);
  assert.deepEqual(await (await read()).json(), { connected: true, plans: [] });
  assert.equal((await handle(new Request(url), prod)).status, 405);
});

test('parallel receipts preserve both symbols; duplicates and old alerts cannot regress the inbox', async () => {
  const { connect, read, send } = await setup();
  const { url } = await (await connect()).json();
  const replies = await Promise.all([send(url, alert), send(url, alert.replace('ORCL', 'XYZ'))]);
  for (const response of replies) assert.deepEqual(await response.json(), { ok: true });
  for (const message of [alert, alert.replace('15:55', '15:50')]) assert.equal((await send(url, message)).status, 200);
  const result = await (await read()).json();
  assert.deepEqual(result.plans.map(p => p.symbol).sort(), ['NYSE:ORCL', 'NYSE:XYZ']);
  assert.equal(result.plans[0].barTime, '2026-11-13 15:55');
  assert.equal(result.plans.find(p => p.symbol === 'NYSE:ORCL').stop, 123.75);
  assert.equal(JSON.stringify(result).includes(new URL(url).searchParams.get('key')), false);
});

test('write credentials are account-bound and reject unrelated or oversized messages', async () => {
  const { connect, read, send, storeFactory } = await setup();
  const { url } = await (await connect()).json();
  const other = makeStockPlanInbox({ env: { ...env, COLMEX_AUTO_ACCOUNT_ID: '124' }, storeFactory });
  assert.equal((await other(new Request(url, { method: 'POST', body: alert }), prod)).status, 401);
  assert.equal((await send(api + '?key=123', alert)).status, 401);
  assert.equal((await send(api + '?key=' + '0'.repeat(64), alert)).status, 401);
  assert.deepEqual(await (await send(url, 'unrelated private content')).json(), { error: 'INVALID_STOCK_ALERT' });
  assert.equal((await send(url, 'x'.repeat(8193))).status, 413);
  assert.deepEqual((await (await read()).json()).plans, []);
});
