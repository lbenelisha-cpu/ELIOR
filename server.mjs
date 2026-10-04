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

const D=path.dirname(fileURLToPath(import.meta.url));
const PORT=+(process.env.PORT||8080);
const MIN=+(process.env.BINANCE_WAVE_MIN_PERCENT||4);
const MAP=+(process.env.BINANCE_MA_PERIOD||200);
const MAX=3;
const INITIAL=5000;
const SLOT=INITIAL/MAX;
const UNIVERSE_SIZE=Math.min(30,Math.max(5,+(process.env.BINANCE_UNIVERSE_SIZE||30)));
const LIVE=String(process.env.BINANCE_LIVE_TRADING_ENABLED||'false')==='true';
const BINANCE_API_KEY=String(process.env.BINANCE_API_KEY||'').trim();
const BINANCE_API_SECRET=String(process.env.BINANCE_API_SECRET||'').trim();
const KEYS_CONFIGURED=Boolean(BINANCE_API_KEY&&BINANCE_API_SECRET);
const MANUAL_SYMBOLS=String(process.env.BINANCE_SYMBOLS||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);

// Rotation controls
const ROTATION_ENABLED=String(process.env.BINANCE_ROTATION_ENABLED||'true')==='true';
const ROTATION_MIN_SCORE=+(process.env.BINANCE_ROTATION_MIN_SCORE||65);
const ROTATION_SCORE_GAP=+(process.env.BINANCE_ROTATION_SCORE_GAP||20);
const ROTATION_MAX_PER_CYCLE=Math.max(0,+(process.env.BINANCE_ROTATION_MAX_PER_CYCLE||1));

// Durable DEMO state (use Render Persistent Disk mounted at /var/data)
const STATE_FILE=process.env.BINANCE_STATE_FILE||'/var/data/binance-paper-state.json';

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
  liveActionLog.unshift(action);
  liveActionLog=liveActionLog.slice(0,200);
  saveLiveActionLog();
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

