#!/usr/bin/env bash
# Read-only accounting display; preserve trading configuration and execution journals.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-trading-pnl.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/release" "$stage/runtime/netlify/functions"
git archive "$revision" | tar -x -C "$stage/release"
cp -a lib "$stage/runtime/lib"
cp server.mjs binance-agent.html binance-agent.js package.json regression-trend.js parallel-channel.js "$stage/runtime/"
cp netlify/functions/binance-read-proxy.mjs "$stage/runtime/netlify/functions/"
cp -a "$stage/release/tests" "$stage/release/scripts" "$stage/runtime/"
files=(binance-trading-pnl.js binance-trading-pnl.css lib/binance-trading-pnl.mjs lib/binance-trading-pnl-reader.mjs)
for file in "${files[@]}"; do cp "$stage/release/$file" "$stage/runtime/$file"; done
node "$stage/release/scripts/patch-trading-pnl.mjs" "$stage/runtime"
node --check "$stage/runtime/server.mjs"
node --check "$stage/runtime/binance-agent.js"
node --test "$stage/runtime/tests/binance-trading-pnl.test.mjs" "$stage/runtime/tests/binance-trading-pnl-ui.test.mjs" "$stage/runtime/tests/futures-short.test.mjs"
files+=(server.mjs binance-agent.html binance-agent.js lib/futures-short-api.mjs netlify/functions/binance-read-proxy.mjs)
backup="/root/levi-before-trading-pnl-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
existing=();missing=()
for file in "${files[@]}"; do if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi; done
tar -czf "$backup/code.tgz" "${existing[@]}"
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 tar -xzf "$backup/code.tgz" -C /opt/levi-binance
 for file in "${missing[@]}"; do rm -f -- "$file"; done
 systemctl start levi-binance
 echo "Restored code from $backup. Trading configuration and journals retained." >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do cp "$stage/runtime/$file" "$file"; done
systemctl start levi-binance
node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:8080/api/binance-trading-pnl',{signal:AbortSignal.timeout(1500)});
  const a=await fetch('http://127.0.0.1:8080/binance-trading-pnl.js',{signal:AbortSignal.timeout(1500)});
  if(r.status===401&&a.ok&&(await a.text()).includes('createTradingPnlPanel')){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Authenticated report route or static module unavailable');
console.log(JSON.stringify({tradingPnlInstalled:true,authenticationRequired:true,tradingSettingsChanged:false}));
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Backup: $backup"
