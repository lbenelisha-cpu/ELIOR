#!/usr/bin/env bash
set -euo pipefail
revision=${1:?Pass the reviewed commit SHA}
cd /opt/levi-binance
stage=$(mktemp -d /tmp/levi-trailing-profit.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib"
files=(server.mjs lib/fixed-trade-exit.mjs lib/trailing-profit-exit.mjs lib/binance-position-exit.mjs lib/wyckoff-evaluation.mjs lib/wyckoff-live-positions.mjs lib/binance-manual-trades.mjs lib/binance-demo-trader.mjs binance-agent.html binance-agent.js binance-agent.css binance-chart-decisions.js trade-risk.js trade-risk.css)
existing=()
for file in "${files[@]}"; do
  git show "$revision:$file" > "$stage/$file"
  if [[ "$file" == *.mjs || "$file" == *.js ]]; then node --check "$stage/$file"; fi
  if [[ -f "$file" ]]; then existing+=("$file"); fi
done
backup="/root/levi-before-trailing-profit-$(date +%Y%m%d-%H%M%S).tgz"
tar -czf "$backup" "${existing[@]}"
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
rollback() {
  tar -xzf "$backup" -C /opt/levi-binance
  systemctl restart levi-binance
  echo "Startup failed; code restored from $backup" >&2
  exit 1
}
systemctl restart levi-binance || rollback
sleep 2
systemctl is-active --quiet levi-binance || rollback
echo "Trailing profit installed: SL -1%, activate at +4%, floor +4%, peak minus one percentage point. Applies to existing managed positions too. Backup: $backup"
echo "Installer submitted no order. Running trading service may immediately close positions already beyond thresholds."
