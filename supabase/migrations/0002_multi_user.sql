-- Skip Planner on Supabase: accounts (name + PIN) and one versioned planner per person.
-- Run once in the Supabase SQL editor (SQL Editor > New query > paste > Run). Safe to run again.

create table if not exists public.users (
  key text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(key) between 2 and 24),
  name text not null check (length(name) between 1 and 40),
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

-- One row per saved version of a person's planner. The primary key makes "save as
-- version n+1" succeed for exactly one writer; the app keeps the last 200 versions.
create table if not exists public.planner_versions (
  user_key text not null references public.users (key) on delete cascade,
  version bigint not null check (version >= 1),
  state text not null,
  created_at timestamptz not null default now(),
  primary key (user_key, version)
);

-- Only the server (secret / service-role key) may touch these tables. RLS with no
-- policies denies the anon and authenticated roles; the grants are revoked too.
alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.planner_versions enable row level security;
alter table public.planner_versions force row level security;
revoke all on table public.users from anon, authenticated;
revoke all on table public.planner_versions from anon, authenticated;

-- With "automatically expose new tables" off, new tables have no grants at all, so the
-- server's role needs its own. service_role bypasses RLS; nothing else gets access.
grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.planner_versions to service_role;
