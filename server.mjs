import {loadFiveMinuteBars,FIVE_MINUTE_MS} from './lib/wyckoff-five-minute-data.mjs';
import {retainDecision} from './lib/decision-chart-history.mjs';
import {PersistedMarketOrder} from './lib/persisted-market-order.mjs';
import {trackedLivePositions,liveFillAction,liveBalancePnl} from './lib/wyckoff-live-positions.mjs';
import {backtestWyckoff} from './lib/wyckoff-backtest.mjs';
import {evaluateDailyTrade} from './lib/wyckoff-evaluation.mjs';
import {binancePositionExit as wyckoffExit} from './lib/binance-position-exit.mjs';
import {DemoTrader} from './lib/binance-demo-trader.mjs';
import {assessEntryCost} from './lib/binance-entry-cost.mjs';
import {requireLivePrice} from './lib/binance-live-price.mjs';
import {controlAuthorized} from './lib/binance-control-auth.mjs';
import {getDemoAccount} from './lib/binance-demo-account.mjs';
import WebSocket from "ws";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {URL} from "node:url";
import {createHmac} from "node:crypto";
import {evaluateWaveStrategy,decidePosition} from "./lib/binance-wave-agent.mjs";

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
let strategyDiagnostics={
  evaluated:0,
  minuteReady:0,
  buyers73:0,
  sellers73:0,
  armed:0,
  reachedPlus2:0,
  executionCandidates:0,
  demoAttempts:0,
  demoFilled:0,
  demoRejected:0,
  nearestToTarget:[],
  updatedAt:null
};

const D=path.dirname(fileURLToPath(import.meta.url));
const PORT=+(process.env.PORT||8080);
const MIN=+(process.env.BINANCE_WAVE_MIN_PERCENT||3);
const SELL_RETRACE_RATIO=+(process.env.BINANCE_SELL_RETRACE_RATIO||0.15);
const MAP=+(process.env.BINANCE_MA_PERIOD||200);
const MAX=10;
const INITIAL=5000;
const SLOT=INITIAL/MAX;
const DECISION_INTERVAL_MS=Math.max(5000,+(process.env.BINANCE_DECISION_INTERVAL_MS||5000));
const UNIVERSE_SIZE=Math.min(100,Math.max(10,+(process.env.BINANCE_UNIVERSE_SIZE||100)));
const LIVE=String(process.env.BINANCE_LIVE_TRADING_ENABLED||'false')==='true';
const BINANCE_API_KEY=String(process.env.BINANCE_API_KEY||'').trim();
const BINANCE_API_SECRET=String(process.env.BINANCE_API_SECRET||'').trim();
const KEYS_CONFIGURED=Boolean(BINANCE_API_KEY&&BINANCE_API_SECRET);
const AUTO_EXECUTION=String(process.env.AUTO_EXECUTION||'false').toLowerCase()==='true';
const LIVE_MAX_USDT=Math.max(0,Number(process.env.BINANCE_LIVE_MAX_USDT||400));
const MANUAL_SYMBOLS=String(process.env.BINANCE_SYMBOLS||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);

// Rotation controls
const ROTATION_ENABLED=false; // Wyckoff exits are target/stop only.
const ROTATION_MIN_SCORE=+(process.env.BINANCE_ROTATION_MIN_SCORE||65);
const ROTATION_SCORE_GAP=+(process.env.BINANCE_ROTATION_SCORE_GAP||20);
const ROTATION_MAX_PER_CYCLE=Math.max(0,+(process.env.BINANCE_ROTATION_MAX_PER_CYCLE||1));

// Profit engine v8 controls
// Entry: require a live continuation, a strong enough score, and avoid chasing an already-extended move.
// Exit: use a wider initial loss stop; only activate the tighter trailing-profit stop after real profit exists.
const ENTRY_TRIGGER_PCT=Math.max(0.1,+(process.env.BINANCE_ENTRY_TRIGGER_PCT||2));
const ENTRY_MIN_SCORE=0; // legacy score filter disabled
const ENTRY_MAX_RUN_PCT=Infinity; // legacy anti-chase filter disabled
const STOP_LOSS_PCT=6;
const TRAIL_ACTIVATE_PCT=0;
const EXIT_TRAIL_PCT=6;
const ENTRY_COST_OPTIONS={
  feePct:Number(process.env.BINANCE_ENTRY_FEE_PCT??0.1),
  bufferPct:Number(process.env.BINANCE_ENTRY_COST_BUFFER_PCT??0.1),
  maxSpreadPct:Number(process.env.BINANCE_ENTRY_MAX_SPREAD_PCT??0.2),
  maxImpactPct:Number(process.env.BINANCE_ENTRY_MAX_IMPACT_PCT??0.1),
  trailActivatePct:0,exitTrailPct:EXIT_TRAIL_PCT,
  maxCostPctOverride:Number(process.env.BINANCE_ENTRY_MAX_COST_PCT??0.5)
};
async function checkEntryCost(symbol,amount){
  try{
    const origin=DEMO_TRADING&&mode==='demo'?'https://demo-api.binance.com':'https://api.binance.com';
    const r=await fetch(origin+'/api/v3/depth?symbol='+encodeURIComponent(symbol)+'&limit=100',{signal:AbortSignal.timeout(5000)});
    if(!r.ok)throw Error('Depth HTTP '+r.status);
    return {...assessEntryCost(await r.json(),amount,ENTRY_COST_OPTIONS),checkedAt:new Date().toISOString()};
  }catch{return {ok:false,code:'WAIT_COST_DATA',text:'ממתין לנתוני עומק; הקנייה מושהית'};}
}
const entryTrackingState=new Map();
const livePeakState=new Map();
const microCandleState=new Map();
const minuteCandleState=new Map();

function updateMicroCandle(symbol,price,eventTime=Date.now()){
  price=Number(price);
  if(!(price>0))return;
  const bucketMs=5000;
  const bucket=Math.floor(Number(eventTime)/bucketMs)*bucketMs;
  const state=microCandleState.get(symbol)||{closed:[],current:null};
  let c=state.current;

  if(!c||c.openTime!==bucket){
    if(c){
      state.closed.push({...c,closeTime:c.openTime+bucketMs-1});
      state.closed=state.closed.slice(-10);
    }
    c={openTime:bucket,open:price,high:price,low:price,close:price};
  }else{
    c.high=Math.max(c.high,price);
    c.low=Math.min(c.low,price);
    c.close=price;
  }
  state.current=c;
  microCandleState.set(symbol,state);
}

function microTrend(symbol){
  const state=microCandleState.get(symbol);
  if(!state)return {ready:false,buyers:0,sellers:0,neutral:0,control:'WAIT'};
  const rows=[...(state.closed||[])];
  if(state.current)rows.push(state.current);
  const last=rows.slice(-10);
  if(last.length<10)return {ready:false,buyers:0,sellers:0,neutral:last.length,control:'WAIT'};

  let buyers=0,sellers=0,neutral=0;
  for(const c of last){
    if(Number(c.close)>Number(c.open))buyers++;
    else if(Number(c.close)<Number(c.open))sellers++;
    else neutral++;
  }
  const control=buyers>=7&&sellers<=3?'BUYERS':sellers>=7&&buyers<=3?'SELLERS':'BALANCED';
  return {ready:true,buyers,sellers,neutral,control};
}
async function seedMinuteCandles(symbols){
  const batchSize=10;
  for(let i=0;i<symbols.length;i+=batchSize){
    await Promise.all(symbols.slice(i,i+batchSize).map(async symbol=>{
      try{
        const r=await j('/api/v3/klines?symbol='+encodeURIComponent(symbol)+'&interval=1m&limit=21');
        const now=Date.now();
        const closed=(Array.isArray(r)?r:[])
          .filter(x=>+x[6]<now)
          .map(x=>({
            openTime:+x[0],closeTime:+x[6],
            open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closed:true
          }))
          .slice(-20);
        const state=minuteCandleState.get(symbol)||{closed:[],current:null};
        state.closed=closed;
        minuteCandleState.set(symbol,state);
      }catch{}
    }));
  }
}

function minuteTrend(symbol){
  const state=minuteCandleState.get(symbol);
  if(!state)return {ready:false,buyers:0,sellers:0,neutral:0,control:'WAIT'};
  const rows=[...(state.closed||[])];
  if(state.current)rows.push(state.current);
  const last=rows.slice(-10);
  if(last.length<10)return {ready:false,buyers:0,sellers:0,neutral:last.length,control:'WAIT'};

  let buyers=0,sellers=0,neutral=0;
  for(const c of last){
    if(Number(c.close)>Number(c.open))buyers++;
    else if(Number(c.close)<Number(c.open))sellers++;
    else neutral++;
  }
  const control=buyers>=7&&sellers<=3?'BUYERS':sellers>=7&&buyers<=3?'SELLERS':'BALANCED';
  return {ready:true,buyers,sellers,neutral,control,candles:last};
}

function consolidationBreakout(symbol){
  const state=minuteCandleState.get(symbol);
  const closed=(state?.closed||[]).slice(-16);
  if(closed.length<16)return {ready:false,reason:'WAIT_16_CANDLES'};

  const box=closed.slice(0,15);
  const breakout=closed[15];
  const high=Math.max(...box.map(c=>Number(c.high)));
  const low=Math.min(...box.map(c=>Number(c.low)));
  if(!(high>0&&low>0))return {ready:false,reason:'BAD_RANGE'};

  const rangePct=(high/low-1)*100;
  const rangeOk=rangePct<=1.2;

  const open=Number(breakout.open),close=Number(breakout.close);
  const bh=Number(breakout.high),bl=Number(breakout.low);
  const candleRange=Math.max(Number.EPSILON,bh-bl);
  const bodyRatio=Math.abs(close-open)/candleRange;
  const closeLocation=(close-bl)/candleRange;
  const breakoutPct=(close/high-1)*100;

  const strongBreakout=
    rangeOk &&
    close>open &&
    close>high*1.001 &&
    bodyRatio>=0.55 &&
    closeLocation>=0.72;

  return {
    ready:true,
    rangeOk,
    rangeHigh:high,
    rangeLow:low,
    rangePct,
    breakout,
    breakoutPct,
    bodyRatio,
    closeLocation,
    strongBreakout
  };
}

const dailyCandleCache=new Map();

// Durable DEMO state (use Render Persistent Disk mounted at /var/data)
const STATE_FILE=process.env.BINANCE_STATE_FILE||'/var/data/binance-paper-state.json';
const TRADE_CONTROL_FILE=process.env.BINANCE_TRADE_CONTROL_FILE||'/var/data/binance-trade-control.json';
let tradeControl={paused:false,resumedAt:null,pausedAt:null,lastStop:null};
function saveTradeControl(){
  fs.mkdirSync(path.dirname(TRADE_CONTROL_FILE),{recursive:true});
  const temp=TRADE_CONTROL_FILE+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(tradeControl),'utf8');
  fs.renameSync(temp,TRADE_CONTROL_FILE);
}
function loadTradeControl(){
  try{
    if(fs.existsSync(TRADE_CONTROL_FILE)){
      const c=JSON.parse(fs.readFileSync(TRADE_CONTROL_FILE,'utf8'));
      tradeControl={paused:c.paused===true,resumedAt:c.resumedAt||null,pausedAt:c.pausedAt||null,lastStop:c.lastStop||null};
    }
  }catch(e){
    // Fail closed if the persisted stop switch is unreadable.
    tradeControl.paused=true;
    console.error('TRADE_CONTROL_READ_ERROR',e.message);
  }
}

