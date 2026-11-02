import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function patchTradingPnl(root){
 const edits=new Map();
 const change=(file,before,after)=>{
  const text=edits.get(file)??fs.readFileSync(path.join(root,file),'utf8');
  if(text.includes(after)){edits.set(file,text);return;}
  if(text.split(before).length!==2)throw Error('UNRECOGNIZED_PNL_INTEGRATION:'+file);
  edits.set(file,text.replace(before,after));
 };
 change('server.mjs',"import {FuturesShortAPI} from './lib/futures-short-api.mjs';","import {createTradingPnlReader} from './lib/binance-trading-pnl-reader.mjs';\nimport {FuturesShortAPI} from './lib/futures-short-api.mjs';");
 change('server.mjs','const server=http.createServer((req,res)=>{',`const pnlReadApi=new FuturesShortAPI({key:BINANCE_API_KEY,secret:BINANCE_API_SECRET});
const tradingPnlReader=createTradingPnlReader({get:(route,params)=>pnlReadApi.get(route,params),file:process.env.BINANCE_TRADING_PNL_FILE||LIVE_LOG_FILE+'.trading-pnl'});
const server=http.createServer((req,res)=>{`);
 change('server.mjs',"  if(u.pathname==='/api/binance-trade-history'&&req.method==='GET'){",`  if(u.pathname==='/api/binance-trading-pnl'&&req.method==='GET'){
    try{return send(res,tradingPnlReader.read(liveActionLog,futuresShort.state.closed,{spotHealthy:liveStateHealth.journalReady===true,shortHealthy:!futuresShort.fatal}));}
    catch{return send(res,{ok:false,error:'PNL_REPORT_UNAVAILABLE'},503);}
  }

  if(u.pathname==='/api/binance-trade-history'&&req.method==='GET'){`);
 change('server.mjs',"    '/binance-agent.js':['binance-agent.js','text/javascript'],",`    '/binance-agent.js':['binance-agent.js','text/javascript'],
    '/binance-trading-pnl.js':['binance-trading-pnl.js','text/javascript'],
    '/binance-trading-pnl.css':['binance-trading-pnl.css','text/css'],`);
 change('lib/futures-short-api.mjs',"'/fapi/v1/openOrders','/fapi/v1/openAlgoOrders'","'/fapi/v1/userTrades','/fapi/v1/openOrders','/fapi/v1/openAlgoOrders'");
 for(const file of ['binance-agent.js','netlify/functions/binance-read-proxy.mjs'])change(file,"'/api/binance-action-log','/api/binance-trade-history'","'/api/binance-action-log','/api/binance-trading-pnl','/api/binance-trade-history'");
 change('binance-agent.js',"activeView=['trade','portfolio','scans','journal'].includes(view)?view:'trade';","activeView=['trade','portfolio','scans','journal','pnl'].includes(view)?view:'trade';");
 change('binance-agent.js',"  const grid=$('.trading-grid');","  window.dispatchEvent(new CustomEvent('levi:trading-pnl-view'));\n  const grid=$('.trading-grid');");
 change('binance-agent.html','<button class="nav-pill" data-view="journal">יומן פעולות</button>','<button class="nav-pill" data-view="journal">יומן פעולות</button>\n        <button class="nav-pill" data-view="pnl">רווח והפסד</button>');
 change('binance-agent.html','<section id="binanceHistoryPanel"','<section id="binanceTradingPnl" class="panel app-view pnl-view" hidden aria-label="רווח והפסד LONG ו־SHORT"></section>\n\n    <section id="binanceHistoryPanel"');
 change('binance-agent.html','</head>','<link rel="stylesheet" href="/binance-trading-pnl.css?v=20261102-pnl">\n</head>');
 change('binance-agent.html','</body>','<script type="module" src="/binance-trading-pnl.js?v=20261102-pnl"></script></body>');
 // The main navigation/read allowlist changed; bypass any prior frontend cache.
 const html=edits.get('binance-agent.html');
 if(!html.includes('/binance-agent.js?v=20261102-pnl')){
  if((html.match(/\/binance-agent\.js\?v=[^"']+/g)||[]).length!==1)throw Error('UNRECOGNIZED_PNL_CLIENT_SCRIPT');
  edits.set('binance-agent.html',html.replace(/\/binance-agent\.js\?v=[^"']+/, '/binance-agent.js?v=20261102-pnl'));
 }
 // Validate every context before writing any integration file.
 for(const [file,text] of edits)fs.writeFileSync(path.join(root,file),text);
 return [...edits.keys()];
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))patchTradingPnl(process.argv[2]||process.cwd());
