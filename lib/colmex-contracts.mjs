const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const fields=['symbol','description','depositCurrency','baseCurrency','profitCurrency','profitMode','contractSize','tickSize','tickValue','minLot','lotStep','marginRequired','swapLong','swapShort','swapType','bid','ask','tickTime','capturedAt','tradeAllowed'];
export function contractReport(x,now=Date.now()){
 const issues=[];let expectedTickValue=null,minimumNotional=null,minimumSpreadCost=null;
 if(!Number.isFinite(x.capturedAt)||now/1000-x.capturedAt>600||x.capturedAt>now/1000+5||!Number.isFinite(x.tickTime)||now/1000-x.tickTime>600||x.tickTime>now/1000+5)issues.push('מחיר או מפרט אינם עדכניים');
 if(!x.tradeAllowed)issues.push('הנכס אינו זמין למסחר לפי הברוקר');
 if(![0,1].includes(x.profitMode))issues.push('נדרש אימות מכפיל חוזה ושיטת תמחור');
 if(!/^[A-Z]{3}$/.test(x.depositCurrency||'')||x.profitCurrency!==x.depositCurrency)issues.push('נדרש שער המרה מאומת ממטבע הרווח למטבע החשבון');
 if(!['contractSize','tickSize','tickValue','minLot','lotStep','bid','ask'].every(k=>positive(x[k]))||x.ask<x.bid)issues.push('מפרט יחידות או מחיר אינו תקין');
 if(!issues.length){
  expectedTickValue=x.contractSize*x.tickSize;
  if(Math.abs(expectedTickValue-x.tickValue)/expectedTickValue>0.01)issues.push('ערך הטיק אינו תואם לגודל החוזה — נדרש בירור יחידות');
  else {minimumNotional=x.minLot*x.contractSize*x.ask;minimumSpreadCost=x.minLot*x.contractSize*(x.ask-x.bid);}
 }
 return {symbol:x.symbol,description:x.description,currency:x.depositCurrency||'',unitConsistent:issues.length===0,issues,expectedTickValue,minimumNotional,minimumSpreadCost,reportedTickValue:x.tickValue,contractSize:x.contractSize,minLot:x.minLot,profitCurrency:x.profitCurrency,profitMode:x.profitMode,costsVerified:false,simulationEligible:false,costNotice:'עמלה, כללי חיוב Swap, גלגול ופקיעה טרם אומתו. סכומי המרווח אינם עלות כוללת.'};
}
export function contractAudit(items,now=Date.now()){
 const reports=Object.values(items||{}).map(x=>contractReport(x,now)).sort((a,b)=>a.symbol.localeCompare(b.symbol));
 return {checked:reports.length,unitConsistent:reports.filter(x=>x.unitConsistent).length,simulationEligible:0,reports};
}
export function exportContracts(items,now=Date.now()){
 return {format:'elior-colmex-contracts-v1',exportedAt:new Date(now).toISOString(),purpose:'אימות מפרטי חוזים לפני סימולציה; ללא מפתחות או מידע על פוזיציות',contracts:Object.values(items||{}).map(x=>Object.fromEntries(fields.filter(k=>x[k]!==undefined).map(k=>[k,x[k]])))};
}
