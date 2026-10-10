(function(root){
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
  root.BinanceIndicators={calculateIndicators,drawIndicator};
})(globalThis);
