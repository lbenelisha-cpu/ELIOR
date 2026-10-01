import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
test('sound activation, freshness, duplicate suppression and risk beep',async()=>{
 const elements=Object.fromEntries(['sound-toggle','sound-test','sound-status'].map(id=>[id,{setAttribute(){}}]));let starts=0;
 class Audio {state='running';currentTime=0;destination={};async resume(){}createOscillator(){return {frequency:{},connect(){},start(){starts++},stop(){}}}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}}}
 const window={AudioContext:Audio};vm.runInNewContext(await readFile(new URL('../mt4-alerts.js',import.meta.url),'utf8'),{window,document:{getElementById:id=>elements[id]},Date,Set,Error});
 const event={id:'positive:1',message:'positive',timestamp:Date.now()};
 assert.equal(await window.LEVIAlerts.notify(event),false);await elements['sound-toggle'].onclick();assert.equal(starts,2);
 assert.equal(await window.LEVIAlerts.notify(event),true);assert.equal(starts,4);assert.equal(await window.LEVIAlerts.notify(event),false);
 assert.equal(await window.LEVIAlerts.notify({...event,id:'old',timestamp:Date.now()-61000}),false);
 assert.equal(await window.LEVIAlerts.notify({...event,id:'risk:1',message:'risk'}),true);assert.equal(starts,6);
 await elements['sound-toggle'].onclick();assert.equal(await window.LEVIAlerts.notify({...event,id:'new'}),false);
});
