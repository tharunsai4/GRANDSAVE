-- Run after 0001_desk_states.sql. Existing desk_states data is preserved.
-- Owner authority is provisioned separately with supabase/OWNER-SETUP.sql.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.wholesale_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table private.wholesale_owners enable row level security;
alter table private.wholesale_owners force row level security;
revoke all on private.wholesale_owners from public, anon, authenticated;

create table public.wholesale_settings (
  id boolean primary key default true check (id),
  business_name text not null default 'GrandSave' check (char_length(btrim(business_name)) between 1 and 200),
  contact_name text not null default '' check (char_length(contact_name) <= 200),
  email text not null default '' check (char_length(email) <= 254),
  phone text not null default '' check (char_length(phone) <= 80),
  require_customer_approval boolean not null default false
);
insert into public.wholesale_settings (id) values (true);

create table public.wholesale_customers (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 200),
  business_name text not null default '' check (char_length(business_name) <= 200),
  email text not null default '' check (char_length(email) <= 254),
  phone text not null default '' check (char_length(phone) <= 80),
  address text not null default '' check (char_length(address) <= 1000),
  access_key text unique check (access_key is null or access_key ~ '^[a-z0-9][a-z0-9_-]{3,39}$'),
  access_enabled boolean not null default false,
  approved boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not access_enabled or access_key is not null)
);

create table public.wholesale_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(btrim(code)) between 1 and 80),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text not null default '' check (char_length(category) <= 120),
  pack text not null default '' check (char_length(pack) <= 160),
  units integer not null default 1 check (units between 1 and 1000000),
  price numeric(12,2) not null check (price >= 0 and price <> 'NaN'::numeric),
  rrp numeric(12,2) not null default 0 check (rrp >= 0 and rrp <> 'NaN'::numeric),
  image text not null default '' check (char_length(image) <= 5000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wholesale_offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.wholesale_products(id) on delete restrict,
  price numeric(12,2) not null check (price > 0 and price <> 'NaN'::numeric),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index wholesale_offers_product_dates_idx on public.wholesale_offers (product_id, starts_at, ends_at);

create table public.wholesale_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_id uuid not null references public.wholesale_customers(id) on delete restrict,
  request_id uuid,
  date date not null default current_date,
  status text not null default 'Placed' check (status in ('Draft','Placed','Confirmed','Packing','Completed','Cancelled')),
  notes text not null default '' check (char_length(notes) <= 4000),
  total numeric(20,2) not null default 0 check (total >= 0 and total <> 'NaN'::numeric),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, request_id)
);
create index wholesale_orders_customer_created_idx on public.wholesale_orders (customer_id, created_at desc);

create table public.wholesale_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.wholesale_orders(id) on delete cascade,
  product_id uuid not null references public.wholesale_products(id) on delete restrict,
  name text not null,
  code text not null,
  pack text not null,
  quantity integer not null check (quantity between 1 and 9999),
  unit_price numeric(12,2) not null check (unit_price >= 0 and unit_price <> 'NaN'::numeric),
  unique (order_id, product_id)
);
create index wholesale_order_items_order_idx on public.wholesale_order_items (order_id);

create table public.wholesale_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.wholesale_orders(id) on delete restrict,
  amount numeric(20,2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  date date not null default current_date,
  method text not null check (char_length(btrim(method)) between 1 and 100),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index wholesale_payments_order_idx on public.wholesale_payments (order_id);

-- This trigger accepts contact information only. Auth metadata can never
-- enable an account, assign a key, approve it, or grant owner privileges.
create function private.wholesale_sync_customer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_contact_email text;
  v_approved boolean;
begin
  if new.email ilike '%@customers.grandsave.invalid' then
    v_contact_email := left(coalesce(new.raw_user_meta_data ->> 'contact_email', ''), 254);
  else
    v_contact_email := left(coalesce(new.email, ''), 254);
  end if;
  select not s.require_customer_approval into v_approved
    from public.wholesale_settings s where s.id = true;
  insert into public.wholesale_customers (id,name,business_name,email,phone,address,approved,access_enabled,access_key)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''), 200),
    left(coalesce(new.raw_user_meta_data ->> 'business_name', ''), 200),
    v_contact_email,
    left(coalesce(new.raw_user_meta_data ->> 'phone', ''), 80),
    left(coalesce(new.raw_user_meta_data ->> 'address', ''), 1000),
    coalesce(v_approved, true), false, null
  ) on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;
