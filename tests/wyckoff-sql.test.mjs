import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`
create role anon;create role authenticated;create role service_role;
create table paper_portfolio(id bigint generated always as identity primary key,symbol text,start numeric,units numeric,allocated_ils numeric,allocated_usd numeric,entry_price numeric,entry_fx numeric,cash_ils numeric,entry_date date,strategy_mode text,plan text,status text,updated_at timestamptz);
create table portfolio_snapshots(id bigint generated always as identity primary key,created_at timestamptz default now(),snapshot_key text unique,date date,symbol text,position_id text,position_value numeric,position_pnl numeric,value numeric,pnl numeric,fx numeric,score numeric,market_price numeric,auto boolean,market_score numeric,trend_score numeric,risk_score numeric,momentum_score numeric,recommendation text,plan text,target_exposure numeric,actual_exposure numeric,ai_action text);
create table agent_monitor_status(id integer primary key,status text,scores jsonb,symbols jsonb,checks integer,note text,updated_at timestamptz,checked_at timestamptz);
`);
for(const file of ['001-paper-agent.sql','002-paper-rotation.sql','003-preserve-existing.sql','004-automation-plans.sql','005-market-cache.sql','006-wyckoff-daily.sql'])await db.exec(fs.readFileSync(new URL('../sql/'+file,import.meta.url),'utf8'));
after(()=>db.close());
let slot,quote;
async function setup(){
 await db.exec('truncate paper_settings_history,paper_portfolio,portfolio_snapshots,paper_agent_decisions,paper_cycle_runs,paper_rotation_scans,paper_account_snapshots,paper_account_state,paper_wyckoff_patterns restart identity');
 slot=new Date(Math.floor(Date.now()/1800000)*1800000).toISOString();
 quote={price:81,updated_at:new Date(Date.now()-1000).toISOString().replace('T',' ').replace('Z',''),timeframe:'1d',master:100,market:50,trend:50,risk:50,momentum:50,wyckoff:{timeframe:'1d',buyConfirmed:true,initialPeak:{price:100},firstLow:{price:80},springLow:{price:78},consolidationBars:4,patternId:'p1'}};
 await db.exec("insert into paper_account_state values(1,10000);insert into paper_portfolio(symbol,start,units,allocated_ils,allocated_usd,entry_price,entry_fx,cash_ils,entry_date,plan,strategy_mode,status,updated_at) values('SPY',10000,0,0,0,81,1,0,current_date,'growth','growth','open',now());");
}
async function decision(id='1',s=slot){return (await db.query('select apply_paper_decision($1,$2,$3,1,0,$4,$5::jsonb) result',[id,s,quote.price,quote.updated_at,JSON.stringify(quote)])).rows[0].result;}
test('migration compiles and reruns; transaction saves original peak, 107 target and 6% stop',async()=>{
 await setup();await db.exec(fs.readFileSync(new URL('../sql/006-wyckoff-daily.sql',import.meta.url),'utf8'));
 const r=await decision();assert.equal(r.action,'BUY');assert.deepEqual(await decision(),r);
 const p=(await db.query('select * from paper_portfolio')).rows[0];assert.equal(p.wyckoff_trade.targetPrice,107);assert.equal(p.wyckoff_trade.stopPrice,76.14);assert.equal(Number(p.allocated_ils),8000);
 assert.equal((await db.query('select * from paper_wyckoff_patterns')).rows.length,1);
});
test('exit books realized P/L atomically and replacement waits for a new pattern',async()=>{
 await setup();await decision();quote.price=107;
 const next=new Date(Date.parse(slot)+1000).toISOString();const r=await decision('1',next);assert.equal(r.action,'SELL');
 const rows=(await db.query('select * from paper_portfolio order by id')).rows;assert.equal(rows[0].status,'closed');assert.equal(rows[1].status,'open');assert.equal(Number(rows[1].units),0);
 quote.price=81;assert.equal((await decision(String(rows[1].id),new Date(Date.parse(slot)+2000).toISOString())).action,'HOLD');
});
test('failed journal rolls back purchase and pattern consumption',async()=>{
 await setup();await db.exec('alter table portfolio_snapshots add constraint reject_wyckoff check (score<0)');
 await assert.rejects(decision());assert.equal(Number((await db.query('select units from paper_portfolio')).rows[0].units),0);assert.equal((await db.query('select * from paper_wyckoff_patterns')).rows.length,0);
 await db.exec('alter table portfolio_snapshots drop constraint reject_wyckoff');
});
test('intraday quotes and legacy holdings cannot bypass daily rules or receive guessed targets',async()=>{
 await setup();quote.timeframe='5m';assert.equal((await decision()).action,'HOLD');
 await setup();await db.exec('update paper_portfolio set units=1,allocated_ils=81');quote.price=150;assert.equal((await decision()).action,'HOLD');
});
test('complete installer reruns without changing saved Wyckoff trade or realized value',async()=>{
 await setup();await decision();
 const before=(await db.query('select * from paper_portfolio')).rows;
 await db.exec(fs.readFileSync(new URL('../sql/INSTALL_ALL.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('select * from paper_portfolio')).rows,before);
 quote.price=107;assert.equal((await decision('1',new Date(Date.parse(slot)+1000).toISOString())).action,'SELL');
});
test('missing spring or consolidation and stale execution prices are rejected atomically',async()=>{
 await setup();delete quote.wyckoff.springLow;await assert.rejects(decision(),/Invalid Wyckoff entry/);
 await setup();delete quote.wyckoff.consolidationBars;await assert.rejects(decision(),/Invalid Wyckoff entry/);
 await setup();quote.updated_at=new Date(Date.now()-120000).toISOString().replace('T',' ').replace('Z','');await assert.rejects(decision(),/Invalid Wyckoff decision/);
});
