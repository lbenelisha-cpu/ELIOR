#!/usr/bin/env bash
# Stage independent condition evaluation without replacing local server/protection integrations.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-channel-poc.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
echo 'Checking POC installer atomicity and reviewed runtime variants.'
node --test "$stage/release/tests/channel-poc-installer.test.mjs"
cp -a "$stage/release/." "$stage/runtime/"
cp -a lib/. "$stage/runtime/lib/"
cp server.mjs binance-agent.js regression-trend.js parallel-channel.js "$stage/runtime/"
if ! node "$stage/release/scripts/patch-channel-poc.mjs" "$stage/runtime"; then
 echo 'Channel-POC staging failed. Installed code and service were not changed.' >&2
 exit 1
fi
ln -s /opt/levi-binance/node_modules "$stage/runtime/node_modules"
files=(channel-poc-model.js lib/channel-poc-entry.mjs lib/channel-primary-entry.mjs lib/futures-short-policy.mjs lib/channel-profit-protection.mjs lib/wyckoff-evaluation.mjs lib/confirmed-risk-sizing.mjs)
for file in "${files[@]}"; do node --check "$stage/runtime/$file"; done
echo 'Checking behavior against the staged installed runtime, including local server integrations.'
if ! node "$stage/release/scripts/test-channel-poc-runtime.mjs" "$stage/runtime"; then
 echo 'Staged channel-POC tests failed. Installed code and service were not changed.' >&2
 exit 1
fi
# Read only the running service's path configuration. Do not print its environment.
CHANNEL_POC_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const stage=process.env.CHANNEL_POC_STAGE;
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
fs.writeFileSync(stage+'/preflight.json',JSON.stringify({journal,spotJournal,port,long:flags(d.channelPrimary),short:flags(d.shortTrading?.policy),exitSettings:d.exitSettings}),{mode:0o600});
console.log('Existing settings recorded; activation flags and risk parameters will be retained.');
JS
backup="/root/levi-before-channel-poc-$(date +%Y%m%d-%H%M%S)-$$"
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
CHANNEL_POC_STAGE="$stage" CHANNEL_POC_BACKUP="$backup" node --input-type=module - <<'JS'
import fs from 'node:fs';
const {journal,spotJournal}=JSON.parse(fs.readFileSync(process.env.CHANNEL_POC_STAGE+'/preflight.json','utf8'));
if(fs.existsSync(spotJournal)&&JSON.parse(fs.readFileSync(spotJournal,'utf8')).pending)throw Error('SPOT_PENDING_ORDER_RETRY_LATER');
if(fs.existsSync(journal)){
 const s=JSON.parse(fs.readFileSync(journal,'utf8'));
 if(s.pending)throw Error('SHORT_PENDING_ORDER_RETRY_LATER');
 fs.copyFileSync(journal,process.env.CHANNEL_POC_BACKUP+'/futures-journal-snapshot.json');
}
JS
for file in "${files[@]}"; do cp "$stage/runtime/$file" "$file";done
systemctl start levi-binance
CHANNEL_POC_STAGE="$stage" node --input-type=module - <<'JS'
import fs from 'node:fs';
const expected=JSON.parse(fs.readFileSync(process.env.CHANNEL_POC_STAGE+'/preflight.json','utf8')),port=expected.port;
const flags=c=>({enabled:c?.enabled,requested:c?.requested,enabledAfter:c?.enabledAfter});
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:'+port+'/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  if(r.ok&&d.channelPrimary?.conditionReportVersion==='CHANNEL_POC_CONDITIONS_V1'&&d.shortTrading?.policy?.conditionReportVersion==='CHANNEL_POC_CONDITIONS_V1'&&JSON.stringify(d.exitSettings)===JSON.stringify(expected.exitSettings)&&d.channelPrimary?.consolidationPolicy?.version==='CHANNEL_INITIAL_CONSOLIDATION_V2'&&d.shortTrading?.policy?.consolidationPolicy?.version==='CHANNEL_INITIAL_CONSOLIDATION_V2'&&d.shortTrading?.policy?.exitPolicy==='FUTURES_SHORT_SETTINGS_V2'&&JSON.stringify(flags(d.channelPrimary))===JSON.stringify(expected.long)&&JSON.stringify(flags(d.shortTrading?.policy))===JSON.stringify(expected.short)){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('CHANNEL_POC_POLICY_NOT_VERIFIED');
console.log('Verified CHANNEL_POC_CONDITIONS_V1 for LONG and SHORT; activation flags and exit settings retained');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed and verified channel / POC entry at $revision. Backup: $backup"
echo 'Four entry conditions: confirmed channel, initial consolidation, breakout, return to frozen POC. Settings, existing protections and journals retained.'
