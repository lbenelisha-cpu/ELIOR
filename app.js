const $=x=>document.getElementById(x),money=x=>new Intl.NumberFormat("he-IL",{style:"currency",currency:"ILS",maximumFractionDigits:0}).format(x),mean=a=>a.reduce((s,x)=>s+x,0)/a.length,clamp=x=>Math.max(0,Math.min(100,Math.round(x)));
let market=null,fx=null,a=null,cloudPortfolios=[],cloudSnapshots=[],cloudMonitor=null,plan="balanced",liveMarket=null,liveTimer=null,scannerData=null,cloudAccount=null,accountHistory=[],closedPositions=[],latestRotation=null,marketRequestId=0,compatibilityMode=false,chartData=[],automationSettingsSupported=false,settingsDirty=false,settingsFormFor=null;
const exp={conservative:.25,balanced:.5,growth:.8,ai_dynamic:.5},names={conservative:"שמרני",balanced:"מאוזן",growth:"צמיחה",ai_dynamic:"AI דינמי"};
function aiTargetExposure(score){score=Number(score);return score>=70?.80:score>=60?.65:score>=50?.50:score>=40?.25:0}
function planExposure(p){return p==="ai_dynamic"?aiTargetExposure(cloudAccount?.marks?.[$("symbol").value]?.master??a?.master??50):(exp[p]||.5)}
function selectedPortfolio(){return portfolios().find(p=>p.symbol===$("symbol").value)||null}
function automationFlags(p){return {rebalance:p?.autoRebalance??(p?.plan==='ai_dynamic'),rotate:p?.autoRotate??(p?.plan==='ai_dynamic')};}
function automationText(p){const x=automationFlags(p);return [x.rebalance?'איזון אוטומטי פעיל':'איזון אוטומטי כבוי',x.rotate?'מעבר בין מניות פעיל':'מעבר בין מניות כבוי'].join(' · ');}
function renderSettingsHint(){
  const chosen=$("programPlan").value,rebalance=$("autoRebalance").checked,rotate=$("autoRotate").checked;
  const target=chosen==='ai_dynamic'?'יעד משתנה לפי ציוני הסוכן':Math.round(exp[chosen]*100)+'% יעד חשיפה';
  $("automationHint").textContent=target+' · '+(rebalance?'הסוכן מאזן בקנייה ומכירה':'אין איזון של ההחזקה')+' · '+(rotate?'מותר מעבר לנכס אחר, כולל מכירה וקנייה':'המניה הקיימת נשמרת')+(settingsDirty?' · השינויים טרם נשמרו':'');
}
function setPlanUI(){
  const p=selectedPortfolio(),formFor=p?String(p.id):'new-'+$("symbol").value;
  if(settingsFormFor!==formFor){settingsDirty=false;settingsFormFor=formFor;}
  if(!settingsDirty){
    $("programPlan").value=p?.plan||plan||'balanced';
    const flags=p?automationFlags(p):{rebalance:true,rotate:true};
    $("autoRebalance").checked=flags.rebalance;$("autoRotate").checked=flags.rotate;
  }
  const chosen=p?.plan||$("programPlan").value;plan=chosen;
  $("plan").textContent=names[chosen]||chosen;
  const e=planExposure(chosen);$("expo").textContent=Math.round(e*100)+'% יעד חשיפה'+(p?' · '+automationText(p):'');
  renderSettingsHint();
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),CACHE_MARKET_MS=60*1000,CACHE_FX_MS=12*60*60*1000,STALE_FX_MS=7*24*60*60*1000;

function cacheGet(key,maxAge){try{const x=JSON.parse(localStorage.getItem(key)||"null");if(!x||!x.savedAt)return null;if(Date.now()-x.savedAt>maxAge)return null;return x.data}catch{return null}}
function cacheSet(key,data){try{localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),data}))}catch{}}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function shortError(msg=""){msg=String(msg);if(/stale quote|synchronized/i.test(msg))return "נתוני השוק אינם עדכניים או אינם מסונכרנים. הפעולה תתאפשר לאחר עדכון נתוני המסחר.";if(/schema cache|paper_get_state|apply_paper_cycle/i.test(msg))return "נדרש להריץ את קובץ ה־SQL של גרסת המעבר ב־Supabase.";if(/rate limit|too many requests|credits|429/i.test(msg))return "מגבלת ספק נתוני השוק הופעלה. המערכת תשתמש בנתונים שמורים כשאפשר.";if(/supabase|cloud|database|fetch failed/i.test(msg))return "לא ניתן כרגע לסנכרן מול הענן.";if(/API.key|API_KEY/i.test(msg))return "מפתח API חסר ב-Netlify.";return "לא ניתן להשלים את הפעולה כרגע."}
async function fetchJson(url,opts){const r=await fetch(url,{cache:"no-store",...(opts||{})}),j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||`HTTP ${r.status} — ${url}`);return j}



