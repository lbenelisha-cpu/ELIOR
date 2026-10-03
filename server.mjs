import WebSocket from "ws";
import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
import { evaluateWaveStrategy, decidePosition } from "./lib/binance-wave-agent.mjs";

const SYMBOL=(process.env.BINANCE_SYMBOL||"BTCUSDT").toUpperCase(), PORT=Number(process.env.PORT||8080);
const MARKET_API="https://api.binance.com", WS_URL=`wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase()}@trade`;
const MIN_WAVE=Number(process.env.BINANCE_WAVE_MIN_PERCENT||4), MA_PERIOD=Number(process.env.BINANCE_MA_PERIOD||200);
const AUTO_EXEC=String(process.env.BINANCE_AUTO_EXECUTION||"false").toLowerCase()==="true";
const LIVE_ENABLED=String(process.env.BINANCE_LIVE_TRADING_ENABLED||"false").toLowerCase()==="true";
const BUY_PCT=Math.min(100,Math.max(1,Number(process.env.BINANCE_BUY_BALANCE_PERCENT||95)));
const LIVE_MAX_USDT=Math.max(0,Number(process.env.BINANCE_LIVE_MAX_USDT||100));
let tradingMode=(process.env.BINANCE_DEFAULT_MODE||"demo").toLowerCase()==="live"?"live":"demo";
let ws,reconnectTimer,reconnectAttempt=0,lastProcessedCloseTime=null;
let agent={position:"CASH",decision:"WAIT",strategy:null,lastDecisionAt:null,lastOrder:null,lastError:null,execution:"IDLE"};
let stream={status:"starting",lastPrice:null,lastEventAt:null,eventCount:0};
const PAPER_INITIAL_ILS=5000;
let paper={initialIls:PAPER_INITIAL_ILS,cashIls:PAPER_INITIAL_ILS,btc:0,entryPrice:null,position:"CASH",trades:[],lastAction:null};
function paperValue(price){return paper.cashIls+(paper.btc*Number(price||0));}
function paperSnapshot(price){const value=paperValue(price),profit=value-paper.initialIls;return {...paper,valueIls:value,profitIls:profit,profitPct:paper.initialIls?profit/paper.initialIls*100:0};}
function paperApply(decision,price,at){price=Number(price);if(!Number.isFinite(price)||price<=0)return;
 if(decision==='BUY'&&paper.position==='CASH'&&paper.cashIls>0){paper.btc=paper.cashIls/price;paper.entryPrice=price;paper.cashIls=0;paper.position='LONG';paper.lastAction={type:'BUY',price,at};}
 else if(decision==='SELL'&&paper.position==='LONG'&&paper.btc>0){const proceeds=paper.btc*price,pnl=paper.entryPrice?((price-paper.entryPrice)/paper.entryPrice*100):0;paper.trades.unshift({buyPrice:paper.entryPrice,sellPrice:price,pnlPct:pnl,at});paper.trades=paper.trades.slice(0,50);paper.cashIls=proceeds;paper.btc=0;paper.entryPrice=null;paper.position='CASH';paper.lastAction={type:'SELL',price,at};}}
function resetPaper(){paper={initialIls:PAPER_INITIAL_ILS,cashIls:PAPER_INITIAL_ILS,btc:0,entryPrice:null,position:'CASH',trades:[],lastAction:null};}
const envFor=m=>m==='demo'?{base:"https://testnet.binance.vision",key:process.env.BINANCE_DEMO_API_KEY,secret:process.env.BINANCE_DEMO_API_SECRET}:{base:"https://api.binance.com",key:process.env.BINANCE_LIVE_API_KEY,secret:process.env.BINANCE_LIVE_API_SECRET};
const log=(...x)=>console.log(new Date().toISOString(),...x);

