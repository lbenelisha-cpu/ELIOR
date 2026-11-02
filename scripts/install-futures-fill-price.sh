#!/usr/bin/env bash
# Install the precise weighted entry price fix. Halt stays in place.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-short-fill.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
# Refuse to overwrite unknown production changes.
old_hash=2ccb515d5c798dcf1c96b7f3c7696f0dfaaf9056851e04ba37a462a91d21b458
current_hash=$(sha256sum lib/futures-short-runner.mjs | cut -d ' ' -f 1)
new_hash=$(sha256sum "$stage/release/lib/futures-short-runner.mjs" | cut -d ' ' -f 1)
[[ "$current_hash" == "$old_hash" || "$current_hash" == "$new_hash" ]] || { echo 'Unknown SHORT runner version; nothing changed.' >&2; exit 1; }
cp -a lib "$stage/runtime/lib"
cp server.mjs binance-agent.js regression-trend.js parallel-channel.js "$stage/runtime/"
cp -a "$stage/release/tests" "$stage/release/scripts" "$stage/runtime/"
cp "$stage/release/lib/futures-short-runner.mjs" "$stage/release/lib/futures-short-fill.mjs" "$stage/release/lib/futures-short-ownership-recovery.mjs" "$stage/runtime/lib/"
node --test "$stage/runtime/tests/futures-short.test.mjs" "$stage/runtime/tests/futures-short-recovery.test.mjs" "$stage/runtime/tests/futures-short-fill.test.mjs"
node --check "$stage/release/scripts/recover-futures-rounded-fill.mjs"
backup="/root/levi-before-short-fill-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
cp lib/futures-short-runner.mjs "$backup/runner.mjs"
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 cp "$backup/runner.mjs" lib/futures-short-runner.mjs
 systemctl start levi-binance
 echo "Restored runner from $backup; halt was not released." >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
cp "$stage/release/lib/futures-short-runner.mjs" "$stage/release/lib/futures-short-fill.mjs" "$stage/release/lib/futures-short-ownership-recovery.mjs" lib/
cp "$stage/release/scripts/recover-futures-rounded-fill.mjs" scripts/
systemctl start levi-binance
node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)});if(r.ok){await r.json();ready=true;break;}}catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Service health check failed');
console.log(JSON.stringify({preciseFillPriceFix:true,haltReleased:false,tradingSettingsChanged:false}));
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Backup: $backup"
echo 'An explicit verified release is separate: node scripts/recover-futures-rounded-fill.mjs --release'
