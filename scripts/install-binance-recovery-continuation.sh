#!/usr/bin/env bash
set -euo pipefail
revision=${1:?Pass the reviewed commit SHA}
cd /opt/levi-binance
stage=$(mktemp -d /tmp/levi-recovery-continuation.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib"
files=(lib/wyckoff-strategy.mjs lib/wyckoff-spring-rsi.mjs)
for file in "${files[@]}"; do
  git show "$revision:$file" > "$stage/$file"
  if [[ "$file" != *.html ]]; then node --check "$stage/$file"; fi
done
backup="/root/levi-before-recovery-continuation-$(date +%Y%m%d-%H%M%S).tgz"
tar -czf "$backup" "${files[@]}"
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
echo "Recovery-high reset removed; other entry and exit rules retained. Backup: $backup"