function connect(){clearTimeout(reconnectTimer);stream.status='connecting';ws=new WebSocket(WS_URL);ws.on('open',()=>{reconnectAttempt=0;stream.status='connected';log('Binance market stream connected')});ws.on('message',r=>{try{const m=JSON.parse(r);if(m.e==='trade'){stream.lastPrice=Number(m.p);stream.lastEventAt=new Date(m.E).toISOString();stream.eventCount++}}catch{}});ws.on('close',()=>{stream.status='disconnected';scheduleReconnect()});ws.on('error',e=>agent.lastError=e.message)}
function scheduleReconnect(){if(reconnectTimer)return;const d=Math.min(30000,1000*2**Math.min(reconnectAttempt++,5));reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect()},d)}
async function publicJSON(path){const r=await fetch(MARKET_API+path);if(!r.ok)throw new Error(`Binance market ${r.status}`);return r.json()}
async function closedDailyCandles(){const rows=await publicJSON(`/api/v3/klines?symbol=${SYMBOL}&interval=1d&limit=${Math.max(250,MA_PERIOD+30)}`);const now=Date.now();return rows.filter(r=>Number(r[6])<now).map(r=>({openTime:+r[0],closeTime:+r[6],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5]}))}
async function signed(mode,method,path,params={}){const e=envFor(mode);if(!e.key||!e.secret)throw new Error(`${mode.toUpperCase()} API keys are not configured`);const q=new URLSearchParams({...params,timestamp:String(Date.now()),recvWindow:'5000'});q.set('signature',crypto.createHmac('sha256',e.secret).update(q.toString()).digest('hex'));const r=await fetch(`${e.base}${path}?${q}`,{method,headers:{'X-MBX-APIKEY':e.key}});const data=await r.json();if(!r.ok)throw new Error(data.msg||`Binance ${r.status}`);return data}
async function balances(mode){const a=await signed(mode,'GET','/api/v3/account');const m=Object.fromEntries(a.balances.map(x=>[x.asset,+x.free]));return {BTC:m.BTC||0,USDT:m.USDT||0}}
async function exchangeInfo(){const x=await publicJSON(`/api/v3/exchangeInfo?symbol=${SYMBOL}`),lot=x.symbols[0].filters.find(f=>f.filterType==='LOT_SIZE');return {stepSize:+lot.stepSize,minQty:+lot.minQty}}
const floorStep=(v,s)=>Math.floor(v/s)*s;
async function execute(decision){const mode=tradingMode;if(!AUTO_EXEC)return {skipped:true,reason:'BINANCE_AUTO_EXECUTION=false'};if(mode==='live'&&!LIVE_ENABLED)return {skipped:true,reason:'LIVE is locked'};const b=await balances(mode);
 if(decision==='BUY'){let spend=b.USDT*(BUY_PCT/100);if(mode==='live')spend=Math.min(spend,LIVE_MAX_USDT);if(spend<5)throw new Error('Not enough USDT / live cap too small');return signed(mode,'POST','/api/v3/order',{symbol:SYMBOL,side:'BUY',type:'MARKET',quoteOrderQty:spend.toFixed(2),newOrderRespType:'FULL'})}
 if(decision==='SELL'){const {stepSize,minQty}=await exchangeInfo(),qty=floorStep(b.BTC,stepSize);if(qty<minQty)throw new Error('No sellable BTC balance');return signed(mode,'POST','/api/v3/order',{symbol:SYMBOL,side:'SELL',type:'MARKET',quantity:qty.toFixed(8),newOrderRespType:'FULL'})}}

