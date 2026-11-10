import {POC_ENTRY_POLICY} from '../../lib/channel-poc-entry.mjs';
import {regularSession} from '../../lib/colmex-market-hours.mjs';
import '../../regression-trend.js';
import '../../parallel-channel.js';
import '../../channel-poc-model.js';
export function pocFixture({side='LONG',end=Date.parse('2026-11-06T20:00Z'),entryPrice=null,platform='BINANCE',legacy=false}={}){
 const D=300000,prices=[100.65,100.45,100.75,100.60,100.45,100.65,101.5,102.7,103.8,104.7,105.2,105.5,104.7,103.8,102.5,101,100.4,101.7,103.1,104.4,105.2,105.6,105.1,104.9,105.3,105.6,108.8];
 const raw=prices.map((c,i)=>{const o=prices[i-1]??100.55;return {open:o,close:c,high:Math.max(o,c)+.18,low:Math.min(o,c)-.18,volume:.02};});
 raw[4].low=raw[16].low=100;raw[11].high=raw[21].high=106;raw[26].high=109;raw[26].low=105.5;
 const profile=globalThis.LEVI_CHANNEL_POC.profile(raw.slice(globalThis.LEVI_CHANNEL_POC.ANCHOR_POLICY?16:4)),pc=profile.poc;
 raw.push({open:108.8,close:pc+.3,high:108.9,low:pc+.2,volume:.01});
 const preceding=Array.from({length:24},()=>({open:100.6,close:100.6,high:100.7,low:100.5,volume:.01}));
 const closeRows=[...preceding,...raw];
 const reflect=b=>side==='LONG'?b:{...b,open:210-b.open,close:210-b.close,high:210-b.low,low:210-b.high};
 const confirmed=!legacy&&!!POC_ENTRY_POLICY.confirmationPolicy;
 if(confirmed)raw.at(-1).low=pc-.1;
 const poc=side==='LONG'?pc:210-pc,entry=confirmed?poc+(side==='LONG'?.15:-.15):poc,scale=entryPrice===null?1:entryPrice/entry;
 const transform=b=>Object.fromEntries(Object.entries(reflect(b)).map(([k,v])=>[k,['open','high','low','close'].includes(k)?v*scale:v]));
 const bars=closeRows.map((b,i)=>({...transform(b),openTime:end-(closeRows.length-i)*D,closeTime:end-(closeRows.length-i-1)*D,closed:true}));
 const price=entry*scale,now=end+1000;
 const liveBar={...transform({open:pc+.3,close:confirmed?pc+.15:pc,high:pc+.4,low:confirmed?pc+.15:pc,volume:0}),openTime:end,closeTime:end+D,receivedAt:now,closed:false};
 const prefix=[];if(confirmed){let t=bars[0].openTime-D;while(prefix.length<1300){if(platform==='BINANCE'||regularSession(t)){const c=(side==='LONG'?95-prefix.length*.001:115+prefix.length*.001)*scale;prefix.unshift({openTime:t,closeTime:t+D,open:c,high:c+.02*scale,low:c-.02*scale,close:c,volume:.01,closed:true});}t-=D;}}
 return {bars,trendBars:confirmed?[...prefix,...bars]:undefined,price,priceAsOf:now,liveBar,now,quote:{symbol:'ABCUSDT',bidPrice:String(price),askPrice:String(price+.01),time:now}};
}
