-- LC Menu Pro — Phase 4: owner portal foundation

alter table public.menu_pro_businesses
  add column if not exists owner_portal_enabled boolean not null default false,
  add column if not exists owner_portal_claimed_at timestamptz;

create index if not exists menu_pro_businesses_owner_portal_email_idx
  on public.menu_pro_businesses(owner_portal_enabled, contact_email)
  where contact_email is not null and status not in ('cancelled','archived');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'menu-pro-assets',
  'menu-pro-assets',
  true,
  5242880,
  array['image/png','image/jpeg','image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists menu_pro_assets_authenticated_insert on storage.objects;
drop policy if exists menu_pro_assets_authenticated_update on storage.objects;
drop policy if exists menu_pro_assets_authenticated_delete on storage.objects;

with owner_account as (
  select wm.user_id
  from public.workspace_memberships wm
  join public.workspaces w on w.id = wm.workspace_id
  where w.slug = 'lc-ai'
    and wm.status = 'active'
    and wm.role = 'owner'
  order by wm.created_at
  limit 1
),
demo as (
  update public.menu_pro_businesses
  set owner_portal_enabled = true,
      owner_user_id = (select user_id from owner_account),
      owner_portal_claimed_at = coalesce(owner_portal_claimed_at, now()),
      updated_at = now()
  where slug = 'brasa-burger-demo'
  returning id
)
insert into public.menu_pro_members(business_id,user_id,role,status,accepted_at)
select demo.id, owner_account.user_id, 'owner', 'active', now()
from demo cross join owner_account
on conflict (business_id,user_id) do update
set role='owner',
    status='active',
    accepted_at=coalesce(public.menu_pro_members.accepted_at, now()),
    updated_at=now();

comment on column public.menu_pro_businesses.owner_portal_enabled is
  'Controls whether a verified contact e-mail may claim access to the owner portal.';
comment on column public.menu_pro_businesses.owner_portal_claimed_at is
  'Timestamp of the first successful owner portal account linkage.';
