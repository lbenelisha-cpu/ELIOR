#!/usr/bin/env bash
# Prioritize prepared POC returns without changing entry conditions or protection settings.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-poc-fast-watch.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
echo 'Checking fast-watch installer and preservation of local execution integrations.'
node --test "$stage/release/tests/poc-fast-installer.test.mjs"
cp -a "$stage/release/." "$stage/runtime/"
cp -a lib/. "$stage/runtime/lib/"
cp server.mjs binance-agent.js regression-trend.js parallel-channel.js "$stage/runtime/"
if ! node "$stage/release/scripts/patch-poc-fast-watch.mjs" "$stage/runtime"; then
 echo 'POC fast-watch staging failed. Installed code and service were not changed.' >&2
 exit 1
fi
ln -s /opt/levi-binance/node_modules "$stage/runtime/node_modules"
files=(server.mjs lib/poc-fast-watch.mjs lib/wyckoff-five-minute-data.mjs lib/futures-short-runner.mjs)
for file in "${files[@]}"; do node --check "$stage/runtime/$file"; done
echo 'Checking behavior against the staged installed runtime, including local server integrations.'
if ! node "$stage/release/scripts/test-poc-fast-runtime.mjs" "$stage/runtime"; then
 echo 'Staged POC fast-watch tests failed. Installed code and service were not changed.' >&2
 exit 1
fi
# Read only the running service's path configuration. Do not print its environment.
POC_FAST_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const stage=process.env.POC_FAST_STAGE;
const {validateShortSettings}=await import(pathToFileURL(stage+'/runtime/lib/futures-short-policy.mjs'));
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
if(!/^[1-9]\d*$/.test(pid))throw Error('SERVICE_NOT_RUNNING');
const env=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0');
const value=n=>env.find(x=>x.startsWith(n+'='))?.slice(n.length+1).trim();
const journal=value('BINANCE_FUTURES_SHORT_FILE')||(value('BINANCE_LIVE_LOG_FILE')||'/var/data/binance-live-actions.json')+'.futures-short';
const spotJournal=value('BINANCE_LIVE_LOG_FILE')||'/var/data/binance-live-actions.json';
const port=value('PORT')||'8080';if(!/^\d{1,5}$/.test(port))throw Error('INVALID_PORT');
const r=await fetch('http://127.0.0.1:'+port+'/api/binance-mode',{signal:AbortSignal.timeout(5000)});
if(!r.ok)throw Error('SERVICE_READ_FAILED');
const d=await r.json(),keys=['takeProfitPct','stopLossPct','profitActivationPct','trailingGapPp'];
validateShortSettings(Object.fromEntries(keys.map(k=>[k,d.exitSettings?.[k]])));
if(fs.existsSync(journal)&&JSON.parse(fs.readFileSync(journal,'utf8')).pending)throw Error('SHORT_PENDING_ORDER_RETRY_LATER');
if(fs.existsSync(spotJournal)&&JSON.parse(fs.readFileSync(spotJournal,'utf8')).pending)throw Error('SPOT_PENDING_ORDER_RETRY_LATER');
const flags=c=>({enabled:c?.enabled,requested:c?.requested,enabledAfter:c?.enabledAfter});
fs.writeFileSync(stage+'/preflight.json',JSON.stringify({journal,spotJournal,port,long:flags(d.channelPrimary),short:flags(d.shortTrading?.policy),shortEntryMode:d.shortTrading?.policy?.entryMode??null,exitSettings:d.exitSettings}),{mode:0o600});
console.log('Existing settings recorded; activation flags and risk parameters will be retained.');
JS
backup="/root/levi-before-poc-fast-watch-$(date +%Y%m%d-%H%M%S)-$$"
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
POC_FAST_STAGE="$stage" POC_FAST_BACKUP="$backup" node --input-type=module - <<'JS'
import fs from 'node:fs';
const {journal,spotJournal}=JSON.parse(fs.readFileSync(process.env.POC_FAST_STAGE+'/preflight.json','utf8'));
if(fs.existsSync(spotJournal)&&JSON.parse(fs.readFileSync(spotJournal,'utf8')).pending)throw Error('SPOT_PENDING_ORDER_RETRY_LATER');
if(fs.existsSync(journal)){
 const s=JSON.parse(fs.readFileSync(journal,'utf8'));
 if(s.pending)throw Error('SHORT_PENDING_ORDER_RETRY_LATER');
 fs.copyFileSync(journal,process.env.POC_FAST_BACKUP+'/futures-journal-snapshot.json');
}
JS
for file in "${files[@]}"; do cp "$stage/runtime/$file" "$file";done
systemctl start levi-binance
POC_FAST_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
const expected=JSON.parse(fs.readFileSync(process.env.POC_FAST_STAGE+'/preflight.json','utf8')),port=expected.port;
const flags=c=>({enabled:c?.enabled,requested:c?.requested,enabledAfter:c?.enabledAfter});
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:'+port+'/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  if(r.ok&&d.pocFastWatch?.policy?.version==='POC_FAST_WATCH_V1'&&d.channelPrimary?.conditionReportVersion==='CHANNEL_POC_CONDITIONS_V1'&&d.shortTrading?.policy?.conditionReportVersion==='CHANNEL_POC_CONDITIONS_V1'&&JSON.stringify(d.exitSettings)===JSON.stringify(expected.exitSettings)&&d.channelPrimary?.consolidationPolicy?.version==='CHANNEL_INITIAL_CONSOLIDATION_V2'&&d.shortTrading?.policy?.consolidationPolicy?.version==='CHANNEL_INITIAL_CONSOLIDATION_V2'&&d.shortTrading?.policy?.exitPolicy==='FUTURES_SHORT_SETTINGS_V2'&&JSON.stringify(flags(d.channelPrimary))===JSON.stringify(expected.long)&&JSON.stringify(flags(d.shortTrading?.policy))===JSON.stringify(expected.short)&&(d.shortTrading?.policy?.entryMode??null)===expected.shortEntryMode){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('POC_FAST_WATCH_NOT_VERIFIED');
console.log('Verified POC_FAST_WATCH_V1 for prepared candidates; four entry conditions, activation flags, SHORT mode and exit settings retained');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed and verified POC fast watch at $revision. Backup: $backup"
echo 'Four entry conditions: confirmed channel, initial consolidation, breakout, return to frozen POC. Settings, existing protections and journals retained.'
