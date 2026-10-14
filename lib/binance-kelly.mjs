import {ENTRY_POLICY_VERSION} from './binance-quality-policy.mjs';
import {buildNetTradeJournal} from './net-trade-journal.mjs';
// Bump whenever entry/exit rules change; never pool unversioned historical fills.
export const KELLY_RULESET=ENTRY_POLICY_VERSION;
export function empiricalKelly(returns){
 if(!returns.length||returns.some(r=>!Number.isFinite(r)||r<=-1))return null;
 const derivative=f=>returns.reduce((sum,r)=>sum+r/(1+f*r),0)/returns.length;
 if(derivative(0)<=0)return 0;if(derivative(1)>=0)return 1;
 let lo=0,hi=1;for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(derivative(mid)>0)lo=mid;else hi=mid;}return (lo+hi)/2;
}
export function kellyLearningReport(actions,{now=Date.now(),minSamples=20}={}){
 const eligible=(actions||[]).filter(a=>Date.parse(a.at)<=now),buys=new Set(eligible.filter(a=>a.type==='BUY'&&a.kellyPolicyVersion===KELLY_RULESET).map(a=>a.symbol+':'+a.at));
 const groups=new Map();for(const r of buildNetTradeJournal(eligible)){
  const key=r.symbol+':'+r.entryAt;if(!buys.has(key))continue;
  if(!groups.has(key))groups.set(key,{cost:0,net:0,complete:true,closed:false,at:r.at});
  const g=groups.get(key);g.cost+=Number(r.costUsdt)||0;g.net+=Number(r.netPnlUsdt)||0;g.complete&&=r.feesComplete===true&&Number.isFinite(r.netPnlUsdt);g.closed||=r.closed;g.at=Date.parse(r.at)>Date.parse(g.at)?r.at:g.at;
 }
 const samples=[...groups.values()].filter(g=>g.closed&&g.complete&&g.cost>0&&g.net/g.cost>-1).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),returns=samples.map(g=>g.net/g.cost),estimate=empiricalKelly(returns),enough=samples.length>=minSamples;
 return {mode:'LEARNING_ONLY',executionEnabled:false,ruleset:KELLY_RULESET,updatedAt:new Date(now).toISOString(),minSamples,samples:samples.length,excludedIncomplete:[...groups.values()].filter(g=>g.closed&&!g.complete).length,wins:returns.filter(r=>r>0).length,losses:returns.filter(r=>r<0).length,netUsdt:samples.reduce((s,g)=>s+g.net,0),fullKellyFraction:enough?estimate:null,quarterKellyFraction:enough?Math.min(.2,.25*estimate):null,positionCap:.2,kellyScale:.25,status:!enough?'INSUFFICIENT_SAMPLES':estimate>0?'ESTIMATE_ONLY':'NO_POSITIVE_EDGE'};
}
