-- Keep demonstration tenants out of real client and MRR metrics.
alter table public.menu_pro_businesses
  add column if not exists is_demo boolean not null default false;

update public.menu_pro_businesses
set is_demo = true, updated_at = now()
where slug = 'brasa-burger-demo';

create index if not exists menu_pro_businesses_real_status_idx
  on public.menu_pro_businesses(is_demo, status, created_at desc);

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
        where is_demo = false
        group by status
      ) s
    ), '{}'::jsonb)
  )
  from public.menu_pro_businesses
  where is_demo = false;
$$;

revoke all on function public.menu_pro_admin_summary() from public, anon, authenticated;
grant execute on function public.menu_pro_admin_summary() to service_role;
