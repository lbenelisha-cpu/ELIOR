import {createHmac,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {getDemoAccount} from './binance-demo-account.mjs';
const ORIGIN='https://demo-api.binance.com';
const terminal=new Set(['FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH','REJECTED']);
export function allocation(capital,cash,held,max=3){
  const target=capital/max,free=max-held;
  return free>0?Math.max(0,Math.min(target,cash/free)*0.998):0;
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
  constructor({key,secret,enabled=false,stateFile,fetcher=fetch,trailingStopPct=Number(process.env.BINANCE_DEMO_TRAILING_STOP_PERCENT??1)}){
    if(!Number.isFinite(trailingStopPct)||trailingStopPct<=0||trailingStopPct>=100)throw Error('Demo trailing stop percent must be between 0 and 100');
    this.trailingStopPct=trailingStopPct;
    Object.assign(this,{key,secret,enabled,stateFile,fetcher});
    this.state={positions:{},trades:[],actionLog:[],pending:null,initialUsdt:null};
    this.account=null;this.error=null;this.busy=false;this.rules=new Map();
    if(stateFile&&fs.existsSync(stateFile)){
      try{const s=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(!s.positions||!Array.isArray(s.actionLog))throw Error('Invalid state');this.state=s;}
      catch(e){this.error='Demo state cannot be read: '+e.message;this.blocked=true;}
    }
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
    if(this.state.initialUsdt===null){this.state.initialUsdt=this.capital();this.save();}
    return this.account;
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
  async submit(symbol,side,params,reason,asset){
    if(!this.enabled||this.blocked||this.state.pending)throw Error('Demo execution is paused');
    const pending={symbol,side,asset,reason,clientId:'levi-demo-'+randomUUID().replaceAll('-','').slice(0,24),at:new Date().toISOString(),previous:this.state.positions[symbol]||null};
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
      if(p.reason!=='CONVERT_USDC'){
        if(p.side==='BUY')this.state.positions[p.symbol]={symbol:p.symbol,asset:p.asset,qty:qty-baseFee,entryPrice:price,peakPrice:price,peakAt:p.at,allocationIls:quote+quoteFee,entryAt:p.at};
        else if(p.previous){
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
    if(Object.keys(this.state.positions).length>=3||this.state.positions[ev.symbol])return;
    const r=await this.rule(ev.symbol);
    if(r.quoteOrderQtyMarketAllowed===false)throw Error('Demo quote order unsupported');
    if((this.balance(r.baseAsset).valueUsdt||0)>1)throw Error('Existing unmanaged Demo holding: '+r.baseAsset);
    let amount=allocation(this.capital(),this.balance('USDT').free+this.balance('USDC').valueUsdt,Object.keys(this.state.positions).length);
    if(amount>this.balance('USDT').free*0.998&&this.balance('USDC').free>0){
      const conversion=await this.rule('USDCUSDT');
      const q=this.sellQuantity(this.balance('USDC').free,conversion);
      await this.submit('USDCUSDT','SELL',{quantity:q},'CONVERT_USDC','USDC');await this.refresh();
    }
    amount=Math.min(allocation(this.capital(),this.balance('USDT').free+(this.balance('USDC').valueUsdt||0),Object.keys(this.state.positions).length),this.balance('USDT').free*0.998);
    const precision=Math.min(8,r.quoteAssetPrecision??8);
    const text=(Math.floor(amount*10**precision)/10**precision).toFixed(precision);
    const minimum=Math.max(0,...r.filters.filter(f=>['MIN_NOTIONAL','NOTIONAL'].includes(f.filterType)).map(f=>Number(f.minNotional||0)));
    if(Number(text)<minimum||Number(text)<=0)return;
    await this.submit(ev.symbol,'BUY',{quoteOrderQty:text},'STRATEGY_BUY',r.baseAsset);await this.refresh();
  }
  async sell(ev,reason='STRATEGY_SELL'){
    const p=this.state.positions[ev.symbol];if(!p)return false;
    const r=await this.rule(ev.symbol);const q=this.sellQuantity(Math.min(p.qty,this.balance(p.asset).free),r);
    if(!(Number(q)>0))throw Error('Demo holding is unavailable for sale');
    await this.submit(ev.symbol,'SELL',{quantity:q},reason,p.asset);await this.refresh();return !this.state.positions[ev.symbol];
  }
  updatePeaks(){
    const exits=new Set();
    for(const [symbol,p] of Object.entries(this.state.positions)){
      const price=Number(this.balance(p.asset).priceUsdt);
      if(!Number.isFinite(price)||price<=0)continue;
      // Older positions start with the entry and the first observed live price.
      // Historical intraday peaks are not inferred from daily candles.
      const stored=Number(p.peakPrice);
      const peak=Math.max(Number(p.entryPrice),Number.isFinite(stored)&&stored>0?stored:0,price);
      if(p.peakPrice!==peak){p.peakPrice=peak;p.peakAt=new Date().toISOString();}
      p.drawdownPct=(peak-price)/peak*100;
      p.trailingStopPrice=peak*(1-this.trailingStopPct/100);
      if(price<=p.trailingStopPrice)exits.add(symbol);
    }
    this.save();return exits;
  }
  async cycle(evals,{rotationEnabled=false,minScore=65,scoreGap=20,maxRotations=1}={}){
    if(!this.enabled||this.busy)return;this.busy=true;
    try{
      this.error=null;
      if(this.blocked)throw Error(this.error);this.save();await this.recover();await this.refresh();
      const soldThisCycle=new Set();
      const trailingExits=this.updatePeaks();
      for(const symbol of trailingExits){
        await this.sell({symbol},'TRAILING_STOP');soldThisCycle.add(symbol);
      }
      for(const ev of evals.filter(e=>e.ok&&e.strategy?.sellConfirmed&&this.state.positions[e.symbol])){await this.sell(ev);soldThisCycle.add(ev.symbol);}
      const candidates=evals.filter(e=>e.ok&&e.symbol!=='USDCUSDT'&&!soldThisCycle.has(e.symbol)&&e.closedStrategy?.buyConfirmed&&!this.state.positions[e.symbol]).sort((a,b)=>b.score-a.score);
      for(const ev of candidates){if(Object.keys(this.state.positions).length>=3)break;try{await this.buy(ev);}catch(e){if(this.state.pending)throw e;this.error=e.message;}}
      if(rotationEnabled&&maxRotations>0&&Object.keys(this.state.positions).length>=3){
        const candidate=candidates.find(e=>!this.state.positions[e.symbol]);
        const weakest=evals.filter(e=>e.ok&&this.state.positions[e.symbol]).sort((a,b)=>(a.closedStrategy?.buyConfirmed?a.score:0)-(b.closedStrategy?.buyConfirmed?b.score:0))[0];
        if(candidate&&weakest&&candidate.score>=minScore&&candidate.score-(weakest.closedStrategy?.buyConfirmed?weakest.score:0)>=scoreGap){
          await this.rule(candidate.symbol);
          if(await this.sell(weakest,'ROTATION_OUT'))await this.buy(candidate);
        }
      }
    }catch(e){this.error=e.message;console.error('Binance Demo execution:',e.message);}
    finally{this.busy=false;}
  }
  snapshot(){
    const positions={};
    for(const [symbol,p] of Object.entries(this.state.positions)){
      const b=this.balance(p.asset),price=b.priceUsdt||p.entryPrice,currentValueIls=Math.min(p.qty,b.qty)*price;
      positions[symbol]={...p,currentPrice:price,currentValueIls,pnlIls:currentValueIls-p.allocationIls,pnlPct:p.allocationIls?(currentValueIls/p.allocationIls-1)*100:0};
    }
    const v=this.account?this.capital():null,initial=this.state.initialUsdt;
    return {source:'BINANCE_DEMO_SPOT',currency:'USDT',connected:!!this.account,tradingEnabled:this.enabled,trailingStopPct:this.trailingStopPct,pendingOrder:this.state.pending?.clientId||null,error:this.error,initialIls:initial,cashIls:this.balance('USDT').free+(this.balance('USDC').valueUsdt||0),usdtFree:this.balance('USDT').free,valueIls:v,profitIls:v===null?null:v-initial,profitPct:initial&&v!==null?(v/initial-1)*100:0,slotIls:v===null?null:v/3,maxPositions:3,activePositions:Object.keys(positions).length,positions,trades:this.state.trades,actionLog:this.state.actionLog,updatedAt:this.account?.updatedAt};
  }
}