async function getLiveAccountSnapshot(){
  const [acct,prices] = await Promise.all([
    signedBinanceGet('/api/v3/account',{omitZeroBalances:'true'}),
    j('/api/v3/ticker/price')
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
      return {...x,qty,usdtPrice,valueUsdt};
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
  if(MANUAL_SYMBOLS.length)return MANUAL_SYMBOLS.slice(0,UNIVERSE_SIZE);

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
    .filter(x=>tradable.has(x.symbol)&&isEligibleSymbol(x)&&Number.isFinite(+x.quoteVolume))
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
  SYMBOLS=[...new Set([...symbols,...Object.keys(paper.positions)])];
  agents=Object.fromEntries(
    SYMBOLS.map(symbol=>[
      symbol,
      agents[symbol]||{
        symbol,
        position:paper.positions[symbol]?'LONG':'CASH',
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
  try{marketSocket?.close()}catch{}
  if(!SYMBOLS.length)return;

  const names=SYMBOLS.map(s=>`${s.toLowerCase()}@trade`).join('/');
  marketSocket=new WebSocket(`wss://stream.binance.com:9443/stream?streams=${names}`);

  marketSocket.on('open',()=>SYMBOLS.forEach(s=>streams[s].status='connected'));
  marketSocket.on('message',raw=>{
    try{
      const msg=JSON.parse(raw),m=msg.data||msg,s=String(m.s||'');
      if(streams[s]){
        streams[s].lastPrice=+m.p;
        streams[s].lastEventAt=new Date(m.E).toISOString();
        streams[s].status='connected';
      }
    }catch{}
  });
  marketSocket.on('close',()=>{
    SYMBOLS.forEach(s=>streams[s].status='disconnected');
    setTimeout(startMarketStream,5000).unref?.();
  });
  marketSocket.on('error',()=>{});
}

async function candles(s){
  const r=await j(`/api/v3/klines?symbol=${s}&interval=1d&limit=${Math.max(250,MAP+30)}`);
  const now=Date.now();
  return r
    .filter(x=>+x[6]<now)
    .map(x=>({closeTime:+x[6],close:+x[4]}));
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
      entryReason:meta.reason||'BUY'
    };
    paper.cashIls-=a;
    paper.lastAction={type:'BUY',symbol:s,price,at,...meta};
    pushDemoAction({
      type:meta.reason==='ROTATION_IN'?'ROTATE_IN':'BUY',
      symbol:s,
      price,
      amountIls:a,
      qty:a/price,
      reason:meta.reason||'BUY',
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
function scoreStrategy(st){
  if(!st||!st.buyConfirmed||st.direction!=='UP'||!st.aboveMA)return 0;

  const wave=Math.max(0,+st.currentWave||0);
  const prevDown=Math.max(0.25,+st.previousDownWave||0.25);
  const price=+st.price||0;
  const ma=+st.ma||0;

  const waveScore=Math.min(wave,12)/12*40;

  const dominance=wave/prevDown;
  const dominanceScore=Math.max(0,Math.min(1,(dominance-1)/2))*30;

  const maDistancePct=ma>0?Math.max(0,(price/ma-1)*100):0;
  const maScore=Math.min(maDistancePct,30)/30*20;

  const confirmationBonus=10;

  const overextensionPenalty=
    wave>20
      ? Math.min(25,(wave-20)*1.25)
      : 0;

  return Math.max(
    0,
    Math.round((waveScore+dominanceScore+maScore+confirmationBonus-overextensionPenalty)*10)/10
  );
}

async function evaluateSymbol(s){
  try{
    const c=await candles(s);
    const st=evaluateWaveStrategy(c,{minWave:MIN,maPeriod:MAP});
    const pos=paper.positions[s]?'LONG':'CASH';
    const rawDecision=decidePosition(st,pos);
    const score=scoreStrategy(st);

    return {
      ok:true,
      symbol:s,
      candles:c,
      strategy:st,
      position:pos,
      rawDecision,
      score,
      at:new Date(c.at(-1).closeTime).toISOString()
    };
  }catch(e){
    return {ok:false,symbol:s,error:e.message};
  }
}

function setAgentFromEval(ev,decision='HOLD',execution='IDLE',strategy=null){
  if(!ev.ok){
    agents[ev.symbol]={
      ...(agents[ev.symbol]||{symbol:ev.symbol,position:'CASH',decision:'HOLD'}),
      lastError:ev.error,
      execution:'ERROR'
    };
    return;
  }

  agents[ev.symbol]={
    ...agents[ev.symbol],
    symbol:ev.symbol,
    position:paper.positions[ev.symbol]?'LONG':'CASH',
    decision,
    strategy:ev.strategy,
    score:ev.score,
    rotation:strategy,
    lastDecisionAt:new Date().toISOString(),
    lastError:null,
    execution
  };
}

function weakestHeldEvaluation(evals){
  const held=evals
    .filter(x=>x.ok&&paper.positions[x.symbol])
    .map(x=>({
      ...x,
      // A held position that no longer has a current BUY setup is intentionally weak.
      comparableScore:x.strategy?.buyConfirmed?x.score:0
    }))
    .sort((a,b)=>a.comparableScore-b.comparableScore);

  return held[0]||null;
}

async function evalAll(){
  // Phase 1: evaluate ALL symbols first.
  const evals=[];
  for(const s of SYMBOLS){
    evals.push(await evaluateSymbol(s));
  }

  // Default UI state.
  for(const ev of evals){
    if(!ev.ok){
      setAgentFromEval(ev);
      continue;
    }

    const isHeld=!!paper.positions[ev.symbol];

    if(isHeld){
      setAgentFromEval(ev,'HOLD','IDLE');
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
          {reason:'STRATEGY_SELL',score:ev.score}
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
        !paper.positions[ev.symbol] &&
        ev.rawDecision==='BUY'
      )
      .sort((a,b)=>b.score-a.score);

    while(Object.keys(paper.positions).length<MAX && candidates.length){
      const ev=candidates.shift();
      const bought=apply(
        ev.symbol,
        'BUY',
        ev.strategy.price,
        ev.at,
        {reason:'BEST_AVAILABLE_BUY',score:ev.score}
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
      agents[ev.symbol].decision='HOLD';
      agents[ev.symbol].execution='IDLE';
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
}

async function refreshUniverse(){
  try{
    universeStatus='REFRESHING';
    universeError=null;

    const selected=await selectUniverse();

    if(selected.length){
      initUniverse(selected);
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

setInterval(evalAll,300000).unref();
setInterval(refreshUniverse,21600000).unref();

const send=(res,o,c=200)=>{
  res.writeHead(c,{
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Cache-Control':'no-store'
  });
  res.end(JSON.stringify(o));
};

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host}`);

  if(req.method==='OPTIONS')return send(res,{},204);

  const sf={
    '/binance-agent.html':['binance-agent.html','text/html'],
    '/binance-agent.js':['binance-agent.js','text/javascript'],
    '/binance-agent.css':['binance-agent.css','text/css']
  };

  if(req.method==='GET'&&sf[u.pathname]){
    const [f,t]=sf[u.pathname];
    res.writeHead(200,{'Content-Type':t,'Cache-Control':'no-store'});
    return res.end(fs.readFileSync(path.join(D,f)));
  }

  if(u.pathname==='/api/binance-mode'&&req.method==='GET'){
    return send(res,{
      mode,
      liveTradingEnabled:LIVE,
      autoExecution:false,
      keysConfigured:KEYS_CONFIGURED,
      liveReadOnly:KEYS_CONFIGURED&&!LIVE
    });
  }

  if(u.pathname==='/api/binance-mode'&&req.method==='POST'){
    let b='';
    req.on('data',x=>b+=x);
    req.on('end',()=>{
      try{
        const m=JSON.parse(b).mode;
        if(m==='live'&&!KEYS_CONFIGURED)throw Error('Binance API keys are not configured');
        mode=m;
        send(res,{ok:true,mode});
      }catch(e){
        send(res,{ok:false,error:e.message},400);
      }
    });
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
      demo:(paper.actionLog||[]).slice(0,100),
      live:(liveActionLog||[]).slice(0,100)
    });
  }

  if(u.pathname==='/api/binance-paper/reset'&&req.method==='POST'){
    reset();
    return send(res,{ok:true,paper:snap()});
  }

  if(u.pathname==='/api/binance-agent'&&req.method==='GET'){
    return send(res,{
      mode,
      symbols:SYMBOLS,
      streams,
      agents:Object.values(agents),
      paper:snap(),
      universeStatus,
      universeError,
      config:{
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
        stateFile:STATE_FILE,
        persistentState:true,
        keysConfigured:KEYS_CONFIGURED,
        liveTradingEnabled:LIVE
      }
    });
  }

  if(u.pathname==='/api/binance-agent/evaluate'&&req.method==='POST'){
    evalAll().then(()=>send(res,{
      ok:true,
      agents:Object.values(agents),
      paper:snap()
    }));
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
      paper:snap(),
      universeStatus,
      universeError
    });
  }

  send(res,{error:'Not found'},404);
});

server.listen(PORT,'0.0.0.0',async()=>{
  console.log('Server',PORT);
  loadPaperState();
  loadLiveActionLog();
  await refreshUniverse();
});
