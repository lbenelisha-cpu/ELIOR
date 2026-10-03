import WebSocket from "ws";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {URL} from "node:url";
import {evaluateWaveStrategy,decidePosition} from "./lib/binance-wave-agent.mjs";


function markPaperToMarketExact(paperState, streamMap = {}) {
  let positionsValueIls = 0;

  for (const [symbol, pos] of Object.entries(paperState.positions || {})) {
    const entryPrice = Number(pos.entryPrice || 0);
    const allocationIls = Number(pos.allocationIls || 0);
    const qty = Number(pos.qty || 0);
    const livePrice = Number(streamMap?.[symbol]?.lastPrice);

    const currentPrice =
      Number.isFinite(livePrice) && livePrice > 0
        ? livePrice
        : entryPrice;

    let currentValueIls = allocationIls;

    if (entryPrice > 0 && currentPrice > 0 && allocationIls >= 0) {
      currentValueIls = allocationIls * (currentPrice / entryPrice);
    } else if (qty > 0 && currentPrice > 0 && entryPrice > 0) {
      currentValueIls = allocationIls * (currentPrice / entryPrice);
    }

    const pnlIls = currentValueIls - allocationIls;
    const pnlPct = allocationIls > 0 ? (pnlIls / allocationIls) * 100 : 0;

    pos.currentPrice = currentPrice;
    pos.currentValueIls = currentValueIls;
    pos.pnlIls = pnlIls;
    pos.pnlPct = pnlPct;
    pos.allocationIls = allocationIls;
    pos.qty = qty;

    positionsValueIls += currentValueIls;
  }

  paperState.activePositions = Object.keys(paperState.positions || {}).length;
  paperState.positionsValueIls = positionsValueIls;
  paperState.valueIls = Number(paperState.cashIls || 0) + positionsValueIls;
  paperState.profitIls = paperState.valueIls - Number(paperState.initialIls || 0);
  paperState.profitPct = Number(paperState.initialIls || 0) > 0
    ? (paperState.profitIls / Number(paperState.initialIls)) * 100
    : 0;

  return paperState;
}


const FALLBACK_USDT_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','XRPUSDT','SOLUSDT',
  'DOGEUSDT','ADAUSDT','TRXUSDT','LINKUSDT','AVAXUSDT',
  'SUIUSDT','LTCUSDT','BCHUSDT','DOTUSDT','NEARUSDT',
  'UNIUSDT','APTUSDT','ATOMUSDT','FILUSDT','ETCUSDT',
  'ICPUSDT','AAVEUSDT','ARBUSDT','OPUSDT','INJUSDT',
  'SEIUSDT','TIAUSDT','RUNEUSDT','ALGOUSDT','VETUSDT'
];

let universeStatus = 'STARTING';
let universeError = null;


