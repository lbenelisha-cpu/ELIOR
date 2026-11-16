import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source=read('binance-agent.js');
const selection=source.slice(source.indexOf('function selectScannerAsset('),source.indexOf('function render(d,'));
const selectListener=source.match(/window\.addEventListener\('levi-dashboard-select',event=>\{[\s\S]*?\n\}\);/)[0];

test('internal chart navigation supports Futures-only contracts, honors explicit side and rejects unknown positions',()=>{
 const symbols=[],events={};
 const ctx={window:{addEventListener:(name,fn)=>events[name]=fn},document:{querySelectorAll:()=>[],getElementById:()=>null},
  currentMode:'live',currentLiveAccount:null,currentAgentData:{agents:[{symbol:'DUALUSDT'}]},
  futuresChartStatus:{positions:[{symbol:'SHORTUSDT'},{symbol:'DUALUSDT'}]},
  selectedSymbol:'DUALUSDT',chartMarketPreference:null,$:()=>null,setDashboardView(){},
  updateSelectedAsset(){symbols.push([ctx.selectedSymbol,ctx.chartMarketPreference]);}};
 vm.runInNewContext(selection+'\n'+selectListener,ctx);
 const pick=detail=>events['levi-dashboard-select']({detail});
 pick({symbol:'SHORTUSDT',market:'FUTURES'});pick({symbol:'DUALUSDT',market:'FUTURES'});
 pick('DUALUSDT');pick({symbol:'UNKNOWNUSDT',market:'FUTURES'});
 assert.deepEqual(symbols,[['SHORTUSDT','FUTURES'],['DUALUSDT','FUTURES'],['DUALUSDT','SPOT']]);
 assert.equal(ctx.chartMarketForPosition(null,{symbol:'SHORTUSDT'},false),'FUTURES');
 assert.equal(ctx.chartMarketForPosition('SPOT',{symbol:'DUALUSDT'},true),'SPOT');
 assert.equal(ctx.chartMarketForPosition('FUTURES',{symbol:'DUALUSDT'},true),'FUTURES');
 ctx.currentMode='demo';pick({symbol:'SHORTUSDT',market:'FUTURES'});assert.equal(symbols.length,3);
});

test('both sides of one symbol and positions outside the scanner have independently selectable chips',()=>{
 const source=read('binance-unified-dashboard.js'),chips=[],events=[];
 const selected={symbol:'BOTHUSDT',market:'FUTURES',shortSymbols:['BOTHUSDT','SHORTUSDT']};
 const ctx={snapshot:{agent:{agents:[{symbol:'BOTHUSDT',position:'LONG'},{symbol:'WATCHUSDT'}]}},key:'',
  window:{LEVI_CHART_SELECTION:()=>selected,dispatchEvent:event=>events.push(event.detail)},market:{},search:{value:''},empty:{},
  strip:{replaceChildren:()=>chips.splice(0),append:chip=>chips.push(chip)},
  make:(tag,label)=>({label,dataset:{},setAttribute(k,v){this[k]=v;},addEventListener(k,v){this[k]=v;}}),
  CustomEvent:class{constructor(type,{detail}){this.detail=detail;}}};
 vm.runInNewContext(source.slice(source.indexOf(' function render(){'),source.indexOf(" search.addEventListener('input',render)"))+'\nrender();',ctx);
 const chip=label=>chips.find(x=>x.label===label);
 assert.equal(chip('BOTHUSDT · SHORT')['aria-pressed'],'true');
 assert.equal(chip('BOTHUSDT · LONG')['aria-pressed'],'false');
 for(const label of ['BOTHUSDT · LONG','BOTHUSDT · SHORT','SHORTUSDT · SHORT','WATCHUSDT'])chip(label).click();
 assert.deepEqual(events.map(e=>[e.symbol,e.market]),[['BOTHUSDT','SPOT'],['BOTHUSDT','FUTURES'],['SHORTUSDT','FUTURES'],['WATCHUSDT',null]]);
 selected.shortSymbols=[];ctx.render();assert.equal(chip('SHORTUSDT · SHORT'),undefined);
});

test('a Futures-only symbol survives an unrelated Spot scan and status refresh rerenders the cards without another candle request',async()=>{
 const labels={},reads=[],events=[];let renders=0;
 const short={symbol:'SHORTUSDT'},ctx={
  currentMode:'live',currentAgentData:{agents:[{symbol:'OTHERUSDT',position:'LONG'}]},currentLiveAccount:null,
  futuresChartStatus:{positions:[short]},selectedSymbol:short.symbol,chartMarketPreference:null,
  selectedChartMarket:'SPOT',chartCandles:[],activeView:'trade',Event,
  $:()=>null,put:(key,v)=>{labels[key]=v;},chartPositionSnapshot:()=>({}),
  refreshPositionPriceLegend:()=>renders++,loadChart:async s=>reads.push(s),
  window:{dispatchEvent:e=>events.push(e.type)}
 };
 const update=source.slice(source.indexOf('async function updateSelectedAsset('),source.indexOf('function blockerLabel('));
 vm.runInNewContext(selection+'\n'+update,ctx);
 await ctx.updateSelectedAsset();
 assert.equal(ctx.selectedSymbol,'SHORTUSDT');assert.equal(ctx.selectedChartMarket,'FUTURES');
 assert.equal(labels['#chartSymbol'],'SHORTUSDT');assert.match(labels['#chartDecisionBadge'],/SHORT/);
 await ctx.updateSelectedAsset(ctx.currentAgentData,'live',null,{statusOnly:true});
 assert.equal(renders,2);assert.deepEqual(reads,['SHORTUSDT']);assert.deepEqual(events,['levi:chart-selection','levi:chart-selection']);
});
