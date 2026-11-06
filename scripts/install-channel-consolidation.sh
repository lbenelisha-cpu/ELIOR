#!/usr/bin/env bash
# Install consolidation entry filters; preserve local integrations and activation flags.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-consolidation.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
# The original SHORT installer has its own source-integration test. It belongs
# to the immutable release; deployed server integrations may legitimately differ.
echo 'Checking original SHORT installer against reviewed release sources.'
if ! node --test "$stage/release/tests/futures-short-installer.test.mjs"; then
 echo 'Release installer tests failed. Installed code and service were not changed.' >&2
 exit 1
fi
cp -a lib "$stage/runtime/lib"
cp server.mjs binance-agent.js regression-trend.js parallel-channel.js "$stage/runtime/"
cp -a "$stage/release/tests" "$stage/release/scripts" "$stage/runtime/"
# Complete the previously authorized SHORT settings update if it is still missing.
# All edits occur in staging; an unknown context exits before stopping the service.
CONSOLIDATION_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const stage=process.env.CONSOLIDATION_STAGE,root=stage+'/runtime';
const marker=fs.readFileSync(root+'/lib/futures-short-policy.mjs','utf8').includes("export const FUTURES_SHORT_EXIT_POLICY='FUTURES_SHORT_SETTINGS_V2'")&&fs.readFileSync(root+'/lib/futures-short-runner.mjs','utf8').includes('exitPolicy:FUTURES_SHORT_EXIT_POLICY')&&fs.readFileSync(root+'/server.mjs','utf8').includes('shortExitPolicy:futuresShort.config.exitPolicy');
if(!marker){
 const {patchShortSettings}=await import(pathToFileURL(stage+'/release/scripts/patch-short-settings-exit.mjs'));
 patchShortSettings(root,JSON.parse(fs.readFileSync(stage+'/release/scripts/short-settings-exit-patches.json','utf8')));
 console.log('Staged the previously requested SHORT settings update.');
}
JS
cp "$stage/release/lib/channel-consolidation.mjs" "$stage/runtime/lib/"
node "$stage/release/scripts/patch-channel-consolidation.mjs" "$stage/runtime"
for file in server.mjs lib/channel-consolidation.mjs lib/channel-primary-entry.mjs lib/wyckoff-evaluation.mjs lib/futures-short-policy.mjs lib/futures-short-runner.mjs; do node --check "$stage/runtime/$file"; done
echo 'Checking trading behavior against the staged installed runtime.'
if ! node --test "$stage/runtime/tests/channel-consolidation.test.mjs" "$stage/runtime/tests/channel-consolidation-entry.test.mjs" "$stage/runtime/tests/futures-short.test.mjs" "$stage/runtime/tests/futures-short-recovery.test.mjs" "$stage/runtime/tests/futures-short-fill.test.mjs"; then
 echo 'Staged consolidation tests failed. Installed code and service were not changed.' >&2
 exit 1
