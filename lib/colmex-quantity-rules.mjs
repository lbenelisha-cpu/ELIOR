// TraderEvolution instruments: an explicitly null maximum is not configured.
// https://guide.traderevolution.com/traderevolution-api/traderevolution-apis/client-api/instruments
// Required minimum and lot step must always be positive. Missing or malformed
// maxima are not interpreted as null. The application's cash budget still caps every order.
const positive=value=>typeof value!=='boolean'&&value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
export function colmexQuantityRules(details={}){
 const size=positive(details.lotSize),minimum=positive(details.minLot),step=positive(details.lotStep),maximum=positive(details.maxLot);
 const minQty=size&&minimum?size*minimum:null,qtyStep=size&&step?size*step:null,maxQty=size&&maximum?size*maximum:null;
 const maximumStatus=details.maxLot===null?'UNCONFIGURED':maximum?'CONFIGURED':'INVALID';
 const maxCash=details.maxLotInCash==null?null:positive(details.maxLotInCash);
 const valid=[minQty,qtyStep].every(n=>Number.isFinite(n)&&n>0)&&
  (maximumStatus==='UNCONFIGURED'||maximumStatus==='CONFIGURED'&&Number.isFinite(maxQty)&&maxQty>=minQty)&&
  (details.maxLotInCash==null||maxCash!==null);
 return {valid,minQty,qtyStep,maxQty,maxCash,maximumStatus};
}
