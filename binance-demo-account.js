(()=>{
const base=window.API_BASE||'https://binance-wave-agent.onrender.com';
const status=document.getElementById('demoAccountStatus'),total=document.getElementById('demoAccountTotal'),body=document.getElementById('demoAccountBalances');
const valueFormat=n=>Number(n).toLocaleString('he-IL',{maximumFractionDigits:2});
const format=n=>Number(n).toLocaleString('he-IL',{maximumFractionDigits:8});
let busy=false;
async function refresh(){
 if(busy)return;busy=true;
 status.textContent='טוען יתרות מהחשבון…';total.textContent='— USDT';body.replaceChildren();
 try{
  const r=await fetch(base+'/api/binance-demo-account',{cache:'no-store'}),d=await r.json();
  if(!r.ok||!d.connected)throw Error(d.error||'לא ניתן לקרוא יתרות');
  const a=d.account;
  total.textContent=(a.unpricedAssets.length?'שווי חלקי: ':'')+valueFormat(a.totalValueUsdt)+' USDT';
  status.textContent='Binance Demo Spot · עודכן '+new Date(a.updatedAt).toLocaleString('he-IL')+(a.unpricedAssets.length?' · חסר מחיר עבור '+a.unpricedAssets.join(', '):'');
  for(const b of a.balances){const row=document.createElement('tr');for(const v of [b.asset,format(b.free),format(b.locked),b.valueUsdt===null?'מחיר לא זמין':valueFormat(b.valueUsdt)]){const cell=document.createElement('td');cell.textContent=v;row.append(cell);}body.append(row);}
 }catch(e){status.textContent='חשבון הדמו אינו מחובר: '+e.message;}finally{busy=false;}
}
document.getElementById('refreshDemoAccount')?.addEventListener('click',refresh);refresh();setInterval(refresh,60000);
})();
