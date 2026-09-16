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
