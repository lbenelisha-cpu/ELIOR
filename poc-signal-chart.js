import {drawPocModel} from './channel-poc-overlay.js?v=20261107-poc';
// A read-only chart of the exact market bars from the server's signal report.
// Futures evidence is never painted over the Spot candles.
export function drawSignalChart(host,{symbol,market,conditions},now=Date.now()){
 host.replaceChildren();const doc=host.ownerDocument||document,model=conditions?.model,chart=conditions?.chart;
 const add=(tag,text)=>{const e=doc.createElement(tag);e.textContent=text;host.append(e);return e;};
 add('h3',symbol+' · '+market+' · '+(model?.side||'')+' · 5 דקות');
 if(!model?.profile||chart?.interval!=='5m'||!chart.bars?.length){add('p','טרם נקבע פרופיל נפח לאיתות הזה.');return;}
 const stale=now<conditions.at||now-conditions.at>90000||now>=conditions.expiresAt;
 add('p',(stale?'תמונת מצב קודמת · ':'תמונת מצב מהסריקה · ')+new Date(conditions.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})+' · תצוגה בלבד');
 const bars=chart.bars,NS='http://www.w3.org/2000/svg',svg=doc.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 900 420');svg.setAttribute('role','img');svg.setAttribute('aria-label',symbol+' '+model.side+' Fixed Range Volume Profile');svg.style.cssText='display:block;width:100%;background:#08111f;border-radius:10px';host.append(svg);
 const bounds={left:20,right:805,top:25,bottom:365},low=Math.min(model.profile.low,...bars.map(b=>b.low)),high=Math.max(model.profile.high,...bars.map(b=>b.high)),pad=(high-low)*.08||1,step=(bounds.right-bounds.left)/bars.length;
 const x=i=>bounds.left+step*(i+.5),y=p=>bounds.bottom-(p-low+pad)/(high-low+2*pad)*(bounds.bottom-bounds.top);
 const node=(tag,attrs,text)=>{const e=doc.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text)e.textContent=text;svg.append(e);return e;};
 for(let k=0;k<5;k++){const price=low+(high-low)*k/4,py=y(price);node('line',{x1:bounds.left,x2:bounds.right,y1:py,y2:py,stroke:'#193346'});node('text',{x:815,y:py+4,fill:'#a5bed3','font-size':11},price.toLocaleString('en-US',{maximumSignificantDigits:7}));}
 bars.forEach((b,i)=>{const color=b.close>=b.open?'#20c99c':'#fb647a';node('line',{x1:x(i),x2:x(i),y1:y(b.high),y2:y(b.low),stroke:color});node('rect',{x:x(i)-step*.29,y:Math.min(y(b.open),y(b.close)),width:step*.58,height:Math.max(1,Math.abs(y(b.open)-y(b.close))),fill:color});});
 drawPocModel(svg,{symbol,bars:bars.map(b=>({...b,time:b.openTime})),sourceBars:bars,bounds,x,y},model);
 for(let k=0;k<4;k++){const i=Math.floor(k*(bars.length-1)/3);node('text',{x:Math.max(70,Math.min(745,x(i))),y:395,fill:'#a5bed3','font-size':11,'text-anchor':'middle'},new Date(bars[i].openTime).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}));}
 add('p','כתום: התעלה שנקבעה לפני הפריצה · סגול: הדשדוש בתחילתה · צהוב: POC משוער · A–B: טווח הפרופיל הקבוע.');
}
let dialog;
export function openSignalChart(input){
 if(!dialog){dialog=document.createElement('dialog');dialog.dir='rtl';dialog.style.cssText='width:min(960px,95vw);max-height:92vh;overflow:auto;background:#10212c;color:#e8f2ff;border:1px solid #506b82;border-radius:16px;padding:18px';document.body.append(dialog);}
 dialog.replaceChildren();const close=document.createElement('button');close.textContent='סגור גרף';close.type='button';close.onclick=()=>dialog.close();dialog.append(close);
 if(input.market==='Binance Futures'&&/^[A-Z0-9]+USDT$/.test(input.symbol)){const link=document.createElement('a');link.textContent='פתח ב־TradingView ↗';link.href=globalThis.LEVI_TRADINGVIEW_URL?.('BINANCE:'+input.symbol+'.P')||'https://www.tradingview.com/chart/?symbol=BINANCE%3A'+input.symbol+'.P&interval=5';link.target='_blank';link.rel='noopener noreferrer';link.style.cssText='color:#6ce3c4;margin:12px';dialog.append(link);}
 const host=document.createElement('div');dialog.append(host);drawSignalChart(host,input);if(!dialog.open)dialog.showModal();
}
globalThis.LEVI_POC_CHART={open:openSignalChart};
globalThis.addEventListener?.('trade-device-expired',()=>{dialog?.close();dialog?.replaceChildren();});
