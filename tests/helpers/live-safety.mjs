// Unit-test dependencies for source-isolated functions. Integration tests use
// the real reconciliation, journal and protection implementations separately.
import {validateTradeSettings} from '../../lib/trade-settings.mjs';
export function withLiveSafety(context){
 context.channelPrimary??={requested:false,enabled:false};
 context.newsEntryAssessment??=()=>({action:'NONE',priority:0,reason:'OBSERVATION_ONLY'});
 context.newsEntryCandidates??=evals=>evals.filter(e=>e.ok&&e.entryConfirmed&&e.wyckoffTrade);
 context.tradeSettings??={values:validateTradeSettings({})};
 context.liveStateHealth??={journalReady:true};
 context.liveReadiness??=()=>({ready:true});
 context.reconcileLiveHoldings??=()=>context.getLiveAccountSnapshot();
 context.recordLiveError??=()=>{};
 context.nativeProtection??={rows:{},uncertain:()=>false};
 context.nativeProtection.rows??={};
 context.nativeProtection.reconcile??=async()=>null;
 return context;
}
