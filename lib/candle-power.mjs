export function analyzeCandlePower(candles,lookback=10){
  const rows=(Array.isArray(candles)?candles:[]).slice(-Math.max(3,lookback));
  const analyzed=rows.map((c,index)=>{
    const open=Number(c.open),high=Number(c.high),low=Number(c.low),close=Number(c.close),volume=Number(c.volume||0);
    const range=Math.max(high-low,Number.EPSILON);
    const body=Math.abs(close-open);
    const upper=Math.max(0,high-Math.max(open,close));
    const lower=Math.max(0,Math.min(open,close)-low);
    const bodyRatio=body/range;
    const upperRatio=upper/range;
    const lowerRatio=lower/range;
    const closeLocation=(close-low)/range;
    const changePct=open?((close/open)-1)*100:0;

    let state='NEUTRAL',reason='נר מאוזן';
    if(close>open && bodyRatio>=0.45 && closeLocation>=0.68){
      state='BUYERS_STRONG'; reason='גוף ירוק משמעותי וסגירה קרובה לגבוה';
    }else if(close<open && bodyRatio>=0.45 && closeLocation<=0.32){
      state='SELLERS_STRONG'; reason='גוף אדום משמעותי וסגירה קרובה לנמוך';
    }else if(lowerRatio>=0.42 && closeLocation>=0.55){
      state='BUYERS_REJECTION'; reason='פתיל תחתון ארוך — קונים דחו את הירידה';
    }else if(upperRatio>=0.42 && closeLocation<=0.45){
      state='SELLERS_REJECTION'; reason='פתיל עליון ארוך — מוכרים דחו את העלייה';
    }else if(close>open){
      state='BUYERS_EDGE'; reason='יתרון קל לקונים';
    }else if(close<open){
      state='SELLERS_EDGE'; reason='יתרון קל למוכרים';
    }

    const buyerPoints=
      (close>=open?25:0)+
      Math.max(0,Math.min(35,closeLocation*35))+
      Math.max(0,Math.min(25,lowerRatio*50))+
      (state==='BUYERS_STRONG'?15:state==='BUYERS_REJECTION'?12:state==='BUYERS_EDGE'?6:0);
    const sellerPoints=
      (close<=open?25:0)+
      Math.max(0,Math.min(35,(1-closeLocation)*35))+
      Math.max(0,Math.min(25,upperRatio*50))+
      (state==='SELLERS_STRONG'?15:state==='SELLERS_REJECTION'?12:state==='SELLERS_EDGE'?6:0);

    return {
      index:index+1,
      openTime:Number(c.openTime||0),
      closeTime:Number(c.closeTime||0),
      open,high,low,close,volume,
      changePct,
      bodyPct:bodyRatio*100,
      upperWickPct:upperRatio*100,
      lowerWickPct:lowerRatio*100,
      closeLocationPct:closeLocation*100,
      state,reason,
      buyerPoints:Math.round(buyerPoints*10)/10,
      sellerPoints:Math.round(sellerPoints*10)/10
    };
  });

  let higherHighs=0,higherLows=0,lowerHighs=0,lowerLows=0;
  for(let i=1;i<rows.length;i++){
    if(Number(rows[i].high)>Number(rows[i-1].high))higherHighs++; else if(Number(rows[i].high)<Number(rows[i-1].high))lowerHighs++;
    if(Number(rows[i].low)>Number(rows[i-1].low))higherLows++; else if(Number(rows[i].low)<Number(rows[i-1].low))lowerLows++;
  }

  const buyerScore=analyzed.reduce((a,x)=>a+x.buyerPoints,0);
  const sellerScore=analyzed.reduce((a,x)=>a+x.sellerPoints,0);
  const structureUp=higherHighs+higherLows;
  const structureDown=lowerHighs+lowerLows;

  let trend='SIDEWAYS';
  if(structureUp>=structureDown+3 && buyerScore>sellerScore)trend='UP';
  else if(structureDown>=structureUp+3 && sellerScore>buyerScore)trend='DOWN';

  const buyerCandles=analyzed.filter(x=>x.state.startsWith('BUYERS')).length;
  const sellerCandles=analyzed.filter(x=>x.state.startsWith('SELLERS')).length;
  const neutralCandles=Math.max(0,analyzed.length-buyerCandles-sellerCandles);

  let control='BALANCED';
  if(buyerCandles>=7 && sellerCandles<=3)control='BUYERS';
  else if(sellerCandles>=7 && buyerCandles<=3)control='SELLERS';

  return {
    lookback:analyzed.length,
    trend,
    control,
    buyerCandles,
    sellerCandles,
    neutralCandles,
    buyerScore:Math.round(buyerScore*10)/10,
    sellerScore:Math.round(sellerScore*10)/10,
    higherHighs,higherLows,lowerHighs,lowerLows,
    explanation:
      trend==='UP'?'מבנה המחיר נוטה לשיאים ושפלים עולים':
      trend==='DOWN'?'מבנה המחיר נוטה לשיאים ושפלים יורדים':
      'אין כרגע רצף מספיק ברור של שיאים ושפלים',
    candles:analyzed
  };
}

