import {SIM_SYMBOLS,newSimulation,applyStockObservation,analyzeStockHistory,regularSession} from './colmex-simulation.mjs';
import {STATE_KEY} from './colmex-simulation-store.mjs';
export async function runSimulation({store,td,now=Date.now(),feeBps=null}){
 if(!regularSession(now))return {status:'MARKET_CLOSED'};
 const stored=await store.getWithMetadata(STATE_KEY,{type:'json'}),state=stored?.data||newSimulation(now,feeBps),cycle=Math.floor(now/60000);
 if(state.lastCycle===cycle)return {status:'ALREADY_CHECKED'};
 const symbol=SIM_SYMBOLS[state.cursor%SIM_SYMBOLS.length];let next=structuredClone(state);
 // One stock per minute, two provider requests. All watchlist stocks rotate in ten minutes.
 // Positions can be monitored without bar history if the series request fails.
 const [series,quote]=await Promise.allSettled([td('time_series',{symbol,interval:'5min',outputsize:1000,order:'ASC',adjust:'splits',timezone:'UTC',prepost:false},60),td('quote',{symbol,prepost:false},60)]);
 if(series.status==='fulfilled')next=analyzeStockHistory(next,{symbol,series:series.value,now});
 if(quote.status==='fulfilled')next=applyStockObservation(next,{symbol,series:series.status==='fulfilled'?series.value:null,quote:quote.value,now});
 else next.assets[symbol]={...(next.assets[symbol]||{}),checkedAt:new Date(now).toISOString(),reason:'DATA_UNAVAILABLE_OR_PROVIDER_LIMIT'};
 next.cursor=(state.cursor+1)%SIM_SYMBOLS.length;next.lastCycle=cycle;next.lastRunAt=new Date(now).toISOString();
 const result=await store.setJSON(STATE_KEY,next,stored?{onlyIfMatch:stored.etag}:{onlyIfNew:true});
 return {status:result.modified?'SAVED':'CONCURRENT_RUN_DISCARDED',symbol};
}