revoke all on function private.wholesale_sync_customer() from public, anon, authenticated;
create trigger wholesale_sync_customer_after_auth_change
  after insert or update of email on auth.users
  for each row execute function private.wholesale_sync_customer();

insert into public.wholesale_customers (id,name,business_name,email,phone,address,approved,access_enabled,access_key)
select u.id,
  left(coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'full_name', ''), 200),
  left(coalesce(u.raw_user_meta_data ->> 'business_name', ''), 200),
  case when u.email ilike '%@customers.grandsave.invalid'
    then left(coalesce(u.raw_user_meta_data ->> 'contact_email', ''), 254)
    else left(coalesce(u.email, ''), 254) end,
  left(coalesce(u.raw_user_meta_data ->> 'phone', ''), 80),
  left(coalesce(u.raw_user_meta_data ->> 'address', ''), 1000),
  not s.require_customer_approval, false, null
from auth.users u cross join public.wholesale_settings s
where s.id = true
on conflict (id) do nothing;

create function public.wholesale_role()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return 'anonymous'; end if;
  if exists (select 1 from private.wholesale_owners o where o.user_id = v_user) then return 'owner'; end if;
  if exists (select 1 from public.wholesale_customers c
    where c.id = v_user and c.access_enabled and c.approved and c.access_key is not null)
  then return 'customer'; end if;
  return 'pending';
end;
$$;
revoke all on function public.wholesale_role() from public, anon, authenticated;
grant execute on function public.wholesale_role() to authenticated, anon;

-- Direct catalogue mutations are owner-only. Financial and account access
-- mutations are exposed only through the checked functions below.
alter table public.wholesale_settings enable row level security;
alter table public.wholesale_customers enable row level security;
alter table public.wholesale_products enable row level security;
alter table public.wholesale_offers enable row level security;
alter table public.wholesale_orders enable row level security;
alter table public.wholesale_order_items enable row level security;
alter table public.wholesale_payments enable row level security;
alter table public.wholesale_settings force row level security;
alter table public.wholesale_customers force row level security;
alter table public.wholesale_products force row level security;
alter table public.wholesale_offers force row level security;
alter table public.wholesale_orders force row level security;
alter table public.wholesale_order_items force row level security;
alter table public.wholesale_payments force row level security;
revoke all on public.wholesale_settings, public.wholesale_customers, public.wholesale_products,
  public.wholesale_offers, public.wholesale_orders, public.wholesale_order_items, public.wholesale_payments
  from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.wholesale_settings, public.wholesale_customers, public.wholesale_products,
  public.wholesale_offers, public.wholesale_orders, public.wholesale_order_items, public.wholesale_payments to authenticated;
grant insert, update on public.wholesale_products to authenticated;
grant insert, update, delete on public.wholesale_offers to authenticated;
grant update (business_name,contact_name,email,phone,require_customer_approval) on public.wholesale_settings to authenticated;

create policy wholesale_settings_read on public.wholesale_settings for select to authenticated
  using ((select auth.uid()) is not null);
create policy wholesale_settings_owner_update on public.wholesale_settings for update to authenticated
  using ((select public.wholesale_role()) = 'owner') with check ((select public.wholesale_role()) = 'owner');
create policy wholesale_customers_read on public.wholesale_customers for select to authenticated
  using (id = (select auth.uid()) or (select public.wholesale_role()) = 'owner');
create policy wholesale_products_read on public.wholesale_products for select to authenticated
  using ((select public.wholesale_role()) = 'owner' or (active and (select public.wholesale_role()) = 'customer'));
create policy wholesale_products_owner_insert on public.wholesale_products for insert to authenticated
  with check ((select public.wholesale_role()) = 'owner');
create policy wholesale_products_owner_update on public.wholesale_products for update to authenticated
  using ((select public.wholesale_role()) = 'owner') with check ((select public.wholesale_role()) = 'owner');
