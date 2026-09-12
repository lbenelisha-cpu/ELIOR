const $=x=>document.getElementById(x),money=x=>new Intl.NumberFormat("he-IL",{style:"currency",currency:"ILS",maximumFractionDigits:0}).format(x),mean=a=>a.reduce((s,x)=>s+x,0)/a.length,clamp=x=>Math.max(0,Math.min(100,Math.round(x)));
let market=null,fx=null,a=null,cloudPortfolio=null,cloudSnapshots=[],plan="balanced",liveMarket=null,liveTimer=null;
const exp={conservative:.25,balanced:.5,growth:.8},names={conservative:"שמרני",balanced:"מאוזן",growth:"צמיחה"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),CACHE_MARKET_MS=30*60*1000,CACHE_FX_MS=12*60*60*1000,STALE_FX_MS=7*24*60*60*1000;

function cacheGet(key,maxAge){try{const x=JSON.parse(localStorage.getItem(key)||"null");if(!x||!x.savedAt)return null;if(Date.now()-x.savedAt>maxAge)return null;return x.data}catch{return null}}
function cacheSet(key,data){try{localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),data}))}catch{}}
function shortError(msg=""){msg=String(msg);if(/rate limit|25 requests per day|free API requests|premium plans|1 request per second/i.test(msg))return "מגבלת Alpha Vantage החינמית הופעלה. המערכת תשתמש בנתונים שמורים כשאפשר.";if(/supabase|cloud|database|fetch failed/i.test(msg))return "לא ניתן כרגע לסנכרן מול הענן.";if(/API key/i.test(msg))return "מפתח API חסר ב-Netlify.";return "לא ניתן להשלים את הפעולה כרגע."}
async function fetchJson(url,opts){const r=await fetch(url,{cache:"no-store",...(opts||{})}),j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Request failed");return j}


function fmtLiveTime(iso){try{return new Date(iso).toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}catch{return "—"}}
function renderLive(){
  const st=$("liveStatus"),price=$("livePrice"),events=$("liveEvents"),time=$("liveTime"),err=$("liveError");
  if(!st)return;
  if(!liveMarket){st.textContent="מתחבר...";st.className="big yellow";price.textContent="—";events.textContent="—";time.textContent="—";err.textContent="";return}
  const connected=liveMarket.status==="connected"&&liveMarket.ok;
  st.textContent=connected?"LIVE מחובר":"מנותק";st.className="big "+(connected?"green":"red");
  price.innerHTML=Number.isFinite(Number(liveMarket.lastPrice))?`<span class=ltr>$${Number(liveMarket.lastPrice).toLocaleString("en-US",{maximumFractionDigits:2})}</span>`:"—";
  events.textContent=Number(liveMarket.eventCount||0).toLocaleString("he-IL");
  time.textContent=liveMarket.lastEventAt?fmtLiveTime(liveMarket.lastEventAt):"—";
  err.textContent=liveMarket.lastError?`שגיאה אחרונה: ${liveMarket.lastError}`:`${liveMarket.symbol||"BTCUSDT"} · Binance WebSocket`;
}
async function loadLive(){
  try{liveMarket=await fetchJson(APP_CONFIG.liveEndpoint);renderLive()}
  catch(e){liveMarket={ok:false,status:"disconnected",lastError:e.message};renderLive()}
}
function startLive(){
  clearInterval(liveTimer);loadLive();liveTimer=setInterval(loadLive,2000);
}

function analyze(p){let c=p.map(x=>x.close),last=c[0],r5=(last/c[Math.min(5,c.length-1)]-1)*100,r20=(last/c[Math.min(20,c.length-1)]-1)*100,r60=(last/c[Math.min(60,c.length-1)]-1)*100,s20=mean(c.slice(0,20)),s60=mean(c.slice(0,60)),rs=[];for(let i=0;i<c.length-1;i++)rs.push(c[i]/c[i+1]-1);let m=mean(rs),vol=Math.sqrt(mean(rs.map(x=>(x-m)**2)))*Math.sqrt(252)*100,marketS=clamp(50+r60*2),trend=clamp(50+(last/s20-1)*500+(s20/s60-1)*400),risk=clamp(90-vol*2.2),mom=clamp(50+r5*3+r20*1.5),master=clamp((marketS+trend+risk+mom)/4);return{last,r5,r20,r60,vol,marketS,trend,risk,mom,master,signal:master>=70?"חיובי":master>=55?"חיובי מתון":master>=45?"ניטרלי":master>=30?"זהירות":"שלילי"}}
function renderAgents(){if(!a)return;let x=[["Market",a.marketS,`60 ימים ${a.r60.toFixed(1)}%`],["Trend",a.trend,`20 ימים ${a.r20.toFixed(1)}%`],["Risk",a.risk,`תנודתיות ${a.vol.toFixed(1)}%`],["Momentum",a.mom,`5 ימים ${a.r5.toFixed(1)}%`],["Portfolio",a.master,a.signal]];$("agents").innerHTML=x.map(([n,s,t])=>`<div class="card"><b>${n} Agent</b><div class="score">${s}/100</div><div class="bar"><i style="width:${s}%"></i></div><div class="muted">${t}</div></div>`).join("")}

async function cloud(action,body){
  return fetchJson(`${APP_CONFIG.cloudEndpoint}?action=${encodeURIComponent(action)}`,{
    method: body ? "POST":"GET",
    headers: body?{"Content-Type":"application/json"}:undefined,
    body: body?JSON.stringify(body):undefined
  });
}
async function syncCloud(){
  try{
    const c=await cloud("get");
    cloudPortfolio=c.portfolio||null;
    cloudSnapshots=c.snapshots||[];
    if(cloudPortfolio?.plan) plan=cloudPortfolio.plan;
    $("plan").textContent=names[plan]||plan;
    $("expo").textContent=(exp[plan]||.5)*100+"% חשיפה";
    $("status").textContent="מסונכרן לענן";
    renderPaper();renderHistory();
  }catch(e){
    $("status").textContent="עובד מקומית · הענן לא זמין";
    throw e;
  }
}
async function savePortfolioCloud(p){
  const r=await cloud("save_portfolio",p);
  cloudPortfolio=r.portfolio;
  renderPaper();
}
async function saveSnapshotCloud(s){
  const r=await cloud("save_snapshot",s);
  cloudSnapshots=r.snapshots||cloudSnapshots;
  renderHistory();
}

async function load(){
  try{
    $("status").textContent="טוען נתונים...";
    $("error").style.display="none";
    const symbol=$("symbol").value,marketKey="v5_market_"+symbol,fxKey="v5_fx_usdils";
    market=cacheGet(marketKey,CACHE_MARKET_MS);let marketFromCache=!!market;
    if(!market){market=await fetchJson(`${APP_CONFIG.marketEndpoint}?symbol=${symbol}`);cacheSet(marketKey,market)}
    fx=cacheGet(fxKey,CACHE_FX_MS);let fxFromCache=!!fx;
    if(!fx){if(!marketFromCache)await sleep(1300);try{fx=await fetchJson(APP_CONFIG.fxEndpoint);cacheSet(fxKey,fx)}catch(err){const stale=cacheGet(fxKey,STALE_FX_MS);if(stale)fx=stale;else throw err}}
    a=analyze(market.prices);
    $("price").innerHTML=`<span class=ltr>$${a.last.toFixed(2)}</span>`;$("marketDate").textContent=market.lastRefreshed+(marketFromCache?" · שמור":"");
    $("fx").textContent=Number(fx.rate).toFixed(4);$("fxDate").textContent=(fx.lastRefreshed||"")+(fxFromCache?" · שמור":"");
    $("master").textContent=a.master+"/100";$("signal").textContent=a.signal;renderAgents();renderPaper();
    await autoSnapshot();
    $("status").textContent="נתונים נטענו · הענן מעודכן";
  }catch(e){$("error").textContent=shortError(e.message);$("error").style.display="block";$("status").textContent="שגיאת טעינה"}
}

function paper(){return cloudPortfolio}
async function openPaper(){
  if(!market||!fx)return alert("טען שוק ומט״ח תחילה");
  let cap=Math.max(1000,+$("capital").value||100000),ils=cap*exp[plan],usd=ils/fx.rate,units=usd/a.last;
  const p={symbol:market.symbol,start:cap,allocatedILS:ils,allocatedUSD:usd,entryFX:fx.rate,entryPrice:a.last,units,cashILS:cap-ils,date:market.lastRefreshed,plan,status:"open"};
  await savePortfolioCloud(p);await autoSnapshot();
}
function currentValue(p){let px=(market&&market.symbol===p.symbol&&a)?a.last:p.entryPrice,rate=fx?fx.rate:p.entryFX,marketILS=p.units*px*rate,total=p.cashILS+marketILS;return{px,rate,marketILS,total,pnl:total-p.start}}
function renderPaper(){
  let p=paper(),cap=Math.max(1000,+$("capital").value||100000);
  $("start").textContent=money(p?p.start:cap);
  if(!p||p.status==="closed"){$("value").textContent=money(cap);$("pnl").textContent="—";$("position").innerHTML='<tr><td colspan="8" class="muted">אין פוזיציה פתוחה בענן.</td></tr>';return}
  let v=currentValue(p),pc=v.pnl/p.start*100;$("value").textContent=money(v.total);$("pnl").textContent=`${v.pnl>=0?"+":""}${money(v.pnl)} (${pc.toFixed(2)}%)`;$("pnl").className=v.pnl>=0?"green":"red";
  $("position").innerHTML=`<tr><td>${p.symbol}</td><td>${money(p.allocatedILS)}</td><td><span class=ltr>$${Number(p.allocatedUSD).toFixed(2)}</span></td><td>${Number(p.entryFX).toFixed(4)}</td><td><span class=ltr>$${Number(p.entryPrice).toFixed(2)}</span></td><td><span class=ltr>${Number(p.units).toFixed(4)}</span></td><td>${money(v.marketILS)}</td><td class="${v.pnl>=0?"green":"red"}">${v.pnl>=0?"+":""}${money(v.pnl)}</td></tr>`
}
function snapshots(){return cloudSnapshots||[]}
async function autoSnapshot(){
  const p=paper();if(!p||p.status==="closed"||!market||!fx||!a||p.symbol!==market.symbol)return;
  const v=currentValue(p),stamp=market.lastRefreshed,key=p.symbol+"-"+stamp;
  if(snapshots().some(x=>x.snapshot_key===key||x.key===key)){renderHistory();return}
  await saveSnapshotCloud({snapshot_key:key,date:stamp,symbol:p.symbol,value:v.total,pnl:v.pnl,fx:fx.rate,score:a.master,market_price:a.last,auto:true});
}
async function snapshot(){
  let p=paper();if(!p||!market||!fx||!a)return alert("יש לפתוח פוזיציה ולטעון נתונים");
  let v=currentValue(p),stamp=market.lastRefreshed,key=p.symbol+"-"+stamp;
  if(snapshots().some(x=>x.snapshot_key===key||x.key===key)){$("status").textContent="Snapshot להיום כבר קיים";return}
  await saveSnapshotCloud({snapshot_key:key,date:stamp,symbol:p.symbol,value:v.total,pnl:v.pnl,fx:fx.rate,score:a.master,market_price:a.last,auto:false});
  $("status").textContent="Snapshot נשמר בענן";
}
function renderHistory(){
  let s=snapshots();$("snapCount").textContent=s.length+" Snapshots";
  $("journal").innerHTML=s.length?[...s].reverse().map(x=>`<tr><td>${x.date}</td><td>${x.symbol}</td><td>${money(Number(x.value))}</td><td class="${Number(x.pnl)>=0?"green":"red"}">${Number(x.pnl)>=0?"+":""}${money(Number(x.pnl))}</td><td>${Number(x.fx).toFixed(4)}</td><td>${x.score}/100</td></tr>`).join(""):'<tr><td colspan="6" class="muted">אין Snapshots בענן.</td></tr>';
  if(s.length>1){let r=(Number(s.at(-1).value)/Number(s[0].value)-1)*100;$("performanceText").textContent=`שינוי בין Snapshot ראשון לאחרון: ${r>=0?"+":""}${r.toFixed(2)}%`}else{$("performanceText").textContent="ה-Snapshots נשמרים בענן ומופיעים בכל מכשיר."}
  draw(s);
}
function draw(s){let c=$("chart"),r=c.getBoundingClientRect(),d=devicePixelRatio||1;c.width=r.width*d;c.height=r.height*d;let x=c.getContext("2d");x.scale(d,d);x.clearRect(0,0,r.width,r.height);if(s.length<2){x.fillStyle="#9eb5ca";x.font="14px Arial";x.fillText("נדרשים לפחות שני Snapshots להצגת גרף",20,40);return}let vals=s.map(q=>Number(q.value)),mn=Math.min(...vals),mx=Math.max(...vals),sp=Math.max(1,mx-mn);x.strokeStyle="#39b4ff";x.lineWidth=2.5;x.beginPath();vals.forEach((v,i)=>{let px=15+(r.width-30)*i/(vals.length-1),py=15+(r.height-30)*(1-(v-mn)/sp);i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke()}
async function closeP(){if(paper()&&!confirm("לסגור את פוזיציית הנייר בענן?"))return;await cloud("close_portfolio",{closed_at:new Date().toISOString()});cloudPortfolio=null;renderPaper()}
async function resetAll(){if(!confirm("לאפס את התיק הווירטואלי ואת כל ה-Snapshots בענן?"))return;await cloud("reset",{});cloudPortfolio=null;cloudSnapshots=[];renderPaper();renderHistory();$("status").textContent="הסימולציה אופסה בענן"}

$("load").onclick=load;$("open").onclick=()=>openPaper().catch(e=>alert(shortError(e.message)));$("snapshot").onclick=()=>snapshot().catch(e=>alert(shortError(e.message)));$("close").onclick=()=>closeP().catch(e=>alert(shortError(e.message)));$("reset").onclick=()=>resetAll().catch(e=>alert(shortError(e.message)));
window.addEventListener("resize",()=>draw(snapshots()));
syncCloud().catch(()=>{});startLive();