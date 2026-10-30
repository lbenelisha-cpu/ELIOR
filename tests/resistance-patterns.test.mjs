import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../resistance-patterns.js',import.meta.url),'utf8'),context);
const {detect,geometry,drawCanvas,drawSvg,describe}=context.LEVI_RESISTANCE;
const start=Date.parse('2026-10-30T10:00:00Z'),step=300000;
const bars=()=>Array.from({length:21},(_,i)=>({openTime:start+i*step,closeTime:start+(i+1)*step-1,open:98,close:98.5,high:i===2||i===12?100:99,low:97,closed:true}));
const options={interval:'5m',now:start+50*step};
test('a resistance band needs separated tests and an intervening retreat; trending highs do not manufacture a zone',()=>{
 const a=bars(),z=detect(a,options);assert.equal(z.status,'RESISTANCE');assert.equal(z.upper,100);assert.equal(z.lower,99.7);assert.equal(z.start,a[2].openTime);
 for(const fixture of [a.slice(0,19),a.map((b,i)=>({...b,high:i===2?100:99})),a.map(b=>({...b,low:99.8,open:99.9,close:99.9,high:100}))])assert.equal(detect(fixture,options),null);
});
test('only a later closed candle confirms a breakout; wicks, live candles and future candles cannot',()=>{
 const a=bars();a[20]={...a[20],high:102,close:101};
 assert.equal(detect(a,options).status,'BREAKOUT');
 assert.equal(detect(a.map((b,i)=>i===20?{...b,close:99}:b),options).status,'RESISTANCE');
 assert.equal(detect(a.map((b,i)=>i===20?{...b,closed:false}:b),options),null);
 assert.equal(detect(a,{...options,now:a[20].openTime+1000}),null);
 const before=detect(bars(),options);a.push({...a[20],openTime:start+21*step,closeTime:start+22*step-1,close:97,low:96});
 assert.equal(detect(a,options).status,'FAILED_BREAKOUT');assert.equal(before.status,'RESISTANCE');
 a.push({...a[20],openTime:start+22*step,closeTime:start+23*step-1});assert.equal(detect(a,options).status,'FAILED_BREAKOUT');
});
test('missing, malformed and duplicate candles reset evidence, and stock date bars agree with Binance bars',()=>{
 const a=bars();assert.equal(detect(a.filter((_,i)=>i!==10),options),null);
 const broken=a.map((b,i)=>i===10?{...b,high:0}:b);assert.equal(detect(broken,options),null);
 assert.equal(detect([...a.slice(0,11),a[10],...a.slice(11)],options),null);
 const stock=a.map(({openTime,closeTime,...b})=>({...b,date:new Date(openTime).toISOString()}));
 assert.equal(detect(stock,{...options,interval:'5min'}).upper,100);
 assert.equal(detect(a,{...options,interval:'unsupported'}),null);
});
test('the rectangle clips to the viewport and both chart renderers use the same zone, including breakout marker',()=>{
 const a=bars();a[20]={...a[20],close:101,high:102};const zone=detect(a,options),view=a.slice(10),x=i=>20+i*10,y=p=>300-p*2,bounds={left:15,right:125,top:80,bottom:150};
 const g=geometry(zone,view,x,y,bounds);assert.equal(g.left,15);assert.equal(g.width,110);assert.equal(g.breakoutX,120);
 assert.equal(geometry(zone,a.map(b=>({...b,openTime:b.openTime+100*step})),x,y,bounds),null);
 const calls=[],ctx=new Proxy({},{get:(_,k)=>(...args)=>calls.push([k,...args]),set:()=>true});drawCanvas({ctx,zone,view,x,y,bounds});assert.ok(calls.some(c=>c[0]==='strokeRect'));assert.ok(calls.some(c=>c[0]==='lineTo'));
 class Element{constructor(tag){this.tag=tag;this.attrs={};this.children=[];}setAttribute(k,v){this.attrs[k]=v;}append(e){this.children.push(e);}}
 const svg=new Element('svg');drawSvg({svg,zone,view,x,y,bounds,document:{createElementNS:(_,tag)=>new Element(tag)}});
 assert.equal(svg.children[0].attrs['data-resistance-pattern'],'BREAKOUT');assert.equal(svg.children[0].children[0].tag,'rect');assert.equal(svg.children[0].children[1].tag,'line');assert.match(describe(zone,'5m'),/אינו אישור קנייה/);
});
