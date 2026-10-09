-- Run after 001..005. No existing position is assigned a guessed initial peak.
alter table public.paper_portfolio add column if not exists wyckoff_trade jsonb;
create table if not exists public.paper_wyckoff_patterns(symbol text not null,pattern_id text not null,created_at timestamptz not null default now(),primary key(symbol,pattern_id));
alter table public.paper_wyckoff_patterns enable row level security;
revoke all on public.paper_wyckoff_patterns from public,anon,authenticated;
grant select on public.paper_wyckoff_patterns to service_role;

create or replace function public.apply_paper_decision(p_id text,p_slot timestamptz,p_price numeric,p_fx numeric,p_target numeric,p_bar timestamp,p_scores jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p paper_portfolio%rowtype; prior jsonb; w jsonb; result jsonb; account jsonb; amount numeric; sale numeric; target_price numeric; stop_price numeric; initial_peak numeric; pattern text; mode text; action text:='HOLD'; note text:='וויקוף יומי: ממתין לתבנית'; n paper_portfolio%rowtype;
begin
 perform pg_advisory_xact_lock(72416091);
 select d.result into prior from paper_agent_decisions d where d.position_id=p_id and d.slot=p_slot;
 if found then return prior; end if;
 perform 1 from paper_portfolio where status='open' order by id for update;
 select * into strict p from paper_portfolio where id::text=p_id and status='open';
 perform paper_validate_quotes(jsonb_build_object(p.symbol,p_scores),array[p.symbol],p_fx);
 if p_price is null or p_price<=0 or p_price::text in ('NaN','Infinity','-Infinity') or p_price is distinct from (p_scores->>'price')::numeric
    or (p_scores->>'updated_at')::timestamp < (now() at time zone 'UTC')-interval '90 seconds'
    or p_slot is null or p_slot>now() or p_slot<now()-interval '35 minutes' then raise exception 'Invalid Wyckoff decision'; end if;
 mode:=coalesce(p.strategy_mode,p.plan);w:=p_scores->'wyckoff';
 if p.units>0 then
   if p.wyckoff_trade is null then note:='החזקה קודמת ללא שיא ראשוני מתועד — נדרש בירור';
   else
     target_price:=(p.wyckoff_trade->>'targetPrice')::numeric;stop_price:=(p.wyckoff_trade->>'stopPrice')::numeric;
     if target_price is null or stop_price is null or target_price<=0 or stop_price<=0 then raise exception 'Invalid saved Wyckoff levels'; end if;
     if p_price>=target_price or p_price<=stop_price then
       action:='SELL';note:=case when p_price<=stop_price then 'WYCKOFF_STOP_LOSS' else 'WYCKOFF_TARGET_7_ABOVE_INITIAL_PEAK' end;
       sale:=p.units*p_price*p_fx;
       update paper_portfolio set status='closed',closed_units=units,units=0,closed_value_ils=sale,closed_market_price=p_price,closed_fx=p_fx,realized_pnl_ils=sale-allocated_ils,closed_at=now(),updated_at=now() where id=p.id;
       -- Keep the selected program alive, but wait for a NEW pattern before investing again.
       insert into paper_portfolio(symbol,start,allocated_ils,allocated_usd,entry_fx,entry_price,units,cash_ils,entry_date,plan,strategy_mode,status,updated_at,predecessor_id,auto_rebalance,auto_rotate,settings_version)
       values(p.symbol,p.start,0,0,p_fx,p_price,0,0,p_bar::date,p.plan,p.strategy_mode,'open',now(),p.id,true,false,p.settings_version) returning * into n;
     end if;
   end if;
 elsif p_scores->>'timeframe'='1d' and w->>'timeframe'='1d' and coalesce((w->>'buyConfirmed')::boolean,false) then
   initial_peak:=(w->'initialPeak'->>'price')::numeric;pattern:=w->>'patternId';target_price:=initial_peak*1.07;
   if initial_peak is null or initial_peak<=0 or pattern is null or length(pattern)>160 or (w->'firstLow'->>'price')::numeric is null
      or p_price<=(w->'firstLow'->>'price')::numeric or p_price>=target_price
      or (w->'springLow'->>'price')::numeric is null
      or (w->'springLow'->>'price')::numeric >= (w->'firstLow'->>'price')::numeric
      or coalesce((w->>'consolidationBars')::integer,0)<3 then raise exception 'Invalid Wyckoff entry'; end if;
   if exists(select 1 from paper_wyckoff_patterns where symbol=p.symbol and pattern_id=pattern) then note:='התבנית כבר בוצעה';
   else
     account:=paper_account_value(jsonb_build_object(p.symbol,p_scores),p_fx);
     amount:=least(p.start*case mode when 'conservative' then .25 when 'balanced' then .5 else .8 end,greatest(0,(account->>'cash')::numeric));
     if amount>=100 then
       action:='BUY';note:='WYCKOFF_RECLAIM';stop_price:=p_price*.94;
       update paper_portfolio set units=amount/(p_price*p_fx),allocated_ils=amount,allocated_usd=amount/p_fx,entry_price=p_price,entry_fx=p_fx,entry_date=p_bar::date,updated_at=now(),
         wyckoff_trade=jsonb_build_object('strategyId','WYCKOFF_D1_V1','patternId',pattern,'initialPeak',initial_peak,'targetPrice',target_price,'firstLow',(w->'firstLow'->>'price')::numeric,'springLow',(w->'springLow'->>'price')::numeric,'stopLossPct',6,'stopPrice',stop_price) where id=p.id;
       insert into paper_wyckoff_patterns(symbol,pattern_id) values(p.symbol,pattern);
     else note:='אין מזומן מספיק במסגרת התקציב'; end if;
   end if;
 end if;
 result:=p_scores||jsonb_build_object('action',action,'ai_action',note,'strategyId','WYCKOFF_D1_V1');
 perform paper_position_snapshot(p_id,'wyckoff-'||p_id||'-'||p_slot::text,p_scores,p_fx,note);
 insert into paper_agent_decisions(position_id,slot,bar_time,action,result) values(p_id,p_slot,p_bar,action,result);
 return result;
end $$;

create or replace function public.apply_paper_cycle(p_slot timestamptz,p_fx numeric,p_quotes jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior jsonb; p paper_portfolio%rowtype; q jsonb; scores jsonb:='{}'; result jsonb; account jsonb; symbols text[];
begin
 perform pg_advisory_xact_lock(72416091);
 lock table paper_portfolio in share row exclusive mode;
 select r.result into prior from paper_cycle_runs r where r.slot=p_slot;
 if found then return prior; end if;
 select coalesce(array_agg(distinct symbol),'{}') into symbols from paper_portfolio where status='open';
 perform paper_validate_quotes(p_quotes,symbols,p_fx);
 for p in select * from paper_portfolio where status='open' order by id loop
   q:=p_quotes->p.symbol;
   scores:=scores||jsonb_build_object(p.symbol,apply_paper_decision(p.id::text,p_slot,(q->>'price')::numeric,p_fx,0,(q->>'updated_at')::timestamp,q));
 end loop;
 account:=paper_record_account('wyckoff-cycle-'||p_slot::text,p_quotes,p_fx,'וויקוף יומי · יעד שיא +7% · עצירה 6%');
 result:=jsonb_build_object('symbols',account->'symbols','account',account,'scores',scores,'quotes',p_quotes,'rotation',null);
 insert into paper_cycle_runs(slot,result) values(p_slot,result);
 return result;
end $$;

-- Wrap the old manual management endpoint so opening a program never bypasses the strategy.
do $$ begin
 if to_regprocedure('public.manage_paper_portfolio_legacy(text,jsonb,jsonb,numeric)') is null then
   alter function public.manage_paper_portfolio(text,jsonb,jsonb,numeric) rename to manage_paper_portfolio_legacy;
 end if;
end $$;
create or replace function public.manage_paper_portfolio(p_action text,p_body jsonb,p_quotes jsonb default '{}',p_fx numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if p_action='save_portfolio' then p_body:=p_body||jsonb_build_object('autoRebalance',true,'autoRotate',false);end if;
 if p_action='reset' then delete from paper_wyckoff_patterns;end if;
 return manage_paper_portfolio_legacy(p_action,p_body,p_quotes,p_fx);
end $$;
revoke all on function public.manage_paper_portfolio_legacy(text,jsonb,jsonb,numeric) from public,anon,authenticated,service_role;
revoke all on function public.apply_paper_decision(text,timestamptz,numeric,numeric,numeric,timestamp,jsonb),public.apply_paper_cycle(timestamptz,numeric,jsonb),public.manage_paper_portfolio(text,jsonb,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.apply_paper_decision(text,timestamptz,numeric,numeric,numeric,timestamp,jsonb),public.apply_paper_cycle(timestamptz,numeric,jsonb),public.manage_paper_portfolio(text,jsonb,jsonb,numeric) to service_role;
