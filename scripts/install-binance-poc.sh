#!/usr/bin/env bash
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-poc.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
cp -a "$stage/release/." "$stage/runtime/"
# Exercise the actual production integrations, preserving local changes.
cp -a lib/. "$stage/runtime/lib/"
cp server.mjs binance-agent.js binance-agent.html regression-trend.js parallel-channel.js "$stage/runtime/"
cp "$stage/release/lib/binance-poc.mjs" "$stage/runtime/lib/"
node "$stage/release/scripts/patch-binance-poc.mjs" "$stage/runtime"
ln -s /opt/levi-binance/node_modules "$stage/runtime/node_modules"
node --test "$stage/runtime/tests/binance-poc.test.mjs" "$stage/runtime/tests/binance-manual-trades.test.mjs" "$stage/runtime/tests/futures-short.test.mjs" "$stage/runtime/tests/futures-short-fill.test.mjs" "$stage/runtime/tests/futures-short-recovery.test.mjs" "$stage/runtime/tests/live-execution-lock.test.mjs" "$stage/runtime/tests/binance-native-protection.test.mjs" "$stage/runtime/tests/binance-poc-installer.test.mjs"
files=(server.mjs binance-agent.js binance-agent.html binance-poc.js binance-poc.css lib/binance-poc.mjs lib/futures-short-policy.mjs lib/futures-short-runner.mjs)
for file in "${files[@]}"; do
 if [[ "$file" == *.mjs || "$file" == *.js ]]; then node --check "$stage/runtime/$file"; fi
done
backup="/root/levi-before-poc-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
for file in "${files[@]}"; do
 mkdir -p "$backup/$(dirname "$file")"
 if [[ -f "$file" ]]; then cp "$file" "$backup/$file"; fi
done
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 for file in "${files[@]}"; do if [[ -f "$backup/$file" ]]; then cp "$backup/$file" "$file"; fi; done
 systemctl start levi-binance
 echo "POC startup failed. Previous files restored from $backup." >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do cp "$stage/runtime/$file" "$file"; done
systemctl start levi-binance
node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)});const d=await r.json();if(r.ok&&d.pocTrading?.version===1){ready=true;break;}}catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('POC health check failed');
console.log(JSON.stringify({installed:true,pocVersion:1,tradingSettingsChanged:false,ordersCreatedByInstaller:0}));
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed POC waiting at $revision. Backup: $backup"
echo 'No POC intent was created. Existing trading flags, budgets, settings and journals were preserved.'
