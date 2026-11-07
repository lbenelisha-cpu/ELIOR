import fs from 'node:fs';
export function assertNoPendingEntry({spotPending,journal}){
 // Spot stores the intent directly in .pending; Futures stores it under .pending.
 if(fs.existsSync(spotPending)&&JSON.parse(fs.readFileSync(spotPending,'utf8')))throw Error('SPOT_PENDING_ORDER_RETRY_LATER');
 if(fs.existsSync(journal)&&JSON.parse(fs.readFileSync(journal,'utf8')).pending)throw Error('SHORT_PENDING_ORDER_RETRY_LATER');
}
