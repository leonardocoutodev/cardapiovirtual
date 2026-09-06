-- LC Menu Pro — Phase 2: Master Backoffice
-- Internal notes, administrative activity trail and fast dashboard summary.

create table if not exists public.menu_pro_admin_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.menu_pro_businesses(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists menu_pro_admin_notes_business_created_idx
  on public.menu_pro_admin_notes(business_id, created_at desc);

create index if not exists menu_pro_admin_notes_author_idx
  on public.menu_pro_admin_notes(author_user_id)
  where author_user_id is not null;

alter table public.menu_pro_admin_notes enable row level security;
revoke all on table public.menu_pro_admin_notes from anon, authenticated;
grant select, insert, update, delete on table public.menu_pro_admin_notes to service_role;

create table if not exists public.menu_pro_admin_activity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.menu_pro_businesses(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) <= 16384),
  created_at timestamptz not null default now()
);

create index if not exists menu_pro_admin_activity_business_created_idx
  on public.menu_pro_admin_activity(business_id, created_at desc);

create index if not exists menu_pro_admin_activity_action_created_idx
  on public.menu_pro_admin_activity(action, created_at desc);

create index if not exists menu_pro_admin_activity_actor_idx
  on public.menu_pro_admin_activity(actor_user_id)
  where actor_user_id is not null;

alter table public.menu_pro_admin_activity enable row level security;
revoke all on table public.menu_pro_admin_activity from anon, authenticated;
grant select, insert, update, delete on table public.menu_pro_admin_activity to service_role;

create or replace function public.menu_pro_admin_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total_businesses', count(*),
    'active_businesses', count(*) filter (where status = 'active'),
    'published_businesses', count(*) filter (where status in ('published','active')),
    'pending_implementation', count(*) filter (where status in ('onboarding_received','in_setup','review')),
    'suspended_businesses', count(*) filter (where status = 'suspended'),
    'billing_active', count(*) filter (where billing_status = 'active'),
    'mrr_cents', coalesce(sum(case when billing_status = 'active' then 4990 else 0 end),0),
    'created_last_30d', count(*) filter (where created_at >= now() - interval '30 days'),
    'status_counts', coalesce((
      select jsonb_object_agg(s.status, s.total)
      from (
        select status, count(*) as total
        from public.menu_pro_businesses
        group by status
      ) s
    ), '{}'::jsonb)
  )
  from public.menu_pro_businesses;
$$;

revoke all on function public.menu_pro_admin_summary() from public, anon, authenticated;
grant execute on function public.menu_pro_admin_summary() to service_role;

comment on table public.menu_pro_admin_notes is
  'Internal LC Menu Pro operational notes, available only through owner/admin server APIs.';
comment on table public.menu_pro_admin_activity is
  'Internal audit trail for LC Menu Pro backoffice changes.';
