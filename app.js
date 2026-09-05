const TABLE = "emptying_tracking";
const SLA_HOURS = 48;
let supabaseClient = null;
let rows = [];

function fmtDate(v){
  if(!v) return "";
  const d=new Date(v); if(Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("he-IL",{dateStyle:"short",timeStyle:"short"}).format(d);
}
function hoursBetween(a,b){
  if(!a) return null;
  const da=new Date(a), db=b?new Date(b):new Date();
  if(Number.isNaN(da.getTime())||Number.isNaN(db.getTime())) return null;
  return (db-da)/36e5;
}
function slaInfo(r){
  const h=hoursBetween(r.transmission_date,r.emptying_date);
  if(h==null) return {cls:"wait",txt:"ללא תאריך שידור",hours:null};
  if(r.emptying_date) return h<=SLA_HOURS?{cls:"ok",txt:"רוקנה בזמן",hours:h}:{cls:"bad",txt:`חריגה ${Math.ceil(h-SLA_HOURS)} ש׳`,hours:h};
  if(h>SLA_HOURS) return {cls:"bad",txt:`חריגה ${Math.ceil(h-SLA_HOURS)} ש׳`,hours:h};
  if(h>=36) return {cls:"warn",txt:`נותרו ${Math.max(0,Math.ceil(SLA_HOURS-h))} ש׳`,hours:h};
  return {cls:"ok",txt:`נותרו ${Math.ceil(SLA_HOURS-h)} ש׳`,hours:h};
}
function render(){
  const q=document.getElementById("search").value.trim().toLowerCase();
  const wf=document.getElementById("warehouseFilter").value;
  const sf=document.getElementById("statusFilter").value;
  const filtered=rows.filter(r=>{
    const s=slaInfo(r);
    const text=[r.container_no,r.ship,r.forwarder].join(" ").toLowerCase();
    if(q&&!text.includes(q)) return false;
    if(wf&&String(r.warehouse_no||"")!==wf) return false;
    if(sf==="waiting"&&r.emptying_date) return false;
    if(sf==="done"&&!r.emptying_date) return false;
    if(sf==="late"&&!(s.hours>SLA_HOURS)) return false;
    return true;
  });
  const tb=document.getElementById("tbody"); tb.innerHTML="";
  filtered.forEach(r=>{
    const s=slaInfo(r);
    const elapsed=s.hours==null?"—":`${Math.floor(s.hours)} ש׳`;
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${esc(r.container_no||"")}</td>
      <td>${esc(r.ship||"")}</td>
      <td>${esc(r.forwarder||"")}</td>
      <td>${num(r.quantity)}</td>
      <td>${num(r.weight)}</td>
      <td>${fmtDate(r.transmission_date)}</td>
      <td>${r.warehouse_no?`מחסן ${r.warehouse_no}`:"טרם שויך"}</td>
      <td>${fmtDate(r.emptying_date)}</td>
      <td>${elapsed}</td>
      <td><span class="status ${s.cls}">${s.txt}</span></td>
      <td>${r.emptying_date?'<span class="small">הושלם</span>':`<button onclick="markDone('${r.id}')">סמן כרוקנה</button>`}</td>`;
    tb.appendChild(tr);
  });
  document.getElementById("empty").style.display=filtered.length?"none":"block";
  document.getElementById("kTotal").textContent=rows.length;
  document.getElementById("kWaiting").textContent=rows.filter(r=>!r.emptying_date).length;
  document.getElementById("kDone").textContent=rows.filter(r=>!!r.emptying_date).length;
  document.getElementById("kLate").textContent=rows.filter(r=>slaInfo(r).hours>SLA_HOURS).length;
  [1,2,3].forEach(n=>document.getElementById("w"+n).textContent=rows.filter(r=>r.warehouse_no===n).length);
}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function num(v){return v==null||v===""?"":new Intl.NumberFormat("he-IL",{maximumFractionDigits:2}).format(Number(v)||0);}

async function loadData(){
  const conn=document.getElementById("conn");
  if(!supabaseClient){conn.textContent="לא הוגדר חיבור ל־Supabase";conn.className="pill bad";return;}
  const {data,error}=await supabaseClient.from(TABLE).select("*").order("transmission_date",{ascending:true});
  if(error){conn.textContent="שגיאת חיבור לענן";conn.className="pill bad";console.error(error);return;}
  rows=data||[]; conn.textContent="מחובר לענן";conn.className="pill ok"; render();
}
async function markDone(id){
  const {error}=await supabaseClient.from(TABLE).update({emptying_date:new Date().toISOString(),status:"done"}).eq("id",id);
  if(error){alert("עדכון הריקון נכשל");console.error(error);return;}
  await loadData();
}
async function balance(){
  const waiting=rows.filter(r=>!r.emptying_date);
  if(!waiting.length){alert("אין מכולות ממתינות לחלוקה");return;}
  const mode=document.getElementById("balanceMode").value;
  let assignments=[];
  if(mode==="quantity"){
    const loads=[0,0,0];
    [...waiting].sort((a,b)=>(Number(b.quantity)||1)-(Number(a.quantity)||1)).forEach(r=>{
      let idx=loads.indexOf(Math.min(...loads));
      assignments.push({id:r.id,warehouse_no:idx+1});
      loads[idx]+=Number(r.quantity)||1;
    });
  }else{
    const groups={};
    waiting.forEach(r=>{const k=r.forwarder||"ללא משלח";(groups[k]??=[]).push(r);});
    let wh=1; Object.values(groups).sort((a,b)=>b.length-a.length).forEach(g=>{
      g.forEach(r=>assignments.push({id:r.id,warehouse_no:wh}));
      wh=wh%3+1;
    });
  }
  for(const a of assignments){
    const {error}=await supabaseClient.from(TABLE).update({warehouse_no:a.warehouse_no}).eq("id",a.id);
    if(error){alert("החלוקה נכשלה");console.error(error);return;}
  }
  await loadData();
}
document.getElementById("search").addEventListener("input",render);
document.getElementById("warehouseFilter").addEventListener("change",render);
document.getElementById("statusFilter").addEventListener("change",render);
document.getElementById("balanceBtn").addEventListener("click",balance);
document.getElementById("refreshBtn").addEventListener("click",loadData);

(function init(){
  if(window.APP_CONFIG?.SUPABASE_URL && window.APP_CONFIG?.SUPABASE_ANON_KEY &&
     !window.APP_CONFIG.SUPABASE_URL.includes("YOUR_")){
    supabaseClient=window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL,window.APP_CONFIG.SUPABASE_ANON_KEY);
  }
  loadData();
  setInterval(render,60000);
})();
