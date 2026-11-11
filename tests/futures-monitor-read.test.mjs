import test from 'node:test';import assert from 'node:assert/strict';
import {FuturesShortAPI} from '../lib/futures-short-api.mjs';
test('monitor position-risk GET is signed; writes and unrelated endpoints stay blocked',async()=>{
 const calls=[];const api=new FuturesShortAPI({key:'test',secret:'test',now:()=>1000,fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>[]};}});
 await api.get('/fapi/v2/positionRisk');assert.equal(calls.length,1);assert.match(calls[0].url,/positionRisk.*signature=/);assert.equal(calls[0].opts.method,'GET');
 await assert.rejects(api.post('/fapi/v2/positionRisk'),/FUTURES_ENDPOINT_FORBIDDEN/);await assert.rejects(api.get('/fapi/v2/unknown'),/FUTURES_ENDPOINT_FORBIDDEN/);assert.equal(calls.length,1);
});
