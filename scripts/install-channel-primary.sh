#!/usr/bin/env bash
# Owner-run installation. --enable-live changes the automatic BUY decision-maker.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
action=${2:---install-only}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
case "$action" in --install-only|--enable-live|--disable-channel-primary) ;; *) exit 1;; esac
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-channel-primary.XXXXXX)
trap 'rm -rf "$stage"' EXIT
# Stage complete library dependencies for offline tests, copy only selected files.
while IFS= read -r file; do
 case "$file" in *.js|*.html) git show "$revision:$file" > "$stage/$file";; esac
done < <(git ls-tree --name-only "$revision")
for dir in lib tests scripts; do mkdir -p "$stage/$dir"; done
while IFS= read -r file; do
 mkdir -p "$stage/$(dirname "$file")"
 git show "$revision:$file" > "$stage/$file"
done < <(git ls-tree -r --name-only "$revision" -- lib tests)
files=(lib/channel-primary-entry.mjs lib/wyckoff-evaluation.mjs regression-trend.js parallel-channel.js binance-agent.html binance-agent.js strategy-followup-ui.js)
for file in "${files[@]}" scripts/patch-channel-primary.mjs scripts/channel-primary-server-patches.json; do git show "$revision:$file" > "$stage/$file"; done
cp server.mjs "$stage/server.mjs"
node "$stage/scripts/patch-channel-primary.mjs" "$stage"
files+=(server.mjs)
for file in "${files[@]}"; do case "$file" in *.js|*.mjs) node --check "$stage/$file";; esac; done
node --test "$stage/tests/channel-primary-entry.test.mjs" "$stage/tests/binance-independent-entry.test.mjs" "$stage/tests/binance-settings-stop.test.mjs" "$stage/tests/colmex-independent-entry.test.mjs"
dropin=/etc/systemd/system/levi-binance.service.d/91-channel-primary.conf
if [[ -e "$dropin" ]] && [[ "$(head -n 1 "$dropin")" != '# LEVI channel primary configuration' ]]; then echo 'Unrecognized service override; no changes.' >&2; exit 1; fi
backup="/root/levi-before-channel-primary-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
existing=(); missing=()
for file in "${files[@]}"; do if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi; done
tar -czf "$backup/code.tgz" "${existing[@]}"
if [[ -f "$dropin" ]]; then cp -p "$dropin" "$backup/91-channel-primary.conf"; fi
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 tar -xzf "$backup/code.tgz" -C /opt/levi-binance
 for file in "${missing[@]}"; do rm -f -- "$file"; done
 if [[ -f "$backup/91-channel-primary.conf" ]]; then cp -p "$backup/91-channel-primary.conf" "$dropin"; else rm -f -- "$dropin"; fi
 systemctl daemon-reload
 systemctl start levi-binance
 echo "Restored from $backup. Check account and protection; exchange executions cannot be rolled back." >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
if [[ "$action" != --install-only ]]; then
 mkdir -p "$(dirname "$dropin")"
 enabled=false
 [[ "$action" != --enable-live ]] || enabled=true
 enabled_after=$(date -u +%Y-%m-%dT%H:%M:%SZ)
 cat > "$dropin" <<CONFIG
# LEVI channel primary configuration
[Service]
Environment="BINANCE_CHANNEL_PRIMARY_ENABLED=$enabled"
Environment="BINANCE_CHANNEL_PRIMARY_AFTER=$enabled_after"
CONFIG
 chmod 644 "$dropin"
fi
systemctl daemon-reload
systemctl start levi-binance
EXPECTED_CHANNEL_ACTION="$action" node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json(),c=d.channelPrimary,a=process.env.EXPECTED_CHANNEL_ACTION;
  if(r.ok&&c?.version==='CHANNEL_PRIMARY_BREAKOUT_V1'&&!c.error&&(a!=='--enable-live'||c.enabled===true&&c.requested===true)&&(a!=='--disable-channel-primary'||c.requested===false)){ready=true;console.log(JSON.stringify({channelPrimary:c,mode:d.mode,autoExecution:d.autoExecution,liveTradingEnabled:d.liveTradingEnabled},null,2));break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Channel primary configuration not verified');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision ($action). Backup: $backup"
echo 'Verify channel-primary status in the app. Enabling changes automatic entries, preserves exit settings, and requires a new signal. Disabling restores previously configured entry routes.'
