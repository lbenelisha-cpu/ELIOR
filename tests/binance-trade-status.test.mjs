import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ui=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
function status(s){
 const classes=new Set();
 const el={textContent:'',classList:{toggle:(c,on)=>on?classes.add(c):classes.delete(c)}};
 const ctx=vm.createContext({$:()=>el,Date});
 vm.runInContext(ui.slice(ui.indexOf('function renderTradeControlStatus('),ui.indexOf('function mode(s){')),ctx);
 ctx.renderTradeControlStatus(s);return {el,classes};
}
test('active, stopped, disabled and unknown server states are distinct',()=>{
 const active=status({mode:'live',liveTradingEnabled:true,autoExecution:true,tradeControl:{paused:false,resumedAt:new Date(Date.now()-120000).toISOString()}});
 assert.ok(active.classes.has('trading-active'));assert.match(active.el.textContent,/2 דקות/);
 const stopped=status({tradeControl:{paused:true,pausedAt:new Date().toISOString()}});
 assert.ok(stopped.classes.has('trading-paused'));assert.match(stopped.el.textContent,/אין קניות חדשות/);
 assert.equal(status({mode:'live',tradeControl:{paused:false}}).classes.has('trading-active'),false);
 assert.match(status({}).el.textContent,/לא ידוע/);
});
test('decision history preserves pause, fresh-signal and data failure reasons',()=>{
 const src=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ctx=vm.createContext({});
 vm.runInContext(src.slice(src.indexOf('function decisionReasonFromAgent('),src.indexOf('function candidateBlocker(')),ctx);
 for(const reason of ['TRADING_PAUSED','WAIT_NEW_WYCKOFF_SIGNAL'])assert.equal(ctx.decisionReasonFromAgent({decision:'HOLD'},{ok:true,buyReason:reason}),reason);
 assert.equal(ctx.decisionReasonFromAgent({}, {ok:false,error:'STALE_PRICE'}),'STALE_PRICE');
});
test('blocked account shows the current reason and check time, not the old resume time',()=>{
 const resumedAt='2026-10-09T12:23:30Z',checkedAt='2026-10-30T11:03:22Z';
 const blocked=status({mode:'live',liveTradingEnabled:true,autoExecution:true,tradeControl:{paused:false,resumedAt},liveState:{ready:false,journalReady:true,reconciliation:{checkedAt,unmanaged:['ETHUSDT']}}});
 assert.match(blocked.el.textContent,/קניות חסומות · יתרה לא מנוהלת ביומן: ETHUSDT/);
 assert.ok(blocked.el.textContent.includes('בדיקת חשבון אחרונה: '+new Date(checkedAt).toLocaleString('he-IL')));
 assert.ok(!blocked.el.textContent.includes(new Date(resumedAt).toLocaleString('he-IL')));
 assert.doesNotMatch(blocked.el.textContent,/מאז|דקות/);
 assert.equal(blocked.classes.has('trading-active'),false);
 const unknownTime=status({mode:'live',tradeControl:{paused:false,resumedAt},liveState:{ready:false,journalReady:true,reconciliation:{pending:[{symbol:'ETHUSDT'}]}}});
 assert.match(unknownTime.el.textContent,/פער בכמות ממתין לאימות: ETHUSDT/);
 assert.match(unknownTime.el.textContent,/מועד בדיקת החשבון לא זמין/);
 assert.doesNotMatch(unknownTime.el.textContent,/המסחר חודש|מאז|דקות/);
});
