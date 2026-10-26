#!/usr/bin/env bash
# Install the observation journal. Never touch credentials, trading flags or persisted positions.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
stage=$(mktemp -d /tmp/levi-ma-audit.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/lib" "$stage/scripts"
files=(server.mjs lib/ma-audit-file.mjs lib/ma-decision-audit.mjs lib/ma-slope.mjs lib/ma-slope-schedule.mjs lib/ma-slope-decision.mjs scripts/verify-binance-ma-audit.mjs ma-decision-journal.js ma-decision-journal.css)
existing=(); missing=()
for file in "${files[@]}"; do
 git show "$revision:$file" > "$stage/$file"
 if [[ "$file" == *.mjs || "$file" == *.js ]]; then node --check "$stage/$file"; fi
 if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi
done
STAGED_AUDIT="$stage/lib/ma-decision-audit.mjs" node --input-type=module - <<'JS'
const {makeAuditRecord}=await import(process.env.STAGED_AUDIT);
const row=makeAuditRecord({platform:'BINANCE',symbol:'BTCUSDT',at:Date.now(),action:'WAIT',bars:[]});
if(row.checks.length!==2||row.checks.some(c=>c.comparison!=='UNAVAILABLE'))throw Error('Audit smoke failed');
JS
backup="/root/levi-before-ma-audit-$(date +%Y%m%d-%H%M%S).tgz"
tar -czf "$backup" "${existing[@]}"
rollback() {
 trap - ERR
 systemctl stop levi-binance
 tar -xzf "$backup" -C /opt/levi-binance
 for file in "${missing[@]}"; do rm -f -- "$file"; done
 systemctl start levi-binance
 echo "Verification failed; code restored from $backup" >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do cp "$stage/$file" "$file"; done
systemctl start levi-binance
node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<15;i++){
 try{if((await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)})).ok){ready=true;break;}}catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Service did not become ready');
JS
node scripts/verify-binance-ma-audit.mjs
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Backup: $backup"
