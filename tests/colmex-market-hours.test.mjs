import test from 'node:test';import assert from 'node:assert/strict';
import {marketHours,equitySession} from '../lib/colmex-market-hours.mjs';
const at=s=>Date.parse(s);
test('regular US session opens and closes at exact boundaries',()=>{
 assert.equal(marketHours(at('2026-10-20T13:29:59Z')).open,false);
 assert.equal(marketHours(at('2026-10-20T13:30:00Z')).open,true);
 assert.equal(marketHours(at('2026-10-20T20:00:00Z')).open,false);
 assert.equal(marketHours(at('2026-10-24T15:00:00Z')).open,false);
});
test('Israel display hours follow both daylight-saving transitions instead of a fixed offset',()=>{
 const il=t=>new Date(t).toLocaleTimeString('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'});
 assert.equal(il(equitySession('2026-10-20').openAt),'16:30');
 assert.equal(il(equitySession('2026-10-27').openAt),'15:30');
 assert.equal(il(equitySession('2026-11-03').openAt),'16:30');
});
test('official holidays, half days, and next openings are reflected',()=>{
 assert.equal(marketHours(at('2026-11-26T17:00:00Z')).open,false);
 assert.equal(marketHours(at('2026-11-26T17:00:00Z')).nextOpenAt,at('2026-11-27T14:30:00Z'));
 assert.equal(marketHours(at('2026-11-27T17:59:59Z')).open,true);
 assert.equal(marketHours(at('2026-11-27T18:00:00Z')).open,false);
 assert.equal(equitySession('2026-12-24').closeAt,at('2026-12-24T18:00:00Z'));
 assert.equal(equitySession('2027-12-31').closed,false);
 assert.equal(equitySession('2028-07-03').closeAt,at('2028-07-03T17:00:00Z'));
});
test('unsupported calendar years cannot falsely display an open-market signal',()=>{
 assert.equal(marketHours(at('2029-01-02T17:00:00Z')).known,false);
 assert.equal(marketHours(at('2029-01-02T17:00:00Z')).open,false);
});
