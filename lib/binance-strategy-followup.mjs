import {buildNetTradeJournal} from './net-trade-journal.mjs';
import {strategyFollowupReport} from './strategy-followup.mjs';
export function binanceStrategyReport(state,actions){
 const groups=new Map();
 for(const row of buildNetTradeJournal(actions).reverse()){
  const key=row.symbol+'|'+row.entryAt;
  if(!groups.has(key))groups.set(key,{entryMode:row.entryMode,entryPolicyVersion:row.entryPolicyVersion,grossPnl:0,netPnl:0,feesKnown:true,closed:false});
  const g=groups.get(key);g.closed||=row.closed;g.feesKnown&&=row.feesComplete&&Number.isFinite(row.netPnlUsdt);g.netPnl+=row.netPnlUsdt||0;g.closedObservedAt=Date.parse(row.at);g.grossPnl=null;
 }
 const closed=[...groups.values()].filter(g=>g.closed).sort((a,b)=>a.closedObservedAt-b.closedObservedAt).map(g=>({...g,netPnl:g.feesKnown?g.netPnl:null}));
 return strategyFollowupReport(state,closed);
}
