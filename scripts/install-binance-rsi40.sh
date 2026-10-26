#!/usr/bin/env bash
# Install the reviewed entry-policy update; verification performs GET requests only.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full commit SHA' >&2; exit 1; }
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
stage=$(mktemp -d /tmp/levi-rsi40.XXXXXX)
trap 'rm -rf "$stage"' EXIT
cp -a lib "$stage/lib"
files=(server.mjs lib/wyckoff-spring-rsi.mjs lib/wyckoff-evaluation.mjs lib/binance-quality-policy.mjs lib/binance-market-watch.mjs)
for file in "${files[@]}"; do
  git show "$revision:$file" > "$stage/$file"
  node --check "$stage/$file"
done
STAGED_POLICY="$stage/lib/binance-quality-policy.mjs" node --input-type=module - <<'JS'
const {BINANCE_ENTRY_RSI,assessQualityEntry}=await import(process.env.STAGED_POLICY);
if(BINANCE_ENTRY_RSI.max!==40||!assessQualityEntry('BTCUSDT',[]).ok||assessQualityEntry('RLUSDUSDT',[]).ok)throw Error('Entry policy smoke check failed');
JS
backup="/root/levi-before-rsi40-$(date +%Y%m%d-%H%M%S).tgz"
tar -czf "$backup" "${files[@]}"
rollback() {
  trap - ERR
  tar -xzf "$backup" -C /opt/levi-binance
  systemctl restart levi-binance
  echo "Update verification failed; restored $backup" >&2
  exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
systemctl start levi-binance
node --input-type=module - <<'JS'
let verified=false;
for(let attempt=0;attempt<10;attempt++){
 try{
  const response=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)});
  const data=await response.json();
  if(response.ok&&data.entryRsi?.max===40&&data.entryRsi.includesOpenCandle===true&&data.hourlyTrendFilter?.enabled===false&&data.entryPolicyVersion==='WYCKOFF_5M_SPRING_RSI40_NO_HOURLY_V7'){verified=true;break;}
 }catch{}
 await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!verified)throw Error('Live entry policy verification failed');
console.log('Verified: RSI14 5m <=40; hourly trend requirement disabled.');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Code backup: $backup"
