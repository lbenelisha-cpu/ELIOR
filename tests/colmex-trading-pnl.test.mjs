import test from 'node:test';
import assert from 'node:assert/strict';
import {colmexPnlRows,filterColmexPnl,summarizeColmexPnl,colmexPnlCsv,createColmexPnlPanel} from '../colmex-trading-pnl.js';
const now=Date.UTC(2026,10,2,15),trade={positionId:'1',symbol:'AAPL',qty:2,entryPrice:100,exitPrice:105,entryAt:now-3600000,closedObservedAt:now-1000,grossPnl:10,accountingStatus:'FEES_UNVERIFIED',exitOrderIds:['exit1'],netPnl:null,fees:null};
test('report preserves verified gross gains, losses and zero without treating missing fees as zero',()=>{
 const rows=colmexPnlRows([trade,{...trade,grossPnl:-5},{...trade,grossPnl:0},{...trade,grossPnl:null},{...trade,accountingAdjusted:true},{...trade,exitOrderIds:[]},{...trade,netPnl:999,fees:0}],now),s=summarizeColmexPnl(rows);
 assert.equal(s.gross,15);assert.equal(s.known,4);assert.equal(s.unknown,3);assert.equal(s.net,null);assert.equal(s.wins,2);assert.equal(s.losses,1);assert.equal(s.flat,1);assert.equal(rows[0].grossPct,5);assert.ok(rows.every(r=>r.net===null&&r.fees===null));
 assert.equal(summarizeColmexPnl(colmexPnlRows([{...trade,grossPnl:null}],now)).gross,null);
 assert.equal(summarizeColmexPnl([]).gross,null);
});
test('date filtering uses Israeli calendar days and excludes invalid dates; profit sort keeps unknown last',()=>{
 const rows=colmexPnlRows([{...trade,closedObservedAt:Date.UTC(2026,10,1,22,5)},{...trade,closedObservedAt:Date.UTC(2026,10,1,21,55)},{...trade,closedObservedAt:now+1000},{...trade,closedObservedAt:null}],now);
 assert.equal(filterColmexPnl(rows,{period:'today'},now).length,1);assert.equal(filterColmexPnl(rows,{period:'all'},now).length,2);
 assert.equal(filterColmexPnl(rows,{period:'custom',from:'2026-11-01',to:'2026-11-01'},now).length,1);
 const sorted=filterColmexPnl(colmexPnlRows([{...trade,grossPnl:null},{...trade,grossPnl:-1},trade],now),{sort:'profit',symbol:'aapl'},now);assert.deepEqual(sorted.map(r=>r.gross),[10,-1,null]);
});
function fixture(){
 const previous=globalThis.document,nodes=[],downloads=[];
 const element=tag=>{const n={tag,children:[],textContent:'',hidden:false,value:'',events:{},append(...xs){this.children.push(...xs);if(tag==='select'&&!this.value)this.value=xs[0]?.value||'';},replaceChildren(...xs){this.children=xs;},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.events[k]=fn;}};nodes.push(n);return n;};
 globalThis.document={createElement:element};const host=element('section'),panel=createColmexPnlPanel(host,{now:()=>now,download:(...a)=>downloads.push(a)}),text=n=>n.textContent+n.children.map(text).join('|');
 return {panel,nodes,downloads,text:()=>text(host),restore:()=>{globalThis.document=previous;}};
}
test('Colmex panel filters and exports the same rows, and errors clear previous amounts',()=>{
 const u=fixture();try{u.panel.setData({closedTrades:[trade,{...trade,symbol:'MSFT',grossPnl:-4},{...trade,symbol:'NVDA',grossPnl:null}]});assert.match(u.text(),/\+6 USD/);assert.match(u.text(),/סכום חלקי/);assert.match(u.text(),/1 ללא חישוב גולמי/);
 const search=u.nodes.find(n=>n['aria-label']==='חיפוש נכס ברווח והפסד');search.value='MSFT';search.events.input();assert.match(u.text(),/-4 USD/);assert.doesNotMatch(u.text(),/\+6 USD/);
 const exportBtn=u.nodes.find(n=>n.textContent==='ייצוא CSV לאקסל');exportBtn.events.click();assert.equal(u.downloads.length,1);assert.match(u.downloads[0][0],/MSFT/);assert.doesNotMatch(u.downloads[0][0],/AAPL/);
 u.panel.setData(null,true);assert.doesNotMatch(u.text(),/-4 USD/);assert.match(u.text(),/לא ניתן לקרוא/);assert.equal(exportBtn.disabled,true);
 }finally{u.restore();}
});
test('panel never represents absent history as zero and invalid ranges disable export',()=>{
 const u=fixture();try{assert.match(u.text(),/ממתין ליומן/);u.panel.setData({closedTrades:[]});assert.match(u.text(),/אין סגירות/);assert.doesNotMatch(u.text(),/0 USD/);
 u.panel.setData({closedTrades:[trade]});const period=u.nodes.find(n=>n['aria-label']==='תקופה');period.value='custom';const from=u.nodes.find(n=>n['aria-label']==='מתאריך'),to=u.nodes.find(n=>n['aria-label']==='עד תאריך');from.value='2026-11-03';to.value='2026-11-02';period.events.change();assert.match(u.text(),/תאריך ההתחלה/);assert.equal(u.nodes.find(n=>n.textContent==='ייצוא CSV לאקסל').disabled,true);
 }finally{u.restore();}
});
test('CSV uses blank unknown amounts and neutralizes formula text; HTML-like symbols are plain text',()=>{
 const rows=colmexPnlRows([{...trade,symbol:'=HYPERLINK("x")',grossPnl:null,reason:'<img src=x>'}],now),csv=colmexPnlCsv(rows);assert.match(csv,/"'=HYPERLINK/);assert.match(csv,/,"","","","",/);
 const u=fixture();try{u.panel.setData({closedTrades:[{...trade,symbol:'<img src=x onerror=alert(1)>'}]});assert.match(u.text(),/<img src=x/);assert.ok(u.nodes.every(n=>!Object.hasOwn(n,'innerHTML')));}finally{u.restore();}
});
