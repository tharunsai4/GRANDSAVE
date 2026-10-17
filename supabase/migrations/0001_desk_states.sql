-- Run once in the Supabase SQL Editor for your project.
-- The application uses the signed-in user's session and a public/publishable key.
-- No service-role key is required or permitted in the application.
begin;

create table public.desk_states (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

alter table public.desk_states enable row level security;
alter table public.desk_states force row level security;

-- Remove default table privileges, then allow only what the desk needs.
revoke all on public.desk_states from public, anon, authenticated;
grant select, insert, update on public.desk_states to authenticated;

create policy "Owners can read their desk"
  on public.desk_states for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Owners can create their desk"
  on public.desk_states for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Owners can update their desk"
  on public.desk_states for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

commit;
