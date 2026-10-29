#!/usr/bin/env bash
# Reviewed runtime files only. Preserve credentials, trading flags and position journals.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-confirmed-quality.XXXXXX)
trap 'rm -rf "$stage"' EXIT
files=("scripts/audit-wyckoff-recovery.mjs")
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
STAGED_QUALITY="$stage/lib/confirmed-entry-quality.mjs" STAGED_RISK="$stage/lib/confirmed-risk-sizing.mjs" STAGED_RESEARCH="$stage/lib/trading-research.mjs" node --input-type=module - <<'JS'
const {BINANCE_CONFIRMED_POLICY}=await import(process.env.STAGED_QUALITY);
const {sizeRisk}=await import(process.env.STAGED_RISK);
const {RESEARCH_PROTOCOL,tradingResearchReport}=await import(process.env.STAGED_RESEARCH);
if(RESEARCH_PROTOCOL.version!=='TRADING_RESEARCH_V1'||tradingResearchReport({}).protocol.mode!=='OBSERVATION_ONLY')throw Error('Research runtime check failed');
if(BINANCE_CONFIRMED_POLICY.version!=='BINANCE_CONFIRMED_QUALITY_V2'||BINANCE_CONFIRMED_POLICY.stopLossPolicy!=='SETTINGS_ONLY_V1'||BINANCE_CONFIRMED_POLICY.recoveryRule!=='SECOND_RECOVERY_HIGHER_V1')throw Error('Wrong policy');
const p=sizeRisk(100,20,{stopLossPct:2},{version:BINANCE_CONFIRMED_POLICY.version,atr:5,structureLow:90});
if(p.reason!=='READY'||p.settings.stopLossPct!==2||p.riskPlan.stopLossPolicy!=='SETTINGS_ONLY_V1'||p.budget!==10||p.budget*p.settings.stopLossPct/100>.200001)throw Error('Settings-only stop smoke failed');
JS
backup="/root/levi-before-confirmed-quality-$(date +%Y%m%d-%H%M%S).tgz"
tar -czf "$backup" "${existing[@]}"
rollback(){
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
for file in "${files[@]}"; do mkdir -p "$(dirname "$file")"; cp "$stage/$file" "$file"; done
systemctl start levi-binance
node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<15;i++){
 try{
  const r=await fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  if(r.ok&&d.entryPolicyVersion==='BINANCE_CONFIRMED_QUALITY_V2'&&d.confirmedQuality?.stopLossPolicy==='SETTINGS_ONLY_V1'&&d.confirmedQuality?.recoveryRule==='SECOND_RECOVERY_HIGHER_V1'&&d.researchMonitoring?.version==='TRADING_RESEARCH_V1'){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('New runtime policy was not verified');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed and verified $revision. Backup: $backup"
