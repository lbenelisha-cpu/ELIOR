#!/usr/bin/env bash
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-live-monitor.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/release" "$stage/runtime"
git archive "$revision" | tar -x -C "$stage/release"
files=(server.mjs binance-agent.html binance-agent.js binance-live-monitor.js binance-live-monitor.css)
for file in "${files[@]}"; do
  mkdir -p "$stage/runtime/$(dirname "$file")"
  cp "$stage/release/$file" "$stage/runtime/$file"
  case "$file" in *.mjs|*.js) node --check "$stage/runtime/$file";; esac
done
backup="/root/levi-before-live-monitor-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
existing=();missing=()
for file in "${files[@]}"; do
  mkdir -p "$backup/$(dirname "$file")"
  if [[ -f "$file" ]]; then cp -a "$file" "$backup/$file"; existing+=("$file"); else missing+=("$file"); fi
done
rollback(){
  trap - ERR
  set +e
  systemctl stop levi-binance
  for file in "${existing[@]}"; do cp -a "$backup/$file" "$file"; done
  for file in "${missing[@]}"; do rm -f -- "$file"; done
  systemctl start levi-binance
  echo "Restored previous files from $backup; settings, live journals, and demo history were retained." >&2
  exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do
  mkdir -p "$(dirname "$file")"
  install -m 0644 "$stage/runtime/$file" "$file"
done
systemctl start levi-binance
node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
  try{
    const [mode,page,script]=await Promise.all([
      fetch('http://127.0.0.1:8080/api/binance-mode',{signal:AbortSignal.timeout(1500)}),
      fetch('http://127.0.0.1:8080/binance-agent.html',{signal:AbortSignal.timeout(1500)}),
      fetch('http://127.0.0.1:8080/binance-live-monitor.js',{signal:AbortSignal.timeout(1500)})
    ]);
    const [m,h,j]=await Promise.all([mode.json(),page.text(),script.text()]);
    if(mode.ok&&page.ok&&script.ok&&m.pocAutoTrading?.version==='POC_LIVE_V1'&&h.includes('pocLiveMonitor')&&j.includes('/api/binance-poc-live-monitor')){ready=true;break;}
  }catch{}
  await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('LIVE monitor health check failed');
console.log(JSON.stringify({installed:true,liveOnly:true,demoHistoryPreserved:true,configurationChanged:false}));
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed LIVE account monitor $revision. Backup: $backup"
echo "The installer did not change trading flags, settings, balances, journals, or demo history."
