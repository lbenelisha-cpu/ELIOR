// Public operational summary: omit order payloads, broker messages and credentials.
export const COLMEX_ORDER_DIAGNOSTICS_VERSION='COLMEX_ORDER_DIAGNOSTICS_V1';
const integer=n=>Number.isSafeInteger(n)&&n>=0?n:null;
export function pendingDiagnostic(intent){
 const proof=intent.reconciliation;
 return {kind:intent.kind,symbol:intent.symbol,at:intent.at,reviewRequired:!!intent.reviewRequired,
  requestId:/^[a-f0-9-]{36}$/i.test(intent.id)?intent.id:null,acknowledged:!!intent.acceptedAt,
  failure:intent.writeFailure?failureDiagnostic(intent.writeFailure):null,
  reconciliation:proof?{at:integer(proof.at),historyAvailable:proof.historyAvailable===true,historyCount:integer(proof.historyCount),openOrders:integer(proof.openOrders),openPositions:integer(proof.openPositions),matches:integer(proof.matches),relatedHistoryCount:integer(proof.relatedHistoryCount),matchBy:proof.matchBy==='ORDER_ID'?'ORDER_ID':'COMMENT'}:null};
}
export function failureDiagnostic(failure){
 const code=/^WRITE_(?:DEADLINE|AUTH_FAILED|INVALID_REQUEST|NETWORK_OR_TIMEOUT|INVALID_RESPONSE|HTTP_ERROR|ACCESS_DENIED|RATE_LIMIT|BROKER_ERROR|VALIDATION_REJECTED|ACK_MISSING_ORDER_ID|OUTCOME_UNKNOWN)$/.test(failure.code)?failure.code:'WRITE_OUTCOME_UNKNOWN';
 return {at:integer(failure.at),code,outcome:['NOT_SENT','REJECTED'].includes(failure.outcome)?failure.outcome:'UNKNOWN',httpStatus:Number.isInteger(failure.httpStatus)&&failure.httpStatus>=100&&failure.httpStatus<=599?failure.httpStatus:null,responseStatus:['ok','error'].includes(failure.responseStatus)?failure.responseStatus:null};
}