function monitorFallback(){
  const rows=(cloudSnapshots||[]).filter(x=>String(x.snapshot_key||"").startsWith("monitor-"));
  if(!rows.length)return null;
  const slots=new Set(rows.map(x=>{
    const k=String(x.snapshot_key||"");
    const m=k.match(/(\d{4}-\d{2}-\d{2}-\d{2}-\d{2})$/);
    return m?m[1]:String(x.created_at||x.date||k);
  }));
  const latest=[...rows].sort((a,b)=>new Date(a.created_at||a.date)-new Date(b.created_at||b.date)).at(-1);
  const age=latest?.created_at?Date.now()-new Date(latest.created_at).getTime():Infinity;
  return{
    status:age<=20*60*1000?"ok":"idle",
    checked_at:latest?.created_at||null,
    checks:slots.size,
    symbols:[...new Set(rows.map(x=>x.symbol).filter(Boolean))],
    note:"Twelve Data · בדיקה אוטומטית כל 30 דקות · נתונים עדכניים בלבד"
  };
}
function renderMonitor(){
  const st=$("monitorStatus"),last=$("monitorLast"),checks=$("monitorChecks"),detail=$("monitorDetail");if(!st)return;
  const m=cloudMonitor||monitorFallback();
  if(!m){st.textContent="ממתין";st.className="big yellow";last.textContent="—";checks.textContent="0";detail.textContent="ממתין לבדיקה האוטומטית הראשונה";return}
  const modern=String(m.note||" ").startsWith("V6.3");
  const ok=modern&&m.status==="ok"&&Date.now()-Date.parse(m.checked_at)<40*60000,err=m.status==="error";st.textContent=ok?"מחזור אחרון הצליח":err?"שגיאה":!modern?"ממתין לסוכן המעודכן":m.status==="waiting"?"ממתין למכסת נתונים":"ממתין";st.className="big "+(ok?"green":err?"red":"yellow");
  last.textContent=m.checked_at?new Date(m.checked_at).toLocaleString("he-IL"):"—";checks.textContent=Number(m.checks||0).toLocaleString("he-IL");
  const syms=Array.isArray(m.symbols)?m.symbols.join(" + "):"";detail.textContent=`${syms||"אין תוכניות פתוחות"} · ${m.note||"Twelve Data · כל 30 דקות · נתונים עדכניים בלבד"}`;
}

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


