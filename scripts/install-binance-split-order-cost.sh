#!/usr/bin/env bash
# Run by the account owner: restarting the existing LIVE service may resume
# managed protection and automatic trading under its current settings.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-split-order-cost.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib" "$stage/tests" "$stage/before/lib"
# Test against the installed dependencies without replacing the server or
# unrelated strategy modules. All regression data is synthetic; no API calls.
cp -a lib/. "$stage/lib/"
files=(lib/binance-external-cost.mjs lib/wyckoff-live-positions.mjs)
changed=0
for file in "${files[@]}"; do
 test -f "$file"
 git show "$revision:$file" > "$stage/$file"
 git show "$revision^:$file" > "$stage/before/$file"
 if ! cmp -s "$file" "$stage/$file"; then
  if ! cmp -s "$file" "$stage/before/$file"; then
   echo "Installed $file differs from the reviewed base. Nothing was installed or restarted; inspect this version before updating." >&2
   sha256sum "$file" >&2
   exit 1
  fi
  changed=$((changed+1))
 fi
 node --check "$stage/$file"
done
if [[ "$changed" == 0 ]]; then echo 'These modules are already installed; no restart performed.'; exit 0; fi
tests=(tests/binance-manual-order-reconciliation.test.mjs tests/binance-external-cost.test.mjs tests/live-balance-pnl.test.mjs)
for file in "${tests[@]}"; do git show "$revision:$file" > "$stage/$file"; done
node --test "${tests[@]/#/$stage/}"
backup="/root/levi-before-split-order-cost-$(date +%Y%m%d-%H%M%S).tgz"
tar -czf "$backup" "${files[@]}"
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 tar -xzf "$backup" -C /opt/levi-binance
 systemctl start levi-binance
 echo "Installation failed; restored the two modules from $backup. Check service status." >&2
 exit 1
}
trap rollback ERR
echo 'Restarting the existing service. Verified manual holdings may enter automatic protection and trading may resume under current settings.'
systemctl stop levi-binance
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
systemctl start levi-binance
sleep 2
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed split-order cost reconciliation from $revision. Backup: $backup"
echo 'Refresh the account page to verify quantity, managed position and protection. Installation success does not itself confirm account readiness.'
