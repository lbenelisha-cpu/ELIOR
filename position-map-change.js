// Presentation only: price change from entry, before fees, for LONG holdings.
// The caller supplies only a currently usable quote; missing values stay unknown.
export function positionChangeBadge(create,entry,current){
 const valid=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>0;
 const raw=valid(entry)&&valid(current)?(Number(current)/Number(entry)-1)*100:null;
 const pct=Number.isFinite(raw)?raw:null,kind=pct===null?'unknown':pct>0?'gain':pct<0?'loss':'flat';
 const label={gain:'רווח במחיר',loss:'הפסד במחיר',flat:'ללא שינוי',unknown:'שינוי בפוזיציה'}[kind];
 const amount=pct===null?'—':pct===0?'0.00%':Math.abs(pct)<.000001?(pct>0?'+':'−')+'<0.000001%':(pct>0?'+':'−')+Math.abs(pct).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:Math.abs(pct)<.01?6:2})+'%';
 const badge=create('div',null,'position-change');badge.dataset.direction=kind;
 const arrow=create('span',{gain:'↑',loss:'↓',flat:'↔',unknown:'—'}[kind],'position-change-arrow');arrow.setAttribute('aria-hidden','true');
 const copy=create('div',null,'position-change-copy'),value=create('strong',amount,'position-change-value');value.setAttribute('dir','ltr');
 copy.append(create('span',label,'position-change-label'),value,create('small',pct===null?'ממתין למחיר כניסה ולמחיר עדכני':'שינוי ממחיר הכניסה · לפני עמלות','position-change-note'));
 badge.append(arrow,copy);return badge;
}
