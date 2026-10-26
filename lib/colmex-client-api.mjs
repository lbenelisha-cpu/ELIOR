// Server-only adapter. The only broker POST is credentials authentication.
const BASE='https://clientapi.cglms.com/traderevolution/v1';
export class ColmexApiError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ColmexApiError(code);};
const ids=value=>typeof value==='string'&&value.length>0&&value.length<=100&&!/[\x00-\x1f]/.test(value);
function columns(panel){
 if(!Array.isArray(panel?.columns)||panel.columns.length>250)fail('COLUMN_SCHEMA');
 const list=panel.columns.map(c=>c?.id);
 if(list.some(k=>!ids(k)||!/^[-A-Za-z0-9_.]+$/.test(k)||['__proto__','constructor','prototype'].includes(k))||new Set(list).size!==list.length)fail('COLUMN_SCHEMA');
 return list;
}
export function mapRow(panel,row){
 const names=columns(panel);
 if(!Array.isArray(row)||row.length!==names.length||row.some(v=>v!==null&&!['number','string','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v)))fail('ROW_SCHEMA');
 return Object.fromEntries(names.map((n,i)=>[n,typeof row[i]==='string'?row[i].slice(0,500):row[i]]));
}
export function accountList(data){
 if(!Array.isArray(data?.accounts)||data.accounts.length>200)fail('ACCOUNT_SCHEMA');
 const result=data.accounts.map(x=>{
  const id=String(x?.id??'');if(!ids(id)||id==='.'||id==='..')fail('ACCOUNT_SCHEMA');
  return {id,name:String(x.name??id).slice(0,150),currency:String(x.currency??'').slice(0,12),type:String(x.type??'').slice(0,30),status:String(x.status??'').slice(0,60)};
 });
 if(new Set(result.map(a=>a.id)).size!==result.length)fail('ACCOUNT_SCHEMA');return result;
}
export function refreshInterval(config){
 let ms=30000;
 for(const r of config?.rateLimits||[]){
  if(!['GET_ACCOUNTS','GET_ACCOUNTS_STATE','GET_POSITIONS'].includes(r.rateLimitType))continue;
  const units={SECOND:1000,SECONDS:1000,MINUTE:60000,MINUTES:60000,HOUR:3600000,HOURS:3600000,DAY:86400000,DAYS:86400000};
  const unit=units[String(r.measure).toUpperCase()];
  if(unit&&Number(r.limit)>0&&Number(r.intervalNum)>0)ms=Math.max(ms,Math.ceil(unit*Number(r.intervalNum)/Number(r.limit))+1000);
 }
 return ms;
}
export class ColmexClient {
 constructor({login,password,fetchImpl=fetch,now=Date.now,sessionStore=null}){this.login=login;this.password=password;this.fetch=fetchImpl;this.now=now;this.sessionStore=sessionStore;this.session=0;this.token=null;this.expiry=0;this.authPending=null;this.authBlockedUntil=0;this.authBlockedCode='AUTH_DENIED';this.config=null;this.accounts=null;this.accountsAt=0;this.snapshots=new Map();this.pending=new Map();}
 async json(path,{method='GET',body,token}={}){
  // No caller-controlled URL or trading endpoint is accepted.
  const pathname=path.split('?')[0];
  if(!(path==='/authorize'&&method==='POST'||method==='GET'&&(pathname==='/config'||pathname==='/accounts'||['/quotes','/history','/sessionStatuses'].includes(pathname)||/^\/instruments\/[^/]+$/.test(pathname)||/^\/accounts\/[^/]+\/(state|positions|orders|ordersHistory|instruments)$/.test(pathname))))fail('READ_ONLY');
  let r;try{r=await this.fetch(BASE+path,{method,redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body}:{} )});}catch{fail('NETWORK');}
  if(r.status===401||r.status===403)fail(path==='/authorize'?'AUTH_DENIED':r.status===401?'TOKEN_EXPIRED':'ACCESS_DENIED');
  if(r.status===429)fail('RATE_LIMIT');if(!r.ok)fail('UPSTREAM_HTTP');
  let d;try{d=await r.json();}catch{fail('RESPONSE_SCHEMA');}
  if(d?.s==='error'){
   const message=typeof d.errmsg==='string'?d.errmsg.slice(0,1000):'';
   const code=/rate.?limit|too many|requests.*exceed|quota/i.test(message)?'RATE_LIMIT':/unauthori[sz]ed|invalid.*token|token.*(invalid|expired)|session.*expired/i.test(message)?(path==='/authorize'?'AUTH_DENIED':'TOKEN_EXPIRED'):/not connected|connection.*(not ready|not established|closed|lost)|no connection/i.test(message)?'BROKER_NOT_READY':'BROKER_ERROR_RESPONSE';
   throw Object.assign(new ColmexApiError(code),{endpoint:pathname.replace(/\/\d+(?=\/|$)/g,'/:id')});
  }
  if(d?.s!=='ok'||!d.d||typeof d.d!=='object')fail('RESPONSE_SCHEMA');return d.d;
 }
 async authorize(rejectedToken=null){
  if(this.token&&this.token!==rejectedToken&&this.expiry>this.now()+30000)return this.token;
  if(this.authPending)return this.authPending;
  if(this.now()<this.authBlockedUntil)fail(this.authBlockedCode);
  this.authPending=(async()=>{
   try{
    const authenticate=async()=>{
    const d=await this.json('/authorize',{method:'POST',body:new URLSearchParams({login:this.login,password:this.password}).toString()});
    if(typeof d.access_token!=='string'||!d.access_token||d.access_token.length>16000||/[\s"']/.test(d.access_token)||!Number.isFinite(Number(d.expiration))||Number(d.expiration)*1000<=this.now()+1000)fail('AUTH_RESPONSE');
    return {token:d.access_token,expiry:Number(d.expiration)*1000};
    };
    const next=this.sessionStore?await this.sessionStore.acquire(authenticate,rejectedToken):await authenticate();
    if(this.token!==next.token){this.config=null;this.accounts=null;this.snapshots.clear();this.session++;}
    this.token=next.token;this.expiry=next.expiry;this.authBlockedUntil=0;return this.token;
   }catch(e){this.token=null;this.expiry=0;this.authBlockedCode=e.code||'AUTH_DENIED';this.authBlockedUntil=this.now()+30000;throw e;}
  })();try{return await this.authPending;}finally{this.authPending=null;}
 }
 async get(path){
  let token=await this.authorize();
  try{return await this.json(path,{token});}catch(e){
   if(e.code==='BROKER_NOT_READY'){await new Promise(resolve=>setTimeout(resolve,350));return this.json(path,{token});}
   if(e.code!=='TOKEN_EXPIRED')throw e;
   token=await this.authorize(token);return this.json(path,{token});
  }
 }
 async getConfig(){if(!this.config)this.config=await this.get('/config');return this.config;}
 async getAccounts(interval){
  if(this.accounts&&this.now()-this.accountsAt<Math.max(60000,interval))return this.accounts;
  this.accounts=accountList(await this.get('/accounts'));this.accountsAt=this.now();return this.accounts;
 }
 async snapshot(requested){
  const key=requested??'';
  if(this.pending.has(key))return this.pending.get(key);
  const promise=this.readSnapshot(requested).catch(e=>{if(e.code==='SESSION_CHANGED')return this.readSnapshot(requested);throw e;});this.pending.set(key,promise);
  try{return await promise;}finally{this.pending.delete(key);}
 }
 async readSnapshot(requested){
  await this.authorize();const session=this.session;
  const config=await this.getConfig(),refreshAfterMs=refreshInterval(config),accounts=await this.getAccounts(refreshAfterMs);
  if(this.session!==session)fail('SESSION_CHANGED');
  let account=accounts.find(a=>a.id===requested);
  if(requested!==undefined&&!account)fail('UNKNOWN_ACCOUNT');
  if(!account&&accounts.length===1)account=accounts[0];
  const base={version:1,connected:true,readOnly:true,accounts,refreshAfterMs};
  if(!account)return {...base,selectedAccount:null,observedAt:new Date(this.now()).toISOString(),selectionRequired:accounts.length>1};
  const cached=this.snapshots.get(account.id);
  if(cached&&this.now()-cached.time<refreshAfterMs)return {...cached.data,accounts,refreshAfterMs:Math.max(1000,refreshAfterMs-(this.now()-cached.time))};
  // Config is used to map both responses; positions must never be interpreted by fixed indices.
  const [details,positions]=await Promise.all([
   this.get('/accounts/'+encodeURIComponent(account.id)+'/state'),
   this.get('/accounts/'+encodeURIComponent(account.id)+'/positions')
  ]);
  if(this.session!==session)fail('SESSION_CHANGED');
  if(!Array.isArray(positions.positions)||positions.positions.length>10000)fail('POSITION_SCHEMA');
  const state=mapRow(config.accountDetailsConfig,details.accountDetailsData);
  const rows=positions.positions.map(r=>mapRow(config.positionsConfig,r));
  const data={...base,selectedAccount:account,state,positions:rows,observedAt:new Date(this.now()).toISOString()};
  this.snapshots.set(account.id,{time:this.now(),data});return data;
 }
}
