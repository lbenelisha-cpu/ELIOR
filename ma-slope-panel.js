import {analyzeSlope,slopeReading} from './lib/ma-slope.mjs?v=20261026-slope1';
import {stockSessionGap} from './lib/colmex-market-hours.mjs';
const panels=new WeakMap();
const signed=(n,d=4)=>Number.isFinite(n)?(n>0?'+':'')+n.toFixed(d):'—';
const statusText={NO_DATA:'ממתין לנרות 5 דקות',WARMUP:'אין מספיק נרות רציפים לחישוב MA200',STALE:'נתוני עבר · ממתין לנרות עדכניים',INVALID_DATA:'פער או שגיאה בנתוני הנרות',READY:'נרות סגורים · מדד לניתוח'};
const readingText={UNAVAILABLE:'אין קריאה עדכנית',FLAT:'ללא כיוון ברור',AGAINST_CONFIRMED:'השיפוע הקצר נגד כיוון העסקה בשתי קריאות',AGAINST_PENDING:'השיפוע הקצר נגד כיוון העסקה · טרם אושר',WEAKENING:'המומנטום בכיוון העסקה נחלש',SUPPORTIVE:'השיפוע הקצר תומך בכיוון העסקה'};
const gauge='<svg viewBox="0 0 180 150" aria-hidden="true"><path d="M90 15 A60 60 0 0 1 90 135" fill="none" stroke="currentColor" opacity=".25" stroke-width="6"/><path d="M90 75 H155" stroke="currentColor" opacity=".25" stroke-dasharray="3 4"/><g class="slope-needle"><path d="M90 75 H145 M136 69 L145 75 L136 81" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></g><circle cx="90" cy="75" r="4" fill="currentColor"/><text x="65" y="16">90°</text><text x="158" y="79">0°</text><text x="59" y="141">−90°</text></svg>';
export function renderSlopePanel(host,bars,{symbol='',platform='binance',source=''}={}){
 if(!host)return;
 let panel=panels.get(host);
 if(!panel){
  host.classList.add('ma-slope-panel');
  host.innerHTML='<details><summary><span><b>שיפוע המגמה · MA200</b><small class="slope-summary">ממתין לנתונים</small></span><span aria-hidden="true">＋</span></summary><div class="slope-content"><div class="slope-controls"><label>חלון מדידה <select class="slope-window"><option value="5">5 נרות · 25 דקות</option><option value="10" selected>10 נרות · 50 דקות</option></select></label><label class="slope-side-label">כיוון לניתוח <select class="slope-side"><option value="LONG">LONG</option><option value="SHORT">SHORT · ניתוח בלבד</option></select></label></div><p class="slope-status" role="status"></p><div class="slope-cards">'+[200,20].map(n=>'<article><div><b>MA'+n+'</b><small>'+(n===200?'כיוון רחב':'מומנטום קצר')+'</small><strong class="slope-rate"></strong><span class="slope-angle"></span></div>'+gauge+'</article>').join('')+'</div><p class="slope-reading"></p><p class="slope-explanation">הזווית מחושבת בסולם קבוע: 0.01% לדקה = 45°. שינוי זום אינו משנה אותה. הממוצעים כוללים 200 ו־20 נרות; החלון קובע את מרחק המדידה ביניהם. החישוב מבוסס על נרות 5 דקות סגורים, ללא תלות במשך הנר המוצג בגרף.</p><p class="slope-explanation">מדד לניתוח בלבד. יציאה אוטומטית לפי שיפוע טרם הופעלה; הגנות העסקה הקיימות ממשיכות לפעול.</p></div></details>';
  panel={bars:[],options:{},lookbackBars:10,side:'LONG'};panels.set(host,panel);
  host.querySelector('.slope-window').onchange=e=>{panel.lookbackBars=Number(e.target.value);paint(host,panel);};
  host.querySelector('.slope-side').onchange=e=>{panel.side=e.target.value;paint(host,panel);};
 }
 panel.bars=bars||[];panel.options={symbol,platform,source};
 if(platform==='colmex')panel.side='LONG';
 host.querySelector('.slope-side-label').hidden=platform==='colmex';
 paint(host,panel);
}
function paint(host,panel){
 const {symbol,platform,source}=panel.options,snapshot=analyzeSlope(panel.bars,{lookbackBars:panel.lookbackBars,...(platform==='colmex'?{isSessionGap:stockSessionGap}:{})});
 host.dataset.status=snapshot.status;
 const ready=snapshot.status==='READY',slow=snapshot.slow;
 host.querySelector('.slope-summary').textContent=ready?symbol+' · '+signed(slow.pctPerMinute)+'% לדקה · α '+signed(slow.angle,1)+'°':symbol+' · '+statusText[snapshot.status];
 host.querySelector('.slope-status').textContent=(source?source+' · ':'')+statusText[snapshot.status]+(snapshot.asOf?' · נר אחרון: '+new Date(snapshot.asOf).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'');
 for(const [i,value]of [snapshot.slow,snapshot.fast].entries()){
  const card=host.querySelectorAll('.slope-cards article')[i],valid=Number.isFinite(value?.pctPerMinute);
  card.dataset.direction=!valid?'unknown':value.pctPerMinute>1e-10?'up':value.pctPerMinute< -1e-10?'down':'flat';
  card.querySelector('.slope-rate').textContent=valid?signed(value.pctPerMinute)+'% לדקה':'ממתין לחישוב';
  card.querySelector('.slope-angle').textContent=valid?'α '+signed(value.angle,1)+'° · זווית מנורמלת':'—';
  card.querySelector('.slope-needle').setAttribute('transform','rotate('+(-(value?.angle||0))+',90,75)');
  card.querySelector('.slope-needle').style.visibility=valid?'visible':'hidden';
 }
 host.querySelector('.slope-reading').textContent=panel.side+' · '+readingText[slopeReading(snapshot,panel.side)]+(platform==='binance'&&panel.side==='SHORT'?' · בחירה זו אינה מפעילה מסחר בשורט':'');
}
if(typeof window!=='undefined'){
 globalThis.LEVI_MA_SLOPE={renderBinance(data){renderSlopePanel(document.getElementById('binanceSlope'),data?.bars||[],{symbol:data?.symbol||'',source:'Binance Spot'});}};
 globalThis.LEVI_MA_SLOPE.renderBinance(window.LEVI_MA_SLOPE_DATA);
 setInterval(()=>{for(const id of ['binanceSlope','colmexSlope']){const host=document.getElementById(id),panel=host&&panels.get(host);if(panel&&!document.hidden)paint(host,panel);}},30000);
}
