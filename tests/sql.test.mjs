import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`
create role anon;create role authenticated;create role service_role;
create table paper_portfolio(id text primary key,symbol text,start numeric,units numeric,allocated_ils numeric,allocated_usd numeric,strategy_mode text,plan text,status text,updated_at timestamptz);
create table portfolio_snapshots(snapshot_key text unique,date date,symbol text,position_id text,position_value numeric,position_pnl numeric,value numeric,pnl numeric,fx numeric,score numeric,market_price numeric,auto boolean,market_score numeric,trend_score numeric,risk_score numeric,momentum_score numeric,recommendation text,plan text,target_exposure numeric,actual_exposure numeric,ai_action text);
`);
await db.exec(fs.readFileSync(new URL('../sql/001-paper-agent.sql',import.meta.url),'utf8'));
const scores=JSON.stringify({master:75,market:75,trend:75,risk:75,momentum:75,signal:'מועמד לקנייה'});
async function setup({units=100,allocation=10000,mode='ai_dynamic',action='BUY',sameBar=false}={}){
 await db.exec('truncate paper_portfolio,portfolio_snapshots,paper_agent_decisions');
 await db.query("insert into paper_portfolio values('1','SPY',100000,$1,$2,$2,$3,$3,'open',now())",[units,allocation,mode]);
 await db.query(`insert into paper_agent_decisions select '1',date_trunc('minute',now())-n*interval '30 minutes',timezone('UTC',date_trunc('minute',now()))-(case when $2 then 1 else n end)*interval '30 minutes',$1,'{}'::jsonb from generate_series(1,2) n`,[action,sameBar]);
}
async function run(target=.8){return (await db.query(`select apply_paper_decision('1',date_trunc('minute',now()),100,1,$1,timezone('UTC',date_trunc('minute',now())),$2::jsonb) result`,[target,scores])).rows[0].result;}
test('transaction buys after 3 decisions, conserves P/L and retries exactly once',async()=>{
 await setup();const r=await run();assert.equal(r.trade_ils,70000);
 assert.deepEqual(await run(),r);
 const p=(await db.query('select * from paper_portfolio')).rows[0];assert.equal(Number(p.units),800);
 assert.equal((await db.query('select * from portfolio_snapshots')).rows.length,1);
});
test('sell to zero preserves accumulated simulated profit',async()=>{
 await setup({units:800,allocation:70000,action:'SELL'});
 const r=await run(0);assert.equal(r.trade_ils,-80000);
 const p=(await db.query('select * from paper_portfolio')).rows[0];assert.equal(Number(p.units),0);assert.equal(Number(p.allocated_ils),-10000);
});
test('fixed plan and repeated bar confirmations do not execute',async()=>{
 await setup({mode:'balanced'});assert.equal((await run()).trade_ils,0);
 await setup({sameBar:true});assert.equal((await run()).trade_ils,0);
});
test('cash exhaustion prevents overspending',async()=>{
 await setup({allocation:100000});assert.equal((await run()).trade_ils,0);
});
test('snapshot failure rolls back position changes',async()=>{
 await setup();await db.exec("alter table portfolio_snapshots add constraint force_failure check (score<0)");
 await assert.rejects(run());
 assert.equal(Number((await db.query('select units from paper_portfolio')).rows[0].units),100);
 await db.exec('alter table portfolio_snapshots drop constraint force_failure');
});
test('stale quotes are rejected',async()=>{
 await setup();await assert.rejects(db.query(`select apply_paper_decision('1',date_trunc('minute',now()),100,1,.8,timezone('UTC',now())-interval '2 hours',$1::jsonb)`,[scores]));
});

after(()=>db.close());

