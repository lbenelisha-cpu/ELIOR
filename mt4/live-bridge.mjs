import http from 'node:http';
import {OrderFileClient,validateOrder} from './orders.mjs';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const allowedTools=new Set(['get_trading_account_info','get_trading_open_positions']);
export function checkRequest(req,port){
  if(req.headers.host!==`127.0.0.1:${port}`)return false;
  const navigation = req.method==='GET' && req.headers['sec-fetch-mode']==='navigate' && req.headers['sec-fetch-dest']==='document' && ['/', '/mt4', '/mt4.html'].includes((req.url||'').split('?')[0]);
  if(navigation)return true;
  if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`)return false;
  if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return false;
  return true;
}
export function createBridge(client,port=22351){
  const secret=randomBytes(32).toString('hex');let busy=false,orderBusy=false;const previews=new Map();
  const send=(res,status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(type==='application/json'?JSON.stringify(data):data);};
  const server=http.createServer(async(req,res)=>{
    if(!checkRequest(req,port))return send(res,403,{error:'Local access only'});
    const path=new URL(req.url,`http://127.0.0.1:${port}`).pathname;
    if(req.method==='POST'&&['/api/order/preview','/api/order/confirm'].includes(path)){
      const supplied=Buffer.from(req.headers['x-elior-session']||''),expected=Buffer.from(secret);
      if(req.headers.origin!==`http://127.0.0.1:${port}`||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(res,401,{error:'רענן את העמוד המקומי לפני שליחת פקודה'});
      if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'JSON required'});
      if(orderBusy)return send(res,409,{error:'פקודה אחרת נבדקת; אין שליחה חוזרת'});
      orderBusy=true;
      try{
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)throw Error('בקשה גדולה מדי');}
        const input=JSON.parse(body);const snapshot=await client.snapshot();
        if(snapshot.orderPending)throw Error('פקודה קודמת ממתינה לבירור ב־MT4');
        for(const [id,p] of previews)if(p.expires<Date.now())previews.delete(id);
        if(path==='/api/order/preview'){
          if(previews.size>=20)throw Error('יותר מדי טיוטות פתוחות');
          const order=validateOrder(snapshot,input),id=randomBytes(16).toString('hex'),expires=Date.now()+20000;
          previews.set(id,{input,order,expires});return send(res,200,{id,order,expires});
        }
        const pending=previews.get(input.id);previews.delete(input.id);
        if(!pending||pending.expires<Date.now()||input.confirm!==true)throw Error('האישור פג או כבר נוצל; בדוק מחדש את הפקודה');
        const order=validateOrder(snapshot,pending.input);
        if(Math.abs(order.price/pending.order.price-1)>.005)throw Error('המחיר השתנה ביותר מ־0.5%; נדרשת בדיקה ואישור חדש');
        await client.submit({...order,price:pending.order.price},input.id);return send(res,202,{id:input.id,status:'pending',message:'נשלחה למחבר. ממתין לתוצאה מ־MT4; אין לשלוח שוב.'});
      }catch(e){return send(res,400,{error:e.message||'שליחת הפקודה נכשלה'});}finally{orderBusy=false;}
    }
    if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
    if(path==='/api/session')return send(res,200,{session:secret});
    if(path==='/api/account'){
      const supplied=Buffer.from(req.headers['x-elior-session']||''),expected=Buffer.from(secret);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(res,401,{error:'Open the local LEVI page'});
      if(busy)return send(res,429,{error:'A refresh is already running'});
      busy=true;try{return send(res,200,await client.snapshot());}catch(e){const detail=/^MT4_(HTTP_[0-9]{3}|RPC_ERROR|TOOL_ERROR)$/.test(e.message)?e.message:'MT4_CONNECTION_ERROR';return send(res,503,{error:'ממתין לנתונים מהמחבר LEVI_Live_Connector ב־MT4. חבר אותו לגרף ובדוק שהחשבון מחובר.'});}finally{busy=false;}
    }
    const assets={'/buying-power.mjs':['./buying-power.mjs','text/javascript; charset=utf-8'],'/index.html':['../mt4.html','text/html; charset=utf-8'],'/mt4-monitor-ui.js':['../mt4-monitor-ui.js','text/javascript; charset=utf-8'],'/monitor.mjs':['./monitor.mjs','text/javascript; charset=utf-8'],'/lib/agent.mjs':['../lib/agent.mjs','text/javascript; charset=utf-8'],'/mt4-alerts.js':['../mt4-alerts.js','text/javascript; charset=utf-8'],'/mt4':['../mt4.html','text/html; charset=utf-8'],'/':['../mt4.html','text/html; charset=utf-8'],'/mt4.html':['../mt4.html','text/html; charset=utf-8'],'/mt4-panel.js':['../mt4-panel.js','text/javascript; charset=utf-8'],'/mt4.css':['../mt4.css','text/css; charset=utf-8']};
    if(!assets[path])return send(res,404,{error:'Not found'});
    try{const [file,type]=assets[path];send(res,200,await readFile(new URL(file,import.meta.url)),type);}catch{send(res,500,{error:'Page unavailable'});}
  });return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const port=Number(process.env.LEVI_BRIDGE_PORT||22352);const client=new OrderFileClient(process.env.LEVI_MT4_SNAPSHOT||join(process.env.APPDATA||'', 'MetaQuotes','Terminal','50CA3DFB510CC5A8F28B48D1BF2A5702','MQL4','Files','LEVI_live_snapshot.json'));
  createBridge(client,port).listen(port,'127.0.0.1',()=>console.log(`LEVI MT4: http://127.0.0.1:${port}/mt4.html (orders require individual user confirmation and MT4 opt-in)`));
}