const DEMO_TRADING=process.env.BINANCE_DEMO_TRADING_ENABLED==='true';
const demoTrader=new DemoTrader({
  maxPositions:MAX,
  entryCostGuard:checkEntryCost,
  key:process.env.BINANCE_DEMO_API_KEY,
  secret:process.env.BINANCE_DEMO_API_SECRET,
  enabled:DEMO_TRADING,
  stateFile:process.env.BINANCE_DEMO_STATE_FILE||'/var/data/binance-demo-trading.json',
  trailingStopPct:6,
  stopLossPct:6,
  trailActivatePct:0
});
const tradingPositions=()=>{
 if(mode==='live'){
  return trackedLivePositions(liveActionLog);
 }
 return DEMO_TRADING?demoTrader.state.positions:paper.positions;
};
const accountSnapshot=()=>DEMO_TRADING&&mode==='demo'?demoTrader.snapshot():snap();

function ensureStateDir(){
  try{ fs.mkdirSync(path.dirname(STATE_FILE),{recursive:true}); }catch{}
}

function savePaperState(){
  try{
    ensureStateDir();
    const tmp=STATE_FILE+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(paper,null,2),'utf8');
    fs.renameSync(tmp,STATE_FILE);
    return true;
  }catch(e){
    console.error('Paper state save failed',e.message);
    return false;
  }
}

function loadPaperState(){
  try{
    ensureStateDir();
    if(!fs.existsSync(STATE_FILE))return false;
    const raw=JSON.parse(fs.readFileSync(STATE_FILE,'utf8'));
    if(!raw||typeof raw!=='object')return false;
    if(!raw.positions||typeof raw.positions!=='object')return false;

    paper={
      initialIls:Number(raw.initialIls||INITIAL),
      cashIls:Number(raw.cashIls??INITIAL),
      positions:raw.positions||{},
      trades:Array.isArray(raw.trades)?raw.trades:[],
      actionLog:Array.isArray(raw.actionLog)?raw.actionLog:[],
      usedPatterns:raw.usedPatterns||{},
      lastAction:raw.lastAction||null
    };
    console.log('Paper state restored',Object.keys(paper.positions).length,'positions');
    return true;
  }catch(e){
    console.error('Paper state load failed',e.message);
    return false;
  }
}

const LIVE_LOG_FILE=process.env.BINANCE_LIVE_LOG_FILE||'/var/data/binance-live-actions.json';
const liveOrders=new PersistedMarketOrder(LIVE_LOG_FILE+'.pending');
const DECISION_HISTORY_FILE=process.env.BINANCE_DECISION_HISTORY_FILE||'/var/data/binance-decision-history.json';
let decisionHistory={};

function saveDecisionHistory(){
  try{
    ensureStateDir();
    const tmp=DECISION_HISTORY_FILE+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(decisionHistory,null,2),'utf8');
    fs.renameSync(tmp,DECISION_HISTORY_FILE);
    return true;
  }catch(e){
    console.error('Decision history save failed',e.message);
    return false;
  }
}

function loadDecisionHistory(){
  try{
    ensureStateDir();
    if(!fs.existsSync(DECISION_HISTORY_FILE))return false;
    const raw=JSON.parse(fs.readFileSync(DECISION_HISTORY_FILE,'utf8'));
    decisionHistory=raw&&typeof raw==='object'?raw:{};
    return true;
  }catch(e){
    console.error('Decision history load failed',e.message);
    return false;
  }
}

function pushDecisionHistory(symbol,row){
  const arr=Array.isArray(decisionHistory[symbol])?decisionHistory[symbol]:[];
  decisionHistory[symbol]=retainDecision(arr,row);
}
const EXPERIMENT_RESET_VERSION='2026-10-06-5s-v1';
const EXPERIMENT_RESET_FILE=process.env.BINANCE_EXPERIMENT_RESET_FILE||'/var/data/binance-experiment-reset.json';

function resetExperimentStateOnce(){
  try{
    ensureStateDir();
    let previous=null;
    if(fs.existsSync(EXPERIMENT_RESET_FILE)){
      try{
        previous=JSON.parse(fs.readFileSync(EXPERIMENT_RESET_FILE,'utf8'))?.version||null;
      }catch{}
    }
    if(previous===EXPERIMENT_RESET_VERSION)return false;

    // Reset strategy/diagnostic state for a clean 5-second experiment.
    entryTrackingState.clear();
    livePeakState.clear();
    decisionHistory={};
    saveDecisionHistory();

    // Internal paper trading can be reset safely. Never orphan real Binance Demo positions.
    if(!DEMO_TRADING){
      reset();
    }

    fs.writeFileSync(EXPERIMENT_RESET_FILE,JSON.stringify({
      version:EXPERIMENT_RESET_VERSION,
      at:new Date().toISOString(),
      paperReset:!DEMO_TRADING,
      externalDemoPositionsPreserved:DEMO_TRADING
    },null,2),'utf8');

    console.log(
      'Experiment state reset',
      EXPERIMENT_RESET_VERSION,
      DEMO_TRADING?'Binance Demo positions preserved':'paper portfolio reset'
    );
    return true;
  }catch(e){
    console.error('Experiment reset failed',e.message);
    return false;
  }
}

let liveActionLog=[];

function saveLiveActionLog(){
  try{
    ensureStateDir();
    const tmp=LIVE_LOG_FILE+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(liveActionLog,null,2),'utf8');
    fs.renameSync(tmp,LIVE_LOG_FILE);
    return true;
  }catch(e){
    console.error('Live action log save failed',e.message);
    return false;
  }
}

function loadLiveActionLog(){
  try{
    ensureStateDir();
    if(!fs.existsSync(LIVE_LOG_FILE))return false;
    const raw=JSON.parse(fs.readFileSync(LIVE_LOG_FILE,'utf8'));
    liveActionLog=Array.isArray(raw)?raw:[];
    return true;
  }catch(e){
    console.error('Live action log load failed',e.message);
    return false;
  }
}

function pushDemoAction(action){
  paper.actionLog=Array.isArray(paper.actionLog)?paper.actionLog:[];
  paper.actionLog.unshift(action);
  paper.actionLog=paper.actionLog.slice(0,200);
}

function pushLiveAction(action){
  if(!liveActionLog.some(a=>a.orderId===action.orderId&&a.symbol===action.symbol))liveActionLog.unshift(action);
  // Execution metadata and consumed patterns must survive display log limits.
  if(!saveLiveActionLog())throw Error('LIVE_EXECUTION_JOURNAL_UNAVAILABLE');
}

let mode='demo';
let SYMBOLS=[];
let agents={};
let streams={};
let marketSocket=null;
let paper={initialIls:INITIAL,cashIls:INITIAL,positions:{},trades:[],actionLog:[],lastAction:null};

const EXCLUDED_BASES=new Set(['USDC','FDUSD','TUSD','USDP','DAI','EUR','AEUR','TRY','BRL','GBP','AUD','BIDR','IDRT','UAH','RUB','NGN','ZAR','BUSD']);
const LEVERAGED_SUFFIXES=['UP','DOWN','BULL','BEAR'];

async function j(url){
  const r=await fetch('https://api.binance.com'+url);
  if(!r.ok)throw Error('Binance '+r.status);
  return r.json();
}

async function demoPublic(url){
  const r=await fetch('https://demo-api.binance.com'+url,{signal:AbortSignal.timeout(15000)});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(body?.msg||('Binance Demo '+r.status));
  return body;
}

let demoTradableCache={at:0,symbols:null};
async function demoTradableSymbols(){
  if(!DEMO_TRADING)return null;
  if(demoTradableCache.symbols && Date.now()-demoTradableCache.at<600000){
    return demoTradableCache.symbols;
  }
  const info=await demoPublic('/api/v3/exchangeInfo');
  const symbols=new Set(
    (info.symbols||[])
      .filter(x=>x.status==='TRADING'&&x.quoteAsset==='USDT'&&x.isSpotTradingAllowed!==false&&x.orderTypes?.includes('MARKET'))
      .map(x=>x.symbol)
  );
  demoTradableCache={at:Date.now(),symbols};
  return symbols;
}

async function binanceServerTime(){
  try{
    const t=await j('/api/v3/time');
    return Number(t.serverTime)||Date.now();
  }catch{
    return Date.now();
  }
}

async function signedBinanceGet(pathname,params={}){
  if(!KEYS_CONFIGURED)throw Error('Binance API keys are not configured');

  const timestamp=await binanceServerTime();
  const query=new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)])),
    timestamp:String(timestamp),
    recvWindow:'5000'
  });
  const signature=createHmac('sha256',BINANCE_API_SECRET)
    .update(query.toString())
    .digest('hex');

  const url='https://api.binance.com'+pathname+'?'+query.toString()+'&signature='+signature;
  const r=await fetch(url,{
    headers:{'X-MBX-APIKEY':BINANCE_API_KEY},
    cache:'no-store'
  });

  const body=await r.json().catch(()=>({}));
  if(!r.ok){
    throw Error(body?.msg||('Binance '+r.status));
  }
  return body;
}

async function signedBinancePost(pathname,params={}){
  if(!KEYS_CONFIGURED)throw Error('Binance API keys are not configured');

  const timestamp=await binanceServerTime();
  const query=new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)])),
    timestamp:String(timestamp),
    recvWindow:'5000'
  });
  const signature=createHmac('sha256',BINANCE_API_SECRET)
    .update(query.toString())
    .digest('hex');

  const url='https://api.binance.com'+pathname+'?'+query.toString()+'&signature='+signature;
  const r=await fetch(url,{
    method:'POST',
    headers:{'X-MBX-APIKEY':BINANCE_API_KEY},
    cache:'no-store'
  });

  const body=await r.json().catch(()=>({}));
  if(!r.ok){
    const e=Error(body?.msg||('Binance '+r.status));
    e.status=r.status;
    e.code=body?.code??null;
    throw e;
  }
  return body;
}

async function getApiRestrictions(){
  return signedBinanceGet('/sapi/v1/account/apiRestrictions');
}

function liveTradingGate(restrictions){
  return {
    keysConfigured:KEYS_CONFIGURED,
    liveTradingEnabled:LIVE,
        autoExecution:AUTO_EXECUTION,
        liveMaxUsdt:LIVE_MAX_USDT,
    autoExecution:AUTO_EXECUTION,
    spotPermission:Boolean(restrictions?.enableSpotAndMarginTrading),
    withdrawalsEnabled:Boolean(restrictions?.enableWithdrawals),
    liveMaxUsdt:LIVE_MAX_USDT,
    ready:Boolean(KEYS_CONFIGURED&&LIVE&&AUTO_EXECUTION&&restrictions?.enableSpotAndMarginTrading)
  };
}

async function symbolExchangeInfo(symbol){
  const info=await j('/api/v3/exchangeInfo?symbol='+encodeURIComponent(symbol));
  return info?.symbols?.[0]||null;
}

function floorToStep(value,step){
  value=Number(value); step=Number(step);
  if(!Number.isFinite(value)||!Number.isFinite(step)||step<=0)return value;
  const precision=Math.max(0,(String(step).split('.')[1]||'').replace(/0+$/,'').length);
  const floored=Math.floor((value+1e-12)/step)*step;
  return Number(floored.toFixed(Math.min(precision,12)));
}

