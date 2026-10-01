import {prepareOrder} from './monitor.mjs';
import {LiveFileClient,validateLiveSnapshot} from './live-client.mjs';
import {readFile,writeFile,access,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
export function validateOrder(snapshot,input,now=Date.now()/1000){
 if(!snapshot.connected||!snapshot.executionEnabled)throw Error('יש להפעיל ביצוע מאושר במחבר MT4');
 if(!input||typeof input.symbol!=='string'||!/^[A-Za-z0-9#_.-]{1,64}$/.test(input.symbol))throw Error('סמל לא תקין');
 const quote=snapshot.quotes.find(q=>q.symbol===input.symbol);
 const order=prepareOrder(quote,input.side,input.lots,snapshot.positions,now,snapshot.quotes);
 let ticket=0;
 if(input.side==='sell'){
  const matches=snapshot.positions.filter(p=>p.type===0&&p.symbol===input.symbol);
  const position=input.ticket?matches.find(p=>p.ticket===input.ticket):matches.length===1?matches[0]:null;
  if(!position||input.lots>position.lots+1e-8)throw Error('בחר עסקת קנייה אחת לסגירה; הכמות חייבת להיות בתוך העסקה');
  ticket=position.ticket;
  const remaining=position.lots-input.lots;
  if(remaining>1e-8&&remaining<quote.minLot-1e-8)throw Error('יתרת הסגירה קטנה מהמינימום של הברוקר');
 }
 return {...order,ticket,account:'639367',executionEnabled:true};
}
const exists=async path=>{try{await access(path);return true}catch(e){if(e.code==='ENOENT')return false;throw e}};
export class OrderFileClient extends LiveFileClient{
 constructor(path){super(path);this.directory=path?dirname(path):null;}
 async snapshot(){
  const raw=JSON.parse(await readFile(this.path,'utf8'));const snapshot=validateLiveSnapshot(raw);
  snapshot.executionEnabled=raw.executionEnabled===true;snapshot.readOnly=!snapshot.executionEnabled;
  try{snapshot.lastOrder=JSON.parse(await readFile(join(this.directory,'LEVI_order_result.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')snapshot.lastOrder={status:'unknown',message:'לא ניתן לקרוא תוצאת עסקה; בדוק ב־MT4'};}
  snapshot.orderPending=await exists(join(this.directory,'LEVI_order_command.csv'))||await exists(join(this.directory,'LEVI_order_processing.csv'))||await exists(join(this.directory,'LEVI_order_lock'));
  return snapshot;
 }
 async submit(order,id){
  if(!this.directory)throw Error('נתיב MT4 חסר');
  if(await exists(join(this.directory,'LEVI_order_command.csv'))||await exists(join(this.directory,'LEVI_order_processing.csv')))throw Error('פקודה קודמת ממתינה או דורשת בירור ב־MT4; אין שליחה חוזרת');
  await writeFile(join(this.directory,'LEVI_order_lock'),id,{flag:'wx',encoding:'ascii'});
  const fields=[1,id,Math.floor(Date.now()/1000),639367,order.symbol,order.side==='buy'?'BUY':'CLOSE',order.lots,order.ticket,order.price];
  const temporary=join(this.directory,'LEVI_order_command.tmp');
  // Exclusive creation keeps multiple bridge instances from publishing overlapping orders.
  await writeFile(temporary,fields.join(';')+'\r\n',{flag:'wx',encoding:'ascii'});
  await rename(temporary,join(this.directory,'LEVI_order_command.csv'));
 }
}
