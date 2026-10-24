#!/usr/bin/env bash
set -euo pipefail
revision=${1:?Pass the reviewed commit SHA}
cd /opt/levi-binance
stage=$(mktemp -d /tmp/levi-trailing-profit.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib" "$stage/scripts"
files=(scripts/binance-device-pair.mjs lib/binance-device-auth.mjs lib/wyckoff-spring-rsi.mjs lib/wyckoff-strategy.mjs lib/current-rsi-value.mjs rsi-current-badge.js binance-control-session.js binance-device-access.js binance-manual-trades.js server.mjs lib/trade-settings.mjs lib/candle-power.mjs lib/net-trade-journal.mjs lib/manual-holding-adoption.mjs lib/binance-external-cost.mjs lib/binance-native-protection.mjs lib/fixed-trade-exit.mjs lib/trailing-profit-exit.mjs lib/binance-position-exit.mjs lib/wyckoff-evaluation.mjs lib/wyckoff-live-positions.mjs lib/binance-manual-trades.mjs lib/binance-demo-trader.mjs binance-agent.html binance-agent.js binance-agent.css binance-chart-decisions.js trade-risk.js trade-risk.css app-settings.js market-power-panel.js)
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
echo "Reusable device code support and current RSI display installed; defaults: SL -1%, activate at +4%, floor +4%, peak minus one percentage point. Applies to existing managed positions too. Backup: $backup"
echo "Verified manual holdings are enrolled too, including existing positions. Native protection locks sell quantity until cancelled.
Native order updates require the running server; already accepted orders remain at Binance.
Installer submitted no order. Running trading service may immediately close positions already beyond thresholds."

if [[ -t 0 ]]; then
  read -r -s -p "בחר קוד קבוע בן שש ספרות (אפשר אותו קוד שמוגדר בקולמקס): " levi_device_code
  printf '\n'
  if [[ ! "$levi_device_code" =~ ^[0-9]{6}$ ]]; then
    echo "לא הוגדר קוד: יש להזין בדיוק שש ספרות. ההתקנה הושלמה, חיבורים קיימים נשארו."
    unset levi_device_code
    exit 1
  fi
  printf '%s' "$levi_device_code" | node scripts/binance-device-pair.mjs --permanent --code-stdin
  unset levi_device_code
else
  echo "To configure the reusable code in your SSH terminal: node scripts/binance-device-pair.mjs --permanent"
fi
