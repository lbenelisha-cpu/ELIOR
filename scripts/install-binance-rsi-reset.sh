#!/usr/bin/env bash
set -euo pipefail
revision=${1:?Pass the reviewed commit SHA}
cd /opt/levi-binance
stage=$(mktemp -d /tmp/levi-recovery-continuation.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib"
files=(server.mjs lib/wyckoff-spring-rsi.mjs lib/wyckoff-evaluation.mjs lib/wyckoff-search-boundary.mjs)
for file in "${files[@]}"; do
  git show "$revision:$file" > "$stage/$file"
  if [[ "$file" != *.html ]]; then node --check "$stage/$file"; fi
done
backup="/root/levi-before-recovery-continuation-$(date +%Y%m%d-%H%M%S).tgz"
existing=(); for file in "${files[@]}"; do [[ ! -f "$file" ]] || existing+=("$file"); done
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
echo "Spring with RSI above 30 now resets the Binance search; rejection boundaries persist across restarts. Existing positions and exits unchanged. Backup: $backup"
