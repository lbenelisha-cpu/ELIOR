import {pendingIntents,isQuarantined} from './colmex-live-state.mjs';

// Owner-authorized review of these two October attempts, not a general timeout
// policy. Preserve unknown historical execution; only retire current reservations.
export const REVIEW_ID='COLMEX_OCTOBER_RESERVATIONS_20261111';
const targets=[
 {id:'60a175b9-d968-42ff-b40c-992779086166',symbol:'AMD',at:1793116509071,reserved:565.83},
 {id:'a3efb8c5-c9ab-4323-aaaa-dda5f86799a4',symbol:'TGT',at:1793197571357,reserved:449.99}
];
const zeroFields=['positionsCount','ordersCount','blockedBalance','stockOrdersReq','blockedForStocks','totalPositionsValue','openGrossPnL','initialMarginReq','maintMarginReq'];
export function reviewOctoberReservations(s,snap,account,at){
 if(s.octoberOrderReview?.status==='ARCHIVED')return null;
 const intents=pendingIntents(s);
 if(intents.length!==2||s.halt||s.positions.length||String(snap.account?.id)!==String(account)||snap.account?.type!=='live'||snap.account?.currency!=='USD'||snap.account?.status!=='ACTIVE')return null;
 if(at<Date.parse('2026-11-11T19:00:00Z')||at>Date.parse('2026-11-18T00:00:00Z'))return null;
 if(!targets.every(t=>intents.some(i=>i.id===t.id&&i.symbol===t.symbol&&i.at===t.at&&isQuarantined(i)&&i.reviewRequired===true&&!i.manual&&!i.acceptedAt&&!i.orderId&&i.order?.side==='buy'&&i.order?.type==='limit'&&i.order?.validity==='IOC'&&Math.abs(i.order.qty*i.order.price+5-t.reserved)<.001)))return null;
 const empty=snap.historyAvailable===true&&Array.isArray(snap.history)&&Array.isArray(snap.positions)&&!snap.positions.length&&Array.isArray(snap.orders)&&!snap.orders.length&&
  zeroFields.every(k=>typeof snap.state?.[k]==='number'&&snap.state[k]===0)&&Number.isFinite(snap.state.availableCash)&&snap.state.availableCash>0&&snap.state.availableCash===snap.state.cashBalance&&snap.state.cashBalance===snap.state.balance&&
  intents.every(i=>i.reconciliation?.at===at&&i.reconciliation.historyAvailable===true&&i.reconciliation.matches===0&&i.reconciliation.relatedHistoryCount===0);
 if(!empty){if(s.octoberOrderReview?.status==='VERIFYING')delete s.octoberOrderReview;return null;}
 const prior=s.octoberOrderReview;
 if(prior?.status!=='VERIFYING'||at<prior.firstVerifiedAt||at-prior.firstVerifiedAt>300000||prior.balance!==snap.state.balance){
  s.octoberOrderReview={id:REVIEW_ID,status:'VERIFYING',firstVerifiedAt:at,balance:snap.state.balance};
  return 'OLD_ORDER_REVIEW_VERIFYING';
 }
 if(at-prior.firstVerifiedAt<55000)return 'OLD_ORDER_REVIEW_VERIFYING';
 // Archive full intents and observed history together in the same atomic state
 // write as removing reservations. Never report CANCELLED, NO_FILL or zero P/L.
 s.octoberOrderReview={...prior,status:'ARCHIVED',completedAt:at,historicalOutcome:'UNKNOWN',currentExposure:'NONE',releasedUsd:1015.82,releasedSlots:2,
  intents:structuredClone(intents),brokerEvidence:structuredClone({account:snap.account.id,state:snap.state,orders:snap.orders,positions:snap.positions,history:snap.history})};
 s.pending=null;s.riskPending=[];
 for(const t of targets){s.after[t.symbol]=Math.max(s.after[t.symbol]||0,at);delete s.checks[t.symbol];s.events.push({at,reason:'OLD_ORDER_RESERVATION_ARCHIVED',symbol:t.symbol});}
 s.events=s.events.slice(-200);
 return 'OLD_ORDER_RESERVATIONS_ARCHIVED';
}
export function octoberReviewSummary(s){
 const r=s?.octoberOrderReview;if(!r)return null;
 return {id:r.id,status:r.status,firstVerifiedAt:r.firstVerifiedAt,completedAt:r.completedAt??null,historicalOutcome:r.historicalOutcome??'UNKNOWN',currentExposure:r.currentExposure??null,releasedUsd:r.releasedUsd??0,releasedSlots:r.releasedSlots??0,symbols:targets.map(t=>t.symbol)};
}
