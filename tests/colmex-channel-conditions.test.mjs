import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {colmexChannelConditions,colmexLiveTradeMarks,renderColmexChannelConditions} from '../lib/colmex-channel-conditions.mjs';
import {CHANNEL_PRIMARY_POLICY,channelEntryConfig} from '../lib/channel-primary-entry.mjs';
import {colmexChannelSignal} from '../lib/colmex-channel-entry.mjs';
import {pocFixture} from './helpers/poc-channel-fixture.mjs';

const now=Date.parse('2026-11-03T19:00:00Z');
const status={enabled:true,channelPrimary:{version:CHANNEL_PRIMARY_POLICY.version,requested:true,enabled:true,enabledAfter:now-86400000},checks:{AAPL:{at:now-60000,reason:'WAIT_CHANNEL_TWO_TOUCHES',entryDecisions:{primary:'channel_long_short',channel:{ready:false}}}}};
const channels={axis:new Map([[now-300000,300000]]),swing:{ready:true,highTouches:2,lowTouches:1,upper:333,lower:330,provisional:true},regression:{ready:true,slope:.1,middle:331.5}};
test('consolidation rule is advertised only by the updated server and recorded blockers identify its zone',()=>{
 const current=structuredClone(status);current.channelPrimary.consolidationPolicy=CHANNEL_PRIMARY_POLICY.consolidationPolicy;
 current.checks.AAPL.reason='CHANNEL_CONSOLIDATION_SIDE_BLOCK';
 current.checks.AAPL.entryDecisions.channel.consolidation={zone:'UPPER',bars:3,endAt:now-300000};
 const view=colmexChannelConditions({channels,status:current,symbol:'AAPL',now});
 assert.match(view.server,/מיקום הדשדוש אינו מתאים/);assert.match(view.server,/דשדוש עליון · 3 נרות/);
 assert.match(view.rules.join(' '),/אמצעי לשורט/);
 assert.doesNotMatch(colmexChannelConditions({channels,status,symbol:'AAPL',now}).rules.join(' '),/דשדוש לפני הכניסה/);
});
test('channel panel separates dynamic touch counts from the timestamped server decision and states actual entry requirements',()=>{
 const view=colmexChannelConditions({channels,status,symbol:'AAPL',now});
 assert.deepEqual(view.metrics.map(m=>m[1]),['2','1','עולה']);
 assert.match(view.server,/ממתין לשתי נגיעות מאושרות/);assert.match(view.server,/לא אישור כניסה בזמן הרענון/);
 assert.match(view.chartNote,/לתעלה המצוירת/);assert.match(view.levels,/333/);assert.match(view.center,/331.5/);
 assert.match(view.rules.join(' '),new RegExp(CHANNEL_PRIMARY_POLICY.period+' נרות'));
 assert.match(view.rules.join(' '),/חזרה מלמעלה ל־POC/);assert.equal(CHANNEL_PRIMARY_POLICY.minMeanDollarVolume,undefined);assert.doesNotMatch(view.rules.join(' '),/10,000|פי 1.5/);
 assert.doesNotMatch(JSON.stringify(view),/וויקוף|וואיקוף|התאוששות|Spring/);
 assert.equal(colmexChannelConditions({channels:{...channels,regression:{ready:true,slope:-.1}},now}).metrics[2][1],'יורדת');
});
test('missing, old, future, legacy, manual and historical data cannot imply a current entry approval',()=>{
 assert.equal(colmexChannelConditions({now}).metrics[0][1],'—');
 const legacy=structuredClone(status);legacy.checks.AAPL={at:now,reason:'SECONDARY_TEST'};
 assert.match(colmexChannelConditions({channels,status:legacy,symbol:'AAPL',now}).server,/ממתין לבדיקה מתועדת במסלול התעלות/);
 for(const flag of ['manual','historical'])assert.match(colmexChannelConditions({channels,status,symbol:'AAPL',now,[flag]:true}).server,/אין התאמה/);
 const old=structuredClone(status);old.checks.AAPL.at=now-1800001;
 assert.equal(colmexChannelConditions({status:old,symbol:'AAPL',now}).serverState,'old');
 old.checks.AAPL.at=now+1;assert.equal(colmexChannelConditions({status:old,symbol:'AAPL',now}).serverState,'unavailable');
 assert.match(colmexChannelConditions({status:{...status,unavailable:true},symbol:'AAPL',now}).server,/אינו זמין/);
 assert.match(colmexChannelConditions({status:{enabled:false,channelPrimary:{requested:false}},now}).route,/כבוי/);
});
test('LIVE chart preserves actual entry, peak and stop while excluding every old setup stage',()=>{
 const position={entryPrice:100,entryAt:new Date(now-600000).toISOString(),peakPrice:102,peakAt:new Date(now-300000).toISOString(),effectiveStopPrice:101,setup:{firstLow:{time:now-900000,price:98},secondRallyHigh:{time:now-800000,price:103}}};
 const original=structuredClone(position),marks=colmexLiveTradeMarks(position);
 assert.deepEqual(marks.lines.map(p=>[p.kind,p.price]),[['buy',100],['peak',102],['stop',101]]);
 assert.deepEqual(marks.points.map(p=>p.kind),['buy','peak']);
 assert.doesNotMatch(JSON.stringify(marks),/מדומה|שפל ראשון|התאוששות/);assert.deepEqual(position,original);
 assert.deepEqual(colmexLiveTradeMarks(null),{points:[],lines:[],cards:[]});
});
test('panel renders unknown metrics without stale cards and LIVE markup keeps only channel and position UI',()=>{
 const doc={createElement:tag=>({tag,dataset:{},children:[],textContent:'',ownerDocument:doc,append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];}})};
 const host=doc.createElement('section');renderColmexChannelConditions(host,{channels,status,symbol:'AAPL',now});
 const text=n=>n.textContent+' '+n.children.map(text).join(' ');
 assert.match(text(host),/נגיעות למעלה/);assert.match(text(host),/נגיעות למטה/);assert.match(text(host),/POC/);
 renderColmexChannelConditions(host,{now});assert.doesNotMatch(text(host),/333|331.5/);assert.match(text(host),/לא זמין/);
 const html=readFileSync(new URL('../colmex-pro.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/id="(?:showWyckoffHistory|wyckoffSearchStatus|wyckoffOccurrenceStatus|closedMarketPreparation|resistancePatternStatus)"|כל שלב וואיקוף/);
 for(const id of ['chart','colmexChannelConditions','showColmexSwing','showColmexRegression','chartMarkLegend','colmexChartRisk','autoLiveChecks'])assert.ok(html.includes('id="'+id+'"'));
});

