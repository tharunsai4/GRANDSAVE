-- Run manually in Supabase SQL Editor AFTER both migrations.
-- First create your owner email/password account in Authentication > Users.
-- Replace YOUR_OWNER_EMAIL below with the exact existing owner Auth email.
-- Customer accounts are created from the owner's Customers screen afterwards.
begin;
do $$
declare
  v_email text := lower(btrim('YOUR_OWNER_EMAIL'));
  v_user uuid;
  v_confirmed timestamptz;
  v_matches integer;
begin
  if v_email = 'your_owner_email' or v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Replace YOUR_OWNER_EMAIL with the owner account email before running this script';
  end if;
  if v_email like '%@customers.grandsave.invalid' then
    raise exception 'Use a real owner email, not a customer access-key account';
  end if;
  select count(*) into v_matches from auth.users u where lower(btrim(u.email)) = v_email;
  if v_matches <> 1 then raise exception 'Expected exactly one Auth user matching the owner email; create or correct the owner account first'; end if;
  select u.id,u.email_confirmed_at into v_user,v_confirmed from auth.users u where lower(btrim(u.email)) = v_email;
  if v_confirmed is null then raise exception 'Confirm the owner Auth user in Supabase before granting owner access'; end if;
  if exists (select 1 from private.wholesale_owners o where o.user_id <> v_user) then
    raise exception 'A different owner is already configured. Review the existing owner before changing access';
  end if;
  if not exists (select 1 from public.wholesale_customers c where c.id = v_user) then
    raise exception 'Owner profile is missing. Run the wholesale portal migration first';
  end if;
  insert into private.wholesale_owners (user_id) values (v_user) on conflict (user_id) do nothing;
  update public.wholesale_customers set approved = true where id = v_user;
  raise notice 'Owner access enabled for % (%)', v_email, v_user;
end;
$$;
commit;
