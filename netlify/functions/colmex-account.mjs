import {createHash} from 'node:crypto';
import {ColmexClient} from '../../lib/colmex-client-api.mjs';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const reply=(statusCode,data)=>({statusCode,headers,body:JSON.stringify(data)});
const hash=s=>createHash('sha256').update(s).digest();
export function makeHandler({env=()=>process.env,clientFactory=options=>new ColmexClient(options)}={}){
 let localClient=null,localKey='';
 return async e=>{
  if(e.httpMethod!=='GET')return reply(405,{error:'קריאת חשבון בלבד',code:'READ_ONLY'});
  const vars=env(),login=vars.COLMEX_API_LOGIN,password=vars.COLMEX_API_PASSWORD;
  const configured=typeof login==='string'&&login.trim().length>0&&typeof password==='string'&&password.length>0;
  const q=e.queryStringParameters||{};
  if(q.action==='status')return reply(200,{version:2,readOnly:true,credentialsConfigured:configured,viewCodeRequired:false,accessMode:'public-read-only',connected:false});
  if(!configured)return reply(503,{error:'יש להגדיר בשרת COLMEX_API_LOGIN ו־COLMEX_API_PASSWORD',code:'MISSING_CREDENTIALS'});
  if(Object.keys(q).some(k=>!['action','accountId'].includes(k))||q.action&&!['snapshot'].includes(q.action))return reply(400,{error:'בקשה לא נתמכת',code:'INVALID_REQUEST'});
  if(q.accountId!==undefined&&(typeof q.accountId!=='string'||q.accountId.length>100))return reply(400,{error:'חשבון לא תקין',code:'INVALID_REQUEST'});
  const key=hash(login+'\0'+password).toString('hex');
  if(!localClient||key!==localKey){localClient=clientFactory({login:login.trim(),password});localKey=key;}
  try{return reply(200,await localClient.snapshot(q.accountId));}
  catch(e){const messages={AUTH_DENIED:'קולמקס דחתה את פרטי ההתחברות או את הרשאת ה־API. בדוק שהפרטים שייכים לחשבון TraderEvolution.',AUTH_RESPONSE:'תגובת ההתחברות אינה בפורמט הצפוי.',TOKEN_EXPIRED:'אסימון החיבור פג; נסה לרענן שוב מאוחר יותר.',ACCESS_DENIED:'לקולמקס אין הרשאה לקריאת הנתונים המבוקשים בחשבון זה.',RATE_LIMIT:'הושגה מגבלת בקשות אצל קולמקס. המתן לפני רענון נוסף.',NETWORK:'לא ניתן להגיע כעת לשרת קולמקס.',UNKNOWN_ACCOUNT:'החשבון המבוקש אינו ברשימת החשבונות הזמינים.'};const code=Object.hasOwn(messages,e?.code)?e.code:['COLUMN_SCHEMA','ROW_SCHEMA','ACCOUNT_SCHEMA','POSITION_SCHEMA','RESPONSE_SCHEMA'].includes(e?.code)?'RESPONSE_SCHEMA':'SERVICE_UNAVAILABLE';return reply(code==='UNKNOWN_ACCOUNT'?400:503,{error:messages[code]||'לא ניתן לפענח או לטעון את נתוני החשבון כעת. אין להסיק מכך שאין פוזיציות.',code,readOnly:true,connected:false});}
 };
}
export const handler=makeHandler();
