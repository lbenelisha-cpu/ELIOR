#!/usr/bin/env bash
# Install continuous recording on the VPS. The dashboard frontend is served by Netlify.
set -euo pipefail
revision=${1:?Pass the full release SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
base=29ea3caf8e5c83af896af014005075f6d0344ee9
app_dir=/opt/levi-binance
# Some installations are working trees. Others run copied files next to a separate checkout.
if git -C "$app_dir" cat-file -e "$revision:server.mjs" 2>/dev/null; then
  repo=$app_dir
else
  repo=$(git rev-parse --show-toplevel)
fi
git -C "$repo" cat-file -e "$revision:scripts/verify-binance-equity.mjs"
cd "$app_dir"
systemctl is-active --quiet levi-binance
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/app/lib" "$stage/app/tests"
git -C "$repo" show "$base:server.mjs" > "$stage/base.mjs"
git -C "$repo" show "$revision:server.mjs" > "$stage/release.mjs"
cp server.mjs "$stage/app/"
node --input-type=module - "$stage" <<'JS'
import fs from 'node:fs';
const stage=process.argv[2];
const base=fs.readFileSync(stage+'/base.mjs','utf8');
const release=fs.readFileSync(stage+'/release.mjs','utf8');
const path=stage+'/app/server.mjs';
let installed=fs.readFileSync(path,'utf8');
function one(source,pattern,name){
  const matches=[...source.matchAll(new RegExp(pattern.source,'gm'))];
  if(matches.length!==1)throw Error('Cannot identify unique '+name);
  return matches[0][0];
}
function upgrade(original,updated,name){
  const occurrences=part=>installed.split(part).length-1;
  if(occurrences(updated)===1&&occurrences(original)===0)return;
  if(occurrences(original)!==1||occurrences(updated)!==0)throw Error('Unrecognized installed '+name);
  installed=installed.replace(original,()=>updated);
}
// Match only the import, sampler/timers and endpoint, independently of neighboring
// routes and modules added or updated since the repository release.
const imports=/^import \{[^\n}]*\bEquityHistory\b[^\n}]*\} from ['"]\.\/lib\/binance-equity-history\.mjs['"];$/;
upgrade(one(base,imports,'equity import'),one(release,imports,'release equity import'),'equity import');
const oldTimers=/^if\(KEYS_CONFIGURED\)\{\n  setTimeout\(\(\)=>sampleEquity\(\),5000\)\.unref\(\);\n  setInterval\(\(\)=>sampleEquity\(\),60000\)\.unref\(\);\n\}/;
const recorder=/^const futuresEquityHistory=new EquityHistory\(\{[\s\S]*?^  setInterval\(sampleBothAccounts,60000\)\.unref\(\);\n\}/;
upgrade(one(base,oldTimers,'Spot sampler timers'),one(release,recorder,'Futures recorder'),'equity sampler');
const route=/^  if\(u\.pathname==='\/api\/binance-equity-history'&&req\.method==='GET'\)(?:return send\(res,equityHistory\.today\(\)\);|\{\n[\s\S]*?^  \})/;
upgrade(one(base,route,'Spot history route'),one(release,route,'release history route'),'equity history route');
if(!/^\s*(?:const|let)\s+pnlReadApi\s*=\s*new\s+FuturesShortAPI\s*\(/m.test(installed))
  throw Error('Installed server lacks the expected authenticated Futures account reader');
fs.writeFileSync(path,installed);
JS

lib=lib/binance-equity-history.mjs
cp "$lib" "$stage/app/$lib"
git -C "$repo" diff --no-ext-diff --no-color "$base" "$revision" -- "$lib" > "$stage/library.patch"
if git -C "$stage/app" apply --check "$stage/library.patch" 2>/dev/null; then
  git -C "$stage/app" apply "$stage/library.patch"
else
  git -C "$stage/app" apply --reverse --check "$stage/library.patch" || {
    echo "Installed $lib differs at the edited lines. No files installed." >&2
    exit 1
  }
fi
git -C "$repo" show "$revision:tests/binance-equity-history.test.mjs" > "$stage/app/tests/binance-equity-history.test.mjs"
git -C "$repo" show "$revision:scripts/verify-binance-equity.mjs" > "$stage/verify.mjs"
node --check "$stage/app/server.mjs"
node --check "$stage/verify.mjs"
node --test "$stage/app/tests/binance-equity-history.test.mjs"

changed=()
for file in server.mjs "$lib"; do
  if ! cmp -s "$file" "$stage/app/$file"; then changed+=("$file"); fi
done
report_sample(){
  node "$stage/verify.mjs" --first-futures-sample || echo "Futures sample verification could not be completed." >&2
}
if (( ${#changed[@]} == 0 )); then
  node "$stage/verify.mjs" --verify-series
  echo 'Portfolio history is already installed.'
  report_sample
  exit 0
fi

backup=$(mktemp -d /root/levi-before-futures-equity.XXXXXXXX)
for file in "${changed[@]}"; do cp -p --parents "$file" "$backup/"; done
rollback(){
  trap - ERR
  set +e
  systemctl stop levi-binance
  for file in "${changed[@]}"; do cp -p "$backup/$file" "$file"; done
  systemctl start levi-binance
  echo "Restored previous application files from $backup." >&2
  exit 1
}
trap rollback ERR
systemctl stop levi-binance
for file in "${changed[@]}"; do cp "$stage/app/$file" "$file"; done
systemctl start levi-binance
verified=false
for attempt in {1..10}; do
  if node "$stage/verify.mjs" --verify-series 2>"$stage/verify.err"; then verified=true; break; fi
  sleep 1
done
if [[ "$verified" != true ]]; then
  cat "$stage/verify.err" >&2
  rollback
fi
systemctl is-active --quiet levi-binance
trap - ERR
echo "Installed portfolio history. Previous code: $backup"
report_sample
