import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`
create role anon;create role authenticated;create role service_role;
create table paper_portfolio(id bigint generated always as identity primary key,symbol text,start numeric,units numeric,allocated_ils numeric,allocated_usd numeric,entry_price numeric,entry_fx numeric,cash_ils numeric,entry_date date,strategy_mode text,plan text,status text,updated_at timestamptz);
create table portfolio_snapshots(id bigint generated always as identity primary key,created_at timestamptz default now(),snapshot_key text unique,date date,symbol text,position_id text,position_value numeric,position_pnl numeric,value numeric,pnl numeric,fx numeric,score numeric,market_price numeric,auto boolean,market_score numeric,trend_score numeric,risk_score numeric,momentum_score numeric,recommendation text,plan text,target_exposure numeric,actual_exposure numeric,ai_action text);
create table agent_monitor_status(id integer primary key,status text,scores jsonb,symbols jsonb,checks integer,note text,updated_at timestamptz,checked_at timestamptz);
`);
for(const file of ['001-paper-agent.sql','002-paper-rotation.sql'])await db.exec(fs.readFileSync(new URL('../sql/'+file,import.meta.url),'utf8'));
const universe=['SPY','QQQ','DIA','IWM','AAPL','MSFT','NVDA','AMZN'];
let quotes,slot;
async function setup({cost=9000,mode='ai_dynamic',confirm=true}={}){
 await db.exec('truncate paper_portfolio,portfolio_snapshots,paper_agent_decisions,paper_cycle_runs,paper_rotation_scans,paper_account_snapshots,paper_account_state restart identity');
 slot=new Date(Math.floor(Date.now()/1800000)*1800000).toISOString();
 quotes=Object.fromEntries(universe.map(symbol=>[symbol,{price:symbol==='MSFT'?200:100,master:symbol==='MSFT'?80:50,market:60,trend:60,momentum:60,risk:60,signal:'test',updated_at:slot.slice(0,19).replace('T',' ')}]));
 await db.query("insert into paper_portfolio(symbol,start,units,allocated_ils,allocated_usd,entry_price,entry_fx,plan,strategy_mode,status,updated_at) values('SPY',100000,100,$1,$1,90,1,$2,$2,'open',now())",[cost,mode]);
 if(confirm)await db.query(`insert into paper_rotation_scans select $1::timestamptz-n*interval '30 minutes',timezone('UTC',$1::timestamptz)-n*interval '30 minutes','MSFT',80,'{}'::jsonb from generate_series(1,2)n`,[slot]);
}
async function run(){return (await db.query('select apply_paper_cycle($1,1,$2::jsonb) result',[slot,JSON.stringify(quotes)])).rows[0].result;}
async function state(){return (await db.query('select paper_get_state() result')).rows[0].result;}
test('rotation creates a new row, preserves profit and total equity, journals both legs',async()=>{
 await setup();const r=await run();assert.equal(r.rotation.from_symbol,'SPY');assert.equal(r.rotation.to_symbol,'MSFT');
 const s=await state();assert.equal(s.rows.length,1);assert.equal(s.rows[0].symbol,'MSFT');assert.equal(s.rows[0].predecessor_id,'1');
 assert.equal(s.closed[0].symbol,'SPY');assert.equal(s.closed[0].realized_pnl_ils,1000);
 assert.equal(s.account.value,101000);assert.equal(s.account.cash,21000);assert.equal(s.account.pnl,1000);
 assert.deepEqual(s.accountSnapshots.map(x=>x.value),[101000,101000]);
 assert.equal(s.snapshots.length,2);assert.ok(s.snapshots.some(x=>x.ai_action.includes('מכירה')));assert.ok(s.snapshots.some(x=>x.ai_action.includes('קנייה')));
 assert.deepEqual(await run(),r);assert.equal((await state()).snapshots.length,2);
});
test('realized loss stays in account after rotation',async()=>{
 await setup({cost:11000});await run();const s=await state();assert.equal(s.account.value,99000);assert.equal(s.account.realized_pnl,-1000);
});
test('fixed program and unconfirmed leader do not rotate',async()=>{
 await setup({mode:'balanced'});assert.equal((await run()).rotation,null);
 await setup({confirm:false});assert.equal((await run()).rotation,null);
});
test('advantage must reach ten points, ties do not cause churn',async()=>{
 await setup();quotes.SPY.master=75;assert.equal((await run()).rotation,null);
});
test('existing leader position is not duplicated or merged',async()=>{
 await setup();await db.exec("insert into paper_portfolio(symbol,start,units,allocated_ils,allocated_usd,entry_price,entry_fx,plan,strategy_mode,status,updated_at) values('MSFT',100000,20,4000,4000,200,1,'balanced','balanced','open',now())");
 assert.equal((await run()).rotation,null);assert.equal((await state()).rows.length,2);
});
test('partial or stale market data cannot sell the old position',async()=>{
 await setup();delete quotes.AAPL;await assert.rejects(run(),/Missing quote/);assert.equal((await state()).rows[0].symbol,'SPY');
 await setup();quotes.MSFT.updated_at='2020-01-01 10:00:00';await assert.rejects(run(),/stale quote/);assert.equal((await state()).closed.length,0);
});
test('failed buy journal rolls back sale, new row, scan vote and account snapshots',async()=>{
 await setup();await db.exec("alter table portfolio_snapshots add constraint reject_buy check (snapshot_key not like 'rotation-buy-%')");
 await assert.rejects(run(),/reject_buy/);const s=await state();assert.equal(s.rows.length,1);assert.equal(s.rows[0].symbol,'SPY');assert.equal(s.closed.length,0);assert.equal(s.accountSnapshots.length,0);
 await db.exec('alter table portfolio_snapshots drop constraint reject_buy');
});
test('manual close after rotation preserves both generations of realized profit',async()=>{
 await setup();await run();quotes.MSFT.price=210;
 await db.query("select manage_paper_portfolio('close_portfolio',$1::jsonb,$2::jsonb,1)",[JSON.stringify({id:2}),JSON.stringify(quotes)]);
 const s=await state();assert.equal(s.rows.length,0);assert.equal(s.closed.length,2);assert.equal(s.account.cash,105000);assert.equal(s.account.value,105000);assert.equal(s.account.realized_pnl,5000);
});
test('dynamic opening starts with cash and account capital cannot be changed by another program',async()=>{
 await setup({confirm:false});await db.exec('truncate paper_portfolio restart identity');
 await db.query("select manage_paper_portfolio('save_portfolio',$1::jsonb,$2::jsonb,1)",[JSON.stringify({symbol:'AAPL',start:50000,plan:'ai_dynamic'}),JSON.stringify(quotes)]);
 let s=await state();assert.equal(s.account.capital,50000);assert.equal(s.rows[0].units,0);
 await db.query("select manage_paper_portfolio('save_portfolio',$1::jsonb,$2::jsonb,1)",[JSON.stringify({symbol:'SPY',start:100000,plan:'balanced'}),JSON.stringify(quotes)]);
 s=await state();assert.equal(s.account.capital,50000);assert.equal(s.rows[1].allocated_ils,25000);
});
test('reset clears votes, cycles and account history as one transaction',async()=>{
 await setup();await run();await db.exec("select manage_paper_portfolio('reset','{}')");const s=await state();assert.equal(s.rows.length,0);assert.equal(s.accountSnapshots.length,0);assert.equal(s.rotation,null);assert.equal(s.account.initialized,false);
});
test('full SQL installer can be rerun without losing positions or realized profits',async()=>{
 await setup();await run();const before=await state();
 await db.exec(fs.readFileSync(new URL('../sql/INSTALL_ALL.sql',import.meta.url),'utf8'));
 const afterState=await state();assert.deepEqual(afterState,before);
});
after(()=>db.close());