create policy wholesale_offers_read on public.wholesale_offers for select to authenticated
  using ((select public.wholesale_role()) = 'owner' or (
    (select public.wholesale_role()) = 'customer' and starts_at <= now() and ends_at > now()
    and exists (select 1 from public.wholesale_products p where p.id = product_id and p.active)
  ));
create policy wholesale_offers_owner_insert on public.wholesale_offers for insert to authenticated
  with check ((select public.wholesale_role()) = 'owner');
create policy wholesale_offers_owner_update on public.wholesale_offers for update to authenticated
  using ((select public.wholesale_role()) = 'owner') with check ((select public.wholesale_role()) = 'owner');
create policy wholesale_offers_owner_delete on public.wholesale_offers for delete to authenticated
  using ((select public.wholesale_role()) = 'owner');
create policy wholesale_orders_read on public.wholesale_orders for select to authenticated
  using ((select public.wholesale_role()) = 'owner' or (customer_id = (select auth.uid()) and (select public.wholesale_role()) = 'customer'));
create policy wholesale_order_items_read on public.wholesale_order_items for select to authenticated
  using ((select public.wholesale_role()) = 'owner' or (
    (select public.wholesale_role()) = 'customer' and exists (
      select 1 from public.wholesale_orders o where o.id = order_id and o.customer_id = (select auth.uid())
    )
  ));
create policy wholesale_payments_read on public.wholesale_payments for select to authenticated
  using ((select public.wholesale_role()) = 'owner' or (
    (select public.wholesale_role()) = 'customer' and exists (
      select 1 from public.wholesale_orders o where o.id = order_id and o.customer_id = (select auth.uid())
    )
  ));

create function private.wholesale_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
revoke all on function private.wholesale_touch_updated_at() from public, anon, authenticated;
create trigger wholesale_products_touch before update on public.wholesale_products
  for each row execute function private.wholesale_touch_updated_at();
create trigger wholesale_customers_touch before update on public.wholesale_customers
  for each row execute function private.wholesale_touch_updated_at();
create trigger wholesale_orders_touch before update on public.wholesale_orders
  for each row execute function private.wholesale_touch_updated_at();

