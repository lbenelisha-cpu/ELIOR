import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('binance-agent.js');
const now=Date.now();
function node(){
  return {children:[],style:{setProperty(key,value){this[key]=value;}},
    append(...children){this.children.push(...children);}, replaceChildren(){this.children=[];}};
}
function harness(){
  const host=node();
  const position={symbol:'ABCUSDT',qty:2,entryAt:now-60000,priceAt:now,entryPrice:100,
    stopPrice:101,activationPrice:95,targetPrice:80,exitPolicy:'FUTURES_SHORT_SETTINGS_V2'};
  const snapshot={venue:'BINANCE_FUTURES',mode:'live',shortTrading:{checkedAt:now,account:{},positions:[position]}};
  const ctx=vm.createContext({$:()=>host,document:{createElement:node},selectedSymbol:'ABCUSDT',
    chartPositionSnapshot:()=>snapshot,fmt:(n,d)=>n.toLocaleString('en-US',{maximumFractionDigits:d})});
  vm.runInContext(read('position-barriers.js'),ctx);
  vm.runInContext(source.slice(source.indexOf('function positionPriceCards('),source.indexOf('function drawCandles(')),ctx);
  return {ctx,host,snapshot,position,values:()=>host.children.map(card=>card.children[1].textContent),
    labels:()=>host.children.map(card=>card.children[0].textContent)};
}

test('an open SHORT has all four chart cards before candles load and after the trailing stop moves',()=>{
  const {ctx,host,position,values,labels}=harness();
  ctx.refreshPositionPriceLegend();
  assert.equal(host.hidden,false);
  assert.deepEqual(values(),['100','101','95','80']);
  assert.deepEqual(labels(),['מחיר כניסה','סטופ נוכחי','הפעלת הגנת רווח','יעד רווח TP']);
  position.armed=true;
  position.stopPrice=94;
  const model=ctx.LEVI_POSITION_BARRIERS.fromSnapshot(ctx.chartPositionSnapshot(),'ABCUSDT',now);
  ctx.renderPriceLegend(ctx.positionPriceCards(model),{min:90,max:105});
  assert.deepEqual(values(),['100','94','95','80']);
  assert.equal(labels()[1],'סטופ נגרר נוכחי');
  assert.match(labels()[3],/מחוץ לטווח/);
});

test('a pending SHORT level is explicitly unknown, stale updates retain their labels and closure removes the cards',()=>{
  const {ctx,host,position,snapshot,values,labels}=harness();
  delete position.activationPrice;
  position.priceAt=now-300000;
  ctx.refreshPositionPriceLegend();
  assert.deepEqual(values(),['100','101','ממתין לנתון','80']);
  assert.ok(labels().every(label=>label.includes('נתונים ישנים')));
  snapshot.shortTrading.positions=[];
  ctx.refreshPositionPriceLegend();
  assert.equal(host.hidden,true);
  assert.deepEqual(values(),[]);
});
