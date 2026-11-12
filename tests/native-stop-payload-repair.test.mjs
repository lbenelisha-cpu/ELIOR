import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {patch,verify} from '../scripts/repair-native-stop-payload.mjs';
const base=fs.readFileSync(new URL('../lib/binance-native-protection.mjs',import.meta.url),'utf8');
const faulty=base.replaceAll('stopOnly','strategyStopOnly').replace("strategyStopOnly?{symbol,side:'SELL',type:'STOP_LOSS',quantity:plan.quantity,stopPrice:plan.params.belowStopPrice,newClientOrderId:identity('lv-s-'),newOrderRespType:'FULL'}","strategyStopOnly?{...plan.params,newClientOrderId:identity('lv-s-')}");
test('reproduces missing order type and repairs rejected manual and POC stops with identity-safe recovery',async()=>{await assert.rejects(verify(faulty));await verify(patch(faulty));});
test('unknown, repeated and already patched sources abort without mutation',()=>{for(const source of [base,faulty+faulty,patch(faulty)])assert.throws(()=>patch(source),/Unrecognized/);});

test('mixed deployed planner supports native POC stops and OCO fallback for manual trades',async()=>{const mixed=faulty.replaceAll('freshPrice<plan.target','(strategyStopOnly||freshPrice<plan.target)').replace(" return {quantity:decimal(quantity,lot.stepSize),stop,target,params:"," if(p.strategyId==='POC_AUTO_V1')return {quantity:decimal(quantity,lot.stepSize),stop,target:null,params:{symbol,side:'SELL',type:'STOP_LOSS',quantity:decimal(quantity,lot.stepSize),stopPrice:decimal(stop,tick.tickSize),newOrderRespType:'FULL'}};\n return {quantity:decimal(quantity,lot.stepSize),stop,target,params:");await verify(patch(mixed));});
