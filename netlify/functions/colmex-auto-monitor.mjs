import {configuredLive,runtimeEnvironment} from '../../lib/colmex-auto-policy.mjs';
import {autoStore,lease} from '../../lib/colmex-auto-store.mjs';
import {AutoBroker} from '../../lib/colmex-auto-broker.mjs';
import {runCycle} from '../../lib/colmex-auto-runner.mjs';
export function cycleError(error,stage){
 const allowed=new Set(['READ_ONLY','AUTH_DENIED','AUTH_RESPONSE','TOKEN_EXPIRED','ACCESS_DENIED','RATE_LIMIT','NETWORK','UPSTREAM_HTTP','RESPONSE_SCHEMA','COLUMN_SCHEMA','ROW_SCHEMA','ACCOUNT_SCHEMA','POSITION_SCHEMA','ORDER_SCHEMA','INSTRUMENT_SCHEMA','HISTORY_SCHEMA','CYCLE_DEADLINE','LIVE_ACCOUNT_MISMATCH','SESSION_CHANGED','WAIT_BROKER_QUOTE','WAIT_DAILY_BARS','INVALID_DAILY_BARS','FIVE_MINUTE_TIMEFRAME_REQUIRED','DAILY_HIGH_LOW_REQUIRED','INVALID_DAILY_OHLC','FIVE_MINUTE_CLOSE_TIME_REQUIRED','LEASE_LOST','LEASE_EXPIRED']);
 const code=error?.code||error?.message;return {at:Date.now(),reason:allowed.has(code)?code:'CYCLE_FAILED_NO_AUTOMATIC_RETRY_OF_ORDERS',stage:stage||null};
}
export default async function(request,context){
 const env=runtimeEnvironment(process.env,context);
 if(!configuredLive(env))return new Response(null,{status:204});
 const lock=await lease(autoStore(),env.COLMEX_AUTO_ACCOUNT_ID);if(!lock)return new Response(null,{status:204});
 const deadline=Date.now()+24000;
 try{const result=await runCycle({state:lock.state,save:lock.save,broker:new AutoBroker({env,deadline}),env,deadline});lock.state.lastResult=result.reason;lock.state.lastCompletedAt=Date.now();lock.state.lastError=null;await lock.save(lock.state);}
 catch(error){lock.state.lastError=cycleError(error,lock.state.stage);await lock.save(lock.state);}
 finally{await lock.release();}
 return new Response(null,{status:204});
}
export const config={schedule:'* * * * *'};
