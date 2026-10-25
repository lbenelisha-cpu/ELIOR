import {validateTradeSettings} from './trade-settings.mjs';
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export const pendingIntents=s=>[s.pending,...(s.riskPending||[])].filter(Boolean);
export const hasPending=s=>pendingIntents(s).length>0;
export function validateLiveState(s){
 if(!object(s)||s.version!==1)throw Error(s?.version!==undefined?'STATE_VERSION':'STATE_SCHEMA');
 if(!Number.isFinite(s.createdAt)||!Number.isSafeInteger(s.cursor)||s.cursor<0||
    !Array.isArray(s.positions)||!Array.isArray(s.used)||!Array.isArray(s.events)||
    !object(s.after)||!object(s.checks)||!Object.hasOwn(s,'pending')||s.pending!==null&&!object(s.pending)||
    s.riskPending!==undefined&&!Array.isArray(s.riskPending))throw Error('STATE_SCHEMA');
 if(s.positions.some(p=>!object(p)||!p.id||!p.symbol||!p.instrumentId||!positive(p.qty)||!positive(p.entryPrice)||!Array.isArray(p.tickSize))||
    new Set(s.positions.map(p=>String(p.id))).size!==s.positions.length||
    s.used.some(x=>typeof x!=='string')||Object.values(s.after).some(x=>!Number.isFinite(x)||x<0))throw Error('STATE_SCHEMA');
 if(s.riskPending?.some(i=>!object(i)))throw Error('STATE_SCHEMA');
 const intents=pendingIntents(s);
 if(intents.length>20||new Set(intents.map(i=>i.id)).size!==intents.length||intents.some(i=>!object(i)||!i.id||!i.symbol||!Number.isFinite(i.at)||
    !['BUY','CLOSE','PROTECTION','STOP'].includes(i.kind)||
    (i.kind==='BUY'?(!object(i.order)||!positive(i.order.qty)||!i.order.tradableInstrumentId):!i.positionId)))throw Error('STATE_SCHEMA');
 if(s.closedTrades!==undefined&&!Array.isArray(s.closedTrades))throw Error('STATE_SCHEMA');
 validateTradeSettings(s.settings||{});
 return s;
}
