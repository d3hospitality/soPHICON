-- Waitlist for two products that don't exist yet:
--   paint-me : "Paint me into the canon" — your portrait in the house style
--   summon   : "Summon a philosopher"   — crowdfund a missing thinker
--
-- Two tables, both service-role only (RLS on, no policies; the API writes):
--   waitlist_taps    every view / tap / join, anonymous allowed — the demand signal
--   waitlist_signups one row per (feature, user) — the people to email at launch
--
-- No IPs are stored. visitor is an HMAC of ip+day made in the API, so we can
-- count unique tappers per day without being able to recover the address.

create table if not exists public.waitlist_taps (
  id          bigserial primary key,
  feature     text not null check (feature in ('paint-me', 'summon')),
  action      text not null check (action in ('view', 'tap', 'join')),
  surface     text not null check (surface in ('g2', 'web', 'ios', 'android')),
  src         text check (char_length(src) <= 40),
  visitor     text check (char_length(visitor) <= 32),
  signed_in   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists waitlist_taps_feature_created on public.waitlist_taps (feature, created_at);

create table if not exists public.waitlist_signups (
  feature      text not null check (feature in ('paint-me', 'summon')),
  user_id      uuid not null references auth.users (id) on delete cascade,
  surface      text not null check (surface in ('g2', 'web', 'ios', 'android')),
  philosopher  text check (char_length(philosopher) <= 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (feature, user_id)
);

alter table public.waitlist_taps    enable row level security;
alter table public.waitlist_signups enable row level security;
revoke all on public.waitlist_taps, public.waitlist_signups from anon, authenticated;
revoke all on sequence public.waitlist_taps_id_seq from anon, authenticated;

-- The two-week readout. security_invoker so it inherits the tables' lockdown.
create or replace view public.waitlist_summary with (security_invoker = true) as
select
  t.feature,
  count(*) filter (where t.action = 'view')                              as views,
  count(*) filter (where t.action = 'tap')                               as taps,
  count(distinct t.visitor) filter (where t.action = 'tap')              as unique_tappers,
  (select count(*) from public.waitlist_signups s where s.feature = t.feature) as signups,
  min(t.created_at)                                                      as first_seen
from public.waitlist_taps t
group by t.feature;
revoke all on public.waitlist_summary from anon, authenticated;