test('POC rules describe a closed B and an intrabar return, while stale server versions are labelled',()=>{
 const rules=colmexChannelConditions({status,now}).rules.join(' ');assert.match(rules,/בסיום נר הפריצה/);assert.match(rules,/הפרופיל קבוע/);assert.doesNotMatch(rules,/מחזור מצטבר|פי 1.5/);
 const old=structuredClone(status);delete old.channelPrimary.version;assert.match(colmexChannelConditions({status:old,now}).route,/טרם אומת/);
});

test('Colmex displays both independent server reports and cannot mix them with chart or historical data',()=>{
 const s=structuredClone(status),at=now;s.checks.AAPL.at=at;
 s.channelPrimary.version='CHANNEL_PRIMARY_INTRABAR_V2';
 const ids=['channel','slope','break','center','volume','liquidity','signal','range','rangeBreak','plan'];
 s.checks.AAPL.entryDecisions.channel.conditionReports=Object.fromEntries(['LONG','SHORT'].map(side=>[side,{version:'CHANNEL_CONDITIONS_PARALLEL_V1',side,at,expiresAt:(Math.floor(at/300000)+1)*300000,rows:ids.map(id=>({id,state:id==='slope'?'waiting':'passed'}))}]));
 const v=colmexChannelConditions({channels,status:s,symbol:'AAPL',now});
 for(const c of v.conditionViews){assert.equal(c.count,9);assert.equal(c.rows.find(r=>r.id==='slope').state,'waiting');assert.equal(c.rows.find(r=>r.id==='volume').state,'passed');assert.equal(c.rows.find(r=>r.id==='execution').state,'unknown');}
 for(const patch of [{manual:true},{historical:true},{now:now+300000},{symbol:'MSFT'},{status:{...s,unavailable:true}}]){
  const view=colmexChannelConditions({channels,status:s,symbol:'AAPL',now,...patch});assert.equal(view.conditionViews.every(c=>c.count===0),true);
 }
});

const pocIds=['channel','break','poc','range','execution'];
test('Colmex POC policy keeps four unverified conditions when the saved scan has no report, including the overnight screenshot',()=>{
 for(const patch of [{},{checks:{}},{checks:{AAPL:{...status.checks.AAPL,at:now-43200000}}}]){
  const s={...structuredClone(status),...patch};
  const v=colmexChannelConditions({channels,status:s,symbol:'AAPL',now});
  for(const c of v.conditionViews){
   assert.deepEqual(c.rows.map(r=>r.id),pocIds);assert.equal(c.total,4);assert.equal(c.count,0);assert.equal(c.current,false);
   assert.ok(c.rows.every(r=>r.state==='unknown'));
  }
 }
 const v=colmexChannelConditions({symbol:'AAPL',now});
 assert.ok(v.conditionViews.every(c=>c.total===4&&c.count===0));assert.match(v.route,/המצב אינו זמין/);
});

