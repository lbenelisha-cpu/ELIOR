#!/usr/bin/env bash
# Preserve account configuration, journals, held-position policies and exit settings.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-channel-intrabar.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
tests=(channel-primary-entry futures-short channel-profit-protection binance-stream-lifecycle channel-intrabar-installer trading-rules-display channel-watch market-attention)
testfiles=(); for name in "${tests[@]}"; do testfiles+=("$stage/release/tests/$name.test.mjs"); done
node --test "${testfiles[@]}"
cp -a "$stage/release/." "$stage/runtime/"
cp -a lib/. "$stage/runtime/lib/"
for file in *.js *.mjs *.html; do [[ ! -f "$file" ]] || cp "$file" "$stage/runtime/"; done
files=(lib/channel-primary-entry.mjs lib/channel-live-bar.mjs lib/futures-short-policy.mjs lib/futures-short-runner.mjs lib/market-attention.mjs binance-agent.js binance-agent.html binance-futures-positions.js channel-watch.js strategy-followup-ui.js market-attention.js)
for file in "${files[@]}"; do cp "$stage/release/$file" "$stage/runtime/$file"; done
node "$stage/release/scripts/patch-channel-intrabar.mjs" "$stage/runtime"
files+=(server.mjs)
for file in "${files[@]}"; do [[ "$file" == *.html ]] || node --check "$stage/runtime/$file"; done
testfiles=(); for name in "${tests[@]}"; do testfiles+=("$stage/runtime/tests/$name.test.mjs"); done
# The VPS executes Binance; Colmex ran against its complete release above.
node --test --test-skip-pattern=Colmex "${testfiles[@]}"
backup="/root/levi-before-channel-intrabar-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
for file in "${files[@]}"; do mkdir -p "$backup/$(dirname "$file")"; if [[ -f "$file" ]]; then cp "$file" "$backup/$file"; fi; done
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 for file in "${files[@]}"; do if [[ -f "$backup/$file" ]]; then cp "$backup/$file" "$file"; else rm -f "$file"; fi; done
 systemctl start levi-binance
 echo "Restored code from $backup. Journals retained; exchange executions cannot be undone." >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do cp "$stage/runtime/$file" "$file"; done
systemctl start levi-binance
node --input-type=module <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  const long=d.channelPrimary,short=d.shortTrading?.policy;
  if(r.ok&&long?.version==='CHANNEL_PRIMARY_INTRABAR_V2'&&short?.entryPolicyVersion==='FUTURES_CHANNEL_SHORT_INTRABAR_V2'&&[long,short].every(p=>p.period===50&&p.waitForBreakoutClose===false&&p.volumeRule==='ACCUMULATED_OPEN_BAR_VS_PREVIOUS_20')){
   console.log(JSON.stringify({long:{version:long.version,enabled:long.enabled,waitForBreakoutClose:long.waitForBreakoutClose},short:{version:short.entryPolicyVersion,enabled:short.enabled,waitForBreakoutClose:short.waitForBreakoutClose},configurationChanged:false},null,2));ready=true;break;
  }
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Running intrabar entry policies could not be verified');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Backup: $backup"
echo '50 closed basis candles; live LONG/SHORT breakout, actual cumulative volume and final protection checks. No configuration or journal changes.'
