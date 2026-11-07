#!/usr/bin/env bash
# Allocate future Spot entries from current equity divided by five; preserve existing positions.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-current-equity.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
echo 'Checking current-equity installer and preservation of local execution integrations.'
node --test "$stage/release/tests/current-equity-installer.test.mjs"
cp -a "$stage/release/." "$stage/runtime/"
cp -a lib/. "$stage/runtime/lib/"
cp server.mjs binance-agent.js regression-trend.js parallel-channel.js "$stage/runtime/"
mapfile -t files < <(node --input-type=module -e "import {equityAllocationFiles} from '$stage/release/scripts/patch-current-equity-allocation.mjs'; console.log(equityAllocationFiles.join('\n'))")
for file in "${files[@]}"; do if [[ -f "$file" ]]; then mkdir -p "$stage/runtime/$(dirname "$file")"; cp "$file" "$stage/runtime/$file"; fi; done
if ! node "$stage/release/scripts/patch-current-equity-allocation.mjs" "$stage/runtime"; then
 echo 'Current-equity staging failed. Installed code and service were not changed.' >&2
 exit 1
fi
ln -s /opt/levi-binance/node_modules "$stage/runtime/node_modules"
for file in "${files[@]}"; do if [[ "$file" == *.js || "$file" == *.mjs ]]; then node --check "$stage/runtime/$file"; fi; done
echo 'Checking behavior against the staged installed runtime, including local server integrations.'
if ! node "$stage/release/scripts/test-current-equity-runtime.mjs" "$stage/runtime"; then
 echo 'Staged current-equity tests failed. Installed code and service were not changed.' >&2
 exit 1
fi
# Read only the running service's path configuration. Do not print its environment.
EQUITY_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const stage=process.env.EQUITY_STAGE;
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
const flags=c=>({enabled:c?.enabled,requested:c?.requested,enabledAfter:c?.enabledAfter});
fs.writeFileSync(stage+'/preflight.json',JSON.stringify({journal,spotPending,port,long:flags(d.channelPrimary),short:flags(d.shortTrading?.policy),shortEntryMode:d.shortTrading?.policy?.entryMode??null,exitSettings:d.exitSettings}),{mode:0o600});
console.log('Existing settings recorded; activation flags and risk parameters will be retained.');
JS
backup="/root/levi-before-current-equity-$(date +%Y%m%d-%H%M%S)-$$"
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
EQUITY_STAGE="$stage" EQUITY_BACKUP="$backup" node --input-type=module - <<'JS'
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {assertNoPendingEntry}=await import(pathToFileURL(process.env.EQUITY_STAGE+'/release/scripts/assert-no-pending-entry.mjs'));
const {journal,spotPending}=JSON.parse(fs.readFileSync(process.env.EQUITY_STAGE+'/preflight.json','utf8'));
assertNoPendingEntry({spotPending,journal});
if(fs.existsSync(journal)){
 const s=JSON.parse(fs.readFileSync(journal,'utf8'));
 if(s.pending)throw Error('SHORT_PENDING_ORDER_RETRY_LATER');
 fs.copyFileSync(journal,process.env.EQUITY_BACKUP+'/futures-journal-snapshot.json');
}
JS
for file in "${files[@]}"; do mkdir -p "$(dirname "$file")"; cp "$stage/runtime/$file" "$file";done
systemctl start levi-binance
EQUITY_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
const expected=JSON.parse(fs.readFileSync(process.env.EQUITY_STAGE+'/preflight.json','utf8')),port=expected.port;
const flags=c=>({enabled:c?.enabled,requested:c?.requested,enabledAfter:c?.enabledAfter});
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:'+port+'/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  if(r.ok&&d.allocationPolicy?.version==='CURRENT_EQUITY_EQUAL_FIVE_V1'&&d.allocationPolicy?.basis==='CURRENT_SPOT_EQUITY'&&d.allocationPolicy?.maxPositions===5&&d.allocationPolicy?.lastSlot==='EQUAL'&&d.allocationPolicy?.feeReserveMultiplier===1.002&&d.pocFastWatch?.policy?.version==='POC_FAST_WATCH_V1'&&d.channelPrimary?.anchorPolicy==='RECENT_WAVE_POC_V2'&&d.shortTrading?.policy?.anchorPolicy==='RECENT_WAVE_POC_V2'&&d.channelPrimary?.conditionReportVersion==='CHANNEL_POC_CONDITIONS_V1'&&d.shortTrading?.policy?.conditionReportVersion==='CHANNEL_POC_CONDITIONS_V1'&&JSON.stringify(d.exitSettings)===JSON.stringify(expected.exitSettings)&&d.channelPrimary?.consolidationPolicy?.version==='CHANNEL_INITIAL_CONSOLIDATION_V2'&&d.shortTrading?.policy?.consolidationPolicy?.version==='CHANNEL_INITIAL_CONSOLIDATION_V2'&&d.shortTrading?.policy?.exitPolicy==='FUTURES_SHORT_SETTINGS_V2'&&JSON.stringify(flags(d.channelPrimary))===JSON.stringify(expected.long)&&JSON.stringify(flags(d.shortTrading?.policy))===JSON.stringify(expected.short)&&(d.shortTrading?.policy?.entryMode??null)===expected.shortEntryMode){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('CURRENT_EQUITY_NOT_VERIFIED');
console.log('Verified current Spot equity / 5 with fee reserve; entry policies, activation flags, SHORT mode and exit settings retained');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed and verified current-equity allocation at $revision. Backup: $backup"
echo 'New automatic Spot entries use current Spot equity / 5, reserving fees. Existing positions are not enlarged; protections and journals retained.'
