import test from 'node:test';
import assert from 'node:assert/strict';
import {colmexChartChannels,channelSegments,drawColmexChannels} from '../lib/colmex-channel-view.mjs';
import {colmexStrategyView} from '../lib/colmex-strategy-view.mjs';
import {renderSearchStatus} from '../colmex-search-status.js';
import {regularSession} from '../lib/colmex-market-hours.mjs';
const STEP=300000,end=Date.parse('2026-11-02T16:00:00Z');
function bars(){const times=[];for(let at=end-5*86400000;at<end;at+=STEP)if(regularSession(at))times.push(at);return times.slice(-70).map((at,i)=>{const p=100+i*.03+Math.cos(i*Math.PI/5);return {date:new Date(at).toISOString(),open:p,close:p,high:p+.1,low:p-.1,volume:1000};});}
test('stock chart matches shared 50-bar channel geometry across verified overnight gaps, without future candles',()=>{
 const input=bars(),r=colmexChartChannels(input,{now:end});assert.equal(r.regression.ready,true);assert.equal(r.regression.n,50);assert.equal(r.swing.ready,true);
 const mapped=input.map((b,i)=>({...b,openTime:(i+1)*STEP,closeTime:(i+2)*STEP})),options={period:50,interval:'5m',now:72*STEP};
 assert.deepEqual(r.regression,globalThis.LEVI_REGRESSION.analyze(mapped,options));assert.deepEqual(r.swing,globalThis.LEVI_PARALLEL.analyze(mapped,options));
 const future={...input.at(-1),date:new Date(end).toISOString(),open:999,close:999,high:1000,low:998};
 assert.deepEqual(colmexChartChannels([...input,future],{now:end}).regression,r.regression);
 assert.equal(colmexChartChannels(input,{interval:'1h',now:end}).regression.ready,false);
 assert.equal(colmexChartChannels(input.filter((_,i)=>i!==60),{now:end}).regression.ready,false);
 assert.equal(colmexChartChannels(input.map((b,i)=>i===60?{...b,low:200}:b),{now:end}).regression.ready,false);
});
const element=tag=>({tag,attributes:{},children:[],textContent:'',setAttribute(k,v){this.attributes[k]=v;},append(...n){this.children.push(...n);},replaceChildren(){this.children=[];}});
test('SVG channels stay within the measured visible bars and include counted upper/lower touches',()=>{
 const input=bars(),r=colmexChartChannels(input,{now:end}),segments=channelSegments(r,input.slice(-20)),prior=globalThis.document;globalThis.document={createElementNS:(_,tag)=>element(tag)};
 try{
  for(const width of [205,700]){
   const svg=element('svg'),bounds={left:20,right:20+width,top:30,bottom:300};
   const labels=drawColmexChannels({svg,segments,x:i=>20+i*width/20,y:p=>400-p,bounds});
   const group=svg.children[1];assert.match(group.attributes['clip-path'],/^url/);assert.equal(group.tag,'g');assert.equal(group.children.filter(n=>n.tag==='line').length,6);
   assert.ok(group.children.some(n=>n.tag==='line'&&n.attributes.stroke==='#b7a3ff'));
   const badge=labels.children.find(n=>n.attributes['data-channel-label']==='swing');assert.match(badge.attributes['aria-label'],/למעלה: \d+ · למטה: \d+ נגיעות/);
   for(const label of labels.children){const rect=label.children[0];assert.ok(rect.attributes.x>=bounds.left);assert.ok(rect.attributes.x+rect.attributes.width<=bounds.right);assert.ok(rect.attributes.y>=bounds.top);assert.ok(rect.attributes.y+rect.attributes.height<=bounds.bottom);}
  }
  assert.ok(segments.every(s=>s.last.i<20&&s.first.i>=0));assert.deepEqual(channelSegments(r,input.slice(0,2)),[]);
  const labels=drawColmexChannels({svg:element('svg'),segments:[],x:i=>i,y:p=>p,bounds:{left:20,right:225,top:30,bottom:300}});assert.equal(labels.children.length,0);
 }finally{globalThis.document=prior;}

});
test('strategy description follows server activation and cannot present a disabled or unknown route as active',()=>{
 assert.match(colmexStrategyView(null).title,/אינו זמין/);
 const status={enabled:true,channelPrimary:{requested:false,enabled:false}};assert.match(colmexStrategyView(status).title,/התעלות כבוי/);
 status.channelPrimary={requested:true,enabled:false,enabledAfter:null};assert.match(colmexStrategyView(status).title,/חסומות/);
 status.channelPrimary={requested:true,enabled:true,enabledAfter:end};const active=colmexStrategyView(status);assert.match(active.title,/מופעל/);assert.match(active.entry,/50 נרות/);assert.match(active.entry,/1.5/);assert.match(active.exit,/רוחב התעלה/);
 status.enabled=false;assert.match(colmexStrategyView(status).title,/המסחר כבוי/);
});
test('channel search never presents a stale Wyckoff reset as the active entry condition',()=>{
 const prior=globalThis.document;globalThis.document={createElement:element};
 try{const host=element('section'),options={symbol:'TEST',channelPrimary:{requested:true,enabled:true},check:{at:end,reason:'WAIT_CHANNEL_BREAKOUT',entryDecisions:{primary:'channel_breakout'}}};
 renderSearchStatus(host,{phase:'SEARCH_PEAK',lastReset:{reason:'NEWER_PEAK',at:end}},options);let text=host.children.map(n=>n.textContent).join(' ');assert.match(text,/סגירת נר מעל הגבול העליון/);assert.doesNotMatch(text,/שיא ראשוני|למה הסימונים/);
 renderSearchStatus(host,null,{...options,check:{at:end,reason:'SEARCH_PEAK'}});text=host.children.map(n=>n.textContent).join(' ');assert.match(text,/ממתין לבדיקה מתועדת במסלול התעלות/);
 }finally{globalThis.document=prior;}
});

test('Colmex intrabar policy describes current broker price and keeps confirmed channel pivots',()=>{
 const view=colmexStrategyView({enabled:true,channelPrimary:{enabled:true,requested:true,enabledAfter:end,waitForBreakoutClose:false}});
 assert.match(view.entry,/ללא המתנה לסגירה/);assert.match(view.entry,/50 נרות סגורים/);assert.match(view.entry,/המחזור המצטבר בנר הפתוח/);assert.match(view.entry,/SHORT: מחיר Ask מתחת/);assert.match(view.entry,/LONG: מחיר Bid מעל/);assert.doesNotMatch(view.entry,/נדרשת סגירה מעל/);
});
