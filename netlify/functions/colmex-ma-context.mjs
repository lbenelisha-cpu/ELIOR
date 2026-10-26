import {analyzePositionAlpha,compactPositionAlpha} from '../../lib/position-alpha.mjs';
import {runtimeEnvironment,configuredLive,brokerBars} from '../../lib/colmex-auto-policy.mjs';
import {autoStore,stateKey} from '../../lib/colmex-auto-store.mjs';
import {AutoBroker} from '../../lib/colmex-auto-broker.mjs';
import {maAuditStore,colmexAuditPrefix} from '../../lib/colmex-ma-audit.mjs';
import {auditSnapshots} from '../../lib/ma-decision-audit.mjs';
import {regularSession,stockSessionGap} from '../../lib/colmex-market-hours.mjs';
// Read-only, separate from the trading worker. Three held instruments at most;
// fresh analysis is optional and never a prerequisite for a stop or an order.
export default async function(request,context){
 const env=runtimeEnvironment(process.env,context),now=Date.now();
 if(!configuredLive(env)||!regularSession(now))return new Response(null,{status:204});
 const saved=await autoStore().get(stateKey(env.COLMEX_AUTO_ACCOUNT_ID),{type:'json'}),positions=(saved?.state?.positions||[]).slice(0,3);
 const broker=new AutoBroker({env,deadline:now+24000}),contexts={};
 await Promise.allSettled(positions.map(async p=>{if(!/^\d+$/.test(String(p.instrumentId)))return;const bars=brokerBars(await broker.history(p.instrumentId,env.COLMEX_AUTO_ACCOUNT_ID),Date.now());const at=Date.now();contexts[p.symbol]={checks:auditSnapshots(bars,at,stockSessionGap),positionAlpha:compactPositionAlpha(analyzePositionAlpha(bars,p,{now:at}))};}));
 await maAuditStore().setJSON(colmexAuditPrefix(env.COLMEX_AUTO_ACCOUNT_ID)+'/contexts',{at:Date.now(),contexts});
 return new Response(null,{status:204});
}
export const config={schedule:'*/5 * * * *'};
