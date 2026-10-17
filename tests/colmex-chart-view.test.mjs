import test from 'node:test';import assert from 'node:assert/strict';
import {lastTwoTradingDays,startCandleFlashing} from '../lib/colmex-chart-view.mjs';
test('chart keeps exactly the last two trading dates across weekends without altering source data',()=>{
 const bars=['2026-10-14T19:55:00Z','2026-10-15T13:30:00Z','2026-10-15T19:55:00Z','2026-10-16T13:30:00Z','2026-10-16T19:55:00Z'].map(date=>({date}));const result=lastTwoTradingDays(bars);assert.deepEqual(result,bars.slice(1));assert.equal(bars.length,5);assert.deepEqual(lastTwoTradingDays([{date:'2026-10-14'},{date:'2026-10-15'},{date:'2026-10-16'}],'1day'),[{date:'2026-10-15'},{date:'2026-10-16'}]);assert.deepEqual(lastTwoTradingDays(bars,'1week'),[]);
});
test('explicit blink control changes actual candle phases and can stop or resume, independently of CSS motion preferences',()=>{
 const classes=new Set(),events={};let tick;const root={classList:{remove:x=>classes.delete(x),toggle:x=>classes.has(x)?classes.delete(x):classes.add(x)},querySelector:()=>({})},control={checked:true,addEventListener:(k,f)=>{events[k]=f;}},doc={hidden:false,addEventListener:(k,f)=>{events[k]=f;}};
 startCandleFlashing({root,control,doc,schedule:(f,ms)=>{assert.equal(ms,650);tick=f;}});tick();assert.equal(classes.has('candle-phase-off'),true);tick();assert.equal(classes.has('candle-phase-off'),false);tick();control.checked=false;events.change();assert.equal(classes.size,0);tick();assert.equal(classes.size,0);control.checked=true;tick();assert.equal(classes.size,1);doc.hidden=true;tick();assert.equal(classes.size,0);
});
