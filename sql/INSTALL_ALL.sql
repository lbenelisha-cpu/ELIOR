BEGIN;
-- Run once in Supabase SQL Editor before deploying. Existing application tables are required.
create table if not exists public.paper_agent_decisions (
  position_id text not null, slot timestamptz not null, bar_time timestamp not null,
  action text not null, result jsonb not null, primary key(position_id,slot)
);
alter table public.paper_agent_decisions enable row level security;
revoke all on public.paper_agent_decisions from anon, authenticated;

create or replace function public.apply_paper_decision(
  p_id text, p_slot timestamptz, p_price numeric, p_fx numeric,
  p_target numeric, p_bar timestamp, p_scores jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
<<decision>>
declare
  p public.paper_portfolio%rowtype;
  previous jsonb; mode text; action text; note text;
  pv numeric; actual numeric; desired numeric; trade numeric:=0;
  used numeric; cap numeric; available numeric; confirmed integer;
  result jsonb;
begin
  -- Serialize the shared simulated cash pool, including concurrent scheduled invocations.
  perform pg_advisory_xact_lock(72416091);
  select d.result into previous from paper_agent_decisions d where d.position_id=p_id and d.slot=p_slot;
  if found then return previous; end if;
  if p_price is null or p_fx is null or p_price<=0 or p_fx<=0
     or p_price::text in ('NaN','Infinity') or p_fx::text in ('NaN','Infinity')
     or p_target is null or p_target<0 or p_target>0.8
     or p_bar is null or p_slot is null
     or p_slot<now()-interval '35 minutes' or p_slot>now()
     or p_bar<timezone('UTC',now())-interval '45 minutes'
     or p_bar>timezone('UTC',now()) then raise exception 'Invalid or stale decision'; end if;
  -- Blocks simultaneous edits of existing positions while computing shared cash.
  perform 1 from paper_portfolio where status='open' order by id for update;
  select * into p from paper_portfolio where id::text=p_id and status='open';
  if not found then raise exception 'Open paper program not found'; end if;
  if p.start is null or p.start<=0 or p.units is null or p.units<0 or p.allocated_ils is null then
    raise exception 'Invalid paper portfolio values';
  end if;
  mode:=coalesce(p.strategy_mode,p.plan);
  pv:=p.units*p_price*p_fx; actual:=pv/p.start;
  action:=case when mode is distinct from 'ai_dynamic' then 'HOLD'
               when p_target>actual+0.02 then 'BUY'
               when p_target<actual-0.02 then 'SELL' else 'HOLD' end;
  select count(distinct d.bar_time) into confirmed from paper_agent_decisions d
    where d.position_id=p_id and d.slot in (p_slot-interval '30 minutes',p_slot-interval '60 minutes')
      and d.action=decision.action and d.bar_time<p_bar
      and d.bar_time in (p_bar-interval '30 minutes',p_bar-interval '60 minutes');
  note:=case when mode is distinct from 'ai_dynamic' then 'מסלול קבוע — ללא ביצוע אוטומטי'
             when action='HOLD' then 'המתנה — אין שינוי נדרש'
             else 'ממתין ל־3 החלטות רצופות: '||(confirmed+1)::text||'/3' end;
  if action<>'HOLD' and confirmed=2 then
    select coalesce(sum(allocated_ils),0),max(start) into used,cap from paper_portfolio where status='open';
    available:=greatest(0,cap-used);
    desired:=p.start*p_target;
    if action='BUY' then desired:=least(desired,pv+available); end if;
    trade:=desired-pv;
    if abs(trade)>=100 then
      update paper_portfolio set units=desired/(p_price*p_fx),allocated_ils=p.allocated_ils+trade,
        allocated_usd=(p.allocated_ils+trade)/p_fx,updated_at=now() where id=p.id returning * into p;
      pv:=desired; actual:=pv/p.start;
      note:=case when trade>0 then 'קנייה וירטואלית ₪' else 'מכירה וירטואלית ₪' end||round(abs(trade))::text;
    else
      trade:=0;note:='המתנה — מזומן לא מספיק או שינוי קטן מ־₪100';
    end if;
  end if;
  result:=p_scores||jsonb_build_object('ai_action',note,'action',action,'trade_ils',trade,'actual_exposure',actual,'target_exposure',p_target);
  -- Position mutation, audit and chart snapshot commit together or all roll back.
  insert into portfolio_snapshots(snapshot_key,date,symbol,position_id,position_value,position_pnl,value,pnl,fx,
    score,market_price,auto,market_score,trend_score,risk_score,momentum_score,recommendation,plan,target_exposure,actual_exposure,ai_action)
  values('monitor-'||p_id||'-'||p_slot::text,p_bar::date,p.symbol,p_id,pv,pv-p.allocated_ils,pv,pv-p.allocated_ils,p_fx,
    (p_scores->>'master')::numeric,p_price,true,(p_scores->>'market')::numeric,(p_scores->>'trend')::numeric,
    (p_scores->>'risk')::numeric,(p_scores->>'momentum')::numeric,p_scores->>'signal',mode,p_target,actual,note);
  insert into paper_agent_decisions values(p_id,p_slot,p_bar,action,result);
  return result;
end $$;
revoke all on function public.apply_paper_decision(text,timestamptz,numeric,numeric,numeric,timestamp,jsonb) from public,anon,authenticated;
grant execute on function public.apply_paper_decision(text,timestamptz,numeric,numeric,numeric,timestamp,jsonb) to service_role;


-- Upgrade after 001-paper-agent.sql. Preserves existing positions and snapshots.
alter table public.paper_portfolio add column if not exists realized_pnl_ils numeric not null default 0;
alter table public.paper_portfolio add column if not exists closed_value_ils numeric;
alter table public.paper_portfolio add column if not exists closed_units numeric;
alter table public.paper_portfolio add column if not exists closed_market_price numeric;
alter table public.paper_portfolio add column if not exists closed_fx numeric;
alter table public.paper_portfolio add column if not exists predecessor_id text;
alter table public.paper_portfolio add column if not exists closed_at timestamptz;
create table if not exists public.paper_account_state(id integer primary key check(id=1),capital numeric not null check(capital>0));
insert into public.paper_account_state select 1,max(start) from public.paper_portfolio where status='open' having max(start)>0 on conflict(id) do nothing;
create table if not exists public.paper_account_snapshots(
 sequence_id bigint generated always as identity, snapshot_key text primary key,created_at timestamptz not null default now(),capital numeric not null,
 value numeric not null,pnl numeric not null,cash numeric not null,realized_pnl numeric not null,
 fx numeric not null,symbols text[] not null,marks jsonb not null,reason text not null
);
create table if not exists public.paper_rotation_scans(
 slot timestamptz primary key,bar_time timestamp not null,symbol text not null,score numeric not null,candidates jsonb not null
);
create table if not exists public.paper_cycle_runs(slot timestamptz primary key,result jsonb not null);
alter table public.paper_account_state enable row level security;
alter table public.paper_account_snapshots enable row level security;
alter table public.paper_rotation_scans enable row level security;
alter table public.paper_cycle_runs enable row level security;
revoke all on public.paper_account_state,public.paper_account_snapshots,public.paper_rotation_scans,public.paper_cycle_runs from anon,authenticated;
grant all on public.paper_account_state,public.paper_account_snapshots,public.paper_rotation_scans,public.paper_cycle_runs to service_role;

create or replace function public.paper_account_value(p_marks jsonb,p_fx numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cap numeric; realized numeric; used numeric; mv numeric; syms text[];
begin
 select capital into cap from paper_account_state where id=1;
 cap:=coalesce(cap,100000);
 select coalesce(sum(realized_pnl_ils),0) into realized from paper_portfolio where status='closed';
 select coalesce(sum(allocated_ils),0),coalesce(sum(units*coalesce((p_marks->symbol->>'price')::numeric,entry_price)*coalesce(p_fx,entry_fx)),0),coalesce(array_agg(symbol order by symbol),'{}')
 into used,mv,syms from paper_portfolio where status='open';
 return jsonb_build_object('capital',cap,'cash',cap+realized-used,'value',cap+realized-used+mv,'pnl',realized-used+mv,'realized_pnl',realized,'symbols',syms);
end $$;

create or replace function public.paper_record_account(p_key text,p_marks jsonb,p_fx numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb;
begin
 v:=paper_account_value(p_marks,p_fx);
 insert into paper_account_snapshots(snapshot_key,capital,value,pnl,cash,realized_pnl,fx,symbols,marks,reason)
 values(p_key,(v->>'capital')::numeric,(v->>'value')::numeric,(v->>'pnl')::numeric,(v->>'cash')::numeric,(v->>'realized_pnl')::numeric,p_fx,
 array(select jsonb_array_elements_text(v->'symbols')),p_marks,p_reason);
 return v;
end $$;

create or replace function public.paper_position_snapshot(p_id text,p_key text,p_quote jsonb,p_fx numeric,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare p paper_portfolio%rowtype; pv numeric;
begin
 select * into strict p from paper_portfolio where id::text=p_id;
 pv:=case when p.status='closed' then 0 else p.units*(p_quote->>'price')::numeric*p_fx end;
 insert into portfolio_snapshots(snapshot_key,date,symbol,position_id,position_value,position_pnl,value,pnl,fx,score,market_price,auto,market_score,trend_score,risk_score,momentum_score,recommendation,plan,ai_action)
 values(p_key,(p_quote->>'updated_at')::timestamp::date,p.symbol,p.id::text,pv,
 case when p.status='closed' then p.realized_pnl_ils else pv-p.allocated_ils end,pv,
 case when p.status='closed' then p.realized_pnl_ils else pv-p.allocated_ils end,
 p_fx,(p_quote->>'master')::numeric,(p_quote->>'price')::numeric,true,(p_quote->>'market')::numeric,(p_quote->>'trend')::numeric,
 (p_quote->>'risk')::numeric,(p_quote->>'momentum')::numeric,p_quote->>'signal',coalesce(p.strategy_mode,p.plan),p_note);
end $$;

-- Rebalance retains realized profits from earlier rotated positions.
create or replace function public.apply_paper_decision(
  p_id text, p_slot timestamptz, p_price numeric, p_fx numeric,
  p_target numeric, p_bar timestamp, p_scores jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
<<decision>>
declare
  p public.paper_portfolio%rowtype;
  previous jsonb; mode text; action text; note text;
  pv numeric; actual numeric; desired numeric; trade numeric:=0;
  used numeric; cap numeric; available numeric; confirmed integer;
  result jsonb;
begin
  -- Serialize the shared simulated cash pool, including concurrent scheduled invocations.
  perform pg_advisory_xact_lock(72416091);
  select d.result into previous from paper_agent_decisions d where d.position_id=p_id and d.slot=p_slot;
  if found then return previous; end if;
  if p_price is null or p_fx is null or p_price<=0 or p_fx<=0
     or p_price::text in ('NaN','Infinity') or p_fx::text in ('NaN','Infinity')
     or p_target is null or p_target<0 or p_target>0.8
     or p_bar is null or p_slot is null
     or p_slot<now()-interval '35 minutes' or p_slot>now()
     or p_bar<timezone('UTC',now())-interval '45 minutes'
     or p_bar>timezone('UTC',now()) then raise exception 'Invalid or stale decision'; end if;
  -- Blocks simultaneous edits of existing positions while computing shared cash.
  perform 1 from paper_portfolio where status='open' order by id for update;
  select * into p from paper_portfolio where id::text=p_id and status='open';
  if not found then raise exception 'Open paper program not found'; end if;
  if p.start is null or p.start<=0 or p.units is null or p.units<0 or p.allocated_ils is null then
    raise exception 'Invalid paper portfolio values';
  end if;
  mode:=coalesce(p.strategy_mode,p.plan);
  p_target:=case mode when 'balanced' then .5 when 'conservative' then .25 when 'growth' then .8 else p_target end;
  pv:=p.units*p_price*p_fx; actual:=pv/p.start;
  action:=case when mode is distinct from 'ai_dynamic' then 'HOLD'
               when p_target>actual+0.02 then 'BUY'
               when p_target<actual-0.02 then 'SELL' else 'HOLD' end;
  select count(distinct d.bar_time) into confirmed from paper_agent_decisions d
    where d.position_id=p_id and d.slot in (p_slot-interval '30 minutes',p_slot-interval '60 minutes')
      and d.action=decision.action and d.bar_time<p_bar
      and d.bar_time in (p_bar-interval '30 minutes',p_bar-interval '60 minutes');
  note:=case when mode is distinct from 'ai_dynamic' then 'מסלול קבוע — ללא ביצוע אוטומטי'
             when action='HOLD' then 'המתנה — אין שינוי נדרש'
             else 'ממתין ל־3 החלטות רצופות: '||(confirmed+1)::text||'/3' end;
  if action<>'HOLD' and confirmed=2 then
    select coalesce(sum(allocated_ils),0) into used from paper_portfolio where status='open';
    select capital into cap from paper_account_state where id=1;
    select cap+coalesce(sum(realized_pnl_ils),0) into cap from paper_portfolio where status='closed';
    available:=greatest(0,cap-used);
    desired:=p.start*p_target;
    if action='BUY' then desired:=least(desired,pv+available); end if;
    trade:=desired-pv;
    if abs(trade)>=100 then
      update paper_portfolio set units=desired/(p_price*p_fx),allocated_ils=p.allocated_ils+trade,
        allocated_usd=(p.allocated_ils+trade)/p_fx,updated_at=now() where id=p.id returning * into p;
      pv:=desired; actual:=pv/p.start;
      note:=case when trade>0 then 'קנייה וירטואלית ₪' else 'מכירה וירטואלית ₪' end||round(abs(trade))::text;
    else
      trade:=0;note:='המתנה — מזומן לא מספיק או שינוי קטן מ־₪100';
    end if;
  end if;
  result:=p_scores||jsonb_build_object('ai_action',note,'action',action,'trade_ils',trade,'actual_exposure',actual,'target_exposure',p_target);
  -- Position mutation, audit and chart snapshot commit together or all roll back.
  insert into portfolio_snapshots(snapshot_key,date,symbol,position_id,position_value,position_pnl,value,pnl,fx,
    score,market_price,auto,market_score,trend_score,risk_score,momentum_score,recommendation,plan,target_exposure,actual_exposure,ai_action)
  values('monitor-'||p_id||'-'||p_slot::text,p_bar::date,p.symbol,p_id,pv,pv-p.allocated_ils,pv,pv-p.allocated_ils,p_fx,
    (p_scores->>'master')::numeric,p_price,true,(p_scores->>'market')::numeric,(p_scores->>'trend')::numeric,
    (p_scores->>'risk')::numeric,(p_scores->>'momentum')::numeric,p_scores->>'signal',mode,p_target,actual,note);
  insert into paper_agent_decisions values(p_id,p_slot,p_bar,action,result);
  return result;
end $$;
revoke all on function public.apply_paper_decision(text,timestamptz,numeric,numeric,numeric,timestamp,jsonb) from public,anon,authenticated;
grant execute on function public.apply_paper_decision(text,timestamptz,numeric,numeric,numeric,timestamp,jsonb) to service_role;


create or replace function public.paper_validate_quotes(p_quotes jsonb,p_symbols text[],p_fx numeric)
returns void language plpgsql security definer set search_path=public as $$
declare sym text; q jsonb; n numeric; field text; ts timestamp;
begin
 if p_fx is null or p_fx<=0 or p_fx::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid FX'; end if;
 foreach sym in array p_symbols loop
   q:=p_quotes->sym;
   if q is null then raise exception 'Missing quote for %',sym; end if;
   n:=(q->>'price')::numeric;ts:=(q->>'updated_at')::timestamp;
   if n is null or n<=0 or n::text in ('NaN','Infinity','-Infinity') or ts is null
      or ts<timezone('UTC',now())-interval '45 minutes' or ts>timezone('UTC',now()) then
      raise exception 'Invalid or stale quote for %',sym;
   end if;
   foreach field in array array['master','market','trend','risk','momentum'] loop
     n:=(q->>field)::numeric;
     if n is null or n<0 or n>100 or n::text='NaN' then raise exception 'Invalid score for %',sym; end if;
   end loop;
 end loop;
end $$;

create or replace function public.apply_paper_cycle(p_slot timestamptz,p_fx numeric,p_quotes jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 universe text[]:=array['SPY','QQQ','DIA','IWM','AAPL','MSFT','NVDA','AMZN']; required text[];
 prior jsonb; top_symbol text; top_quote jsonb; top_bar timestamp; confirmations integer;
 p paper_portfolio%rowtype; old_p paper_portfolio%rowtype; new_p paper_portfolio%rowtype;
 q jsonb; account jsonb; amount numeric; sale numeric; desired numeric; exposure numeric;
 rotated_id text; rotation jsonb; scores jsonb:='{}'; answer jsonb; note text:='עדכון תיק אוטומטי';
begin
 perform pg_advisory_xact_lock(72416091);
 lock table paper_portfolio in share row exclusive mode;
 select result into prior from paper_cycle_runs where slot=p_slot;
 if found then return prior; end if;
 if p_slot is null or p_slot>now() or p_slot<now()-interval '35 minutes'
    or mod(extract(epoch from p_slot)::numeric,1800)<>0 then raise exception 'Invalid cycle slot'; end if;
 if exists(select 1 from paper_cycle_runs where slot>p_slot) then raise exception 'Out-of-order cycle'; end if;
 if not exists(select 1 from paper_portfolio where status='open') then return jsonb_build_object('symbols','[]'::jsonb,'scores','{}'::jsonb); end if;
 select array_agg(distinct sym) into required from (select unnest(universe) sym union select symbol from paper_portfolio where status='open') u;
 perform paper_validate_quotes(p_quotes,required,p_fx);
 insert into paper_account_state select 1,max(start) from paper_portfolio having max(start)>0 on conflict(id) do nothing;
 select sym into top_symbol from unnest(universe) sym order by (p_quotes->sym->>'master')::numeric desc,sym limit 1;
 top_quote:=p_quotes->top_symbol;top_bar:=(top_quote->>'updated_at')::timestamp;
 if exists(select 1 from unnest(universe) sym where (p_quotes->sym->>'updated_at')::timestamp<>top_bar) then raise exception 'Market bars are not synchronized'; end if;
 insert into paper_rotation_scans values(p_slot,top_bar,top_symbol,(top_quote->>'master')::numeric,p_quotes);
 select count(distinct bar_time) into confirmations from paper_rotation_scans
 where slot in (p_slot,p_slot-interval '30 minutes',p_slot-interval '60 minutes')
   and symbol=top_symbol and score>=60 and bar_time in (top_bar,top_bar-interval '30 minutes',top_bar-interval '60 minutes');
 if confirmations=3 and not exists(select 1 from paper_portfolio where status='open' and symbol=top_symbol) then
   -- Rotate at most the weakest dynamic program; fixed programs retain their asset.
   select * into old_p from paper_portfolio where status='open' and coalesce(strategy_mode,plan)='ai_dynamic'
     and (top_quote->>'master')::numeric-(p_quotes->symbol->>'master')::numeric>=10
   order by (p_quotes->symbol->>'master')::numeric,id limit 1;
   if found then
     q:=p_quotes->old_p.symbol;sale:=old_p.units*(q->>'price')::numeric*p_fx;
     exposure:=case when (top_quote->>'master')::numeric>=70 then .8 else .65 end;
     account:=paper_account_value(p_quotes,p_fx);
     amount:=least(old_p.start*exposure,greatest(0,(account->>'cash')::numeric+sale));
     if amount>=100 then
       perform paper_record_account('cycle-'||p_slot::text||'-before',p_quotes,p_fx,'לפני מעבר מ־'||old_p.symbol||' ל־'||top_symbol);
       update paper_portfolio set status='closed',units=0,closed_units=old_p.units,closed_value_ils=sale,
         closed_market_price=(q->>'price')::numeric,closed_fx=p_fx,realized_pnl_ils=sale-old_p.allocated_ils,
         closed_at=now(),updated_at=now() where id=old_p.id;
       perform paper_position_snapshot(old_p.id::text,'rotation-sell-'||p_slot::text,q,p_fx,
         'מכירה וירטואלית מלאה '||old_p.symbol||' · מעבר ל־'||top_symbol||' · ₪'||round(sale)::text);
       insert into paper_portfolio(symbol,start,allocated_ils,allocated_usd,entry_fx,entry_price,units,cash_ils,entry_date,plan,strategy_mode,status,updated_at,predecessor_id)
       values(top_symbol,old_p.start,amount,amount/p_fx,p_fx,(top_quote->>'price')::numeric,amount/((top_quote->>'price')::numeric*p_fx),0,
         top_bar::date,'ai_dynamic','ai_dynamic','open',now(),old_p.id::text) returning * into new_p;
       perform paper_position_snapshot(new_p.id::text,'rotation-buy-'||p_slot::text,top_quote,p_fx,
         'קנייה וירטואלית '||top_symbol||' · מעבר מ־'||old_p.symbol||' · ₪'||round(amount)::text);
       rotated_id:=new_p.id::text;note:='מעבר מ־'||old_p.symbol||' ל־'||top_symbol;
       rotation:=jsonb_build_object('from_id',old_p.id,'from_symbol',old_p.symbol,'to_id',new_p.id,'to_symbol',new_p.symbol,'sold_ils',sale,'bought_ils',amount,'realized_pnl',sale-old_p.allocated_ils);
       scores:=jsonb_build_object(top_symbol,top_quote||jsonb_build_object('ai_action',note,'action','BUY','target_exposure',exposure));
     end if;
   end if;
 end if;
 for p in select * from paper_portfolio where status='open' order by id loop
   if p.id::text is not distinct from rotated_id then continue; end if;
   q:=p_quotes->p.symbol;
   exposure:=case when (q->>'master')::numeric>=70 then .8 when (q->>'master')::numeric>=60 then .65 when (q->>'master')::numeric>=50 then .5 when (q->>'master')::numeric>=40 then .25 else 0 end;
   answer:=apply_paper_decision(p.id::text,p_slot,(q->>'price')::numeric,p_fx,exposure,(q->>'updated_at')::timestamp,q);
   scores:=scores||jsonb_build_object(p.symbol,answer);
 end loop;
 account:=paper_record_account('cycle-'||p_slot::text,p_quotes,p_fx,note);
 answer:=jsonb_build_object('symbols',account->'symbols','account',account,'rotation',rotation,'scores',scores,'leader',jsonb_build_object('symbol',top_symbol,'consecutive',confirmations,'verified',confirmations=3),'quotes',p_quotes);
 insert into paper_cycle_runs values(p_slot,answer);
 return answer;
end $$;

create or replace function public.paper_get_state() returns jsonb
language plpgsql security definer set search_path=public as $$
declare latest paper_account_snapshots%rowtype; account jsonb;
begin
 perform pg_advisory_xact_lock(72416091);
 select * into latest from paper_account_snapshots order by created_at desc,sequence_id desc limit 1;
 account:=paper_account_value(coalesce(latest.marks,'{}'),latest.fx)||jsonb_build_object('updated_at',latest.created_at,'marks',coalesce(latest.marks,'{}'),'fx',latest.fx,'initialized',exists(select 1 from paper_account_state));
 return jsonb_build_object('rows',coalesce((select jsonb_agg(p order by updated_at,id) from paper_portfolio p where status='open'),'[]'),
 'closed',coalesce((select jsonb_agg(p order by closed_at desc,id desc) from (select * from paper_portfolio where status='closed' and closed_value_ils is not null order by closed_at desc,id desc limit 100) p),'[]'),
 'account',account,'accountSnapshots',coalesce((select jsonb_agg(s order by created_at,sequence_id) from (select * from paper_account_snapshots order by created_at desc,sequence_id desc limit 730) s),'[]'),
 'snapshots',coalesce((select jsonb_agg(s order by created_at,id) from (select * from portfolio_snapshots where plan is distinct from 'scanner' order by created_at desc,id desc limit 730) s),'[]'),
 'rotation', (select result->'rotation' from paper_cycle_runs where result->'rotation' <> 'null'::jsonb order by slot desc limit 1));
end $$;
create or replace function public.manage_paper_portfolio(p_action text,p_body jsonb,p_quotes jsonb default '{}',p_fx numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p paper_portfolio%rowtype; cap numeric; amount numeric; sale numeric; mode text; sym text; q jsonb; required text[]; account jsonb; key text;
begin
 perform pg_advisory_xact_lock(72416091);
 lock table paper_portfolio in share row exclusive mode;
 key:='manual-'||gen_random_uuid()::text;
 if p_action='reset' then
   delete from paper_cycle_runs;delete from paper_rotation_scans;delete from paper_agent_decisions;
   delete from paper_account_snapshots;delete from portfolio_snapshots;delete from paper_portfolio;delete from paper_account_state;
   update agent_monitor_status set status='idle',checks=0,note='הסימולציה אופסה',updated_at=now(),checked_at=now() where id=1;
   return jsonb_build_object('ok',true);
 end if;
 if p_action='update_plan' then
   mode:=p_body->>'plan';
   if mode is null or mode not in ('ai_dynamic','balanced','growth','conservative') then raise exception 'Unknown plan'; end if;
   update paper_portfolio set strategy_mode=mode,updated_at=now() where id::text=p_body->>'id' and status='open';
   if not found then raise exception 'Open program not found'; end if;
   return jsonb_build_object('ok',true);
 end if;
 if p_action not in ('save_portfolio','close_portfolio','account_snapshot') then raise exception 'Unknown action'; end if;
 select coalesce(array_agg(symbol),'{}') into required from paper_portfolio where status='open';
 if p_action='save_portfolio' then
   sym:=upper(p_body->>'symbol');
   if sym is null or sym !~ '^[A-Z.\-]{1,12}$' then raise exception 'Invalid symbol'; end if;
   required:=array_append(required,sym);
 end if;
 perform paper_validate_quotes(p_quotes,required,p_fx);
 if p_action='save_portfolio' then
   if exists(select 1 from paper_portfolio where status='open' and symbol=sym) then raise exception 'Program already open for %',sym; end if;
   cap:=(p_body->>'start')::numeric;
   if cap is null or cap<1000 or cap::text in ('NaN','Infinity') then raise exception 'Invalid capital'; end if;
   insert into paper_account_state values(1,cap) on conflict(id) do nothing;
   select capital into cap from paper_account_state where id=1;
   mode:=p_body->>'plan';
   if mode is null or mode not in ('ai_dynamic','balanced','growth','conservative') then raise exception 'Unknown plan'; end if;
   amount:=cap*case mode when 'ai_dynamic' then 0 when 'conservative' then .25 when 'balanced' then .5 else .8 end;
   account:=paper_account_value(p_quotes,p_fx);
   if amount>(account->>'cash')::numeric then raise exception 'Not enough simulated cash'; end if;
   q:=p_quotes->sym;
   insert into paper_portfolio(symbol,start,allocated_ils,allocated_usd,entry_fx,entry_price,units,cash_ils,entry_date,plan,strategy_mode,status,updated_at)
   values(sym,cap,amount,amount/p_fx,p_fx,(q->>'price')::numeric,amount/((q->>'price')::numeric*p_fx),0,(q->>'updated_at')::timestamp::date,mode,mode,'open',now()) returning * into p;
   perform paper_position_snapshot(p.id::text,key,q,p_fx,case when mode='ai_dynamic' then 'תוכנית דינמית חדשה — ממתינה להחלטת סוכן' else 'פתיחת תוכנית נייר ידנית' end);
 elsif p_action='close_portfolio' then
   select * into p from paper_portfolio where id::text=p_body->>'id' and status='open';
   if not found then raise exception 'Open program not found'; end if;
   q:=p_quotes->p.symbol;sale:=p.units*(q->>'price')::numeric*p_fx;
   perform paper_record_account(key||'-before',p_quotes,p_fx,'לפני סגירת '||p.symbol);
   update paper_portfolio set status='closed',units=0,closed_units=p.units,closed_value_ils=sale,closed_market_price=(q->>'price')::numeric,
     closed_fx=p_fx,realized_pnl_ils=sale-p.allocated_ils,closed_at=now(),updated_at=now() where id=p.id;
   perform paper_position_snapshot(p.id::text,key,q,p_fx,'סגירה ידנית — מכירה וירטואלית מלאה ₪'||round(sale)::text);
 end if;
 account:=paper_record_account(key,p_quotes,p_fx,case p_action when 'save_portfolio' then 'פתיחת תוכנית '||sym when 'close_portfolio' then 'סגירת תוכנית '||p.symbol else 'צילום מצב תיק ידני' end);
 return jsonb_build_object('ok',true,'account',account);
end $$;

-- Only the server's service role can invoke these RPCs.
revoke all on function public.paper_account_value(jsonb,numeric),public.paper_record_account(text,jsonb,numeric,text),public.paper_position_snapshot(text,text,jsonb,numeric,text),public.paper_validate_quotes(jsonb,text[],numeric),public.apply_paper_cycle(timestamptz,numeric,jsonb),public.paper_get_state(),public.manage_paper_portfolio(text,jsonb,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.apply_paper_cycle(timestamptz,numeric,jsonb),public.paper_get_state(),public.manage_paper_portfolio(text,jsonb,jsonb,numeric) to service_role;

-- V6.1: read-only valuation fallback; does not reset or rewrite portfolios/history.
create or replace function public.paper_account_value(p_marks jsonb,p_fx numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cap numeric; realized numeric; used numeric; mv numeric; syms text[];
begin
 select capital into cap from paper_account_state where id=1;
 if cap is null then select max(start) into cap from paper_portfolio where status='open'; end if;
 cap:=coalesce(cap,100000);
 select coalesce(sum(realized_pnl_ils),0) into realized from paper_portfolio where status='closed';
 select coalesce(sum(allocated_ils),0),coalesce(sum(units*coalesce((p_marks->symbol->>'price')::numeric,entry_price)*coalesce((p_marks->symbol->>'fx')::numeric,p_fx,entry_fx)),0),coalesce(array_agg(symbol order by symbol),'{}')
 into used,mv,syms from paper_portfolio where status='open';
 return jsonb_build_object('capital',cap,'cash',cap+realized-used,'value',cap+realized-used+mv,'pnl',realized-used+mv,'realized_pnl',realized,'symbols',syms);
end $$;

create or replace function public.paper_get_state() returns jsonb
language plpgsql security definer set search_path=public as $$
declare latest paper_account_snapshots%rowtype; account jsonb; marks jsonb; valuation_source text; as_of timestamptz; has_new boolean;
begin
 perform pg_advisory_xact_lock(72416091);
 select * into latest from paper_account_snapshots order by created_at desc,sequence_id desc limit 1;
 has_new:=found;
 if has_new then marks:=latest.marks;as_of:=latest.created_at;valuation_source:='account_snapshot';
 else
   select coalesce(jsonb_object_agg(p.symbol,jsonb_build_object(
     'price',coalesce(h.market_price,p.entry_price),'fx',coalesce(h.fx,p.entry_fx),
     'updated_at',coalesce(h.created_at,h.date::timestamptz,p.entry_date::timestamptz),
     'source',case when h.snapshot_key is null then 'entry_price' else 'legacy_snapshot' end,
     'master',h.score,'market',h.market_score,'trend',h.trend_score,'risk',h.risk_score,'momentum',h.momentum_score,'signal',h.recommendation
   )),'{}'),max(coalesce(h.created_at,h.date::timestamptz,p.entry_date::timestamptz)),
   case when bool_or(h.snapshot_key is null) then 'entry_price' else 'legacy_snapshot' end
   into marks,as_of,valuation_source
   from paper_portfolio p left join lateral (
     select s.* from portfolio_snapshots s where s.plan is distinct from 'scanner'
       and (s.position_id=p.id::text or (s.position_id is null and s.symbol=p.symbol and s.date>=p.entry_date))
       and s.market_price>0 and s.fx>0 and s.market_price::text not in ('NaN','Infinity') and s.fx::text not in ('NaN','Infinity')
     order by s.date desc,s.created_at desc,s.id desc limit 1
   ) h on true where p.status='open';
 end if;
 account:=paper_account_value(marks,latest.fx)||jsonb_build_object('updated_at',as_of,'marks',marks,'fx',latest.fx,
   'initialized',exists(select 1 from paper_account_state) or exists(select 1 from paper_portfolio where status='open'),
   'estimated',not has_new,'valuation_source',valuation_source);
 return jsonb_build_object('schemaVersion','6.1','rows',coalesce((select jsonb_agg(p order by updated_at,id) from paper_portfolio p where status='open'),'[]'),
 'closed',coalesce((select jsonb_agg(p order by closed_at desc,id desc) from (select * from paper_portfolio where status='closed' and closed_value_ils is not null order by closed_at desc,id desc limit 100) p),'[]'),
 'account',account,'accountSnapshots',coalesce((select jsonb_agg(s order by created_at,sequence_id) from (select * from paper_account_snapshots order by created_at desc,sequence_id desc limit 730) s),'[]'),
 'snapshots',coalesce((select jsonb_agg(s order by created_at,id) from (select * from portfolio_snapshots where plan is distinct from 'scanner' order by created_at desc,id desc limit 730) s),'[]'),
 'rotation',(select result->'rotation' from paper_cycle_runs where result->'rotation' <> 'null'::jsonb order by slot desc limit 1));
end $$;
revoke all on function public.paper_account_value(jsonb,numeric),public.paper_get_state() from public,anon,authenticated;
grant execute on function public.paper_get_state() to service_role;

-- V6.2: independent per-program automatic rebalancing and stock rotation.
-- NULL flags inherit the previous behavior: AI dynamic on, fixed plans off.
-- No positions, units, cost basis or existing history are changed by this migration.
alter table public.paper_portfolio add column if not exists auto_rebalance boolean;
alter table public.paper_portfolio add column if not exists auto_rotate boolean;
alter table public.paper_portfolio add column if not exists settings_version bigint not null default 1;
alter table public.paper_portfolio add column if not exists automation_updated_at timestamptz;
create table if not exists public.paper_settings_history (
 id bigint generated always as identity primary key,position_id text not null,
 created_at timestamptz not null default now(),before_settings jsonb,after_settings jsonb not null
);
alter table public.paper_settings_history enable row level security;
revoke all on public.paper_settings_history from anon,authenticated;
grant select on public.paper_settings_history to service_role;

create or replace function public.paper_target_exposure(p_mode text,p_score numeric)
returns numeric language sql immutable as $$
 select case p_mode when 'conservative' then .25 when 'balanced' then .5 when 'growth' then .8
 when 'ai_dynamic' then case when p_score>=70 then .8 when p_score>=60 then .65 when p_score>=50 then .5 when p_score>=40 then .25 else 0 end
 else null end;
$$;

create or replace function public.apply_paper_decision(
  p_id text, p_slot timestamptz, p_price numeric, p_fx numeric,
  p_target numeric, p_bar timestamp, p_scores jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
<<decision>>
declare
  p public.paper_portfolio%rowtype;
  previous jsonb; mode text; action text; note text; enabled boolean;
  pv numeric; actual numeric; desired numeric; trade numeric:=0;
  used numeric; cap numeric; available numeric; confirmed integer;
  result jsonb;
begin
  -- Serialize the shared simulated cash pool, including concurrent scheduled invocations.
  perform pg_advisory_xact_lock(72416091);
  select d.result into previous from paper_agent_decisions d where d.position_id=p_id and d.slot=p_slot;
  if found then return previous; end if;
  if p_price is null or p_fx is null or p_price<=0 or p_fx<=0
     or p_price::text in ('NaN','Infinity') or p_fx::text in ('NaN','Infinity')
     or p_target is null or p_target<0 or p_target>0.8
     or p_bar is null or p_slot is null
     or p_slot<now()-interval '35 minutes' or p_slot>now()
     or p_bar<timezone('UTC',now())-interval '45 minutes'
     or p_bar>timezone('UTC',now()) then raise exception 'Invalid or stale decision'; end if;
  -- Blocks simultaneous edits of existing positions while computing shared cash.
  perform 1 from paper_portfolio where status='open' order by id for update;
  select * into p from paper_portfolio where id::text=p_id and status='open';
  if not found then raise exception 'Open paper program not found'; end if;
  if p.start is null or p.start<=0 or p.units is null or p.units<0 or p.allocated_ils is null then
    raise exception 'Invalid paper portfolio values';
  end if;
  mode:=coalesce(p.strategy_mode,p.plan);
  p_target:=paper_target_exposure(mode,(p_scores->>'master')::numeric);
  if p_target is null then raise exception 'Unknown plan'; end if;
  enabled:=coalesce(p.auto_rebalance,mode='ai_dynamic');
  pv:=p.units*p_price*p_fx; actual:=pv/p.start;
  action:=case when not enabled then 'HOLD'
               when p_target>actual+0.02 then 'BUY'
               when p_target<actual-0.02 then 'SELL' else 'HOLD' end;
  select count(distinct d.bar_time) into confirmed from paper_agent_decisions d
    where d.position_id=p_id and d.slot in (p_slot-interval '30 minutes',p_slot-interval '60 minutes')
      and d.action=decision.action and d.bar_time<p_bar
      and d.result->>'settings_version'=p.settings_version::text
      and d.bar_time in (p_bar-interval '30 minutes',p_bar-interval '60 minutes');
  note:=case when not enabled then 'איזון אוטומטי כבוי — ההחזקה נשמרת'
             when action='HOLD' then 'המתנה — אין שינוי נדרש'
             else 'ממתין ל־3 החלטות רצופות: '||(confirmed+1)::text||'/3' end;
  if action<>'HOLD' and confirmed=2 then
    select coalesce(sum(allocated_ils),0) into used from paper_portfolio where status='open';
    select capital into cap from paper_account_state where id=1;
    select cap+coalesce(sum(realized_pnl_ils),0) into cap from paper_portfolio where status='closed';
    available:=greatest(0,cap-used);
    desired:=p.start*p_target;
    if action='BUY' then desired:=least(desired,pv+available); end if;
    trade:=desired-pv;
    if abs(trade)>=100 then
      update paper_portfolio set units=desired/(p_price*p_fx),allocated_ils=p.allocated_ils+trade,
        allocated_usd=(p.allocated_ils+trade)/p_fx,updated_at=now() where id=p.id returning * into p;
      pv:=desired; actual:=pv/p.start;
      note:=case when trade>0 then 'קנייה וירטואלית ₪' else 'מכירה וירטואלית ₪' end||round(abs(trade))::text;
    else
      trade:=0;note:='המתנה — מזומן לא מספיק או שינוי קטן מ־₪100';
    end if;
  end if;
  result:=p_scores||jsonb_build_object('ai_action',note,'action',action,'trade_ils',trade,'actual_exposure',actual,'target_exposure',p_target,'settings_version',p.settings_version,'auto_rebalance',enabled,'auto_rotate',coalesce(p.auto_rotate,mode='ai_dynamic'),'plan',mode);
  -- Position mutation, audit and chart snapshot commit together or all roll back.
  insert into portfolio_snapshots(snapshot_key,date,symbol,position_id,position_value,position_pnl,value,pnl,fx,
    score,market_price,auto,market_score,trend_score,risk_score,momentum_score,recommendation,plan,target_exposure,actual_exposure,ai_action)
  values('monitor-'||p_id||'-'||p_slot::text,p_bar::date,p.symbol,p_id,pv,pv-p.allocated_ils,pv,pv-p.allocated_ils,p_fx,
    (p_scores->>'master')::numeric,p_price,true,(p_scores->>'market')::numeric,(p_scores->>'trend')::numeric,
    (p_scores->>'risk')::numeric,(p_scores->>'momentum')::numeric,p_scores->>'signal',mode,p_target,actual,note);
  insert into paper_agent_decisions values(p_id,p_slot,p_bar,action,result);
  return result;
end $$;

create or replace function public.apply_paper_cycle(p_slot timestamptz,p_fx numeric,p_quotes jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 universe text[]:=array['SPY','QQQ','DIA','IWM','AAPL','MSFT','NVDA','AMZN']; required text[];
 prior jsonb; top_symbol text; top_quote jsonb; top_bar timestamp; confirmations integer;
 p paper_portfolio%rowtype; old_p paper_portfolio%rowtype; new_p paper_portfolio%rowtype;
 q jsonb; account jsonb; amount numeric; sale numeric; desired numeric; exposure numeric;
 rotated_id text; rotation jsonb; scores jsonb:='{}'; answer jsonb; note text:='עדכון תיק אוטומטי';
begin
 perform pg_advisory_xact_lock(72416091);
 lock table paper_portfolio in share row exclusive mode;
 select result into prior from paper_cycle_runs where slot=p_slot;
 if found then return prior; end if;
 if p_slot is null or p_slot>now() or p_slot<now()-interval '35 minutes'
    or mod(extract(epoch from p_slot)::numeric,1800)<>0 then raise exception 'Invalid cycle slot'; end if;
 if exists(select 1 from paper_cycle_runs where slot>p_slot) then raise exception 'Out-of-order cycle'; end if;
 if not exists(select 1 from paper_portfolio where status='open') then return jsonb_build_object('symbols','[]'::jsonb,'scores','{}'::jsonb); end if;
 select array_agg(distinct sym) into required from (select unnest(universe) sym union select symbol from paper_portfolio where status='open') u;
 perform paper_validate_quotes(p_quotes,required,p_fx);
 insert into paper_account_state select 1,max(start) from paper_portfolio having max(start)>0 on conflict(id) do nothing;
 select sym into top_symbol from unnest(universe) sym order by (p_quotes->sym->>'master')::numeric desc,sym limit 1;
 top_quote:=p_quotes->top_symbol;top_bar:=(top_quote->>'updated_at')::timestamp;
 if exists(select 1 from unnest(universe) sym where (p_quotes->sym->>'updated_at')::timestamp<>top_bar) then raise exception 'Market bars are not synchronized'; end if;
 insert into paper_rotation_scans values(p_slot,top_bar,top_symbol,(top_quote->>'master')::numeric,p_quotes);
 select count(distinct bar_time) into confirmations from paper_rotation_scans
 where slot in (p_slot,p_slot-interval '30 minutes',p_slot-interval '60 minutes')
   and symbol=top_symbol and score>=60 and bar_time in (top_bar,top_bar-interval '30 minutes',top_bar-interval '60 minutes');
 if confirmations=3 and not exists(select 1 from paper_portfolio where status='open' and symbol=top_symbol) then
   -- Rotate at most one eligible program, preserving its plan and both controls.
   select * into old_p from paper_portfolio where status='open' and coalesce(auto_rotate,coalesce(strategy_mode,plan)='ai_dynamic')
     and (automation_updated_at is null or automation_updated_at<=p_slot-interval '60 minutes')
     and (top_quote->>'master')::numeric-(p_quotes->symbol->>'master')::numeric>=10
   order by (p_quotes->symbol->>'master')::numeric,id limit 1;
   if found then
     q:=p_quotes->old_p.symbol;sale:=old_p.units*(q->>'price')::numeric*p_fx;
     exposure:=paper_target_exposure(coalesce(old_p.strategy_mode,old_p.plan),(top_quote->>'master')::numeric);
     account:=paper_account_value(p_quotes,p_fx);
     amount:=least(old_p.start*exposure,greatest(0,(account->>'cash')::numeric+sale));
     if amount>=100 then
       perform paper_record_account('cycle-'||p_slot::text||'-before',p_quotes,p_fx,'לפני מעבר מ־'||old_p.symbol||' ל־'||top_symbol);
       update paper_portfolio set status='closed',units=0,closed_units=old_p.units,closed_value_ils=sale,
         closed_market_price=(q->>'price')::numeric,closed_fx=p_fx,realized_pnl_ils=sale-old_p.allocated_ils,
         closed_at=now(),updated_at=now() where id=old_p.id;
       perform paper_position_snapshot(old_p.id::text,'rotation-sell-'||p_slot::text,q,p_fx,
         'מכירה וירטואלית מלאה '||old_p.symbol||' · מעבר ל־'||top_symbol||' · ₪'||round(sale)::text);
       insert into paper_portfolio(symbol,start,allocated_ils,allocated_usd,entry_fx,entry_price,units,cash_ils,entry_date,plan,strategy_mode,status,updated_at,predecessor_id,auto_rebalance,auto_rotate,settings_version,automation_updated_at)
       values(top_symbol,old_p.start,amount,amount/p_fx,p_fx,(top_quote->>'price')::numeric,amount/((top_quote->>'price')::numeric*p_fx),0,
         top_bar::date,coalesce(old_p.strategy_mode,old_p.plan),coalesce(old_p.strategy_mode,old_p.plan),'open',now(),old_p.id::text,
         coalesce(old_p.auto_rebalance,coalesce(old_p.strategy_mode,old_p.plan)='ai_dynamic'),true,old_p.settings_version,old_p.automation_updated_at) returning * into new_p;
       perform paper_position_snapshot(new_p.id::text,'rotation-buy-'||p_slot::text,top_quote,p_fx,
         'קנייה וירטואלית '||top_symbol||' · מעבר מ־'||old_p.symbol||' · ₪'||round(amount)::text);
       rotated_id:=new_p.id::text;note:='מעבר מ־'||old_p.symbol||' ל־'||top_symbol;
       rotation:=jsonb_build_object('from_id',old_p.id,'from_symbol',old_p.symbol,'to_id',new_p.id,'to_symbol',new_p.symbol,'sold_ils',sale,'bought_ils',amount,'realized_pnl',sale-old_p.allocated_ils);
       scores:=jsonb_build_object(top_symbol,top_quote||jsonb_build_object('ai_action',note,'action','BUY','target_exposure',exposure,'plan',coalesce(new_p.strategy_mode,new_p.plan),'auto_rebalance',new_p.auto_rebalance,'auto_rotate',new_p.auto_rotate));
     end if;
   end if;
 end if;
 for p in select * from paper_portfolio where status='open' order by id loop
   if p.id::text is not distinct from rotated_id then continue; end if;
   q:=p_quotes->p.symbol;
   exposure:=case when (q->>'master')::numeric>=70 then .8 when (q->>'master')::numeric>=60 then .65 when (q->>'master')::numeric>=50 then .5 when (q->>'master')::numeric>=40 then .25 else 0 end;
   answer:=apply_paper_decision(p.id::text,p_slot,(q->>'price')::numeric,p_fx,exposure,(q->>'updated_at')::timestamp,q);
   scores:=scores||jsonb_build_object(p.symbol,answer);
 end loop;
 account:=paper_record_account('cycle-'||p_slot::text,p_quotes,p_fx,note);
 answer:=jsonb_build_object('symbols',account->'symbols','account',account,'rotation',rotation,'scores',scores,'leader',jsonb_build_object('symbol',top_symbol,'consecutive',confirmations,'verified',confirmations=3),'quotes',p_quotes);
 insert into paper_cycle_runs values(p_slot,answer);
 return answer;
end $$;

create or replace function public.manage_paper_portfolio(p_action text,p_body jsonb,p_quotes jsonb default '{}',p_fx numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p paper_portfolio%rowtype; cap numeric; amount numeric; sale numeric; mode text; sym text; q jsonb; required text[]; account jsonb; key text; rebalance boolean; rotate boolean; old_settings jsonb; new_settings jsonb; changed boolean;
begin
 perform pg_advisory_xact_lock(72416091);
 lock table paper_portfolio in share row exclusive mode;
 key:='manual-'||gen_random_uuid()::text;
 if p_action='reset' then
   delete from paper_settings_history;delete from paper_cycle_runs;delete from paper_rotation_scans;delete from paper_agent_decisions;
   delete from paper_account_snapshots;delete from portfolio_snapshots;delete from paper_portfolio;delete from paper_account_state;
   update agent_monitor_status set status='idle',checks=0,note='הסימולציה אופסה',updated_at=now(),checked_at=now() where id=1;
   return jsonb_build_object('ok',true);
 end if;
 if p_action in ('save_portfolio','update_plan') then
   if (p_body ? 'autoRebalance' and jsonb_typeof(p_body->'autoRebalance') is distinct from 'boolean')
      or (p_body ? 'autoRotate' and jsonb_typeof(p_body->'autoRotate') is distinct from 'boolean') then raise exception 'Automation settings must be boolean'; end if;
 end if;
 if p_action='update_plan' then
   mode:=p_body->>'plan';
   if mode is null or mode not in ('ai_dynamic','balanced','growth','conservative') then raise exception 'Unknown plan'; end if;
   select * into p from paper_portfolio where id::text=p_body->>'id' and status='open';
   if not found then raise exception 'Open program not found'; end if;
   rebalance:=coalesce((p_body->>'autoRebalance')::boolean,p.auto_rebalance,coalesce(p.strategy_mode,p.plan)='ai_dynamic');
   rotate:=coalesce((p_body->>'autoRotate')::boolean,p.auto_rotate,coalesce(p.strategy_mode,p.plan)='ai_dynamic');
   old_settings:=jsonb_build_object('plan',coalesce(p.strategy_mode,p.plan),'autoRebalance',coalesce(p.auto_rebalance,coalesce(p.strategy_mode,p.plan)='ai_dynamic'),'autoRotate',coalesce(p.auto_rotate,coalesce(p.strategy_mode,p.plan)='ai_dynamic'));
   new_settings:=jsonb_build_object('plan',mode,'autoRebalance',rebalance,'autoRotate',rotate);
   changed:=old_settings is distinct from new_settings;
   update paper_portfolio set strategy_mode=mode,auto_rebalance=rebalance,auto_rotate=rotate,updated_at=now(),
     settings_version=settings_version+case when changed then 1 else 0 end,
     automation_updated_at=case when changed then now() else automation_updated_at end where id=p.id;
   if changed then insert into paper_settings_history(position_id,before_settings,after_settings) values(p.id::text,old_settings,new_settings); end if;
   return jsonb_build_object('ok',true,'settings',new_settings);
 end if;
 if p_action not in ('save_portfolio','close_portfolio','account_snapshot') then raise exception 'Unknown action'; end if;
 select coalesce(array_agg(symbol),'{}') into required from paper_portfolio where status='open';
 if p_action='save_portfolio' then
   sym:=upper(p_body->>'symbol');
   if sym is null or sym !~ '^[A-Z.\-]{1,12}$' then raise exception 'Invalid symbol'; end if;
   required:=array_append(required,sym);
 end if;
 perform paper_validate_quotes(p_quotes,required,p_fx);
 if p_action='save_portfolio' then
   if exists(select 1 from paper_portfolio where status='open' and symbol=sym) then raise exception 'Program already open for %',sym; end if;
   cap:=(p_body->>'start')::numeric;
   if cap is null or cap<1000 or cap::text in ('NaN','Infinity') then raise exception 'Invalid capital'; end if;
   insert into paper_account_state values(1,cap) on conflict(id) do nothing;
   select capital into cap from paper_account_state where id=1;
   mode:=p_body->>'plan';
   if mode is null or mode not in ('ai_dynamic','balanced','growth','conservative') then raise exception 'Unknown plan'; end if;
   rebalance:=coalesce((p_body->>'autoRebalance')::boolean,mode='ai_dynamic');
   rotate:=coalesce((p_body->>'autoRotate')::boolean,mode='ai_dynamic');
   amount:=case when rebalance or rotate then 0 else cap*paper_target_exposure(mode,50) end;
   account:=paper_account_value(p_quotes,p_fx);
   if amount>(account->>'cash')::numeric then raise exception 'Not enough simulated cash'; end if;
   q:=p_quotes->sym;
   insert into paper_portfolio(symbol,start,allocated_ils,allocated_usd,entry_fx,entry_price,units,cash_ils,entry_date,plan,strategy_mode,status,updated_at,auto_rebalance,auto_rotate,automation_updated_at)
   values(sym,cap,amount,amount/p_fx,p_fx,(q->>'price')::numeric,amount/((q->>'price')::numeric*p_fx),0,(q->>'updated_at')::timestamp::date,mode,mode,'open',now(),rebalance,rotate,now()) returning * into p;
   perform paper_position_snapshot(p.id::text,key,q,p_fx,case when rebalance or rotate then 'תוכנית אוטומטית חדשה — ממתינה להחלטת סוכן' else 'פתיחת תוכנית נייר ידנית' end);
   insert into paper_settings_history(position_id,after_settings) values(p.id::text,jsonb_build_object('plan',mode,'autoRebalance',rebalance,'autoRotate',rotate));
 elsif p_action='close_portfolio' then
   select * into p from paper_portfolio where id::text=p_body->>'id' and status='open';
   if not found then raise exception 'Open program not found'; end if;
   q:=p_quotes->p.symbol;sale:=p.units*(q->>'price')::numeric*p_fx;
   perform paper_record_account(key||'-before',p_quotes,p_fx,'לפני סגירת '||p.symbol);
   update paper_portfolio set status='closed',units=0,closed_units=p.units,closed_value_ils=sale,closed_market_price=(q->>'price')::numeric,
     closed_fx=p_fx,realized_pnl_ils=sale-p.allocated_ils,closed_at=now(),updated_at=now() where id=p.id;
   perform paper_position_snapshot(p.id::text,key,q,p_fx,'סגירה ידנית — מכירה וירטואלית מלאה ₪'||round(sale)::text);
 end if;
 account:=paper_record_account(key,p_quotes,p_fx,case p_action when 'save_portfolio' then 'פתיחת תוכנית '||sym when 'close_portfolio' then 'סגירת תוכנית '||p.symbol else 'צילום מצב תיק ידני' end);
 return jsonb_build_object('ok',true,'account',account);
end $$;

create or replace function public.paper_get_state() returns jsonb
language plpgsql security definer set search_path=public as $$
declare latest paper_account_snapshots%rowtype; account jsonb; marks jsonb; valuation_source text; as_of timestamptz; has_new boolean;
begin
 perform pg_advisory_xact_lock(72416091);
 select * into latest from paper_account_snapshots order by created_at desc,sequence_id desc limit 1;
 has_new:=found;
 if has_new then marks:=latest.marks;as_of:=latest.created_at;valuation_source:='account_snapshot';
 else
   select coalesce(jsonb_object_agg(p.symbol,jsonb_build_object(
     'price',coalesce(h.market_price,p.entry_price),'fx',coalesce(h.fx,p.entry_fx),
     'updated_at',coalesce(h.created_at,h.date::timestamptz,p.entry_date::timestamptz),
     'source',case when h.snapshot_key is null then 'entry_price' else 'legacy_snapshot' end,
     'master',h.score,'market',h.market_score,'trend',h.trend_score,'risk',h.risk_score,'momentum',h.momentum_score,'signal',h.recommendation
   )),'{}'),max(coalesce(h.created_at,h.date::timestamptz,p.entry_date::timestamptz)),
   case when bool_or(h.snapshot_key is null) then 'entry_price' else 'legacy_snapshot' end
   into marks,as_of,valuation_source
   from paper_portfolio p left join lateral (
     select s.* from portfolio_snapshots s where s.plan is distinct from 'scanner'
       and (s.position_id=p.id::text or (s.position_id is null and s.symbol=p.symbol and s.date>=p.entry_date))
       and s.market_price>0 and s.fx>0 and s.market_price::text not in ('NaN','Infinity') and s.fx::text not in ('NaN','Infinity')
     order by s.date desc,s.created_at desc,s.id desc limit 1
   ) h on true where p.status='open';
 end if;
 account:=paper_account_value(marks,latest.fx)||jsonb_build_object('updated_at',as_of,'marks',marks,'fx',latest.fx,
   'initialized',exists(select 1 from paper_account_state) or exists(select 1 from paper_portfolio where status='open'),
   'estimated',not has_new,'valuation_source',valuation_source);
 return jsonb_build_object('schemaVersion','6.2','capabilities',jsonb_build_object('automationSettings',true),'rows',coalesce((select jsonb_agg(p order by updated_at,id) from paper_portfolio p where status='open'),'[]'),
 'closed',coalesce((select jsonb_agg(p order by closed_at desc,id desc) from (select * from paper_portfolio where status='closed' and closed_value_ils is not null order by closed_at desc,id desc limit 100) p),'[]'),
 'account',account,'accountSnapshots',coalesce((select jsonb_agg(s order by created_at,sequence_id) from (select * from paper_account_snapshots order by created_at desc,sequence_id desc limit 730) s),'[]'),
 'snapshots',coalesce((select jsonb_agg(s order by created_at,id) from (select * from portfolio_snapshots where plan is distinct from 'scanner' order by created_at desc,id desc limit 730) s),'[]'),
 'rotation',(select result->'rotation' from paper_cycle_runs where result->'rotation' <> 'null'::jsonb order by slot desc limit 1));
end $$;

revoke all on function public.paper_target_exposure(text,numeric),public.apply_paper_decision(text,timestamptz,numeric,numeric,numeric,timestamp,jsonb),public.apply_paper_cycle(timestamptz,numeric,jsonb),public.manage_paper_portfolio(text,jsonb,jsonb,numeric),public.paper_get_state() from public,anon,authenticated;
grant execute on function public.apply_paper_decision(text,timestamptz,numeric,numeric,numeric,timestamp,jsonb),public.apply_paper_cycle(timestamptz,numeric,jsonb),public.manage_paper_portfolio(text,jsonb,jsonb,numeric),public.paper_get_state() to service_role;

-- Shared provider budget. No portfolio balances or history are changed.
create table if not exists paper_market_cache(key text primary key,payload jsonb,expires_at timestamptz not null,lease_until timestamptz);
create table if not exists paper_api_requests(id bigint generated always as identity primary key,created_at timestamptz not null default clock_timestamp());
alter table paper_market_cache enable row level security;
alter table paper_api_requests enable row level security;
grant all on paper_market_cache,paper_api_requests to service_role;
grant usage,select on sequence paper_api_requests_id_seq to service_role;
create or replace function paper_market_reserve(p_key text) returns jsonb language plpgsql security definer set search_path=public as $$
declare c paper_market_cache; n integer;
begin
 perform pg_advisory_xact_lock(72416092);
 select * into c from paper_market_cache where key=p_key;
 if c.payload is not null and c.expires_at>clock_timestamp() then return jsonb_build_object('state','cached','payload',c.payload); end if;
 if c.lease_until>clock_timestamp() then return jsonb_build_object('state','waiting'); end if;
 delete from paper_market_cache where expires_at<clock_timestamp()-interval '2 days' and (lease_until is null or lease_until<clock_timestamp());
 delete from paper_api_requests where created_at<clock_timestamp()-interval '2 minutes';
 select count(*) into n from paper_api_requests where created_at>clock_timestamp()-interval '65 seconds';
 if n>=8 then return jsonb_build_object('state','limited'); end if;
 insert into paper_api_requests default values;
 insert into paper_market_cache(key,expires_at,lease_until) values(p_key,clock_timestamp(),clock_timestamp()+interval '15 seconds') on conflict(key) do update set lease_until=excluded.lease_until;
 return jsonb_build_object('state','fetch');
end $$;
revoke all on function paper_market_reserve(text) from public,anon,authenticated;
grant execute on function paper_market_reserve(text) to service_role;

COMMIT;
