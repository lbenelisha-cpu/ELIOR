// Read-only observations. No broker, order, account or credential dependency.
import {NEWS_SOURCES,newsAsset,assessNewsEntry} from './market-news.mjs';
import {comparisonBars} from './entry-method-comparison.mjs';
import '../regression-trend.js';
import '../parallel-channel.js';
const STEP=300000,DAY=86400000;
export const ATTENTION_POLICY=Object.freeze({version:'MARKET_ATTENTION_V1',mode:'OBSERVATION_ONLY',period:50,interval:'5m',newsAgeMs:21600000,sourceAgeMs:900000,observerAgeMs:180000,maxSymbols:150,maxEvents:300});
const fresh=(at,now,age)=>Number.isFinite(at)&&at>0&&at<=now&&now-at<age;
const safeSymbol=s=>typeof s==='string'&&/^[A-Z0-9]{2,24}$/.test(s);
function sourceLink(row){
 const source=NEWS_SOURCES.find(s=>s.id===row.sourceId);if(!source)return false;
 try{const u=new URL(row.url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname===source.host;}catch{return false;}
}
export function newsAttention(snapshot,symbol,now=Date.now()){
 const asset=newsAsset(symbol),p=ATTENTION_POLICY;
 const usable=!snapshot?.storageError&&fresh(snapshot?.collectedAt,now,p.sourceAgeMs);
 const sources=new Map((snapshot?.sources||[]).map(s=>[s.id,s]));
 const rows=(snapshot?.items||[]).filter(r=>asset&&r.assets?.some(a=>a.id===asset)&&sourceLink(r)&&fresh(r.publishedAt,now,p.newsAgeMs)&&fresh(r.firstSeenAt,now,7*DAY)&&r.firstSeenAt>=r.publishedAt);
 const seen=new Set();
 const evidence=rows.sort((a,b)=>b.publishedAt-a.publishedAt).filter(r=>{const key=r.group+':'+r.title.toLowerCase().replace(/[^a-z0-9]/g,'');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,5).map(r=>{
  const source=sources.get(r.sourceId),active=usable&&source?.status==='OK'&&fresh(source.lastSuccessAt,now,p.sourceAgeMs);
  return {id:r.id,title:r.title,url:r.url,source:r.source,kind:r.kind,publishedAt:r.publishedAt,firstSeenAt:r.firstSeenAt,checkedAt:source?.lastSuccessAt??null,active,
   expiresAt:active?Math.min(r.publishedAt+p.newsAgeMs,source.lastSuccessAt+p.sourceAgeMs,snapshot.collectedAt+p.sourceAgeMs):null,
   verification:r.revised?'REVISED':r.uncertain?'UNCERTAIN':r.editorial?'SINGLE_REPORT':'COMPANY_OR_SYNDICATED'};
 });
 // Reuse the narrow historical event matcher only to describe matching reports.
 // Its old entry actions are deliberately not returned or used by any executor.
 const match=assessNewsEntry(snapshot,symbol,{enabled:true,enabledAfter:Math.max(1,now-3600000)},now);
 return {asset,covered:!!asset,active:evidence.some(r=>r.active),evidence,
  matchingReports:match.evidence?.length>=2?match.evidence:[],
  status:!asset?'UNMAPPED':!usable?'NEWS_UNAVAILABLE':evidence.some(r=>r.active)?'NEWS_WATCH':'NO_FRESH_REPORT',
  expiresAt:Math.max(0,...evidence.filter(r=>r.active).map(r=>r.expiresAt))||null};
}
export function technicalObservation({symbol,bars=[],at=Date.now(),error=null,positionOpen=false}){
 const base={symbol,checkedAt:at,dataAt:null,expiresAt:null,ready:false,watch:false,period:50,market:'BINANCE_SPOT',reason:error||'WAIT_HISTORY'};
 if(positionOpen)return {...base,reason:'POSITION_MANAGEMENT_ONLY'};
 if(error)return base;
 let data;try{data=comparisonBars(bars,at,'BINANCE').slice(-51);}catch{return {...base,reason:'INVALID_HISTORY'};}
 if(data.length<50)return base;
 // Geometry matches the 50 closed candles before the current intrabar trigger.
 // Observer volume below remains the last completed candle, not an entry gate.
 const signal=data.at(-1),history=data.slice(-50);
 if(data.some((b,i)=>i&&b.closeTime-data[i-1].closeTime!==STEP))return {...base,reason:'GAPPED_HISTORY'};
 if(!fresh(signal.closeTime,at,STEP))return {...base,dataAt:signal.closeTime,reason:'STALE_HISTORY'};
 const mapped=history.map((b,i)=>({...b,openTime:STEP*(i+1),closeTime:STEP*(i+2)}));
 const options={period:50,interval:'5m',now:52*STEP,deviations:2,requireConfirmed:false};
 const confirmedChannel=globalThis.LEVI_PARALLEL.analyze(mapped,{...options,requireConfirmed:true});
 const channel=confirmedChannel.ready?confirmedChannel:globalThis.LEVI_PARALLEL.analyze(mapped,options),reg=globalThis.LEVI_REGRESSION.analyze(mapped,options);
 const levels=channel.ready?globalThis.LEVI_REGRESSION.levels(channel,51*STEP):null;
 const center=reg.ready?globalThis.LEVI_REGRESSION.levels(reg,51*STEP).middle:null;
 const previous=data.slice(-21,-1),volumeValid=[...previous,signal].every(b=>Number.isFinite(b.volume)&&b.volume>=0);
 const mean=volumeValid?previous.reduce((n,b)=>n+b.volume,0)/20:null;
 const ratio=mean>0?signal.volume/mean:null;
 const dollars=volumeValid?previous.reduce((n,b)=>n+b.close*b.volume,0)/20:null;
 const upper=levels?.upper,lower=levels?.lower,width=levels?upper-lower:null;
 const confirmed=!!channel.ready&&!channel.provisional&&channel.lowTouches>=2&&channel.highTouches>=2;
 const side=reg.ready&&reg.slope>0?'UP':reg.ready&&reg.slope<0?'DOWN':'FLAT';
 const near=confirmed&&width>0&&(side==='UP'?Math.abs(signal.close-upper)<=width*.25:side==='DOWN'?Math.abs(signal.close-lower)<=width*.25:false);
 const reason=!channel.ready?'WAIT_CHANNEL_PIVOTS':!confirmed?'WAIT_TWO_TOUCHES':near?'NEAR_CHANNEL_BOUNDARY':'CHANNEL_OBSERVED';
 return {...base,ready:true,dataAt:signal.closeTime,expiresAt:Math.min(at+ATTENTION_POLICY.observerAgeMs,signal.closeTime+STEP),price:signal.close,reason,watch:near,side,
  channel:channel.ready?{lowTouches:channel.lowTouches,highTouches:channel.highTouches,confirmed,upper,lower}:null,
  regression:reg.ready?{slope:reg.slope,center,side}:null,
  volume:{basis:'LAST_CLOSED_BAR',ratio,meanDollarVolume:dollars,ratioPassed:ratio!=null&&ratio>=1.5,liquidityPassed:dollars!=null&&dollars>=10000},
  missing:[...(!confirmed?['TWO_TOUCHES_EACH_SIDE']:[]),...(!reg.ready?['REGRESSION']:[]),...(ratio==null?['VOLUME_DATA']:ratio<1.5?['VOLUME_RATIO']:[]),...(dollars==null?[]:dollars<10000?['LIQUIDITY']:[])]};
}
export function recordAttention(state,input){
 if(!safeSymbol(input.symbol))return;
 const row=technicalObservation(input),p=ATTENTION_POLICY;
 let root=state.marketAttention;
 if(root?.version!==p.version)root=state.marketAttention={version:p.version,observations:{},events:[]};
 const old=root.observations[row.symbol];
 root.observations[row.symbol]=row;
 root.observations=Object.fromEntries(Object.entries(root.observations).sort((a,b)=>b[1].checkedAt-a[1].checkedAt).slice(0,p.maxSymbols));
 const signature=r=>JSON.stringify([r?.dataAt,r?.reason,r?.channel?.lowTouches,r?.channel?.highTouches,r?.watch]);
 if(signature(old)!==signature(row))root.events.push({symbol:row.symbol,at:row.checkedAt,dataAt:row.dataAt,reason:row.reason,watch:row.watch});
 root.events=root.events.filter(e=>fresh(e.at,row.checkedAt,DAY)).slice(-p.maxEvents);
 return row;
}
export function prioritizeObservationSymbols(symbols,news,now=Date.now()){
 // Stable ordering of the same read-only universe; never an execution candidate list.
 return [...new Set(symbols)].filter(safeSymbol).map((symbol,index)=>({symbol,index,active:newsAttention(news,symbol,now).active})).sort((a,b)=>Number(b.active)-Number(a.active)||a.index-b.index).map(r=>r.symbol);
}
export function attentionSnapshot({state,news,symbols=[],now=Date.now(),mode='live',storageError=null,diagnostics={},shortChecks={},shortReason=null,sharedWatch=null,longEntryBlocker=null}){
 const live=mode==='live',p=ATTENTION_POLICY;
 const shared=sharedWatch?.policy?.version==='SHARED_LONG_SHORT_WATCH_V1'?sharedWatch:null;
 const mapped=new Map((shared?.rows||[]).map(r=>[r.spotSymbol,r]));
 const rows=[...new Set(symbols)].filter(safeSymbol).slice(0,p.maxSymbols).map(symbol=>{
  const n=newsAttention(news,symbol,now),old=state?.marketAttention?.observations?.[symbol];
  const current=live&&!storageError&&old?.ready&&fresh(old.checkedAt,now,p.observerAgeMs)&&old.expiresAt>now&&fresh(old.dataAt,now,STEP);
  const technical=current?old:{...old,symbol,ready:false,watch:false,reason:!live?'LIVE_OBSERVER_ONLY':storageError?'OBSERVER_STORAGE_UNAVAILABLE':old?.ready?'STALE_OBSERVATION':old?.reason||'WAIT_OBSERVATION'};
  const diagnostic=diagnostics[symbol],mapping=mapped.get(symbol),short=shortChecks[mapping?mapping.futuresSymbol:symbol];
  return {symbol,news:n,technical,attention:n.active||technical.watch,shortObservation:live?mapping||null:null,entryBlockers:{long:longEntryBlocker,short:shared?.entryBlocker??null},
   expiresAt:Math.max(n.expiresAt||0,technical.watch?technical.expiresAt:0)||null,
   longDecision:live&&fresh(diagnostic?.at,now,90000)?{at:diagnostic.at,reason:diagnostic.reason,conditions:diagnostic.conditions||null,blocker:diagnostic.entryBlockReason}:null,
   shortDecision:live&&fresh(short?.at,now,120000)?{at:short.at,reason:short.reason}:null};
 }).sort((a,b)=>Number(b.news.active)-Number(a.news.active)||Number(b.technical.watch)-Number(a.technical.watch)||a.symbol.localeCompare(b.symbol));
 return {policy:p,checkedAt:now,mode,storageError,shortReason,sharedWatchPolicy:shared?.policy||null,rows,
  sourceStatus:(news?.sources||[]).map(s=>({id:s.id,name:s.name,ok:!news?.storageError&&s.status==='OK'&&fresh(s.lastSuccessAt,now,p.sourceAgeMs),lastSuccessAt:s.lastSuccessAt??null,error:s.error??null})),
  events:(state?.marketAttention?.events||[]).filter(e=>fresh(e.at,now,DAY)).slice(-30).reverse()};
}
