// Persist only fixed diagnostic codes, never broker messages, tokens or request bodies.
const codes=new Set(['WRITE_DEADLINE','WRITE_AUTH_FAILED','WRITE_INVALID_REQUEST','WRITE_NETWORK_OR_TIMEOUT','WRITE_INVALID_RESPONSE','WRITE_HTTP_ERROR','WRITE_ACCESS_DENIED','WRITE_RATE_LIMIT','WRITE_BROKER_ERROR','WRITE_VALIDATION_REJECTED','WRITE_ACK_MISSING_ORDER_ID','WRITE_OUTCOME_UNKNOWN']);
export class BrokerWriteError extends Error {
 constructor(code,{outcome='UNKNOWN',httpStatus=null,responseStatus=null}={}){
  super(codes.has(code)?code:'WRITE_OUTCOME_UNKNOWN');
  this.code=this.message;this.outcome=outcome;this.httpStatus=httpStatus;this.responseStatus=responseStatus;
 }
}
export function writeFailure(error,at){
 const known=error instanceof BrokerWriteError;
 return {at,code:known?error.code:'WRITE_OUTCOME_UNKNOWN',outcome:known&&['NOT_SENT','REJECTED'].includes(error.outcome)?error.outcome:'UNKNOWN',
  httpStatus:known&&Number.isInteger(error.httpStatus)&&error.httpStatus>=100&&error.httpStatus<=599?error.httpStatus:null,
  responseStatus:known&&['ok','error'].includes(error.responseStatus)?error.responseStatus:null};
}
export function recordWriteFailure(state,intent,error,at){
 const failure=writeFailure(error,at);intent.writeFailure=failure;
 state.lastWriteFailure={...failure,kind:intent.kind,symbol:intent.symbol};
 if(intent.manual&&state.manualRequests?.[intent.id])state.manualRequests[intent.id].failure=failure;
 const resolved=failure.outcome==='NOT_SENT'||failure.outcome==='REJECTED';
 if(resolved){
  if(state.pending===intent)state.pending=null;
  else state.riskPending=(state.riskPending||[]).filter(p=>p!==intent);
  if(intent.manual&&state.manualRequests?.[intent.id])Object.assign(state.manualRequests[intent.id],{status:failure.outcome,reason:failure.code,completedAt:at});
 }
 return {failure,resolved};
}
// A generic error or timeout is not proof of rejection. Only an explicit input
// validation error in a well-formed HTTP 400 broker response is conclusive here.
export function isValidationRejection(status,data){
 if(status!==400||data?.s!=='error'||data.d?.orderId||typeof data.errmsg!=='string')return false;
 const message=data.errmsg.slice(0,2000);
 if(/timeout|timed?\s*out|unknown|pending|connection|internal|duplicate|already|processing|filled|executed|accepted|partial/i.test(message))return false;
 return /(?:invalid|unsupported|not supported|not allowed|must be|is required|missing required).*(?:qty|quantity|price|validity|order type|stoploss|takeprofit|usercomment|instrument)|(?:qty|quantity|price|validity|order type|stoploss|takeprofit|usercomment|instrument).*(?:invalid|unsupported|not supported|not allowed|must be|is required)/i.test(message);
}
