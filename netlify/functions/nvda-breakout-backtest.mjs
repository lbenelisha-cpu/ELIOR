import {td} from '../../lib/agent.mjs';

const reply=(statusCode,d)=>({
  statusCode,
  headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},
  body:JSON.stringify(d)
});

const FEE_PCT=0.1;
const INITIAL_ILS=5000;
const RANGE_BARS=15;
const MAX_RANGE_PCT=1.2;
const BREAKOUT_BUFFER_PCT=0.1;
const STAGE2_CONFIRM_PCT=0.6;
const TRAIL_PCT=1.5;

function num(x){return Number(x);}
function pct(a,b){return a?((b/a)-1)*100:0;}

function simulate(rows){
  const bars=rows
    .map(x=>({
      dt:String(x.datetime),
      open:num(x.open),high:num(x.high),low:num(x.low),close:num(x.close),volume:num(x.volume||0)
    }))
    .filter(x=>[x.open,x.high,x.low,x.close].every(v=>Number.isFinite(v)&&v>0))
    .sort((a,b)=>a.dt.localeCompare(b.dt));

  let cash=INITIAL_ILS;
  let pos=null;
  let pendingStage1=null;
  let trades=[];
  let events=[];
  let equity=[];
  let peakEquity=INITIAL_ILS;
  let maxDD=0;

  const buy=(amount,price,stage,dt,breakoutLevel)=>{
    const fee=amount*(FEE_PCT/100);
    const invest=Math.max(0,amount-fee);
    const qty=invest/price;
    cash-=amount;
    if(!pos){
      pos={
        qty,
        cost:amount,
        entryPrice:price,
        stage:1,
        peakPrice:price,
        breakoutLevel,
        entryAt:dt
      };
    }else{
      const totalQty=pos.qty+qty;
      const totalCost=pos.cost+amount;
      pos={
        ...pos,
        qty:totalQty,
        cost:totalCost,
        entryPrice:totalCost/totalQty,
        stage:2,
        peakPrice:Math.max(pos.peakPrice,price),
        stage2At:dt
      };
    }
    events.push({type:'BUY',stage,dt,price,amount,fee});
  };

  const sell=(price,dt,reason)=>{
    const gross=pos.qty*price;
    const fee=gross*(FEE_PCT/100);
    const proceeds=gross-fee;
    const pnl=proceeds-pos.cost;
    const pnlPct=pnl/pos.cost*100;
    cash+=proceeds;
    trades.push({
      entryAt:pos.entryAt,
      exitAt:dt,
      stage:pos.stage,
      entryPrice:pos.entryPrice,
      exitPrice:price,
      cost:pos.cost,
      proceeds,
      pnl,
      pnlPct,
      reason
    });
    events.push({type:'SELL',dt,price,proceeds,fee,pnl,pnlPct,reason});
    pos=null;
  };

  for(let i=RANGE_BARS;i<bars.length;i++){
    const b=bars[i];

    // Execute a stage-1 breakout signal at the next bar open to avoid look-ahead.
    if(pendingStage1 && !pos){
      const amount=Math.min(cash,INITIAL_ILS*0.5);
      if(amount>0)buy(amount,b.open,1,b.dt,pendingStage1.breakoutLevel);
      pendingStage1=null;
    }

    if(pos){
      pos.peakPrice=Math.max(pos.peakPrice,b.high);

      // Stage 2 is added only after +0.6% continuation while still above breakout.
      if(pos.stage===1){
        const stage2Trigger=Math.max(pos.entryPrice*(1+STAGE2_CONFIRM_PCT/100),pos.breakoutLevel);
        if(b.high>=stage2Trigger && cash>0){
          const amount=Math.min(cash,INITIAL_ILS*0.5);
          if(amount>0)buy(amount,stage2Trigger,2,b.dt,pos.breakoutLevel);
        }
      }

      // Conservative intrabar trailing-stop check after peak update.
      const stop=pos.peakPrice*(1-TRAIL_PCT/100);
      if(b.low<=stop){
        sell(stop,b.dt,'TRAILING_1_5_FROM_PEAK');
      }
    }

    if(!pos && !pendingStage1 && i>=RANGE_BARS){
      const box=bars.slice(i-RANGE_BARS,i);
      const high=Math.max(...box.map(x=>x.high));
      const low=Math.min(...box.map(x=>x.low));
      const rangePct=(high/low-1)*100;
      const candleRange=Math.max(Number.EPSILON,b.high-b.low);
      const bodyRatio=Math.abs(b.close-b.open)/candleRange;
      const closeLocation=(b.close-b.low)/candleRange;
      const strongBreakout=
        rangePct<=MAX_RANGE_PCT &&
        b.close>b.open &&
        b.close>high*(1+BREAKOUT_BUFFER_PCT/100) &&
        bodyRatio>=0.55 &&
        closeLocation>=0.72;

      if(strongBreakout){
        pendingStage1={signalAt:b.dt,breakoutLevel:high,rangePct,bodyRatio,closeLocation};
        events.push({
          type:'SIGNAL',
          dt:b.dt,
          breakoutLevel:high,
          rangePct,
          bodyRatio,
          closeLocation,
          close:b.close
        });
      }
    }

    const mark=pos?pos.qty*b.close:0;
    const value=cash+mark;
    peakEquity=Math.max(peakEquity,value);
    maxDD=Math.max(maxDD,(peakEquity-value)/peakEquity*100);
    equity.push({dt:b.dt,value});
  }

  const last=bars.at(-1);
  const finalValue=cash+(pos?pos.qty*last.close:0);
  const closedPnl=trades.reduce((a,t)=>a+t.pnl,0);
  const wins=trades.filter(t=>t.pnl>0).length;
  return {
    bars:bars.length,
    from:bars[0]?.dt||null,
    to:last?.dt||null,
    initialIls:INITIAL_ILS,
    finalValueIls:finalValue,
    pnlIls:finalValue-INITIAL_ILS,
    returnPct:(finalValue/INITIAL_ILS-1)*100,
    maxDrawdownPct:maxDD,
    closedTrades:trades.length,
    wins,
    losses:trades.length-wins,
    winRate:trades.length?wins/trades.length*100:null,
    openPosition:pos?{stage:pos.stage,entryPrice:pos.entryPrice,qty:pos.qty,cost:pos.cost,lastPrice:last.close,unrealizedIls:pos.qty*last.close-pos.cost}:null,
    trades,
    events,
    equity
  };
}

