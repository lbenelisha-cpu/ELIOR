import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {reviewInput,orderBody,reviewOutcome,REVIEW_MAX_AGE} from '../lib/trader-live-review.mjs';
import {accountCheckDetails,protectionState} from '../lib/binance-dashboard-math.mjs';
import {createPaperMonitor} from '../netlify/functions/trader-auto-monitor.mjs';
const now=Date.now(),health={ready:true,journalReady:true,reconciliation:{ready:true,checkedAt:new Date(now).toISOString()},missingProtection:[]};
test('account check explanation identifies separate real readiness failures without inventing a cause',()=>{
  for(const [patch,expected] of [
    [{journalReady:false},'יומן העסקאות'],[{pendingOrder:true},'פקודת מסחר'],
    [{reconciliation:{...health.reconciliation,unmanaged:['BTCUSDT']}},'פוזיציה מנוהלת'],
    [{reconciliation:{...health.reconciliation,pending:[{symbol:'ETHUSDT',walletQty:1,recordedQty:2}]}},'פער כמות'],
    [{reconciliation:{...health.reconciliation,unsettled:['BTCUSDT']}},'מילוי של פקודת הגנה'],
    [{reconciliation:{...health.reconciliation,error:'NATIVE_PROTECTION_PENDING_RECONCILIATION'}},'אימות פקודות ההגנה']]) {
    const h={...health,...patch,ready:false};assert.ok(accountCheckDetails(h,now).some(t=>t.includes(expected)));
    assert.ok(protectionState(h,now).text.includes(expected));
  }
  assert.deepEqual(accountCheckDetails(health,now),[]);
  assert.match(accountCheckDetails({...health,ready:false},now)[0],/בלי פירוט נוסף/);
  assert.ok(accountCheckDetails(health,now+61000).some(t=>t.includes('אין אימות חשבון עדכני')));
});
test('review binds platform, symbol, side and exact quote amount; stale or failed account checks cannot buy',()=>{
  for(const platform of ['BINANCE','COLMEX']){
    const symbol=platform==='BINANCE'?'BTCUSDT':'AAPL',snapshot={loadedAt:now,enabled:true,maxAmount:400,cash:1000,positions:[{symbol,quantity:2}]};
    const r=reviewInput(platform,{symbol,side:'BUY',amount:37.21},snapshot,now),body=orderBody(r,randomUUID());
    assert.equal(body.symbol,symbol);assert.equal(body.quoteUsdt??body.amountUsd,37.21);
    assert.throws(()=>reviewInput(platform,{symbol,side:'BUY',amount:10},{...snapshot,buyBlocked:true},now),/ACCOUNT_CHECK/);
    assert.throws(()=>reviewInput(platform,{symbol,side:'BUY',amount:10},snapshot,now+60001),/REFRESH/);
    assert.throws(()=>reviewInput(platform,{symbol,side:'BUY',amount:401},snapshot,now),/AMOUNT/);
    const sell=orderBody(reviewInput(platform,{symbol,side:'SELL'},snapshot,now),randomUUID());assert.equal(sell.side,'SELL');
    assert.equal(sell.quoteUsdt,undefined);assert.equal(sell.amountUsd,undefined);
  }
});
test('broker acceptance is pending until filled, uncertainty is retained and status-not-recorded never becomes a retry',()=>{
  assert.equal(reviewOutcome('COLMEX',{status:'PENDING',acknowledged:true}).terminal,false);
  assert.equal(reviewOutcome('COLMEX',{status:'NOT_RECORDED'}).terminal,false);
  assert.equal(reviewOutcome('COLMEX',{status:'FILLED'}).terminal,true);
  assert.equal(reviewOutcome('BINANCE',{ok:false,uncertain:true},400).terminal,false);
  assert.equal(reviewOutcome('BINANCE',{ok:true,order:{status:'NEW'}}).terminal,false);
  assert.equal(reviewOutcome('BINANCE',{ok:true,order:{status:'FILLED',executedQty:1,orderId:1}}).terminal,true);
});
function ui({failStorage=false,uncertain=false,unready=false}={}){
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.value='';this.open=false;this.hidden=false;this.disabled=false;}
    append(...items){for(const item of items){this.children.push(item);item.parentElement=this;}}
    replaceChildren(...items){this.children=[];this.append(...items);}
    addEventListener(name,fn){this.listeners[name]=fn;}
    dispatchEvent(e){return this.listeners[e.type]?.(e);}
    setAttribute(){} focus(){} showModal(){this.open=true;} close(){this.open=false;}
  }
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const storage=new Map([['levi-binance-control-v1','test-device'],['levi-colmex-device-v1','test-device']]);
  const calls=[],timers=[];
  const fetchImpl=async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push({url,options,body});
    if(body){
      if(url.includes('binance-live/manual'))return {status:200,ok:true,json:async()=>uncertain?{ok:false,uncertain:true}:{ok:true,order:{status:'FILLED',executedQty:1,orderId:2}}};
      if(url.endsWith('colmex-manual-trade'))return {status:202,ok:true,json:async()=>({ok:true,status:'PENDING',acknowledged:true})};
      throw Error('Unexpected mutation: '+url);
    }
    const path=new URL(url,'https://app.test').searchParams.get('path')||url;
    let data;
    if(path==='/api/binance-mode')data={mode:'live',manualTrading:{version:1,maxOrderUsdt:400},liveTradingEnabled:true,autoExecution:true,exitSettings:{stopLossPct:1,takeProfitPct:50,profitActivationPct:5}};
    else if(path==='/api/binance-agent')data={mode:'live',agents:[],config:{liveState:{...health,ready:!unready}}};
    else if(path==='/api/binance-live-account')data={connected:true,account:{usdtFree:1000,balances:[{asset:'ETH',qty:2,usdtPrice:100}]}};
    else if(path.endsWith('colmex-auto-status'))data={enabled:true,status:'MONITORING',lastCompletedAt:Date.now(),policy:{notionalUsd:800,stopLossPct:1,takeProfitPct:50,profitActivationPct:5},positions:[{symbol:'MSFT',qty:1}],checks:{}};
    else if(path.includes('colmex-manual-trade?requestId='))data={status:'FILLED'};
    else throw Error('Unexpected read: '+path);
    return {status:200,ok:true,json:async()=>data};
  };
  const context=vm.createContext({document:{getElementById:get,createElement:tag=>new Element(tag),hidden:false},localStorage:{getItem:k=>storage.get(k)||null,
    setItem:(k,v)=>{if(failStorage)throw Error('denied');storage.set(k,v);},removeItem:k=>storage.delete(k)},
    fetch:fetchImpl,AbortSignal,URL,Event:class{constructor(type){this.type=type;}},crypto:{randomUUID},setInterval:fn=>timers.push(fn),
    reviewInput,orderBody,reviewOutcome,REVIEW_MAX_AGE,protectionState,accountCheckDetails});
  const source=fs.readFileSync(new URL('../trader-live-ui.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source,context);
  const find=(el,predicate)=>predicate(el)?el:el.children.map(c=>find(c,predicate)).find(Boolean);
  const form=platform=>find(get('liveCards').children[platform==='BINANCE'?0:1],e=>e.tag==='form');
  return {get,storage,calls,timers,context,form,field:(platform,name)=>find(form(platform),e=>e.name===name),post:()=>calls.filter(c=>c.options.method==='POST')};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function prepare(h,platform,side='BUY'){
  await flush();h.field(platform,'symbol').value=platform==='BINANCE'?(side==='BUY'?'BTCUSDT':'ETHUSDT'):(side==='BUY'?'AAPL':'MSFT');
  h.field(platform,'side').value=side;h.field(platform,'amount').value='25';
  await h.form(platform).listeners.submit({preventDefault(){}});
}
test('both platforms read and prepare without any order; only final user confirmation posts once',async()=>{
  for(const platform of ['BINANCE','COLMEX'])for(const side of ['BUY','SELL']){
    const h=ui();await prepare(h,platform,side);assert.equal(h.post().length,0);assert.equal(h.get('liveReviewDialog').open,true);
    const click=h.get('liveReviewConfirm').listeners.click();h.get('liveReviewConfirm').listeners.click();await click;
    assert.equal(h.post().length,1);assert.equal(h.post()[0].body.side,side);
    assert.equal(h.post()[0].body.quoteUsdt??h.post()[0].body.amountUsd,side==='BUY'?25:undefined);
    assert.ok(h.post()[0].options.headers.Authorization);assert.ok(!h.post()[0].url.includes('test-device'));
  }
});
test('cancel, ordinary polling, failed account checks and failed local persistence never submit',async()=>{
  const a=ui();await prepare(a,'BINANCE');a.get('liveReviewCancel').listeners.click();await a.get('liveReviewConfirm').listeners.click();
  a.timers[0]();await flush();assert.equal(a.post().length,0);
  const b=ui({unready:true});await prepare(b,'BINANCE');assert.equal(b.get('liveReviewDialog').open,false);assert.equal(b.post().length,0);
  const c=ui({failStorage:true});await prepare(c,'COLMEX');await c.get('liveReviewConfirm').listeners.click();assert.equal(c.post().length,0);
});
test('unknown results retain the request across reload and only the original identity is checked',async()=>{
  const h=ui({uncertain:true});await prepare(h,'BINANCE');await h.get('liveReviewConfirm').listeners.click();
  const original=h.post()[0].body;assert.ok(h.storage.get('levi-binance-review-pending-v1'));
  await h.get('liveReviewCheck').listeners.click();assert.equal(h.post().length,2);assert.equal(h.post()[1].body.requestId,original.requestId);
  assert.equal(h.post()[1].body.statusOnly,true);await h.get('liveReviewConfirm').listeners.click();assert.equal(h.post().length,2);
});
test('paper cron is now dormant by default and does not initialize either ledger',async()=>{
  let calls=0;const monitor=createPaperMonitor({env:{},getStore:()=>{calls++;throw Error('must not run');}});
  assert.equal((await monitor(new Request('https://app.test'),{deploy:{context:'production'}})).status,204);assert.equal(calls,0);
});
