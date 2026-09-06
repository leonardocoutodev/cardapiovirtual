-- LC Menu Pro — Phase 1: multi-tenant foundation
-- Creates isolated business records and membership primitives,
-- and connects the existing Eduzz onboarding to automatic provisioning.

create table if not exists public.menu_pro_businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  business_name text not null,
  display_name text,
  segment text,
  contact_email text,
  contact_whatsapp text,
  order_whatsapp text,
  city_state text,
  status text not null default 'onboarding_received'
    check (status in ('draft','onboarding_received','in_setup','review','published','active','suspended','cancelled','archived')),
  plan_code text not null default 'menu_pro_base',
  billing_status text not null default 'unknown'
    check (billing_status in ('unknown','pending','active','past_due','cancelled')),
  eduzz_transaction_id text,
  owner_user_id uuid references auth.users(id) on delete set null,
  onboarding_completed_at timestamptz,
  published_at timestamptz,
  settings jsonb not null default '{}'::jsonb
    check (pg_column_size(settings) <= 65536),
  theme jsonb not null default '{}'::jsonb
    check (pg_column_size(theme) <= 32768),
  metadata jsonb not null default '{}'::jsonb
    check (pg_column_size(metadata) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_pro_businesses_slug_format_check
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists menu_pro_businesses_eduzz_transaction_uidx
  on public.menu_pro_businesses(eduzz_transaction_id)
  where eduzz_transaction_id is not null;

create index if not exists menu_pro_businesses_status_idx
  on public.menu_pro_businesses(status, created_at desc);

create index if not exists menu_pro_businesses_owner_idx
  on public.menu_pro_businesses(owner_user_id)
  where owner_user_id is not null;

create index if not exists menu_pro_businesses_billing_idx
  on public.menu_pro_businesses(billing_status, status);

create table if not exists public.menu_pro_members (
  business_id uuid not null references public.menu_pro_businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner','manager','editor','viewer')),
  status text not null default 'active'
    check (status in ('pending','active','suspended','revoked')),
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index if not exists menu_pro_members_user_idx
  on public.menu_pro_members(user_id, status);

create index if not exists menu_pro_members_business_role_idx
  on public.menu_pro_members(business_id, role, status);

alter table public.eduzz_onboarding_submissions
  add column if not exists business_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'eduzz_onboarding_submissions_business_id_fkey'
      and conrelid = 'public.eduzz_onboarding_submissions'::regclass
  ) then
    alter table public.eduzz_onboarding_submissions
      add constraint eduzz_onboarding_submissions_business_id_fkey
      foreign key (business_id)
      references public.menu_pro_businesses(id)
      on delete set null;
  end if;
end $$;

create index if not exists eduzz_onboarding_business_idx
  on public.eduzz_onboarding_submissions(business_id)
  where business_id is not null;

create or replace function private.menu_pro_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists menu_pro_businesses_set_updated_at on public.menu_pro_businesses;
create trigger menu_pro_businesses_set_updated_at
before update on public.menu_pro_businesses
for each row execute function private.menu_pro_set_updated_at();

drop trigger if exists menu_pro_members_set_updated_at on public.menu_pro_members;
create trigger menu_pro_members_set_updated_at
before update on public.menu_pro_members
for each row execute function private.menu_pro_set_updated_at();

create or replace function private.menu_pro_slugify(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  v := lower(coalesce(p_value, ''));
  v := translate(
    v,
    'áàâãäéèêëíìîïóòôõöúùûüçñ',
    'aaaaaeeeeiiiiooooouuuucn'
  );
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := trim(both '-' from v);
  if v = '' then v := 'negocio'; end if;
  return left(v, 72);
end;
$$;

create or replace function private.menu_pro_unique_slug(p_value text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := private.menu_pro_slugify(p_value);
  v_candidate text;
  v_suffix integer := 1;
begin
  v_candidate := v_base;
  while exists (
    select 1 from public.menu_pro_businesses b where b.slug = v_candidate
  ) loop
    v_suffix := v_suffix + 1;
    v_candidate := left(v_base, 64) || '-' || v_suffix::text;
  end loop;
  return v_candidate;
end;
$$;

create or replace function private.is_menu_pro_member(
  p_business_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.menu_pro_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (p_roles is null or m.role = any(p_roles))
  );
$$;

create or replace function private.attach_menu_pro_owner(
  p_business_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.menu_pro_businesses where id = p_business_id) then
    raise exception 'Menu Pro business not found';
  end if;

  update public.menu_pro_businesses
  set owner_user_id = p_user_id,
      updated_at = now()
  where id = p_business_id;

  insert into public.menu_pro_members(
    business_id, user_id, role, status, accepted_at
  )
  values(
    p_business_id, p_user_id, 'owner', 'active', now()
  )
  on conflict (business_id, user_id) do update
  set role = 'owner',
      status = 'active',
      accepted_at = coalesce(public.menu_pro_members.accepted_at, now()),
      updated_at = now();
end;
$$;

create or replace function private.provision_menu_pro_business(
  p_submission_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.eduzz_onboarding_submissions%rowtype;
  v_business_id uuid;
  v_slug text;
  v_attempt integer := 0;
begin
  select *
  into s
  from public.eduzz_onboarding_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Menu Pro onboarding submission not found';
  end if;

  if s.product_slug <> 'menu-pro' then
    return null;
  end if;

  if s.business_id is not null then
    return s.business_id;
  end if;

  if s.eduzz_transaction_id is not null then
    select id
    into v_business_id
    from public.menu_pro_businesses
    where eduzz_transaction_id = s.eduzz_transaction_id
    limit 1;
  end if;

  if v_business_id is null then
    v_slug := private.menu_pro_unique_slug(coalesce(s.display_name, s.business_name));

    loop
      begin
        insert into public.menu_pro_businesses(
          slug,
          business_name,
          display_name,
          segment,
          contact_email,
          contact_whatsapp,
          order_whatsapp,
          city_state,
          status,
          plan_code,
          billing_status,
          eduzz_transaction_id,
          onboarding_completed_at,
          settings,
          theme,
          metadata
        )
        values(
          v_slug,
          s.business_name,
          coalesce(nullif(s.display_name, ''), s.business_name),
          s.segment,
          s.email,
          s.whatsapp,
          s.order_whatsapp,
          s.city_state,
          'onboarding_received',
          'menu_pro_base',
          'unknown',
          s.eduzz_transaction_id,
          s.created_at,
          jsonb_strip_nulls(jsonb_build_object(
            'business_hours', s.business_hours,
            'instagram', s.instagram,
            'website', s.website,
            'address', s.address,
            'service_modes', to_jsonb(s.service_modes),
            'payment_methods', to_jsonb(s.payment_methods),
            'delivery_fee_mode', s.delivery_fee_mode,
            'delivery_fee_details', s.delivery_fee_details,
            'service_areas', s.service_areas,
            'minimum_order', s.minimum_order,
            'pix_key', s.pix_key,
            'finalization_channel', s.finalization_channel
          )),
          jsonb_strip_nulls(jsonb_build_object(
            'brand_colors', s.brand_colors,
            'visual_preferences', s.visual_preferences,
            'has_logo', s.has_logo
          )),
          jsonb_strip_nulls(jsonb_build_object(
            'source', 'eduzz_onboarding',
            'source_submission_id', s.id,
            'menu_source', s.menu_source,
            'categories', s.categories,
            'onboarding_status', s.status
          ))
        )
        returning id into v_business_id;

        exit;
      exception
        when unique_violation then
          if s.eduzz_transaction_id is not null then
            select id
            into v_business_id
            from public.menu_pro_businesses
            where eduzz_transaction_id = s.eduzz_transaction_id
            limit 1;

            if v_business_id is not null then
              exit;
            end if;
          end if;

          v_attempt := v_attempt + 1;
          if v_attempt > 5 then
            raise;
          end if;
          v_slug := left(private.menu_pro_slugify(coalesce(s.display_name, s.business_name)), 58)
                    || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      end;
    end loop;
  end if;

  update public.eduzz_onboarding_submissions
  set business_id = v_business_id,
      updated_at = now()
  where id = s.id
    and business_id is null;

  return v_business_id;
end;
$$;

create or replace function private.handle_menu_pro_onboarding_provision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.product_slug = 'menu-pro' then
    perform private.provision_menu_pro_business(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists menu_pro_onboarding_auto_provision
  on public.eduzz_onboarding_submissions;

create trigger menu_pro_onboarding_auto_provision
after insert on public.eduzz_onboarding_submissions
for each row
execute function private.handle_menu_pro_onboarding_provision();

alter table public.menu_pro_businesses enable row level security;
alter table public.menu_pro_members enable row level security;

drop policy if exists menu_pro_businesses_select_member
  on public.menu_pro_businesses;
create policy menu_pro_businesses_select_member
on public.menu_pro_businesses
for select
to authenticated
using (private.is_menu_pro_member(id, null));

drop policy if exists menu_pro_businesses_update_manager
  on public.menu_pro_businesses;
create policy menu_pro_businesses_update_manager
on public.menu_pro_businesses
for update
to authenticated
using (private.is_menu_pro_member(id, array['owner','manager']::text[]))
with check (private.is_menu_pro_member(id, array['owner','manager']::text[]));

drop policy if exists menu_pro_members_select_member
  on public.menu_pro_members;
create policy menu_pro_members_select_member
on public.menu_pro_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.is_menu_pro_member(business_id, array['owner','manager']::text[])
);

revoke all on table public.menu_pro_businesses from anon, authenticated;
revoke all on table public.menu_pro_members from anon, authenticated;

grant select on table public.menu_pro_businesses to authenticated;
grant update (
  display_name,
  segment,
  contact_email,
  contact_whatsapp,
  order_whatsapp,
  city_state,
  settings,
  theme
) on table public.menu_pro_businesses to authenticated;

grant select on table public.menu_pro_members to authenticated;

revoke all on function private.menu_pro_unique_slug(text) from public, anon, authenticated;
revoke all on function private.attach_menu_pro_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function private.provision_menu_pro_business(uuid) from public, anon, authenticated;
revoke all on function private.handle_menu_pro_onboarding_provision() from public, anon, authenticated;
revoke all on function private.menu_pro_set_updated_at() from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.is_menu_pro_member(uuid, text[]) to authenticated;

do $$
declare
  r record;
begin
  for r in
    select id
    from public.eduzz_onboarding_submissions
    where product_slug = 'menu-pro'
      and business_id is null
  loop
    perform private.provision_menu_pro_business(r.id);
  end loop;
end $$;
