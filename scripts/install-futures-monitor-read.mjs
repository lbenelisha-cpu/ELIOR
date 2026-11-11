import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const file='lib/futures-short-api.mjs',before=fs.readFileSync(file,'utf8');
const line=before.split('\n').find(x=>x.startsWith('const reads=new Set('));
if(!line||!line.includes("'/fapi/v2/account'"))throw Error('UNRECOGNIZED_READ_ALLOWLIST');
if(!line.includes("'/fapi/v2/positionRisk'")){
 const after=before.replace(line,line.replace("'/fapi/v2/account'","'/fapi/v2/account','/fapi/v2/positionRisk'"));
 const staged=file+'.monitor-stage.mjs';fs.writeFileSync(staged,after);execFileSync(process.execPath,['--check',staged]);
 const backup='/root/futures-api-before-monitor-'+Date.now()+'.mjs';fs.copyFileSync(file,backup);fs.renameSync(staged,file);console.log('Updated GET position-risk read; backup: '+backup);
}else console.log('Position-risk GET already enabled');
