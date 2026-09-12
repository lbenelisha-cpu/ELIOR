const $=x=>document.getElementById(x),money=x=>new Intl.NumberFormat("he-IL",{style:"currency",currency:"ILS",maximumFractionDigits:0}).format(x),mean=a=>a.reduce((s,x)=>s+x,0)/a.length,clamp=x=>Math.max(0,Math.min(100,Math.round(x)));
let market=null,fx=null,a=null,cloudPortfolios=[],cloudSnapshots=[],plan="balanced",liveMarket=null,liveTimer=null;
const exp={conservative:.25,balanced:.5,growth:.8,ai_dynamic:.5},names={conservative:"שמרני",balanced:"מאוזן",growth:"צמיחה",ai_dynamic:"AI דינמי"};
function aiTargetExposure(score){score=Number(score);return score>=70?.80:score>=55?.65:score>=45?.50:score>=30?.35:.25}
function planExposure(p){return p==="ai_dynamic"?aiTargetExposure(a?.master??50):(exp[p]||.5)}
function selectedPortfolio(){return portfolios().find(p=>p.symbol===$("symbol").value)||null}
function setPlanUI(){
  const p=selectedPortfolio(),chosen=p?.plan||$("programPlan")?.value||plan||"balanced";plan=chosen;
  if($("programPlan"))$("programPlan").value=chosen;
  $("plan").textContent=names[chosen]||chosen;
  const e=planExposure(chosen);$("expo").textContent=chosen==="ai_dynamic"?`${Math.round(e*100)}% יעד חשיפה לפי AI`:`${Math.round(e*100)}% חשיפה`;
}
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

function nyParts(){
  try{
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
    const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return{weekday:o.weekday||"",hour:Number(o.hour||0),minute:Number(o.minute||0)};
  }catch{return{weekday:"",hour:0,minute:0}}
}
function marketSession(){
  const n=nyParts(),weekend=n.weekday==="Sat"||n.weekday==="Sun",mins=n.hour*60+n.minute;
  if(weekend)return{open:false,label:"שוק סגור",detail:"סוף שבוע בארה״ב"};
  if(mins>=570&&mins<960)return{open:true,label:"שעות מסחר",detail:"NYSE/Nasdaq · 09:30–16:00 ניו יורק"};
  return{open:false,label:"שוק סגור",detail:"מחוץ לשעות המסחר הרגילות"};
}
function renderMarketState(marketFromCache=false){
  const badge=$("marketState"),source=$("marketSource");if(!badge||!source||!market)return;
  const s=marketSession();
  badge.textContent=(s.open?"🟢 ":"🔴 ")+s.label;
  badge.className="market-badge "+(s.open?"open":"closed");
  const type=market.dataType==="daily_close"?"מחיר סגירה יומי אחרון":"נתון שוק";
  source.textContent=`${type} · ${market.lastRefreshed||"—"}${marketFromCache?" · שמור":""} · ${s.detail}`;
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
    cloudPortfolios=c.portfolios||(c.portfolio?[c.portfolio]:[]);
    cloudSnapshots=c.snapshots||[];
    setPlanUI();
    $("status").textContent="מסונכרן לענן";
    renderPaper();renderHistory();
  }catch(e){
    $("status").textContent="עובד מקומית · הענן לא זמין";
    throw e;
  }
}
async function savePortfolioCloud(p){
  const r=await cloud("save_portfolio",p);
  if(r.portfolio)cloudPortfolios.push(r.portfolio);
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
    $("price").innerHTML=`<span class=ltr>$${a.last.toFixed(2)}</span>`;$("marketDate").textContent=market.lastRefreshed+(marketFromCache?" · שמור":"");renderMarketState(marketFromCache);
    $("fx").textContent=Number(fx.rate).toFixed(4);$("fxDate").textContent=(fx.lastRefreshed||"")+(fxFromCache?" · שמור":"");
    $("master").textContent=a.master+"/100";$("signal").textContent=a.signal;renderAgents();renderPaper();setPlanUI();
    await autoSnapshot();
    $("status").textContent="נתונים נטענו · הענן מעודכן";
  }catch(e){$("error").textContent=shortError(e.message);$("error").style.display="block";$("status").textContent="שגיאת טעינה"}
}