function scannerEndpoint(){
  return APP_CONFIG.scannerEndpoint||"/.netlify/functions/market-scanner";
}
function scannerSignalClass(score){
  score=Number(score)||0;
  return score>=60?"green":score>=50?"yellow":"red";
}
function renderScanner(){
  const body=$("scannerBody"),stamp=$("scannerUpdated"),best=$("scannerBest");
  if(!body)return;
  const rows=scannerData?.candidates||[];
  if(!rows.length){
    body.innerHTML='<tr><td colspan="9" class="muted">ממתין לסריקת מועמדים.</td></tr>';
    if(best)best.textContent="—";
    if(stamp)stamp.textContent="—";
    return;
  }
  if(best){
    const top=rows[0],lead=scannerData?.leader;
    const verify=lead?` · ${lead.consecutive}/${lead.required} ${lead.verified?"✓ מאומת":"ממתין"}`:"";
    best.innerHTML=`${escapeHTML(top.symbol)} · ${top.master}/100${verify}`;
    best.className="big "+(lead?.verified?"green":scannerSignalClass(top.master));
    const st=$("scannerVerifyStatus");
    if(st){
      st.textContent=[lead?.status||"ממתין לנתונים",...(scannerData?.warnings||[])].join(" · ");
      st.className="muted "+(lead?.verified?"green":"");
    }
  }
  if(stamp){
    const d=scannerData?.generated_at?new Date(scannerData.generated_at):null;
    stamp.textContent=d&&!Number.isNaN(d.getTime())?d.toLocaleString("he-IL"):"—";
  }
  body.innerHTML=rows.map((x,i)=>`<tr>
    <td>${i+1}</td>
    <td><b>${x.symbol}</b><div class="muted">${x.name||""}</div></td>
    <td class="${scannerSignalClass(x.master)}"><b>${x.master}/100</b></td>
    <td>${x.trend}/100</td>
    <td>${x.momentum}/100</td>
    <td>${x.risk}/100</td>
    <td><span class="ltr">$${Number(x.price).toFixed(2)}</span></td>
    <td class="${scannerSignalClass(x.master)}">${escapeHTML(x.signal)}${x.stale?" · נתון ישן":""}</td>
    <td>${x.updated_at||"—"}</td>
  </tr>`).join("");
}
async function loadScanner(force=false){
  const key="v63_scanner_30m";
  if(!force){
    const cached=cacheGet(key,30*60*1000);
    if(cached){scannerData=cached;renderScanner();return}
  }
  const btn=$("scanNow");
  if(btn){btn.disabled=true;btn.textContent="סורק..."}
  try{
    scannerData=await fetchJson(scannerEndpoint());
    cacheSet(key,scannerData);
    renderScanner();
  }catch(e){
    const body=$("scannerBody");
    if(body)body.innerHTML=`<tr><td colspan="9" class="muted">הסריקה לא זמינה כרגע: ${escapeHTML(shortError(e.message))}<br>${escapeHTML(e.message)}</td></tr>`;
  }finally{
    if(btn){btn.disabled=false;btn.textContent="רענן סריקה"}
  }
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
  const type=market.dataType==="daily_close"?"מחיר סגירה יומי אחרון":market.dataType==="realtime_quote"?"מחיר שוק עדכני":"נתון שוק";
  const provider=market.source?` · ${market.source}`:"";
  source.textContent=`${type}${provider} · ${market.lastRefreshed||"—"}${marketFromCache?" · שמור":""} · ${s.detail}`;
}
function analyze(p){let c=p.map(x=>x.close),last=c[0],r5=(last/c[Math.min(5,c.length-1)]-1)*100,r20=(last/c[Math.min(20,c.length-1)]-1)*100,r60=(last/c[Math.min(60,c.length-1)]-1)*100,s20=mean(c.slice(0,20)),s60=mean(c.slice(0,60)),rs=[];for(let i=0;i<c.length-1;i++)rs.push(c[i]/c[i+1]-1);let m=mean(rs),vol=Math.sqrt(mean(rs.map(x=>(x-m)**2)))*Math.sqrt(252)*100,marketS=clamp(50+r60*2),trend=clamp(50+(last/s20-1)*500+(s20/s60-1)*400),risk=clamp(90-vol*2.2),mom=clamp(50+r5*3+r20*1.5),master=clamp((marketS+trend+risk+mom)/4);return{last,r5,r20,r60,vol,marketS,trend,risk,mom,master,signal:master>=70?"חיובי":master>=55?"חיובי מתון":master>=45?"ניטרלי":master>=30?"זהירות":"שלילי"}}
function agentTrend(field,current){
  const sym=$("symbol")?.value;
  const rows=(snapshots()||[]).filter(x=>x.symbol===sym&&String(x.snapshot_key||"").startsWith("monitor-")&&Number.isFinite(Number(x[field])));
  if(!rows.length)return{arrow:"→",delta:0,label:"ממתין להשוואה",cls:"yellow"};
  const prev=Number(rows.at(-1)[field]),delta=Number(current)-prev;
  if(Math.abs(delta)<1)return{arrow:"→",delta,label:"יציב",cls:"yellow"};
  return delta>0?{arrow:"↑",delta,label:"משתפר",cls:"green"}:{arrow:"↓",delta,label:"נחלש",cls:"red"};
}
function renderAgents(){
  const q=cloudAccount?.marks?.[$("symbol").value];
  if(!a&&!q){$("agents").innerHTML="";return;}
  let x=q?[["Market",q.market,q.source==='legacy_snapshot'?"נתון שמור":"30 דקות","market_score"],["Trend",q.trend,q.source==='legacy_snapshot'?"נתון שמור":"30 דקות","trend_score"],["Risk",q.risk,q.source==='legacy_snapshot'?"נתון שמור":"30 דקות","risk_score"],["Momentum",q.momentum,q.source==='legacy_snapshot'?"נתון שמור":"30 דקות","momentum_score"],["Portfolio",q.master,q.signal,"score"]]:[
    ["Market",a.marketS,`60 ימים ${a.r60.toFixed(1)}%`,"market_score"],
    ["Trend",a.trend,`20 ימים ${a.r20.toFixed(1)}%`,"trend_score"],
    ["Risk",a.risk,`תנודתיות ${a.vol.toFixed(1)}%`,"risk_score"],
    ["Momentum",a.mom,`5 ימים ${a.r5.toFixed(1)}%`,"momentum_score"],
    ["Portfolio",a.master,a.signal,"score"]
  ];
  $("agents").innerHTML=x.map(([n,s,t,f])=>{
    const tr=numeric(s)?agentTrend(f,s):{delta:0,arrow:"—",cls:"yellow",label:"אין נתון"},d=Math.round(Math.abs(tr.delta));
    return `<div class="card"><b>${n} Agent</b><div class="score">${numeric(s)?s+"/100":"—"} <span class="${tr.cls}" style="font-size:18px">${tr.arrow}${d?` ${d}`:""}</span></div><div class="bar"><i style="width:${numeric(s)?s:0}%"></i></div><div class="muted">${!numeric(s)?"אין נתון":s>=60?"איתות קנייה":s<40?"איתות מכירה":"המתנה"} · ${t} · <span class="${tr.cls}">${tr.label}</span></div></div>`;
  }).join("");
}

