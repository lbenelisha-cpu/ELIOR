#!/usr/bin/env bash
# Run by the account owner. --enable-entry-overlay authorizes news priority/veto for automatic entries.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
action=${2:---install-only}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
case "$action" in --install-only|--enable-entry-overlay|--disable-entry-overlay) ;; *) echo 'Use --install-only, --enable-entry-overlay or --disable-entry-overlay' >&2; exit 1;; esac
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-market-news.XXXXXX)
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
node --test "$stage/tests/market-news.test.mjs" "$stage/tests/market-news-execution.test.mjs" "$stage/tests/binance-independent-entry.test.mjs" "$stage/tests/binance-settings-stop.test.mjs" "$stage/tests/wyckoff-higher-recovery.test.mjs" "$stage/tests/live-buy-readiness.test.mjs"
dropin=/etc/systemd/system/levi-binance.service.d/91-market-news.conf
if [[ -e "$dropin" ]] && ! head -n 1 "$dropin" | grep -qx '# LEVI market news configuration'; then
 echo 'An unrecognized service override exists. No installation or restart performed.' >&2
 exit 1
fi
backup="/root/levi-before-market-news-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
tar -czf "$backup/code.tgz" "${existing[@]}"
if [[ -f "$dropin" ]]; then cp -p "$dropin" "$backup/91-market-news.conf"; fi
enabled_after=$(date -u +%Y-%m-%dT%H:%M:%SZ)
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 tar -xzf "$backup/code.tgz" -C /opt/levi-binance
 for file in "${missing[@]}"; do rm -f -- "$file"; done
 if [[ -f "$backup/91-market-news.conf" ]]; then cp -p "$backup/91-market-news.conf" "$dropin"; else rm -f -- "$dropin"; fi
 systemctl daemon-reload
 systemctl start levi-binance
 echo "Verification failed; restored code and route configuration from $backup. Exchange actions already executed cannot be rolled back. Check account and protection." >&2
 exit 1
}
trap rollback ERR
if [[ "$action" == --enable-entry-overlay ]]; then
 echo 'Enabling news-based priority and veto for existing eligible automatic LIVE entries. This can change which real trades the bot makes. Existing risk checks and exits remain active.'
fi
systemctl stop levi-binance
for file in "${files[@]}"; do mkdir -p "$(dirname "$file")"; cp "$stage/$file" "$file"; done
if [[ "$action" != --install-only ]]; then
 mkdir -p "$(dirname "$dropin")"
 enabled=false
 [[ "$action" != --enable-entry-overlay ]] || enabled=true
 cat > "$dropin" <<EOF
# LEVI market news configuration
[Service]
Environment="MARKET_NEWS_ENTRY_OVERLAY=$enabled"
Environment="MARKET_NEWS_ENTRY_AFTER=$enabled_after"
EOF
 chmod 644 "$dropin"
fi
systemctl daemon-reload
systemctl start levi-binance
EXPECTED_NEWS_ACTION="$action" EXPECTED_NEWS_AFTER="$enabled_after" node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:8080/api/market-news',{signal:AbortSignal.timeout(1500)}),d=await r.json(),route=d.config;
  const enabled=process.env.EXPECTED_NEWS_ACTION==='--enable-entry-overlay',disabled=process.env.EXPECTED_NEWS_ACTION==='--disable-entry-overlay';
  const permission=enabled?route?.enabled===true&&route.enabledAfter===Date.parse(process.env.EXPECTED_NEWS_AFTER)&&d.executionEnabled===true:disabled?route?.enabled===false:true;
  if(r.ok&&permission&&d.version==='MARKET_NEWS_V1'&&route?.version==='MARKET_NEWS_V1'&&!route.error&&Array.isArray(d.sources)&&d.sources.length===4&&!d.storageError&&d.collectedAt){ready=true;console.log(JSON.stringify({config:route,executionEnabled:d.executionEnabled,sources:d.sources.map(({name,status,count})=>({name,status,count}))},null,2));break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('News channel installation and requested permission were not verified');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed and verified $revision ($action). Backup: $backup"
echo 'Open /market-news.html to verify source availability. Check account readiness and native protection in the trading app. An enabled news overlay does not guarantee a trade.'
