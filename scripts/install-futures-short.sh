#!/usr/bin/env bash
# Owner-run installer. --enable-live explicitly enables automated SHORT entries.
set -euo pipefail
revision=${1:?Pass a reviewed full commit SHA}
action=${2:---install-only}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
case "$action" in --install-only|--enable-live|--disable-entries) ;; *) exit 1;; esac
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-futures-short.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/scripts" "$stage/tests"
# Test against the actual installed dependencies; preserve all unrelated local code.
cp -a lib "$stage/lib"
cp server.mjs binance-agent.js regression-trend.js parallel-channel.js "$stage/"
files=(lib/futures-short-policy.mjs lib/futures-short-api.mjs lib/futures-short-runner.mjs scripts/check-binance-futures-access.mjs)
for file in "${files[@]}" scripts/patch-futures-short.mjs scripts/futures-short-patches.json tests/futures-short.test.mjs; do
 mkdir -p "$stage/$(dirname "$file")"
 git show "$revision:$file" > "$stage/$file"
done
node "$stage/scripts/patch-futures-short.mjs" "$stage"
files+=(server.mjs binance-agent.js)
for file in "${files[@]}"; do node --check "$stage/$file"; done
node --test "$stage/tests/futures-short.test.mjs"
dropin=/etc/systemd/system/levi-binance.service.d/92-futures-short.conf
if [[ -e "$dropin" ]] && [[ "$(head -n 1 "$dropin")" != '# LEVI futures short configuration' ]]; then echo 'Unrecognized override; no changes.' >&2; exit 1; fi
backup="/root/levi-before-futures-short-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
existing=(); missing=()
for file in "${files[@]}"; do if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi; done
tar -czf "$backup/code.tgz" "${existing[@]}"
if [[ -f "$dropin" ]]; then cp -p "$dropin" "$backup/92-futures-short.conf"; fi
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 tar -xzf "$backup/code.tgz" -C /opt/levi-binance
 for file in "${missing[@]}"; do rm -f -- "$file"; done
 if [[ -f "$backup/92-futures-short.conf" ]]; then cp -p "$backup/92-futures-short.conf" "$dropin"; else rm -f -- "$dropin"; fi
 systemctl daemon-reload
 systemctl start levi-binance
 echo "Code restored from $backup. Futures journal was retained. Exchange executions cannot be rolled back; verify any positions and native protection." >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do mkdir -p "$(dirname "$file")"; cp "$stage/$file" "$file"; done
if [[ "$action" != --install-only ]]; then
 mkdir -p "$(dirname "$dropin")"
 enabled=false
 [[ "$action" != --enable-live ]] || enabled=true
 enabled_after=$(date -u +%Y-%m-%dT%H:%M:%SZ)
 # Idempotent upgrade: preserve the existing activation boundary when already enabled.
 if [[ "$enabled" == true ]] && [[ -f "$dropin" ]] && grep -q '^Environment="BINANCE_FUTURES_SHORT_ENABLED=true"$' "$dropin"; then
  previous=$(sed -n 's/^Environment="BINANCE_FUTURES_SHORT_AFTER=\([0-9TZ:.+-]*\)"$/\1/p' "$dropin")
  [[ -z "$previous" ]] || enabled_after=$previous
 fi
 cat > "$dropin" <<CONFIG
# LEVI futures short configuration
[Service]
Environment="BINANCE_FUTURES_SHORT_ENABLED=$enabled"
Environment="BINANCE_FUTURES_SHORT_AFTER=$enabled_after"
CONFIG
 chmod 644 "$dropin"
fi
systemctl daemon-reload
systemctl start levi-binance
EXPECTED_FUTURES_ACTION="$action" node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json(),f=d.shortTrading,a=process.env.EXPECTED_FUTURES_ACTION;
  if(r.ok&&f?.policy?.version==='FUTURES_CHANNEL_SHORT_V1'&&(a!=='--enable-live'||f.enabled===true)&&(a!=='--disable-entries'||f.enabled===false)){
   ready=true;console.log(JSON.stringify({shortTrading:f,mode:d.mode,autoExecution:d.autoExecution,liveTradingEnabled:d.liveTradingEnabled},null,2));break;
  }
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Futures installation status not verified');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision ($action). Backup: $backup"
echo 'Check authenticated SHORT panel for account, positions and protection. 70 USDT / two 35-USDT slots / Isolated 1x. Zero balance cannot enter. This installation status does not prove live order execution.'
