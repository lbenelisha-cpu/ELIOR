#!/usr/bin/env bash
# Run in the existing owner SSH session; this installer never submits an order.
set -euo pipefail
revision=${1:?Pass the reviewed commit SHA}
cd /opt/levi-binance
stage=$(mktemp -d /tmp/levi-read-speed.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib"
files=(server.mjs lib/binance-chart-reader.mjs)
for file in "${files[@]}"; do
  git show "$revision:$file" > "$stage/$file"
  node --check "$stage/$file"
done
backup="/root/levi-before-read-speed-$(date +%Y%m%d-%H%M%S).tgz"
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
if(!response.ok||data.config?.readPerformanceVersion!==1)throw Error('New entry policy is not active');
console.log('Fast chart reads and shared display snapshots active. No order submitted by installer.');
JS
systemctl is-active levi-binance
