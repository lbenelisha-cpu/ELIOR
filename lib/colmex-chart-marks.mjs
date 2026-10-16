export const COLMEX_MARK_TYPES=[
 ['initialPeak','שיא ראשוני','#b99bff'],['firstLow','שפל ראשון','#ffbc70'],['rallyHigh','שיא התאוששות','#f18cce'],['secondaryTest','בדיקה חוזרת','#8dd8d0'],['springLow','Spring','#f4dd7c'],['confirmation','אישור וואיקוף','#67e0ae']
];
const valid=p=>p&&Number.isFinite(p.at)&&Number.isFinite(p.price)&&p.price>0;
export function buildColmexMarks(state,symbol){
 const points=[],lines=[],cards=[];if(!state)return {points,lines,cards};
 const p=state.positions?.[symbol],asset=state.assets?.[symbol],journal=(state.journal||[]).filter(j=>j.symbol===symbol),last=journal.at(-1),lastSale=[...journal].reverse().find(j=>j.side==='SELL'),seen=new Set();
 const add=point=>{if(!valid(point))return;const id=point.kind+':'+point.at+':'+point.price;if(seen.has(id)){if(point.pulse)points.find(p=>p.id===id).pulse=true;return;}seen.add(id);points.push({...point,id});};
 const setupPoints=setup=>COLMEX_MARK_TYPES.flatMap(([kind,name,color])=>{const item=setup?.[kind];return item?[{kind,name,color,at:Number(item.time),price:Number(item.price),anchor:kind==='confirmation'&&item.live?'event':'close'}]:[];});
 for(const j of journal){add({kind:j.side==='BUY'?'buy':'sell',name:j.side==='BUY'?'קנייה מדומה':'מכירה מדומה',color:j.side==='BUY'?'#4a9dff':'#ff5f78',at:Date.parse(j.at),price:j.price,anchor:'event'});for(const point of setupPoints(j.setup))add(point);if(j.side==='SELL'&&j.peakAt)add({kind:'peak',name:'שיא שנצפה לפני המכירה',color:'#4a9dff',at:Date.parse(j.peakAt),price:j.peakPrice,anchor:'event'});}
 const setup=p?.setup||asset?.setup||last?.setup;
 for(const point of setupPoints(setup)){add({...point,pulse:!!p});cards.push({...point});}
 if(p){const buy={kind:'buy',name:'מחיר קנייה מדומה',color:'#4a9dff',price:p.entryPrice,at:Date.parse(p.entryAt)},peak={kind:'peak',name:'שיא שנצפה מאז הקנייה',color:'#4a9dff',price:p.peakPrice,at:Date.parse(p.peakAt),pulse:true};add({...buy,anchor:'event'});add({...peak,anchor:'event'});cards.unshift(buy,peak);lines.push({...buy},{...peak},{kind:'stop',name:'סף מכירה פעיל',color:'#ff5f78',price:p.effectiveStopPrice||p.entryPrice*.9});cards.push(lines.at(-1));}
 else if(lastSale){const entry={kind:'buy',name:'מחיר קנייה · עסקה סגורה',color:'#4a9dff',price:lastSale.entryPrice,at:Date.parse(lastSale.entryAt)},peak={kind:'peak',name:'שיא שנצפה · עסקה סגורה',color:'#4a9dff',price:lastSale.peakPrice,at:Date.parse(lastSale.peakAt)},sell={kind:'sell',name:'מחיר מכירה מדומה',color:'#ff5f78',price:lastSale.price,at:Date.parse(lastSale.at)};add({...entry,anchor:'event'});cards.unshift(entry,peak,sell);lines.push(entry,peak,sell);}
 return {points:points.filter(valid),lines:lines.filter(x=>Number.isFinite(x.price)&&x.price>0),cards:cards.filter(x=>Number.isFinite(x.price)&&x.price>0)};
}
// Setup timestamps identify candle closes; fills identify actual observation times.
// A close at 10:05 belongs to the 10:00 candle, while a fill at 10:05 belongs to 10:05.
export function markBarIndex(point,bars,interval='5min',now=Date.now()){
 if(!bars.length||!Number.isFinite(point.at))return -1;
 const starts=bars.map(b=>Date.parse(b.date)),isDaily=['1day','1week','1month'].includes(interval);
 const target=point.at-(point.anchor==='close'?1:0);
 if(target<starts[0])return -1;
 const index=starts.findLastIndex(t=>t<=target);if(index<0)return -1;
 if(index===starts.length-1){
  let end=starts[index]+({'5min':300000,'1h':3600000,'1day':86400000,'1week':7*86400000}[interval]||0);
  if(interval==='1month'){const d=new Date(starts[index]);d.setUTCMonth(d.getUTCMonth()+1);end=+d;}
  if(target>=end)return -1;
 }else if(!isDaily&&target>=starts[index]+(interval==='1h'?3600000:300000))return -1;
 return index;
}
