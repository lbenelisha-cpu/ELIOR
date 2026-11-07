import {maAuditStore,flushColmexAudit} from '../../lib/colmex-ma-audit.mjs';
import {runtimeEnvironment,configuredLive} from '../../lib/colmex-auto-policy.mjs';
import {autoStore,lease} from '../../lib/colmex-auto-store.mjs';
import {AutoBroker} from '../../lib/colmex-auto-broker.mjs';
import {claimColmexFastTicket} from '../../lib/colmex-fast-dispatch.mjs';
import {runColmexFastWorker} from '../../lib/colmex-poc-fast.mjs';
export default async function(request,context){
 const env=runtimeEnvironment(process.env,context);if(request.method!=='POST'||!configuredLive(env))return;
 let body;try{const text=await request.text();if(text.length>256)return;body=JSON.parse(text);}catch{return;}
 const store=autoStore(),ticket=await claimColmexFastTicket({token:body?.ticket,store,env});if(!ticket)return;
 await runColmexFastWorker({env,until:ticket.until,acquire:()=>lease(store,env.COLMEX_AUTO_ACCOUNT_ID),brokerFactory:deadline=>new AutoBroker({env,deadline}),flushAudit:state=>flushColmexAudit(maAuditStore(),env.COLMEX_AUTO_ACCOUNT_ID,state),onError:()=>console.error('Colmex fast watch paused; next scheduled cycle will retry reads.')});
}
export const config={background:true};