export async function handler(event){
  if(event.httpMethod!=='GET')return reply(405,{error:'Method not allowed'});
  try{
    const data=await td('time_series',{
      symbol:'NVDA',
      interval:'1min',
      outputsize:3000,
      order:'ASC',
      timezone:'America/New_York'
    },60);

    const values=Array.isArray(data.values)?data.values:[];
    if(values.length<100)throw Error('Insufficient NVDA 1-minute data');

    const dates=[...new Set(values.map(x=>String(x.datetime).slice(0,10)))].sort();
    const keep=new Set(dates.slice(-5));
    const week=values.filter(x=>keep.has(String(x.datetime).slice(0,10)));

    return reply(200,{
      symbol:'NVDA',
      source:'Twelve Data',
      timeframe:'1min',
      tradingDays:[...keep],
      assumptions:{
        initialIls:INITIAL_ILS,
        feePct:FEE_PCT,
        fxIgnored:true,
        consolidationBars:RANGE_BARS,
        maxRangePct:MAX_RANGE_PCT,
        breakoutBufferPct:BREAKOUT_BUFFER_PCT,
        stage1Pct:50,
        stage2ConfirmPct:STAGE2_CONFIRM_PCT,
        stage2Pct:50,
        trailingStopPct:TRAIL_PCT,
        execution:'Stage 1 at next 1m open; stage 2 at trigger; trailing stop at modeled trigger'
      },
      result:simulate(week)
    });
  }catch(e){
    console.error('NVDA_BACKTEST_ERROR',e?.stack||String(e));
    return reply(503,{error:e.message||'Backtest failed'});
  }
}
