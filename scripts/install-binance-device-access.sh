#!/usr/bin/env bash
# Invoked through the owner's existing SSH terminal. Never submits a trade.
set -euo pipefail
revision=${1:?Pass the reviewed commit SHA}
cd /opt/levi-binance
stage=$(mktemp -d /tmp/levi-device-access.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib" "$stage/scripts"
for file in server.mjs lib/binance-manual-trades.mjs lib/live-buy-allocation.mjs lib/live-execution-lock.mjs lib/binance-quality-policy.mjs lib/binance-hourly-trend.mjs lib/binance-device-auth.mjs scripts/binance-device-pair.mjs; do
  git show "$revision:$file" > "$stage/$file"
  node --check "$stage/$file"
done
# Check all relative top-level server imports without starting the trading process.
node --input-type=module - "$stage" <<'JS'
import fs from 'node:fs';import path from 'node:path';
const stage=process.argv[2],source=fs.readFileSync(path.join(stage,'server.mjs'),'utf8');
for(const [,relative] of source.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)){
 if(!fs.existsSync(path.join(stage,relative))&&!fs.existsSync(path.resolve(relative)))throw Error('Missing existing server dependency: '+relative);
}
const policy=await import(path.resolve('lib/binance-position-exit.mjs'));
if(!policy.SPRING_EXIT_POLICY||!policy.MINIMUM_PROFIT_HOLD_MS)throw Error('Existing Binance exit policy is missing; no files installed');
JS
backup="/root/levi-before-device-access-$(date +%Y%m%d-%H%M%S).tgz"
tar -czf "$backup" server.mjs lib
cp "$stage/lib/binance-manual-trades.mjs" lib/binance-manual-trades.mjs
cp "$stage/lib/live-buy-allocation.mjs" lib/live-buy-allocation.mjs
cp "$stage/lib/live-execution-lock.mjs" lib/live-execution-lock.mjs
cp "$stage/lib/binance-quality-policy.mjs" lib/binance-quality-policy.mjs
cp "$stage/lib/binance-hourly-trend.mjs" lib/binance-hourly-trend.mjs
cp "$stage/lib/binance-device-auth.mjs" lib/binance-device-auth.mjs
mkdir -p scripts
cp "$stage/scripts/binance-device-pair.mjs" scripts/binance-device-pair.mjs
cp "$stage/server.mjs" server.mjs
if ! systemctl restart levi-binance; then
  tar -xzf "$backup" -C /opt/levi-binance
  systemctl restart levi-binance
  exit 1
fi
sleep 2
if ! systemctl is-active --quiet levi-binance || ! node --input-type=module - <<'JS'
const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(10000)}),data=await r.json();
if(!r.ok||data.manualTrading?.version!==1||data.hourlyTrendFilter?.enabled!==true||data.hourlyTrendFilter.fastSma!==20||data.hourlyTrendFilter.slowSma!==50||data.deviceAuth?.version!==1||data.deviceAuth?.enabled!==true)throw Error('Hourly trend capability did not start');
console.log('Device trading access ready. No manual trade was submitted by this installer.');
JS
then
  tar -xzf "$backup" -C /opt/levi-binance
  systemctl restart levi-binance
  echo "Startup verification failed; previous code restored from $backup" >&2
  exit 1
fi
systemctl is-active levi-binance
node scripts/binance-device-pair.mjs
