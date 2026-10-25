import fs from 'node:fs';
export function readLiveJournal(file){
  if(!fs.existsSync(file))throw Error('LIVE_JOURNAL_MISSING');
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(rows)||rows.some(a=>!a||typeof a!=='object'||Array.isArray(a)))throw Error('LIVE_JOURNAL_INVALID');
  for(const a of rows){
    if(['BUY','SELL'].includes(a.type)&&(!a.symbol||!Number.isFinite(Number(a.qty))||!(Number(a.qty)>0)||!(Number(a.price)>0)))throw Error('LIVE_JOURNAL_INVALID_FILL');
    if(a.type==='POSITION_RECONCILIATION'&&(!a.symbol||!a.entryAt||!Number.isFinite(a.qty)||a.qty<0||!(a.previousQty>a.qty)))throw Error('LIVE_JOURNAL_INVALID_ADJUSTMENT');
  }
  return rows;
}
