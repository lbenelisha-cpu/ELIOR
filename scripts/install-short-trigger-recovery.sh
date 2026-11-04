#!/usr/bin/env bash
# Installs the SHORT immediate-trigger recovery and releases only after live flat-state checks.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-short-trigger.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/runtime/lib" "$stage/runtime/scripts" "$stage/runtime/tests"
files=(lib/futures-short-api.mjs lib/futures-short-runner.mjs lib/futures-short-recovery.mjs scripts/release-futures-short-halt.mjs)
for file in "${files[@]}" tests/futures-short.test.mjs tests/futures-short-recovery.test.mjs; do
  git show "$revision:$file" > "$stage/runtime/$file"
done
cp -a lib "$stage/runtime/"
for file in "${files[@]}"; do git show "$revision:$file" > "$stage/runtime/$file"; done
node --check "$stage/runtime/lib/futures-short-api.mjs"
node --check "$stage/runtime/lib/futures-short-runner.mjs"
node --check "$stage/runtime/lib/futures-short-recovery.mjs"
node --check "$stage/runtime/scripts/release-futures-short-halt.mjs"
node --test "$stage/runtime/tests/futures-short.test.mjs" "$stage/runtime/tests/futures-short-recovery.test.mjs"

for file in lib/futures-short-runner.mjs lib/futures-short-api.mjs lib/futures-short-recovery.mjs scripts/release-futures-short-halt.mjs; do
  case "$file" in
    lib/futures-short-runner.mjs) grep -q 'async ensureAlgo(p,kind,price)' "$file" && grep -q 'visibilityDelays=\[150,300,600,950\]' "$file" ;;
    lib/futures-short-api.mjs) grep -q "'/fapi/v1/ticker/bookTicker'" "$file" ;;
    lib/futures-short-recovery.mjs) grep -q "FUTURES_API_-2013" "$file" ;;
    scripts/release-futures-short-halt.mjs) [[ ! -f "$file" ]] || grep -q 'SHORT_VISIBILITY_FIX_NOT_INSTALLED' "$file" ;;
  esac || { echo "Unexpected installed context in $file; no files changed." >&2; exit 1; }
done

backup="/root/levi-before-short-trigger-fix-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
existing=(); missing=()
for file in "${files[@]}"; do if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi; done
tar -czf "$backup/code.tgz" "${existing[@]}"
rollback(){
  trap - ERR
  set +e
  systemctl stop levi-binance
  tar -xzf "$backup/code.tgz" -C /opt/levi-binance
  for file in "${missing[@]}"; do rm -f -- "$file"; done
  systemctl start levi-binance
  echo "Code restored from $backup; SHORT halt retained." >&2
  exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do install -D -m 0644 "$stage/runtime/$file" "$file"; done
systemctl start levi-binance
systemctl is-active --quiet levi-binance
trap - ERR

# Release script rechecks journal, exchange positions, order mode, funds and all open orders.
# If any check fails it restarts the service with the existing halt unchanged.
node scripts/release-futures-short-halt.mjs --release
systemctl is-active --quiet levi-binance
echo "Installed immediate-trigger fix and attempted verified release. Backup: $backup"
