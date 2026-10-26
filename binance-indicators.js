(function(root){
  // Display-only directional swings in CLOSED prices. A 1% pullback completes
  // a rise; smaller pullbacks stay in the same move. No intrabar order is assumed.
  function risingMoves(candles,{minPct=1,reversalPct=1,now=Date.now()}={}){
    if(!(minPct>0)||!(reversalPct>0))return [];
    const moves=[];let low=null,peak=null,previous=null;
    const finish=(status,confirmedAt=null)=>{
      if(low&&peak)moves.push({startIndex:low.index,endIndex:peak.index,startPrice:low.price,endPrice:peak.price,startTime:low.time,endTime:peak.time,pct:(peak.price-low.price)/low.price*100,status,confirmedAt});
      low=null;peak=null;
    };
    for(let index=0;index<candles.length;index++){
      const bar=candles[index],price=Number(bar.close),time=Number(bar.closeTime),openTime=Number(bar.openTime);
      if(bar.closed===false||time>now)continue;
      if(![price,time,openTime].every(Number.isFinite)||price<=0||time<openTime){finish('interrupted');previous=null;continue;}
      if(previous&&(openTime!==previous.time+1||time<=previous.time))finish('interrupted');
      const point={index,price,time};previous=point;
      if(!low){low=point;continue;}
      if(!peak){
        if(price<low.price)low=point;
        else if((price-low.price)/low.price*100>=minPct-1e-10)peak=point;
      }else if(price>peak.price)peak=point;
      else if((peak.price-price)/peak.price*100>=reversalPct-1e-10){finish('completed',time);low=point;}
    }
    finish('developing');return moves;
  }
  function calculateIndicators(candles,period=14,rocPeriod=12){
    const closes=candles.map(c=>Number(c.close));
    const rsi=closes.map(()=>null),roc=closes.map(()=>null);
    if(!closes.every(x=>Number.isFinite(x)&&x>0))return {rsi,roc};
    let gain=0,loss=0;
    const strength=()=>gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
    for(let i=1;i<closes.length;i++){
      const delta=closes[i]-closes[i-1],up=Math.max(0,delta),down=Math.max(0,-delta);
      if(i<=period){gain+=up/period;loss+=down/period;if(i===period)rsi[i]=strength();}
      else {gain=(gain*(period-1)+up)/period;loss=(loss*(period-1)+down)/period;rsi[i]=strength();}
    }
    for(let i=rocPeriod;i<closes.length;i++)roc[i]=(closes[i]/closes[i-rocPeriod]-1)*100;
    return {rsi,roc};
  }
  function fallingMoves(candles,{minPct=1,reversalPct=1,now=Date.now()}={}){
    if(!(minPct>0)||!(reversalPct>0))return [];
    const moves=[];let high=null,trough=null,previous=null;
    const finish=(status,confirmedAt=null)=>{
      if(high&&trough)moves.push({startIndex:high.index,endIndex:trough.index,startPrice:high.price,endPrice:trough.price,startTime:high.time,endTime:trough.time,pct:(trough.price-high.price)/high.price*100,status,confirmedAt});
      high=null;trough=null;
    };
    for(let index=0;index<candles.length;index++){
      const bar=candles[index],price=Number(bar.close),time=Number(bar.closeTime),openTime=Number(bar.openTime);
      if(bar.closed===false||time>now)continue;
      if(![price,time,openTime].every(Number.isFinite)||price<=0||time<openTime){finish('interrupted');previous=null;continue;}
      if(previous&&(openTime!==previous.time+1||time<=previous.time))finish('interrupted');
      const point={index,price,time};previous=point;
      if(!high){high=point;continue;}
      if(!trough){if(price>high.price)high=point;else if((high.price-price)/high.price*100>=minPct-1e-10)trough=point;}
      else if(price<trough.price)trough=point;
      else if((price-trough.price)/trough.price*100>=reversalPct-1e-10){finish('completed',time);high=point;}
    }
    finish('developing');return moves;
  }
  // Two aligned rows outside the candle plot. Dense bins retain all moves in
  // an explicit overflow button instead of overlapping or summing percentages.
  function moveLabelLayout(moves,{left,right,step,width=62}={}){
    if(!(right>left&&step>0))return [];
    const count=Math.max(1,Math.floor((right-left)/(width+4))),cell=(right-left)/count,labelWidth=Math.min(width,cell-2),bins=new Map();
    for(const move of moves){
      const x=left+step*(move.endIndex+.5),bin=Math.max(0,Math.min(count-1,Math.floor((x-left)/cell)));
      if(!bins.has(bin))bins.set(bin,[]);bins.get(bin).push(move);
    }
    const placed=[];
    for(const [bin,group]of bins){
      const x=left+bin*cell+(cell-labelWidth)/2;
      const sorted=group.slice().sort((a,b)=>Math.abs(b.pct)-Math.abs(a.pct)||a.endIndex-b.endIndex);
      placed.push({x,width:labelWidth,row:0,moves:[sorted[0]],overflow:false});
      if(sorted.length>1)placed.push({x,width:labelWidth,row:1,moves:sorted.slice(1),overflow:sorted.length>2});
    }
    return placed;
  }
  function drawIndicator(canvas,series,{name,color,bounds,levels=[]}){
    const rect=canvas.getBoundingClientRect(),ratio=root.devicePixelRatio||1;
    if(!rect.width||!rect.height)return;
    canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);
    const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);
    const W=rect.width,H=rect.height,left=18,right=56,top=25,bottom=18;
    ctx.clearRect(0,0,W,H);ctx.direction='ltr';ctx.textAlign='left';ctx.font='bold 14px Arial';
    const valid=series.filter(Number.isFinite),last=series.at(-1);
    ctx.fillStyle=color;ctx.fillText(name+' · '+(Number.isFinite(last)?last.toFixed(2)+(name.startsWith('ROC')?'%':''):'אין מספיק נרות'),left,15);
    if(!valid.length)return;
    const low=bounds?bounds[0]:Math.min(0,...valid),high=bounds?bounds[1]:Math.max(0,...valid);
    const pad=bounds?0:(high-low)*.1||1,min=low-pad,max=high+pad;
    const y=value=>top+(max-value)/(max-min)*(H-top-bottom);
    for(const level of levels){ctx.strokeStyle='#43566b';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(left,y(level));ctx.lineTo(W-right,y(level));ctx.stroke();ctx.fillStyle='#a6b7ca';ctx.fillText(String(level),W-right+6,y(level)+4);}
    ctx.setLineDash([]);ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();let started=false;
    series.forEach((v,i)=>{if(!Number.isFinite(v)){started=false;return;}const x=left+(i+.5)*(W-left-right)/series.length;if(started)ctx.lineTo(x,y(v));else {ctx.moveTo(x,y(v));started=true;}});ctx.stroke();
  }
  root.BinanceIndicators={calculateIndicators,drawIndicator,risingMoves,fallingMoves,moveLabelLayout};
})(globalThis);
