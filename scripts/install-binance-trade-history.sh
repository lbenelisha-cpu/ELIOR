#!/usr/bin/env bash
# Install only the read-only history endpoint and display cost correction.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
stage=$(mktemp -d /tmp/levi-history.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib" "$stage/scripts"
files=(server.mjs lib/binance-trade-history.mjs lib/wyckoff-live-positions.mjs scripts/verify-binance-history.mjs)
existing=(); missing=()
for file in "${files[@]}"; do
  git show "$revision:$file" > "$stage/$file"
  node --check "$stage/$file"
  if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi
done
STAGED_HISTORY="$stage/lib/binance-trade-history.mjs" node --input-type=module - <<'JS'
const {buildTradeHistory}=await import(process.env.STAGED_HISTORY);
const fill=(id,isBuyer,price)=>({symbol:'TESTUSDT',id,orderId:id,time:1700000000000+id,isBuyer,price,qty:1,quoteQty:price,commission:0,commissionAsset:'USDT'});
if(buildTradeHistory('TESTUSDT',[fill(1,true,100),fill(2,false,110)]).rows[0].netPnlUsdt!==10)throw Error('History smoke failed');
JS
backup="/root/levi-before-history-$(date +%Y%m%d-%H%M%S).tgz"
tar -czf "$backup" "${existing[@]}"
rollback() {
  trap - ERR
  systemctl stop levi-binance
  tar -xzf "$backup" -C /opt/levi-binance
  for file in "${missing[@]}"; do rm -f -- "$file"; done
  systemctl start levi-binance
  echo "Verification failed; code restored from $backup" >&2
  exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
systemctl start levi-binance
node --input-type=module - <<'JS'
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
let ready=false;
for(let i=0;i<15;i++){
 try{
  const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)});
  if(r.ok){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Service did not become ready');
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
const raw=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0');
const token=raw.find(x=>x.startsWith('BINANCE_CONTROL_TOKEN='))?.slice('BINANCE_CONTROL_TOKEN='.length);
if(!token)throw Error('Existing control authorization unavailable');
const url='http://127.0.0.1:8080/api/binance-trade-history?symbol=invalid';
const denied=await fetch(url);if(denied.status!==401)throw Error('Private history must reject unauthenticated requests');
const authorized=await fetch(url,{headers:{Authorization:'Bearer '+token}});
if(authorized.status!==400)throw Error('Authenticated history route not ready');
console.log('Verified: private read-only history endpoint is ready. No trading endpoint called.');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Backup: $backup"
