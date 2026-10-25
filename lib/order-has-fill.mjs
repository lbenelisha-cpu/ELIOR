// A terminal cancellation/expiry can contain a real partial execution.
export function orderHasFill(action,{adopted=false}={}){
  if(!['BUY','SELL'].includes(action?.type)||!(Number(action.qty)>0))return false;
  if(!action.status||['FILLED','PARTIALLY_FILLED'].includes(action.status))return true;
  if(action.status==='ADOPTED')return adopted;
  return ['CANCELED','EXPIRED','EXPIRED_IN_MATCH','REJECTED'].includes(action.status)&&Number(action.executedQty)>0;
}