test('a declared POC policy cannot borrow approvals or old labels from a legacy report',()=>{
 const s=structuredClone(status);s.checks.AAPL.at=now;
 s.checks.AAPL.entryDecisions.channel.conditionReports=Object.fromEntries(['LONG','SHORT'].map(side=>[side,{
  version:'CHANNEL_CONDITIONS_PARALLEL_V1',side,at:now,expiresAt:now+300000,
  rows:['channel','slope','break','center','volume','liquidity','signal','range','rangeBreak','plan'].map(id=>({id,state:'passed'}))
 }]));
 for(const c of colmexChannelConditions({status:s,symbol:'AAPL',now}).conditionViews){
  assert.deepEqual(c.rows.map(r=>r.id),pocIds);assert.equal(c.status,'invalid-report');assert.equal(c.count,0);
 }
});

test('actual Colmex POC evaluation renders its own five rows for each side and clears stale or unrelated evidence',()=>{
 for(const side of ['LONG','SHORT']){
  const input=pocFixture({platform:'COLMEX',side}),at=input.now;
  const channelPrimary=channelEntryConfig({COLMEX_CHANNEL_PRIMARY_ENABLED:'true',COLMEX_CHANNEL_PRIMARY_AFTER:new Date(at-600000).toISOString()},'COLMEX');
  const result=colmexChannelSignal({...input,symbol:'AAPL',ask:input.price},channelPrimary);
  assert.equal(result.ready,true,result.reason);assert.equal(result.side,side);
  const s={enabled:true,channelPrimary,checks:{AAPL:{at,reason:result.reason,entryDecisions:{primary:'channel_long_short',channel:result}}}};
  const v=colmexChannelConditions({channels,status:s,symbol:'AAPL',now:at});
  assert.match(v.rules.join(' '),/EMA50/);assert.match(v.rules.join(' '),/סגירת נר 5 דקות/);
  for(const c of v.conditionViews){
   assert.equal(c.current,true);assert.deepEqual(c.rows.map(r=>r.id),['channel','break','poc','range','trend','execution']);
   assert.deepEqual(c.rows.slice(0,5).map(r=>[r.id,r.state]),result.conditionReports[c.side].rows.map(r=>[r.id,r.state]));
   assert.equal(c.rows.at(-1).state,'unknown');
  }
  assert.equal(v.conditionViews.find(c=>c.side===side).count,5);
  assert.ok(v.conditionViews.find(c=>c.side!==side).count<5);
  for(const patch of [{manual:true},{historical:true},{now:at+300000},{now:at-1},{symbol:'MSFT'},{status:{...s,unavailable:true}}]){
   const unavailable=colmexChannelConditions({channels,status:s,symbol:'AAPL',now:at,...patch});
   assert.ok(unavailable.conditionViews.every(c=>c.total===5&&c.count===0&&!c.current));
  }
 }
});

test('Colmex renders only the four POC conditions plus execution for an old saved scan',()=>{
 const doc={createElement:tag=>({tag,dataset:{},children:[],textContent:'',ownerDocument:doc,append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];}})};
 const host=doc.createElement('section'),s=structuredClone(status);s.checks.AAPL.at=now-43200000;
 renderColmexChannelConditions(host,{channels,status:s,symbol:'AAPL',now});
 const checks=host.children.find(n=>n.className==='channel-parallel-checks');
 assert.equal(checks.children.length,2);
 for(const section of checks.children){
  const list=section.children.find(n=>n.tag==='ul');assert.equal(list.children.length,5);
  assert.ok(list.children.every(n=>n.dataset.state==='unknown'));
  assert.match(list.children.map(n=>n.textContent).join(' '),/1 ·.*3 ·.*4 ·.*8 ·/);
 }
 const text=n=>n.textContent+' '+n.children.map(text).join(' ');
 assert.match(text(host),/הבדיקה מלפני יותר מ־30 דקות/);
 assert.doesNotMatch(text(checks),/רגרסיה עולה|רגרסיה יורדת|מרכז הרגרסיה|מחזור בנר|10,000|תבנית שלא נוצלה|יציאה מעל טווח|יציאה מתחת לטווח|יעד שטרם הושג/);
});
