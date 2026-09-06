create table if not exists public.menu_pro_addon_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.menu_pro_businesses(id) on delete cascade,
  product_id uuid not null references public.menu_pro_products(id) on delete cascade,
  name text not null,
  selection_type text not null default 'multiple'
    check (selection_type in ('single','multiple')),
  min_select integer not null default 0 check (min_select between 0 and 50),
  max_select integer check (max_select is null or max_select between 1 and 50),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_pro_addon_groups_min_max_check
    check (max_select is null or max_select >= greatest(min_select,1)),
  constraint menu_pro_addon_groups_product_name_uidx unique(product_id,name)
);

alter table public.menu_pro_product_addons
  add column if not exists group_id uuid references public.menu_pro_addon_groups(id) on delete set null;

create index if not exists menu_pro_addon_groups_business_product_idx
  on public.menu_pro_addon_groups(business_id,product_id,is_active,sort_order);

create index if not exists menu_pro_product_addons_group_idx
  on public.menu_pro_product_addons(group_id)
  where group_id is not null;

drop trigger if exists menu_pro_addon_groups_set_updated_at on public.menu_pro_addon_groups;
create trigger menu_pro_addon_groups_set_updated_at
before update on public.menu_pro_addon_groups
for each row execute function private.menu_pro_set_updated_at();

alter table public.menu_pro_addon_groups enable row level security;

drop policy if exists menu_pro_addon_groups_select_member on public.menu_pro_addon_groups;
create policy menu_pro_addon_groups_select_member
on public.menu_pro_addon_groups
for select
to authenticated
using (public.menu_pro_is_member(business_id,null::text[]));

drop policy if exists menu_pro_addon_groups_write_editor on public.menu_pro_addon_groups;
create policy menu_pro_addon_groups_write_editor
on public.menu_pro_addon_groups
for all
to authenticated
using (public.menu_pro_is_member(business_id,array['owner','manager','editor']::text[]))
with check (public.menu_pro_is_member(business_id,array['owner','manager','editor']::text[]));

revoke all on table public.menu_pro_addon_groups from anon,authenticated;
grant select,insert,update,delete on table public.menu_pro_addon_groups to authenticated;
grant update(group_id) on table public.menu_pro_product_addons to authenticated;
