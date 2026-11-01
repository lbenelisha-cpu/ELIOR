#!/usr/bin/env bash
# Recalibrate entries only; preserve service configuration, journals and exits.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-channel-50.XXXXXX)
trap 'rm -rf "$stage"' EXIT
files=(lib/channel-primary-entry.mjs lib/futures-short-policy.mjs)
for file in "${files[@]}"; do test -f "$file"; done
# Offline checks run against installed runtime dependencies.
git archive "$revision" tests scripts | tar -x -C "$stage"
cp -a lib "$stage/lib"
for file in *.js *.mjs *.html; do [[ ! -f "$file" ]] || cp "$file" "$stage/"; done
for file in "${files[@]}"; do git show "$revision:$file" > "$stage/$file"; node --check "$stage/$file"; done
node --test "$stage/tests/channel-primary-entry.test.mjs" "$stage/tests/futures-short.test.mjs" "$stage/tests/channel-profit-protection.test.mjs"
backup="/root/levi-before-channel-50-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
tar -czf "$backup/code.tgz" "${files[@]}"
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 tar -xzf "$backup/code.tgz" -C /opt/levi-binance
 systemctl start levi-binance
 echo "Restored code from $backup; journal and positions retained. Verify protection; exchange executions cannot be undone." >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
systemctl start levi-binance
node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  const long=d.channelPrimary,short=d.shortTrading?.policy;
  if(r.ok&&long?.period===50&&short?.period===50&&long.livePriceRule==='CURRENT_PRICE'&&short.livePriceRule==='CURRENT_PRICE'){
   console.log(JSON.stringify({long:{period:long.period,enabled:long.enabled,livePriceRule:long.livePriceRule},short:{period:short.period,enabled:short.enabled,livePriceRule:short.livePriceRule},configurationChanged:false},null,2));ready=true;break;
  }
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Running entry policies could not be verified');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Backup: $backup"
echo 'LONG and SHORT: 50 closed pre-breakout candles; recovered wicks allowed, fresh current-price checks retained. Existing positions and exit settings preserved.'
