#!/usr/bin/env bash
# Install a pinned, reviewed code revision. Verification uses no trading calls.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full commit SHA' >&2; exit 1; }
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
stage=$(mktemp -d /tmp/levi-wave-trail5.XXXXXX)
trap 'rm -rf "$stage"' EXIT
cp -a lib "$stage/lib"
files=(server.mjs lib/early-wave-entry.mjs lib/trade-settings.mjs lib/trailing-profit-exit.mjs lib/binance-position-exit.mjs lib/wyckoff-evaluation.mjs lib/binance-quality-policy.mjs lib/binance-market-watch.mjs lib/binance-demo-trader.mjs lib/binance-manual-trades.mjs lib/wyckoff-live-positions.mjs)
existing=()
missing=()
for file in "${files[@]}"; do
  git show "$revision:$file" > "$stage/$file"
  node --check "$stage/$file"
  if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi
done
STAGED_LIB="$stage/lib" node --input-type=module - <<'JS'
const {applyTrailingExitPolicy}=await import(process.env.STAGED_LIB+'/trailing-profit-exit.mjs');
const {binancePositionExit}=await import(process.env.STAGED_LIB+'/binance-position-exit.mjs');
const {EARLY_WAVE_POLICY}=await import(process.env.STAGED_LIB+'/early-wave-entry.mjs');
const p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:100,peakPrice:100});
if(binancePositionExit(p,105).sell||p.effectiveStopPrice!==104||!EARLY_WAVE_POLICY.enabled)throw Error('Staged policy smoke failed');
if(!binancePositionExit(p,104).sell)throw Error('Staged trailing exit failed');
JS
backup="/root/levi-before-wave-trail5-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$backup"
tar -czf "$backup/code.tgz" "${existing[@]}"
# Read only the configured settings path from the existing service environment.
# No key, secret, token or raw environment is emitted or copied into this backup.
service_pid=$(systemctl show levi-binance -p MainPID --value)
SERVICE_PID="$service_pid" BACKUP_DIR="$backup" node --input-type=module - <<'JS'
import fs from 'node:fs';
const env=fs.readFileSync('/proc/'+process.env.SERVICE_PID+'/environ','utf8').split('\0');
const file=env.find(x=>x.startsWith('BINANCE_SETTINGS_FILE='))?.slice('BINANCE_SETTINGS_FILE='.length)||'/var/data/binance-trade-settings.json';
const exists=fs.existsSync(file),dir=process.env.BACKUP_DIR;
fs.writeFileSync(dir+'/settings-location.json',JSON.stringify({file,exists}),{mode:0o600});
if(exists)fs.copyFileSync(file,dir+'/settings.json');
JS
rollback() {
  trap - ERR
  systemctl stop levi-binance
  tar -xzf "$backup/code.tgz" -C /opt/levi-binance
  for file in "${missing[@]}"; do rm -f -- "$file"; done
  BACKUP_DIR="$backup" node --input-type=module - <<'JS'
import fs from 'node:fs';
const dir=process.env.BACKUP_DIR,{file,exists}=JSON.parse(fs.readFileSync(dir+'/settings-location.json','utf8'));
if(exists){fs.copyFileSync(dir+'/settings.json',file);fs.chmodSync(file,0o600);}else fs.rmSync(file,{force:true});
JS
  systemctl start levi-binance
  echo "Update verification failed; restored $backup" >&2
  exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
systemctl start levi-binance
node --input-type=module - <<'JS'
let verified=false;
for(let attempt=0;attempt<15;attempt++){
 try{
  const response=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)});
  const data=await response.json();
  if(response.ok&&data.entryRsi?.max===40&&data.hourlyTrendFilter?.enabled===false&&data.earlyWave?.enabled===true&&
     data.exitSettings?.profitActivationPct===5&&data.exitSettings?.trailingGapPp===1&&data.shortTrading?.enabled===false&&
     data.entryPolicyVersion==='SPRING_RSI40_EARLY_WAVE_TRAIL5_V8'){verified=true;break;}
 }catch{}
 await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!verified)throw Error('Live policy verification failed');
console.log('Verified: early-wave entry enabled; RSI40 Spring; activation 5%, gap 1pp; Spot LONG only.');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Backup: $backup"