async function recordLiveFill(order,intent){
 const fills=order.fills||await signedBinanceGet('/api/v3/myTrades',{symbol:intent.params.symbol,orderId:String(order.orderId)});
 pushLiveAction(liveFillAction(order,intent,fills));
}
async function placeLiveMarketBuy(symbol,quoteUsdt,reason='BUY',meta={}){
  const restrictions=await getApiRestrictions();
  const gate=liveTradingGate(restrictions);
  if(!gate.ready)throw Error('LIVE trading gate is not enabled');
  if(gate.withdrawalsEnabled)throw Error('Withdrawals must remain disabled for this API key');

  const info=await symbolExchangeInfo(symbol);
  if(!info||info.status!=='TRADING'||info.quoteAsset!=='USDT'||info.isSpotTradingAllowed===false){
    throw Error('LIVE symbol is not available for Spot trading: '+symbol);
  }
  if(info.quoteOrderQtyMarketAllowed===false){
    throw Error('LIVE quoteOrderQty market buy is not supported: '+symbol);
  }

  quoteUsdt=Math.min(Number(quoteUsdt)||0,LIVE_MAX_USDT);
  if(!(quoteUsdt>0))throw Error('Invalid LIVE buy amount');

  const minimum=Math.max(
    0,
    ...(info.filters||[])
      .filter(f=>['MIN_NOTIONAL','NOTIONAL'].includes(f.filterType))
      .map(f=>Number(f.minNotional||0))
  );
  if(quoteUsdt<minimum){
    const e=Error('LIVE buy amount below minimum notional for '+symbol);
    e.code='BELOW_MIN_NOTIONAL';
    e.minimum=minimum;
    e.amount=quoteUsdt;
    throw e;
  }

  const precision=Math.min(8,Number(info.quoteAssetPrecision??8));
  const factor=10**precision;
  const quoteText=(Math.floor(quoteUsdt*factor)/factor).toFixed(precision);

  return liveOrders.submit({symbol,side:'BUY',type:'MARKET',quoteOrderQty:quoteText,newOrderRespType:'FULL'},{reason,meta},params=>signedBinancePost('/api/v3/order',params),recordLiveFill);
}

async function placeLiveMarketSell(symbol,reason='SELL',meta={}){
  const restrictions=await getApiRestrictions();
  const gate=liveTradingGate(restrictions);
  if(!gate.ready)throw Error('LIVE trading gate is not enabled');
  if(gate.withdrawalsEnabled)throw Error('Withdrawals must remain disabled for this API key');

  const base=symbol.endsWith('USDT')?symbol.slice(0,-4):symbol;
  const acct=await getLiveAccountSnapshot();
  const bal=acct.balances.find(x=>x.asset===base);
  if(!bal||!(bal.free>0))throw Error('No free balance to sell for '+base);

  const info=await symbolExchangeInfo(symbol);
  const lot=info?.filters?.find(x=>x.filterType==='LOT_SIZE');
  const trackedQty=Number(tradingPositions()[symbol]?.qty||0);
  if(!(trackedQty>0))throw Error('No tracked Wyckoff quantity to sell');
  const qty=floorToStep(Math.min(bal.free,trackedQty),Number(lot?.stepSize||0));
  if(!(qty>0))throw Error('Sell quantity is below LOT_SIZE');

  return liveOrders.submit({symbol,side:'SELL',type:'MARKET',quantity:String(qty),newOrderRespType:'FULL'},{reason,meta},params=>signedBinancePost('/api/v3/order',params),recordLiveFill);
}

function persistLivePeak(symbol, position){
  const buy=liveActionLog.find(a=>a.type==='BUY'&&a.symbol===symbol&&a.wyckoffTrade);
  if(!buy)return;
  if(Number(buy.wyckoffTrade.peakPrice||0)>=position.peakPrice)return;
  buy.wyckoffTrade.peakPrice=position.peakPrice;
  if(!saveLiveActionLog())throw Error('LIVE_PEAK_PERSISTENCE_FAILED');
}

let liveExecutionInFlight=false;
async function maybeExecuteLive(evals){
 if(liveExecutionInFlight)return;liveExecutionInFlight=true;
 try{return await executeLiveCycle(evals);}finally{liveExecutionInFlight=false;}
}
async function executeLiveCycle(evals){
  if(mode!=='live'||!LIVE||!AUTO_EXECUTION)return;
  const gate=liveTradingGate(await getApiRestrictions());
  if(!gate.ready)return;
  if(gate.withdrawalsEnabled)throw Error('Withdrawals must remain disabled for LIVE auto execution');
  await liveOrders.recover(p=>signedBinanceGet('/api/v3/order',{symbol:p.params.symbol,origClientOrderId:p.params.newClientOrderId}),recordLiveFill);
  let account=await getLiveAccountSnapshot();
  const owned=symbol=>account.balances.find(b=>b.asset===symbol.slice(0,-4)&&b.qty>0&&Number(b.valueUsdt||0)>=5);
  const sold=new Set();
  for(const ev of evals){
    if(!ev.ok||!owned(ev.symbol))continue;
    const saved=tradingPositions()[ev.symbol];
    if(!saved)continue;
    const exit=wyckoffExit(saved,ev.strategy.price);
    persistLivePeak(ev.symbol,saved);
    if(exit.sell){await placeLiveMarketSell(ev.symbol,exit.reason);sold.add(ev.symbol);account=await getLiveAccountSnapshot();}
  }
  if(tradeControl.paused)return;
  for(const ev of evals.filter(e=>e.ok&&e.entryConfirmed&&e.wyckoffTrade)){
    if(owned(ev.symbol)||sold.has(ev.symbol))continue;
    if(liveActionLog.some(a=>a.type==='BUY'&&a.symbol===ev.symbol&&a.wyckoffTrade?.patternId===ev.wyckoffTrade.patternId))continue;
    const held=account.balances.filter(b=>!['USDT','USDC'].includes(b.asset)&&Number(b.valueUsdt||0)>=5).length;
    if(held>=MAX)break;
    const spend=Math.min(LIVE_MAX_USDT,Number(account.usdtFree||0)/(MAX-held)*.995);
    if(spend<5)break;
    await placeLiveMarketBuy(ev.symbol,spend,'WYCKOFF_RECLAIM',{score:ev.score,wyckoffTrade:ev.wyckoffTrade});
    account=await getLiveAccountSnapshot();
  }
}

async function getLiveAccountSnapshot(){
  const [acct,prices,restrictions] = await Promise.all([
    signedBinanceGet('/api/v3/account',{omitZeroBalances:'true'}),
    j('/api/v3/ticker/price'),
    getApiRestrictions()
  ]);

  const priceMap=new Map((prices||[]).map(x=>[String(x.symbol||''),Number(x.price||0)]));

  const balances=(acct.balances||[])
    .map(x=>({
      asset:String(x.asset||''),
      free:Number(x.free||0),
      locked:Number(x.locked||0)
    }))
    .filter(x=>x.asset&&(x.free>0||x.locked>0))
    .map(x=>{
      const qty=x.free+x.locked;
      let usdtPrice=0;

      if(x.asset==='USDT'){
        usdtPrice=1;
      }else{
        const direct=priceMap.get(x.asset+'USDT');
        const inverse=priceMap.get('USDT'+x.asset);
        if(Number.isFinite(direct)&&direct>0)usdtPrice=direct;
        else if(Number.isFinite(inverse)&&inverse>0)usdtPrice=1/inverse;
      }

      const valueUsdt=qty*usdtPrice;
      const balance={...x,qty,usdtPrice,valueUsdt};
      return {...balance,...liveBalancePnl(balance,liveActionLog)};
    });

  const usdt=balances.find(x=>x.asset==='USDT')||{asset:'USDT',free:0,locked:0,qty:0,usdtPrice:1,valueUsdt:0};
  const totalValueUsdt=balances.reduce((sum,x)=>sum+(Number.isFinite(x.valueUsdt)?x.valueUsdt:0),0);

  return {
    connected:true,
    canTrade:Boolean(acct.canTrade),
    canWithdraw:Boolean(acct.canWithdraw),
    canDeposit:Boolean(acct.canDeposit),
    accountType:acct.accountType||'SPOT',
    balances,
    usdtFree:usdt.free,
    usdtLocked:usdt.locked,
    totalValueUsdt,
    permissions:Array.isArray(acct.permissions)?acct.permissions:[],
    makerCommission:acct.makerCommission,
    takerCommission:acct.takerCommission,
    apiRestrictions:restrictions,
    tradingGate:liveTradingGate(restrictions),
    updatedAt:new Date().toISOString()
  };
}

function isEligibleSymbol(x){
  const s=String(x.symbol||'');
  if(!s.endsWith('USDT'))return false;
  const base=s.slice(0,-4);
  if(!base||EXCLUDED_BASES.has(base))return false;
  if(LEVERAGED_SUFFIXES.some(z=>base.endsWith(z)))return false;
  return true;
}

async function selectUniverse(){
  // Scan the real Binance Spot market independently from what the Demo account
  // currently supports. Execution compatibility is handled separately.
  if(MANUAL_SYMBOLS.length){
    return MANUAL_SYMBOLS.slice(0,UNIVERSE_SIZE);
  }

  const [info,tickers]=await Promise.all([
    j('/api/v3/exchangeInfo'),
    j('/api/v3/ticker/24hr')
  ]);

  const tradable=new Set(
    (info.symbols||[])
      .filter(x=>x.status==='TRADING'&&x.quoteAsset==='USDT'&&x.isSpotTradingAllowed!==false)
      .map(x=>x.symbol)
  );

  const ranked=(tickers||[])
    .filter(x=>
      tradable.has(x.symbol) &&
      isEligibleSymbol(x) &&
      Number.isFinite(+x.quoteVolume)
    )
    .sort((a,b)=>+b.quoteVolume-+a.quoteVolume);

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
  SYMBOLS=[...new Set([...symbols,...Object.keys(tradingPositions())])];
  agents=Object.fromEntries(
    SYMBOLS.map(symbol=>[
      symbol,
      agents[symbol]||{
        symbol,
        position:tradingPositions()[symbol]?'LONG':'CASH',
        decision:'HOLD',
        strategy:null,
        execution:'IDLE',
        score:null,
        rotation:null
      }
    ])
  );
  streams=Object.fromEntries(
    SYMBOLS.map(symbol=>[
      symbol,
      streams[symbol]||{status:'starting',lastPrice:null}
    ])
  );
}

function startMarketStream(){
  if(!SYMBOLS.length)return;
  const names=SYMBOLS.flatMap(s=>[`${s.toLowerCase()}@trade`,`${s.toLowerCase()}@kline_1m`]).join('/');
  const url=`wss://stream.binance.com:9443/stream?streams=${names}`;
  // Reuse a healthy subscription; universe refresh must not interrupt every scan.
  if(marketSocket?.url===url&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(marketSocket.readyState))return;
  const previous=marketSocket;
  const socket=new WebSocket(url);
  marketSocket=socket;
  try{previous?.close()}catch{}
  SYMBOLS.forEach(s=>{streams[s].status='connecting';});
  socket.on('open',()=>{
    if(marketSocket!==socket)return;
    SYMBOLS.forEach(s=>{streams[s].status='connected';});
  });
  socket.on('message',raw=>{
    if(marketSocket!==socket)return;
    try{
      const msg=JSON.parse(raw),m=msg.data||msg,s=String(m.s||'');
      if((m.e==='trade'||!m.e&&m.p!=null)&&streams[s]){
        streams[s].lastPrice=+m.p;
        streams[s].lastEventAt=new Date(m.E).toISOString();
        streams[s].status='connected';
      }
      if(m.e==='kline'&&m.k){
        const k=m.k;
        const candle={
          openTime:+k.t,
          closeTime:+k.T,
          open:+k.o,
          high:+k.h,
          low:+k.l,
          close:+k.c,
          volume:+k.v,
          closed:Boolean(k.x)
        };
        const state=minuteCandleState.get(s)||{closed:[],current:null};
        if(candle.closed){
          const rows=state.closed.filter(x=>x.openTime!==candle.openTime);
          rows.push(candle);
          state.closed=rows.sort((a,b)=>a.openTime-b.openTime).slice(-20);
          state.current=null;
        }else{
          state.current=candle;
        }
        minuteCandleState.set(s,state);
      }
    }catch{}
  });
  socket.on('close',()=>{
    if(marketSocket!==socket)return;
    SYMBOLS.forEach(s=>{streams[s].status='disconnected';});
    setTimeout(()=>{if(marketSocket===socket)startMarketStream();},5000).unref?.();
  });
  socket.on('error',()=>{});
}

