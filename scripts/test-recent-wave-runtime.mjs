import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=process.argv[2];if(!root)throw Error('Pass staged runtime');
const names=['poc-recent-wave','tradingview-exit-snapshot','poc-fast-watch','futures-poc-fast','channel-poc-entry','channel-primary-entry','futures-short','futures-short-recovery','futures-short-fill','live-execution-lock'];
const env={...process.env};delete env.NODE_TEST_CONTEXT;
const r=spawnSync(process.execPath,['--test','--test-skip-pattern=^Colmex',...names.map(n=>path.resolve(root,'tests',n+'.test.mjs'))],{env,stdio:'inherit'});if(r.error)throw r.error;process.exit(r.status??1);
