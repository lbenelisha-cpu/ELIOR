// Unit-test dependencies for source-isolated functions. Integration tests use
// the real reconciliation, journal and protection implementations separately.
export function withLiveSafety(context){
 context.liveStateHealth??={journalReady:true};
 context.liveReadiness??=()=>({ready:true});
 context.reconcileLiveHoldings??=()=>context.getLiveAccountSnapshot();
 context.recordLiveError??=()=>{};
 context.nativeProtection??={rows:{},uncertain:()=>false};
 context.nativeProtection.rows??={};
 context.nativeProtection.reconcile??=async()=>null;
 return context;
}
