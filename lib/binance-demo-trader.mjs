import {createHmac,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {getDemoAccount} from './binance-demo-account.mjs';
import {wyckoffExit} from './wyckoff-strategy.mjs';
const ORIGIN='https://demo-api.binance.com';
const terminal=new Set(['FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH','REJECTED']);
export function allocation(capital,cash,held,max=10){
  const free=max-held;
  return free>0?Math.max(0,cash/free*0.998):0;
}
export function floorQuantity(q,step){
  if(!(Number(step)>0))return String(q);
  const decimals=(String(step).split('.')[1]||'').replace(/0+$/,'').length;
  const scale=Math.min(20,decimals+4);
  const units=BigInt(Number(q).toFixed(scale).replace('.',''));
  const stepUnits=BigInt(Number(step).toFixed(scale).replace('.',''));
  const rounded=(units/stepUnits)*stepUnits;
  const digits=rounded.toString().padStart(scale+1,'0');
  return Number(digits.slice(0,-scale)+'.'+digits.slice(-scale)).toFixed(decimals);
}
export class DemoTrader{
  constructor({
    key,
    secret,
    enabled=false,
    stateFile,
    fetcher=fetch,
    maxPositions=10,
    entryCostGuard=null,
    trailingStopPct=Number(process.env.BINANCE_DEMO_TRAILING_STOP_PERCENT??6),
    stopLossPct=Number(process.env.BINANCE_DEMO_STOP_LOSS_PERCENT??6),
    trailActivatePct=Number(process.env.BINANCE_DEMO_TRAIL_ACTIVATE_PERCENT??0)
  }){
    if(!Number.isFinite(trailingStopPct)||trailingStopPct<=0||trailingStopPct>=100)throw Error('Demo trailing stop percent must be between 0 and 100');
    if(!Number.isFinite(stopLossPct)||stopLossPct<=0||stopLossPct>=100)throw Error('Demo stop loss percent must be between 0 and 100');
    if(!Number.isFinite(trailActivatePct)||trailActivatePct<0||trailActivatePct>=100)throw Error('Demo trail activation percent must be between 0 and 100');
    if(!Number.isInteger(maxPositions)||maxPositions<1)throw Error('Invalid Demo position limit');
    this.maxPositions=maxPositions;
    this.entryCostGuard=entryCostGuard;
    this.trailingStopPct=trailingStopPct;
    this.stopLossPct=stopLossPct;
    this.trailActivatePct=trailActivatePct;
    Object.assign(this,{key,secret,enabled,stateFile,fetcher});
    this.state={positions:{},trades:[],actionLog:[],usedPatterns:{},pending:null,initialUsdt:null,lastCycle:null};
    this.account=null;this.error=null;this.busy=false;this.rules=new Map();
    if(stateFile&&fs.existsSync(stateFile)){
      try{const s=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(!s.positions||!Array.isArray(s.actionLog))throw Error('Invalid state');this.state={lastCycle:null,usedPatterns:{},...s};}
      catch(e){this.error='Demo state cannot be read: '+e.message;this.blocked=true;}
    }
  }
  wyckoffStats(){
    if(this.state.wyckoffStats)return this.state.wyckoffStats;
    const log=this.state.actionLog||[];
    const buys=log.filter(x=>x.type==='BUY'&&x.strategyId==='WYCKOFF_D1_V1').length;
    // Older SELL records did not include strategyId, so match the archived
    // trade journal to the confirmed Wyckoff entry history by symbol/time.
    const wyckoffSymbols=new Set(log.filter(x=>x.type==='BUY'&&x.strategyId==='WYCKOFF_D1_V1').map(x=>x.symbol));
    const sells=log.filter(x=>x.type==='SELL'&&(x.strategyId==='WYCKOFF_D1_V1'||(wyckoffSymbols.has(x.symbol)&&/^WYCKOFF_/.test(String(x.reason||''))))).length;
    this.state.wyckoffStats={buys,sells,closed:sells};
    return this.state.wyckoffStats;
  }
  save(){
    if(!this.stateFile)throw Error('Demo trading requires a persistent state file');
    if(process.env.RENDER==='true'){
      const mounts=fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').map(line=>line.split(' ')[4]).filter(Boolean);
      const target=path.resolve(this.stateFile);
      if(!mounts.some(m=>m!=='/'&&(target===m||target.startsWith(m+'/'))))throw Error('Attach a Render persistent disk at /var/data before enabling Demo trading');
    }
    try{
      fs.mkdirSync(path.dirname(this.stateFile),{recursive:true});
      fs.writeFileSync(this.stateFile+'.tmp',JSON.stringify(this.state));
      fs.renameSync(this.stateFile+'.tmp',this.stateFile);
    }catch(e){this.blocked=true;this.error='Demo state save failed: '+e.message;throw Error(this.error);}
  }
  async request(endpoint,params={},method='GET',signed=false){
    if(!this.key||!this.secret)throw Error('Demo API keys are missing');
    const query=new URLSearchParams(params);
    if(signed){const t=await this.request('/api/v3/time');query.set('timestamp',String(t.serverTime));query.set('recvWindow','5000');query.set('signature',createHmac('sha256',this.secret).update(query.toString()).digest('hex'));}
    const r=await this.fetcher(ORIGIN+endpoint+(query.size?'?'+query:''),{method,headers:{'X-MBX-APIKEY':this.key},signal:AbortSignal.timeout(15000)});
    const d=await r.json();if(!r.ok){const e=Error(d.msg||'Demo API error');e.code=d.code;e.status=r.status;throw e;}return d;
  }
  async refresh(){
    this.account=await getDemoAccount({key:this.key,secret:this.secret,fetcher:this.fetcher});
    this.reconcileHoldings();
    if(this.state.initialUsdt===null){this.state.initialUsdt=this.capital();this.save();}
    return this.account;
  }
  reconcileHoldings(){
    if(this.state.pending)return;
    let changed=false;
    for(const [symbol,p] of Object.entries(this.state.positions)){
      const actual=Number(this.balance(p.asset).qty);
      if(actual!==0)continue;
      // An external reset/withdrawal is not a strategy sale or a realized loss.
      // Archive the tracked cost and quantity without sending an exchange order.
      const event={type:'HOLDING_REMOVED_EXTERNALLY',symbol,qty:p.qty,
        allocationIls:p.allocationIls,entryPrice:p.entryPrice,
        at:new Date().toISOString(),reason:'ZERO_EXCHANGE_BALANCE'};
      this.state.reconciliations??=[];
      this.state.reconciliations.push(event);
      this.state.actionLog.unshift(event);
      delete this.state.positions[symbol];
      changed=true;
    }
    if(changed){this.state.actionLog=this.state.actionLog.slice(0,200);this.save();}
  }
  balance(asset){return this.account?.balances.find(b=>b.asset===asset)||{free:0,locked:0,qty:0,valueUsdt:0};}
  capital(){
    let sum=0;
    for(const asset of new Set(['USDT','USDC',...Object.values(this.state.positions).map(p=>p.asset)])){
      const b=this.balance(asset);if(b.qty>0&&b.valueUsdt===null)throw Error('Missing Demo price: '+asset);sum+=b.valueUsdt||0;
    }return sum;
  }
  async rule(symbol){
    if(!this.rules.has(symbol)){
      const d=await this.request('/api/v3/exchangeInfo',{symbol});const r=d.symbols?.find(s=>s.symbol===symbol);
      if(!r||r.status!=='TRADING'||r.quoteAsset!=='USDT'||r.isSpotTradingAllowed===false||!r.orderTypes?.includes('MARKET'))throw Error('Demo symbol not available: '+symbol);
      this.rules.set(symbol,r);
    }return this.rules.get(symbol);
  }
  sellQuantity(q,r){
    for(const f of r.filters.filter(f=>['LOT_SIZE','MARKET_LOT_SIZE'].includes(f.filterType))){
      if(Number(f.maxQty)>0)q=Math.min(q,Number(f.maxQty));
      q=Number(floorQuantity(q,f.stepSize));
      if(q<Number(f.minQty))throw Error('Demo quantity below minimum');
    }return q.toFixed(r.baseAssetPrecision??8);
  }
  async submit(symbol,side,params,reason,asset,meta={}){
    if(!this.enabled||this.blocked||this.state.pending)throw Error('Demo execution is paused');
    const pending={symbol,side,asset,reason,clientId:'levi-demo-'+randomUUID().replaceAll('-','').slice(0,24),at:new Date().toISOString(),previous:this.state.positions[symbol]||null,...meta};
    this.state.pending=pending;this.save();
    let order;
    try{order=await this.request('/api/v3/order',{symbol,side,type:'MARKET',...params,newClientOrderId:pending.clientId,newOrderRespType:'FULL'},'POST',true);}
    catch(e){
      // Timeout and server failures can mean an accepted order. Keep its identity, never resubmit.
      if(e.status>=400&&e.status<500&&![-1006,-1007,-1001].includes(e.code)){
        this.state.pending=null;this.save();
      }
      throw e;
    }
    await this.settle(order);return order;
  }
  async settle(order){
    if(!terminal.has(order.status))throw Error('Demo order awaiting final execution');
    const p=this.state.pending;if(!p)return;
    const qty=Number(order.executedQty||0),quote=Number(order.cummulativeQuoteQty||0);
    if(qty>0){
      // Query fills also after recovery so base commissions are subtracted accurately.
      const fills=order.fills||await this.request('/api/v3/myTrades',{symbol:p.symbol,orderId:String(order.orderId)},'GET',true);
      const baseFee=fills.reduce((n,f)=>n+(f.commissionAsset===p.asset?Number(f.commission):0),0);
      const quoteFee=fills.reduce((n,f)=>n+(f.commissionAsset==='USDT'?Number(f.commission):0),0);
      const price=quote/qty;
      const entry={type:p.side,symbol:p.symbol,orderId:order.orderId,clientOrderId:p.clientId,status:order.status,qty,price,amountUsdt:quote,at:p.at,reason:p.reason};
      if(p.wyckoffTrade){
        Object.assign(entry,p.wyckoffTrade,{stopPrice:price*(1-p.wyckoffTrade.stopLossPct/100)});
        this.state.usedPatterns??={};
        this.state.usedPatterns[p.symbol]=[...new Set([...(this.state.usedPatterns[p.symbol]||[]),p.wyckoffTrade.patternId])];
      }
      if(['TRAILING_STOP','TRAILING_PROFIT','STOP_LOSS'].includes(p.reason)&&p.previous){
        entry.peakPrice=p.previous.peakPrice;
        entry.stopPrice=p.previous.effectiveStopPrice??p.previous.trailingStopPrice??p.previous.initialStopPrice;
        entry.detectedDrawdownPct=p.previous.drawdownPct;
        entry.executedDrawdownPct=(p.previous.peakPrice-price)/p.previous.peakPrice*100;
        entry.executionDelayMs=Date.now()-Date.parse(p.at);
      }
      if(p.reason!=='CONVERT_USDC'){
        const stats=this.wyckoffStats();
        if(p.side==='BUY'&&p.wyckoffTrade?.strategyId==='WYCKOFF_D1_V1'&&!p.previous)stats.buys++;
        if(p.side==='SELL'&&p.previous?.strategyId==='WYCKOFF_D1_V1'){
          Object.assign(entry,{strategyId:'WYCKOFF_D1_V1',patternId:p.previous.patternId});
          stats.sells++;
          // A close is counted only when the entire tracked position is sold.
          const remaining=Math.max(0,Number(p.previous.qty||0)-qty-baseFee);
          if(remaining*Number(p.previous.entryPrice||0)<1)stats.closed++;
        }
        if(p.side==='BUY'){
          const boughtQty=Math.max(0,qty-baseFee);
          const boughtCost=quote+quoteFee;
          if(p.previous){
            const prevQty=Number(p.previous.qty||0);
            const prevCost=Number(p.previous.allocationIls||0);
            const totalQty=prevQty+boughtQty;
            const totalCost=prevCost+boughtCost;
            const avgPrice=totalQty>0?totalCost/totalQty:price;
            this.state.positions[p.symbol]={
              ...p.previous,
              symbol:p.symbol,
              asset:p.asset,
              qty:totalQty,
              entryPrice:avgPrice,
              peakPrice:Math.max(Number(p.previous.peakPrice||0),price),
              peakAt:p.at,
              allocationIls:totalCost,
              riskStage:Number(p.entryStage||2),
              breakoutLevel:Number(p.breakoutLevel||p.previous.breakoutLevel||0),
              stage2At:p.at
            };
          }else{
            this.state.positions[p.symbol]={
              symbol:p.symbol,
              asset:p.asset,
              qty:boughtQty,
              entryPrice:price,
              peakPrice:price,
              peakAt:p.at,
              allocationIls:boughtCost,
              entryAt:p.at,
              riskStage:Number(p.entryStage||1),
              breakoutLevel:Number(p.breakoutLevel||0),
              ...(p.wyckoffTrade?{...p.wyckoffTrade,stopPrice:price*(1-p.wyckoffTrade.stopLossPct/100)}:{})
            };
          }
        }else if(p.previous){
          const remaining=Math.max(0,p.previous.qty-qty-baseFee),cost=p.previous.allocationIls*(1-remaining/p.previous.qty);
          entry.pnlIls=quote-quoteFee-cost;
          this.state.trades.unshift({symbol:p.symbol,buyPrice:p.previous.entryPrice,sellPrice:price,pnlIls:entry.pnlIls,pnlPct:cost?entry.pnlIls/cost*100:0,at:p.at,orderId:order.orderId,exitReason:p.reason});
          if(remaining*p.previous.entryPrice<1)delete this.state.positions[p.symbol];
          else this.state.positions[p.symbol]={...p.previous,qty:remaining,allocationIls:p.previous.allocationIls-cost};
        }
      }
      this.state.actionLog.unshift(entry);this.state.actionLog=this.state.actionLog.slice(0,200);this.state.trades=this.state.trades.slice(0,100);
    }
    this.state.pending=null;this.save();
  }
  async recover(){
    if(!this.state.pending)return;
    const p=this.state.pending;
    // Unknown/not-found orders stay paused for manual investigation; do not send another order.
    const o=await this.request('/api/v3/order',{symbol:p.symbol,origClientOrderId:p.clientId},'GET',true);
    await this.settle(o);
  }
  async buy(ev){
    const quoteAge=Date.now()-Date.parse(ev.priceAsOf??ev.at);
    if(!Number.isFinite(quoteAge)||quoteAge< -5000||quoteAge>90000){
      return {ok:false,reason:'STALE_EVALUATION'};
    }

    const existing=this.state.positions[ev.symbol]||null;
    if(ev.wyckoffTrade && (this.state.usedPatterns?.[ev.symbol]?.includes(ev.wyckoffTrade.patternId)||this.state.actionLog.some(a=>a.type==='BUY'&&a.patternId===ev.wyckoffTrade.patternId&&a.symbol===ev.symbol)))return {ok:false,reason:'PATTERN_ALREADY_USED'};
    const stage=Number(ev.entryStage||1);
    const allowAdd=stage===2 && existing && Number(existing.riskStage||1)===1;

    if(existing && !allowAdd){
      return {ok:false,reason:'ALREADY_HELD'};
    }
    if(!existing && Object.keys(this.state.positions).length>=this.maxPositions){
      return {ok:false,reason:'NO_SLOT'};
    }

    const r=await this.rule(ev.symbol);
    if(r.quoteOrderQtyMarketAllowed===false)throw Error('Demo quote order unsupported');

    const usdtBefore=Number(this.balance('USDT').free||0);
    const capital=Math.max(0,Number(this.capital()||0));
    const fraction=Math.max(0.05,Math.min(1,Number(ev.orderFraction||0.5)));

    // Two-stage risk model: each stage uses its requested fraction of one slot.
    const targetStageAmount=(capital/this.maxPositions)*fraction;
    let amount=Math.min(targetStageAmount,usdtBefore*0.998);

    const precision=Math.min(8,r.quoteAssetPrecision??8);
    if(this.entryCostGuard){
      const check=await this.entryCostGuard(ev.symbol,amount);
      if(!check?.ok)return {ok:false,reason:check?.code||'WAIT_COST_DATA',entryCost:check};
    }

    const text=(Math.floor(amount*10**precision)/10**precision).toFixed(precision);
    const minimum=Math.max(
      0,
      ...r.filters
        .filter(f=>['MIN_NOTIONAL','NOTIONAL'].includes(f.filterType))
        .map(f=>Number(f.minNotional||0))
    );

    if(Number(text)<=0){
      return {ok:false,reason:'NO_CASH',amount:Number(text),minimum};
    }
    if(Number(text)<minimum){
      return {ok:false,reason:'BELOW_MIN_NOTIONAL',amount:Number(text),minimum};
    }

    const reason=ev.wyckoffTrade?'WYCKOFF_RECLAIM':stage===2?'BREAKOUT_STAGE_2':'BREAKOUT_STAGE_1';
    const order=await this.submit(
      ev.symbol,
      'BUY',
      {quoteOrderQty:text},
      reason,
      r.baseAsset,
      {
        entryStage:stage,
        breakoutLevel:Number(ev.breakoutLevel||0),
        wyckoffTrade:ev.wyckoffTrade||null
      }
    );
    await this.refresh();

    const now=this.state.positions[ev.symbol];
    const ok=!!now && Number(now.riskStage||1)>=stage;
    return {
      ok,
      reason:ok?'FILLED':'NOT_ADDED',
      orderId:order?.orderId||null,
      amount:Number(text),
      entryStage:stage
    };
  }

  async sell(ev,reason='STRATEGY_SELL'){
    const p=this.state.positions[ev.symbol];if(!p)return false;
    const r=await this.rule(ev.symbol);
    const available=Math.min(Number(p.qty||0),Number(this.balance(p.asset).free||0));
    let q;

    try{
      q=this.sellQuantity(available,r);
    }catch(e){
      if(!/Demo quantity below minimum/i.test(String(e.message||'')))throw e;

      // Binance cannot execute this residual quantity. Treat it as strategy dust:
      // release the slot, keep the tiny exchange balance untouched, and record why.
      const price=Number(this.balance(p.asset).priceUsdt||p.entryPrice||0);
      const dustValueUsdt=available*price;
      this.state.actionLog.unshift({
        type:'DUST_RELEASED',
        symbol:ev.symbol,
        qty:available,
        price,
        amountUsdt:dustValueUsdt,
        at:new Date().toISOString(),
        reason,
        error:'Demo quantity below minimum'
      });
      this.state.actionLog=this.state.actionLog.slice(0,200);
      delete this.state.positions[ev.symbol];
      this.error=null;
      this.save();
      return true;
    }

    if(!(Number(q)>0))throw Error('Demo holding is unavailable for sale');
    try{
      await this.submit(ev.symbol,'SELL',{quantity:q},reason,p.asset);
    }catch(e){
      // A known Binance NOTIONAL rejection may be a residual holding too small
      // for a MARKET sell. Verify against exchange filters and actual balance
      // before releasing the strategy slot. Never record a fictitious SELL.
      const notionalRejected=/Filter failure:\s*(?:NOTIONAL|MIN_NOTIONAL)/i.test(String(e.message||''));
      const filters=(r.filters||[]).filter(f=>['NOTIONAL','MIN_NOTIONAL'].includes(f.filterType));
      const minimum=Math.max(0,...filters
        .filter(f=>f.filterType==='MIN_NOTIONAL'||f.applyMinToMarket!==false)
        .map(f=>Number(f.minNotional||0))
        .filter(Number.isFinite));
      const balance=this.balance(p.asset);
      const marketPrice=Number(balance.priceUsdt);
      const executableValue=Number(q)*marketPrice;
      const confirmedDust=notionalRejected && !this.state.pending &&
        minimum>0 && Number.isFinite(executableValue) &&
        executableValue>=0 && executableValue<minimum &&
        Number(q)>0 && Number(q)<=Number(balance.free)+1e-12;
      if(!confirmedDust)throw e;

      this.state.actionLog.unshift({
        type:'DUST_RELEASED',
        symbol:ev.symbol,
        qty:Number(q),
        price:marketPrice,
        amountUsdt:executableValue,
        minNotionalUsdt:minimum,
        originalCostUsdt:Number(p.allocationIls||0),
        at:new Date().toISOString(),
        reason,
        error:'Binance NOTIONAL rejected; verified unsellable residual',
        exchangeOrderExecuted:false
      });
      this.state.actionLog=this.state.actionLog.slice(0,200);
      // Archive the accounting context without treating the residual as sold.
      this.state.dustArchive??=[];
      this.state.dustArchive.unshift({
        symbol:ev.symbol,
        qty:Number(q),
        valueUsdt:executableValue,
        originalCostUsdt:Number(p.allocationIls||0),
        archivedAt:new Date().toISOString(),
        cause:'BELOW_MARKET_MIN_NOTIONAL'
      });
      this.state.dustArchive=this.state.dustArchive.slice(0,200);
      delete this.state.positions[ev.symbol];
      this.error=null;
      this.save();
      return true;
    }
    await this.refresh();
    return !this.state.positions[ev.symbol];
  }
  updatePeaks(){
    const exits=new Set();
    for(const [symbol,p] of Object.entries(this.state.positions)){
      const price=Number(this.balance(p.asset).priceUsdt);
      if(!Number.isFinite(price)||price<=0)continue;

      const entry=Number(p.entryPrice);
      const stored=Number(p.peakPrice);
      const peak=Math.max(entry,Number.isFinite(stored)&&stored>0?stored:0,price);
      if(p.peakPrice!==peak){p.peakPrice=peak;p.peakAt=new Date().toISOString();}

      p.drawdownPct=(peak-price)/peak*100;
      p.peakGainPct=entry>0?(peak/entry-1)*100:0;
      if(p.strategyId==='WYCKOFF_D1_V1'){
        const exit=wyckoffExit(p,price);
        p.trailingActive=false;p.trailingStopPrice=null;p.effectiveStopPrice=p.stopPrice;
        p.exitTriggerReason=exit.sell?exit.reason:null;
        if(exit.sell)exits.add(symbol);
        continue;
      }

      // A saved old holding has no verified original peak. Never silently run old strategy rules.
      p.trailingActive=false;
      p.trailingStopPrice=null;
      p.effectiveStopPrice=null;
      p.exitTriggerReason=null;
      p.reviewRequired='LEGACY_POSITION_REQUIRES_REVIEW';
    }
    this.save();return exits;
  }

  async closeTrackedPositions(reason='MANUAL_STOP_ALL'){
    // Uses the same execution lock as the automatic cycle and exit monitor.
    // Never starts a second order while a previous order has unknown status.
    if(this.busy)throw Error('Demo execution is busy; retry stop in a moment');
    this.busy=true;
    const sold=[],failed=[];
    try{
      if(this.blocked)throw Error(this.error||'Demo trading is blocked');
      await this.recover();
      await this.refresh();
      for(const symbol of Object.keys(this.state.positions)){
        try{
          const ok=await this.sell({symbol},reason);
          if(ok)sold.push(symbol);
          else failed.push({symbol,error:'Position was not fully closed'});
        }catch(e){
          failed.push({symbol,error:e.message});
          if(this.state.pending)break;
        }
      }
      return {sold,failed};
    }finally{
      this.busy=false;
    }
  }

  async monitorExits(){
    // Share the execution lock and persisted order identity with the scan.
    if(!this.enabled||this.busy)return false;
    this.busy=true;
    try{
      if(this.blocked)throw Error(this.error);
      await this.recover();
      if(!Object.keys(this.state.positions).length)return true;
      await this.refresh();
      const exits=this.updatePeaks();
      this.lastExitCheckAt=new Date().toISOString();this.error=null;
      const failures=[];
      for(const symbol of exits){
        const reason=this.state.positions[symbol]?.exitTriggerReason||'STOP_LOSS';
        try{await this.sell({symbol},reason);}
        catch(e){
          if(this.state.pending)throw e;
          failures.push(symbol+': '+e.message);
        }
      }
      this.error=failures.length?failures.join('; '):null;
      return !failures.length;
    }catch(e){
      this.error=e.message;
      console.error('Binance Demo exit monitor:',e.message);
      return false;
    } finally {
      this.busy=false;
    }
  }
  async cycle(evals,{rotationEnabled=false,minScore=65,scoreGap=20,maxRotations=1}={}){
    if(!this.enabled)return false;
    if(this.busy){this.error='BUY cycle skipped because execution lock is busy';return false;}
    this.busy=true;
    try{
      this.error=null;
      if(this.blocked)throw Error(this.error);this.save();await this.recover();await this.refresh();
      const soldThisCycle=new Set();
      const sellAttempts=[];
      const attemptSell=async(ev,reason='STRATEGY_SELL')=>{
        try{
          const sold=await this.sell(ev,reason);
          sellAttempts.push({
            symbol:ev.symbol,
            reason,
            ok:!!sold,
            error:null
          });
          if(sold)soldThisCycle.add(ev.symbol);
          return sold;
        }catch(e){
          sellAttempts.push({
            symbol:ev.symbol,
            reason,
            ok:false,
            error:e.message,
            code:e.code??null
          });
          // Unknown/pending orders are the only SELL failures that must stop the
          // whole cycle, because retrying other orders could create duplicates.
          if(this.state.pending)throw e;
          console.error('Binance Demo SELL rejected:',ev.symbol,reason,e.message);
          return false;
        }
      };

      const trailingExits=this.updatePeaks();
      for(const symbol of trailingExits){
        const reason=this.state.positions[symbol]?.exitTriggerReason||'STOP_LOSS';
        await attemptSell({symbol},reason);
      }
      for(const ev of evals.filter(e=>e.ok&&e.strategy?.sellConfirmed&&this.state.positions[e.symbol])){
        if(soldThisCycle.has(ev.symbol))continue;
        await attemptSell(ev,ev.strategy?.exitReason||'STRATEGY_SELL');
      }

      // Prevent a stale scan undoing an independent stop sale for five minutes.
      const recentlyStopped=new Set(this.state.actionLog.filter(a=>['TRAILING_STOP','TRAILING_PROFIT','STOP_LOSS'].includes(a.reason)&&Date.now()-Date.parse(a.at)<300000).map(a=>a.symbol));
      const candidates=evals
        .filter(e=>{
          if(!e.ok||e.symbol==='USDCUSDT'||soldThisCycle.has(e.symbol)||recentlyStopped.has(e.symbol)||!e.entryConfirmed)return false;
          const held=this.state.positions[e.symbol];
          if(!held)return Number(e.entryStage||1)===1;
          return Number(e.entryStage||0)===2 && Number(held.riskStage||1)===1;
        })
        .sort((a,b)=>b.score-a.score);

      const cycleReport={
        at:new Date().toISOString(),
        candidates:candidates.map(e=>({symbol:e.symbol,score:e.score})),
        sellAttempts,
        attempts:[],
        cashBefore:this.balance('USDT').free+(this.balance('USDC').valueUsdt||0),
        positionsBefore:Object.keys(this.state.positions).length,
        maxPositions:this.maxPositions
      };

      for(const ev of candidates){
        const addingStage2=Number(ev.entryStage||0)===2&&!!this.state.positions[ev.symbol];
        if(!addingStage2&&Object.keys(this.state.positions).length>=this.maxPositions)break;
        try{
          const result=await this.buy(ev);
          cycleReport.attempts.push({
            symbol:ev.symbol,
            score:ev.score,
            ok:!!result?.ok,
            reason:result?.reason||'UNKNOWN',
            amount:result?.amount??null,
            minimum:result?.minimum??null,
            orderId:result?.orderId??null,
            entryStage:result?.entryStage??ev.entryStage??null
          });
        }catch(e){
          cycleReport.attempts.push({
            symbol:ev.symbol,
            score:ev.score,
            ok:false,
            reason:'ERROR',
            error:e.message
          });
          // An unresolved/unknown order must still stop the cycle to avoid duplicates.
          if(this.state.pending)throw e;
          // A symbol-specific rejection must not block all other BUY candidates.
        }
      }

      cycleReport.positionsAfter=Object.keys(this.state.positions).length;
      cycleReport.cashAfter=this.balance('USDT').free+(this.balance('USDC').valueUsdt||0);
      this.state.lastCycle=cycleReport;
      this.save();

      if(rotationEnabled&&maxRotations>0&&!evals.some(e=>e.strategy?.timeframe==='1d'&&e.strategy?.wyckoff)&&Object.keys(this.state.positions).length>=this.maxPositions){
        const candidate=candidates.find(e=>!this.state.positions[e.symbol]);
        const weakest=evals.filter(e=>e.ok&&this.state.positions[e.symbol]).sort((a,b)=>Number(a.score||0)-Number(b.score||0))[0];
        if(candidate&&weakest&&candidate.score>=minScore&&candidate.score-Number(weakest.score||0)>=scoreGap){
          await this.rule(candidate.symbol);
          if(await this.sell(weakest,'ROTATION_OUT'))await this.buy(candidate);
        }
      }
    }catch(e){this.error=e.message;console.error('Binance Demo execution:',e.message);}
    finally{this.busy=false;}
    return !this.error;
  }
  snapshot(){
    const positions={};
    for(const [symbol,p] of Object.entries(this.state.positions)){
      const b=this.balance(p.asset),price=b.priceUsdt||p.entryPrice,currentValueIls=Math.min(p.qty,b.qty)*price;
      positions[symbol]={...p,currentPrice:price,currentValueIls,pnlIls:currentValueIls-p.allocationIls,pnlPct:p.allocationIls?(currentValueIls/p.allocationIls-1)*100:0};
    }
    const v=this.account?this.capital():null,initial=this.state.initialUsdt;
    return {source:'BINANCE_DEMO_SPOT',currency:'USDT',connected:!!this.account,tradingEnabled:this.enabled,strategyId:'WYCKOFF_D1_V1',targetMultiplier:1.07,trailingStopPct:null,stopLossPct:6,trailActivatePct:null,pendingOrder:this.state.pending?.clientId||null,error:this.error,initialIls:initial,cashIls:this.balance('USDT').free+(this.balance('USDC').valueUsdt||0),usdtFree:this.balance('USDT').free,valueIls:v,profitIls:v===null?null:v-initial,profitPct:initial&&v!==null?(v/initial-1)*100:0,slotIls:v===null?null:v/this.maxPositions,maxPositions:this.maxPositions,activePositions:Object.keys(positions).length,positions,trades:this.state.trades,actionLog:this.state.actionLog,lastCycle:this.state.lastCycle||null,updatedAt:this.account?.updatedAt};
  }
}
