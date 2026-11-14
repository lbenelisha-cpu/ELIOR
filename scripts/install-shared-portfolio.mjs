// Selective, fail-closed installer. --check stages/tests only. --activate is an explicit live-policy change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const release=path.resolve(here,'..');
export function patchSharedPortfolio(runtime,source=release,{backendOnly=false}={}){
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'scripts/shared-portfolio-patch.json'),'utf8'));
 const plan=[];
 for(const item of manifest.filter(p=>!backendOnly||p.file==='server.mjs'||p.file.startsWith('lib/'))){
  const target=path.join(runtime,item.file),present=fs.existsSync(target),original=present?fs.readFileSync(target,'utf8'):null;
  let result=original;
  if(item.newFile){const expected=fs.readFileSync(path.join(source,item.file),'utf8');if(present&&original!==expected)throw Error('Unrecognized existing '+item.file);result=expected;}
  else{
   if(!present)throw Error('Missing '+item.file);
   for(const [i,h] of item.hunks.entries()){
    const count=(s,x)=>s.split(x).length-1;
    if(count(result,h.after)===1)continue;
    if(count(result,h.before)!==1)throw Error('Unrecognized '+item.file+' hunk '+i+'; no runtime files changed');
    result=result.replace(h.before,h.after);
   }
  }
  plan.push({file:item.file,original,result});
 }
 // All anchors validated before any staged write.
 for(const p of plan){fs.mkdirSync(path.dirname(path.join(runtime,p.file)),{recursive:true});fs.writeFileSync(path.join(runtime,p.file),p.result);}
 return plan;
}
function run(command,args,options={}){return execFileSync(command,args,{stdio:'inherit',...options});}
async function main(){
 const mode=process.argv[2],runtime=path.resolve(process.argv[3]||'/opt/levi-binance');
 if(!['--check','--activate'].includes(mode))throw Error('Use --check or --activate [runtime path]');
 if(runtime===release)throw Error('Installer must run from an exported release, not the live directory');
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'levi-shared-three-'));
 try{
  fs.cpSync(path.join(runtime,'lib'),path.join(stage,'lib'),{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(release,'scripts/shared-portfolio-patch.json'),'utf8')).filter(p=>p.file==='server.mjs'||p.file.startsWith('lib/'));
  // Browser assets deploy from GitHub to Netlify; the VPS retains its local static copies.
  for(const p of manifest){if(p.newFile&&!fs.existsSync(path.join(runtime,p.file)))continue;fs.mkdirSync(path.dirname(path.join(stage,p.file)),{recursive:true});fs.copyFileSync(path.join(runtime,p.file),path.join(stage,p.file));}
  const plan=patchSharedPortfolio(stage,release,{backendOnly:true});
  fs.mkdirSync(path.join(stage,'tests'));fs.copyFileSync(path.join(release,'tests/shared-portfolio.test.mjs'),path.join(stage,'tests/shared-portfolio.test.mjs'));
  for(const p of plan)run(process.execPath,['--check',path.join(stage,p.file)]);
  run(process.execPath,['--test',path.join(stage,'tests/shared-portfolio.test.mjs')]);
  // Verify real installed function declarations that the adapter wraps.
  const server=fs.readFileSync(path.join(stage,'server.mjs'),'utf8');
  for(const name of ['placeLiveMarketBuy','getLiveAccountSnapshot','getDisplayAccountSnapshot'])if(!server.includes('async function '+name+'('))throw Error('Missing reviewed runtime binding '+name);
  const runner=fs.readFileSync(path.join(stage,'lib/futures-short-runner.mjs'),'utf8');
  if(runner.includes('Object.keys(this.state.positions).length>=2'))throw Error('Legacy two-slot guard remains');
  console.log(JSON.stringify({check:'PASSED',policy:'BINANCE_SHARED_THREE_V1',maxPositions:3,changedFiles:plan.filter(p=>p.original!==p.result).map(p=>p.file),exchangeWrites:0}));
  if(mode==='--check')return;
  const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();if(!/^[1-9]\d*$/.test(pid))throw Error('Service must be running');
  const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
  const spotFile=env.BINANCE_LIVE_LOG_FILE||'/var/data/binance-live-actions.json';
  const shortFile=env.BINANCE_FUTURES_SHORT_FILE||spotFile+'.futures-short';
  const checkPending=()=>{for(const [file,isSpot] of [[spotFile+'.pending',true],[shortFile,false]]){if(fs.existsSync(file)){const data=JSON.parse(fs.readFileSync(file,'utf8'));if(isSpot?data:data?.pending)throw Error('Pending order: activation deferred');}}};
  checkPending();
  const backup=fs.mkdtempSync('/root/levi-before-shared-three-');
  const dropin='/etc/systemd/system/levi-binance.service.d/95-shared-portfolio.conf';
  const previousDropin=fs.existsSync(dropin)?fs.readFileSync(dropin):null;
  for(const p of plan)if(p.original!==null){fs.mkdirSync(path.dirname(path.join(backup,p.file)),{recursive:true});fs.copyFileSync(path.join(runtime,p.file),path.join(backup,p.file));}
  let stopped=false,written=false;
  try{
   run('systemctl',['stop','levi-binance']);stopped=true;checkPending();
   for(const p of plan){const file=path.join(runtime,p.file);if((fs.existsSync(file)?fs.readFileSync(file,'utf8'):null)!==p.original)throw Error('Runtime changed during staging: '+p.file);}
   written=true;
   for(const p of plan){const file=path.join(runtime,p.file);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.shared-stage',p.result);fs.renameSync(file+'.shared-stage',file);}
   fs.mkdirSync(path.dirname(dropin),{recursive:true});fs.writeFileSync(dropin,'[Service]\nEnvironment=BINANCE_SHARED_PORTFOLIO_ENABLED=true\n');
   run('systemctl',['daemon-reload']);run('systemctl',['start','levi-binance']);
   let healthy=false;const port=env.PORT||'8080';if(!/^\d+$/.test(port))throw Error('Invalid port');
   for(let i=0;i<20;i++){
    try{const r=await fetch('http://127.0.0.1:'+port+'/api/binance-mode',{signal:AbortSignal.timeout(1500)});const d=await r.json();if(r.ok&&d.allocationPolicy?.version==='BINANCE_SHARED_THREE_V1'&&d.allocationPolicy.maxPositions===3){healthy=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,500));
   }
   if(!healthy)throw Error('Shared policy health verification failed');
   console.log(JSON.stringify({activated:true,policy:'BINANCE_SHARED_THREE_V1',maxPositions:3,backup,positionsResized:false,automaticTransfers:false}));
  }catch(e){
   if(written){run('systemctl',['stop','levi-binance']);for(const p of plan){const file=path.join(runtime,p.file);if(p.original===null)fs.rmSync(file,{force:true});else fs.copyFileSync(path.join(backup,p.file),file);}
    if(previousDropin===null)fs.rmSync(dropin,{force:true});else fs.writeFileSync(dropin,previousDropin);run('systemctl',['daemon-reload']);}
   if(stopped)run('systemctl',['start','levi-binance']);throw e;
  }
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
