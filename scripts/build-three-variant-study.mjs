import fs from 'node:fs';import {createHash} from 'node:crypto';import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {makeFeatures,causalSignals,runPortfolio} from '../lib/portfolio-variant-study.mjs';
if(!isMainThread){const source=fs.readFileSync(workerData.file),checksum=createHash('sha256').update(source).digest('hex'),bars=makeFeatures(JSON.parse(source));const cache=workerData.file+'.signals.json';let saved;try{saved=JSON.parse(fs.readFileSync(cache));}catch{}const candidates=saved?.checksum===checksum?saved.candidates:causalSignals(bars);if(saved?.checksum!==checksum)fs.writeFileSync(cache,JSON.stringify({checksum,candidates}));parentPort.postMessage({symbol:workerData.symbol,bars,candidates});}
else{
 const [planPath,directory,output]=process.argv.slice(2);if(!output)throw Error('Usage: plan.json data-directory output.json');
 const plan=JSON.parse(fs.readFileSync(planPath)),data={};
 const waitFile=async file=>{const started=Date.now();while(!fs.existsSync(file)){if(Date.now()-started>1200000)throw Error('Data download timeout: '+file);await new Promise(r=>setTimeout(r,1000));}};
 let cursor=0;
 async function worker(){while(cursor<plan.symbols.length){const symbol=plan.symbols[cursor++];await waitFile(directory+'/'+symbol+'.json');const result=await new Promise((resolve,reject)=>{const w=new Worker(new URL(import.meta.url),{workerData:{symbol,file:directory+'/'+symbol+'.json'}});w.once('message',resolve);w.once('error',reject);w.once('exit',code=>{if(code)reject(Error('Worker exit '+code));});});data[symbol]=result;console.log(symbol,result.candidates.length,'signals');}}
 await Promise.all(Array.from({length:3},()=>worker()));
 await waitFile(directory+'/manifest.json');const manifest=JSON.parse(fs.readFileSync(directory+'/manifest.json'));
 for(const file of manifest.files){const checksum=createHash('sha256').update(fs.readFileSync(directory+'/'+file.symbol+'.json')).digest('hex');if(checksum!==file.sha256)throw Error('Source checksum mismatch: '+file.symbol);}
 const end=manifest.end,start=end-plan.days*86400000,split=start+plan.discoveryDays*86400000;
 const periods=[{id:'full',start,end},{id:'discovery',start,end:split},{id:'later',start:split,end},{id:'laterStress',start:split,end,...plan.sensitivity}];
 const results=periods.map(period=>({period:period.id,results:plan.variants.map(v=>runPortfolio(data,v,{...plan,...period}))}));
 const outputData={generatedAt:new Date().toISOString(),plan,manifest,periods:results};fs.writeFileSync(output,JSON.stringify(outputData));
 console.log(JSON.stringify(results.map(p=>({period:p.period,results:p.results.map(({trades,curve,daily,...r})=>r)})),null,2));
}
