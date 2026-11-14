import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStockAlert, parseStockAlert } from '../stock-alert-plan.js';

const alert = `LEVI · איתות לבדיקה ידנית · NYSE:ORCL · LONG
סגירת נר 5 דקות: 2026-11-13 15:55 (ניו יורק)
מחיר ייחוס: 125.00 USD · סטופ התחלתי: 123.75 (1%)
יעד מימוש: 187.50 (50%)
הפעלת הגנה לפי ממוצע 5 גלים: 127.13 (1.7% מהכניסה)
אחרי ההפעלה: מרחק סטופ של 1.25 USD מתחת לשיא (1 נקודות אחוז ממחיר הכניסה)
הביצוע ועדכון הסטופ ידניים. יש לחשב את הרמות לפי מחיר הביצוע בפועל.`;

test('recognizes stock alert messages copied from TradingView with their reported values and NY time', () => {
  const expected = {
    symbol: 'NYSE:ORCL', side: 'LONG', barTime: '2026-11-13 15:55',
    reference: 125, stop: 123.75, stopPct: 1, target: 187.5, targetPct: 50,
    activation: 127.13, activationPct: 1.7, trail: 1.25, trailPp: 1,
  };
  assert.deepEqual(parseStockAlert(alert), expected);
  assert.deepEqual(parseStockAlert('TradingView Alert:\r\n' + alert.replaceAll('\n', '  ').replace('NYSE', '\u200eNYSE')), expected);
  assert.deepEqual(parseStockAlert(alert.split('\n').slice(0, -1).join('\r\n')), expected);
});

test('recognizes short alerts and preserves the exchange and punctuation in share class tickers', () => {
  const short = alert.replace('NYSE:ORCL', 'NYSE:BRK.B').replace('LONG', 'SHORT')
    .replace('123.75', '126.25').replace('187.50', '62.50').replace('127.13', '122.87')
    .replace('מתחת לשיא', 'מעל לשפל');
  assert.deepEqual(parseStockAlert(short), {
    symbol: 'NYSE:BRK.B', side: 'SHORT', barTime: '2026-11-13 15:55',
    reference: 125, stop: 126.25, stopPct: 1, target: 62.5, targetPct: 50,
    activation: 122.87, activationPct: 1.7, trail: 1.25, trailPp: 1,
  });
});

test('rejects incomplete, malformed and self-contradictory alerts', () => {
  for (const invalid of [
    null, '', 'NYSE:ORCL · LONG', alert.split('\n').slice(0, 5).join('\n'),
    alert.replace('2026-11-13', '2026-02-30'), alert.replace('15:55', '25:55'),
    alert.replace('125.00 USD', '0 USD'), alert.replace('1.7%', 'NaN%'),
    alert.replace('NYSE:', 'BINANCE:'), alert.replace('LONG', 'SHORT'),
    alert.replace('מתחת לשיא', 'מעל לשפל'), alert.replace('123.75', '130.00'),
    alert.replace('1.7%', '90%'), alert + '\n' + alert,
  ]) assert.equal(parseStockAlert(invalid), null);
});

test('keeps at most the newest 50 symbols by reported alert time and never mutates the prior list', () => {
  const plan = parseStockAlert(alert);
  const old = { ...plan, barTime: '2026-11-12 10:00' };
  const rows = Object.freeze([old]);
  assert.deepEqual(mergeStockAlert(rows, plan), [plan]);
  assert.deepEqual(rows, [old]);
  assert.deepEqual(mergeStockAlert([plan], old), [plan]);
  assert.deepEqual(mergeStockAlert([plan], { ...plan }), [plan]);
  const others = Array.from({ length: 50 }, (_, i) => ({ ...old, symbol: `NYSE:X${i}` }));
  const merged = mergeStockAlert(others, plan);
  assert.equal(merged.length, 50);
  assert.equal(merged[0], plan);
});