const D=path.dirname(fileURLToPath(import.meta.url));
const PORT=+(process.env.PORT||8080);
const MIN=+(process.env.BINANCE_WAVE_MIN_PERCENT||4);
const MAP=+(process.env.BINANCE_MA_PERIOD||200);
const MAX=3;
const INITIAL=5000;
const SLOT=INITIAL/MAX;
const UNIVERSE_SIZE=Math.min(30,Math.max(5,+(process.env.BINANCE_UNIVERSE_SIZE||30)));
const LIVE=String(process.env.BINANCE_LIVE_TRADING_ENABLED||'false')==='true';
const MANUAL_SYMBOLS=String(process.env.BINANCE_SYMBOLS||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
let mode='demo';
let SYMBOLS=[];
let agents={};
let streams={};
let marketSocket=null;
let paper={initialIls:INITIAL,cashIls:INITIAL,positions:{},trades:[],lastAction:null};

const EXCLUDED_BASES=new Set(['USDC','FDUSD','TUSD','USDP','DAI','EUR','AEUR','TRY','BRL','GBP','AUD','BIDR','IDRT','UAH','RUB','NGN','ZAR','BUSD']);
const LEVERAGED_SUFFIXES=['UP','DOWN','BULL','BEAR'];

async function j(url){const r=await fetch('https://api.binance.com'+url);if(!r.ok)throw Error('Binance '+r.status);return r.json()}
function isEligibleSymbol(x){
  const s=String(x.symbol||'');
  if(!s.endsWith('USDT'))return false;
  const base=s.slice(0,-4);
  if(!base||EXCLUDED_BASES.has(base))return false;
  if(LEVERAGED_SUFFIXES.some(z=>base.endsWith(z)))return false;
  return true;
}
async function selectUniverse(){
  if(MANUAL_SYMBOLS.length)return MANUAL_SYMBOLS.slice(0,UNIVERSE_SIZE);
  const [info,tickers]=await Promise.all([j('/api/v3/exchangeInfo'),j('/api/v3/ticker/24hr')]);
  const tradable=new Set((info.symbols||[]).filter(x=>x.status==='TRADING'&&x.quoteAsset==='USDT'&&x.isSpotTradingAllowed!==false).map(x=>x.symbol));
  const ranked=(tickers||[]).filter(x=>tradable.has(x.symbol)&&isEligibleSymbol(x)&&Number.isFinite(+x.quoteVolume)).sort((a,b)=>+b.quoteVolume-+a.quoteVolume);
  const selected=[];
  for(const x of ranked){
    if(selected.length>=UNIVERSE_SIZE)break;
    try{
      const c=await candles(x.symbol);
      if(c.length>=MAP+5)selected.push(x.symbol);
    }catch{}
  }
  return selected;
}
function initUniverse(symbols){
  SYMBOLS=[...new Set([...symbols,...Object.keys(paper.positions)])];
  agents=Object.fromEntries(SYMBOLS.map(symbol=>[symbol,agents[symbol]||{symbol,position:paper.positions[symbol]?'LONG':'CASH',decision:'HOLD',strategy:null,execution:'IDLE'}]));
  streams=Object.fromEntries(SYMBOLS.map(symbol=>[symbol,streams[symbol]||{status:'starting',lastPrice:null}]));
}
function startMarketStream(){
  try{marketSocket?.close()}catch{}
  if(!SYMBOLS.length)return;
  const names=SYMBOLS.map(s=>`${s.toLowerCase()}@trade`).join('/');
  marketSocket=new WebSocket(`wss://stream.binance.com:9443/stream?streams=${names}`);
  marketSocket.on('open',()=>SYMBOLS.forEach(s=>streams[s].status='connected'));
  marketSocket.on('message',raw=>{try{const msg=JSON.parse(raw),m=msg.data||msg,s=String(m.s||'');if(streams[s]){streams[s].lastPrice=+m.p;streams[s].lastEventAt=new Date(m.E).toISOString();streams[s].status='connected'}}catch{}});
  marketSocket.on('close',()=>{SYMBOLS.forEach(s=>streams[s].status='disconnected');setTimeout(startMarketStream,5000).unref?.()});
  marketSocket.on('error',()=>{});
}
async function candles(s){const r=await j(`/api/v3/klines?symbol=${s}&interval=1d&limit=${Math.max(250,MAP+30)}`),now=Date.now();return r.filter(x=>+x[6]<now).map(x=>({closeTime:+x[6],close:+x[4]}))}
const value=()=>paper.cashIls+Object.entries(paper.positions).reduce((n,[s,p])=>n+p.qty*+(agents[s]?.strategy?.price||streams[s]?.lastPrice||p.entryPrice),0);
const snap=()=>{const v=value();return {...paper,slotIls:SLOT,maxPositions:MAX,activePositions:Object.keys(paper.positions).length,valueIls:v,profitIls:v-INITIAL,profitPct:(v/INITIAL-1)*100}};
const reset=()=>paper={initialIls:INITIAL,cashIls:INITIAL,positions:{},trades:[],lastAction:null};
function apply(s,d,price,at){price=+price;const p=paper.positions[s];if(d==='BUY'&&!p&&Object.keys(paper.positions).length<MAX&&paper.cashIls>0){const a=Math.min(SLOT,paper.cashIls);paper.positions[s]={symbol:s,qty:a/price,entryPrice:price,allocationIls:a,entryAt:at};paper.cashIls-=a;paper.lastAction={type:'BUY',symbol:s,price,at}}else if(d==='SELL'&&p){const proceeds=p.qty*price,pnlIls=proceeds-p.allocationIls,pnlPct=(price/p.entryPrice-1)*100;paper.cashIls+=proceeds;paper.trades.unshift({symbol:s,buyPrice:p.entryPrice,sellPrice:price,pnlIls,pnlPct,at});paper.trades=paper.trades.slice(0,100);delete paper.positions[s];paper.lastAction={type:'SELL',symbol:s,price,at}}}
async function evalOne(s){try{const c=await candles(s),st=evaluateWaveStrategy(c,{minWave:MIN,maPeriod:MAP}),pos=paper.positions[s]?'LONG':'CASH';let d=decidePosition(st,pos),ex='IDLE';if(d==='BUY'&&!paper.positions[s]&&Object.keys(paper.positions).length>=MAX){d='WAIT_NO_SLOT';ex='NO_SLOT'}if(mode==='demo'&&(d==='BUY'||d==='SELL')){apply(s,d,st.price,new Date(c.at(-1).closeTime).toISOString());ex='PAPER_EXECUTED'}agents[s]={...agents[s],symbol:s,position:paper.positions[s]?'LONG':'CASH',decision:d,strategy:st,lastDecisionAt:new Date().toISOString(),lastError:null,execution:ex}}catch(e){agents[s]={...(agents[s]||{symbol:s,position:'CASH',decision:'HOLD'}),lastError:e.message,execution:'ERROR'}}}
async function evalAll(){for(const s of SYMBOLS)await evalOne(s)}
async function refreshUniverse(){try{const selected=await selectUniverse();if(selected.length){initUniverse(selected);startMarketStream();await evalAll();console.log('Universe',SYMBOLS.length,SYMBOLS.join(','))}}catch(e){console.error('Universe refresh failed',e.message)}}
setInterval(evalAll,300000).unref();
setInterval(refreshUniverse,21600000).unref();
const send=(res,o,c=200)=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'});res.end(JSON.stringify(o))};
const server=http.createServer((req,res)=>{const u=new URL(req.url,`http://${req.headers.host}`);if(req.method==='OPTIONS')return send(res,{},204);const sf={'/binance-agent.html':['binance-agent.html','text/html'],'/binance-agent.js':['binance-agent.js','text/javascript'],'/binance-agent.css':['binance-agent.css','text/css']};if(req.method==='GET'&&sf[u.pathname]){const [f,t]=sf[u.pathname];res.writeHead(200,{'Content-Type':t,'Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(D,f)))}if(u.pathname==='/api/binance-mode'&&req.method==='GET')return send(res,{mode,liveTradingEnabled:LIVE,autoExecution:false,keysConfigured:false});if(u.pathname==='/api/binance-mode'&&req.method==='POST'){let b='';req.on('data',x=>b+=x);req.on('end',()=>{try{const m=JSON.parse(b).mode;if(m==='live'&&!LIVE)throw Error('LIVE is locked on server');mode=m;send(res,{ok:true,mode})}catch(e){send(res,{ok:false,error:e.message},400)}});return}if(u.pathname==='/api/binance-paper/reset'&&req.method==='POST'){reset();return send(res,{ok:true,paper:snap()})}if(u.pathname==='/api/binance-agent'&&req.method==='GET')return send(res,{mode,symbols:SYMBOLS,streams,agents:Object.values(agents),paper:snap(),config:{minWave:MIN,maPeriod:MAP,maxPositions:MAX,slotIls:SLOT,longOnly:true,universeSize:UNIVERSE_SIZE,universeMethod:MANUAL_SYMBOLS.length?'manual':'top USDT spot by 24h quote volume'}});if(u.pathname==='/api/binance-agent/evaluate'&&req.method==='POST'){evalAll().then(()=>send(res,{ok:true,agents:Object.values(agents),paper:snap()}));return}if(u.pathname==='/api/binance-universe/refresh'&&req.method==='POST'){refreshUniverse().then(()=>send(res,{ok:true,symbols:SYMBOLS}));return}if(u.pathname==='/'||u.pathname==='/health')return send(res,{ok:true,mode,symbols:SYMBOLS,paper:snap()});send(res,{error:'Not found'},404)});
server.listen(PORT,'0.0.0.0',async()=>{console.log('Server',PORT);await refreshUniverse()});
