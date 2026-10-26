import test from 'node:test';import assert from 'node:assert/strict';
import {scanCoverage,stockScanStatus} from '../lib/colmex-scan-coverage.mjs';
import {COLMEX_WATCH_SYMBOLS} from '../lib/colmex-watch-universe.mjs';
import {syncWatchRows} from '../lib/colmex-watch-view.mjs';
const now=Date.parse('2026-10-26T18:00:00Z');
const status=()=>({enabled:true,lastCompletedAt:now,policy:{symbols:[...COLMEX_WATCH_SYMBOLS],scanBatchSize:5,pollSeconds:60},checks:Object.fromEntries(COLMEX_WATCH_SYMBOLS.map(s=>[s,{at:now-600000,reason:'SEARCH_PEAK'}]))});
test('50 recorded checks describe staggered coverage without enrolling a display-only stock',()=>{
 const data=status(),before=structuredClone(data),coverage=scanCoverage(data,now);
 assert.equal(coverage.count,50);assert.equal(coverage.roundMs,600000);assert.equal(coverage.health,'running');assert.match(coverage.summary,/50\/50/);assert.match(coverage.summary,/10 דקות/);
 const row=stockScanStatus('MSFT',data,now);assert.equal(row.scanState,'checked');assert.match(row.scanText,/מחפש שיא ראשוני/);assert.match(row.scanText,/26.10.2026/);
 assert.equal(stockScanStatus('XYZ',data,now).scanState,'display');assert.deepEqual(data,before);
});
test('never checked and overdue checks are distinct from disabled, failed or unknown service status',()=>{
 const data=status();delete data.checks.MSFT;assert.equal(stockScanStatus('MSFT',data,now).scanState,'waiting');assert.equal(scanCoverage(data,now).count,49);
 data.checks.MSFT={at:now-1800001,reason:'RATE_LIMIT'};const row=stockScanStatus('MSFT',data,now);assert.equal(row.scanState,'old');assert.match(row.scanText,/מכסת הברוקר/);
 data.enabled=false;assert.equal(stockScanStatus('MSFT',data,now).scanState,'disabled');data.enabled=true;data.lastError='NETWORK';assert.equal(stockScanStatus('MSFT',data,now).scanState,'error');
 data.lastError=null;data.lastCompletedAt=now-300001;assert.equal(stockScanStatus('MSFT',data,now).scanState,'delayed');
 assert.equal(stockScanStatus('MSFT',{...data,unavailable:true},now).scanState,'unavailable');assert.equal(stockScanStatus('MSFT',null,now).scanState,'unavailable');
 data.lastCompletedAt=now;data.checks.MSFT={at:now+1,reason:'READY'};assert.equal(stockScanStatus('MSFT',data,now).scanState,'waiting');
});
test('closed market retains dated last results without claiming a live scan or overdue stock',()=>{
 const closed=Date.parse('2026-10-26T22:00:00Z'),data=status();data.lastCompletedAt=closed;
 const row=stockScanStatus('MSFT',data,closed);assert.equal(row.scanState,'closed');assert.match(row.scanText,/השוק סגור/);assert.doesNotMatch(row.scanText,/מתעכב/);assert.equal(scanCoverage(data,closed).count,50);
});
test('scan-status updates retain row identity and clear previous status when unavailable',()=>{
 const element=()=>({children:[],textContent:'',append(...items){this.children.push(...items);},setAttribute(k,v){this[k]=v;},replaceChildren(...items){this.children=items;}}),host=element();host.scrollTop=99;
 let data=status();const options={selected:'MSFT',createElement:element,onSelect(){},describe:s=>({text:'$531',...stockScanStatus(s,data,now)})};
 syncWatchRows(host,['MSFT'],options);const row=host.children[0];assert.match(row.children[2].textContent,/מחפש שיא ראשוני/);
 data={unavailable:true};syncWatchRows(host,['MSFT'],options);assert.equal(host.children[0],row);assert.equal(host.scrollTop,99);assert.match(row.children[2].textContent,/אינו זמין/);assert.doesNotMatch(row.children[2].textContent,/מחפש שיא/);
});