async function cloud(action,body){
  return fetchJson(`${APP_CONFIG.cloudEndpoint}?action=${encodeURIComponent(action)}`,{
    method: body ? "POST":"GET",
    headers: body?{"Content-Type":"application/json"}:undefined,
    body: body?JSON.stringify(body):undefined
  });
}
function numeric(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));}
function legacyAccount(c){
  const ps=c.portfolios||[],history=c.snapshots||[];
  const starts=ps.map(p=>Number(p.start)).filter(n=>Number.isFinite(n)&&n>0);
  const capital=numeric(c.account?.capital)&&Number(c.account.capital)>0?Number(c.account.capital):starts.length?Math.max(...starts):Math.max(1000,+$("capital").value||100000);
  const realized=numeric(c.account?.realized_pnl)?Number(c.account.realized_pnl):(c.closed||[]).reduce((n,p)=>n+(Number(p.realizedPnl)||0),0);
  const marks={};let invested=0,value=0,latest=null,entryOnly=false;
  for(const p of ps){
    const rows=history.filter(x=>x.plan!=='scanner'&&(String(x.position_id||'')===String(p.id)||(!x.position_id&&x.symbol===p.symbol))&&numeric(x.market_price)&&Number(x.market_price)>0&&numeric(x.fx)&&Number(x.fx)>0);
    rows.sort((a,b)=>Date.parse(b.date||b.created_at)-Date.parse(a.date||a.created_at)||Date.parse(b.created_at||b.date)-Date.parse(a.created_at||a.date));
    const last=rows[0],q={price:Number(last?.market_price??p.entryPrice),fx:Number(last?.fx??p.entryFX),updated_at:last?.created_at||last?.date||p.date||null,source:last?'legacy_snapshot':'entry_price',master:last?.score,market:last?.market_score,trend:last?.trend_score,risk:last?.risk_score,momentum:last?.momentum_score,signal:last?.recommendation||''};
    marks[p.symbol]=q;invested+=Number(p.allocatedILS)||0;value+=(Number(p.units)||0)*q.price*q.fx;
    if(!last)entryOnly=true;if(q.updated_at&&(!latest||Date.parse(q.updated_at)>Date.parse(latest)))latest=q.updated_at;
  }
  const cash=capital+realized-invested,total=cash+value;
  return {initialized:ps.length>0||!!c.account?.initialized,capital,cash,value:total,pnl:total-capital,realized_pnl:realized,marks,fx:null,updated_at:latest,valuation_source:entryOnly?'entry_price':'legacy_snapshot',estimated:true};
}
function acceptCloud(c){
  const old=selectedPortfolio(),oldSymbol=$("symbol").value;
  cloudPortfolios=c.portfolios||[];cloudSnapshots=c.snapshots||[];
  compatibilityMode=!c.account;
  automationSettingsSupported=c.apiVersion==='6.2'&&c.capabilities?.automationSettings===true&&cloudPortfolios.every(p=>typeof p.autoRebalance==='boolean'&&typeof p.autoRotate==='boolean');
  cloudAccount=c.account||null;accountHistory=c.accountSnapshots||[];
  if(cloudPortfolios.length&&(!cloudAccount?.initialized||!cloudAccount?.updated_at||!Object.keys(cloudAccount?.marks||{}).length))cloudAccount=legacyAccount(c);
  const notice=$("deploymentNotice");if(notice){notice.textContent=compatibilityMode?'ההחזקות והיומן הישן נטענו. שירות הענן אינו מחזיר את נתוני V6: יש לפרוס גם את Netlify Functions המעודכנות. הסיכום מחושב מנתוני העבר עד להשלמת הפריסה.':'';if(!compatibilityMode&&!automationSettingsSupported)notice.textContent='הנתונים נשמרו. להפעלת האוטומציה בכל המסלולים יש לעדכן גם את ה־SQL וגם את Netlify Functions לגרסה 6.2.';notice.style.display=compatibilityMode||!automationSettingsSupported?'block':'none';}
  for(const id of ['open','savePlan','close','snapshot','reset'])if($(id))$(id).disabled=compatibilityMode;
  for(const id of ["autoRebalance","autoRotate","savePlan","open"])if($(id))$(id).disabled=!automationSettingsSupported;
  closedPositions=c.closed||[];cloudMonitor=c.monitor||null;latestRotation=c.rotation||null;
  for(const p of cloudPortfolios){if(!Array.from($("symbol").options).some(o=>o.value===p.symbol)){const o=document.createElement('option');o.value=p.symbol;o.textContent=p.symbol;$("symbol").appendChild(o);}}
  let active=cloudPortfolios.find(p=>String(p.id)===String(latestRotation?.to_id));
  if(old&&!cloudPortfolios.some(p=>String(p.id)===String(old.id))){
    const records=[...cloudPortfolios,...closedPositions];
    active=cloudPortfolios.find(p=>{let n=p;const seen=new Set();while(n?.predecessorId&&!seen.has(n.predecessorId)){if(String(n.predecessorId)===String(old.id))return true;seen.add(n.predecessorId);n=records.find(x=>String(x.id)===String(n.predecessorId));}return false;})||active||cloudPortfolios[0];
  }else if(cloudPortfolios.some(p=>p.symbol===oldSymbol)){active=null;}
  if(active)$("symbol").value=active.symbol;
  if($("symbol").value!==oldSymbol){marketRequestId++;market=null;a=null;}
  if(cloudAccount?.initialized){$("capital").value=cloudAccount.capital;$("capital").readOnly=true;}else{$("capital").readOnly=false;}
  renderSelectedQuote();renderMonitor();setPlanUI();renderAgents();renderPaper();renderHistory();
}
async function syncCloud(){
  try{acceptCloud(await cloud("get"));$("status").textContent=compatibilityMode?"נתוני עבר נטענו · נדרש עדכון שירות הענן":"מסונכרן לענן";}
  catch(e){$("status").textContent="הענן לא זמין — מוצגים נתונים שמורים";throw e;}
}
async function savePortfolioCloud(p){if(!automationSettingsSupported)throw Error("נדרש עדכון SQL ו־Functions לגרסה 6.2");
  const response=await cloud("save_portfolio",p);settingsDirty=false;acceptCloud(response);}
