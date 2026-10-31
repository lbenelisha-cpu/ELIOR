#!/usr/bin/env bash
# Owner-run passive monitoring update. Preserves account, execution settings and engine.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-channel-monitor.XXXXXX)
trap 'rm -rf "$stage"' EXIT
files=(resistance-patterns.js regression-trend.js parallel-channel.js lib/channel-comparison.mjs strategy-followup-ui.js binance-agent.html binance-agent.js binance-agent.css)
for file in "${files[@]}" scripts/patch-channel-monitor.mjs tests/channel-comparison.test.mjs; do
 mkdir -p "$stage/$(dirname "$file")"
 git show "$revision:$file" > "$stage/$file"
done
cp server.mjs "$stage/server.mjs"
cp lib/strategy-followup.mjs "$stage/lib/strategy-followup.mjs"
node "$stage/scripts/patch-channel-monitor.mjs" "$stage"
files+=(server.mjs lib/strategy-followup.mjs)
for file in "${files[@]}"; do case "$file" in *.js|*.mjs) node --check "$stage/$file";; esac; done
node --test "$stage/tests/channel-comparison.test.mjs"
backup="/root/levi-before-channel-monitor-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
existing=(); missing=()
for file in "${files[@]}"; do if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi; done
tar -czf "$backup/code.tgz" "${existing[@]}"
rollback(){
 trap - ERR
 set +e
 tar -xzf "$backup/code.tgz" -C /opt/levi-binance
 for file in "${missing[@]}"; do rm -f -- "$file"; done
 systemctl restart levi-binance
 echo "Restored code from $backup; verify account status." >&2
 exit 1
}
trap rollback ERR
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
systemctl restart levi-binance
node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{const r=await fetch('http://127.0.0.1:8080/parallel-channel.js',{signal:AbortSignal.timeout(1500)});if(r.ok&&(await r.text()).includes('LEVI_PARALLEL')){ready=true;break;}}catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Channel asset not served');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed passive channel monitoring from $revision. Backup: $backup"
echo 'Current trading settings are preserved. In LIVE mode, monitoring uses the existing minute observer. Verify the comparison timestamp in the app; results need six new closed candles.'
