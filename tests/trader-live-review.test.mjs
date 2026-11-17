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
function ui({failStorage=false,uncertain=false,unready=false,storedBinance,binanceDevice=true}={}){
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
  if(!binanceDevice)storage.delete('levi-binance-control-v1');
  if(storedBinance)storage.set('levi-binance-review-pending-v1',JSON.stringify(storedBinance));
  const calls=[],timers=[],navigations=[];
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
  const context=vm.createContext({document:{getElementById:get,createElement:tag=>new Element(tag),querySelectorAll:()=>[],hidden:false},localStorage:{getItem:k=>storage.get(k)||null,
    setItem:(k,v)=>{if(failStorage)throw Error('denied');storage.set(k,v);},removeItem:k=>storage.delete(k)},
    location:{assign:url=>navigations.push(url)},fetch:fetchImpl,AbortSignal,URL,Event:class{constructor(type){this.type=type;}},crypto:{randomUUID},setInterval:fn=>timers.push(fn),
    reviewInput,orderBody,reviewOutcome,REVIEW_MAX_AGE,protectionState,accountCheckDetails});
  const source=fs.readFileSync(new URL('../trader-live-ui.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(fs.readFileSync(new URL('../tradingview-link.js',import.meta.url),'utf8'),context);
  vm.runInContext(source,context);
  const find=(el,predicate)=>predicate(el)?el:el.children.map(c=>find(c,predicate)).find(Boolean);
  const form=platform=>find(get('liveCards').children[platform==='BINANCE'?0:1],e=>e.tag==='form');
  return {get,storage,calls,timers,context,form,navigations,
    button:(platform,label)=>find(get('liveCards').children[platform==='BINANCE'?0:1],e=>e.tag==='button'&&e.textContent.includes(label)),
    field:(platform,name)=>find(form(platform),e=>e.name===name),post:()=>calls.filter(c=>c.options.method==='POST')};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function prepareColmex(h,side='BUY'){
  await flush();h.field('COLMEX','symbol').value=side==='BUY'?'AAPL':'MSFT';
  h.field('COLMEX','side').value=side;h.field('COLMEX','amount').value='25';
  await h.form('COLMEX').listeners.submit({preventDefault(){}});
}
test('Colmex review confirms a buy or sell exactly once with the original amount and credential',async()=>{
  for(const side of ['BUY','SELL']){
    const h=ui();await prepareColmex(h,side);assert.equal(h.post().length,0);assert.equal(h.get('liveReviewDialog').open,true);
    const click=h.get('liveReviewConfirm').listeners.click();h.get('liveReviewConfirm').listeners.click();await click;
    assert.equal(h.post().length,1);assert.equal(h.post()[0].body.side,side);
    assert.equal(h.post()[0].body.amountUsd,side==='BUY'?25:undefined);
    assert.ok(h.post()[0].options.headers.Authorization);assert.ok(!h.post()[0].url.includes('test-device'));
  }
});
test('Binance research card opens the selected TradingView Spot instrument without a trade or a device token',async()=>{
  const h=ui({unready:true,binanceDevice:false});
  const pair=h.field('BINANCE','symbol'),form=h.form('BINANCE');
  const submit=()=>form.listeners.submit({preventDefault(){}});
  assert.equal(h.field('BINANCE','amount'),undefined);assert.equal(h.field('BINANCE','side'),undefined);
  for(const [input,resolved] of [['BTCUSDT','BTCUSDT'],['AAOI','AAOIBUSDT'],['AAOIUSDT','AAOIBUSDT']]){
    pair.value=input;pair.dispatchEvent({type:'input'});
    const button=h.button('BINANCE',resolved);
    assert.ok(button);assert.equal(button.disabled,false);
    if(input.includes('AAOI'))assert.match(button.textContent,/bStock/);
    submit();
    const url=new URL(h.navigations.at(-1));
    assert.equal(url.searchParams.get('symbol'),'BINANCE:'+resolved);assert.equal(url.searchParams.has('amount'),false);
    assert.equal(h.get('liveReviewDialog').open,false);await h.get('liveReviewConfirm').listeners.click();assert.equal(h.post().length,0);
  }
  pair.value='https://elsewhere.test';submit();assert.equal(h.navigations.length,3);
  assert.equal(h.storage.has('levi-binance-review-pending-v1'),false);
});
test('cancel, ordinary polling and failed local persistence never submit a Colmex order',async()=>{
  const a=ui();await prepareColmex(a);a.get('liveReviewCancel').listeners.click();await a.get('liveReviewConfirm').listeners.click();
  a.timers[0]();await flush();assert.equal(a.post().length,0);
  const c=ui({failStorage:true});await prepareColmex(c);await c.get('liveReviewConfirm').listeners.click();assert.equal(c.post().length,0);
});
test('legacy Binance requests are reconciled status-only, including uncertain responses after a reload',async()=>{
  const original={requestId:randomUUID(),symbol:'BTCUSDT',side:'BUY',quoteUsdt:25};
  for(const uncertain of [true,false]){
    const h=ui({uncertain,storedBinance:original});await flush();
    h.field('BINANCE','symbol').value='BTCUSDT';await h.form('BINANCE').listeners.submit({preventDefault(){}});
    assert.deepEqual(h.navigations,[]);assert.equal(h.post().length,0);
    await h.button('BINANCE','בדוק תוצאת').listeners.click();
    assert.equal(h.post().length,1);assert.deepEqual(h.post()[0].body,{...original,statusOnly:true});
    await h.get('liveReviewConfirm').listeners.click();assert.equal(h.post().length,1);
    assert.equal(h.storage.has('levi-binance-review-pending-v1'),uncertain);
  }
});
test('paper cron is now dormant by default and does not initialize either ledger',async()=>{
  let calls=0;const monitor=createPaperMonitor({env:{},getStore:()=>{calls++;throw Error('must not run');}});
  assert.equal((await monitor(new Request('https://app.test'),{deploy:{context:'production'}})).status,204);assert.equal(calls,0);
});