function renderSelectedQuote(){
  const sym=$("symbol").value,q=cloudAccount?.marks?.[sym];
  if(!q)return;
  $("price").textContent='$'+Number(q.price).toFixed(2);$("marketDate").textContent=q.updated_at||'מחיר כניסה';
  $("master").textContent=numeric(q.master)?q.master+'/100':'—';$("signal").textContent=q.signal||'';
  $("fx").textContent=Number(q.fx??cloudAccount.fx).toFixed(4);$("fxDate").textContent=cloudAccount.updated_at?new Date(cloudAccount.updated_at).toLocaleString('he-IL'):'';
  $("marketSource").textContent=q.source==='legacy_snapshot'?'מחיר שמור מהיומן הקיים':q.source==='entry_price'?'מחיר כניסה — אין מחיר שוק שמור':'נתוני הסוכן · 30 דקות · המחיר ששימש לעדכון התיק';
  const session=marketSession();$("marketState").textContent=session.label;$("marketState").className='market-badge '+(session.open?'open':'closed');
}

async function load(){
  const requestId=++marketRequestId,symbol=$("symbol").value;
  try{
    $("status").textContent="טוען נתונים...";$("error").style.display="none";
    const marketKey="v6_market_"+symbol,fxKey="v6_fx_usdils";
    let loadedMarket=cacheGet(marketKey,CACHE_MARKET_MS),loadedFX=cacheGet(fxKey,CACHE_FX_MS);
    const cachedMarket=!!loadedMarket,cachedFX=!!loadedFX;
    if(!loadedMarket){loadedMarket=await fetchJson(APP_CONFIG.marketEndpoint+'?symbol='+encodeURIComponent(symbol));cacheSet(marketKey,loadedMarket);}
    if(!loadedFX){loadedFX=await fetchJson(APP_CONFIG.fxEndpoint);cacheSet(fxKey,loadedFX);}
    if(requestId!==marketRequestId||symbol!==$("symbol").value)return;
    market=loadedMarket;fx=loadedFX;a=analyze(market.prices);
    $("price").textContent='$'+a.last.toFixed(2);$("marketDate").textContent=market.lastRefreshed+(cachedMarket?' · שמור':'');renderMarketState(cachedMarket);
    $("fx").textContent=Number(fx.rate).toFixed(4);$("fxDate").textContent=fx.lastRefreshed+(cachedFX?' · שמור':'');
    $("master").textContent=a.master+'/100';$("signal").textContent=a.signal;
    renderSelectedQuote();renderAgents();renderPaper();setPlanUI();$("status").textContent="נתוני הנכס נטענו";
  }catch(e){if(requestId!==marketRequestId)return;$("error").textContent=shortError(e.message);$("error").style.display="block";$("status").textContent="שגיאת טעינה";}
}

