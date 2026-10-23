import {screenRsiRows} from './lib/rsi-screener.mjs';

export function createRsiScreener(host,{scope,onSelect}){
 if(!host)return {update(){}};
 const box=document.createElement('details');box.className='rsi-screener';
 const summary=document.createElement('summary');summary.textContent='סנן RSI (14) · נרות 5 דקות';box.append(summary);
 const note=document.createElement('p');note.textContent=scope+' · ערכי הבדיקה האחרונה, כולל מחיר חי כשזמין. RSI נמוך לבדו אינו אישור קנייה. אין שינוי בתנאי המסחר.';box.append(note);
 const controls=document.createElement('div');controls.className='rsi-screener-controls';box.append(controls);
 const preset=document.createElement('select');preset.setAttribute('aria-label','טווח RSI');
 for(const [value,label] of [['all','כל הערכים'],['low','0–30'],['high','70–100'],['custom','טווח מותאם']]){const o=document.createElement('option');o.value=value;o.textContent=label;preset.append(o);}controls.append(preset);
 function field(label,value){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type='number';input.min='0';input.max='100';input.step='0.1';input.value=String(value);wrap.append(input);controls.append(wrap);return input;}
 const min=field('מ־',0),max=field('עד',100),order=document.createElement('select');order.setAttribute('aria-label','מיון RSI');
 for(const [value,label] of [['asc','מהנמוך לגבוה'],['desc','מהגבוה לנמוך']]){const o=document.createElement('option');o.value=value;o.textContent=label;order.append(o);}controls.append(order);
 const status=document.createElement('p');status.setAttribute('role','status');box.append(status);
 const results=document.createElement('div');results.className='rsi-screener-results';box.append(results);host.append(box);let rows=[];
 function render(){
  results.replaceChildren();const lo=Number(min.value),hi=Number(max.value);
  if(min.value===''||max.value===''||lo<0||hi>100||lo>hi){status.textContent='בחר טווח תקין בין 0 ל־100';return;}
  const filtered=screenRsiRows(rows,{min:lo,max:hi,order:order.value});
  const available=screenRsiRows(rows).length;
  status.textContent=`מוצגים ${filtered.length} · עם RSI: ${available}/${rows.length} · ללא נתון אינם נכללים בסינון`;
  if(!filtered.length){const p=document.createElement('p');p.textContent=available?'אין תוצאות בטווח שנבחר':'ממתין לערכי RSI מסבבי הניתוח הבאים';results.append(p);}
  for(const row of filtered){
   const button=document.createElement('button');button.type='button';button.className='rsi-screener-row';
   const time=row.rsi.at?new Date(row.rsi.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'זמן לא זמין';
   button.textContent=`${row.symbol} · RSI ${row.rsi.value.toFixed(2)} · ${row.spring?'Spring זוהה':'ללא Spring מתועד'} · ${time}${row.old?' · נתון קודם':''}`;
   button.onclick=()=>onSelect(row.symbol);results.append(button);
  }
 }
 preset.onchange=()=>{if(preset.value==='low'){min.value='0';max.value='30';}else if(preset.value==='high'){min.value='70';max.value='100';}else if(preset.value==='all'){min.value='0';max.value='100';}render();};
 for(const input of [min,max])input.oninput=()=>{preset.value='custom';render();};order.onchange=render;
 render();return {update(next){rows=next;render();}};
}
