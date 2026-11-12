import {swingProtection} from './swing-profit-protection.mjs';
import {futuresTrendHistory} from './futures-trend-history.mjs';
import {PocFastWatch} from './poc-fast-watch.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {FUTURES_SHORT_POLICY,FUTURES_SHORT_EXIT_POLICY,validateShortSettings,shortSignal,assertSameShortSignal,shortExit,shortOrderPlan,shortAllocation,roundStep} from './futures-short-policy.mjs';
import {validateTradeSettings} from './trade-settings.mjs';
import {STABLE_BASES} from './binance-quality-policy.mjs';
import {futuresFillPrice} from './futures-short-fill.mjs';
import {sharedWatchRows,SHARED_WATCH_POLICY} from './shared-market-watch.mjs';

const id=()=> 'lvs-'+randomUUID().replaceAll('-','').slice(0,28);
const yes=v=>v===true||v==='true';
const no=v=>v===false||v==='false';
const terminal=s=>['FILLED','EXPIRED','EXPIRED_IN_MATCH','CANCELED','REJECTED'].includes(s);
const definitive=e=>e.status>=400&&e.status<500&&![408,418,429].includes(e.status)&&![-1000,-1001,-1006,-1007].includes(e.code);
const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const visibilityDelays=[150,300,600,950];
const algoId=v=>(typeof v==='string'&&/^[1-9]\d*$/.test(v))||(Number.isSafeInteger(v)&&v>0);
export function atomicFuturesSave(file,state){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const fd=fs.openSync(file+'.tmp','w',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(file+'.tmp',file);
 const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
export class FuturesShortRunner{
 constructor({api,file,config,settings,control,permission,now=Date.now,save=atomicFuturesSave,initialState,reserved=()=>false,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  Object.assign(this,{api,file,config,settings,control,permission,now,saveImpl:save,sleep,reserved});
  this.config={...config,exitPolicy:FUTURES_SHORT_EXIT_POLICY};
  this.busy=false;this.forceClose=false;this.cursor=0;this.universe=[];this.infos={};this.marketAt=0;this.lastScan=0;this.lastCycle=0;this.checkedAt=null;this.error=null;this.checks={};this.accountSummary=null;
  this.state={version:FUTURES_SHORT_POLICY.version,startedAt:config.enabledAfter??now(),positions:{},pending:null,used:[],closed:[],halt:null};
  try{
   if(initialState)this.state=structuredClone(initialState);
   else if(fs.existsSync(file))this.state=JSON.parse(fs.readFileSync(file,'utf8'));
   const s=this.state;
   if(s.version!==FUTURES_SHORT_POLICY.version||!Number.isFinite(s.startedAt)||!s.positions||Array.isArray(s.positions)||!Array.isArray(s.used)||!Array.isArray(s.closed))throw Error('schema');
   for(const [symbol,p] of Object.entries(s.positions))if(p.symbol!==symbol||!(p.qty>0)||!(p.entryPrice>0)||!(p.targetPrice>0)||!Array.isArray(p.algos))throw Error('position');
  }catch{this.fatal='FUTURES_JOURNAL_UNREADABLE';}
 }
 save(){if(this.fatal)throw Error(this.fatal);try{this.saveImpl(this.file,this.state);}catch{this.fatal='FUTURES_JOURNAL_WRITE_FAILED';throw Error(this.fatal);}}
 allocation(){return shortAllocation(this.accountSummary,Object.keys(this.state.positions).length);}
 assertAllocation(amount,account=this.accountSummary){
  const a=shortAllocation(account,Object.keys(this.state.positions).length);
  if(!a.verified)throw Error('FUTURES_BALANCE_UNVERIFIED');
  if(!a.freeSlots)throw Error('FUTURES_TWO_SLOTS_FULL');
  if(!(a.maxOrderUsdt>=5))throw Error('FUTURES_ALLOCATION_INSUFFICIENT');
  if(amount!==undefined&&(!Number.isFinite(amount)||amount<5||amount>a.maxOrderUsdt))throw Error('FUTURES_AMOUNT_EXCEEDS_ALLOCATION');
  return a;
 }
 status(){return {allocation:this.allocation(),fastWatch:this.pocWatch?.snapshot(this.universe)??null,watch:this.watchSnapshot?.()??null,entryBlocker:this.watchEntryBlocker(),policy:this.config,enabled:this.config.enabled,executionReady:false,reason:this.fatal||this.state.halt||this.error||(!this.config.enabled?'FUTURES_SHORT_DISABLED':'WAIT_NEW_SHORT_SIGNAL'),checkedAt:this.checkedAt,account:this.accountSummary,positions:Object.values(this.state.positions),pending:!!this.state.pending,halt:this.state.halt,checks:this.checks,closed:this.state.closed.slice(-20),note:'Entry readiness is rechecked for each signal; enabling is not an executed trade.'};}
 watchEntryBlocker(){
  if(this.fatal||this.state.halt)return this.fatal||this.state.halt;
  if(this.forceClose)return 'FUTURES_STOP_ALL';
  if(this.state.pending)return 'FUTURES_ORDER_PENDING';
  if(!this.config.enabled)return 'FUTURES_SHORT_DISABLED';
  if(!this.control().allowEntries)return 'FUTURES_ENTRIES_PAUSED';
  if(Object.keys(this.state.positions).length>=2)return 'FUTURES_TWO_SLOTS_FULL';
  if(this.error)return this.error;
  if(!this.accountSummary||!this.checkedAt||this.now()-this.checkedAt>30000)return 'FUTURES_ACCOUNT_UNVERIFIED';
  if(this.allocation().maxOrderUsdt<5)return 'FUTURES_ALLOCATION_INSUFFICIENT';
  return null; // Final entryGate still checks permissions, orders, budget and protection.
 }
 sharedUniverse(){return sharedWatchRows(this.watchSymbols(),Object.values(this.infos)).filter(r=>r.available).map(r=>r.futuresSymbol);}
 assertWatchedSymbol(symbol){
  if(this.watchSymbols&&(!this.marketAt||this.now()<this.marketAt||this.now()-this.marketAt>=SHARED_WATCH_POLICY.marketAgeMs||!this.sharedUniverse().includes(symbol)))throw Error('FUTURES_NOT_IN_SHARED_WATCH');
 }
 async snapshot(){
  const a=await this.api.get('/fapi/v2/account'),m=await this.api.get('/fapi/v1/positionSide/dual');
  if(!Array.isArray(a.positions)||!Array.isArray(a.assets)||typeof a.canTrade!=='boolean'||typeof a.multiAssetsMargin!=='boolean'||typeof m.dualSidePosition!=='boolean'||a.positions.some(p=>!number(p.positionAmt)||!number(p.entryPrice)))throw Error('FUTURES_ACCOUNT_UNVERIFIED');
  const usdt=a.assets.find(x=>x.asset==='USDT');
  if(!usdt||!number(usdt.availableBalance)||!number(usdt.walletBalance))throw Error('FUTURES_BALANCE_UNVERIFIED');
  this.accountSummary={canTrade:a.canTrade,multiAssetsMargin:a.multiAssetsMargin,hedgeMode:m.dualSidePosition,availableUsdt:Number(usdt.availableBalance),walletUsdt:Number(usdt.walletBalance)};
  return {...this.accountSummary,positions:a.positions.filter(p=>Number(p.positionAmt)!==0)};
 }
 assertAccount(a){
  if(!a.canTrade)throw Error('FUTURES_TRADING_NOT_PERMITTED');
  if(a.multiAssetsMargin)throw Error('FUTURES_SINGLE_ASSET_REQUIRED');
  if(a.hedgeMode)throw Error('FUTURES_ONE_WAY_REQUIRED');
  if(a.positions.some(p=>!this.state.positions[p.symbol]||p.positionSide!=='BOTH'||Number(p.positionAmt)>0))throw Error('FUTURES_EXTERNAL_POSITION_BLOCK');
 }
 async quote(symbol){
  const q=await this.api.get('/fapi/v1/ticker/bookTicker',{symbol}),now=this.now();
  if(q.symbol!==symbol||!number(q.time)||Number(q.time)>now+1000||now-Number(q.time)>10000||!(Number(q.bidPrice)>0)||!(Number(q.askPrice)>=Number(q.bidPrice)))throw Error('FUTURES_QUOTE_STALE');
  return q;
 }
 async info(symbol){
  if(!this.infos[symbol]||this.now()-this.marketAt>300000)await this.markets();
  const i=this.infos[symbol];if(!i)throw Error('FUTURES_SYMBOL_UNAVAILABLE');return i;
 }
 async markets(){
  const data=await this.api.get('/fapi/v1/exchangeInfo');
  if(!Array.isArray(data.symbols))throw Error('FUTURES_MARKETS_UNVERIFIED');
  this.infos=Object.fromEntries(data.symbols.filter(i=>i.status==='TRADING'&&i.contractType==='PERPETUAL'&&i.quoteAsset==='USDT'&&i.marginAsset==='USDT'&&!STABLE_BASES.has(i.baseAsset)).map(i=>[i.symbol,i]));
  if(this.watchSymbols)this.universe=this.sharedUniverse();
  else{
   const tickers=await this.api.get('/fapi/v1/ticker/24hr');
   if(!Array.isArray(tickers))throw Error('FUTURES_UNIVERSE_UNVERIFIED');
   this.universe=tickers.filter(t=>this.infos[t.symbol]&&Number(t.quoteVolume)>0).sort((a,b)=>Number(b.quoteVolume)-Number(a.quoteVolume)).slice(0,50).map(t=>t.symbol);
  }
  this.marketAt=this.now();
 }
 async input(symbol){
  const rows=await futuresTrendHistory(this.api,symbol,this.now());
  if(!Array.isArray(rows))throw Error('FUTURES_HISTORY_UNVERIFIED');
  const now=this.now(),bars=rows.map(r=>({openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6])+1,closed:Number(r[6])+1<=now,receivedAt:now}));
  const q=await this.quote(symbol);
  return {bars:bars.slice(-206),trendBars:bars,price:Number(q.bidPrice),priceAsOf:Number(q.time),now:this.now(),pocResetAfter:this.state.closed.filter(p=>p.symbol===symbol).at(-1)?.closedAt||0,liveBar:bars.find(b=>!b.closed&&b.openTime===Math.floor(this.now()/300000)*300000),entryAfter:Math.max(this.control().resumedAt||0,this.state.resumedAt||0,this.state.closed.filter(p=>p.symbol===symbol).at(-1)?.closedAt||0),used:this.state.used.filter(x=>x.symbol===symbol).map(x=>x.patternId),quote:q};
 }
 async symbolConfig(symbol){
  const rows=await this.api.get('/fapi/v1/symbolConfig',{symbol});
  const c=Array.isArray(rows)&&rows.find(x=>x.symbol===symbol);
  if(!c)throw Error('FUTURES_SYMBOL_CONFIG_UNVERIFIED');return c;
 }
 assertSymbol(c){if(c.marginType!=='ISOLATED'||Number(c.leverage)!==1||!no(c.isAutoAddMargin))throw Error('FUTURES_REQUIRES_ISOLATED_1X_NO_AUTO_MARGIN');}
 async configure(symbol){
  let c=await this.symbolConfig(symbol);
  if(!no(c.isAutoAddMargin))throw Error('FUTURES_AUTO_ADD_MARGIN_MUST_BE_OFF');
  if(c.marginType!=='ISOLATED')await this.api.post('/fapi/v1/marginType',{symbol,marginType:'ISOLATED'});
  if(Number(c.leverage)!==1)await this.api.post('/fapi/v1/leverage',{symbol,leverage:1});
  c=await this.symbolConfig(symbol);this.assertSymbol(c);
 }
 async entryGate(){
  if(!this.config.enabled||!this.control().allowEntries)throw Error('FUTURES_ENTRIES_PAUSED');
  if(this.fatal||this.state.halt||this.state.pending)throw Error(this.fatal||this.state.halt||'FUTURES_ORDER_PENDING');
  if(Object.keys(this.state.positions).length>=2)throw Error('FUTURES_TWO_SLOTS_FULL');
  const permissions=await this.permission();
  if(permissions.enableFutures!==true||permissions.ipRestrict!==true)throw Error('FUTURES_API_PERMISSION_REQUIRED');
  const a=await this.snapshot();this.assertAccount(a);
  this.assertAllocation(undefined,a);
  const orders=await this.api.get('/fapi/v1/openOrders'),algos=await this.api.get('/fapi/v1/openAlgoOrders');
  if(!Array.isArray(orders)||!Array.isArray(algos))throw Error('FUTURES_ORDERS_UNVERIFIED');
  if(orders.length)throw Error('FUTURES_EXTERNAL_ORDER_BLOCK');
  const own=new Set(Object.values(this.state.positions).flatMap(p=>p.algos.map(x=>x.clientAlgoId)));
  if(algos.some(o=>!own.has(o.clientAlgoId)))throw Error('FUTURES_EXTERNAL_ALGO_BLOCK');
  // Current wallet includes realized profit/loss, fees, funding and transfers.
  // Unrealized gains do not enlarge either slot. Free margin caps the next entry.
  for(const p of Object.values(this.state.positions))if(!p.protectedAt||this.now()-p.protectedAt>30000)throw Error('FUTURES_PROTECTION_NOT_VERIFIED');
  return a;
 }
 async finishOrder(order){
  const pending=this.state.pending;if(!pending)return;
  const expected=pending.params;
  if(order.symbol!==expected.symbol||order.clientOrderId!==expected.newClientOrderId||order.side!==expected.side||order.positionSide!=='BOTH'||!number(order.executedQty)||Number(order.executedQty)<0||Number(order.executedQty)>Number(expected.quantity)+1e-10)throw Error('FUTURES_ORDER_IDENTITY_MISMATCH');
  if(!terminal(order.status))throw Error('FUTURES_ORDER_AWAITING_FINAL_RESULT');
  const qty=Number(order.executedQty);
  if(pending.kind==='ENTRY'&&qty>0){
   const entryPrice=futuresFillPrice(order);
   if(!(entryPrice>0))throw Error('FUTURES_FILL_PRICE_UNVERIFIED');
   this.state.positions[order.symbol]={symbol:order.symbol,qty,entryPrice,entryAt:this.now(),entryOrderId:order.orderId,entryClientOrderId:order.clientOrderId,entryQuote:Number(order.cumQuote),entryPriceSource:'CUM_QUOTE',targetPrice:pending.setup.targetPrice,setup:pending.setup,swingProtection:pending.setup.swingProtection,settings:pending.settings,lowPrice:entryPrice,algos:[],protectedAt:null};
   this.state.positions[order.symbol].targetPrice=entryPrice*(1-validateShortSettings(pending.settings).takeProfitPct/100);
   this.state.positions[order.symbol].exitPolicy=FUTURES_SHORT_EXIT_POLICY;
   const approved=pending.slotBudgetUsdt??35; // Legacy pending entries retain their original cap.
   this.state.positions[order.symbol].slotBudgetUsdt=approved;
   if(!Number.isFinite(approved)||qty*entryPrice>approved)this.state.positions[order.symbol].closeReason='FILL_EXCEEDS_SLOT_BUDGET';
  }
  // EXIT is reconciled against the exchange position next; never assume a MARKET response closed everything.
  if(pending.kind==='ENTRY'&&pending.setup?.pocId){
   this.state.pocResults??={};
   this.state.pocResults[pending.setup.pocId]={ok:true,order:{orderId:order.orderId,status:order.status,executedQty:String(qty),symbol:order.symbol}};
  }
  const manualId=pending.manualRequestId||pending.setup?.manualRequestId;
  if(manualId&&this.state.manualRequests?.[manualId])this.state.manualRequests[manualId].result={ok:true,requestId:manualId,order:{orderId:order.orderId,status:order.status,executedQty:String(qty),symbol:order.symbol}};
  this.state.pending=null;this.save();
 }
 async recover(){
  const pending=this.state.pending;if(!pending)return;
  await this.finishOrder(await this.api.get('/fapi/v1/order',{symbol:pending.params.symbol,origClientOrderId:pending.params.newClientOrderId}));
 }
 async submit(kind,params,extra={},finalGuard){
  if(this.state.pending||this.fatal)throw Error('FUTURES_ORDER_PENDING');
  this.state.pending={kind,params:{...params,newClientOrderId:id()},...extra,at:this.now()};this.save();
  if(kind==='ENTRY'&&((extra.setup?.entryMode!=='POC'&&this.reserved(params.symbol))||!this.control().allowEntries||this.forceClose||JSON.stringify(extra.settings)!==JSON.stringify(validateTradeSettings(this.settings()))||this.now()>=extra.setup.expiresAt)){this.state.pending=null;this.save();throw Error('FUTURES_FINAL_ENTRY_BLOCK');}
  if(finalGuard||kind==='ENTRY'){
   try{
    if(kind==='ENTRY'){
     const account=await this.snapshot();this.assertAccount(account);this.assertAllocation(extra.slotBudgetUsdt,account);
     if(!Number.isFinite(extra.slotBudgetUsdt))throw Error('FUTURES_FINAL_ENTRY_BLOCK');
    }
    // Price/signal confirmation stays after the funding reads, next to submission.
    if(finalGuard)await finalGuard();
    if(!this.control().allowEntries||this.forceClose||kind==='ENTRY'&&(JSON.stringify(extra.settings)!==JSON.stringify(validateTradeSettings(this.settings()))||this.now()>=extra.setup.expiresAt))throw Error('FUTURES_FINAL_ENTRY_BLOCK');
   }
   catch(error){this.state.pending=null;this.save();throw error;}
  }
  let order;
  try{order=await this.api.post('/fapi/v1/order',this.state.pending.params);}
  catch(e){if(definitive(e)){this.state.pending=null;this.save();}throw e;}
  await this.finishOrder(order);
 }
 async close(p,reason,manualRequestId=null){
  const a=await this.snapshot();if(a.hedgeMode)throw Error('FUTURES_ONE_WAY_REQUIRED');
  const actual=a.positions.find(x=>x.symbol===p.symbol&&x.positionSide==='BOTH');
  if(!actual)return;
  const qty=-Number(actual.positionAmt);
  if(qty<=0||qty>p.qty+1e-10)throw Error('FUTURES_POSITION_OWNERSHIP_CHANGED');
  p.closeReason=reason;this.save();
  await this.submit('EXIT',{symbol:p.symbol,side:'BUY',positionSide:'BOTH',type:'MARKET',quantity:String(qty),reduceOnly:'true',newOrderRespType:'RESULT'},manualRequestId?{manualRequestId}:{});
 }
 async queryAlgo(p,ref){
  let o;
  // An accepted conditional order can briefly be invisible to GET. Re-read the
  // SAME identity for at most four delayed attempts; never submit it again.
  for(let attempt=0;;attempt++){
   try{o=await this.api.get('/fapi/v1/algoOrder',algoId(ref.algoId)?{algoId:ref.algoId}:{clientAlgoId:ref.clientAlgoId});break;}
   catch(e){
    if(e.code!==-2013||attempt>=visibilityDelays.length)throw e;
    await this.sleep(visibilityDelays[attempt]);
   }
  }
  if(algoId(ref.algoId)&&String(o.algoId)!==String(ref.algoId))throw Error('FUTURES_PROTECTION_IDENTITY_MISMATCH');
  if(o.symbol!==p.symbol||o.clientAlgoId!==ref.clientAlgoId||o.side!=='BUY'||o.positionSide!=='BOTH'||o.orderType!==ref.kind||!yes(o.closePosition)||Number(o.triggerPrice)!==ref.price||o.workingType!=='CONTRACT_PRICE')throw Error('FUTURES_PROTECTION_IDENTITY_MISMATCH');
  if(algoId(o.algoId))ref.algoId=o.algoId;
  ref.status=o.algoStatus;return o;
 }
 async cancelAlgo(p,ref){
  if(ref.status==='REJECTED')return;
  const o=await this.queryAlgo(p,ref);
  if(['NEW','TRIGGERING'].includes(o.algoStatus)){
   try{await this.api.del('/fapi/v1/algoOrder',{clientAlgoId:ref.clientAlgoId});}
   catch(e){if(e.code!==-2011)throw e;}
   // A cancel can race with triggering/cancellation. Accept only a fresh,
   // identity-checked terminal result; missing/active orders stay blocked.
   await this.queryAlgo(p,ref);
   if(!['CANCELED','EXPIRED','FINISHED','REJECTED'].includes(ref.status))throw Error('FUTURES_PROTECTION_CANCEL_PENDING');
  }
 }
 async ensureAlgo(p,kind,price,allowConflictRecovery=true){
  let ref=p.algos.findLast(x=>x.kind===kind&&x.price===price&&!['REJECTED','CANCELED','EXPIRED','FINISHED'].includes(x.status));
  if(ref){const o=await this.queryAlgo(p,ref);if(o.algoStatus!=='NEW')throw Error('FUTURES_PROTECTION_NOT_ACTIVE');}
  else{
   ref={clientAlgoId:id(),kind,price,status:'PENDING'};p.algos.push(ref);this.save();
   try{
    const ack=await this.api.post('/fapi/v1/algoOrder',{algoType:'CONDITIONAL',symbol:p.symbol,side:'BUY',positionSide:'BOTH',type:kind,triggerPrice:String(price),workingType:'CONTRACT_PRICE',closePosition:'true',clientAlgoId:ref.clientAlgoId});
    if(ack?.clientAlgoId!==ref.clientAlgoId||ack?.symbol!==p.symbol)throw Error('FUTURES_PROTECTION_IDENTITY_MISMATCH');
    if(algoId(ack.algoId))ref.algoId=ack.algoId;
    this.save();
   }
   catch(e){
    if(definitive(e)){ref.status='REJECTED';this.save();}
    // Binance can reject a second close-all order of the same kind (-4130).
    // Only a definitively rejected submission permits this bounded fallback.
    // Verify our old order and the other guard before canceling our old identity.
    if(e.code===-4130&&definitive(e)&&allowConflictRecovery){
     const old=p.algos.filter(x=>x!==ref&&x.kind===kind&&x.status==='NEW');
     const other=p.algos.filter(x=>x.kind!==kind&&x.status==='NEW');
     if(old.length===1&&other.length===1){
      for(const guard of [...old,...other])if((await this.queryAlgo(p,guard)).algoStatus!=='NEW')throw Error('FUTURES_PROTECTION_NOT_ACTIVE');
      const account=await this.snapshot();this.assertAccount(account);
      const actual=account.positions.find(x=>x.symbol===p.symbol&&x.positionSide==='BOTH');
      if(!actual||-Number(actual.positionAmt)!==p.qty)throw Error('FUTURES_POSITION_OWNERSHIP_CHANGED');
      p.protectedAt=null;this.save();
      await this.cancelAlgo(p,old[0]);this.save();
      if(old[0].status!=='CANCELED')throw Error('FUTURES_PROTECTION_CANCEL_PENDING');
      return this.ensureAlgo(p,kind,price,false);
     }
    }
    throw e;
   }
   const o=await this.queryAlgo(p,ref);if(o.algoStatus!=='NEW')throw Error('FUTURES_PROTECTION_NOT_ACTIVE');
  }
  this.save();
  // Install and verify a tighter stop BEFORE removing the old one. All are close-only.
  for(const old of p.algos.filter(x=>x!==ref&&x.kind===kind))await this.cancelAlgo(p,old);
  p.algos=p.algos.filter(x=>x===ref||x.kind!==kind);this.save();
 }
 async manage(a){
  for(const p of Object.values(this.state.positions)){
   try{
    const actual=a.positions.find(x=>x.symbol===p.symbol&&x.positionSide==='BOTH');
    if(!actual){
     if(a.positions.some(x=>x.symbol===p.symbol))throw Error('FUTURES_POSITION_OWNERSHIP_CHANGED');
     for(const ref of p.algos)await this.cancelAlgo(p,ref);
     this.state.closed.push({...p,closedAt:this.now(),reason:p.closeReason||'BROKER_OR_EXTERNAL_CLOSE'});
     this.state.closed=this.state.closed.slice(-100);delete this.state.positions[p.symbol];this.save();continue;
    }
    const qty=-Number(actual.positionAmt);
    if(qty<=0||qty>p.qty+1e-10||Math.abs(Number(actual.entryPrice)-p.entryPrice)>Math.max(1e-8,p.entryPrice*1e-6))throw Error('FUTURES_POSITION_OWNERSHIP_CHANGED');
    p.qty=qty; // A documented smaller exchange position cannot be sold again as the original size.
    if(this.forceClose||p.closeReason){await this.close(p,p.closeReason||'MANUAL_STOP_ALL');continue;}
    const q=await this.quote(p.symbol),info=await this.info(p.symbol);
    let settings;try{settings=validateShortSettings(this.settings());}catch{settings=validateShortSettings(p.settings);}
    Object.assign(p,shortExit(p,Number(q.askPrice),settings,{targetMode:'SETTINGS'}),{exitPolicy:FUTURES_SHORT_EXIT_POLICY,currentPrice:Number(q.askPrice),priceAt:Number(q.time)});this.save();
    if(p.exit){await this.close(p,p.exit);continue;}
    try{
     this.assertSymbol(await this.symbolConfig(p.symbol));
     const tick=info.filters.find(x=>x.filterType==='PRICE_FILTER')?.tickSize;
     const stop=Number(roundStep(p.stopPrice,tick)),target=Number(roundStep(p.targetPrice,tick,true));
          // Keep any tighter verified native stop, including after settings changes.
     const activeStops=p.algos.filter(x=>x.kind==='STOP_MARKET'&&x.status==='NEW').map(x=>x.price);
     p.stopPrice=Math.min(stop,...activeStops);this.save();
     if(p.stopPrice<=Number(q.askPrice)||target>=Number(q.bidPrice)){await this.close(p,'ROUNDED_EXIT_REACHED');continue;}
     await this.ensureAlgo(p,'STOP_MARKET',p.stopPrice);
     await this.ensureAlgo(p,'TAKE_PROFIT_MARKET',target);
     p.protectedAt=this.now();this.save();
    }catch(e){p.protectedAt=null;this.save();await this.close(p,'PROTECTION_FAILURE');throw e;}
   }catch(e){
    this.error=e.message;this.state.halt=this.state.halt&&this.state.halt!=='FUTURES_QUOTE_STALE'?this.state.halt:e.message;this.save();
    // A newly filled position must not remain naked if quotes/configuration fail.
    // An uncertain prior order is reconciled first; never duplicate it.
    if(!p.protectedAt&&!this.state.pending&&!this.fatal&&this.state.positions[p.symbol]&&!/OWNERSHIP/.test(e.message)){
     try{await this.close(p,'UNPROTECTED_POSITION');}catch(closeError){this.error=closeError.message;}
    }
   }
  }
 }
 async manualTrade(input){
  const {requestId,symbol,side}=input||{},opening=side==='OPEN_SHORT',amount=opening?Number(input.quoteUsdt):null;
  if(input?.mode!=='live'||!/^[-a-zA-Z0-9_]{16,64}$/.test(requestId||'')||!/^[A-Z0-9]+USDT$/.test(symbol||'')||!['OPEN_SHORT','CLOSE_SHORT'].includes(side)||opening&&!(Number.isFinite(amount)&&amount>=5)||!opening&&input.all!==true)throw Error('INVALID_FUTURES_MANUAL_REQUEST');
  const fingerprint=JSON.stringify([symbol,side,amount,input.all===true]),old=this.state.manualRequests?.[requestId];
  if(old){if(old.fingerprint!==fingerprint)throw Error('MANUAL_REQUEST_ID_CONFLICT');return old.result||{ok:false,uncertain:true,requestId,error:'FUTURES_MANUAL_OUTCOME_UNKNOWN'};}
  if(input.statusOnly)return {ok:false,uncertain:true,requestId,error:'MANUAL_REQUEST_NOT_FOUND'};
  if(this.busy||this.state.pending||this.fatal)return {ok:false,error:'FUTURES_EXECUTION_BUSY',requestId};
  this.state.manualRequests??={};this.state.manualRequests[requestId]={fingerprint,at:this.now()};this.save();
  let result;
  if(opening){
   result=await this.enterPoc({symbol,side:'SHORT',quoteUsdt:amount,requestId,expiresAt:this.now()+30000},async()=>{
    if(this.reserved(symbol))throw Error('POC_PENDING_FOR_SYMBOL');
   },'MANUAL');
  }else{
   this.busy=true;
   try{
    const p=this.state.positions[symbol];if(!p)throw Error('FUTURES_NO_OWNED_SHORT');
    const account=await this.snapshot();this.assertAccount(account);
    if(!account.positions.some(x=>x.symbol===symbol&&Number(x.positionAmt)<0))throw Error('FUTURES_NO_OWNED_SHORT');
    await this.close(p,'MANUAL_CLOSE',requestId);
    await this.manage(await this.snapshot());
    result=this.state.manualRequests[requestId].result||{ok:false,uncertain:true,error:'FUTURES_MANUAL_OUTCOME_UNKNOWN'};
   }catch(e){result=this.state.manualRequests[requestId].result||{ok:false,uncertain:!!this.state.pending||!!this.fatal,error:e.message};}
   finally{this.busy=false;}
  }
  result={...result,requestId};
  if(!result.uncertain){this.state.manualRequests[requestId].result=result;this.save();}
  return result;
 }
 async enterPoc(intent,guard,entryMode='POC'){
  if(this.busy)return {deferred:true,error:'POC_EXECUTION_BUSY'};
  this.busy=true;
  try{
   if(this.state.pocResults?.[intent.requestId])return this.state.pocResults[intent.requestId];
   if(!(Number.isFinite(intent.quoteUsdt)&&intent.quoteUsdt>=5)||intent.side!=='SHORT')throw Error('POC_INVALID_AMOUNT');
   await this.entryGate();this.assertAllocation(intent.quoteUsdt);
   if(this.state.positions[intent.symbol])throw Error('FUTURES_ALREADY_HELD');
   const settings=validateShortSettings(this.settings());
   await guard();await this.configure(intent.symbol);
   const info=await this.info(intent.symbol);
   await this.entryGate();this.assertSymbol(await this.symbolConfig(intent.symbol));
   const q=await this.quote(intent.symbol);
   const setup={entryMode,...(entryMode==='MANUAL'?{manualRequestId:intent.requestId}:{}),pocId:intent.requestId,poc:intent.poc,expiresAt:intent.expiresAt,targetPrice:Number(q.bidPrice)*(1-settings.takeProfitPct/100)};
   let waveBars=[];try{waveBars=(await this.input(intent.symbol)).bars;}catch{}
   setup.swingProtection=swingProtection(waveBars,{side:'SHORT',at:this.now()});
   this.assertAllocation(intent.quoteUsdt);
   const plan=shortOrderPlan(info,q,setup,intent.quoteUsdt);
   await this.submit('ENTRY',plan,{setup,settings,slotBudgetUsdt:intent.quoteUsdt},guard);
   await this.manage(await this.snapshot());
   return this.state.pocResults?.[intent.requestId]||{uncertain:true,error:'POC_OUTCOME_UNKNOWN'};
  }catch(error){
   // Filled entries remain filled even if the subsequent protection read failed.
   const receipt=this.state.pocResults?.[intent.requestId];
   if(receipt){receipt.order.protectionWarning=error.message;return receipt;}
   return {ok:false,uncertain:!!this.state.pending||!!this.fatal,error:error.message};
  }finally{this.busy=false;}
 }
 async enter(symbol,first){
  this.assertWatchedSymbol(symbol);
  if(this.reserved(symbol))throw Error('POC_PENDING_FOR_SYMBOL');
  await this.entryGate();
  if(this.state.positions[symbol])throw Error('FUTURES_SYMBOL_ALREADY_HELD');
  const settings=validateShortSettings(this.settings());
  await this.configure(symbol);
  const finalInput=await this.input(symbol),final=shortSignal(finalInput,this.config);
  if(!final.ready)throw Error(final.reason);
  assertSameShortSignal(final.setup,first.setup);
  const info=await this.info(symbol);
  await this.entryGate();this.assertSymbol(await this.symbolConfig(symbol));
  const latestInput=await this.input(symbol),quote=latestInput.quote;
  const check=shortSignal(latestInput,this.config);
  if(!check.ready)throw Error(check.reason);
  assertSameShortSignal(check.setup,final.setup);
  if(!this.control().allowEntries||JSON.stringify(settings)!==JSON.stringify(validateTradeSettings(this.settings())))throw Error('FUTURES_SETTINGS_OR_PAUSE_CHANGED');
  const slotBudgetUsdt=this.assertAllocation().maxOrderUsdt;
  const plan=shortOrderPlan(info,quote,check.setup,slotBudgetUsdt);
  this.state.used.push({symbol,patternId:check.setup.patternId}); // Keep pattern identities across restarts; never replay a consumed entry.
  this.save();
  check.setup.swingProtection=swingProtection(latestInput.bars,{side:'SHORT',at:this.now()});
  await this.submit('ENTRY',plan,{setup:check.setup,settings,slotBudgetUsdt},()=>{
   this.assertWatchedSymbol(symbol);
   const last=shortSignal({...latestInput,now:this.now()},this.config);
   if(!last.ready)throw Error(last.reason);
   assertSameShortSignal(last.setup,check.setup);
  });
  await this.manage(await this.snapshot());
 }
 recoverFreshQuoteHalt(account,managedAt){
  // A transient market-data fault is recoverable only after this cycle has
  // reverified every owned position and both native protections. Other halts
  // remain operator-reviewed; no exchange orders are submitted by recovery.
  if(this.state.halt!=='FUTURES_QUOTE_STALE'||this.error||this.fatal||this.forceClose||this.state.pending)return;
  const now=this.now(),positions=Object.values(this.state.positions);
  if(!positions.length||!Number.isFinite(managedAt)||managedAt>now)return;
  this.assertAccount(account);
  if(positions.some(p=>p.closeReason||p.exit||!Number.isFinite(p.protectedAt)||p.protectedAt<managedAt||p.protectedAt>now||!Number.isFinite(p.priceAt)||p.priceAt>now+1000||now-p.priceAt>10000||!['STOP_MARKET','TAKE_PROFIT_MARKET'].every(kind=>p.algos.some(a=>a.kind===kind&&a.status==='NEW'))))return;
  this.state.haltReleases=[...(this.state.haltReleases||[]),{at:now,previousHalt:this.state.halt,reason:'FRESH_QUOTES_AND_PROTECTIONS_REVERIFIED'}].slice(-100);
  this.state.resumedAt=now;
  this.state.halt=null;this.save();
 }
 async recoverProtectionConflictHalt(managedAt){
  const previousHalt=this.state.halt;
  if(!['FUTURES_API_-4130','FUTURES_API_-2011'].includes(previousHalt)||this.error||this.fatal||this.forceClose||this.state.pending)return;
  const account=await this.snapshot();this.assertAccount(account);
  const now=this.now(),positions=Object.values(this.state.positions);
  if(positions.some(p=>p.closeReason||p.exit||!Number.isFinite(p.protectedAt)||p.protectedAt<managedAt||p.protectedAt>now||!Number.isFinite(p.priceAt)||p.priceAt>now+1000||now-p.priceAt>10000||!['STOP_MARKET','TAKE_PROFIT_MARKET'].every(kind=>p.algos.filter(a=>a.kind===kind&&a.status==='NEW').length===1)))return;
  const orders=await this.api.get('/fapi/v1/openOrders'),algos=await this.api.get('/fapi/v1/openAlgoOrders');
  if(!Array.isArray(orders)||orders.length||!Array.isArray(algos))return;
  const own=positions.flatMap(p=>p.algos.filter(a=>a.status==='NEW').map(a=>({p,a})));
  if(algos.length!==own.length||new Set(algos.map(o=>o.clientAlgoId)).size!==algos.length||algos.some(o=>!own.some(({p,a})=>o.clientAlgoId===a.clientAlgoId&&o.symbol===p.symbol)))return;
  for(const {p,a} of own)if((await this.queryAlgo(p,a)).algoStatus!=='NEW')return;
  // Never replay a signal observed during the halt, or release another error.
  if(this.state.halt!==previousHalt||this.state.pending||this.forceClose||this.fatal)return;
  this.state.haltReleases=[...(this.state.haltReleases||[]),{at:this.now(),previousHalt:this.state.halt,reason:previousHalt==='FUTURES_API_-2011'?'CANCEL_REJECT_RECONCILED':'PROTECTION_CONFLICT_RECONCILED'}].slice(-100);
  this.state.resumedAt=this.now();this.state.halt=null;this.save();
 }
 async cycle(){
  if(this.busy||this.fatal)return;
  if(!this.config.requested&&!Object.keys(this.state.positions).length&&!this.state.pending)return;
  this.busy=true;
  try{
   this.error=null;
   // Resolve the exact persisted trade identity before any new submission.
   let recoveryError;try{await this.recover();}catch(e){recoveryError=e;}
   const account=await this.snapshot();
   const managedAt=this.now();
   await this.manage(account);
   if(recoveryError)throw recoveryError;
   this.recoverFreshQuoteHalt(account,managedAt);
   await this.recoverProtectionConflictHalt(managedAt);
   this.checkedAt=this.now();
   if(this.state.halt||this.forceClose)throw Error(this.state.halt||'FUTURES_STOP_ALL');
   if(!this.config.enabled||!this.control().allowEntries)throw Error('FUTURES_ENTRIES_PAUSED');
   this.assertAccount(await this.snapshot());
   this.assertAllocation();
   if(Object.keys(this.state.positions).length>=2)throw Error('FUTURES_TWO_SLOTS_FULL');
   if(this.now()-this.lastScan<2000)return;
   if(!this.universe.length||this.now()-this.marketAt>300000)await this.markets();
   if(this.watchSymbols)this.universe=this.sharedUniverse();
   this.pocWatch??=new PocFastWatch({},this.now);
   this.pocWatchTurn=(this.pocWatchTurn||0)+1;
   const fast=this.pocWatchTurn%4?this.pocWatch.take(this.universe.filter(s=>!this.state.positions[s])):null;
   const symbol=fast||this.universe[this.cursor++%this.universe.length];if(!symbol)return;
   this.lastScan=this.now();if(this.state.positions[symbol])return;
   const input=await this.input(symbol),result=shortSignal(input,this.config);
   this.pocWatch.observe(symbol,result,this.now());
   this.checks[symbol]={at:this.now(),reason:result.reason,setup:result.setup??null,consolidation:result.consolidation||result.setup?.consolidation||null};
   if(result.ready)await this.enter(symbol,result);
  }catch(e){this.error=e.message;}finally{this.checkedAt=this.now();this.busy=false;}
 }
 async closeAll(){
  if(!Object.keys(this.state.positions).length&&!this.state.pending)return {sold:[],failed:[]};
  this.forceClose=true;
  const until=this.now()+20000;
  while(this.busy&&this.now()<until)await new Promise(r=>setTimeout(r,50));
  if(this.busy)return {sold:[],failed:[{symbol:'FUTURES',error:'FUTURES_EXECUTION_BUSY'}]};
  this.busy=true;
  try{
   await this.recover();const before=Object.keys(this.state.positions);
   await this.manage(await this.snapshot());await this.manage(await this.snapshot());
   return {sold:before.filter(s=>!this.state.positions[s]).map(s=>'FUTURES:'+s),failed:Object.keys(this.state.positions).map(symbol=>({symbol:'FUTURES:'+symbol,error:this.error||'FUTURES_CLOSE_UNCONFIRMED'}))};
  }catch(e){return {sold:[],failed:[{symbol:'FUTURES',error:e.message}]};}
  finally{this.busy=false;this.forceClose=false;}
 }
}