async function fetchHistoricalDaily(symbol,startMs,endMs=Date.now()){
  const rows=[];
  let cursor=Number(startMs);
  const end=Number(endMs);
  while(cursor<end){
    const r=await j(`/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=1000&startTime=${cursor}&endTime=${end}`);
    if(!Array.isArray(r)||!r.length)break;
    for(const x of r){
      rows.push({closeTime:+x[6],close:+x[4]});
    }
    const next=+r.at(-1)[6]+1;
    if(next<=cursor)break;
    cursor=next;
    if(r.length<1000)break;
  }
  return rows.filter(x=>Number.isFinite(x.close)&&Number.isFinite(x.closeTime));
}

function evalWaveWithWindow(candles,{minWave=4,maxWave=12,maPeriod=200,sellRetraceRatio=SELL_RETRACE_RATIO}={}){
  const closes=candles.map(c=>Number(c.close)).filter(Number.isFinite);
  if(closes.length<maPeriod+3)return null;
  const slice=closes.slice(-maPeriod);
  const ma=slice.reduce((a,b)=>a+b,0)/maPeriod;
  const pct=(a,b)=>Math.abs((b-a)/a)*100;

  let direction=null,waveStart=closes[0],extreme=closes[0],previousUpWave=null,previousDownWave=null,currentWave=0;
  for(let i=1;i<closes.length;i++){
    const p=closes[i],prev=closes[i-1];
    if(direction===null){
      if(p>prev)direction='UP';
      else if(p<prev)direction='DOWN';
      waveStart=prev;extreme=p;currentWave=pct(waveStart,extreme);continue;
    }
    if(direction==='UP'){
      if(p>=extreme){extreme=p;currentWave=pct(waveStart,extreme);}
      else{previousUpWave=pct(waveStart,extreme);direction='DOWN';waveStart=extreme;extreme=p;currentWave=pct(waveStart,extreme);}
    }else{
      if(p<=extreme){extreme=p;currentWave=pct(waveStart,extreme);}
      else{previousDownWave=pct(waveStart,extreme);direction='UP';waveStart=extreme;extreme=p;currentWave=pct(waveStart,extreme);}
    }
  }
  const price=closes.at(-1),aboveMA=price>ma;
  return {
    price,ma,aboveMA,direction,currentWave,previousUpWave,previousDownWave,
    buyConfirmed:direction==='UP'&&previousDownWave!=null&&currentWave>=minWave&&currentWave<=maxWave&&currentWave>previousDownWave&&aboveMA,
    sellThreshold:previousUpWave==null?null:previousUpWave*sellRetraceRatio,
    sellConfirmed:direction==='DOWN'&&previousUpWave!=null&&currentWave>=previousUpWave*sellRetraceRatio
  };
}

function backtestWindow(candles,{initial=5000}={}){
  const r=backtestWyckoff(candles,.1);
  const buys=r.journal.filter(t=>t.type==='BUY'),sells=r.journal.filter(t=>t.type==='SELL');
  return {...r,initial,finalValue:r.value*initial/10000,closedTrades:sells.length,maxDrawdownPct:-r.maxDrawdown,openPosition:buys.length>sells.length,trades:r.journal,strategyId:'WYCKOFF_D1_V1'};
}

async function candles(s,{force=false}={}){
  const now=Date.now(),bucket=Math.floor(now/FIVE_MINUTE_MS);
  const cached=dailyCandleCache.get(s);
  if(!force&&cached&&cached.bucket===bucket)return cached.rows;
  const rows=await loadFiveMinuteBars(j,s,now);
  dailyCandleCache.set(s,{at:now,bucket,rows});
  return rows;
}

function markPaperToMarket(){
  let positionsValueIls=0;

  for(const [s,p] of Object.entries(paper.positions)){
    const live=Number(streams[s]?.lastPrice);
    const strategyPrice=Number(agents[s]?.strategy?.price);
    const currentPrice=
      Number.isFinite(live)&&live>0 ? live :
      Number.isFinite(strategyPrice)&&strategyPrice>0 ? strategyPrice :
      Number(p.entryPrice||0);

    const allocationIls=Number(p.allocationIls||0);
    const entryPrice=Number(p.entryPrice||0);
    const qty=Number(p.qty||0);

    let currentValueIls=allocationIls;
    if(qty>0&&currentPrice>0){
      currentValueIls=qty*currentPrice;
    }else if(entryPrice>0&&currentPrice>0){
      currentValueIls=allocationIls*(currentPrice/entryPrice);
    }

    const pnlIls=currentValueIls-allocationIls;
    const pnlPct=allocationIls>0?(pnlIls/allocationIls)*100:0;

    p.currentPrice=currentPrice;
    p.currentValueIls=currentValueIls;
    p.pnlIls=pnlIls;
    p.pnlPct=pnlPct;

    positionsValueIls+=currentValueIls;
  }

  const valueIls=Number(paper.cashIls||0)+positionsValueIls;
  return {
    positionsValueIls,
    valueIls,
    profitIls:valueIls-Number(paper.initialIls||INITIAL),
    profitPct:Number(paper.initialIls||INITIAL)>0
      ? ((valueIls-Number(paper.initialIls||INITIAL))/Number(paper.initialIls||INITIAL))*100
      : 0
  };
}

const value=()=>markPaperToMarket().valueIls;

const snap=()=>{
  const mtm=markPaperToMarket();
  return {
    ...paper,
    slotIls:SLOT,
    maxPositions:MAX,
    activePositions:Object.keys(paper.positions).length,
    positionsValueIls:mtm.positionsValueIls,
    valueIls:mtm.valueIls,
    profitIls:mtm.profitIls,
    profitPct:mtm.profitPct
  };
};

const reset=()=>{
  paper={
    initialIls:INITIAL,
    cashIls:INITIAL,
    positions:{},
    trades:[],
    actionLog:[],
    lastAction:null
  };
  savePaperState();
  return paper;
};

function apply(s,d,price,at,meta={}){
  price=+price;
  const p=paper.positions[s];

  if(d==='BUY'&&!p&&Object.keys(paper.positions).length<MAX&&paper.cashIls>0){
    const a=Math.min(SLOT,paper.cashIls);
    paper.positions[s]={
      symbol:s,
      qty:a/price,
      entryPrice:price,
      allocationIls:a,
      entryAt:at,
      entryScore:Number.isFinite(+meta.score)?+meta.score:null,
      entryReason:meta.reason||'BUY',
      ...(meta.wyckoffTrade||{})
    };
    paper.cashIls-=a;
    if(meta.wyckoffTrade?.patternId){paper.usedPatterns??={};(paper.usedPatterns[s]??=[]).push(meta.wyckoffTrade.patternId);}
    paper.lastAction={type:'BUY',symbol:s,price,at,...meta};
    pushDemoAction({
      type:meta.reason==='ROTATION_IN'?'ROTATE_IN':'BUY',
      symbol:s,
      price,
      amountIls:a,
      qty:a/price,
      reason:meta.reason||'BUY',
      ...(meta.wyckoffTrade||{}),
      at:new Date().toISOString(),
      score:Number.isFinite(+meta.score)?+meta.score:null,
      rotatedFrom:meta.rotatedFrom||null
    });
    savePaperState();
    return true;
  }

  if(d==='SELL'&&p){
    const proceeds=p.qty*price;
    const pnlIls=proceeds-p.allocationIls;
    const pnlPct=(price/p.entryPrice-1)*100;

    paper.cashIls+=proceeds;
    paper.trades.unshift({
      symbol:s,
      buyPrice:p.entryPrice,
      sellPrice:price,
      pnlIls,
      pnlPct,
      at,
      exitReason:meta.reason||'SELL',
      exitScore:Number.isFinite(+meta.score)?+meta.score:null,
      rotatedTo:meta.rotatedTo||null
    });
    paper.trades=paper.trades.slice(0,100);
    delete paper.positions[s];
    paper.lastAction={type:'SELL',symbol:s,price,at,...meta};
    pushDemoAction({
      type:meta.reason==='ROTATION_OUT'?'ROTATE_OUT':'SELL',
      symbol:s,
      price,
      amountIls:proceeds,
      qty:p.qty,
      pnlIls,
      pnlPct,
      reason:meta.reason||'SELL',
      at:new Date().toISOString(),
      rotatedTo:meta.rotatedTo||null
    });
    savePaperState();
    return true;
  }

  return false;
}

/*
  Score 0..100-ish.

  Components:
  1) Current UP wave, capped at 12%               => 0..40
  2) Dominance vs previous DOWN wave             => 0..30
  3) Distance above MA200, capped at 30%         => 0..20
  4) Base confirmation bonus                     => 10
  5) Overextension penalty above 20% wave        => 0..25-

  Important: a 30%-70% pump does NOT automatically win.
*/
function buyQualification(st){
  if(!st)return {qualified:false,reason:'NO_DATA'};
  if(st.direction!=='UP')return {qualified:false,reason:'NOT_UP'};
  if(!st.aboveMA)return {qualified:false,reason:'BELOW_MA200'};
  return {qualified:true,reason:'UP_TREND'};
}

function scoreStrategy(st){
  if(!st)return 0;

  const wave=Math.max(0,Number(st.currentWave)||0);
  const prevDown=Math.max(0.25,Number(st.previousDownWave)||0.25);
  const price=Number(st.price)||0;
  const ma=Number(st.ma)||0;

  // Strength score is informational for ALL assets, not a BUY permission.
  const directionScore=st.direction==='UP'?15:0;

  // Momentum: strongest around the intended entry zone, but still informative outside it.
  let waveScore=0;
  if(wave<=3){
    waveScore=(wave/3)*20;
  }else if(wave<=8){
    waveScore=20+((wave-3)/5)*20;
  }else if(wave<=20){
    waveScore=40-Math.min(20,((wave-8)/12)*20);
  }else{
    waveScore=Math.max(5,20-Math.min(15,(wave-20)*0.5));
  }

  const dominance=wave/prevDown;
  const dominanceScore=Math.max(0,Math.min(1,(dominance-0.5)/2.5))*25;

  const maDistancePct=ma>0?(price/ma-1)*100:0;
  const maScore=st.aboveMA
    ? Math.min(Math.max(maDistancePct,0),30)/30*20
    : Math.max(-10,maDistancePct/10*10);

  const qualification=buyQualification(st);
  const qualificationBonus=qualification.qualified?10:0;

  return Math.max(
    0,
    Math.min(
      100,
      Math.round((directionScore+waveScore+dominanceScore+maScore+qualificationBonus)*10)/10
    )
  );
}

