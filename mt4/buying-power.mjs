export function buyingPower(quote,account,positions,quotes,now=Date.now()/1000){
 const ready=quote&&Number.isFinite(quote.tickTime)&&now-quote.tickTime<=90&&quote.tickTime<=now+5&&quote.currency==='USD'&&quote.contractSize===1&&Number.isFinite(quote.minLot)&&quote.minLot>0&&Number.isFinite(quote.ask)&&quote.ask>0;
 if(!ready)return {known:false,message:'לא ניתן לבדוק יכולת קנייה בלי מחיר ומפרט עדכניים'};
 const cost=quote.minLot*quote.ask,balance=account?.balance;
 let exposure=0,exposureKnown=true;
 for(const p of positions||[]){
  if(p.type!==0){exposureKnown=false;continue;}
  const q=quotes.find(q=>q.symbol===p.symbol);
  if(!q||q.currency!=='USD'||q.contractSize!==1||!Number.isFinite(q.ask)||q.ask<=0||!Number.isFinite(q.tickTime)||now-q.tickTime>90||q.tickTime>now+5||!Number.isFinite(p.lots)){exposureKnown=false;continue;}
  exposure+=p.lots*q.ask;
 }
 return {known:true,cost,minimumLots:quote.minLot,balance:Number.isFinite(balance)?balance:null,cashEnough:Number.isFinite(balance)?balance>=cost:null,freeMargin:Number.isFinite(account?.freeMargin)?account.freeMargin:null,remaining:exposureKnown?Math.max(0,120-exposure):null,budgetEnough:exposureKnown?exposure+cost<=120:false};
}
