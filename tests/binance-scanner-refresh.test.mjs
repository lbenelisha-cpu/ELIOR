import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const src=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
class Element{
 constructor(){this.children=[];this.dataset={};this.className='';this._html='';this.htmlWrites=0;}
 append(child){this.children.push(child);child.parent=this;}
 insertBefore(child,before){if(child.parent)child.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,child);child.parent=this;}
 remove(){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
 set innerHTML(v){this._html=v;this.htmlWrites++;}get innerHTML(){return this._html;}
}
test('scanner quote refresh preserves rows, cells, click handlers and scroll; no-change refresh does not reset markup',()=>{
 const window={};vm.runInNewContext(fs.readFileSync(new URL('../binance-scanner-view.js',import.meta.url),'utf8'),{window,document:{createElement:()=>new Element()}});
 const body=new Element();body.scrollTop=100;let selected;
 const row=(symbol,html='1')=>({symbol,className:'active-position pnl-profit',cells:[{html},{html:'profit',className:'pnl-profit'}]});
 window.LEVI_SCANNER_VIEW.update(body,[row('A'),row('B')],s=>{selected=s;});const a=body.children[0],cell=a.children[0];
 window.LEVI_SCANNER_VIEW.update(body,[row('A'),row('B')],s=>{selected=s;});assert.equal(cell.htmlWrites,1);assert.equal(body.children[0],a);
 window.LEVI_SCANNER_VIEW.update(body,[row('B'),row('A','2')],s=>{selected=s;});assert.equal(body.children[1],a);assert.equal(a.children[0],cell);assert.equal(cell.innerHTML,'2');assert.equal(body.scrollTop,100);a.onclick();assert.equal(selected,'A');
 window.LEVI_SCANNER_VIEW.update(body,[row('A')],()=>{});assert.equal(body.children.length,1);assert.equal(body.children[0],a);
});
function loader(){
 const renders=[],labels={};let account={connected:true},failAgent=false,selectedMode='live';
 const context=vm.createContext({document:{hidden:false},window:{dispatchEvent(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},activeView:"trade",Date,currentMode:'live',currentLiveAccount:null,MODE:'/mode',AGENT:'/agent',LIVEACC:'/account',console:{error(){}},
  J:async(url,options)=>{if(url==='/mode')return {mode:selectedMode};if(url==='/agent'){if(failAgent)throw Error('network');return {agents:[]};}assert.equal(options.timeoutMs,35000);return account?{connected:true,account}:{connected:false};},
  mode:m=>{context.currentMode=m.mode;},
  loadLiveAccount:async data=>data.connected?data.account:null,
  render:(agent,mode,account,options)=>{context.currentLiveAccount=account;renders.push({mode,account,options});},
  put:(key,text)=>{labels[key]=text;},tradeExecutionTime:()=> 'last-confirmed',loadActionJournal:async()=>{},$:()=>null});
 vm.runInContext(src.slice(src.indexOf('let dashboardLoadInFlight='),src.indexOf('\nasync function authenticatedControl(')),context);
 return {context,renders,labels,setAccount:a=>{account=a;},failAgent:()=>{failAgent=true;},setMode:m=>{selectedMode=m;}};
}
test('successful live refresh renders once with verified account instead of a provisional unknown-color render',async()=>{
 const u=loader();await u.context.load();assert.equal(u.renders.length,1);assert.equal(u.renders[0].account.connected,true);assert.equal(u.renders[0].options.preserveScanner,false);
});
test('failed account refresh keeps prior scanner visible but clears trading account and explicitly labels stale data',async()=>{
 const u=loader();await u.context.load();u.setAccount(null);await u.context.load();assert.equal(u.renders.at(-1).options.preserveScanner,true);assert.equal(u.context.currentLiveAccount,null);assert.match(u.labels['#scannerFreshness'],/לא אומתו מחדש/);
 u.setAccount({connected:true});await u.context.load();assert.equal(u.renders.at(-1).options.preserveScanner,false);assert.equal(u.labels['#scannerFreshness'],'');
});
test('initial failure and mode switching cannot preserve positions from another account mode',async()=>{
 const u=loader();u.setAccount(null);await u.context.load();assert.equal(u.renders[0].options.preserveScanner,false);
 u.setAccount({connected:true});await u.context.load();u.setMode('demo');await u.context.load();u.setMode('live');u.setAccount(null);await u.context.load();assert.equal(u.renders.at(-1).options.preserveScanner,false);
});
test('outer network failure also invalidates current account while marking the retained scanner stale',async()=>{
 const u=loader();await u.context.load();u.failAgent();await u.context.load();assert.equal(u.context.currentLiveAccount,null);assert.match(u.labels['#scannerFreshness'],/לא אומת מחדש/);
});
