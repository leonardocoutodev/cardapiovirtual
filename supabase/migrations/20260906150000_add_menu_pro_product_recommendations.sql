create table if not exists public.menu_pro_product_recommendations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.menu_pro_businesses(id) on delete cascade,
  source_product_id uuid not null references public.menu_pro_products(id) on delete cascade,
  recommended_product_id uuid not null references public.menu_pro_products(id) on delete cascade,
  label text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_pro_recommendation_distinct_products_check check (source_product_id <> recommended_product_id),
  constraint menu_pro_recommendation_pair_uidx unique(source_product_id,recommended_product_id)
);
create index if not exists menu_pro_recommendations_business_source_idx
  on public.menu_pro_product_recommendations(business_id,source_product_id,is_active,sort_order);
create index if not exists menu_pro_recommendations_recommended_idx
  on public.menu_pro_product_recommendations(recommended_product_id) where is_active=true;
drop trigger if exists menu_pro_product_recommendations_set_updated_at on public.menu_pro_product_recommendations;
create trigger menu_pro_product_recommendations_set_updated_at before update on public.menu_pro_product_recommendations
for each row execute function private.menu_pro_set_updated_at();
create or replace function private.menu_pro_validate_recommendation_tenant()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.menu_pro_products p where p.id=new.source_product_id and p.business_id=new.business_id) then
    raise exception 'source product does not belong to business';
  end if;
  if not exists (select 1 from public.menu_pro_products p where p.id=new.recommended_product_id and p.business_id=new.business_id) then
    raise exception 'recommended product does not belong to business';
  end if;
  return new;
end; $$;
drop trigger if exists menu_pro_validate_recommendation_tenant on public.menu_pro_product_recommendations;
create trigger menu_pro_validate_recommendation_tenant
before insert or update of business_id,source_product_id,recommended_product_id
on public.menu_pro_product_recommendations for each row execute function private.menu_pro_validate_recommendation_tenant();
alter table public.menu_pro_product_recommendations enable row level security;
drop policy if exists menu_pro_recommendations_select_member on public.menu_pro_product_recommendations;
create policy menu_pro_recommendations_select_member on public.menu_pro_product_recommendations
for select to authenticated using (public.menu_pro_is_member(business_id,null::text[]));
drop policy if exists menu_pro_recommendations_write_editor on public.menu_pro_product_recommendations;
create policy menu_pro_recommendations_write_editor on public.menu_pro_product_recommendations
for all to authenticated
using (public.menu_pro_is_member(business_id,array['owner','manager','editor']::text[]))
with check (public.menu_pro_is_member(business_id,array['owner','manager','editor']::text[]));
revoke all on table public.menu_pro_product_recommendations from anon,authenticated;
grant select,insert,update,delete on table public.menu_pro_product_recommendations to authenticated;
revoke all on function private.menu_pro_validate_recommendation_tenant() from public,anon,authenticated;