create function public.wholesale_enable_customer(p_customer_id uuid, p_access_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_key text := lower(btrim(p_access_key)); v_email text;
begin
  if public.wholesale_role() <> 'owner' then raise exception 'Owner access required' using errcode = '42501'; end if;
  if p_customer_id is null or exists (select 1 from private.wholesale_owners o where o.user_id = p_customer_id) then
    raise exception 'Protected owner accounts cannot be managed as customers' using errcode = '22023';
  end if;
  if v_key is null or v_key !~ '^[a-z0-9][a-z0-9_-]{3,39}$' then
    raise exception 'Use 4-40 access key characters, starting with a letter or number' using errcode = '22023';
  end if;
  select u.email into v_email from auth.users u where u.id = p_customer_id;
  if not found or v_email is distinct from (v_key || '@customers.grandsave.invalid') then
    raise exception 'Customer Auth account does not match this access key' using errcode = '22023';
  end if;
  -- Creating access is an explicit owner approval, so the new customer can
  -- sign in immediately even if an older optional approval flag was enabled.
  update public.wholesale_customers set access_key = v_key, access_enabled = true, approved = true where id = p_customer_id;
  if not found then raise exception 'Customer account not found' using errcode = '22023'; end if;
end;
$$;

create function public.wholesale_can_manage_customer(p_customer_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if public.wholesale_role() <> 'owner' then raise exception 'Owner access required' using errcode = '42501'; end if;
  return exists (
    select 1 from public.wholesale_customers c join auth.users u on u.id = c.id
    where c.id = p_customer_id and c.access_enabled and c.access_key is not null
      and u.email = c.access_key || '@customers.grandsave.invalid'
      and not exists (select 1 from private.wholesale_owners o where o.user_id = c.id)
  );
end;
$$;

-- Private transactional helper. Callers cannot execute this function directly.
create function private.wholesale_create_order(
  p_customer_id uuid, p_items jsonb, p_status text, p_notes text, p_date date, p_request_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product public.wholesale_products%rowtype;
  v_product_id uuid;
  v_quantity_numeric numeric;
  v_quantity integer;
  v_seen uuid[] := array[]::uuid[];
  v_price numeric(12,2);
  v_total numeric(20,2) := 0;
  v_now timestamptz := now();
begin
  if p_request_id is not null then
    select o.id into v_order_id from public.wholesale_orders o
      where o.customer_id = p_customer_id and o.request_id = p_request_id;
    if found then return v_order_id; end if;
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Choose between 1 and 100 product lines' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Choose between 1 and 100 product lines' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('Draft','Placed','Confirmed','Packing','Completed','Cancelled')
    or p_date is null or not isfinite(p_date) or p_notes is null or char_length(p_notes) > 4000 then
    raise exception 'Invalid order details' using errcode = '22023';
  end if;
  if not exists (select 1 from public.wholesale_customers c where c.id = p_customer_id)
    or exists (select 1 from private.wholesale_owners o where o.user_id = p_customer_id) then
    raise exception 'Choose a valid customer account' using errcode = '22023';
  end if;

  v_order_id := gen_random_uuid();
  insert into public.wholesale_orders (id,reference,customer_id,request_id,date,status,notes,total)
  values (v_order_id, 'GS-' || to_char(v_now, 'YYYYMMDD') || '-' || upper(replace(v_order_id::text, '-', '')),
    p_customer_id, p_request_id, p_date, p_status, p_notes, 0)
  on conflict (customer_id, request_id) do nothing returning id into v_order_id;
  if not found then
    select o.id into v_order_id from public.wholesale_orders o
      where o.customer_id = p_customer_id and o.request_id = p_request_id;
    if v_order_id is null then raise exception 'Order is being processed. Please retry' using errcode = '40001'; end if;
    return v_order_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item -> 'product_id') is distinct from 'string'
      or (v_item ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_item -> 'quantity') is distinct from 'number'
      or char_length(v_item ->> 'quantity') > 16 then
      raise exception 'Invalid product or quantity' using errcode = '22023';
    end if;
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity_numeric := (v_item ->> 'quantity')::numeric;
    if v_quantity_numeric < 1 or v_quantity_numeric > 9999 or v_quantity_numeric <> trunc(v_quantity_numeric) then
      raise exception 'Quantities must be whole numbers between 1 and 9999' using errcode = '22023';
    end if;
    if v_product_id = any(v_seen) then raise exception 'Combine duplicate products into one line' using errcode = '22023'; end if;
    v_seen := array_append(v_seen, v_product_id);
    v_quantity := v_quantity_numeric::integer;
    select p.* into v_product from public.wholesale_products p where p.id = v_product_id and p.active for share;
    if not found then raise exception 'A selected product is unavailable. Refresh the catalogue' using errcode = '22023'; end if;
    select least(v_product.price, coalesce(min(o.price), v_product.price)) into v_price
      from public.wholesale_offers o where o.product_id = v_product_id and o.starts_at <= v_now and o.ends_at > v_now;
    insert into public.wholesale_order_items (order_id,product_id,name,code,pack,quantity,unit_price)
      values (v_order_id,v_product_id,v_product.name,v_product.code,v_product.pack,v_quantity,v_price);
    v_total := v_total + v_quantity * v_price;
  end loop;
  update public.wholesale_orders set total = v_total where id = v_order_id;
  return v_order_id;
end;
$$;
revoke all on function private.wholesale_create_order(uuid,jsonb,text,text,date,uuid) from public, anon, authenticated;

create function public.wholesale_place_order(p_items jsonb, p_notes text default '', p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if public.wholesale_role() <> 'customer' then raise exception 'Customer access is not enabled or approved' using errcode = '42501'; end if;
  return private.wholesale_create_order(auth.uid(),p_items,'Placed',p_notes,current_date,p_request_id);
end;
$$;

create function public.wholesale_owner_order(p_customer_id uuid,p_items jsonb,p_status text default 'Confirmed',p_notes text default '',p_date date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if public.wholesale_role() <> 'owner' then raise exception 'Owner access required' using errcode = '42501'; end if;
  return private.wholesale_create_order(p_customer_id,p_items,p_status,p_notes,p_date,null);
end;
$$;

create function public.wholesale_set_order_status(p_order_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.wholesale_orders%rowtype;
begin
  if public.wholesale_role() <> 'owner' then raise exception 'Owner access required' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('Draft','Placed','Confirmed','Packing','Completed','Cancelled') then
    raise exception 'Choose a valid order status' using errcode = '22023';
  end if;
  select o.* into v_order from public.wholesale_orders o where o.id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  if p_status in ('Draft','Cancelled') and exists (select 1 from public.wholesale_payments p where p.order_id = p_order_id) then
    raise exception 'An order with recorded payments cannot be drafted or cancelled' using errcode = '22023';
  end if;
  update public.wholesale_orders set status = p_status where id = p_order_id;
end;
$$;

create function public.wholesale_record_payment(p_order_id uuid,p_amount numeric,p_method text,p_date date,p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.wholesale_orders%rowtype; v_paid numeric; v_id uuid;
begin
  if public.wholesale_role() <> 'owner' then raise exception 'Owner access required' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric or p_amount = 'Infinity'::numeric
    or round(p_amount,2) <> p_amount or p_method is null or char_length(btrim(p_method)) not between 1 and 100
    or p_date is null or not isfinite(p_date) or p_note is null or char_length(p_note) > 2000 then
    raise exception 'Invalid payment details' using errcode = '22023';
  end if;
  select o.* into v_order from public.wholesale_orders o where o.id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = '22023'; end if;
  if v_order.status in ('Draft','Cancelled') then raise exception 'Payments cannot be recorded against draft or cancelled orders' using errcode = '22023'; end if;
  select coalesce(sum(p.amount),0) into v_paid from public.wholesale_payments p where p.order_id = p_order_id;
  if p_amount > v_order.total - v_paid then raise exception 'Payment exceeds the outstanding balance' using errcode = '22023'; end if;
  insert into public.wholesale_payments (order_id,amount,date,method,note)
    values (p_order_id,p_amount,p_date,btrim(p_method),p_note) returning id into v_id;
  return v_id;
end;
$$;

create function public.wholesale_set_customer_approval(p_customer_id uuid,p_approved boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.wholesale_role() <> 'owner' then raise exception 'Owner access required' using errcode = '42501'; end if;
  if p_approved is null or exists (select 1 from private.wholesale_owners o where o.user_id = p_customer_id) then
    raise exception 'Choose a valid customer account and approval status' using errcode = '22023';
  end if;
  update public.wholesale_customers set approved = p_approved where id = p_customer_id;
  if not found then raise exception 'Customer account not found' using errcode = '22023'; end if;
end;
$$;

create function public.wholesale_update_profile(p_name text,p_business_name text,p_phone text,p_address text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 200
    or p_business_name is null or char_length(p_business_name) > 200
    or p_phone is null or char_length(p_phone) > 80 or p_address is null or char_length(p_address) > 1000 then
    raise exception 'Invalid account details' using errcode = '22023';
  end if;
  update public.wholesale_customers set name = btrim(p_name), business_name = btrim(p_business_name),
    phone = btrim(p_phone), address = btrim(p_address) where id = auth.uid();
  if not found then raise exception 'Customer account not found' using errcode = '22023'; end if;
end;
$$;

revoke all on function public.wholesale_enable_customer(uuid,text),
  public.wholesale_can_manage_customer(uuid), public.wholesale_place_order(jsonb,text,uuid),
  public.wholesale_owner_order(uuid,jsonb,text,text,date), public.wholesale_set_order_status(uuid,text),
  public.wholesale_record_payment(uuid,numeric,text,date,text), public.wholesale_set_customer_approval(uuid,boolean),
  public.wholesale_update_profile(text,text,text,text) from public, anon, authenticated;
grant execute on function public.wholesale_enable_customer(uuid,text),
  public.wholesale_can_manage_customer(uuid), public.wholesale_place_order(jsonb,text,uuid),
  public.wholesale_owner_order(uuid,jsonb,text,text,date), public.wholesale_set_order_status(uuid,text),
  public.wholesale_record_payment(uuid,numeric,text,date,text), public.wholesale_set_customer_approval(uuid,boolean),
  public.wholesale_update_profile(text,text,text,text) to authenticated;

commit;
