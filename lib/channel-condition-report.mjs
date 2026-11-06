// One result per independent gate from one input snapshot. Never authorizes orders.
export const CHANNEL_CONDITIONS_VERSION='CHANNEL_CONDITIONS_PARALLEL_V1';
const definitions={
 LONG:{channel:['channel'],slope:['slope'],break:['break'],center:['center'],volume:['volumeData','volume'],liquidity:['liquidity'],signal:['new','unused'],range:['range'],rangeBreak:['rangeBreak'],plan:['atr','plan']},
 SHORT:{channel:['channel'],slope:['slope'],break:['break'],center:['center'],volume:['volumeData','volume'],liquidity:['liquidity'],signal:['new','unused'],range:['range'],rangeBreak:['rangeBreak'],plan:['price','plan']}
};
export function conditionCollector(side,at){
 const gates={},failures=[];
 const report=()=>({version:CHANNEL_CONDITIONS_VERSION,side,at,expiresAt:(Math.floor(at/300000)+1)*300000,rows:Object.entries(definitions[side]).map(([id,keys])=>({id,state:keys.some(k=>gates[k]===false)?'waiting':keys.every(k=>gates[k]===true)?'passed':'unknown'}))});
 return {check(id,passed,reason){gates[id]=passed===true;if(!passed)failures.push(reason);return passed;},get failure(){return failures[0]||null;},get complete(){return !failures.length&&report().rows.every(r=>r.state==='passed');},report};
}
