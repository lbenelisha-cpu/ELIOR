import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
const host={children:[],replaceChildren(){this.children=[];},append(p){this.children.push(p);}};
const ctx=vm.createContext({$:()=>host,document:{createElement:()=>({})}});
vm.runInContext(source.slice(source.indexOf('let tradingRulesSnapshot='),source.indexOf('function mode(')),ctx);
const live={mode:'live',channelPrimary:{version:'CHANNEL_POC_RETEST_V1',requested:true,enabled:true,period:50},exitSettings:{stopLossPct:1,profitActivationPct:5,trailingGapPp:1},shortTrading:{policy:{entryPolicyVersion:'CHANNEL_POC_RETEST_V1',enabled:true,budgetUsdt:70,maxPositions:2}}};
test('rules describe four POC conditions, frozen range, initial consolidation and retained exit settings',()=>{
 const text=ctx.tradingRuleLines(live).join(' ');for(const re of [/ארבעה תנאים/,/POC/,/בתחילת התעלה/,/רגרסיה לתצוגה בלבד/,/סטופ 1%/,/תקציב 70 USDT/])assert.match(text,re);assert.doesNotMatch(text,/פי 1.5|10,000|רגרסיה יורדת/);
});
test('mode changes clear cached rules and missing or old versions cannot claim POC is active',()=>{
 ctx.renderTradingRules(live);ctx.renderTradingRules({mode:'live'});assert.match(host.children.map(p=>p.textContent).join(' '),/תקציב 70/);
 ctx.renderTradingRules({mode:'demo'});const text=host.children.map(p=>p.textContent).join(' ');assert.match(text,/DEMO/);assert.doesNotMatch(text,/תקציב 70|סטופ 1%/);
 assert.match(ctx.tradingRuleLines({mode:'live'}).join(' '),/ממתין לאימות/);
 const old=structuredClone(live);delete old.channelPrimary.version;delete old.shortTrading.policy.entryPolicyVersion;assert.match(ctx.tradingRuleLines(old).join(' '),/טרם אומת|לא אומת/);assert.doesNotMatch(ctx.tradingRuleLines(old).join(' '),/ארבעה תנאים/);
});
test('dynamic allocation is shown when the running server reports the new policy',()=>{
 const current=structuredClone(live);current.shortTrading.policy.allocationPolicy='FUTURES_WALLET_HALF_V1';delete current.shortTrading.policy.budgetUsdt;
 const text=ctx.tradingRuleLines(current).join(' ');assert.match(text,/מחצית ארנק Futures/);assert.doesNotMatch(text,/תקציב 70/);
});
