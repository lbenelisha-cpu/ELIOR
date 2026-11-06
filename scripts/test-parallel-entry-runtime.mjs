// One shared suite for the deployed staging directory and historical-layout tests.
// Installer reconstruction belongs to the pristine release and runs separately.
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.argv[2];
if(!root)throw Error('Pass the staged runtime directory');
const names=['channel-entry-checklist','market-attention-ui','shared-market-watch',
 'market-attention','channel-primary-entry','futures-short','futures-short-recovery',
 'futures-short-fill','channel-consolidation','channel-consolidation-entry','live-execution-lock'];
const env={...process.env};delete env.NODE_TEST_CONTEXT;
const run=spawnSync(process.execPath,['--test','--test-skip-pattern=^Colmex',
 ...names.map(name=>path.resolve(root,'tests',name+'.test.mjs'))],{env,stdio:'inherit'});
if(run.error)throw run.error;
process.exit(run.status??1);
