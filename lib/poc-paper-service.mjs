import {PocPaperLedger} from './poc-paper-ledger.mjs';
import {findPocSetup} from './poc-paper-strategy.mjs';

// Capabilities are read functions, never an exchange client with write methods.
export class PocPaperService{
 constructor({file,spotAccount,futuresGet,spotGet,symbols,now=Date.now,ledger}){
  Object.assign(this,{spotAccount,futuresGet,spotGet,symbols,now});this.ledger=ledger||new PocPaperLedger({file,now});
  this.shortSymbols=[];this.scanned=new Map();this.busy={};this.cursor=0;this.errors={};this.scanAt=null;this.timers=[];
 }
 async accounts(){
  if(this.busy.accounts)return;this.busy.accounts=true;
  try{
   const at=this.now(),result=await Promise.allSettled([this.spotAccount(),this.futuresGet('/fapi/v2/account')]);
   const spot=result[0].status==='fulfilled'?result[0].value:null,future=result[1].status==='fulfilled'?result[1].value:null,usdt=future?.assets?.find(a=>a.asset==='USDT');
   const numeric=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
   const validSpot=spot?.connected===true&&Array.isArray(spot.balances)&&!spot.unpricedAssets?.length&&spot.balances.every(b=>numeric(b.qty)&&numeric(b.usdtPrice)&&(Number(b.qty)===0||Number(b.usdtPrice)>0));
   const validFuture=!!usdt&&future.multiAssetsMargin===false&&[usdt.walletBalance,usdt.unrealizedProfit,usdt.availableBalance].every(numeric);
   this.ledger.balances({LONG:validSpot?{equity:spot.totalValueUsdt,free:spot.usdtFree,at:Date.parse(spot.updatedAt),complete:true}:null,SHORT:validFuture?{equity:Number(usdt.walletBalance)+Number(usdt.unrealizedProfit),free:Number(usdt.availableBalance),at,complete:true}:null});
   for(const [i,side] of ['LONG','SHORT'].entries())this.errors[side+'Account']=this.ledger.live[side]?null:result[i].status==='rejected'?'ACCOUNT_READ_FAILED':'ACCOUNT_INCOMPLETE';
  }finally{this.busy.accounts=false;}
 }
 async markets(){
  if(this.busy.markets)return;this.busy.markets=true;
  try{
   const [info,tickers]=await Promise.all([this.futuresGet('/fapi/v1/exchangeInfo'),this.futuresGet('/fapi/v1/ticker/24hr')]);
   if(!Array.isArray(info?.symbols)||!Array.isArray(tickers))throw Error('INVALID_MARKETS');
   const allowed=new Set(info.symbols.filter(s=>s.status==='TRADING'&&s.quoteAsset==='USDT'&&s.marginAsset==='USDT'&&s.contractType==='PERPETUAL'&&!['USDT','USDC','FDUSD','TUSD','DAI','USDP','USD1','USDE'].includes(s.baseAsset)).map(s=>s.symbol));
   this.shortSymbols=tickers.filter(t=>allowed.has(t.symbol)&&Number(t.quoteVolume)>0).sort((a,b)=>Number(b.quoteVolume)-Number(a.quoteVolume)).slice(0,50).map(t=>t.symbol);this.errors.markets=null;
  }catch{this.errors.markets='FUTURES_UNIVERSE_UNAVAILABLE';}finally{this.busy.markets=false;}
 }
 async scan(){
  if(this.busy.scan||this.ledger.fatal)return;this.busy.scan=true;
  try{
   const bucket=Math.floor(this.now()/300000),lists={LONG:this.symbols().filter(s=>/^[A-Z0-9]{2,25}USDT$/.test(s)).slice(0,60),SHORT:this.shortSymbols};
   for(const side of ['LONG','SHORT']){
    if(!this.ledger.state.accounts[side])continue;
    const list=lists[side],symbol=list.find(s=>this.scanned.get(side+':'+s)!==bucket);if(!symbol)continue;
    // Stamp before I/O: a failing market is retried next candle, not hammered every second.
    this.scanned.set(side+':'+symbol,bucket);
    try{
     const rows=side==='LONG'?await this.spotGet('/api/v3/klines?'+new URLSearchParams({symbol,interval:'1m',limit:'260'})):await this.futuresGet('/fapi/v1/klines',{symbol,interval:'1m',limit:260});
     const setup=findPocSetup(rows,symbol,side,this.now());this.ledger.setup(side,symbol,setup);this.errors[side+':'+symbol]=null;this.scanAt=this.now();
    }catch(e){this.ledger.setup(side,symbol,null);this.errors[side+':'+symbol]=['HISTORY_GAP','HISTORY_INVALID'].includes(e.message)?e.message:'HISTORY_UNAVAILABLE';}
   }
   for(const key of this.scanned.keys())if(!lists[key.startsWith('LONG:')?'LONG':'SHORT'].includes(key.split(':')[1])){this.scanned.delete(key);delete this.errors[key];}
   // A rotated-out candidate cannot open. Existing paper holdings keep getting quotes.
   for(const side of ['LONG','SHORT'])for(const symbol of Object.keys(this.ledger.state.accounts[side]?.pending||{}))if(!lists[side].includes(symbol))this.ledger.setup(side,symbol,null);
  }finally{this.busy.scan=false;}
 }
 async quotes(){
  if(this.busy.quotes||this.ledger.fatal)return;this.busy.quotes=true;
  try{
   const at=this.now(),results=await Promise.allSettled(['LONG','SHORT'].map(side=>!this.ledger.state.accounts[side]?Promise.resolve([]):side==='LONG'?this.spotGet('/api/v3/ticker/bookTicker'):this.futuresGet('/fapi/v1/ticker/bookTicker'))),quotes={};
   for(const [i,side] of ['LONG','SHORT'].entries()){
    const r=results[i],rows=r.status==='fulfilled'&&Array.isArray(r.value)?r.value:null;this.errors[side+'Quotes']=rows?null:'QUOTES_UNAVAILABLE';
    quotes[side]=Object.fromEntries((rows||[]).map(q=>[q.symbol,{bid:q.bidPrice,ask:q.askPrice,at:side==='LONG'?at:q.time}]));
   }
   this.ledger.observe(quotes);
  }finally{this.busy.quotes=false;}
 }
 snapshot(){return {...this.ledger.snapshot(),scanAt:this.scanAt,scanCount:{LONG:this.symbols().length,SHORT:this.shortSymbols.length},issues:Object.entries(this.errors).filter(([,v])=>v).map(([source,reason])=>({source,reason})).slice(0,120)};}
 start(){
  const safe=fn=>()=>{Promise.resolve().then(()=>fn.call(this)).catch(()=>{});};
  safe(this.accounts)();safe(this.markets)();
  for(const [fn,ms] of [[this.accounts,60000],[this.markets,300000],[this.scan,1000],[this.quotes,5000]]){const timer=setInterval(safe(fn),ms);timer.unref?.();this.timers.push(timer);}
 }
 stop(){for(const t of this.timers)clearInterval(t);this.timers=[];}
}
