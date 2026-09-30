import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const allowedTools=new Set(['get_trading_account_info','get_trading_open_positions']);
export function checkRequest(req,port){
  if(req.headers.host!==`127.0.0.1:${port}`)return false;
  const navigation = req.method==='GET' && req.headers['sec-fetch-mode']==='navigate' && req.headers['sec-fetch-dest']==='document' && ['/', '/mt5', '/mt5.html'].includes((req.url||'').split('?')[0]);
  if(navigation)return true;
  if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`)return false;
  if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return false;
  return true;
}
export class MT5Client {
  constructor(token,url='http://127.0.0.1:22346/mcp'){
    if(!token)throw Error('MT5_MCP_TOKEN is required');
    const u=new URL(url);if(u.hostname!=='127.0.0.1'||u.protocol!=='http:'||u.pathname!=='/mcp')throw Error('Only local MT5 MCP is supported');
    this.token=token;this.url=url;this.id=0;
  }
  async rpc(method,params,notification=false){
    const headers={Authorization:`Bearer ${this.token}`,Accept:'application/json, text/event-stream','Content-Type':'application/json'};
    if(this.session)headers['Mcp-Session-Id']=this.session;
    const response=await fetch(this.url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:++this.id}),method,...(params?{params}:{})}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error(`MT5_HTTP_${response.status}`);
    if(response.headers.get('Mcp-Session-Id'))this.session=response.headers.get('Mcp-Session-Id');
    if(notification){await response.text();return;}
    const text=await response.text();
    const data=response.headers.get('content-type')?.includes('text/event-stream')?JSON.parse(text.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).find(l=>{try{return JSON.parse(l).id===this.id;}catch{return false;}})||'{}'):JSON.parse(text);
    if(data.error||!data.result)throw Error('MT5_RPC_ERROR');return data.result;
  }
  async connect(){await this.rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'LEVI read-only bridge',version:'1.0'}});await this.rpc('notifications/initialized',undefined,true);}
  async call(name){
    if(!allowedTools.has(name))throw Error('Read-only tool required');
    const r=await this.rpc('tools/call',{name,arguments:{}});if(r.isError)throw Error('MT5_TOOL_ERROR');
    return JSON.parse(r.content?.find(c=>c.type==='text')?.text||'{}');
  }
  async snapshot(){
    await this.connect();const info=await this.call('get_trading_account_info');
    const a=info.account||{},t=info.terminal||{},connected=t.server_connected===true;
    const p=connected?await this.call('get_trading_open_positions'):null;
    return {receivedAt:new Date().toISOString(),connected,readOnly:true,account:{login:a.login,server:a.server,type:a.type,currency:a.currency,balance:connected?a.balance:null,equity:connected?a.equity:null,profit:connected?a.profit:null},positions:connected?p:null};
  }
}
export function createBridge(client,port=22348){
  const secret=randomBytes(32).toString('hex');let busy=false;
  const send=(res,status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(type==='application/json'?JSON.stringify(data):data);};
  const server=http.createServer(async(req,res)=>{
    if(!checkRequest(req,port))return send(res,403,{error:'Local access only'});
    const path=new URL(req.url,`http://127.0.0.1:${port}`).pathname;
    if(req.method!=='GET')return send(res,405,{error:'Read-only connection'});
    if(path==='/api/session')return send(res,200,{session:secret});
    if(path==='/api/account'){
      const supplied=Buffer.from(req.headers['x-elior-session']||''),expected=Buffer.from(secret);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(res,401,{error:'Open the local LEVI page'});
      if(busy)return send(res,429,{error:'A refresh is already running'});
      busy=true;try{return send(res,200,await client.snapshot());}catch{return send(res,503,{error:'לא ניתן לקרוא מ־MT5. בדוק שהתוכנה פתוחה ושהמפתח תקין.'});}finally{busy=false;}
    }
    const assets={'/mt5':['../mt5.html','text/html; charset=utf-8'],'/':['../mt5.html','text/html; charset=utf-8'],'/mt5.html':['../mt5.html','text/html; charset=utf-8'],'/mt5-panel.js':['../mt5-panel.js','text/javascript; charset=utf-8'],'/mt5.css':['../mt5.css','text/css; charset=utf-8']};
    if(!assets[path])return send(res,404,{error:'Not found'});
    try{const [file,type]=assets[path];send(res,200,await readFile(new URL(file,import.meta.url)),type);}catch{send(res,500,{error:'Page unavailable'});}
  });return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const port=22348;const client=new MT5Client(process.env.MT5_MCP_TOKEN,process.env.MT5_MCP_URL);
  createBridge(client,port).listen(port,'127.0.0.1',()=>console.log(`LEVI MT5: http://127.0.0.1:${port}/mt5.html (read-only)`));
}




