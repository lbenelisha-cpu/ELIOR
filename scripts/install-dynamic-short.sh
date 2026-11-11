#!/usr/bin/env bash
# Dynamic two-slot Futures allocation and verified cancel-race reconciliation.
# Preserve settings, exchange orders, journals and all unrelated runtime integrations.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-dynamic-short.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
cp -a lib "$stage/runtime/lib"
cp ./*.js ./*.mjs "$stage/runtime/"
cp -a "$stage/release/tests" "$stage/release/scripts" "$stage/runtime/"
node "$stage/release/scripts/patch-dynamic-short.mjs" "$stage/runtime"
node --check "$stage/runtime/lib/futures-short-runner.mjs"
echo 'Checking dynamic SHORT allocation and cancellation against the installed runtime.'
if ! node --test "$stage/runtime/tests/futures-short.test.mjs" "$stage/runtime/tests/binance-poc.test.mjs" "$stage/runtime/tests/futures-short-recovery.test.mjs" "$stage/runtime/tests/futures-short-fill.test.mjs"; then
 echo 'Staged tests failed. Installed code and service were not changed.' >&2
 exit 1
fi
# Read only the running service's path configuration. Do not print its environment.
SHORT_SETTINGS_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const stage=process.env.SHORT_SETTINGS_STAGE;
const {assertNoPendingEntry}=await import(pathToFileURL(stage+'/release/scripts/assert-no-pending-entry.mjs'));
const {validateShortSettings}=await import(pathToFileURL(stage+'/runtime/lib/futures-short-policy.mjs'));
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
if(!/^[1-9]\d*$/.test(pid))throw Error('SERVICE_NOT_RUNNING');
const env=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0');
const value=n=>env.find(x=>x.startsWith(n+'='))?.slice(n.length+1).trim();
const journal=value('BINANCE_FUTURES_SHORT_FILE')||(value('BINANCE_LIVE_LOG_FILE')||'/var/data/binance-live-actions.json')+'.futures-short';
const spotPending=(value('BINANCE_LIVE_LOG_FILE')||'/var/data/binance-live-actions.json')+'.pending';
const port=value('PORT')||'8080';if(!/^\d{1,5}$/.test(port))throw Error('INVALID_PORT');
const r=await fetch('http://127.0.0.1:'+port+'/api/binance-mode',{signal:AbortSignal.timeout(5000)});
if(!r.ok)throw Error('SERVICE_READ_FAILED');
const d=await r.json(),keys=['takeProfitPct','stopLossPct','profitActivationPct','trailingGapPp'];
validateShortSettings(Object.fromEntries(keys.map(k=>[k,d.exitSettings?.[k]])));
assertNoPendingEntry({spotPending,journal});
fs.writeFileSync(stage+'/preflight.json',JSON.stringify({journal,spotPending,port}),{mode:0o600});
console.log('SHORT settings validated; configured percentages will be retained.');
JS
files=(lib/futures-short-policy.mjs lib/futures-short-runner.mjs lib/binance-poc.mjs server.mjs)
backup="/root/levi-before-dynamic-short-$(date +%Y%m%d-%H%M%S)-$$"
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
SHORT_SETTINGS_STAGE="$stage" SHORT_SETTINGS_BACKUP="$backup" node --input-type=module - <<'JS'
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {assertNoPendingEntry}=await import(pathToFileURL(process.env.SHORT_SETTINGS_STAGE+'/release/scripts/assert-no-pending-entry.mjs'));
const {journal,spotPending}=JSON.parse(fs.readFileSync(process.env.SHORT_SETTINGS_STAGE+'/preflight.json','utf8'));
assertNoPendingEntry({spotPending,journal});
if(fs.existsSync(journal)){
 const s=JSON.parse(fs.readFileSync(journal,'utf8'));
 if(s.pending)throw Error('SHORT_PENDING_ORDER_RETRY_LATER');
 fs.copyFileSync(journal,process.env.SHORT_SETTINGS_BACKUP+'/futures-journal-snapshot.json');
}
JS
for file in "${files[@]}"; do cp "$stage/runtime/$file" "$file";done
systemctl start levi-binance
SHORT_SETTINGS_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
const {port}=JSON.parse(fs.readFileSync(process.env.SHORT_SETTINGS_STAGE+'/preflight.json','utf8'));
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:'+port+'/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  if(r.ok&&d.shortTrading?.policy?.allocationPolicy==='FUTURES_WALLET_HALF_V1'&&d.shortTrading?.policy?.maxPositions===2&&d.futuresManualTrading?.allocationPolicy==='FUTURES_WALLET_HALF_V1'){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('SHORT_ALLOCATION_POLICY_NOT_VERIFIED');
console.log('Verified dynamic two-slot Futures policy: FUTURES_WALLET_HALF_V1');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed and verified $revision. Backup: $backup"
echo 'Existing native targets are reconciled by the runner; this message does not attest exchange acceptance.'
echo 'Dynamic SHORT allocation installed; existing exits, journals and native orders retained.'
