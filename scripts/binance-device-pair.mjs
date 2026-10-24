import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {createDevicePairCode} from '../lib/binance-device-auth.mjs';
let env={};
try{const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(row=>{const i=row.indexOf('=');return [row.slice(0,i),row.slice(i+1)];}));}catch{}
const file=process.env.BINANCE_DEVICE_AUTH_FILE||env.BINANCE_DEVICE_AUTH_FILE||(env.BINANCE_TRADE_CONTROL_FILE||'/var/data/binance-trade-control.json')+'.devices.json';
const reusable=process.argv.includes('--permanent'),code=process.argv.includes('--code-stdin')?fs.readFileSync(0,'utf8').trim():undefined;
const pairing=createDevicePairCode(file,{reusable,code});
console.log(reusable?'\nקוד חיבור קבוע הוגדר. אותו קוד מתאים למכשירים נוספים.':'\nקוד חיבור חד־פעמי למכשיר: '+pairing.code);
if(reusable&&code===undefined)console.log('קוד קבוע: '+pairing.code);
if(!reusable)console.log('תקף עד: '+new Date(pairing.expiresAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}));
console.log('באפליקציה: לחץ ״חבר מכשיר למסחר״ והזן את שש הספרות. אין צורך בקוד בן 32 תווים.\n');
