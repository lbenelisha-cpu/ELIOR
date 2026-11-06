import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {colmexChannelConditions,colmexLiveTradeMarks,renderColmexChannelConditions} from '../lib/colmex-channel-conditions.mjs';
import {CHANNEL_PRIMARY_POLICY} from '../lib/channel-primary-entry.mjs';

const now=Date.parse('2026-11-03T19:00:00Z');
const status={enabled:true,channelPrimary:{requested:true,enabled:true,enabledAfter:now-86400000},checks:{AAPL:{at:now-60000,reason:'WAIT_CHANNEL_TWO_TOUCHES',entryDecisions:{primary:'channel_long_short',channel:{ready:false}}}}};
const channels={axis:new Map([[now-300000,300000]]),swing:{ready:true,highTouches:2,lowTouches:1,upper:333,lower:330,provisional:true},regression:{ready:true,slope:.1,middle:331.5}};
test('consolidation rule is advertised only by the updated server and recorded blockers identify its zone',()=>{
 const current=structuredClone(status);current.channelPrimary.consolidationPolicy=CHANNEL_PRIMARY_POLICY.consolidationPolicy;
 current.checks.AAPL.reason='CHANNEL_CONSOLIDATION_SIDE_BLOCK';
 current.checks.AAPL.entryDecisions.channel.consolidation={zone:'UPPER',bars:3,endAt:now-300000};
 const view=colmexChannelConditions({channels,status:current,symbol:'AAPL',now});
 assert.match(view.server,/מיקום הדשדוש אינו מתאים/);assert.match(view.server,/דשדוש עליון · 3 נרות/);
 assert.match(view.rules.join(' '),/אמצעי מאפשר את שני הכיוונים/);
 assert.doesNotMatch(colmexChannelConditions({channels,status,symbol:'AAPL',now}).rules.join(' '),/דשדוש לפני הכניסה/);
});
test('channel panel separates dynamic touch counts from the timestamped server decision and states actual entry requirements',()=>{
 const view=colmexChannelConditions({channels,status,symbol:'AAPL',now});
 assert.deepEqual(view.metrics.map(m=>m[1]),['2','1','עולה']);
 assert.match(view.server,/ממתין לשתי נגיעות מאושרות/);assert.match(view.server,/לא אישור כניסה בזמן הרענון/);
 assert.match(view.chartNote,/לתעלה המצוירת/);assert.match(view.levels,/333/);assert.match(view.center,/331.5/);
 assert.match(view.rules.join(' '),new RegExp(CHANNEL_PRIMARY_POLICY.period+' נרות'));
 assert.match(view.rules.join(' '),new RegExp(String(CHANNEL_PRIMARY_POLICY.minVolumeRatio).replace('.','\\.')));
 assert.equal(CHANNEL_PRIMARY_POLICY.minMeanDollarVolume,10000);assert.match(view.rules.join(' '),/10,000/);
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
 assert.match(text(host),/נגיעות למעלה/);assert.match(text(host),/נגיעות למטה/);assert.match(text(host),/פי 1.5/);
 renderColmexChannelConditions(host,{now});assert.doesNotMatch(text(host),/333|331.5/);assert.match(text(host),/לא זמין/);
 const html=readFileSync(new URL('../colmex-pro.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/id="(?:showWyckoffHistory|wyckoffSearchStatus|wyckoffOccurrenceStatus|closedMarketPreparation|resistancePatternStatus)"|כל שלב וואיקוף/);
 for(const id of ['chart','colmexChannelConditions','showColmexSwing','showColmexRegression','chartMarkLegend','colmexChartRisk','autoLiveChecks'])assert.ok(html.includes('id="'+id+'"'));
});

test('intrabar and previous-server requirements are described separately using reported policy',()=>{
 const current=structuredClone(status);current.channelPrimary.waitForBreakoutClose=false;
 const rules=colmexChannelConditions({status:current,now}).rules.join(' ');
 assert.match(rules,/ללא המתנה לסגירתו/);assert.match(rules,/הצטבר בנר הפריצה הפתוח/);assert.match(rules,/עד סוף נר הפריצה הנוכחי/);assert.doesNotMatch(rules,/דקות מסגירת/);
 assert.match(colmexChannelConditions({status,now}).rules.join(' '),/SHORT/);
});
