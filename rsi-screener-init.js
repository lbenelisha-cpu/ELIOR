import {createRsiScreener} from './rsi-screener.js';
const binance=document.getElementById('binanceRsiScreener');
if(binance){
 const view=createRsiScreener(binance,{scope:'מטבעות הסריקה הזמינים בשרת; ללא בקשות שוק נוספות',onSelect:symbol=>window.dispatchEvent(new CustomEvent('levi-rsi-select',{detail:symbol}))});
 window.addEventListener('levi-binance-rsi',event=>view.update((event.detail||[]).map(a=>({symbol:a.symbol,rsi:a.screenRsi,old:a.staleData===true,spring:a.strategy?.wyckoff?.phase==='SPRING'}))));
}
const colmex=document.getElementById('colmexRsiScreener');
if(colmex){
 const view=createRsiScreener(colmex,{scope:'עשר מניות סריקת שרת LIVE; מתעדכן עם הבדיקות הקיימות בשעות המסחר',onSelect:symbol=>window.dispatchEvent(new CustomEvent('levi-rsi-select',{detail:symbol}))});
 window.addEventListener('levi-colmex-rsi',event=>view.update(Object.entries(event.detail?.checks||{}).map(([symbol,check])=>({symbol,rsi:check.screenRsi,spring:check.phase==='SPRING'}))));
}
