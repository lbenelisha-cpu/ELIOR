import {createHash} from 'node:crypto';
import {BSTOCK_BASES} from './balanced-universe.mjs';

export const NEWS_VERSION='MARKET_NEWS_V1';
export const NEWS_INTERVAL=300000;
export const NEWS_SOURCES=Object.freeze([
 {id:'coindesk',name:'CoinDesk',group:'coindesk',kind:'editorial',url:'https://www.coindesk.com/arc/outboundfeeds/rss/',host:'www.coindesk.com'},
 {id:'cointelegraph',name:'Cointelegraph',group:'cointelegraph',kind:'editorial',url:'https://cointelegraph.com/rss',host:'cointelegraph.com'},
 {id:'prnewswire-finance',name:'PR Newswire · השקעות',group:'prnewswire',kind:'press_release',url:'https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss',host:'www.prnewswire.com'},
 {id:'prnewswire-tech',name:'PR Newswire · טכנולוגיה',group:'prnewswire',kind:'press_release',url:'https://www.prnewswire.com/rss/business-technology-latest-news/business-technology-latest-news-list.rss',host:'www.prnewswire.com'}
]);
const DAY=86400000, EVENT_AGE=3600000, FRESH=900000;
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,24);
const CRYPTO={BTC:['bitcoin','BTC'],ETH:['ethereum','ether','ETH'],SOL:['solana','SOL'],BNB:['BNB'],XRP:['XRP'],DOGE:['dogecoin','DOGE'],ADA:['cardano'],AVAX:['avalanche'],LINK:['chainlink'],SUI:['sui network'],LTC:['litecoin'],BCH:['bitcoin cash'],DOT:['polkadot'],NEAR:['near protocol'],UNI:['uniswap'],APT:['aptos'],ATOM:['cosmos network'],AAVE:['aave'],ARB:['arbitrum'],OP:['optimism network'],TRX:['tron network']};
const STOCKS={AAPL:['Apple'],MSFT:['Microsoft'],NVDA:['Nvidia'],AMZN:['Amazon'],GOOGL:['Alphabet','Google'],META:['Meta Platforms'],TSLA:['Tesla'],MSTR:['MicroStrategy','Strategy Inc','Strategy buys','Strategy purchases','Strategy acquires'],COIN:['Coinbase'],CRCL:['Circle Internet'],HOOD:['Robinhood'],AMD:['Advanced Micro Devices'],AVGO:['Broadcom'],INTC:['Intel'],JPM:['JPMorgan'],PYPL:['PayPal'],NFLX:['Netflix'],TSM:['Taiwan Semiconductor'],BMNR:['BitMine'],SBET:['SharpLink'],BLK:['BlackRock']};
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const word=(s,a)=>new RegExp('\\b'+escape(a)+'\\b','i').test(s);
const plain=s=>String(s||'').replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/,'$1').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const x=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):+n;return x>0&&x<=0x10ffff?String.fromCodePoint(x):'';}).replace(/&(amp|lt|gt|quot|apos);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[n]).replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
export function newsAsset(symbol){
 const s=String(symbol||'').toUpperCase().replace(/USDT$/,'');
 if(BSTOCK_BASES.has(s))return 'stock:'+s.slice(0,-1);
 if(CRYPTO[s])return 'crypto:'+s;
 return STOCKS[s]?'stock:'+s:null;
}
export function identifyNews(title){
 const assets=[];
 for(const [symbol,aliases] of Object.entries(CRYPTO))if(aliases.some(a=>word(title,a))&&!(symbol==='BTC'&&/bitcoin cash/i.test(title)))assets.push({id:'crypto:'+symbol,reason:'שם או סימול מפורש בכותרת'});
 for(const [symbol,aliases] of Object.entries(STOCKS))if(aliases.some(a=>word(title,a))||new RegExp('(?:NASDAQ|NYSE)\\s*:\\s*'+symbol+'\\b','i').test(title))assets.push({id:'stock:'+symbol,reason:'שם חברה או סימול בורסה מפורש בכותרת'});
 const uncertain=/\?|\b(?:rumou?rs?|reportedly|alleged|may|might|could|would|will|plans?|planning|proposes?|seeks?|considering|denies|denied|not|no|fake|false|forecast|prediction|opinion|according to|says|said|last year|last month|in 20\d\d)\b/i.test(title)||/[“”"]/.test(title);
 const kind=/\b(?:hack|hacked|exploit|outage|bankrupt|bankruptcy|insolvency|halts?|suspends?)\b/i.test(title)?'risk':/\b(?:invests?|investment|funding|acquires?|acquisition|buys?|purchases?|bought|purchased|acquired|partnership)\b/i.test(title)?'investment':/\b(?:rally|rallies|surge|surges|soars?|gains?|record high)\b/i.test(title)?'price_move':'report';
 // Deliberately narrow, auditable extraction. General company investments and
 // multi-asset/ambiguous stories are displayed, never inferred to buy a token.
 let event=null;
 const purchase=title.match(/\b(Strategy|MicroStrategy|Tesla|Metaplanet|SharpLink|BitMine|BlackRock)\s+(?:buys|purchases|acquires|bought|purchased|acquired)\s+(?:another\s+|an additional\s+)?([\d,]+(?:\.\d+)?)\s+(bitcoin|BTC|ether|ethereum|ETH|solana|SOL|BNB|XRP)\b/i);
 if(purchase&&!uncertain){
  const actor=purchase[1].toLowerCase().replace('microstrategy','strategy'),quantity=Number(purchase[2].replaceAll(',',''));
  const token=Object.entries(CRYPTO).find(([,names])=>names.some(n=>n.toLowerCase()===purchase[3].toLowerCase()))?.[0];
  if(token&&quantity>0&&Number.isFinite(quantity)&&assets.filter(a=>a.id.startsWith('crypto:')).length===1)event={asset:'crypto:'+token,type:'completed_purchase',direction:'positive',key:`purchase:${actor}:${token}:${quantity}`,actor,quantity};
 }
 const outage=title.match(/^(Ethereum|Solana|Bitcoin)\s+(?:network\s+)?(?:suffers|experiences|hit by)\s+(?:a\s+|an\s+)?(?:network\s+)?outage\b/i);
 if(outage&&!uncertain&&!/\b(?:ends?|ended|resolved|restored|recovers?|recovered|resumes?|resumed|after|following|testnet)\b/i.test(title)&&assets.filter(a=>a.id.startsWith('crypto:')).length===1){const token={ethereum:'ETH',solana:'SOL',bitcoin:'BTC'}[outage[1].toLowerCase()];event={asset:'crypto:'+token,type:'network_outage',direction:'negative',key:'outage:'+token};}
 return {assets,kind,uncertain,event};
}
export function parseNewsFeed(xml,source,now=Date.now()){
 if(typeof xml!=='string'||xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<rss[\s>]/i.test(xml)||!/<\/rss>\s*$/i.test(xml))throw Error('INVALID_FEED');
 const read=(s,tag)=>plain(s.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','i'))?.[1]);
 const rows=[],seen=new Set();let rejected=0;
 for(const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)){
  if(rows.length>=150)break;
  const title=read(m[1],'title').slice(0,400),publishedAt=Date.parse(read(m[1],'pubDate'));
  let url;try{url=new URL(read(m[1],'link'));}catch{rejected++;continue;}
  if(!title||url.protocol!=='https:'||url.username||url.password||url.port||url.hostname!==source.host||!Number.isFinite(publishedAt)||publishedAt>now||now-publishedAt>7*DAY){rejected++;continue;}
  url.hash='';for(const k of [...url.searchParams.keys()])if(/^(utm_|ref$|output$)/i.test(k))url.searchParams.delete(k);
  const id=hash(source.group+':'+url.href);if(seen.has(id))continue;seen.add(id);
  const category=read(m[1],'category');
  const attribution=read(m[1],'dc:creator')+' '+read(m[1],'source')+' '+category;
  const summary=read(m[1],'description');
  const analysis=identifyNews(title);
  // Wire/sponsored material cannot count as independent editorial corroboration.
  const editorial=source.kind==='editorial'&&!/sponsor|press release|pr newswire|business wire|advertorial|coindesk|cointelegraph/i.test(attribution)&&!/according to|reported by|reports from|press release|sponsored/i.test(summary)&&!new RegExp(source.group==='coindesk'?'cointelegraph':'coindesk','i').test(summary);
  rows.push({id,title,url:url.href,publishedAt,sourceId:source.id,source:source.name,group:source.group,editorial,...analysis});
 }
 return {rows,rejected};
}
export function newsConfig(env={}){
 const requested=env.MARKET_NEWS_ENTRY_OVERLAY==='true',enabledAfter=Date.parse(env.MARKET_NEWS_ENTRY_AFTER||'');
 return {version:NEWS_VERSION,enabled:requested&&Number.isFinite(enabledAfter)&&enabledAfter>0,enabledAfter:Number.isFinite(enabledAfter)?enabledAfter:null,error:requested&&!(enabledAfter>0)?'ACTIVATION_TIME_REQUIRED':null,policy:'CORROBORATED_ENTRY_OVERLAY',scope:'BINANCE_AUTOMATIC_CRYPTO_ENTRIES',maxEventAgeMs:EVENT_AGE,minPublisherGroups:2};
}
export function assessNewsEntry(snapshot,symbol,config={},now=Date.now()){
 const asset=newsAsset(symbol),base={version:NEWS_VERSION,asset,enabled:config.enabled===true,action:'NONE',priority:0,reason:'OBSERVATION_ONLY',evidence:[],checkedAt:now};
 if(!config.enabled)return base;
 if(!(config.enabledAfter>0)||config.enabledAfter>=now)return {...base,reason:'WAIT_NEW_REPORTS'};
 if(!asset?.startsWith('crypto:'))return {...base,reason:'ASSET_OBSERVATION_ONLY'};
 if(snapshot?.storageError||!snapshot?.collectedAt||now-snapshot.collectedAt>FRESH||now<snapshot.collectedAt)return {...base,reason:'NEWS_UNAVAILABLE'};
 const freshSources=new Set((snapshot.sources||[]).filter(s=>s.status==='OK'&&s.lastSuccessAt<=now&&now-s.lastSuccessAt<=FRESH).map(s=>s.id));
 const boundary=Math.max(config.enabledAfter,snapshot.baselineAt||0);
 const eligible=(snapshot.items||[]).filter(r=>r.event?.asset===asset&&r.editorial&&!r.uncertain&&!r.revised&&freshSources.has(r.sourceId)&&r.firstSeenAt>boundary&&r.publishedAt>boundary&&r.publishedAt<=now&&r.firstSeenAt<=now&&r.firstSeenAt>=r.publishedAt&&r.firstSeenAt-r.publishedAt<=1800000&&now-r.publishedAt<=EVENT_AGE);
 const corroborated=[];
 for(const r of eligible){
  const original=(snapshot.items||[]).filter(x=>x.event?.key===r.event.key).reduce((at,x)=>Math.min(at,x.publishedAt),r.publishedAt);
  if(original<=boundary||now-original>EVENT_AGE)continue;
  const matches=eligible.filter(x=>x.event.key===r.event.key&&Math.abs(x.publishedAt-r.publishedAt)<=1800000);
  // Identical headlines are likely syndication and do not add confirmation.
  const groups=new Set(),titles=new Set(),evidence=[];
  for(const x of matches){const title=x.title.toLowerCase().replace(/[^a-z0-9]/g,'');if(groups.has(x.group)||titles.has(title))continue;groups.add(x.group);titles.add(title);evidence.push(x);}
  if(groups.size>=2)corroborated.push({event:r.event,evidence});
 }
 const negative=corroborated.find(x=>x.event.direction==='negative'),positive=corroborated.find(x=>x.event.direction==='positive'),selected=negative||positive;
 if(!selected)return {...base,reason:NEWS_SOURCES.filter(s=>s.kind==='editorial'&&freshSources.has(s.id)).length>=2?'NO_CORROBORATED_EVENT':'NEWS_PARTIAL'};
 return {...base,action:negative?'BLOCK':'PRIORITIZE',priority:negative?0:1,reason:negative?'NEWS_NETWORK_OUTAGE':'NEWS_COMPLETED_PURCHASE',event:selected.event,evidence:selected.evidence.map(({id,url,title,source,publishedAt,firstSeenAt})=>({id,url,title,source,publishedAt,firstSeenAt}))};
}

export function createNewsCollector({fetchImpl=globalThis.fetch,now=Date.now,load=()=>null,save=()=>{},sources=NEWS_SOURCES}={}){
 let state={version:NEWS_VERSION,baselineAt:now(),items:[],sources:[],collectedAt:null},pending=null,storageError=null;
 try{const old=load();if(old){if(old.version!==NEWS_VERSION||!Array.isArray(old.items)||!Array.isArray(old.sources))throw Error();state={...old,items:old.items.filter(r=>Number.isFinite(r.firstSeenAt)&&r.firstSeenAt<=now()&&r.publishedAt<=now()&&now()-r.publishedAt<=7*DAY).slice(0,600)};}}catch{storageError='NEWS_STORE_UNAVAILABLE';}
 const snapshot=()=>structuredClone({...state,storageError,sources:sources.map(s=>({id:s.id,name:s.name,kind:s.kind,url:s.url,...state.sources.find(x=>x.id===s.id)}))});
 async function read(source){
  const response=await fetchImpl(source.url,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/rss+xml, application/xml','User-Agent':'ELIOR-News/1.0 (+https://github.com/lbenelisha-cpu/ELIOR)'}});
  if(!response.ok)throw Error(response.status===429?'RATE_LIMITED':'SOURCE_UNAVAILABLE');
  if(Number(response.headers.get('content-length'))>2000000)throw Error('FEED_TOO_LARGE');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>2000000)throw Error('FEED_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return parseNewsFeed(Buffer.concat(chunks).toString('utf8'),source,now());
 }
 async function collect(){
  const stamp=now(),due=sources.filter(s=>!(state.sources.find(x=>x.id===s.id)?.nextAttemptAt>stamp));
  if(!due.length)return snapshot();
  // Two requests at a time. Polling does not run on page views or trading paths.
  for(let i=0;i<due.length;i+=2){
   const batch=due.slice(i,i+2),results=await Promise.allSettled(batch.map(read));
   results.forEach((result,n)=>{
    const source=batch[n],old=state.sources.find(x=>x.id===source.id)||{},at=now();
    let status;
    if(result.status==='fulfilled'){
     const existing=new Map(state.items.map(r=>[r.id,r]));
     for(const row of result.value.rows){const previous=existing.get(row.id);existing.set(row.id,{...row,firstSeenAt:previous?.firstSeenAt??at,revised:previous?previous.revised||previous.title!==row.title||previous.publishedAt!==row.publishedAt:false});}
     state.items=[...existing.values()].filter(r=>at-r.publishedAt<=7*DAY).sort((a,b)=>b.publishedAt-a.publishedAt).slice(0,600);
     status={id:source.id,status:'OK',lastSuccessAt:at,lastAttemptAt:at,nextAttemptAt:at+NEWS_INTERVAL,failures:0,count:result.value.rows.length,rejected:result.value.rejected,error:null};
    }else{const failures=Math.min(6,(old.failures||0)+1);status={...old,id:source.id,status:'UNAVAILABLE',lastAttemptAt:at,failures,nextAttemptAt:at+Math.min(3600000,NEWS_INTERVAL*2**(failures-1)),error:['RATE_LIMITED','FEED_TOO_LARGE','INVALID_FEED'].includes(result.reason?.message)?result.reason.message:'SOURCE_UNAVAILABLE'};}
    state.sources=state.sources.filter(x=>x.id!==source.id).concat(status);
   });
  }
  state.collectedAt=now();
  try{save(state);storageError=null;}catch{storageError='NEWS_STORE_UNAVAILABLE';}
  return snapshot();
 }
 return {snapshot,poll(){if(!pending)pending=collect().finally(()=>{pending=null;});return pending;}};
}
