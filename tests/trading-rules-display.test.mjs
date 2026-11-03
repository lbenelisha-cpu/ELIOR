import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
const host={children:[],replaceChildren(){this.children=[];},append(p){this.children.push(p);}};
const ctx=vm.createContext({$:()=>host,document:{createElement:()=>({})}});
vm.runInContext(source.slice(source.indexOf('let tradingRulesSnapshot='),source.indexOf('function mode(')),ctx);
const live={mode:'live',channelPrimary:{requested:true,enabled:true,period:50,minVolumeRatio:1.5,minMeanDollarVolume:10000,signalValidityMs:300000,livePriceRule:'CURRENT_PRICE'},exitSettings:{stopLossPct:1,profitActivationPct:5,trailingGapPp:1},shortTrading:{policy:{enabled:true,period:50,budgetUsdt:70,maxPositions:2,livePriceRule:'CURRENT_PRICE'}}};
test('rules describe reported channel policy, current price recovery and owner exit settings',()=>{
 const text=ctx.tradingRuleLines(live).join('\n');assert.match(text,/50 נרות/);assert.match(text,/ממוצע 20/);assert.match(text,/5 דקות מסגירת/);assert.match(text,/אינה פוסלת לאחר התאוששות/);assert.match(text,/סטופ 1%/);assert.match(text,/תקציב 70 USDT/);assert.doesNotMatch(text,/RSI עד 40|100 נרות/);
});
test('fallback preserves reported policy; mode changes clear it and missing values are not defaults',()=>{
 ctx.renderTradingRules(live);ctx.renderTradingRules({mode:'live'});assert.match(host.children.map(p=>p.textContent).join('\n'),/תקציב 70/);
 ctx.renderTradingRules({mode:'demo'});const demo=host.children.map(p=>p.textContent).join('\n');assert.match(demo,/DEMO/);assert.doesNotMatch(demo,/תקציב 70|סטופ 1%/);
 assert.match(ctx.tradingRuleLines({mode:'live'}).join('\n'),/ממתין לאימות/);
 assert.match(ctx.tradingRuleLines({...live,channelPrimary:{requested:true,enabled:false,error:'BLOCKED'}}).join('\n'),/חסום: BLOCKED/);
});

test('intrabar rules follow verified LONG and SHORT policies without advertising a closing-candle wait',()=>{
 const x=structuredClone(live);x.channelPrimary.waitForBreakoutClose=false;x.shortTrading.policy.waitForBreakoutClose=false;
 const text=ctx.tradingRuleLines(x).join('\n');assert.match(text,/ללא המתנה לסגירת נר הפריצה/);assert.match(text,/מחזור מצטבר בנר הפתוח/);assert.match(text,/עד סוף נר הפריצה הנוכחי/);assert.doesNotMatch(text,/נר פריצה נסגר|פריצה מטה בנר סגור|דקות מסגירת/);
});
