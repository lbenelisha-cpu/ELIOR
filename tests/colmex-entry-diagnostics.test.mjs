import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {evaluateWyckoff} from '../lib/wyckoff-strategy.mjs';
import {entrySignal} from '../lib/colmex-auto-policy.mjs';
import {chartAnalysisMarks} from '../lib/colmex-chart-view.mjs';
import {makeAuditRecord,collectAudit} from '../lib/ma-decision-audit.mjs';
import {renderSearchStatus,searchResetText} from '../colmex-search-status.js';
import {colmexQuantityRules} from '../lib/colmex-quantity-rules.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/msft-search-reset-20261026.json',import.meta.url))),bars=fixture.map(({date,...b})=>({...b,openTime:Date.parse(date),closeTime:Date.parse(date)+300000,timeframe:'5m'})),now=Date.parse('2026-10-26T19:25:01Z');
test('actual MSFT candles reproduce the disappearing peak/low and explain the 531.34 to 531.29 break',()=>{
 const before=chartAnalysisMarks(fixture.slice(0,-1),now),after=chartAnalysisMarks(fixture,now);
 assert.ok(before.cards.some(p=>p.kind==='firstLow'&&p.price===531.34));assert.equal(after.points.length,0);
 const d=after.searchDiagnostic;assert.equal(d.phase,'SEARCH_PEAK');assert.equal(d.lastReset.reason,'LOW_BROKEN_BEFORE_TEST');assert.equal(d.lastReset.at,Date.parse('2026-10-26T19:25:00Z'));assert.equal(d.lastReset.firstLow.price,531.34);assert.equal(d.lastReset.barLow,531.29);
 const signal=entrySignal(bars,now,0,[],{price:531.81,priceAsOf:now});assert.equal(signal.ready,false);assert.deepEqual(signal.searchDiagnostic,d);
 assert.match(searchResetText(d.lastReset),/531.34/);assert.match(searchResetText(d.lastReset),/531.29/);
});
test('diagnostic collection changes neither the historical search nor a trading decision at any candle prefix',()=>{
 for(let i=3;i<=bars.length;i++){const sample=bars.slice(0,i),options={now:sample.at(-1).closeTime,timeframe:'5m',rollingSearch:true};const normal=evaluateWyckoff(sample,options),{searchReset,searchCandidate,...traced}=evaluateWyckoff(sample,{...options,diagnostics:true});assert.deepEqual(traced,normal);}
});
test('journal preserves original reset facts and records a new reset even inside the same sampling bucket',()=>{
 const searchDiagnostic=chartAnalysisMarks(fixture,now).searchDiagnostic,make=diagnostic=>makeAuditRecord({platform:'COLMEX',symbol:'MSFT',at:now,action:'WAIT',reason:'SEARCH_PEAK',price:531.81,priceAt:now,searchDiagnostic:diagnostic});
 const row=make(searchDiagnostic),state={};assert.equal(collectAudit(state,row),true);assert.equal(collectAudit(state,make(searchDiagnostic)),false);
 searchDiagnostic.lastReset.reason='NEWER_PEAK';assert.equal(row.searchDiagnostic.lastReset.reason,'LOW_BROKEN_BEFORE_TEST');assert.equal(collectAudit(state,make(searchDiagnostic)),true);
});
test('quantity metadata distinguishes an explicit unconfigured maximum from an unknown required rule',()=>{
 const d={lotSize:1,minLot:1,lotStep:1,maxLot:null,maxLotInCash:null};assert.deepEqual(colmexQuantityRules(d),{valid:true,minQty:1,qtyStep:1,maxQty:null,maxCash:null,maximumStatus:'UNCONFIGURED'});
 assert.equal(colmexQuantityRules({...d,maxLot:undefined}).valid,false);assert.equal(colmexQuantityRules({...d,lotStep:null}).valid,false);
});
test('chart status explains resets and server blockers, clears stale symbol details, and distinguishes held/manual views',()=>{
 const element=tag=>({tag,children:[],textContent:'',append(...n){this.children.push(...n);},replaceChildren(){this.children=[];}}),prior=globalThis.document;globalThis.document={createElement:element};
 try{const host=element('section'),d=chartAnalysisMarks(fixture,now).searchDiagnostic,text=()=>host.children.map(n=>n.textContent).join(' ');
 renderSearchStatus(host,d,{symbol:'MSFT',check:{at:now,reason:'UNKNOWN_QUANTITY_RULES'}});assert.match(text(),/531.29/);assert.match(text(),/מגבלות כמות/);assert.match(text(),/בדיקת שרת אחרונה/);
 renderSearchStatus(host,null,{symbol:'AAPL',position:true});assert.doesNotMatch(text(),/531.29|MSFT|מגבלות כמות/);assert.match(text(),/פוזיציה פתוחה/);
 renderSearchStatus(host,d,{symbol:'MSFT',manual:true});assert.doesNotMatch(text(),/למה הסימונים/);
 }finally{globalThis.document=prior;}
});
