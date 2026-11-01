#!/usr/bin/env bash
# Repair journal source timestamps only. No settings or exchange API writes.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-audit-time.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
cp -a lib "$stage/runtime/lib"
cp server.mjs "$stage/runtime/server.mjs"
mkdir "$stage/runtime/tests"
cp "$stage/release/tests/binance-audit-timestamps.test.mjs" "$stage/runtime/tests/"
node "$stage/release/scripts/patch-audit-timestamps.mjs" "$stage/runtime" "$stage/release"
node --check "$stage/runtime/server.mjs"
node --check "$stage/runtime/lib/ma-decision-audit.mjs"
node --test "$stage/runtime/tests/binance-audit-timestamps.test.mjs"
files=(server.mjs lib/ma-decision-audit.mjs)
if cmp -s server.mjs "$stage/runtime/server.mjs" && cmp -s lib/ma-decision-audit.mjs "$stage/runtime/lib/ma-decision-audit.mjs"; then
 echo 'Audit source timestamp fix is already installed; no restart needed.'
 exit 0
fi
backup="/root/levi-before-audit-time-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
tar -czf "$backup/code.tgz" "${files[@]}"
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 tar -xzf "$backup/code.tgz" -C /opt/levi-binance
 systemctl start levi-binance
 echo "Restored code from $backup. Verify service health." >&2
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
  const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)});
  if(r.ok){await r.json();ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Service health check failed');
console.log(JSON.stringify({auditSourceTimeFix:true,tradingSettingsChanged:false,oldJournalRowsRewritten:false}));
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Backup: $backup"
echo 'New audit records accept ISO source times; missing, future and stale quotes remain unavailable. Old records are retained.'
