#!/usr/bin/env bash
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-attention.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
cp -a "$stage/release/." "$stage/runtime/"
# Verify both platforms in the complete release before overlaying Binance runtime files.
tests=(market-attention.test.mjs market-attention-ui.test.mjs market-news.test.mjs market-news-execution.test.mjs channel-primary-entry.test.mjs binance-poc.test.mjs futures-short.test.mjs futures-short-recovery.test.mjs live-execution-lock.test.mjs)
ln -s /opt/levi-binance/node_modules "$stage/release/node_modules"
release_tests=()
for file in "${tests[@]}"; do release_tests+=("$stage/release/tests/$file"); done
node --test "$stage/release/tests/market-attention-installer.test.mjs" "${release_tests[@]}"

cp -a lib/. "$stage/runtime/lib/"
cp server.mjs binance-agent.html regression-trend.js parallel-channel.js "$stage/runtime/"
cp "$stage/release/lib/market-attention.mjs" "$stage/runtime/lib/"
node "$stage/release/scripts/patch-market-attention.mjs" "$stage/runtime"
ln -s /opt/levi-binance/node_modules "$stage/runtime/node_modules"
# This service runs Binance. Colmex integration was checked in the isolated release above.
runtime_tests=()
for file in "${tests[@]}"; do runtime_tests+=("$stage/runtime/tests/$file"); done
node --test --test-skip-pattern="^Colmex" "${runtime_tests[@]}"
files=(server.mjs binance-agent.html lib/market-attention.mjs market-attention.js market-attention.css market-news.js market-news.html)
for file in "${files[@]}"; do
 if [[ "$file" == *.mjs || "$file" == *.js ]]; then node --check "$stage/runtime/$file"; fi
done
backup="/root/levi-before-attention-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
for file in "${files[@]}"; do
 mkdir -p "$backup/$(dirname "$file")"
 if [[ -f "$file" ]]; then cp "$file" "$backup/$file"; fi
done
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 for file in "${files[@]}"; do
  if [[ -f "$backup/$file" ]]; then cp "$backup/$file" "$file"; else rm -f "$file"; fi
 done
 systemctl start levi-binance
 echo "Attention startup failed. Previous files restored from $backup." >&2
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
  const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  if(r.ok&&d.marketAttention?.version==='MARKET_ATTENTION_V1'&&d.marketNews?.enabled===false&&d.marketNews?.policy==='OBSERVATION_ONLY'){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Attention capability health check failed');
const r=await fetch('http://127.0.0.1:8080/api/market-news',{signal:AbortSignal.timeout(3000)}),d=await r.json();
if(!r.ok||d.executionEnabled!==false||!Array.isArray(d.attention))throw Error('News observation health check failed');
console.log(JSON.stringify({installed:true,version:'MARKET_ATTENTION_V1',newsExecutionInfluence:false,ordersCreatedByInstaller:0,sources:d.sources.map(s=>({name:s.name,status:s.status,error:s.error||null}))},null,2));
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed attention observers at $revision. Backup: $backup"
echo 'News is observation-only. No trading intent was created. Account settings and execution journals were preserved.'