async function evaluate(force=false){try{const candles=await closedDailyCandles(),last=candles.at(-1);if(!last)return;if(!force&&last.closeTime===lastProcessedCloseTime)return;const strategy=evaluateWaveStrategy(candles,{minWave:MIN_WAVE,maPeriod:MA_PERIOD});let position=agent.position;try{const b=await balances(tradingMode);position=b.BTC*strategy.price>5?'LONG':'CASH'}catch{}
 const decision=decidePosition(strategy,position);agent={...agent,position,decision,strategy,lastDecisionAt:new Date().toISOString(),lastError:null};lastProcessedCloseTime=last.closeTime;
 if(tradingMode==='demo')paperApply(decision,strategy.price,new Date(last.closeTime).toISOString());
 if(decision==='BUY'||decision==='SELL'){agent.execution='PENDING';const result=await execute(decision);agent.lastOrder={mode:tradingMode,decision,result,at:new Date().toISOString()};agent.execution=result?.skipped?'DRY_RUN':'EXECUTED';if(!result?.skipped)agent.position=decision==='BUY'?'LONG':'CASH'}else agent.execution='IDLE';
 }catch(e){agent.lastError=e.message;agent.execution='ERROR';log('Wave agent error',e.message)}}
setInterval(()=>evaluate(false),5*60*1000).unref();

const server=http.createServer((req,res)=>{
 const staticFiles={'/binance-agent.html':['binance-agent.html','text/html; charset=utf-8'],'/binance-agent.js':['binance-agent.js','text/javascript; charset=utf-8'],'/binance-agent.css':['binance-agent.css','text/css; charset=utf-8']};
 if(req.method==='GET'&&staticFiles[req.url]){const [name,type]=staticFiles[req.url];try{const data=fs.readFileSync(path.join(__dirname,name));res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});return res.end(data)}catch(e){res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({error:'Static file missing',file:name}))}}
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
 if(u.pathname==='/api/binance-mode'&&req.method==='GET'){const e=envFor(tradingMode);return res.end(JSON.stringify({mode:tradingMode,liveTradingEnabled:LIVE_ENABLED,autoExecution:AUTO_EXEC,keysConfigured:Boolean(e.key&&e.secret),liveMaxUsdt:LIVE_MAX_USDT,demo:{environment:'Binance Spot Testnet'},live:{environment:'Binance Spot',armed:LIVE_ENABLED}}))}
 if(u.pathname==='/api/binance-mode'&&req.method==='POST'){let raw='';req.on('data',c=>raw+=c);req.on('end',async()=>{try{const m=JSON.parse(raw||'{}').mode;if(!['demo','live'].includes(m))throw new Error('mode must be demo or live');tradingMode=m;lastProcessedCloseTime=null;await evaluate(true);res.end(JSON.stringify({ok:true,mode:tradingMode}))}catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message}))}});return}
 if(u.pathname==='/api/binance-paper'&&req.method==='GET')return res.end(JSON.stringify(paperSnapshot(agent.strategy?.price||stream.lastPrice)));
 if(u.pathname==='/api/binance-paper/reset'&&req.method==='POST'){resetPaper();return res.end(JSON.stringify({ok:true,paper:paperSnapshot(agent.strategy?.price||stream.lastPrice)}))}
 if(u.pathname==='/api/binance-agent'&&req.method==='GET')return res.end(JSON.stringify({symbol:SYMBOL,mode:tradingMode,stream,agent,paper:paperSnapshot(agent.strategy?.price||stream.lastPrice),config:{timeframe:'1d closed candles',minWave:MIN_WAVE,maPeriod:MA_PERIOD,longOnly:true,autoExecution:AUTO_EXEC,liveTradingEnabled:LIVE_ENABLED,liveMaxUsdt:LIVE_MAX_USDT}}));
 if(u.pathname==='/api/binance-agent/evaluate'&&req.method==='POST'){evaluate(true).then(()=>res.end(JSON.stringify({ok:true,agent}))).catch(e=>{res.writeHead(500);res.end(JSON.stringify({ok:false,error:e.message}))});return}
 if(u.pathname==='/'||u.pathname==='/health')return res.end(JSON.stringify({ok:stream.status==='connected',stream,agent,mode:tradingMode}));res.writeHead(404);res.end(JSON.stringify({error:'Not found'}));
});
server.listen(PORT,'0.0.0.0',()=>{log(`Server ${PORT}`);connect();evaluate(true)});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));process.on('SIGINT',()=>server.close(()=>process.exit(0)));
