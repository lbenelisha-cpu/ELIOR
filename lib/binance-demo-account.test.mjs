import {test} from 'node:test';
import assert from 'node:assert/strict';
import {valueBalances,getDemoAccount} from './binance-demo-account.mjs';
test('includes USDT, USDC, locked funds and bridged assets; reports unknown prices',()=>{
 const result=valueBalances([{asset:'USDT',free:'5000',locked:'0'},{asset:'USDC',free:'4900',locked:'100'},{asset:'ABC',free:'2',locked:'1'},{asset:'UNKNOWN',free:'1',locked:'0'}],[{symbol:'USDCUSDT',price:'1.000352'},{symbol:'ABCBTC',price:'0.001'},{symbol:'BTCUSDT',price:'80000'}]);
 assert.ok(Math.abs(result.totalValueUsdt-10241.76)<1e-8);assert.deepEqual(result.unpricedAssets,['UNKNOWN']);
});
test('uses demo origin exclusively and signs account GET',async()=>{
 const urls=[];
 const fetcher=async(url)=>{urls.push(url);return {ok:true,json:async()=>url.includes('/time')?{serverTime:123}:url.includes('/account?')?{balances:[{asset:'USDT',free:'5',locked:'0'}]}:[]};};
 const a=await getDemoAccount({key:'test',secret:'test',fetcher});
 assert.equal(a.totalValueUsdt,5);assert.ok(urls.every(u=>u.startsWith('https://demo-api.binance.com/')));assert.match(urls[1],/signature=[a-f0-9]{64}/);
});
test('missing demo keys does not fall back to live credentials',async()=>{await assert.rejects(getDemoAccount({}),/API/);});
test('malformed account data cannot be interpreted as an empty reset account',async()=>{
 assert.throws(()=>valueBalances(undefined,[]),/Invalid/);
 for(const free of ['NaN','Infinity','-1',null])assert.throws(()=>valueBalances([{asset:'BTC',free,locked:'0'}],[]),/Invalid/);
 const fetcher=async(url)=>({ok:true,json:async()=>url.includes('/time')?{serverTime:123}:url.includes('/account?')?{}:[]});
 await assert.rejects(getDemoAccount({key:'test',secret:'test',fetcher}),/Invalid/);
});
