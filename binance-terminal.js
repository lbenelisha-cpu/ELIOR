import {terminalView} from './lib/binance-terminal-view.mjs?v=20261103-terminal';
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
const num=(n,d=2)=>n==null||!Number.isFinite(n)?'—':n.toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d===2?2:0});
const signed=n=>n==null?'—':(n>0?'+':'')+num(n);
const tone=n=>n==null?'unknown':n>0?'positive':n<0?'negative':'neutral';
const when=at=>new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at);
const reasons={CHANNEL_TAKE_PROFIT:'יעד התעלה',CHANNEL_STOP_LOSS:'סטופ הפסד',STOP_LOSS:'סטופ הפסד',TRAILING_STOP:'הגנה נגררת',TRAILING_PROFIT_EXIT:'הגנת רווח',BROKER_STOP_LOSS:'סטופ בבורסה',BROKER_OR_EXTERNAL_CLOSE:'סגירה בבורסה',MANUAL_SELL:'מכירה ידנית',MANUAL_STOP_ALL:'עצירה ידנית',FUTURES_PROTECTION_FAILED:'כשל בהגנה'};
export function createTerminalDashboard(doc=document,{now=Date.now}={}) {
  const get=id=>doc.getElementById(id);
  let snapshot=null,report=null;
  const text=(id,value)=>{const e=get(id);if(e)e.textContent=value;};
  function empty(host,message,columns){const row=make('tr'),cell=make('td',message,'terminal-empty');cell.colSpan=columns;row.append(cell);host.append(row);}
  function cell(row,value,cls){const td=make('td',value,cls);row.append(td);return td;}
  function render(){
    const v=terminalView(snapshot,report,now()),positions=get('terminalHoldingsBody'),closed=get('terminalClosedBody');
    text('terminalDate',new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'numeric',month:'long',year:'numeric'}).format(now()));
    text('terminalRealized',signed(v.todayNet));
    if(get('terminalRealized'))get('terminalRealized').dataset.sign=tone(v.todayNet);
    text('terminalRealizedNote',!v.reportReady?'ממתין לדוח מסחר מאומת':v.partial?'סכום חלקי · '+v.knownCount+' יציאות חושבו':v.todayCount?'לאחר עמלות ומימון · USDT':'אין יציאות מתועדות היום');
    text('terminalClosedCount',v.todayCount==null?'—':String(v.todayCount));
    text('terminalClosedNote',v.reportReady?'LONG + SHORT · '+(v.partial?'הדוח חלקי':'לפי היומן השמור'):'LONG + SHORT · ממתין לאימות');
    text('terminalHoldingsCount',v.summary?String(v.positions.length):'—');
    text('terminalHoldingsNote',!v.summary?'נתוני ההחזקות יופיעו לאחר חיבור ועדכון החשבון.':snapshot.mode==='demo'?'סימולציה · '+v.summary.currency+' · אינה חשבון LIVE':v.summary.partial?'שווי חלקי · חסרים מחירים; משקל בתיק אינו מחושב.':'Spot · החזקות בשווי 5 USDT ומעלה · רווח פתוח לפני עמלת מכירה.');
    if(positions){positions.replaceChildren();
      if(!v.summary)empty(positions,'ממתין לנתוני חשבון עדכניים',6);
      else if(!v.positions.length)empty(positions,'אין החזקות פעילות בתצוגה זו',6);
      else for(const p of v.positions){const row=make('tr');
        const asset=cell(row,null,'terminal-asset');asset.append(make('b',p.symbol),make('small','LONG · '+(snapshot.mode==='live'?'SPOT':'DEMO')));
        cell(row,num(p.qty,8),'terminal-number');cell(row,num(p.price,8),'terminal-number');cell(row,num(p.value),'terminal-number');
        cell(row,signed(p.pnl),'terminal-number '+tone(p.pnl));cell(row,p.weight==null?'—':num(p.weight,1)+'%','terminal-number');positions.append(row);
      }
    }
    if(closed){closed.replaceChildren();
      if(!v.reportReady)empty(closed,snapshot?.mode==='demo'?'דוח היציאות זמין לחשבון LIVE':'ממתין לדוח יציאות מאומת',4);
      else if(!v.closed.length)empty(closed,'אין יציאות ביומן השמור',4);
      else for(const p of v.closed){const row=make('tr');
        const asset=cell(row,null,'terminal-asset');asset.append(make('b',p.symbol),make('small',p.direction+' · '+(p.status==='PARTIAL'?'יציאה חלקית':'סגירה')));
        cell(row,when(p.closedAt),'terminal-number');cell(row,signed(Number.isFinite(p.netPnlUsdt)?p.netPnlUsdt:null),'terminal-number '+tone(Number.isFinite(p.netPnlUsdt)?p.netPnlUsdt:null));
        const reason=cell(row,reasons[p.reason]||p.reason||'לא תועדה');if(p.issue)reason.append(make('small','חסרים נתונים לחישוב'));closed.append(row);
      }
    }
    text('terminalReportNote',!v.reportReady?'התוצאות יוצגו לאחר טעינת דוח המסחר.':(v.partial?'נתונים חלקיים · ':'')+'עודכן '+when(v.reportAt)+' · יציאות מלאות וחלקיות · USDT לאחר עמלות ומימון.');
  }
  return {render,setSnapshot(next){snapshot=next;if(next?.mode!=='live'||next?.unauthorized||next?.error)report=null;render();},setReport(next){report=next;render();},clear(){snapshot=null;report=null;render();}};
}
const host=document.getElementById('terminalHoldingsBody');
if(host){
  const terminal=createTerminalDashboard();
  terminal.setSnapshot(window.LEVI_DASHBOARD_SNAPSHOT||null);
  window.addEventListener('levi:binance-dashboard',e=>terminal.setSnapshot(e.detail));
  window.addEventListener('levi:binance-pnl-data',e=>terminal.setReport(e.detail));
  window.addEventListener('trade-device-expired',()=>terminal.clear());
  document.addEventListener('visibilitychange',()=>terminal.render());
  setInterval(()=>{if(!document.hidden)terminal.render();},10000);
  document.querySelectorAll('[data-terminal-view]').forEach(button=>button.addEventListener('click',()=>{
    const tab=document.querySelector('.topnav [data-view="'+button.dataset.terminalView+'"]');
    tab?.click();document.getElementById(button.dataset.terminalView==='pnl'?'binanceTradingPnl':'portfolioViewPanel')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  }));
}
