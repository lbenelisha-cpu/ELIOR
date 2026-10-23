#!/usr/bin/env bash
# No trade endpoint is called. Preserve the complete pre-migration journal.
set -euo pipefail
revision=${1:?Pass the reviewed commit SHA}
cd /opt/levi-binance
stage=$(mktemp -d /tmp/levi-history-speed.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib"
files=(server.mjs lib/decision-chart-history.mjs lib/decision-history-writer.mjs)
for file in "${files[@]}"; do
  git show "$revision:$file" > "$stage/$file"
  node --check "$stage/$file"
done
stamp=$(date +%Y%m%d-%H%M%S)
backup="/root/levi-before-history-speed-$stamp.tgz"
tar -czf "$backup" server.mjs lib
# Default production journal; an overridden path remains managed by the service.
if [ -f /var/data/binance-decision-history.json ]; then
  cp -p /var/data/binance-decision-history.json "/root/levi-decision-history-$stamp.json"
fi
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
rollback() {
  tar -xzf "$backup" -C /opt/levi-binance
  systemctl restart levi-binance
  echo "Startup verification failed; code restored from $backup" >&2
  exit 1
}
systemctl restart levi-binance || rollback
sleep 2
systemctl is-active --quiet levi-binance || rollback
node --input-type=module - <<'JS' || rollback
const r=await fetch('http://127.0.0.1:8080/api/binance-agent',{signal:AbortSignal.timeout(30000)});
const d=await r.json();
if(!r.ok||d.config?.historyPerformanceVersion!==1)throw Error('History update verification failed');
console.log('History compaction and background persistence installed. Market data must still be verified.');
JS
systemctl is-active levi-binance