async function evaluateSymbol(s){
  try{
    let p=tradingPositions()[s]||null;
    let used=paper.actionLog.filter(a=>a.type==='BUY'&&a.symbol===s).map(a=>a.patternId);
    used.push(...(paper.usedPatterns?.[s]||[]));
    if(DEMO_TRADING&&mode==='demo')used=[...(demoTrader.state.usedPatterns?.[s]||[]),...demoTrader.state.actionLog.filter(a=>a.type==='BUY'&&a.symbol===s).map(a=>a.patternId)];
    if(mode==='live'){
      p=tradingPositions()[s]||null;
      used=liveActionLog.filter(a=>a.type==='BUY'&&a.symbol===s).map(a=>a.wyckoffTrade?.patternId);
    }
    const livePrice=requireLivePrice(streams[s]);
    const ev=evaluateDailyTrade({symbol:s,bars:p?[]:await candles(s),price:livePrice,priceAsOf:streams[s]?.lastEventAt,position:p,usedPatternIds:used,timeframe:'5m',exitEvaluator:wyckoffExit});
    if(p){
      if(mode==='live')persistLivePeak(s,p);
      else if(DEMO_TRADING)demoTrader.save();
      else savePaperState();
    }
    ev.analysisSignal=ev.entryConfirmed===true;
    ev.analysisReason=ev.buyReason;
    if(!p && (tradeControl.paused || (tradeControl.resumedAt && Number(ev.strategy?.wyckoff?.signalTime||0)<=Date.parse(tradeControl.resumedAt)))){
      ev.entryConfirmed=false;
      ev.entryEligible=false;
      ev.rawDecision='HOLD';
      ev.buyQualified=false;
      ev.wyckoffTrade=null;
      ev.buyReason=tradeControl.paused?'TRADING_PAUSED':'WAIT_NEW_WYCKOFF_SIGNAL';
      if(ev.strategy)ev.strategy.buyConfirmed=false;
    }
    ev.demoTradable=DEMO_TRADING?(await demoTradableSymbols()).has(s):true;
    ev.decisionPriceSource='5M_CONFIRMED_WITH_LIVE_EXECUTION';
    return ev;
  }catch(e){return {ok:false,symbol:s,error:e.message};}
}

function setAgentFromEval(ev,decision='HOLD',execution='IDLE',strategy=null){
  if(!ev.ok){
    agents[ev.symbol]={
      ...(agents[ev.symbol]||{symbol:ev.symbol,position:'CASH',decision:'HOLD'}),
      lastError:ev.error,
      execution:'ERROR',
      decision:'WAIT_DATA',
      entryConfirmed:false,
      entryEligible:false,
      buyQualified:false,
      staleData:true,
      lastDecisionAt:new Date().toISOString()
    };
    return;
  }

  agents[ev.symbol]={
    ...agents[ev.symbol],
    symbol:ev.symbol,
    position:tradingPositions()[ev.symbol]?'LONG':'CASH',
    decision,
    strategy:ev.strategy,
    score:ev.score,
    buyQualified:ev.buyQualified,
    buyReason:ev.buyReason,
    entryEligible:ev.entryEligible,
    entryConfirmed:ev.entryConfirmed,
    entryBasePrice:ev.entryBasePrice,
    entryTargetPrice:ev.entryTargetPrice,
    entryGainPct:ev.entryGainPct,
    entryCost:ev.entryCost,
    entryTriggerPct:ev.entryTriggerPct,
    entryMinScore:ev.entryMinScore,
    entryMaxRunPct:ev.entryMaxRunPct,
    stopLossPct:ev.stopLossPct,
    trailActivatePct:ev.trailActivatePct,
    exitTrailPct:ev.exitTrailPct,
    peakPrice:ev.peakPrice,
    trailingStopPrice:ev.trailingStopPrice,
    drawdownFromPeakPct:ev.drawdownFromPeakPct,
    rotation:strategy,
    lastDecisionAt:new Date().toISOString(),
    lastError:null,
    staleData:false,
    execution
  };
}

function decisionReasonFromAgent(agent,ev){
  if(!ev?.ok)return ev?.error||'WAIT_DATA';
  if(agent?.decision==='BUY')return ev.entryStage===2?'BREAKOUT_STAGE_2_BUY':'BREAKOUT_STAGE_1_BUY';
  if(agent?.decision==='SELL')return 'SELL_EXECUTED';
  if(ev.entryConfirmed&&ev.entryStage===2)return 'STAGE_2_READY';
  if(agent?.position==='LONG')return 'ACTIVE_LONG';
  if(ev.entryConfirmed)return 'STAGE_1_READY';
  return ev.buyReason||'WAIT_CONSOLIDATION_BREAKOUT';
}

function candidateBlocker(ev,evals){
  if(!ev?.ok)return {code:ev?.error||'WAIT_DATA',text:'ממתין לנרות 5 דקות סגורים או למחיר עדכני'};
  if(ev.demoTradable===false)return {code:'NOT_DEMO_TRADABLE',text:'אינו זמין למסחר בדמו'};
  if(ev.position==='LONG')return {code:['WYCKOFF_D1_V1','WYCKOFF_5M_V1'].includes(ev.strategy?.strategyId)?'ACTIVE_LONG':'LEGACY_POSITION_REQUIRES_REVIEW',text:['WYCKOFF_D1_V1','WYCKOFF_5M_V1'].includes(ev.strategy?.strategyId)?'עצירה 2% מהכניסה או ירידה 2.5% מהשיא — ללא יעד מכירה קבוע':'החזקה קודמת ללא שיא ראשוני מתועד — נדרש בירור'};
  if(!ev.entryConfirmed)return {code:ev.buyReason,text:'וויקוף 5 דקות: '+ev.buyReason};
  if(Object.keys(tradingPositions()).length>=MAX)return {code:'NO_SLOT',text:'אין מקום פנוי'};
  return {code:'BUY_READY',text:'חצייה מעל השפל הראשון אושרה בנר 5 דקות סגור'};
}

function weakestHeldEvaluation(evals){
  const held=evals
    .filter(x=>x.ok&&tradingPositions()[x.symbol])
    .map(x=>({
      ...x,
      comparableScore:Number(x.score||0)
    }))
    .sort((a,b)=>a.comparableScore-b.comparableScore);

  return held[0]||null;
}