function portfolios(){return cloudPortfolios||[]}
function paper(){return portfolios().find(p=>p.symbol===$("symbol").value)||portfolios()[0]||null}
function latestSnap(p){return [...snapshots()].reverse().find(x=>String(x.position_id||"")===String(p.id)||(!x.position_id&&x.symbol===p.symbol))||null}
function positionValue(p){
  const q=cloudAccount?.marks?.[p.symbol],last=latestSnap(p);
  const px=Number(q?.price??last?.market_price??p.entryPrice),rate=Number(q?.fx??cloudAccount?.fx??last?.fx??p.entryFX);
  const marketILS=Number(p.units)*px*rate;return {px,rate,marketILS,pnl:marketILS-Number(p.allocatedILS)};
}
function portfolioTotals(){
  const cap=cloudAccount?.initialized?Number(cloudAccount.capital):Math.max(1000,+$("capital").value||100000);
  if(cloudAccount?.initialized&&[cloudAccount.cash,cloudAccount.value,cloudAccount.pnl].every(numeric))return {cap,cash:Number(cloudAccount.cash),total:Number(cloudAccount.value),pnl:Number(cloudAccount.pnl),realized:Number(cloudAccount.realized_pnl)};
  if(portfolios().length){const v=legacyAccount({portfolios:portfolios(),snapshots:snapshots(),account:cloudAccount,closed:closedPositions});return {cap:v.capital,cash:v.cash,total:v.value,pnl:v.pnl,realized:v.realized_pnl};}
  return {cap,cash:cap,total:cap,pnl:0,realized:0};
}
async function openPaper(){
  const p={symbol:$("symbol").value,start:Math.max(1000,+$("capital").value||100000),plan:$("programPlan").value||plan,autoRebalance:$("autoRebalance").checked,autoRotate:$("autoRotate").checked};
  await savePortfolioCloud(p);
  $("status").textContent='תוכנית נייר נשמרה בענן';
}
function currentValue(p){const v=positionValue(p),t=portfolioTotals();return{...v,total:t.total,pnl:t.pnl}}
function renderPaper(){
  const ps=portfolios(),t=portfolioTotals();
  $("cashValue").textContent=money(t.cash);$("realizedValue").textContent=money(t.realized);
  $("accountUpdated").textContent=cloudAccount?.estimated?(cloudAccount.valuation_source==="entry_price"?"שווי לפי מחירי כניסה עבור נכסים שחסרים להם נתוני עבר — אינו מחיר שוק עדכני":"שווי לפי מחירים ושערי מט״ח מהיומן הקיים — אינו עדכון שוק חי"):cloudAccount?.updated_at?"עדכון תיק: "+new Date(cloudAccount.updated_at).toLocaleString("he-IL"):"ממתין לעדכון התיק הראשון";
  $("start").textContent=money(t.cap);$("value").textContent=money(t.total);$("pnl").textContent=`${t.pnl>=0?"+":""}${money(t.pnl)} (${(t.pnl/t.cap*100).toFixed(2)}%)`;$("pnl").className=t.pnl>=0?"green":"red";
  if(!ps.length){$("position").innerHTML='<tr><td colspan="9" class="muted">אין תוכניות פתוחות בענן.</td></tr>';return}
  $("position").innerHTML=ps.map(p=>{const v=positionValue(p),pe=p.plan==="ai_dynamic"?aiTargetExposure((latestSnap(p)?.score)??(market?.symbol===p.symbol?a?.master:50)):(exp[p.plan]||.5);return `<tr><td><b>${p.symbol}</b>${p.predecessorId?'<div class="muted">נפתח במעבר אוטומטי</div>':''}</td><td>${names[p.plan]||p.plan||"—"}<div class="muted">${automationText(p)}</div></td><td>${Math.round(pe*100)}%</td><td>${money(p.allocatedILS)}</td><td><span class=ltr>$${Number(p.allocatedUSD).toFixed(2)}</span></td><td>${Number(p.entryFX).toFixed(4)}</td><td><span class=ltr>$${Number(p.entryPrice).toFixed(2)}</span></td><td><span class="ltr ${v.px>=Number(p.entryPrice)?"green":"red"}">$${Number(v.px).toFixed(2)}</span></td><td><span class=ltr>${Number(p.units).toFixed(4)}</span></td><td>${money(v.marketILS)}</td><td class="${v.pnl>=0?"green":"red"}">${v.pnl>=0?"+":""}${money(v.pnl)}</td></tr>`}).join("");
}
function snapshots(){return cloudSnapshots||[]}
async function snapshot(){
  acceptCloud(await cloud("account_snapshot",{}));$("status").textContent="צילום מצב התיק כולו נשמר בענן";
}

