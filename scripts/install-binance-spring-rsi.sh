#!/usr/bin/env bash
# Run in the existing owner SSH session; this installer never submits an order.
set -euo pipefail
revision=${1:?Pass the reviewed commit SHA}
cd /opt/levi-binance
stage=$(mktemp -d /tmp/levi-spring-rsi.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib"
files=(server.mjs lib/wyckoff-spring-rsi.mjs lib/wyckoff-evaluation.mjs lib/wyckoff-strategy.mjs lib/wyckoff-live-confirmation.mjs lib/binance-position-exit.mjs lib/binance-demo-trader.mjs lib/binance-quality-policy.mjs lib/binance-hourly-trend.mjs lib/binance-market-watch.mjs)
for file in "${files[@]}"; do
  git show "$revision:$file" > "$stage/$file"
  node --check "$stage/$file"
done
backup="/root/levi-before-spring-rsi-$(date +%Y%m%d-%H%M%S).tgz"
tar -czf "$backup" server.mjs lib
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
rollback() {
  tar -xzf "$backup" -C /opt/levi-binance
  systemctl restart levi-binance
  echo "Startup verification failed; restored $backup" >&2
  exit 1
}
systemctl restart levi-binance || rollback
sleep 2
systemctl is-active --quiet levi-binance || rollback
node --input-type=module - <<'JS' || rollback
const response=await fetch('http://127.0.0.1:8080/api/binance-agent',{signal:AbortSignal.timeout(15000)});
const data=await response.json();
if(!response.ok||data.config?.entryMode!=='spring_rsi_live'||data.config.entryRsi?.includesOpenCandle!==true)throw Error('New entry policy is not active');
console.log('Live Spring + RSI14 0–30 enabled; no candle-close wait. Existing execution limits and exits retained.');
JS
systemctl is-active levi-binance