async function waitForDemoTraderIdle(timeoutMs=60000){
  const started=Date.now();
  while(demoTrader.busy && Date.now()-started<timeoutMs){
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  return !demoTrader.busy;
}

let evaluationInFlight=null;
function evalAll(){
  if(evaluationInFlight)return evaluationInFlight;
  evaluationInFlight=runEvaluation().finally(()=>{evaluationInFlight=null;});
  return evaluationInFlight;
}
async function runEvaluation(){
  // Phase 1: evaluate ALL symbols first.
  const evals=[];
  for(const s of new Set([...SYMBOLS,...Object.keys(tradingPositions())])){
    evals.push(await evaluateSymbol(s));
  }

  const valid=evals.filter(e=>e.ok);
  const stage1Ready=valid.filter(e=>e.entryConfirmed&&e.entryStage===1);
  const stage2Ready=valid.filter(e=>e.entryConfirmed&&e.entryStage===2);
  strategyDiagnostics={
    ...strategyDiagnostics,
    evaluated:evals.length,
    dailyReady:valid.length,
    consolidation:valid.filter(e=>e.strategy?.wyckoff?.phase==='CONSOLIDATION').length,
    spring:valid.filter(e=>e.strategy?.wyckoff?.phase==='SPRING').length,
    stage1Ready:stage1Ready.length,
    stage2Ready:stage2Ready.length,
    executionCandidates:stage1Ready.length+stage2Ready.length,
    nearestToTarget:valid
      .filter(e=>tradingPositions()[e.symbol]&&Number(tradingPositions()[e.symbol]?.riskStage||1)===1)
      .map(e=>({
        symbol:e.symbol,
        gainPct:Number(e.entryGainPct||0),
        remainingPct:Math.max(0,0.6-Number(e.entryGainPct||0))
      }))
      .sort((a,b)=>a.remainingPct-b.remainingPct)
      .slice(0,8),
    updatedAt:new Date().toISOString()
  };

  if(DEMO_TRADING&&mode==='demo'){
    const idle=await waitForDemoTraderIdle();
    if(!idle){
      demoTrader.error='BUY cycle delayed: Demo execution lock stayed busy for 60 seconds';
      setTimeout(()=>evalAll().catch(e=>console.error('Delayed evaluation failed',e.message)),1500).unref?.();
    }else{
      await demoTrader.cycle(tradeControl.paused?evals.map(ev=>({...ev,entryConfirmed:false})):evals,{
        rotationEnabled:false,
        minScore:0,
        scoreGap:0,
        maxRotations:0
      });
      const diagAttempts=demoTrader.state.lastCycle?.attempts||[];
      strategyDiagnostics.demoAttempts=diagAttempts.length;
      strategyDiagnostics.demoFilled=diagAttempts.filter(x=>x.ok).length;
      strategyDiagnostics.demoRejected=diagAttempts.filter(x=>!x.ok).length;
      strategyDiagnostics.lastDemoAttempts=diagAttempts.slice(0,10);
    }
    const positions=demoTrader.state.positions;
    for(const ev of evals){
      const held=!!positions[ev.symbol];
      const last=demoTrader.state.actionLog.find(a=>a.symbol===ev.symbol);
      const executed=last&&Date.parse(last.at)>=Date.parse(ev.at);
      const activeCount=Object.keys(positions).length;
      const qualified=!!ev.entryConfirmed;

      let decision='HOLD';
      let blocker={code:'HOLD',text:'לא כשיר כרגע'};
      let execution='IDLE';

      if(executed){
        decision=last.type;
        execution='BINANCE_DEMO_EXECUTED';
        blocker={code:last.type,text:last.type+' בוצע'};
      }else if(held){
        decision='ACTIVE_LONG';
        execution='HOLDING';
        blocker={code:'ACTIVE_LONG',text:'פוזיציה פעילה'};
      }else if(demoTrader.state.pending){
        decision='WAIT_EXECUTION';
        execution='PENDING_ORDER';
        blocker={code:'PENDING_ORDER',text:'ממתין לסיום הזמנה קודמת'};
      }else if(demoTrader.error){
        decision='WAIT_EXECUTION';
        execution='ERROR';
        blocker={code:'DEMO_EXECUTION_ERROR',text:'חסם ביצוע: '+demoTrader.error};
      }else if(qualified && activeCount>=MAX){
        decision='WAIT_NO_SLOT';
        execution='NO_SLOT';
        blocker={code:'NO_SLOT',text:'אין Slot פנוי · '+activeCount+'/'+MAX};
      }else if(qualified){
        const snap=demoTrader.snapshot();
        const cash=Number(snap?.cashIls||0);
        const attempt=demoTrader.state.lastCycle?.attempts?.find(x=>x.symbol===ev.symbol);

        if(attempt && !attempt.ok){
          decision='WAIT_EXECUTION';
          execution='BUY_REJECTED';
          const reasonMap={
            NO_CASH:'אין USDT פנוי לקנייה',
            BELOW_MIN_NOTIONAL:'סכום הקנייה נמוך מהמינימום של Binance',
            ALREADY_HELD:'הנכס כבר מוחזק בחשבון',
            NO_SLOT:'אין Slot פנוי',
            NOT_ADDED:'ההזמנה הסתיימה אך הפוזיציה לא נוספה',
            ERROR:attempt.error||'שגיאת Binance Demo',
            STALE_EVALUATION:'המחיר שעליו התבססה ההחלטה התיישן; נדרשת סריקה חדשה'
            ,WAIT_COST_DATA:'ממתין לנתוני עומק עדכניים',WAIT_LIQUIDITY:'אין עומק מספיק לעסקה',WAIT_SPREAD:'מרווח קנייה ומכירה רחב מדי',WAIT_COST:'עלות העסקה גבוהה מדי'
          };
          blocker={
            code:'BUY_'+(attempt.reason||'REJECTED'),
            text:'BUY לא בוצע · '+(reasonMap[attempt.reason]||attempt.reason||'סיבה לא ידועה')
          };
        }else if(!(cash>0)){
          decision='WAIT_EXECUTION';
          execution='NO_CASH';
          blocker={code:'NO_CASH',text:'אין USDT פנוי לקנייה'};
        }else{
          decision='BUY_READY';
          execution='READY';
          blocker={code:'BUY_READY',text:'מוכן ל-BUY · יבוצע במחזור הקרוב'};
        }
      }else{
        decision='HOLD';
        execution='IDLE';
        blocker=candidateBlocker(ev,evals);
      }

      setAgentFromEval(ev,decision,execution);
      agents[ev.symbol].blocker=blocker;

      pushDecisionHistory(ev.symbol,{
        at:new Date().toISOString(),
        mode:'demo',
        source:'BINANCE_DEMO_SPOT',
        decision,
        execution,
        reason:ev.ok?blocker.text:(ev.error||'WAIT_DATA'),
        blockerCode:blocker.code,
        position:held?'LONG':'CASH',
        price:ev.strategy?.price??null,
        score:ev.score,
        entryConfirmed:ev.entryConfirmed===true,
        analysisError:ev.ok?null:(ev.error||'WAIT_DATA'),
        analysisSignal:ev.analysisSignal===true,
        analysisReason:ev.analysisReason||ev.error||null,
        buyReason:ev.buyReason||null,
        setup:ev.strategy?.wyckoff||null,
        targetPrice:ev.entryTargetPrice??null,
        activeSlots:activeCount,
        maxSlots:MAX,
        demoError:demoTrader.error||null,
        pendingOrder:demoTrader.state.pending?.clientId||null
      });
    }
    saveDecisionHistory();
    return;
  }

  // Default UI state.
  for(const ev of evals){
    if(!ev.ok){
      setAgentFromEval(ev);
      continue;
    }

    const isHeld=!!paper.positions[ev.symbol];

    if(isHeld){
      setAgentFromEval(ev,'ACTIVE_LONG','HOLDING');
    }else if(ev.rawDecision==='BUY'){
      setAgentFromEval(
        ev,
        Object.keys(paper.positions).length>=MAX?'WAIT_NO_SLOT':'BUY_READY',
        Object.keys(paper.positions).length>=MAX?'NO_SLOT':'READY'
      );
    }else{
      setAgentFromEval(ev,'HOLD','IDLE');
    }
  }

  // Phase 2: execute normal SELL signals first.
  if(mode==='demo'){
    for(const ev of evals){
      if(!ev.ok||!paper.positions[ev.symbol])continue;

      if(ev.rawDecision==='SELL'){
        apply(
          ev.symbol,
          'SELL',
          ev.strategy.price,
          ev.at,
          {reason:ev.strategy?.exitReason||'STRATEGY_SELL',score:ev.score}
        );
        setAgentFromEval(ev,'SELL','PAPER_EXECUTED');
      }
    }
  }

  // Phase 3: fill genuinely free slots with strongest BUY candidates first.
  if(mode==='demo'){
    const candidates=evals
      .filter(ev=>
        ev.ok &&
        (!DEMO_TRADING || mode!=='demo' || ev.demoTradable!==false) &&
        !paper.positions[ev.symbol] &&
        ev.rawDecision==='BUY' &&
        ev.entryConfirmed
      )
      .sort((a,b)=>b.score-a.score);

    while(Object.keys(paper.positions).length<MAX && candidates.length){
      const ev=candidates.shift();
      const bought=apply(
        ev.symbol,
        'BUY',
        ev.strategy.price,
        ev.at,
        {reason:'WYCKOFF_RECLAIM',score:ev.score,wyckoffTrade:ev.wyckoffTrade}
      );
      if(bought)setAgentFromEval(ev,'BUY','PAPER_EXECUTED');
    }
  }

  // Phase 4: smart rotation when all slots are occupied.
  if(
    mode==='demo' &&
    ROTATION_ENABLED &&
    ROTATION_MAX_PER_CYCLE>0 &&
    Object.keys(paper.positions).length>=MAX
  ){
    const outsideCandidates=evals
      .filter(ev=>
        ev.ok &&
        (!DEMO_TRADING || mode!=='demo' || ev.demoTradable!==false) &&
        !paper.positions[ev.symbol] &&
        ev.rawDecision==='BUY'
      )
      .sort((a,b)=>b.score-a.score);

    let rotations=0;

    for(const candidate of outsideCandidates){
      if(rotations>=ROTATION_MAX_PER_CYCLE)break;

      const weakest=weakestHeldEvaluation(evals);
      if(!weakest)break;

      const weakScore=weakest.comparableScore;
      const gap=candidate.score-weakScore;

      const qualifies=
        candidate.score>=ROTATION_MIN_SCORE &&
        gap>=ROTATION_SCORE_GAP;

      if(!qualifies){
        setAgentFromEval(
          candidate,
          'WAIT_NO_ROTATION',
          'ROTATION_NOT_STRONG_ENOUGH',
          {
            candidateScore:candidate.score,
            weakestSymbol:weakest.symbol,
            weakestScore:weakScore,
            requiredGap:ROTATION_SCORE_GAP
          }
        );
        continue;
      }

      // Sell weakest first, then use the freed slot to buy the stronger candidate.
      const sold=apply(
        weakest.symbol,
        'SELL',
        weakest.strategy.price,
        weakest.at,
        {
          reason:'ROTATION_OUT',
          score:weakScore,
          rotatedTo:candidate.symbol,
          candidateScore:candidate.score,
          scoreGap:gap
        }
      );

      if(!sold)continue;

      setAgentFromEval(
        weakest,
        'ROTATE_OUT',
        'PAPER_ROTATED_OUT',
        {
          to:candidate.symbol,
          heldScore:weakScore,
          candidateScore:candidate.score,
          scoreGap:gap
        }
      );

      const bought=apply(
        candidate.symbol,
        'BUY',
        candidate.strategy.price,
        candidate.at,
        {
          reason:'ROTATION_IN',
          score:candidate.score,
          rotatedFrom:weakest.symbol,
          previousScore:weakScore,
          scoreGap:gap
        }
      );

      if(bought){
        rotations++;
        setAgentFromEval(
          candidate,
          'ROTATE_IN',
          'PAPER_ROTATED_IN',
          {
            from:weakest.symbol,
            heldScore:weakScore,
            candidateScore:candidate.score,
            scoreGap:gap
          }
        );
      }
    }
  }

  // LIVE execution is separately gated by API permission + LIVE flag + AUTO_EXECUTION.
  try{
    await maybeExecuteLive(evals);
  }catch(e){
    console.error('LIVE execution cycle failed',e.message);
  }

  // Final UI reconciliation after any trades/rotations.
  for(const ev of evals){
    if(!ev.ok)continue;

    if(
      ['PAPER_EXECUTED','PAPER_ROTATED_OUT','PAPER_ROTATED_IN']
        .includes(agents[ev.symbol]?.execution)
    )continue;

    const isHeld=!!paper.positions[ev.symbol];

    if(isHeld){
      agents[ev.symbol].position='LONG';
      agents[ev.symbol].decision='ACTIVE_LONG';
      agents[ev.symbol].execution='HOLDING';
      continue;
    }

    agents[ev.symbol].position='CASH';

    if(ev.rawDecision==='BUY'){
      if(Object.keys(paper.positions).length>=MAX){
        if(!String(agents[ev.symbol]?.decision||'').startsWith('WAIT_NO_ROTATION')){
          agents[ev.symbol].decision='WAIT_NO_SLOT';
          agents[ev.symbol].execution='NO_SLOT';
        }
      }else{
        agents[ev.symbol].decision='BUY_READY';
        agents[ev.symbol].execution='READY';
      }
    }else{
      agents[ev.symbol].decision='HOLD';
      agents[ev.symbol].execution='IDLE';
    }
  }

  // Attach a human-readable blocker/readiness reason to every asset.
  for(const ev of evals){
    if(!ev.ok)continue;
    agents[ev.symbol].blocker=candidateBlocker(ev,evals);
  }

  // Record the final decision context for every symbol after the cycle completes.
  const slotCountAtCheck=Object.keys(paper.positions).length;
  for(const ev of evals){
    const a=agents[ev.symbol]||{};
    pushDecisionHistory(ev.symbol,{
      at:new Date().toISOString(),
      mode,
      decision:a.decision||'HOLD',
      execution:a.execution||'IDLE',
      reason:decisionReasonFromAgent(a,ev),
      position:a.position||'CASH',
      price:Number(ev.strategy?.price||0),
      ma:Number(ev.strategy?.ma||0),
      aboveMA:Boolean(ev.strategy?.aboveMA),
      direction:ev.strategy?.direction||null,
      currentWave:Number(ev.strategy?.currentWave||0),
      previousDownWave:ev.strategy?.previousDownWave==null?null:Number(ev.strategy.previousDownWave),
      previousUpWave:ev.strategy?.previousUpWave==null?null:Number(ev.strategy.previousUpWave),
      sellThreshold:ev.strategy?.sellThreshold==null?null:Number(ev.strategy.sellThreshold),
      sellRetraceRatio:Number(ev.strategy?.sellRetraceRatio??SELL_RETRACE_RATIO),
      decisionPriceSource:ev.decisionPriceSource||'CLOSED_5M',
      livePrice:ev.strategy?.livePrice==null?null:Number(ev.strategy.livePrice),
      closedPrice:ev.strategy?.closedPrice==null?Number(ev.strategy?.price||0):Number(ev.strategy.closedPrice),
      score:Number(ev.score||0),
      entryConfirmed:ev.entryConfirmed===true,
      analysisError:ev.ok?null:(ev.error||'WAIT_DATA'),
      analysisSignal:ev.analysisSignal===true,
      analysisReason:ev.analysisReason||ev.error||null,
      setup:ev.strategy?.wyckoff||null,
      targetPrice:ev.entryTargetPrice??null,
      buyQualified:Boolean(ev.buyQualified),
      buyReason:ev.buyReason||null,
      activeSlots:slotCountAtCheck,
      maxSlots:MAX
    });
  }
  saveDecisionHistory();
}

async function buildTechnicalDailyHistory(symbol,limit=30){
  const c=await candles(symbol),rows=[];
  for(let i=Math.max(2,c.length-limit);i<c.length;i++){
   const historicalNow=c[i].closeTime+1;
   const ev=evaluateDailyTrade({symbol,bars:c.slice(0,i+1),price:c[i].close,priceAsOf:new Date(historicalNow).toISOString(),now:historicalNow,timeframe:'5m'});
   rows.push({at:new Date(c[i].closeTime).toISOString(),price:c[i].close,phase:ev.strategy.phase,buyQualified:ev.entryConfirmed,buyReason:ev.buyReason,technicalDecision:ev.entryConfirmed?'BUY_READY':'HOLD',timeframe:'5m',strategyId:'WYCKOFF_5M_V1'});
  }
  return rows.reverse();
}

async function refreshUniverse(){
  try{
    universeStatus='REFRESHING';
    universeError=null;

    const selected=await selectUniverse();

    if(selected.length){
      initUniverse(selected);
      // Closed 5-minute history is loaded by candles(); execution prices remain live.
      startMarketStream();
      await evalAll();
      universeStatus='READY';
      console.log('Universe',SYMBOLS.length,SYMBOLS.join(','));
    }
  }catch(e){
    universeStatus='ERROR';
    universeError=e.message;
    console.error('Universe refresh failed',e.message);
  }
}

setInterval(()=>evalAll().catch(e=>console.error('Evaluation failed',e.message)),DECISION_INTERVAL_MS).unref();
// Exit monitoring does not wait for the 100-symbol daily-candle scan.
setInterval(async()=>{
  if(mode==='live'){
   if(!LIVE||!AUTO_EXECUTION)return;
   try{await maybeExecuteLive(await Promise.all(Object.keys(tradingPositions()).map(evaluateSymbol)));}catch(e){console.error('LIVE exit monitor failed',e.message);}
   return;
  }
  if(!DEMO_TRADING||mode!=='demo')return;
  if(!await demoTrader.monitorExits())return;
  for(const a of Object.values(agents)){
    if(a.position==='LONG'&&!demoTrader.state.positions[a.symbol]){
      a.position='CASH';a.decision='SELL';a.execution='BINANCE_DEMO_EXECUTED';
      a.lastDecisionAt=demoTrader.state.actionLog.find(x=>x.symbol===a.symbol&&x.type==='SELL')?.at;
    }
  }
},5000).unref();
setInterval(refreshUniverse,300000).unref();


function analyzeCandlePower(candles,lookback=10){
  const rows=(Array.isArray(candles)?candles:[]).slice(-Math.max(3,lookback));
  const analyzed=rows.map((c,index)=>{
    const open=Number(c.open),high=Number(c.high),low=Number(c.low),close=Number(c.close),volume=Number(c.volume||0);
    const range=Math.max(high-low,Number.EPSILON);
    const body=Math.abs(close-open);
    const upper=Math.max(0,high-Math.max(open,close));
    const lower=Math.max(0,Math.min(open,close)-low);
    const bodyRatio=body/range;
    const upperRatio=upper/range;
    const lowerRatio=lower/range;
    const closeLocation=(close-low)/range;
    const changePct=open?((close/open)-1)*100:0;

    let state='NEUTRAL',reason='נר מאוזן';
    if(close>open && bodyRatio>=0.45 && closeLocation>=0.68){
      state='BUYERS_STRONG'; reason='גוף ירוק משמעותי וסגירה קרובה לגבוה';
    }else if(close<open && bodyRatio>=0.45 && closeLocation<=0.32){
      state='SELLERS_STRONG'; reason='גוף אדום משמעותי וסגירה קרובה לנמוך';
    }else if(lowerRatio>=0.42 && closeLocation>=0.55){
      state='BUYERS_REJECTION'; reason='פתיל תחתון ארוך — קונים דחו את הירידה';
    }else if(upperRatio>=0.42 && closeLocation<=0.45){
      state='SELLERS_REJECTION'; reason='פתיל עליון ארוך — מוכרים דחו את העלייה';
    }else if(close>open){
      state='BUYERS_EDGE'; reason='יתרון קל לקונים';
    }else if(close<open){
      state='SELLERS_EDGE'; reason='יתרון קל למוכרים';
    }

    const buyerPoints=
      (close>=open?25:0)+
      Math.max(0,Math.min(35,closeLocation*35))+
      Math.max(0,Math.min(25,lowerRatio*50))+
      (state==='BUYERS_STRONG'?15:state==='BUYERS_REJECTION'?12:state==='BUYERS_EDGE'?6:0);
    const sellerPoints=
      (close<=open?25:0)+
      Math.max(0,Math.min(35,(1-closeLocation)*35))+
      Math.max(0,Math.min(25,upperRatio*50))+
      (state==='SELLERS_STRONG'?15:state==='SELLERS_REJECTION'?12:state==='SELLERS_EDGE'?6:0);

    return {
      index:index+1,
      openTime:Number(c.openTime||0),
      closeTime:Number(c.closeTime||0),
      open,high,low,close,volume,
      changePct,
      bodyPct:bodyRatio*100,
      upperWickPct:upperRatio*100,
      lowerWickPct:lowerRatio*100,
      closeLocationPct:closeLocation*100,
      state,reason,
      buyerPoints:Math.round(buyerPoints*10)/10,
      sellerPoints:Math.round(sellerPoints*10)/10
    };
  });

  let higherHighs=0,higherLows=0,lowerHighs=0,lowerLows=0;
  for(let i=1;i<rows.length;i++){
    if(Number(rows[i].high)>Number(rows[i-1].high))higherHighs++; else if(Number(rows[i].high)<Number(rows[i-1].high))lowerHighs++;
    if(Number(rows[i].low)>Number(rows[i-1].low))higherLows++; else if(Number(rows[i].low)<Number(rows[i-1].low))lowerLows++;
  }

  const buyerScore=analyzed.reduce((a,x)=>a+x.buyerPoints,0);
  const sellerScore=analyzed.reduce((a,x)=>a+x.sellerPoints,0);
  const structureUp=higherHighs+higherLows;
  const structureDown=lowerHighs+lowerLows;

  let trend='SIDEWAYS';
  if(structureUp>=structureDown+3 && buyerScore>sellerScore)trend='UP';
  else if(structureDown>=structureUp+3 && sellerScore>buyerScore)trend='DOWN';

  const buyerCandles=analyzed.filter(x=>x.state.startsWith('BUYERS')).length;
  const sellerCandles=analyzed.filter(x=>x.state.startsWith('SELLERS')).length;
  const neutralCandles=Math.max(0,analyzed.length-buyerCandles-sellerCandles);

  let control='BALANCED';
  if(buyerCandles>=7 && sellerCandles<=3)control='BUYERS';
  else if(sellerCandles>=7 && buyerCandles<=3)control='SELLERS';

  return {
    lookback:analyzed.length,
    trend,
    control,
    buyerCandles,
    sellerCandles,
    neutralCandles,
    buyerScore:Math.round(buyerScore*10)/10,
    sellerScore:Math.round(sellerScore*10)/10,
    higherHighs,higherLows,lowerHighs,lowerLows,
    explanation:
      trend==='UP'?'מבנה המחיר נוטה לשיאים ושפלים עולים':
      trend==='DOWN'?'מבנה המחיר נוטה לשיאים ושפלים יורדים':
      'אין כרגע רצף מספיק ברור של שיאים ושפלים',
    candles:analyzed
  };
}

const send=(res,o,c=200)=>{
  res.writeHead(c,{
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Cache-Control':'no-store'
  });
  res.end(JSON.stringify(o));
};

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host}`);

  if(req.method==='OPTIONS')return send(res,{},204);
  const protectedControl=req.method==='POST'&&(
    u.pathname==='/api/binance-mode'||u.pathname==='/api/binance-trade-control'||u.pathname.startsWith('/api/binance-live/')||
    (mode==='live'&&u.pathname==='/api/binance-agent/evaluate')
  );
  if(protectedControl&&!controlAuthorized(req.headers.authorization,process.env.BINANCE_CONTROL_TOKEN)){
    return send(res,{ok:false,error:'Authenticated control required: configure BINANCE_CONTROL_TOKEN (at least 32 characters) and send a Bearer token'},401);
  }

  const sf={
    '/binance-agent.html':['binance-agent.html','text/html'],
    '/binance-agent.js':['binance-agent.js','text/javascript'],
    '/binance-agent.css':['binance-agent.css','text/css'],
    '/binance-demo-account.js':['binance-demo-account.js','text/javascript'],
    '/binance-agent-portfolio.js':['binance-agent-portfolio.js','text/javascript']
  };

  if(req.method==='GET'&&sf[u.pathname]){
    const [f,t]=sf[u.pathname];
    res.writeHead(200,{'Content-Type':t,'Cache-Control':'no-store'});
    return res.end(fs.readFileSync(path.join(D,f)));
  }

  if(u.pathname==='/api/binance-trade-control'&&req.method==='POST'){
    let body='';
    req.on('data',chunk=>{body+=chunk;if(body.length>10000)req.destroy();});
    req.on('end',async()=>{
      try{
        const action=JSON.parse(body||'{}').action;
        if(!['stop','start'].includes(action))return send(res,{ok:false,error:'Invalid action'},400);
        if(action==='start'){
          // Remain stopped until previous positions are actually closed.
          if(DEMO_TRADING && Object.keys(demoTrader.state.positions).length)
            return send(res,{ok:false,error:'יש פוזיציות דמו שלא נסגרו. יש להשלים עצירה לפני התחלה.'},409);
          if(mode==='live'&&Object.keys(trackedLivePositions(liveActionLog)).length)
            return send(res,{ok:false,error:'יש פוזיציות LIVE שלא נסגרו. יש להשלים עצירה לפני התחלה.'},409);
          tradeControl={...tradeControl,paused:false,resumedAt:new Date().toISOString(),lastStop:null};
          saveTradeControl();
          return send(res,{ok:true,tradeControl});
        }
        tradeControl.paused=true;
        tradeControl.pausedAt=new Date().toISOString();
        saveTradeControl();
        // Wait for in-flight evaluation and order cycles to finish before liquidating.
        if(evaluationInFlight)await evaluationInFlight;
        const sold=[],failed=[];
        if(mode==='live'){
          if(!LIVE || !AUTO_EXECUTION)return send(res,{ok:false,tradeControl,error:'LIVE execution is not enabled; no liquidation was attempted'},409);
          const gate=liveTradingGate(await getApiRestrictions());
          if(!gate.ready||gate.withdrawalsEnabled)return send(res,{ok:false,tradeControl,error:'LIVE trading gate is not ready'},409);
          await liveOrders.recover(p=>signedBinanceGet('/api/v3/order',{symbol:p.params.symbol,origClientOrderId:p.params.newClientOrderId}),recordLiveFill);
          const tracked=Object.keys(trackedLivePositions(liveActionLog));
          for(const symbol of tracked){
            try{await placeLiveMarketSell(symbol,'MANUAL_STOP_ALL');sold.push(symbol);}
            catch(e){failed.push({symbol,error:e.message});}
          }
        }else if(DEMO_TRADING){
          const result=await demoTrader.closeTrackedPositions('MANUAL_STOP_ALL');
          sold.push(...result.sold);failed.push(...result.failed);
        }else{
          for(const symbol of Object.keys(paper.positions)){
            const price=Number(streams[symbol]?.lastPrice);
            if(!(price>0)){failed.push({symbol,error:'No fresh price'});continue;}
            if(apply(symbol,'SELL',price,new Date().toISOString(),{reason:'MANUAL_STOP_ALL'}))sold.push(symbol);
            else failed.push({symbol,error:'SELL not applied'});
          }
        }
        tradeControl.lastStop={at:new Date().toISOString(),sold,failed};
        saveTradeControl();
        return send(res,{ok:failed.length===0,tradeControl,sold,failed},failed.length?207:200);
      }catch(e){return send(res,{ok:false,tradeControl,error:e.message},500);}
    });
    return;
  }

  if(u.pathname==='/api/binance-mode'&&req.method==='GET'){
    return send(res,{
      mode,
      tradeControl,
      demoTradingEnabled:DEMO_TRADING,
      demoTradingError:demoTrader.error,
      liveTradingEnabled:LIVE,
      autoExecution:AUTO_EXECUTION,
      keysConfigured:KEYS_CONFIGURED,
      liveReadOnly:KEYS_CONFIGURED&&(!LIVE||!AUTO_EXECUTION),
      liveMaxUsdt:LIVE_MAX_USDT
    });
  }

  if(u.pathname==='/api/binance-mode'&&req.method==='POST'){
    let b='';
    req.on('data',x=>b+=x);
    req.on('end',()=>{
      try{
        const m=JSON.parse(b).mode;
        if(!['demo','live'].includes(m))throw Error('Invalid mode');
        if(m==='live'&&!KEYS_CONFIGURED)throw Error('Binance API keys are not configured');
        mode=m;
        send(res,{ok:true,mode});
      }catch(e){
        send(res,{ok:false,error:e.message},400);
      }
    });
    return;
  }

  if(u.pathname==='/api/binance-live/buy'&&req.method==='POST'){
    let b='';
    req.on('data',x=>b+=x);
    req.on('end',async()=>{
      try{
        const body=JSON.parse(b||'{}');
        const symbol=String(body.symbol||'').toUpperCase();
        const quoteUsdt=Number(body.quoteUsdt||0);
        if(!/^[A-Z0-9]+USDT$/.test(symbol))throw Error('Invalid symbol');
        const order=await placeLiveMarketBuy(symbol,quoteUsdt,'MANUAL_BUY');
        send(res,{ok:true,order});
      }catch(e){send(res,{ok:false,error:e.message},400);}
    });
    return;
  }

  if(u.pathname==='/api/binance-live/sell'&&req.method==='POST'){
    let b='';
    req.on('data',x=>b+=x);
    req.on('end',async()=>{
      try{
        const body=JSON.parse(b||'{}');
        const symbol=String(body.symbol||'').toUpperCase();
        if(!/^[A-Z0-9]+USDT$/.test(symbol))throw Error('Invalid symbol');
        const order=await placeLiveMarketSell(symbol,'MANUAL_SELL');
        send(res,{ok:true,order});
      }catch(e){send(res,{ok:false,error:e.message},400);}
    });
    return;
  }

  if(u.pathname==='/api/binance-demo-account'&&req.method==='GET'){
    getDemoAccount({key:process.env.BINANCE_DEMO_API_KEY,secret:process.env.BINANCE_DEMO_API_SECRET})
      .then(account=>send(res,{connected:true,account}))
      .catch(e=>send(res,{connected:false,error:e.message},502));
    return;
  }

  if(u.pathname==='/api/binance-live-account'&&req.method==='GET'){
    if(!KEYS_CONFIGURED){
      return send(res,{connected:false,error:'Binance API keys are not configured'},503);
    }
    getLiveAccountSnapshot()
      .then(account=>send(res,{connected:true,account}))
      .catch(e=>send(res,{connected:false,error:e.message},502));
    return;
  }

  if(u.pathname==='/api/binance-action-log'&&req.method==='GET'){
    return send(res,{
      mode,
      demo:(DEMO_TRADING?demoTrader.state.actionLog:paper.actionLog||[]).slice(0,100),
      live:(liveActionLog||[]).slice(0,100)
    });
  }

  if(u.pathname==='/api/binance-paper/reset'&&req.method==='POST'){
    if(DEMO_TRADING)return send(res,{error:'Binance Demo account cannot be reset here'},409);
    reset();
    return send(res,{ok:true,paper:accountSnapshot()});
  }

  if(u.pathname==='/api/binance-decision-history'&&req.method==='GET'){
    const symbol=String(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
    const limit=Math.min(30,Math.max(1,Number(u.searchParams.get('limit')||20)));
    if(!/^[A-Z0-9]+USDT$/.test(symbol))return send(res,{ok:false,error:'Invalid symbol'},400);
    buildTechnicalDailyHistory(symbol,limit)
      .catch(error=>({error:error.message}))
      .then(technicalDaily=>send(res,{
        ok:true,
        symbol,
        recorded:(decisionHistory[symbol]||[]).slice(0,limit),
        technicalDaily:Array.isArray(technicalDaily)?technicalDaily:[],
        technicalError:technicalDaily?.error||null
      }))
      .catch(e=>send(res,{ok:false,error:e.message},502));
    return;
  }

  if(u.pathname==='/api/binance-chart'&&req.method==='GET'){
    const symbol=String(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
    const interval=String(u.searchParams.get('interval')||'5m');
    const range=String(u.searchParams.get('range')||'1W').toUpperCase();

    const allowedIntervals=new Set(['5m','1h','4h','1d','1w','1M']);
    const allowedRanges=new Set(['1W','1M','3M','6M','1Y','ALL']);

    if(!/^[A-Z0-9]+USDT$/.test(symbol))return send(res,{ok:false,error:'Invalid symbol'},400);
    if(!allowedIntervals.has(interval))return send(res,{ok:false,error:'Invalid interval'},400);
    if(!allowedRanges.has(range))return send(res,{ok:false,error:'Invalid range'},400);

    const now=Date.now();
    const day=86400000;
    const startByRange={
      '1W':now-7*day,
      '1M':now-31*day,
      '3M':now-93*day,
      '6M':now-186*day,
      '1Y':now-366*day,
      'ALL':Date.UTC(2017,0,1)
    };
    const startTime=interval==='5m'?Math.max(startByRange[range],now-7*day):startByRange[range];

    (async()=>{
      const rows=[];
      let cursor=startTime;
      let pages=0;

      while(cursor<now && pages<15){
        const batch=await j('/api/v3/klines?symbol='+encodeURIComponent(symbol)
          +'&interval='+encodeURIComponent(interval)
          +'&limit=1000&startTime='+cursor+'&endTime='+now);

        if(!Array.isArray(batch)||!batch.length)break;
        rows.push(...batch);

        const next=Number(batch.at(-1)?.[6]||0)+1;
        if(!Number.isFinite(next)||next<=cursor)break;
        cursor=next;
        pages++;
        if(batch.length<1000)break;
      }

      const candles=rows.map(x=>({
        openTime:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closeTime:+x[6]
      }));

      const decisions=(decisionHistory[symbol]||[]).filter(x=>Date.parse(x.at)>=startTime&&x.mode===mode);
      const actions=(mode==='live'?liveActionLog:DEMO_TRADING?demoTrader.state.actionLog:paper.actionLog||[]).filter(x=>x.symbol===symbol&&Date.parse(x.at)>=startTime);
      send(res,{ok:true,symbol,interval,range,candles,decisions,actions,decisionMode:mode,candleAnalysis:analyzeCandlePower(candles,10)});
    })().catch(e=>send(res,{ok:false,error:e.message},502));
    return;
  }

  if(u.pathname==='/api/binance-agent'&&req.method==='GET'){
    const isWyckoffFill=a=>['WYCKOFF_D1_V1','WYCKOFF_5M_V1'].includes(a?.strategyId||a?.wyckoffTrade?.strategyId);
    const wyckoffStats=mode==='live'
      ? {
          buys:liveActionLog.filter(a=>a.type==='BUY'&&isWyckoffFill(a)).length,
          sells:liveActionLog.filter(a=>a.type==='SELL'&&isWyckoffFill(a)).length,
          closed:liveActionLog.filter(a=>a.type==='SELL'&&isWyckoffFill(a)).length,
          scope:'recent_live_log'
        }
      : DEMO_TRADING
        ? {...demoTrader.wyckoffStats(),scope:'demo_persistent'}
        : {
            buys:(paper.actionLog||[]).filter(a=>a.type==='BUY'&&isWyckoffFill(a)).length,
            sells:(paper.actionLog||[]).filter(a=>a.type==='SELL'&&isWyckoffFill(a)).length,
            closed:(paper.actionLog||[]).filter(a=>a.type==='SELL'&&isWyckoffFill(a)).length,
            scope:'paper_log'
          };
    return send(res,{
      wyckoffStats,
      mode,
      tradeControl,
      symbols:SYMBOLS,
      streams,
      agents:Object.values(agents),
      paper:accountSnapshot(),
      universeStatus,
      universeError,
      config:{
        strategyId:'WYCKOFF_5M_V1',
        timeframe:'5m',
        targetMultiplier:1.07,
        wyckoffStopLossPct:6,
        minWave:MIN,
        maPeriod:MAP,
        maxPositions:MAX,
        slotIls:SLOT,
        longOnly:true,
        universeSize:UNIVERSE_SIZE,
        universeMethod:MANUAL_SYMBOLS.length?'manual':'top USDT spot by 24h quote volume',
        rotationEnabled:ROTATION_ENABLED,
        rotationMinScore:ROTATION_MIN_SCORE,
        rotationScoreGap:ROTATION_SCORE_GAP,
        rotationMaxPerCycle:ROTATION_MAX_PER_CYCLE,
        entryTriggerPct:ENTRY_TRIGGER_PCT,
        entryMinScore:null,
        entryMaxRunPct:null,
        entryCostFilter:{enabled:true,...ENTRY_COST_OPTIONS,feeSource:'CONFIGURED_ESTIMATE'},
        stopLossPct:6,
        trailActivatePct:0,
        exitTrailPct:null,
          buyCandidateCount:Object.values(agents).filter(a=>a?.entryConfirmed&&a?.position!=='LONG').length,
          trendCandidateCount:Object.values(agents).filter(a=>a?.buyQualified&&a?.position!=='LONG').length,
          demoExecutionBusy:demoTrader.busy,
          demoExecutionError:demoTrader.error||null,
          demoLastCycle:demoTrader.state.lastCycle||null,
          demoUniverseFiltered:false,
          demoTradableCount:Object.values(agents).filter(a=>a?.demoTradable!==false).length,
        stateFile:STATE_FILE,
        persistentState:true,
        demoExitMonitorIntervalMs:5000,
        decisionIntervalMs:DECISION_INTERVAL_MS,
        strategyDiagnostics,
        keysConfigured:KEYS_CONFIGURED,
        liveTradingEnabled:LIVE
      }
    });
  }

  if(u.pathname==='/api/binance-agent/evaluate'&&req.method==='POST'){
    evalAll().then(()=>send(res,{
      ok:true,
      agents:Object.values(agents),
      paper:accountSnapshot()
    })).catch(e=>send(res,{ok:false,error:e.message},502));
    return;
  }

  if(u.pathname==='/api/binance-backtest'&&req.method==='GET'){
    const symbol=String(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
    const start=Date.parse(u.searchParams.get('start')||'2021-10-01T00:00:00Z');
    const windows=String(u.searchParams.get('windows')||'8,10,12,15').split(',').map(Number).filter(Number.isFinite);
    if(!/^[A-Z0-9]+USDT$/.test(symbol))return send(res,{ok:false,error:'Invalid symbol'},400);
    fetchHistoricalDaily(symbol,start,Date.now()).then(c=>{
      const results=[backtestWindow(c,{initial:5000})];
      send(res,{ok:true,symbol,candles:c.length,start:new Date(start).toISOString(),end:c.length?new Date(c.at(-1).closeTime).toISOString():null,results});
    }).catch(e=>send(res,{ok:false,error:e.message},502));
    return;
  }

  if(u.pathname==='/api/binance-universe/refresh'&&req.method==='POST'){
    refreshUniverse().then(()=>send(res,{ok:true,symbols:SYMBOLS}));
    return;
  }

  if(u.pathname==='/'||u.pathname==='/health'){
    return send(res,{
      ok:true,
      mode,
      symbols:SYMBOLS,
      paper:accountSnapshot(),
      universeStatus,
      universeError
    });
  }

  send(res,{error:'Not found'},404);
});

server.listen(PORT,'0.0.0.0',async()=>{
  console.log('Server',PORT);
  loadTradeControl();
  loadPaperState();
  loadLiveActionLog();
  loadDecisionHistory();
  /* Wyckoff upgrade preserves existing holdings and journals. */
  await refreshUniverse();
});
