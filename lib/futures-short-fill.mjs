// Binance avgPrice may be rounded more coarsely than account.entryPrice.
// Preserve the weighted fill price from the executed quote amount and quantity.
export function futuresFillPrice(order){
 const qty=Number(order.executedQty),quote=Number(order.cumQuote),avg=Number(order.avgPrice);
 const text=String(order.avgPrice??'');
 if(!/^\d+(?:\.\d+)?$/.test(text)||!Number.isFinite(qty)||qty<=0||!Number.isFinite(quote)||quote<=0||!Number.isFinite(avg)||avg<=0)throw Error('FUTURES_FILL_PRICE_UNVERIFIED');
 const price=quote/qty,unit=10**-(text.split('.')[1]?.length||0);
 if(!Number.isFinite(price)||price<=0||Math.abs(price-avg)>unit+Number.EPSILON*Math.max(price,avg)*8)throw Error('FUTURES_FILL_PRICE_UNVERIFIED');
 return price;
}
