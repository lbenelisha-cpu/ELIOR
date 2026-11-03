#!/usr/bin/env bash
set -euo pipefail
revision=${1:?Pass a reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-poc-paper.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
cp -a "$stage/release/." "$stage/runtime/"
ln -s /opt/levi-binance/node_modules "$stage/release/node_modules"
node --test "$stage/release/tests/"poc-paper*.test.mjs
# Overlay the running files, then apply only the additive paper-trading hooks.
cp -a lib/. "$stage/runtime/lib/"
cp server.mjs binance-agent.html binance-agent.js "$stage/runtime/"
if [[ -f netlify/functions/binance-read-proxy.mjs ]]; then cp netlify/functions/binance-read-proxy.mjs "$stage/runtime/netlify/functions/"; fi
cp "$stage/release/lib/"poc-paper*.mjs "$stage/runtime/lib/"
node "$stage/release/scripts/patch-poc-paper.mjs" "$stage/runtime"
ln -s /opt/levi-binance/node_modules "$stage/runtime/node_modules"
node --test "$stage/runtime/tests/"poc-paper*.test.mjs
files=(server.mjs binance-agent.html binance-agent.js binance-poc-paper.js binance-poc-paper.css lib/poc-paper-strategy.mjs lib/poc-paper-ledger.mjs lib/poc-paper-service.mjs netlify/functions/binance-read-proxy.mjs)
for file in "${files[@]}"; do if [[ "$file" == *.mjs || "$file" == *.js ]]; then node --check "$stage/runtime/$file"; fi; done
backup="/root/levi-before-poc-paper-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
for file in "${files[@]}"; do mkdir -p "$backup/$(dirname "$file")"; if [[ -f "$file" ]]; then cp "$file" "$backup/$file"; fi; done
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 for file in "${files[@]}"; do if [[ -f "$backup/$file" ]]; then cp "$backup/$file" "$file"; else rm -f "$file"; fi; done
 systemctl start levi-binance
 echo "Startup failed; restored files from $backup. Paper journal retained." >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do mkdir -p "$(dirname "$file")"; cp "$stage/runtime/$file" "$file"; done
systemctl start levi-binance
node --input-type=module <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();if(r.ok&&d.pocPaper?.version==='POC_PAPER_V1'&&d.pocPaper.executionEnabled===false){ready=true;break;}}catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Paper observer capability unavailable');
const r=await fetch('http://127.0.0.1:8080/api/binance-poc-paper',{signal:AbortSignal.timeout(3000)});
if(r.status!==401)throw Error('Paper account endpoint must require device authentication');
console.log('POC paper observer installed; exchange writes disabled in observer. Open the connected app to verify balances and the first observation.');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Backup: $backup"
