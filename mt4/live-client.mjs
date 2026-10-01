import {readFile} from 'node:fs/promises';
import {analyzeQuotes} from './monitor.mjs';
export function validateLiveSnapshot(d,now=Date.now()){
 if(d?.version!==1||String(d.account?.login)!=='639367'||d.account?.server!=='TGLColmex-Live'||d.account?.currency!=='USD'||d.account?.type!=='real')throw Error('Unexpected account');
 if(!Number.isFinite(d.capturedAt)||Math.abs(now/1000-d.capturedAt)>30)throw Error('Stale snapshot');
 if(typeof d.connected!=='boolean'||!Array.isArray(d.positions)||d.positions.length>500||!Array.isArray(d.symbols)||d.symbols.length>600)throw Error('Invalid snapshot');
 for(const k of ['balance','equity','profit'])if(!Number.isFinite(d.account[k]))throw Error('Invalid balance');
 for(const p of d.positions)if(!Number.isInteger(p.ticket)||typeof p.symbol!=='string'||![p.lots,p.profit].every(Number.isFinite)||p.lots<=0||!Number.isInteger(p.type))throw Error('Invalid position');
 const stocks=d.symbols.filter(x=>x.profitMode===1&&x.contractSize===1&&/^CFD /i.test(x.description||'')&&!/index|indices|oil|gas|gold|silver|cocoa|coffee|bond|ETF/i.test(x.description||''));
 const contracts=stocks.map(x=>({symbol:x.symbol,description:x.description,minimumNotionalUSD:x.profitCurrency==='USD'&&Number.isFinite(x.minLot)&&x.minLot>0&&Number.isFinite(x.ask)&&x.ask>0?x.minLot*x.contractSize*x.ask:null}));
 return {receivedAt:new Date(d.capturedAt*1000).toISOString(),connected:d.connected,readOnly:true,account:{...d.account,balance:d.connected?d.account.balance:null,equity:d.connected?d.account.equity:null,profit:d.connected?d.account.profit:null},positions:d.connected?d.positions:null,budget:150,target:120,executionEnabled:false,quotes:d.connected?analyzeQuotes(stocks,now/1000):[],contracts:d.connected?contracts:[]};
}
export class LiveFileClient{
 constructor(path){this.path=path;}
 async snapshot(){return validateLiveSnapshot(JSON.parse(await readFile(this.path,'utf8')));}
}

