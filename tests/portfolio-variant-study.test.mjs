import test from 'node:test';import assert from 'node:assert/strict';
import {runPortfolio,exitDecision,makeFeatures,STEP} from '../lib/portfolio-variant-study.mjs';
const start=Date.UTC(2026,0,1),variant={id:'current',exit:'current',trend:false};
function data({symbols=['AAAUSDT'],steps=30,signal=0,price=100}={}){
 return Object.fromEntries(symbols.map(symbol=>[symbol,{bars:Array.from({length:steps+1},(_,i)=>({openTime:start+(i-1)*STEP,closeTime:start+i*STEP-1,open:price,high:price+1,low:price-1,close:price,atr:1,trend:true,previousLow:99})),candidates:[{at:start+(signal+1)*STEP-1,signalAt:start+(signal+1)*STEP-1,identity:'new',firstLow:90,target:150,trend:true}]}]));
}
test('shared cash enforces five positions, no borrowing, fees and end liquidation marks',()=>{
 const d=data({symbols:['AUSDT','BUSDT','CUSDT','DUSDT','EUSDT','FUSDT']});const r=runPortfolio(d,variant,{start,end:start+20*STEP,initialUsdt:100});
 assert.equal(r.buyCount,5);assert.equal(r.skipSlots,1);assert.equal(r.openAtEnd,5);assert.equal(r.sellCount,0);assert(r.finalUsdt<100);assert(r.finalUsdt>99);assert(r.fees>0);assert(r.trades.every(t=>t.entryAt===start+STEP));
});
test('future prices cannot change earlier fills and exits',()=>{
 const a=data(),b=structuredClone(a);for(const d of [a,b]){d.AAAUSDT.bars[4].close=80;d.AAAUSDT.bars[5].open=79;}
 for(let i=7;i<b.AAAUSDT.bars.length;i++)b.AAAUSDT.bars[i].close=10000;
 const options={start,end:start+20*STEP,initialUsdt:100};const x=runPortfolio(a,variant,options),y=runPortfolio(b,variant,options);
 assert.deepEqual(x.trades,y.trades);assert.equal(x.trades[0].exitAt,start+4*STEP);assert.equal(x.trades[0].reason,'STOP_10');
});
test('trend filter uses candidate-time completed hourly trend, not next-bar information',()=>{
 const d=data();d.AAAUSDT.candidates[0].trend=false;d.AAAUSDT.bars[2].trend=true;
 const r=runPortfolio(d,{...variant,trend:true},{start,end:start+20*STEP});assert.equal(r.buyCount,0);assert.equal(r.skipTrend,1);
});
test('seven-day hold never suppresses initial loss stop and activates profit floor only after seven days',()=>{
 const p={entry:100,at:start,peak:120};assert.equal(exitDecision(p,{close:110,closeTime:start+86400000},variant),null);assert.equal(exitDecision(p,{close:89,closeTime:start+86400000},variant),'STOP_10');assert.equal(exitDecision(p,{close:110,closeTime:start+7*86400000},variant),'RETAIN_80_AFTER_7D');
});
test('ATR stop ratchets upward and structural exits need two completed breakdowns after one risk of gain',()=>{
 const p={entry:100,at:start,peak:100,initialRisk:5,stop:95,structureBreaks:0};const v={exit:'structure'};
 assert.equal(exitDecision(p,{close:110,atr:4,previousLow:100},v),null);const stop=p.stop;
 assert.equal(exitDecision(p,{close:109,atr:4,previousLow:109.5},v),null);assert.equal(exitDecision(p,{close:108,atr:4,previousLow:108.5},v),'STRUCTURE_BREAK');assert(p.stop>=stop);
});
test('higher execution costs reduce constant-price portfolio results',()=>{
 const d=data(),o={start,end:start+20*STEP};assert(runPortfolio(d,variant,{...o,feeRate:.002,slippage:.002}).net<runPortfolio(d,variant,o).net);
});
test('hourly trend cannot be updated by an unfinished hour and gaps are rejected',()=>{
 const rows=Array.from({length:620},(_,i)=>[start+i*STEP,100+i*.01,101+i*.01,99+i*.01,100+i*.01,1,start+(i+1)*STEP-1]);
 const a=makeFeatures(rows),changed=structuredClone(rows);changed[610][4]=90;changed[610][3]=89;const b=makeFeatures(changed);assert.equal(a[610].trend,b[610].trend);assert.equal(a[610].trend,true);rows[9][0]+=1;assert.throws(()=>makeFeatures(rows),/GAP/);
});
test('without any observed gain the current policy does not invent a breakeven floor after a week',()=>{
 const p={entry:100,at:start,peak:100};assert.equal(exitDecision(p,{close:95,closeTime:start+8*86400000},variant),null);
});
test('sale cash funds a smaller replacement, but a signal from before the sale cannot reenter',()=>{
 const d=data();d.AAAUSDT.bars[4].close=80;d.AAAUSDT.bars[5].open=79;
 d.AAAUSDT.candidates.push({at:start+6*STEP-1,signalAt:start+6*STEP-1,identity:'second',firstLow:90,target:150,trend:true});
 const o={start,end:start+20*STEP,initialUsdt:100,maxPositions:1};const r=runPortfolio(d,variant,o);assert.equal(r.buyCount,2);assert(r.trades[1].cost<r.trades[0].cost);assert.equal(r.trades[1].entryAt,start+6*STEP);
 d.AAAUSDT.candidates[1].signalAt=start;assert.equal(runPortfolio(d,variant,o).buyCount,1);
});