fi
# Read only the running service's path configuration. Do not print its environment.
CONSOLIDATION_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const stage=process.env.CONSOLIDATION_STAGE;
const {validateShortSettings}=await import(pathToFileURL(stage+'/runtime/lib/futures-short-policy.mjs'));
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
if(!/^[1-9]\d*$/.test(pid))throw Error('SERVICE_NOT_RUNNING');
const env=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0');
const value=n=>env.find(x=>x.startsWith(n+'='))?.slice(n.length+1).trim();
const journal=value('BINANCE_FUTURES_SHORT_FILE')||(value('BINANCE_LIVE_LOG_FILE')||'/var/data/binance-live-actions.json')+'.futures-short';
const port=value('PORT')||'8080';if(!/^\d{1,5}$/.test(port))throw Error('INVALID_PORT');
const r=await fetch('http://127.0.0.1:'+port+'/api/binance-mode',{signal:AbortSignal.timeout(5000)});
if(!r.ok)throw Error('SERVICE_READ_FAILED');
const d=await r.json(),keys=['takeProfitPct','stopLossPct','profitActivationPct','trailingGapPp'];
validateShortSettings(Object.fromEntries(keys.map(k=>[k,d.exitSettings?.[k]])));
if(fs.existsSync(journal)&&JSON.parse(fs.readFileSync(journal,'utf8')).pending)throw Error('SHORT_PENDING_ORDER_RETRY_LATER');
const flags=c=>({enabled:c?.enabled,requested:c?.requested,enabledAfter:c?.enabledAfter});
fs.writeFileSync(stage+'/preflight.json',JSON.stringify({journal,port,long:flags(d.channelPrimary),short:flags(d.shortTrading?.policy)}),{mode:0o600});
console.log('SHORT settings validated; configured percentages will be retained.');
JS
files=(server.mjs lib/channel-consolidation.mjs lib/channel-primary-entry.mjs lib/wyckoff-evaluation.mjs lib/futures-short-policy.mjs lib/futures-short-runner.mjs scripts/diagnose-futures-ownership.mjs)
backup="/root/levi-before-consolidation-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
existing=();missing=()
for file in "${files[@]}"; do
 if [[ -f "$file" ]]; then mkdir -p "$backup/$(dirname "$file")"; cp -a "$file" "$backup/$file";existing+=("$file");else missing+=("$file");fi
done
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 for file in "${existing[@]}"; do cp -a "$backup/$file" "$file";done
 for file in "${missing[@]}"; do rm -f "$file";done
 systemctl start levi-binance
 echo "Code restored from $backup. Exchange orders and journals were not rolled back." >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
# Recheck after stopping so an in-flight entry cannot be lost during installation.
CONSOLIDATION_STAGE="$stage" CONSOLIDATION_BACKUP="$backup" node --input-type=module - <<'JS'
import fs from 'node:fs';
const {journal}=JSON.parse(fs.readFileSync(process.env.CONSOLIDATION_STAGE+'/preflight.json','utf8'));
if(fs.existsSync(journal)){
 const s=JSON.parse(fs.readFileSync(journal,'utf8'));
 if(s.pending)throw Error('SHORT_PENDING_ORDER_RETRY_LATER');
 fs.copyFileSync(journal,process.env.CONSOLIDATION_BACKUP+'/futures-journal-snapshot.json');
}
JS
for file in server.mjs lib/channel-consolidation.mjs lib/channel-primary-entry.mjs lib/wyckoff-evaluation.mjs lib/futures-short-policy.mjs lib/futures-short-runner.mjs; do cp "$stage/runtime/$file" "$file";done
mkdir -p scripts
cp "$stage/release/scripts/diagnose-futures-ownership.mjs" scripts/
systemctl start levi-binance
CONSOLIDATION_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
const expected=JSON.parse(fs.readFileSync(process.env.CONSOLIDATION_STAGE+'/preflight.json','utf8')),port=expected.port;
const flags=c=>({enabled:c?.enabled,requested:c?.requested,enabledAfter:c?.enabledAfter});
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:'+port+'/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  if(r.ok&&d.channelPrimary?.consolidationPolicy?.version==='CHANNEL_CONSOLIDATION_V1'&&d.shortTrading?.policy?.consolidationPolicy?.version==='CHANNEL_CONSOLIDATION_V1'&&d.shortTrading?.policy?.exitPolicy==='FUTURES_SHORT_SETTINGS_V2'&&JSON.stringify(flags(d.channelPrimary))===JSON.stringify(expected.long)&&JSON.stringify(flags(d.shortTrading?.policy))===JSON.stringify(expected.short)){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('CONSOLIDATION_POLICY_NOT_VERIFIED');
console.log('Verified LONG/SHORT entry filter: CHANNEL_CONSOLIDATION_V1; activation flags retained');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed and verified $revision. Backup: $backup"
echo 'New channel entries require a matching or central pre-entry consolidation. Existing positions and journals retained.'
echo 'Diagnostic installed: node scripts/diagnose-futures-ownership.mjs BNBUSDT'
