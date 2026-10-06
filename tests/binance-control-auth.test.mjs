import test from 'node:test';
import assert from 'node:assert/strict';
import {controlAuthorized} from '../lib/binance-control-auth.mjs';
test('live controls deny absent configuration, missing or incorrect bearer credentials',()=>{
  const token='a'.repeat(40);
  for(const [header,key] of [[undefined,token],['Bearer '+token,undefined],['Bearer short','short'],['Bearer '+'b'.repeat(40),token],['Basic '+token,token]])assert.equal(controlAuthorized(header,key),false);
  assert.equal(controlAuthorized('Bearer '+token,token),true);
});
