import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=process.argv[2];if(!root)throw Error('Pass staged runtime');
const names=['live-equity-allocation','live-buy-allocation','live-allocation-fee-fallback','live-five-slots','live-buy-readiness','confirmed-entry-quality','tradingview-exit-snapshot','live-execution-lock','channel-poc-entry','channel-primary-entry','futures-short','poc-fast-watch'];
const env={...process.env};delete env.NODE_TEST_CONTEXT;
const r=spawnSync(process.execPath,['--test','--test-skip-pattern=^Colmex',...names.map(n=>path.resolve(root,'tests',n+'.test.mjs'))],{env,stdio:'inherit'});if(r.error)throw r.error;process.exit(r.status??1);