function snapValue(x){return x?.position_value!=null?Number(x.position_value):Number(x?.value)}
function snapPnl(x){return x?.position_pnl!=null?Number(x.position_pnl):Number(x?.pnl)}
function legacyHistory(){
  const sym=$("symbol").value;
  const explicit=snapshots().some(x=>x.symbol===sym&&numeric(x.position_value));
  return snapshots().filter(x=>(!explicit||numeric(x.position_value)||x.position_id)&&x.plan!=='scanner'&&x.symbol===sym&&(numeric(x.position_value)||numeric(x.value))).map(x=>({...x,value:Number(x.position_value??x.value),pnl:Number(x.position_pnl??x.pnl),symbols:[x.symbol],created_at:x.created_at||x.date,reason:'היסטוריית נכס קיימת — '+(x.ai_action||x.recommendation||'תיעוד שמור')}));
}
function renderHistory(){
  const s=snapshots(),mode=$("historyMode");
  if(mode&&!['auto','account','legacy'].includes(mode.value))mode.value='auto';
  const legacy=mode&&mode.value!=='auto'?mode.value==='legacy':!accountHistory.length;
  const displayed=legacy?legacyHistory():accountHistory;chartData=displayed;
  $("snapCount").textContent=displayed.length+(legacy?' רשומות נכס מהיומן הקיים':' עדכוני תיק');
  $("journal").innerHTML=displayed.length?[...displayed].reverse().slice(0,20).map(x=>    '<tr><td>'+new Date(x.created_at).toLocaleString('he-IL')+'</td><td>'+escapeHTML((x.symbols||[]).join(' + ')||'מזומן')+'</td><td>'+money(x.value)+'</td><td class="'+(x.pnl>=0?'green':'red')+'">'+money(x.pnl)+'</td><td>'+Number(x.fx).toFixed(4)+'</td><td>'+escapeHTML(x.reason)+'</td></tr>'  ).join(''):'<tr><td colspan="6" class="muted">היסטוריית התיק הכולל תתחיל מהעדכון הבא. החלטות קודמות נשמרו ביומן ההחלטות.</td></tr>';
  $("decisionJournal").innerHTML=s.length?[...s].reverse().slice(0,30).map(x=>{
    const score=v=>v==null?'—':v+'/100';
    return '<tr><td>'+new Date(x.created_at||x.date).toLocaleString('he-IL')+'</td><td>'+escapeHTML(x.symbol)+'</td><td>'+escapeHTML(x.recommendation||'—')+'</td><td>'+score(x.score)+'</td><td>'+score(x.market_score)+'</td><td>'+score(x.trend_score)+'</td><td>'+score(x.risk_score)+'</td><td>'+score(x.momentum_score)+'</td><td>'+escapeHTML(names[x.plan]||x.plan||'—')+'</td><td>'+escapeHTML(x.ai_action||'—')+'</td><td>'+(x.auto?'אוטומטי':'ידני')+'</td></tr>';
  }).join(''):'<tr><td colspan="11" class="muted">אין החלטות מתועדות.</td></tr>';
  $("closedPositions").innerHTML=closedPositions.length?closedPositions.map(p=>'<tr><td>'+escapeHTML(p.symbol)+'</td><td>'+new Date(p.closedAt).toLocaleString('he-IL')+'</td><td>'+Number(p.closedUnits).toFixed(4)+'</td><td>'+money(p.closedValue)+'</td><td class="'+(p.realizedPnl>=0?'green':'red')+'">'+money(p.realizedPnl)+'</td></tr>').join(''):'<tr><td colspan="5" class="muted">אין עדיין תוכניות שנסגרו עם רישום מימוש.</td></tr>';
  $("performanceText").textContent=legacy?"היסטוריית הנכס "+$("symbol").value+" מהיומן הקיים. זו סדרת שווי נכס, ולא שווי התיק הכולל. רשומות פתיחה ללא זיהוי החזקה ושווי נכס אינן נכללות בגרף.":accountHistory.length?'שווי התיק הכולל לאורך זמן — מזומן וכל ההחזקות, כולל רווח והפסד מתוכניות שנסגרו. מעבר מניה אינו מאפס את הגרף.':'ממתין לעדכון תיק. ההיסטוריה הישנה לכל נכס נשארת ביומן ההחלטות.';
  draw(displayed);renderMonitor();
}

