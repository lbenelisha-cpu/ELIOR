import {configuredLive} from '../../lib/colmex-auto-policy.mjs';
import {autoStore,lease} from '../../lib/colmex-auto-store.mjs';
import {AutoBroker} from '../../lib/colmex-auto-broker.mjs';
import {runCycle} from '../../lib/colmex-auto-runner.mjs';
export default async function(){
 const env=process.env;
 if(!configuredLive(env))return new Response(null,{status:204});
 const lock=await lease(autoStore(),env.COLMEX_AUTO_ACCOUNT_ID);if(!lock)return new Response(null,{status:204});
 const deadline=Date.now()+24000;
 try{const result=await runCycle({state:lock.state,save:lock.save,broker:new AutoBroker({env,deadline}),env,deadline});lock.state.lastResult=result.reason;lock.state.lastCompletedAt=Date.now();lock.state.lastError=null;await lock.save(lock.state);}
 catch{lock.state.lastError={at:Date.now(),reason:'CYCLE_FAILED_NO_AUTOMATIC_RETRY_OF_ORDERS'};await lock.save(lock.state);}
 finally{await lock.release();}
 return new Response(null,{status:204});
}
export const config={schedule:'* * * * *'};
