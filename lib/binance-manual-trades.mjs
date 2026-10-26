import fs from 'node:fs';import path from 'node:path';
import {TRAILING_EXIT_POLICY} from './trailing-profit-exit.mjs';
export function manualTradeInput(body){
 if(body?.mode!=='live')throw Error('פעולות ידניות זמינות במצב LIVE בלבד');
 if(!/^[a-zA-Z0-9_-]{16,64}$/.test(body.requestId||''))throw Error('מזהה בקשה חסר או לא תקין');
 if(!['BUY','SELL'].includes(body.side)||!/^[A-Z0-9]+USDT$/.test(body.symbol||''))throw Error('מטבע או סוג פעולה אינם תקינים');
 if(body.side==='SELL'&&body.all!==true)throw Error('יש לאשר מכירת כל הכמות הזמינה');
 const amount=body.side==='BUY'?Number(body.quoteUsdt):null;
 if(body.side==='BUY'&&(!['string','number'].includes(typeof body.quoteUsdt)||!Number.isFinite(amount)||amount<=0))throw Error('יש להזין סכום קנייה חיובי ב־USDT');
 return {requestId:body.requestId,mode:'live',side:body.side,symbol:body.symbol,quoteUsdt:amount,all:body.side==='SELL',statusOnly:body.statusOnly===true};
}
export function manualBuyAmount(amount,account,info,{maxOrderUsdt=400,maxPositions=5}={}){
 if(!Number.isFinite(amount)||amount<5)throw Error('סכום הקנייה חייב להיות לפחות 5 USDT');
 if(amount>maxOrderUsdt)throw Error('הסכום גבוה מתקרת הקנייה בשרת: '+maxOrderUsdt+' USDT');
 const held=(account.balances||[]).filter(b=>!['USDT','USDC'].includes(b.asset)&&Number(b.valueUsdt)>=5);
 if(held.some(b=>b.asset+'USDT'===info.symbol))throw Error('כבר קיימת פוזיציה במטבע הזה; קנייה ידנית פותחת פוזיציה חדשה');
 if(held.length>=maxPositions)throw Error('כל מקומות הפוזיציות תפוסים');
 if(!(Number(account.usdtFree)>=amount*1.002))throw Error('אין יתרת USDT מספקת לסכום שבחרת ולעמלות');
 return amount;
}
export function manualPosition(){return {strategyId:'WYCKOFF_5M_V1',timeframe:'5m',entryMode:'manual',entrySource:'MANUAL',exitPolicy:TRAILING_EXIT_POLICY,minProfitHoldMs:0,takeProfitPct:50,profitActivationPct:5,trailingGapPp:1,stopLossPct:1,atrEnabled:false};}
// Derive integer units from decimal strings; never round a wallet quantity up.
export function manualSellQuantity(balance,info){
 const free=Number(balance?.free);if(!(free>0)||!Number.isFinite(free))throw Error('אין כמות זמינה למכירה');
 const filters=(info.filters||[]).filter(f=>['LOT_SIZE','MARKET_LOT_SIZE'].includes(f.filterType));
 const precision=Math.max(Number(info.baseAssetPrecision)||8,...filters.map(f=>{const s=String(f.stepSize||'0');return (s.split('.')[1]||'').replace(/0+$/,'').length;}));
 const factor=10n**BigInt(precision),units=value=>{const text=String(value).toLowerCase().replace(/^\./,'0.');if(!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/.test(text))throw Error('INVALID_QUANTITY_FORMAT');const [coefficient,exponent='0']=text.split('e'),[whole,frac='']=coefficient.split('.'),digits=BigInt(whole+frac),shift=precision+Number(exponent)-frac.length;return shift>=0?digits*10n**BigInt(shift):digits/(10n**BigInt(-shift));};
 const gcd=(a,b)=>b?gcd(b,a%b):a,lcm=(a,b)=>a/gcd(a,b)*b;
 let step=1n;for(const f of filters)if(Number(f.stepSize)>0){const s=units(f.stepSize);if(s>0n)step=lcm(step,s);}
 const quantityUnits=units(free)/step*step,qty=Number(quantityUnits)/Number(factor);
 if(!(qty>0)||qty>free)throw Error('הכמות קטנה מגודל היחידה המותר בבייננס');
 for(const f of filters){if(Number(f.minQty)>0&&qty<Number(f.minQty))throw Error('הכמות קטנה ממינימום המכירה בבייננס');if(Number(f.maxQty)>0&&qty>Number(f.maxQty))throw Error('הכמות גבוהה מהמקסימום לפקודת שוק אחת');}
 const minimum=Math.max(0,...(info.filters||[]).filter(f=>f.filterType==='MIN_NOTIONAL'&&f.applyToMarket!==false||f.filterType==='NOTIONAL'&&f.applyMinToMarket!==false).map(f=>Number(f.minNotional)||0));
 if(!(Number(balance.usdtPrice)>0))throw Error('אין מחיר עדכני לבדיקת סכום המכירה');
 if(qty*Number(balance.usdtPrice)<minimum)throw Error('שווי הכמות קטן ממינימום המכירה בבייננס');
 const raw=quantityUnits.toString().padStart(precision+1,'0');return precision?raw.slice(0,-precision)+'.'+raw.slice(-precision):raw;
}
export class ManualTradeRequests{
 constructor(file){this.file=file;this.rows={};if(fs.existsSync(file))this.rows=JSON.parse(fs.readFileSync(file,'utf8'));}
 save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.rows),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
 async execute(input,{submit,reconcile,isUncertain}){
  const key=input.requestId,fingerprint=JSON.stringify([input.side,input.symbol,input.quoteUsdt,input.all]),old=this.rows[key];
  if(!old&&input.statusOnly)return {ok:false,uncertain:true,requestId:key,error:'לא נמצאה בקשה שמורה. בדיקת מצב אינה שולחת פקודה חדשה.'};
  if(old){
   if(old.fingerprint!==fingerprint)throw Error('מזהה הבקשה כבר שייך לפעולה אחרת');
   if(old.result)return {...old.result,duplicate:true};
   try{const result=await reconcile(input);if(result){this.rows[key]={...old,result};this.save();return {...result,duplicate:true};}}catch{}
   return {ok:false,uncertain:true,error:'הבקשה כבר נשלחה או נבדקת. לא נשלחה פקודה נוספת; בדוק את היומן ואת מצב ההזמנה.'};
  }
  this.rows[key]={fingerprint,input,at:Date.now()};this.save();
  try{const order=await submit(input),result={ok:true,order,requestId:key};this.rows[key].result=result;this.save();return result;}
  catch(error){
   if(this.rows[key].result?.ok)return this.rows[key].result;
   const uncertain=!!isUncertain(input);const result={ok:false,uncertain,error:uncertain?'תוצאת הפקודה טרם אומתה. אין לשלוח שוב; לחץ בדוק מצב בקשה.':error.message,requestId:key};
   if(!uncertain){this.rows[key].result=result;this.save();}return result;
  }
 }
}