function draw(s){let c=$("chart"),r=c.getBoundingClientRect(),d=devicePixelRatio||1;c.width=r.width*d;c.height=r.height*d;let x=c.getContext("2d");x.scale(d,d);x.clearRect(0,0,r.width,r.height);if(s.length<2){x.fillStyle="#9eb5ca";x.font="14px Arial";x.save?.();x.direction="rtl";x.textAlign="right";x.fillText("נדרשות לפחות שתי נקודות להצגת גרף",r.width-20,40,r.width-40);x.restore?.();return}let vals=s.map(x=>Number(x.value)).filter(Number.isFinite),mn=Math.min(...vals),mx=Math.max(...vals),sp=Math.max(1,mx-mn);x.strokeStyle="#39b4ff";x.lineWidth=2.5;x.beginPath();vals.forEach((v,i)=>{let px=15+(r.width-30)*i/(vals.length-1),py=15+(r.height-30)*(1-(v-mn)/sp);i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke()}
async function saveSelectedPlan(){
  const p=selectedPortfolio();if(!p)return alert("בחר נכס שיש לו תוכנית פתוחה");
  if(!automationSettingsSupported)throw Error("נדרש עדכון SQL ו־Functions לגרסה 6.2");
  const response=await cloud("update_plan",{id:p.id,plan:$("programPlan").value,autoRebalance:$("autoRebalance").checked,autoRotate:$("autoRotate").checked});settingsDirty=false;acceptCloud(response);
  $("status").textContent="המסלול והאוטומציה נשמרו · ההחזקה לא השתנתה כעת";
}
async function closeP(){const p=selectedPortfolio();if(!p)return alert("בחר תוכנית פתוחה");if(!confirm('לסגור את תוכנית הנייר '+p.symbol+'?'))return;acceptCloud(await cloud('close_portfolio',{id:p.id}));}
async function resetAll(){if(!confirm("לאפס את כל הסימולציה וההיסטוריה?"))return;acceptCloud(await cloud("reset",{}));marketRequestId++;market=null;a=null;$("status").textContent="הסימולציה אופסה בענן";}

$("symbol").onchange=()=>{
  // Keep every top card and agent score synchronized with the selected asset.
  marketRequestId++;market=null; a=null;$("price").textContent="—";$("master").textContent="—";$("signal").textContent="";$("agents").innerHTML="";
  renderPaper(); setPlanUI(); renderHistory();
  load().catch(e=>{console.error(e); $("status").textContent="שגיאת טעינה"});
};
$("programPlan").onchange=()=>{settingsDirty=true;renderSettingsHint();};
$("autoRebalance").onchange=()=>{settingsDirty=true;renderSettingsHint();};
$("autoRotate").onchange=()=>{settingsDirty=true;renderSettingsHint();};
$("historyMode")&&($("historyMode").onchange=()=>renderHistory());
$("scanNow")&&($("scanNow").onclick=()=>loadScanner(true));
$("savePlan").onclick=()=>saveSelectedPlan().catch(e=>alert(shortError(e.message)));
$("load").onclick=load;$("open").onclick=()=>openPaper().catch(e=>alert(shortError(e.message)));$("snapshot").onclick=()=>snapshot().catch(e=>alert(shortError(e.message)));$("close").onclick=()=>closeP().catch(e=>alert(shortError(e.message)));$("reset").onclick=()=>resetAll().catch(e=>alert(shortError(e.message)));
window.addEventListener("resize",()=>draw(chartData));
syncCloud().catch(()=>{});startLive();loadScanner(false);
setInterval(()=>{syncCloud().catch(()=>{});},60000);
setInterval(()=>loadScanner(false),60000);