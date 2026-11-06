#!/usr/bin/env bash
# Install a shared watch and independent public-data scanner; preserve trading settings.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-shared-watch.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
# The original SHORT installer has its own source-integration test. It belongs
# to the immutable release; deployed server integrations may legitimately differ.
echo 'Checking SHORT and shared-watch installers against reviewed release sources.'
if ! node --test "$stage/release/tests/futures-short-installer.test.mjs" "$stage/release/tests/shared-watch-installer.test.mjs"; then
 echo 'Release installer tests failed. Installed code and service were not changed.' >&2
 exit 1
fi
cp -a lib "$stage/runtime/lib"
cp server.mjs binance-agent.js regression-trend.js parallel-channel.js "$stage/runtime/"
cp -a "$stage/release/tests" "$stage/release/scripts" "$stage/runtime/"
# Require the owner's already installed consolidation/settings version.
node --input-type=module - "$stage/runtime" <<'JS'
import fs from 'node:fs';
const root=process.argv[2];
if(!fs.readFileSync(root+'/lib/futures-short-policy.mjs','utf8').includes('FUTURES_SHORT_SETTINGS_V2')||!fs.existsSync(root+'/lib/channel-consolidation.mjs'))throw Error('INSTALL_CONFIRMED_CONSOLIDATION_UPDATE_FIRST');
JS
cp "$stage/release/lib/shared-market-watch.mjs" "$stage/runtime/lib/"
if ! node "$stage/release/scripts/patch-shared-market-watch.mjs" "$stage/runtime"; then
 echo 'Shared-watch staging could not identify an integration. See the patch ID above. Installed code and service were not changed.' >&2
 exit 1
fi
for file in server.mjs lib/shared-market-watch.mjs lib/market-attention.mjs lib/futures-short-runner.mjs; do node --check "$stage/runtime/$file"; done
echo 'Checking shared watch and trading protections against staged installed runtime.'
if ! node --test "$stage/runtime/tests/shared-market-watch.test.mjs" "$stage/runtime/tests/futures-short.test.mjs" "$stage/runtime/tests/futures-short-recovery.test.mjs" "$stage/runtime/tests/futures-short-fill.test.mjs" "$stage/runtime/tests/channel-consolidation.test.mjs" "$stage/runtime/tests/channel-consolidation-entry.test.mjs"; then
 echo 'Staged shared-watch tests failed. Installed code and service were not changed.' >&2
 exit 1
fi
# Read only the running service's path configuration. Do not print its environment.
SHARED_WATCH_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const stage=process.env.SHARED_WATCH_STAGE;
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
fs.writeFileSync(stage+'/preflight.json',JSON.stringify({journal,port,long:flags(d.channelPrimary),short:flags(d.shortTrading?.policy),exitSettings:d.exitSettings}),{mode:0o600});
console.log('SHORT settings validated; configured percentages will be retained.');
JS
files=(server.mjs lib/shared-market-watch.mjs lib/market-attention.mjs lib/futures-short-runner.mjs)
backup="/root/levi-before-shared-watch-$(date +%Y%m%d-%H%M%S)-$$"
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
SHARED_WATCH_STAGE="$stage" SHARED_WATCH_BACKUP="$backup" node --input-type=module - <<'JS'
import fs from 'node:fs';
const {journal}=JSON.parse(fs.readFileSync(process.env.SHARED_WATCH_STAGE+'/preflight.json','utf8'));
if(fs.existsSync(journal)){
 const s=JSON.parse(fs.readFileSync(journal,'utf8'));
 if(s.pending)throw Error('SHORT_PENDING_ORDER_RETRY_LATER');
 fs.copyFileSync(journal,process.env.SHARED_WATCH_BACKUP+'/futures-journal-snapshot.json');
}
JS
for file in "${files[@]}"; do cp "$stage/runtime/$file" "$file";done
systemctl start levi-binance
SHARED_WATCH_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
const expected=JSON.parse(fs.readFileSync(process.env.SHARED_WATCH_STAGE+'/preflight.json','utf8')),port=expected.port;
const flags=c=>({enabled:c?.enabled,requested:c?.requested,enabledAfter:c?.enabledAfter});
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:'+port+'/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  if(r.ok&&d.shortTrading?.policy?.sharedWatchPolicy?.version==='SHARED_LONG_SHORT_WATCH_V1'&&JSON.stringify(d.exitSettings)===JSON.stringify(expected.exitSettings)&&d.channelPrimary?.consolidationPolicy?.version==='CHANNEL_CONSOLIDATION_V1'&&d.shortTrading?.policy?.consolidationPolicy?.version==='CHANNEL_CONSOLIDATION_V1'&&d.shortTrading?.policy?.exitPolicy==='FUTURES_SHORT_SETTINGS_V2'&&JSON.stringify(flags(d.channelPrimary))===JSON.stringify(expected.long)&&JSON.stringify(flags(d.shortTrading?.policy))===JSON.stringify(expected.short)){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('SHARED_WATCH_POLICY_NOT_VERIFIED');
console.log('Verified SHARED_LONG_SHORT_WATCH_V1; entry filters, activation flags and exit settings retained');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed and verified $revision. Backup: $backup"
echo 'Refresh the app. Shared LONG/SHORT observation continues while entries are blocked; allow a few minutes for the first scan.'
