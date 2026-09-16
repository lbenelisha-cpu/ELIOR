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
