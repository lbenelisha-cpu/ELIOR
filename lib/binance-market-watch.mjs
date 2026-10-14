import {evaluateWyckoff} from './wyckoff-strategy.mjs';
import {assessQualityEntry,STABLE_BASES,ENTRY_POLICY_VERSION} from './binance-quality-policy.mjs';
const DAY=86400000,STEP=300000;
export function spotUsdtUniverse(info){return (info.symbols||[]).filter(s=>s.status==='TRADING'&&s.quoteAsset==='USDT'&&s.isSpotTradingAllowed!==false).map(s=>s.symbol).sort();}
export function recordedEntryAudit(history,{now=Date.now(),mode='live'}={}){
 const events=new Map(),errors=new Map();let covered=0;
 for(const [symbol,rows] of Object.entries(history)){
  const recent=rows.filter(r=>r.mode===mode&&Date.parse(r.at)>=now-DAY&&Date.parse(r.at)<=now);if(recent.length)covered++;
  for(const r of recent){if(r.analysisError){errors.set(symbol,(errors.get(symbol)||0)+(r.checks||1));continue;}if(!r.analysisSignal&&!r.entryConfirmed)continue;
   const pattern=r.setup?.patternId||r.setup?.signalTime||r.at,reason=r.buyReason||r.blockerCode||r.reason||'UNKNOWN',key=symbol+':'+pattern+':'+reason;
   if(!events.has(key))events.set(key,{symbol,pattern,reason,at:r.at,firstAt:r.firstAt||r.at,checks:0});events.get(key).checks+=r.checks||1;
  }
 }
 const rows=[...events.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));const reasons={};for(const r of rows)reasons[r.reason]=(reasons[r.reason]||0)+1;
 return {source:'RECORDED_DECISIONS',since:new Date(now-DAY).toISOString(),coveredSymbols:covered,distinctPatterns:new Set(rows.map(r=>r.symbol+':'+r.pattern)).size,reasons,rows,dataErrors:[...errors].map(([symbol,checks])=>({symbol,checks}))};
}
export function replayEntryChecks(symbol,bars,{now=Date.now(),since=now-DAY}={}){
 const events=[];for(let i=2;i<bars.length;i++){
  const at=Number(bars[i].closeTime);if(at<since||at>now)continue;
  const history=bars.slice(Math.max(0,i-2015),i+1),setup=evaluateWyckoff(history,{now:at,timeframe:'5m'});if(!setup.buyConfirmed)continue;
  const quality=assessQualityEntry(symbol,history,{now:at,estimatedCostPct:.3});events.push({symbol,at:new Date(at).toISOString(),pattern:setup.patternId,reason:quality.code,source:'HISTORICAL_REPLAY_CURRENT_RULES',volumeRatio:quality.volumeRatio??null});
 }return events;
}
export class MarketWatch{
 constructor({fetchJson,initial={},save=()=>{},now=()=>Date.now()}){this.fetchJson=fetchJson;this.save=save;this.now=now;this.state={symbols:[],latest:{},events:[],...initial};if(this.state.entryPolicyVersion!==ENTRY_POLICY_VERSION){this.state.events=[];this.state.latest={};this.state.entryPolicyVersion=ENTRY_POLICY_VERSION;}this.cache=new Map();this.cursor=0;this.running=false;this.refreshAt=0;this.startedAt=new Date(this.now()).toISOString();}
 async refresh(){const info=await this.fetchJson('/api/v3/exchangeInfo');this.state.symbols=spotUsdtUniverse(info);this.refreshAt=this.now();this.state.error=null;const set=new Set(this.state.symbols);for(const key of this.cache.keys())if(!set.has(key))this.cache.delete(key);}
 async bars(symbol){const end=Math.floor(this.now()/STEP)*STEP-1,old=this.cache.get(symbol)||[];let cursor=old.length?old.at(-1).closeTime+1:end+1-7*DAY;const added=[];
  for(let page=0;page<3&&cursor<=end;page++){const batch=await this.fetchJson('/api/v3/klines?symbol='+encodeURIComponent(symbol)+'&interval=5m&limit=1000&startTime='+cursor+'&endTime='+end);if(!Array.isArray(batch))throw Error('INVALID_5M_HISTORY');if(!batch.length)break;for(const r of batch)if(+r[6]<=end)added.push({openTime:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],closeTime:+r[6],closed:true});const next=+batch.at(-1)[6]+1;if(!(next>cursor))throw Error('INVALID_5M_PAGINATION');cursor=next;await new Promise(r=>setTimeout(r,350));}
  const rows=[...new Map([...old,...added].map(b=>[b.closeTime,b])).values()].sort((a,b)=>a.closeTime-b.closeTime).slice(-2016);if(!rows.length||rows.at(-1).closeTime!==end)throw Error('WAIT_CURRENT_5M_HISTORY');this.cache.set(symbol,rows);return rows;}
 async tick(){if(this.running||this.now()<(this.backoffUntil||0))return;this.running=true;try{
  if(!this.refreshAt||this.now()-this.refreshAt>900000)await this.refresh();if(!this.state.symbols.length)return;
  const symbol=this.state.symbols[this.cursor++%this.state.symbols.length],previous=this.state.latest[symbol];if(previous&&this.now()-Date.parse(previous.checkedAt)<STEP)return;
  try{const rows=await this.bars(symbol),at=new Date(this.now()).toISOString();let replay=[];const excluded=STABLE_BASES.has(symbol.replace(/USDT$/,''))||/(UP|DOWN|BULL|BEAR)USDT$/.test(symbol);
   if(!excluded)replay=replayEntryChecks(symbol,rows,{now:this.now(),since:previous?.lastCandleTime?Math.max(this.now()-DAY,previous.lastCandleTime+1):this.now()-DAY});
   const setup=excluded?null:evaluateWyckoff(rows,{now:this.now(),timeframe:'5m'}),quality=setup?.buyConfirmed?assessQualityEntry(symbol,rows,{now:this.now()}):null;
   this.state.latest[symbol]={symbol,checkedAt:at,lastCandleTime:rows.at(-1).closeTime,price:rows.at(-1).close,phase:setup?.phase||'EXCLUDED',reason:excluded?'EXCLUDED_ASSET':quality?.code||'WAIT_NEW_WYCKOFF_SIGNAL',error:null};
   const map=new Map([...this.state.events,...replay].filter(e=>Date.parse(e.at)>=this.now()-DAY).map(e=>[e.symbol+':'+e.pattern,e]));this.state.events=[...map.values()];
  }catch(e){if(/429|418/.test(e.message)){this.backoffUntil=this.now()+120000;this.state.error='RATE_LIMIT_BACKOFF';}this.state.latest[symbol]={...previous,symbol,checkedAt:new Date(this.now()).toISOString(),error:e.message};}
  this.state.updatedAt=new Date(this.now()).toISOString();if(this.cursor%10===0)this.save(this.state);
 }catch(e){this.state.error=e.message;if(/429|418/.test(e.message))this.backoffUntil=this.now()+120000;}finally{this.running=false;}}
 snapshot(){const values=Object.values(this.state.latest).filter(v=>this.state.symbols.includes(v.symbol)),events=this.state.events.filter(e=>Date.parse(e.at)>=this.now()-DAY),reasons={};for(const e of events)reasons[e.reason]=(reasons[e.reason]||0)+1;return {readOnly:true,entryPolicyVersion:ENTRY_POLICY_VERSION,scope:'ALL_TRADING_SPOT_USDT',rules:'CURRENT_RULES_REPLAY_NOT_EXECUTION_SIMULATION',startedAt:this.startedAt,updatedAt:this.state.updatedAt||null,total:this.state.symbols.length,checked:values.filter(v=>this.state.symbols.includes(v.symbol)).length,reasons,error:this.state.error||null,latest:values,events};}
}
