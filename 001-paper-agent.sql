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

