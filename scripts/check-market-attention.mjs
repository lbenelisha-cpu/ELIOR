// Read-only post-deploy check. Prints only observer health, not holdings or orders.
import fs from 'node:fs';
const file=process.argv[2]||'/var/data/binance-live-actions.json.strategy-review';
const root=JSON.parse(fs.readFileSync(file,'utf8')).marketAttention;
if(root?.version!=='MARKET_ATTENTION_V1')throw Error('Observer state has not been saved yet');
const now=Date.now(),rows=Object.values(root.observations||{}),reasons={};
for(const row of rows)reasons[row.reason]=(reasons[row.reason]||0)+1;
console.log(JSON.stringify({version:root.version,observedSymbols:rows.length,freshTechnical:rows.filter(r=>r.ready&&r.expiresAt>now&&r.checkedAt<=now).length,recordedTransitions:root.events?.length||0,lastCheckedAt:new Date(Math.max(...rows.map(r=>r.checkedAt))).toISOString(),reasons},null,2));
