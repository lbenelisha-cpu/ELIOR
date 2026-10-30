#!/usr/bin/env bash
# Run by the account owner. --enable-live authorizes a new automatic BUY route.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
action=${2:---install-only}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
case "$action" in --install-only|--enable-live|--disable-independent-entry) ;; *) echo 'Use --install-only, --enable-live or --disable-independent-entry' >&2; exit 1;; esac
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-independent-entry.XXXXXX)
trap 'rm -rf "$stage"' EXIT
files=(scripts/audit-wyckoff-recovery.mjs scripts/compare-entry-methods.mjs)
while IFS= read -r file; do
 case "$file" in *.js|*.mjs|*.html|*.css) files+=("$file");; esac
done < <(git ls-tree --name-only "$revision")
while IFS= read -r file; do
 case "$file" in *.mjs|*.js) files+=("$file");; esac
done < <(git ls-tree -r --name-only "$revision" -- lib)
existing=(); missing=()
for file in "${files[@]}"; do
 mkdir -p "$stage/$(dirname "$file")"
 git show "$revision:$file" > "$stage/$file"
 case "$file" in *.js|*.mjs) node --check "$stage/$file";; esac
 if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi
done
while IFS= read -r file; do
 mkdir -p "$stage/$(dirname "$file")"
 git show "$revision:$file" > "$stage/$file"
done < <(git ls-tree -r --name-only "$revision" -- tests)
# All selected tests use synthetic bars and stubbed order submission, no API keys.
node --test "$stage/tests/binance-independent-entry.test.mjs" "$stage/tests/binance-settings-stop.test.mjs" "$stage/tests/wyckoff-higher-recovery.test.mjs" "$stage/tests/live-buy-readiness.test.mjs"
dropin=/etc/systemd/system/levi-binance.service.d/90-independent-entry.conf
if [[ -e "$dropin" ]] && ! head -n 1 "$dropin" | grep -qx '# LEVI independent entry configuration'; then
 echo 'An unrecognized service override exists. No installation or restart performed.' >&2
 exit 1
fi
backup="/root/levi-before-independent-entry-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
tar -czf "$backup/code.tgz" "${existing[@]}"
if [[ -f "$dropin" ]]; then cp -p "$dropin" "$backup/90-independent-entry.conf"; fi
enabled_after=$(date -u +%Y-%m-%dT%H:%M:%SZ)
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 tar -xzf "$backup/code.tgz" -C /opt/levi-binance
 for file in "${missing[@]}"; do rm -f -- "$file"; done
 if [[ -f "$backup/90-independent-entry.conf" ]]; then cp -p "$backup/90-independent-entry.conf" "$dropin"; else rm -f -- "$dropin"; fi
 systemctl daemon-reload
 systemctl start levi-binance
 echo "Verification failed; restored code and route configuration from $backup. Exchange actions already executed cannot be rolled back. Check account and protection." >&2
 exit 1
}
trap rollback ERR
if [[ "$action" == --enable-live ]]; then
 echo 'Enabling independent LIVE breakout entries. The running bot may buy with real funds once a new closed-candle signal and all account/risk checks pass.'
fi
systemctl stop levi-binance
for file in "${files[@]}"; do mkdir -p "$(dirname "$file")"; cp "$stage/$file" "$file"; done
if [[ "$action" != --install-only ]]; then
 mkdir -p "$(dirname "$dropin")"
 enabled=false
 [[ "$action" != --enable-live ]] || enabled=true
 cat > "$dropin" <<EOF
# LEVI independent entry configuration
[Service]
Environment="BINANCE_INDEPENDENT_BREAKOUT_ENABLED=$enabled"
Environment="BINANCE_INDEPENDENT_BREAKOUT_AFTER=$enabled_after"
EOF
 chmod 644 "$dropin"
fi
systemctl daemon-reload
systemctl start levi-binance
EXPECTED_ENTRY_ACTION="$action" EXPECTED_ENTRY_AFTER="$enabled_after" node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json(),route=d.independentEntry;
  const enabled=process.env.EXPECTED_ENTRY_ACTION==='--enable-live',disabled=process.env.EXPECTED_ENTRY_ACTION==='--disable-independent-entry';
  const permission=enabled?route?.enabled===true&&route.enabledAfter===Date.parse(process.env.EXPECTED_ENTRY_AFTER)&&d.mode==='live'&&d.autoExecution===true&&d.liveTradingEnabled===true:disabled?route?.enabled===false:true;
  if(r.ok&&permission&&route?.version==='BINANCE_INDEPENDENT_BREAKOUT_V1'&&!route.error&&d.confirmedQuality?.recoveryRule==='SECOND_RECOVERY_HIGHER_V1'&&d.confirmedQuality?.stopLossPolicy==='SETTINGS_ONLY_V1'&&d.researchMonitoring?.mode==='OBSERVATION_ONLY'&&d.entryComparison?.mode==='SIMULATION_ONLY'){ready=true;console.log(JSON.stringify({independentEntry:route,mode:d.mode,autoExecution:d.autoExecution,liveTradingEnabled:d.liveTradingEnabled},null,2));break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Installed entry route and requested permission were not verified');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed and verified $revision ($action). Backup: $backup"
echo 'Verify account readiness and native protection in the app. An enabled route does not guarantee an eligible signal or an executed trade.'
