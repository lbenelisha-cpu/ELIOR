#!/usr/bin/env bash
# Display and RSS fix only; preserve all trading flags, journals and settings.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-short-table-news.XXXXXX)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/tests"
cp -a lib "$stage/lib"
files=(binance-agent.html binance-agent.js binance-futures-positions.js market-news.js lib/market-news.mjs)
for file in "${files[@]}" tests/market-news.test.mjs tests/futures-positions-ui.test.mjs; do
 mkdir -p "$stage/$(dirname "$file")"
 git show "$revision:$file" > "$stage/$file"
done
cp server.mjs "$stage/server.mjs"
node --input-type=module - "$stage/server.mjs" <<'JS'
import fs from 'node:fs';
const file=process.argv[2],before="    '/binance-agent.js':['binance-agent.js','text/javascript'],",line="    '/binance-futures-positions.js':['binance-futures-positions.js','text/javascript'],";
const s=fs.readFileSync(file,'utf8');
if(!s.includes(line)){
 if(s.split(before).length!==2)throw Error('Unrecognized static-file routing; no installation performed');
 fs.writeFileSync(file,s.replace(before,before+'\n'+line));
}
JS
files+=(server.mjs)
for file in "${files[@]}"; do case "$file" in *.js|*.mjs) node --check "$stage/$file";; esac; done
node --test "$stage/tests/market-news.test.mjs" "$stage/tests/futures-positions-ui.test.mjs"
backup="/root/levi-before-short-table-news-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
existing=(); missing=()
for file in "${files[@]}"; do if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi; done
tar -czf "$backup/code.tgz" "${existing[@]}"
rollback(){
 trap - ERR
 set +e
 systemctl stop levi-binance
 tar -xzf "$backup/code.tgz" -C /opt/levi-binance
 for file in "${missing[@]}"; do rm -f -- "$file"; done
 systemctl start levi-binance
 echo "Restored code from $backup. Trading journals and configuration were retained." >&2
 exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${files[@]}"; do mkdir -p "$(dirname "$file")"; cp "$stage/$file" "$file"; done
systemctl start levi-binance
node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{
  const r=await fetch('http://127.0.0.1:8080/api/market-news',{signal:AbortSignal.timeout(1500)}),d=await r.json();
  const source=d.sources?.find(x=>x.id==='coindesk');
  const asset=await fetch('http://127.0.0.1:8080/binance-futures-positions.js',{signal:AbortSignal.timeout(1500)});
  if(r.ok&&asset.ok&&source?.url==='https://www.coindesk.com/arc/outboundfeeds/rss'&&source?.feedUrl===source.url){
   ready=true;console.log(JSON.stringify({installed:true,shortTable:true,coindesk:source,tradingSettingsChanged:false},null,2));break;
  }
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Updated service could not be verified');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed $revision. Backup: $backup"
echo 'Refresh the app: active SHORT positions appear in Overview and My Portfolio. Check CoinDesk status above; installation alone does not guarantee external source availability.'
