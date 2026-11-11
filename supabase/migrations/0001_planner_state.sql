-- Skip Planner: one row holding the whole planner state.
-- Run once in the Supabase SQL editor (or with `supabase db push`).

create table if not exists public.planner_state (
  id uuid primary key,
  state jsonb not null,
  version bigint not null check (version >= 1),
  updated_at timestamptz not null default now(),
  -- Single-user app: only this one id is allowed, so there can never be a second row.
  constraint planner_state_singleton check (id = '00000000-0000-0000-0000-000000000001'::uuid),
  -- The state must at least be an object with settings and marks; the API validates the rest.
  constraint planner_state_shape check (
    jsonb_typeof(state) = 'object'
    and jsonb_typeof(state -> 'settings') = 'object'
    and jsonb_typeof(state -> 'marks') = 'object'
  )
);

-- Every update must move the version forward by exactly one, and stamps updated_at.
-- This backs up the API's optimistic concurrency check at the database level.
create or replace function public.planner_state_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'planner_state id cannot change';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'planner_state version must increase by 1 (was %, got %)', old.version, new.version;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists planner_state_before_update on public.planner_state;
create trigger planner_state_before_update
  before update on public.planner_state
  for each row execute function public.planner_state_before_update();

-- Lock the table away from the public API. Row Level Security with no policies
-- denies the anon and authenticated roles everything; the service-role key used
-- by the Next.js API routes bypasses RLS. The grants are revoked as a second layer.
alter table public.planner_state enable row level security;
alter table public.planner_state force row level security;
revoke all on table public.planner_state from anon, authenticated;
revoke all on function public.planner_state_before_update() from anon, authenticated, public;
