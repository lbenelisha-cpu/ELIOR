import {analyzeScheduledSlope} from './lib/ma-slope-schedule.mjs?v=20261026-ma100';
import {slopeDecision} from './lib/ma-slope-decision.mjs?v=20261026-ma100';
import {stockSessionGap} from './lib/colmex-market-hours.mjs';
import {renderPositionAlpha} from './position-alpha-panel.js?v=20261026-entry-alpha';
const panels=new WeakMap();
const signed=(n,d=4)=>Number.isFinite(n)?(n>0?'+':'')+n.toFixed(d):'—';
const statusText={NO_DATA:'ממתין לנרות 5 דקות',WARMUP:'אין מספיק נרות תקינים לחישוב MA200',WAIT_WINDOW:'MA200 זמין · ממתין לחלון שיפוע רציף לאחר הפסקת מסחר או חימום',STALE:'נתוני עבר · ממתין לנרות עדכניים',INVALID_DATA:'פער או שגיאה בנתוני הנרות',WAIT_UPDATE:'ממתין לנר הסגור של מועד הבדיקה',READY:'נרות סגורים · מדד לניתוח'};
const gauge='<svg viewBox="0 0 180 150" aria-hidden="true"><path d="M90 15 A60 60 0 0 1 90 135" fill="none" stroke="currentColor" opacity=".25" stroke-width="6"/><path d="M90 75 H155" stroke="currentColor" opacity=".25" stroke-dasharray="3 4"/><g class="slope-needle"><path d="M90 75 H145 M136 69 L145 75 L136 81" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></g><circle cx="90" cy="75" r="4" fill="currentColor"/><text x="65" y="16">90°</text><text x="158" y="79">0°</text><text x="59" y="141">−90°</text></svg>';
export function renderSlopePanel(host,bars,{symbol='',platform='binance',source='',position=null,price=null,priceAt=null}={}){
 if(!host)return;
 let panel=panels.get(host);
 if(!panel){
  host.classList.add('ma-slope-panel');
  host.innerHTML='<details><summary><span><b>מגמה רחבה · MA200 / MA100</b><small class="slope-summary">ממתין לנתונים</small><small class="slope-updated"></small></span><span class="slope-summary-end"><span class="slope-badge"></span><span class="slope-toggle" aria-hidden="true"></span></span></summary><div class="slope-content"><div class="slope-controls"><label>תדירות בדיקה <select class="slope-cadence"><option value="10" selected>כל 10 דקות</option><option value="20">כל 20 דקות</option></select></label><label>חלון השיפוע <select class="slope-window"><option value="5">5 נרות · 25 דקות</option><option value="10" selected>10 נרות · 50 דקות</option></select></label><label class="slope-side-label">כיוון לניתוח <select class="slope-side"><option value="LONG">LONG</option><option value="SHORT">SHORT · ניתוח בלבד</option></select></label></div><p class="slope-status"></p><section class="slope-decision" aria-label="עזר לקבלת החלטות"><div class="slope-decision-heading"><span class="slope-decision-icon" aria-hidden="true"></span><div><small class="slope-decision-side"></small><strong class="slope-decision-title" role="status"></strong></div></div><p class="slope-decision-detail"></p><div class="slope-decision-uses"><div><b>לקראת כניסה</b><p class="slope-entry-guide"></p></div><div><b>פוזיציה קיימת</b><p class="slope-exit-guide"></p></div></div></section><div class="slope-cards">'+[200,100].map(n=>'<article><div><b>MA'+n+'</b><small>'+(n===200?'כיוון רחב':'מגמה בינונית')+'</small><strong class="slope-rate"></strong><span class="slope-angle"></span></div>'+gauge+'</article>').join('')+'</div><p class="slope-explanation">הזווית מחושבת בסולם קבוע: 0.01% לדקה = 45°. שינוי זום אינו משנה אותה. MA100 כולל את 100 הנרות הסגורים האחרונים במועד הבדיקה; MA200 כולל 200 נרות. תדירות הבדיקה קובעת מתי החיווי מתעדכן. חלון השיפוע משווה את הממוצע לערכו לפני 25 או 50 דקות. אזהרת יציאה דורשת שתי בדיקות מתוזמנות רצופות נגד הכיוון הנבחר. החישוב מבוסס על נרות 5 דקות סגורים, ללא תלות במשך הנר המוצג בגרף.</p><p class="slope-explanation">כלי עזר לניתוח בלבד, ללא הוראת קנייה או מכירה. כללי המסחר והגנות העסקה הקיימים ממשיכים לפעול.</p></div></details>';
  const alpha=document.createElement('section');alpha.className='position-alpha';host.prepend(alpha);
  panel={bars:[],options:{},lookbackBars:10,checkMinutes:10,side:'LONG'};panels.set(host,panel);
  host.querySelector('.slope-cadence').onchange=e=>{panel.checkMinutes=Number(e.target.value);paint(host,panel);};
  host.querySelector('.slope-window').onchange=e=>{panel.lookbackBars=Number(e.target.value);paint(host,panel);};
  host.querySelector('.slope-side').onchange=e=>{panel.side=e.target.value;paint(host,panel);};
 }
 panel.bars=bars||[];panel.options={symbol,platform,source,position,price,priceAt};
 if(platform==='colmex')panel.side='LONG';
 host.querySelector('.slope-side-label').hidden=platform==='colmex';
 paint(host,panel);
}
function paint(host,panel){
 renderPositionAlpha(host.querySelector('.position-alpha'),panel.bars,panel.options);
 const {symbol,platform,source}=panel.options,snapshot=analyzeScheduledSlope(panel.bars,{lookbackBars:panel.lookbackBars,checkMinutes:panel.checkMinutes,...(platform==='colmex'?{isSessionGap:stockSessionGap}:{})});
 host.dataset.status=snapshot.status;
 const decision=slopeDecision(snapshot,panel.side),ready=decision.state!=='UNAVAILABLE',slow=snapshot.slow;
 host.dataset.decision=decision.state;host.dataset.tone=decision.tone;
 host.querySelector('.slope-badge').textContent=decision.title;
 host.querySelector('.slope-decision-icon').textContent=decision.icon;
 host.querySelector('.slope-decision-side').textContent='עזר להחלטה · '+panel.side+(platform==='binance'&&panel.side==='SHORT'?' · ניתוח בלבד':'');
 host.querySelector('.slope-decision-title').textContent=decision.title;
 host.querySelector('.slope-decision-detail').textContent=decision.detail;
 host.querySelector('.slope-entry-guide').textContent=decision.entry;
 host.querySelector('.slope-exit-guide').textContent=decision.exit;
 host.querySelector('.slope-summary').textContent=ready?symbol+' · '+panel.side+' · '+signed(slow.pctPerMinute)+'% לדקה · α '+signed(slow.angle,1)+'°':symbol+' · '+statusText[snapshot.status];
 host.querySelector('.slope-status').textContent=(source?source+' · ':'')+statusText[snapshot.status]+' · בדיקה כל '+panel.checkMinutes+' דקות'+(snapshot.nextCheckAt?' · הבדיקה הבאה: '+new Date(snapshot.nextCheckAt).toLocaleTimeString('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'}):'');
 host.querySelector('.slope-updated').textContent=snapshot.asOf?'נר המדידה: '+new Date(snapshot.asOf).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})+' · כל '+panel.checkMinutes+' דקות':'זמן נתון: ממתין לנרות';
 for(const [i,value]of [snapshot.slow,snapshot.fast].entries()){
  const card=host.querySelectorAll('.slope-cards article')[i],valid=ready&&Number.isFinite(value?.pctPerMinute);
  card.dataset.direction=!valid?'unknown':value.pctPerMinute>1e-10?'up':value.pctPerMinute< -1e-10?'down':'flat';
  card.querySelector('.slope-rate').textContent=valid?signed(value.pctPerMinute)+'% לדקה':'ממתין לחישוב';
  card.querySelector('.slope-angle').textContent=valid?'α '+signed(value.angle,1)+'° · זווית מנורמלת':'—';
  card.querySelector('.slope-needle').setAttribute('transform','rotate('+(-(value?.angle||0))+',90,75)');
  card.querySelector('.slope-needle').style.visibility=valid?'visible':'hidden';
 }
}
if(typeof window!=='undefined'){
 globalThis.LEVI_MA_SLOPE={renderBinance(data){renderSlopePanel(document.getElementById('binanceSlope'),data?.bars||[],{symbol:data?.symbol||'',source:'Binance Spot',position:data?.position,price:data?.price,priceAt:data?.priceAt});}};
 window.addEventListener('levi:binance-dashboard',event=>{if(event.detail?.unauthorized){window.LEVI_MA_SLOPE_DATA=null;globalThis.LEVI_MA_SLOPE.renderBinance(null);}});
 globalThis.LEVI_MA_SLOPE.renderBinance(window.LEVI_MA_SLOPE_DATA);
 setInterval(()=>{for(const id of ['binanceSlope','colmexSlope']){const host=document.getElementById(id),panel=host&&panels.get(host);if(panel&&!document.hidden)paint(host,panel);}},30000);
}
