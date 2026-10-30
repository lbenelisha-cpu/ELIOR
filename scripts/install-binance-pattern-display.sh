#!/usr/bin/env bash
# Display-only patch: preserve the installed trading engine and service settings.
set -euo pipefail
revision=${1:?Pass the reviewed full commit SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
cd /opt/levi-binance
systemctl is-active --quiet levi-binance
git cat-file -e "$revision^{commit}"
stage=$(mktemp -d /tmp/levi-pattern-display.XXXXXX)
trap 'rm -rf "$stage"' EXIT
files=(binance-agent.html binance-agent.js resistance-patterns.js regression-trend.js)
for file in "${files[@]}"; do git show "$revision:$file" > "$stage/$file"; done
mkdir "$stage/tests"
git show "$revision:tests/resistance-patterns.test.mjs" > "$stage/tests/resistance-patterns.test.mjs"
git show "$revision:tests/regression-trend.test.mjs" > "$stage/tests/regression-trend.test.mjs"
cp server.mjs "$stage/server.mjs"
node --input-type=module - "$stage/server.mjs" <<'JS'
import fs from 'node:fs';
const file=process.argv[2],source=fs.readFileSync(file,'utf8'),anchor='  const sf={',route="    '/resistance-patterns.js':['resistance-patterns.js','text/javascript'],";
if(!source.includes("'/binance-agent.js':['binance-agent.js','text/javascript']")||source.split(anchor).length!==2)throw Error('Unrecognized installed static file map; no files changed');
let patched=source;
for(const asset of ['resistance-patterns','regression-trend']){
 const route="    '/"+asset+".js':['"+asset+".js','text/javascript'],";
if(!patched.includes(route)){
 if(patched.includes("'/"+asset+".js'"))throw Error('Conflicting route; no files changed');
 patched=patched.replace(anchor,anchor+'\n'+route);
}
}
fs.writeFileSync(file,patched);
JS
node --check "$stage/server.mjs"
node --check "$stage/binance-agent.js"
node --check "$stage/resistance-patterns.js"
node --check "$stage/regression-trend.js"
node --test "$stage/tests/resistance-patterns.test.mjs" "$stage/tests/regression-trend.test.mjs"
backup="/root/levi-before-pattern-display-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -m 700 "$backup"
existing=(server.mjs); missing=()
for file in "${files[@]}"; do if [[ -f "$file" ]]; then existing+=("$file"); else missing+=("$file"); fi; done
tar -czf "$backup/code.tgz" "${existing[@]}"
rollback(){
 trap - ERR
 set +e
 tar -xzf "$backup/code.tgz" -C /opt/levi-binance
 for file in "${missing[@]}"; do rm -f -- "$file"; done
 systemctl restart levi-binance
 echo "Display verification failed; restored files from $backup" >&2
 exit 1
}
trap rollback ERR
for file in "${files[@]}" server.mjs; do cp "$stage/$file" "$file"; done
systemctl restart levi-binance
node --input-type=module - <<'JS'
let ready=false;
for(let i=0;i<20;i++){
 try{
  const base='http://127.0.0.1:8080';
  const [page,module]=await Promise.all(['/binance-agent.html','/regression-trend.js'].map(async p=>{const r=await fetch(base+p,{signal:AbortSignal.timeout(1500)});if(!r.ok)throw Error('HTTP '+r.status);return r.text();}));
  if(page.includes('patternScenario')&&module.includes('LEVI_REGRESSION')){ready=true;break;}
 }catch{}
 await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw Error('Chart display assets not served');
JS
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed chart patterns and scenarios from $revision. Backup: $backup"
echo 'Refresh the Binance chart. Trading rules and service environment were not changed.'
