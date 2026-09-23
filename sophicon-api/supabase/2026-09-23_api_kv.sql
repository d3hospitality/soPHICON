-- ═══════════════════════════════════════════════════════════════════
-- api_kv — quota counters + small server state for sophicon-api.
-- Replaces the dead Vercel KV store (host no longer resolves).
-- Additive only: one new table, two functions. Nothing existing changes.
--
-- Access: service_role only (the API). RLS on with no policies, and
-- execute revoked from anon/authenticated, so no client can read or
-- bump a counter.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.api_kv (
  key        text primary key,
  count      bigint      not null default 0,
  value      jsonb,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists api_kv_expires_at_idx on public.api_kv (expires_at);

alter table public.api_kv enable row level security;
revoke all on public.api_kv from anon, authenticated;

-- Atomic increment with TTL. Expired rows restart at 1.
-- ~1% of calls also sweep rows expired for over a day (no cron needed).
create or replace function public.api_kv_incr(p_key text, p_ttl_seconds int default 86400)
returns bigint
language plpgsql
set search_path = public
as $$
declare v bigint;
begin
  insert into api_kv as k (key, count, expires_at, updated_at)
  values (p_key, 1, now() + make_interval(secs => p_ttl_seconds), now())
  on conflict (key) do update set
    count      = case when k.expires_at is not null and k.expires_at <= now() then 1 else k.count + 1 end,
    expires_at = case when k.expires_at is not null and k.expires_at <= now()
                      then now() + make_interval(secs => p_ttl_seconds) else k.expires_at end,
    updated_at = now()
  returning count into v;

  if random() < 0.01 then
    delete from api_kv where expires_at < now() - interval '1 day';
  end if;
  return v;
end $$;

create or replace function public.api_kv_expire(p_key text, p_ttl_seconds int)
returns void
language sql
set search_path = public
as $$
  update api_kv set expires_at = now() + make_interval(secs => p_ttl_seconds), updated_at = now()
  where key = p_key;
$$;

revoke execute on function public.api_kv_incr(text, int)   from public, anon, authenticated;
revoke execute on function public.api_kv_expire(text, int) from public, anon, authenticated;
grant  execute on function public.api_kv_incr(text, int)   to service_role;
grant  execute on function public.api_kv_expire(text, int) to service_role;
grant  select, insert, update, delete on public.api_kv     to service_role;
