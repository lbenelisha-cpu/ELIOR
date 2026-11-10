import {futuresTrendHistory} from './futures-trend-history.mjs';
// Shared identities and public-data observation. This module cannot submit orders.
import {isBstock} from './balanced-universe.mjs';
import {STABLE_BASES} from './binance-quality-policy.mjs';
import {shortSignal} from './futures-short-policy.mjs';

export const SHARED_WATCH_POLICY=Object.freeze({version:'SHARED_LONG_SHORT_WATCH_V1',maxSymbols:150,intervalMs:2000,marketAgeMs:300000,observationAgeMs:180000,mode:'READ_ONLY'});
const symbolOK=s=>typeof s==='string'&&/^[A-Z0-9]{2,24}USDT$/.test(s);
const fresh=(at,now,age)=>Number.isFinite(at)&&at>0&&at<=now&&now-at<age;
export function sharedWatchRows(symbols,catalog=null){
 const source=[...new Set(Array.isArray(symbols)?symbols.filter(symbolOK):[])].slice(0,SHARED_WATCH_POLICY.maxSymbols);
 return source.map(spotSymbol=>{
  const stock=isBstock(spotSymbol),base=spotSymbol.slice(0,-4),underlying=stock?base.slice(0,-1):base;
  const candidateSymbol=underlying+'USDT';
  const matches=Array.isArray(catalog)?catalog.filter(i=>i?.symbol===candidateSymbol):[];
  const info=matches.length===1?matches[0]:null;
  const available=!!info&&info.baseAsset===underlying&&info.status==='TRADING'&&info.contractType==='PERPETUAL'&&info.marginAsset==='USDT'&&info.quoteAsset==='USDT'&&!STABLE_BASES.has(underlying);
  return {spotSymbol,asset:stock?'stock:'+underlying:'crypto:'+base,candidateSymbol,futuresSymbol:available?candidateSymbol:null,available,
   mappingReason:catalog===null?'FUTURES_MARKETS_UNVERIFIED':available?'FUTURES_CONTRACT_VERIFIED':'FUTURES_SYMBOL_UNAVAILABLE'};
 });
}

export class SharedMarketWatch{
 constructor({read,symbols,config,boundary=()=>({}),entryBlocker=()=>null,now=Date.now}){
  Object.assign(this,{read,symbols,config,boundary,entryBlocker,now});
  this.catalog=null;this.marketAt=0;this.retryAt=0;this.marketError=null;this.checks={};this.cursor=0;this.busy=false;this.lastTick=0;
 }
 mapping(){
  const now=this.now(),valid=!this.marketError&&fresh(this.marketAt,now,SHARED_WATCH_POLICY.marketAgeMs);
  return sharedWatchRows(this.symbols(),valid?this.catalog:null);
 }
 snapshot(){
  const now=this.now(),blocker=this.entryBlocker();
  return {policy:SHARED_WATCH_POLICY,checkedAt:now,marketAt:this.marketAt||null,marketError:this.marketError,entryBlocker:blocker,
   rows:this.mapping().map(row=>{
    const check=row.futuresSymbol?this.checks[row.futuresSymbol]:null;
    const current=row.available&&fresh(check?.at,now,SHARED_WATCH_POLICY.observationAgeMs)&&check.expiresAt>now;
    return {...row,at:check?.at??null,expiresAt:current?check.expiresAt:null,ready:current&&check.ready===true,
     reason:!row.available?row.mappingReason:current?check.reason:check?'STALE_SHORT_OBSERVATION':'WAIT_SHORT_OBSERVATION',
     conditions:current?check.conditions||null:null,consolidation:current?check.consolidation:null,entryBlocker:blocker,observationOnly:true};
   })};
 }
 async tick(){
  const start=this.now();if(this.busy||start-this.lastTick<SHARED_WATCH_POLICY.intervalMs)return;
  this.busy=true;this.lastTick=start;let symbol;
  try{
   if(!fresh(this.marketAt,start,SHARED_WATCH_POLICY.marketAgeMs)||this.marketError){
    if(start<this.retryAt)return;
    try{
     const info=await this.read('/fapi/v1/exchangeInfo');
     if(!Array.isArray(info?.symbols)||!info.symbols.length)throw Error('FUTURES_MARKETS_UNVERIFIED');
     this.catalog=info.symbols;this.marketAt=this.now();this.marketError=null;
    }catch{this.marketError='FUTURES_MARKETS_UNVERIFIED';this.retryAt=this.now()+30000;return;}
   }
   const mapped=this.mapping(),symbols=[...new Set(mapped.filter(r=>r.available).map(r=>r.futuresSymbol))];
   this.checks=Object.fromEntries(Object.entries(this.checks).filter(([s])=>symbols.includes(s)));
   if(!symbols.length)return;
   symbol=symbols[this.cursor++%symbols.length];
   const raw=await futuresTrendHistory(this.read,symbol,this.now());
   if(!Array.isArray(raw))throw Error('FUTURES_HISTORY_UNVERIFIED');
   const receivedAt=this.now();
   const bars=raw.map(r=>({openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6])+1,closed:Number(r[6])+1<=receivedAt,receivedAt}));
   const q=await this.read('/fapi/v1/ticker/bookTicker',{symbol}),at=this.now();
   if(q?.symbol!==symbol||!fresh(Number(q.time),at,10000)||!(Number(q.bidPrice)>0)||!(Number(q.askPrice)>=Number(q.bidPrice)))throw Error('WAIT_FRESH_FUTURES_PRICE');
   const liveBar=bars.find(b=>!b.closed&&b.openTime===Math.floor(at/300000)*300000);
   const original=this.config(),boundary=this.boundary(symbol);
   // Execution activation is reported separately. Never authorize from this result.
   const config={...original,enabled:true,enabledAfter:original.enabledAfter||1};
   const result=shortSignal({bars:bars.slice(-206),trendBars:bars,price:Number(q.bidPrice),priceAsOf:Number(q.time),now:at,liveBar,...boundary},config);
   this.checks[symbol]={at,expiresAt:Math.min(at+SHARED_WATCH_POLICY.observationAgeMs,(Math.floor(at/300000)+1)*300000),ready:result.ready,reason:result.reason,conditions:result.conditions,consolidation:result.consolidation||result.setup?.consolidation||null};
  }catch(error){if(symbol)this.checks[symbol]={at:this.now(),expiresAt:this.now()+30000,ready:false,reason:['WAIT_FRESH_FUTURES_PRICE','FUTURES_HISTORY_UNVERIFIED'].includes(error.message)?error.message:'FUTURES_OBSERVATION_UNAVAILABLE'};}
  finally{this.busy=false;}
 }
}
