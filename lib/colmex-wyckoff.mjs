import {createWyckoffTrade,wyckoffExit} from './wyckoff-strategy.mjs';
// Uses independently supplied D1 quotes. Intraday collector bars cannot authorize entry.
export function planWyckoffCycle(snapshot,market,closedLedger,now,recentCommands,previousPrograms,config,quoteSpec,dailyQuotes={}){
 const items=market?.items||{},commands=[],programs=[];
 const used=new Set(recentCommands.filter(c=>c.status==='filled'||c.id===snapshot.result?.id&&snapshot.result?.status==='filled').map(c=>c.command?.wyckoffTrade?.patternId));
 for(const p of previousPrograms)for(const pattern of p.usedPatterns||[])used.add(pattern);
 const reserved=new Set(snapshot.orders.map(o=>o.symbol));
 for(let i=0;i<config.magics.length;i++){
  const id=i+1,orders=snapshot.orders.filter(o=>o.magic===config.magics[i]),prior=previousPrograms.find(p=>p.id===id),held=orders[0];
  const program={id,label:'וויקוף יומי '+id,budget:config.budget,target:config.budget*config.target,cap:config.budget,orders,symbol:held?.symbol||null,status:'ממתין לתבנית יומית',wyckoffTrade:prior?.wyckoffTrade||null};
  program.usedPatterns=[...new Set([...(prior?.usedPatterns||[]),...recentCommands.filter(c=>(c.status==='filled'||c.id===snapshot.result?.id&&snapshot.result?.status==='filled')&&c.command?.program===id).map(c=>c.command?.wyckoffTrade?.patternId).filter(Boolean)])];
  if(orders.length>1){program.status='מספר עסקאות באותה תוכנית — נדרש בירור';programs.push(program);continue;}
  if(held){
   const q=items[held.symbol],spec=quoteSpec(q,items,now,{forEntry:false});
   const filled=recentCommands.find(c=>(c.status==='filled'||c.id===snapshot.result?.id&&snapshot.result?.status==='filled')&&c.command?.program===id&&c.command.action==='BUY'&&c.command.symbol===held.symbol);
   if(!program.wyckoffTrade&&filled?.command.wyckoffTrade)program.wyckoffTrade=filled.command.wyckoffTrade;
   if(program.wyckoffTrade){program.wyckoffTrade={...program.wyckoffTrade,stopPrice:held.openPrice*.94};}
   if(!spec.ok){program.status=spec.reason;}
   else if(!program.wyckoffTrade){program.status='החזקה קודמת ללא שיא ראשוני מתועד — נדרש בירור';}
   else{
    const exit=wyckoffExit(program.wyckoffTrade,q.bid);
    program.status=exit.reason;
    if(exit.sell&&!snapshot.historyOverflow)commands.push({program:id,magic:config.magics[i],action:'CLOSE',symbol:held.symbol,lots:held.lots,ticket:held.ticket,purpose:'wyckoff',reason:exit.reason,barTime:Math.floor(now/86400)*86400,decisionKey:[id,held.ticket,exit.reason].join(':'),spec,cap:program.cap,target:program.target});
   }
  }else if(!snapshot.historyOverflow&&!snapshot.foreignOrders){
   program.wyckoffTrade=null;
   for(const [symbol,q]of Object.entries(dailyQuotes)){
    if(reserved.has(symbol)||!q.wyckoff?.buyConfirmed||used.has(q.wyckoff.patternId)||q.timeframe!=='1d')continue;
    const item=items[symbol],spec=quoteSpec(item,items,now);
    if(!spec.ok)continue;
    const trade=createWyckoffTrade(q.wyckoff,item.ask);
    const lots=Number((Math.floor(program.target/(spec.unit*1.005)/spec.step)*spec.step).toFixed(8));
    if(lots<spec.minLot||lots*spec.unit<config.minimumUSD)continue;
    const exposure=snapshot.orders.reduce((n,o)=>{const s=quoteSpec(items[o.symbol],items,now,{forEntry:false});return n+(s.ok?o.lots*s.unit:Infinity);},0);
    if(exposure+lots*spec.unit>config.capital)continue;
    reserved.add(symbol);program.status='WYCKOFF_RECLAIM';program.candidate=symbol;
    commands.push({program:id,magic:config.magics[i],action:'BUY',symbol,lots,ticket:0,purpose:'wyckoff',reason:'WYCKOFF_RECLAIM',wyckoffTrade:trade,barTime:Math.floor(now/86400)*86400,decisionKey:[id,symbol,trade.patternId].join(':'),spec,cap:program.cap,target:program.target});break;
   }
   if(!Object.keys(dailyQuotes).length)program.status='WAIT_DAILY_BARS — אין מקור יומי מאומת';
  }
  programs.push(program);
 }
 commands.sort((a,b)=>(a.action==='CLOSE'?0:1)-(b.action==='CLOSE'?0:1)||a.program-b.program);
 return {programs,command:commands[0]||null,scan:{barTime:Math.floor(now/86400)*86400,universe:'WYCKOFF_D1',programs:programs.map(p=>({id:p.id,key:p.status,action:commands.find(c=>c.program===p.id)?.action||'HOLD',symbol:p.symbol,reason:p.status}))},complete:Object.keys(dailyQuotes).length>0,policy:{...config,strategy:'WYCKOFF_D1_V1',targetMultiplier:1.07,stopLossPct:6},blocked:[],eligibleCount:commands.filter(c=>c.action==='BUY').length};
}