function portfolios(){return cloudPortfolios||[]}
function paper(){return portfolios().find(p=>p.symbol===$("symbol").value)||portfolios()[0]||null}
function latestSnap(p){return [...snapshots()].reverse().find(x=>String(x.position_id||"")===String(p.id)||(!x.position_id&&x.symbol===p.symbol))||null}
function positionValue(p){const selected=market&&market.symbol===p.symbol&&a;const last=latestSnap(p);const px=selected?a.last:(Number(last?.market_price)||Number(p.entryPrice));const rate=fx?Number(fx.rate):(Number(last?.fx)||Number(p.entryFX));const marketILS=Number(p.units)*px*rate;return{px,rate,marketILS,pnl:marketILS-Number(p.allocatedILS)}}
function portfolioTotals(){const cap=Math.max(1000,+$("capital").value||100000),ps=portfolios(),used=ps.reduce((n,p)=>n+Number(p.allocatedILS||0),0),marketValue=ps.reduce((n,p)=>n+positionValue(p).marketILS,0),cash=Math.max(0,cap-used),total=cash+marketValue;return{cap,used,cash,total,pnl:total-cap}}
async function openPaper(){
  if(!market||!fx)return alert("טען שוק ומט״ח תחילה");
  const cap=Math.max(1000,+$("capital").value||100000),chosen=$("programPlan")?.value||plan,allocation=cap*planExposure(chosen),t=portfolioTotals();
  if(portfolios().some(p=>p.symbol===market.symbol))return alert("כבר קיימת תוכנית נייר פתוחה עבור "+market.symbol);
  if(t.cash+0.01<allocation)return alert("אין מספיק מזומן מדומה פנוי לתוכנית נוספת");
  const usd=allocation/fx.rate,units=usd/a.last;
  const p={symbol:market.symbol,start:cap,allocatedILS:allocation,allocatedUSD:usd,entryFX:fx.rate,entryPrice:a.last,units,cashILS:0,date:market.lastRefreshed,plan:chosen,status:"open"};
  await savePortfolioCloud(p);await autoSnapshot();
}
function currentValue(p){const v=positionValue(p),t=portfolioTotals();return{...v,total:t.total,pnl:t.pnl}}
function renderPaper(){
  const ps=portfolios(),t=portfolioTotals();
  $("start").textContent=money(t.cap);$("value").textContent=money(t.total);$("pnl").textContent=`${t.pnl>=0?"+":""}${money(t.pnl)} (${(t.pnl/t.cap*100).toFixed(2)}%)`;$("pnl").className=t.pnl>=0?"green":"red";
  if(!ps.length){$("position").innerHTML='<tr><td colspan="9" class="muted">אין תוכניות פתוחות בענן.</td></tr>';return}
  $("position").innerHTML=ps.map(p=>{const v=positionValue(p),pe=p.plan==="ai_dynamic"?aiTargetExposure((latestSnap(p)?.score)??(market?.symbol===p.symbol?a?.master:50)):(exp[p.plan]||.5);return `<tr><td>${p.symbol}</td><td>${names[p.plan]||p.plan||"—"}</td><td>${Math.round(pe*100)}%</td><td>${money(p.allocatedILS)}</td><td><span class=ltr>$${Number(p.allocatedUSD).toFixed(2)}</span></td><td>${Number(p.entryFX).toFixed(4)}</td><td><span class=ltr>$${Number(p.entryPrice).toFixed(2)}</span></td><td><span class="ltr ${v.px>=Number(p.entryPrice)?"green":"red"}">$${Number(v.px).toFixed(2)}</span></td><td><span class=ltr>${Number(p.units).toFixed(4)}</span></td><td>${money(v.marketILS)}</td><td class="${v.pnl>=0?"green":"red"}">${v.pnl>=0?"+":""}${money(v.pnl)}</td></tr>`}).join("");
}
function snapshots(){return cloudSnapshots||[]}
function aiSnapshotFields(p){
  if(!a)return{};
  return{
    market_score:a.marketS,trend_score:a.trend,risk_score:a.risk,momentum_score:a.mom,
    recommendation:a.signal,plan:p?.plan||plan
  };
}
async function autoSnapshot(){
  const p=portfolios().find(x=>x.symbol===market?.symbol);if(!p||p.status==="closed"||!market||!fx||!a)return;
  const v=currentValue(p),pv=positionValue(p),stamp=market.lastRefreshed,key=`${p.id||p.symbol}-${p.symbol}-${stamp}`;
  if(snapshots().some(x=>x.snapshot_key===key||x.key===key)){renderHistory();return}
  await saveSnapshotCloud({snapshot_key:key,date:stamp,symbol:p.symbol,position_id:String(p.id||""),position_value:pv.marketILS,position_pnl:pv.pnl,value:v.total,pnl:v.pnl,fx:fx.rate,score:a.master,market_price:a.last,auto:true,...aiSnapshotFields(p)});
}
async function snapshot(){
  let p=portfolios().find(x=>x.symbol===market?.symbol);if(!p||!market||!fx||!a)return alert("יש לבחור תוכנית פתוחה ולטעון נתונים");
  let v=currentValue(p),pv=positionValue(p),stamp=market.lastRefreshed,key=`${p.id||p.symbol}-${p.symbol}-${stamp}`;
  if(snapshots().some(x=>x.snapshot_key===key||x.key===key)){$("status").textContent="Snapshot להיום כבר קיים";return}
  await saveSnapshotCloud({snapshot_key:key,date:stamp,symbol:p.symbol,position_id:String(p.id||""),position_value:pv.marketILS,position_pnl:pv.pnl,value:v.total,pnl:v.pnl,fx:fx.rate,score:a.master,market_price:a.last,auto:false,...aiSnapshotFields(p)});
  $("status").textContent="Snapshot נשמר בענן";
}
function renderHistory(){
  let s=snapshots();$("snapCount").textContent=s.length+" Snapshots";
  $("journal").innerHTML=s.length?[...s].reverse().map(x=>`<tr><td>${x.date}</td><td>${x.symbol}</td><td>${money(Number(x.value))}</td><td class="${Number(x.pnl)>=0?"green":"red"}">${Number(x.pnl)>=0?"+":""}${money(Number(x.pnl))}</td><td>${Number(x.fx).toFixed(4)}</td><td>${x.score}/100</td></tr>`).join(""):'<tr><td colspan="6" class="muted">אין Snapshots בענן.</td></tr>';
  const decision=$("decisionJournal");
  if(decision)decision.innerHTML=s.length?[...s].reverse().map(x=>{
    const rec=x.recommendation||"—",cls=/חיובי/.test(rec)?"green":/שלילי|זהירות/.test(rec)?"red":"yellow";
    const score=v=>v==null?"—":`${v}/100`;
    return `<tr><td>${x.date}</td><td>${x.symbol}</td><td class="${cls}">${rec}</td><td>${x.score??"—"}/100</td><td>${score(x.market_score)}</td><td>${score(x.trend_score)}</td><td>${score(x.risk_score)}</td><td>${score(x.momentum_score)}</td><td>${names[x.plan]||x.plan||"—"}</td><td>${x.auto?"אוטומטי":"ידני"}</td></tr>`;
  }).join(""):'<tr><td colspan="10" class="muted">היסטוריית החלטות AI תתחיל מה-Snapshot הבא.</td></tr>';
  if(s.length>1){let r=(Number(s.at(-1).value)/Number(s[0].value)-1)*100;$("performanceText").textContent=`שינוי בין Snapshot ראשון לאחרון: ${r>=0?"+":""}${r.toFixed(2)}%`}else{$("performanceText").textContent="ה-Snapshots נשמרים בענן ומופיעים בכל מכשיר."}
  draw(s);
}
function draw(s){let c=$("chart"),r=c.getBoundingClientRect(),d=devicePixelRatio||1;c.width=r.width*d;c.height=r.height*d;let x=c.getContext("2d");x.scale(d,d);x.clearRect(0,0,r.width,r.height);if(s.length<2){x.fillStyle="#9eb5ca";x.font="14px Arial";x.fillText("נדרשים לפחות שני Snapshots להצגת גרף",20,40);return}let vals=s.map(q=>Number(q.value)),mn=Math.min(...vals),mx=Math.max(...vals),sp=Math.max(1,mx-mn);x.strokeStyle="#39b4ff";x.lineWidth=2.5;x.beginPath();vals.forEach((v,i)=>{let px=15+(r.width-30)*i/(vals.length-1),py=15+(r.height-30)*(1-(v-mn)/sp);i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke()}
async function saveSelectedPlan(){
  const p=selectedPortfolio();if(!p)return alert("בחר נכס שיש לו תוכנית פתוחה");
  const newPlan=$("programPlan").value;
  await cloud("update_plan",{id:p.id,plan:newPlan});p.plan=newPlan;plan=newPlan;renderPaper();setPlanUI();
  $("status").textContent=`המסלול של ${p.symbol} עודכן ל-${names[newPlan]||newPlan}`;
}
async function closeP(){const p=portfolios().find(x=>x.symbol===$("symbol").value);if(!p)return alert("בחר נכס שיש לו תוכנית פתוחה");if(!confirm(`לסגור את תוכנית הנייר ${p.symbol}?`))return;await cloud("close_portfolio",{id:p.id,closed_at:new Date().toISOString()});cloudPortfolios=portfolios().filter(x=>x.id!==p.id);renderPaper()}
async function resetAll(){if(!confirm("לאפס את התיק הווירטואלי ואת כל ה-Snapshots בענן?"))return;await cloud("reset",{});cloudPortfolios=[];cloudSnapshots=[];renderPaper();renderHistory();$("status").textContent="הסימולציה אופסה בענן"}

$("symbol").onchange=async()=>{
  renderPaper();setPlanUI();
  // Keep the top market cards and agent scores synchronized with the selected asset.
  await load();
};
$("programPlan").onchange=()=>{
  const chosen=$("programPlan").value;
  plan=chosen;
  $("plan").textContent=names[chosen]||chosen;
  const e=planExposure(chosen);
  $("expo").textContent=chosen==="ai_dynamic"?`${Math.round(e*100)}% יעד חשיפה לפי AI`:`${Math.round(e*100)}% חשיפה`;
};
$("savePlan").onclick=()=>saveSelectedPlan().catch(e=>alert(shortError(e.message)));
$("load").onclick=load;$("open").onclick=()=>openPaper().catch(e=>alert(shortError(e.message)));$("snapshot").onclick=()=>snapshot().catch(e=>alert(shortError(e.message)));$("close").onclick=()=>closeP().catch(e=>alert(shortError(e.message)));$("reset").onclick=()=>resetAll().catch(e=>alert(shortError(e.message)));
window.addEventListener("resize",()=>draw(snapshots()));
syncCloud().catch(()=>{});startLive();