#!/usr/bin/env bash
# Install frozen five-wave profit activation; retain configured stop and trailing gap.
# Preserve settings, exchange orders, journals and all unrelated runtime integrations.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-swing-profit.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
cp -a lib "$stage/runtime/lib"
cp ./*.js ./*.mjs "$stage/runtime/"
[ ! -d node_modules ] || ln -s "$PWD/node_modules" "$stage/runtime/node_modules"
cp -a "$stage/release/tests" "$stage/release/scripts" "$stage/runtime/"
cp "$stage/release/tradingview-exit-snapshot.js" "$stage/runtime/"
node "$stage/release/scripts/patch-swing-activation.mjs" "$stage/runtime"
# Binance-only deployments omit the Colmex adapter. Stage it only for shared tests.
if [[ ! -f lib/colmex-position-exit.mjs ]]; then
 cp "$stage/release/lib/colmex-position-exit.mjs" "$stage/runtime/lib/"
fi
node --check "$stage/runtime/lib/swing-profit-protection.mjs"
echo 'Checking five-wave exits against the actual installed runtime.'
if ! node --test "$stage/runtime/tests/swing-profit-protection.test.mjs" "$stage/runtime/tests/futures-short.test.mjs" "$stage/runtime/tests/tradingview-exit-snapshot.test.mjs"; then
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
files=(lib/swing-profit-protection.mjs lib/trailing-profit-exit.mjs lib/futures-short-policy.mjs)
if [[ -f lib/colmex-position-exit.mjs ]]; then files+=(lib/colmex-position-exit.mjs); fi
backup="/root/levi-before-swing-activation-$(date +%Y%m%d-%H%M%S)-$$"
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
  if(r.ok&&d.swingProtectionPolicy==='FIVE_CONFIRMED_SWINGS_V1'){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('SWING_PROTECTION_NOT_VERIFIED');
console.log('Verified five-wave protection for new LONG and SHORT positions');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed and verified $revision. Backup: $backup"
echo 'Existing native targets are reconciled by the runner; this message does not attest exchange acceptance.'
echo 'Five-wave mean now controls activation; hard stop and trailing gap stay configured.'
