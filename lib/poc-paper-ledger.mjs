import fs from 'node:fs';
import path from 'node:path';
import {POC_PAPER_POLICY as policy,verifiedBalance,verifiedQuote} from './poc-paper-strategy.mjs';
const sides=['LONG','SHORT'];
const sign=side=>side==='LONG'?1:-1;
const day=at=>new Date(at).toISOString().slice(0,10);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function savePaper(file,state){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const temp=file+'.tmp',fd=fs.openSync(temp,'w',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);
 const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function blank(){return {version:policy.version,policy:structuredClone(policy),accounts:{LONG:null,SHORT:null},lastCycle:null};}
function validate(s){
 if(s.version!==policy.version||JSON.stringify(s.policy)!==JSON.stringify(policy)||!s.accounts)throw Error('PAPER_STATE_INVALID');
 for(const side of sides){const a=s.accounts[side];if(!a)continue;
  if(![a.seed,a.startedAt,a.realized,a.entryFees,a.closedFees,a.closedCount,a.wins,a.dayBudget].every(finite)||a.seed<0||!a.positions||!a.pending||!Array.isArray(a.used)||!Array.isArray(a.closed)||!Array.isArray(a.daily))throw Error('PAPER_STATE_INVALID');
  for(const [symbol,p] of Object.entries(a.positions))if(p.symbol!==symbol||p.side!==side||![p.qty,p.entry,p.notional,p.entryFee,p.extreme,p.stop,p.entryAt,p.quoteAt,p.mark].every(finite)||p.qty<=0||p.entry<=0||p.notional<=0||p.extreme<=0||p.stop<=0)throw Error('PAPER_STATE_INVALID');
  if(a.closed.length!==a.closedCount||a.closed.some(p=>!finite(p.net)||!finite(p.closedAt)))throw Error('PAPER_STATE_INVALID');
 }
}
export class PocPaperLedger{
 constructor({file,now=Date.now,save=savePaper}){
  Object.assign(this,{file,now,saveImpl:save});this.live={LONG:null,SHORT:null};this.state=blank();this.fatal=null;
  try{if(fs.existsSync(file))this.state=JSON.parse(fs.readFileSync(file,'utf8'));validate(this.state);}
  catch{this.fatal='PAPER_JOURNAL_UNREADABLE';}
  // Never resume an armed trigger across an unobserved restart.
  if(!this.fatal)for(const a of Object.values(this.state.accounts)){if(!a)continue;for(const p of Object.values(a.pending))p.armed=false;for(const p of Object.values(a.positions))p.gap=true;}
 }
 commit(fn){
  if(this.fatal)return false;
  const before=structuredClone(this.state);
  try{fn();this.saveImpl(this.file,this.state);return true;}
  catch{this.state=before;this.fatal='PAPER_JOURNAL_WRITE_FAILED';return false;}
 }
 balances(readings){
  const now=this.now();for(const side of sides)this.live[side]=verifiedBalance(readings[side],now);
  if(!sides.some(side=>!this.state.accounts[side]&&this.live[side]?.equity>0))return;
  this.commit(()=>{for(const side of sides){const b=this.live[side];if(this.state.accounts[side]||!b||!(b.equity>0))continue;
   this.state.accounts[side]={seed:b.equity,startedAt:now,seedAt:b.at,realized:0,entryFees:0,closedFees:0,closedCount:0,wins:0,positions:{},pending:{},used:[],closed:[],daily:[],day:day(now),dayBudget:b.equity/policy.slots[side]};
  }});
 }
 setup(side,symbol,setup){
  const a=this.state.accounts[side];if(!a||this.fatal)return;
  if(setup&&setup.side!==side)throw Error('WRONG_SIDE');
  if(setup&&a.pending[symbol]?.id===setup.id){a.pending[symbol].historyAt=setup.historyAt;return;}
  this.commit(()=>{
   delete a.pending[symbol];
   if(setup&&!a.used.includes(setup.id)&&!a.positions[symbol])a.pending[symbol]={...setup,armed:false};
  });
 }
 observe(quotes){
  const now=this.now();if(this.fatal)return;
  this.commit(()=>{
   for(const side of sides){const a=this.state.accounts[side];if(!a)continue;const sg=sign(side),fee=policy.roundTripFeePct/200;
    if(a.day!==day(now)){a.day=day(now);a.dayBudget=Math.max(0,a.seed+a.realized)/policy.slots[side];}
    const symbols=new Set([...Object.keys(a.positions),...Object.keys(a.pending)]);
    for(const symbol of symbols){const q=verifiedQuote(quotes[side]?.[symbol],now),p=a.positions[symbol],pending=a.pending[symbol];
     if(!q){if(p&&now-p.quoteAt>policy.gapMs)p.gap=true;if(pending)pending.armed=false;continue;}
     if(p&&q.at<p.quoteAt)continue;
     if(p){
      if(q.at-p.quoteAt>policy.gapMs)p.gap=true;
      const price=side==='LONG'?q.bid:q.ask;
      p.extreme=side==='LONG'?Math.max(p.extreme,price):Math.min(p.extreme,price);p.mark=price;p.quoteAt=q.at;
      const trail=p.extreme*(1-sg*policy.trailingPct/100),stop=side==='LONG'?Math.max(p.stop,trail):Math.min(p.stop,trail),structural=stop===p.stop;
      if(structural?sg*(price-stop)<=0:sg*(price-stop)<0){
       const exitFee=p.qty*price*fee,net=sg*p.qty*(price-p.entry)-p.entryFee-exitFee;
       a.realized+=net;a.entryFees-=p.entryFee;a.closedFees+=p.entryFee+exitFee;a.closedCount++;if(net>0)a.wins++;
       a.closed.push({...p,exit:price,closedAt:now,exitQuoteAt:q.at,net,exitFee,reason:structural?'STRUCTURE_STOP':'TRAILING_STOP'});delete a.positions[symbol];
      }
     }
     if(!pending)continue;
     if(now>pending.expiresAt||pending.historyAt!==Math.floor(now/300000)*300000){delete a.pending[symbol];continue;}
     const trigger=side==='LONG'?q.bid:q.ask;
     if(sg*(trigger-pending.stop)<=0){a.used.push(pending.id);delete a.pending[symbol];continue;}
     if(sg*(trigger-pending.poc)<0){pending.armed=true;pending.quoteAt=q.at;continue;}
     if(!pending.armed||sg*(trigger-pending.poc)<=0)continue;
     // No retrospective threshold fills: execution uses the observed opposite quote.
     if(q.at-(pending.quoteAt||0)>policy.gapMs){pending.armed=false;continue;}
     a.used.push(pending.id);delete a.pending[symbol];
     if(a.positions[symbol]||Object.keys(a.positions).length>=policy.slots[side]||a.closedCount>=50000)continue;
     const reserved=Object.values(a.positions).reduce((n,p)=>n+p.notional+p.entryFee,0),cash=a.seed+a.realized-reserved;
     const budget=Math.min(cash,a.dayBudget),notional=budget/(1+policy.roundTripFeePct/100),entry=side==='LONG'?q.ask:q.bid;
     if(!(budget>0.01)||sg*(entry-pending.stop)<=0)continue;
     const qty=notional/entry,entryFee=notional*fee;a.entryFees+=entryFee;
     a.positions[symbol]={id:pending.id,symbol,side,poc:pending.poc,stop:pending.stop,entry,entryAt:now,qty,notional,entryFee,extreme:entry,mark:trigger,quoteAt:q.at,gap:false};
    }
    a.used=a.used.slice(-10000);
    const value=this.value(side,now);const point={day:a.day,at:now,equity:value.equity,realized:a.realized,open:value.openPnl,gaps:value.gapTrades};
    if(a.daily.at(-1)?.day===a.day)a.daily[a.daily.length-1]=point;else a.daily.push(point);
   }
   this.state.lastCycle=now;
  });
 }
 value(side,now=this.now()){
  const a=this.state.accounts[side];if(!a)return null;const sg=sign(side),positions=Object.values(a.positions);
  const fresh=positions.every(p=>now-p.quoteAt<=policy.quoteMaxAgeMs&&p.quoteAt<=now+1000),openPnl=fresh?positions.reduce((n,p)=>n+sg*p.qty*(p.mark-p.entry)-p.entryFee,0):null;
  const equity=openPnl===null?null:a.seed+a.realized+openPnl;
  return {equity,openPnl,totalPnl:equity===null?null:equity-a.seed,pct:equity===null?null:(equity/a.seed-1)*100,quoteFresh:fresh,gapTrades:positions.filter(p=>p.gap).length+a.closed.filter(p=>p.gap).length};
 }
 snapshot(){
  const now=this.now();return {ok:!this.fatal,version:policy.version,executionEnabled:false,error:this.fatal,asOf:now,lastCycle:this.state.lastCycle,policy,accounts:sides.map(side=>{
   const a=this.state.accounts[side],live=verifiedBalance(this.live[side]?{...this.live[side],complete:true}:null,now);
   if(!a)return {side,live,status:live?.equity===0?'ZERO_BALANCE':'WAIT_BALANCE'};
   return {side,live,status:this.fatal?'STORAGE_ERROR':now-(this.state.lastCycle||0)>15000?'WAIT_QUOTES':'RUNNING',seed:a.seed,startedAt:a.startedAt,seedAt:a.seedAt,realized:a.realized,fees:a.closedFees+a.entryFees,closedCount:a.closedCount,wins:a.wins,...this.value(side,now),positions:Object.values(a.positions).map(p=>({...p,net:now-p.quoteAt<=policy.quoteMaxAgeMs?sign(side)*p.qty*(p.mark-p.entry)-p.entryFee:null})),pending:Object.values(a.pending),closed:a.closed.slice(-100).reverse(),daily:a.daily.slice(-366)};
  })};
 }
}
