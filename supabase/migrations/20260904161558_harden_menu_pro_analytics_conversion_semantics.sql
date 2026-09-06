-- LC Menu Pro — Phase 5 precision hardening:
-- keep generated-order events as volume, but calculate conversion by unique sessions.

create or replace function public.menu_pro_analytics_master(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with params as (
  select greatest(1,least(coalesce(p_days,30),365)) as days,
         now() - make_interval(days => greatest(1,least(coalesce(p_days,30),365))) as since
),
real_businesses as (
  select id,slug,coalesce(display_name,business_name) as name
  from public.menu_pro_businesses
  where is_demo=false and status not in ('cancelled','archived')
),
ev as (
  select e.*,b.name,b.slug
  from public.menu_pro_analytics_events e
  join real_businesses b on b.id=e.business_id, params
  where e.created_at>=params.since
),
by_business as (
  select business_id,max(name) as name,max(slug) as slug,
    count(distinct session_id) filter (where session_id is not null) as sessions,
    count(*) filter (where event_name='menu_view') as views,
    count(*) filter (where event_name='menu_generate_whatsapp') as whatsapp,
    count(distinct session_id) filter (
      where event_name='menu_generate_whatsapp' and session_id is not null
    ) as whatsapp_sessions,
    coalesce(sum(value_cents) filter (where event_name='menu_generate_whatsapp'),0) as intent_cents
  from ev group by business_id
),
acq as (
  select
    count(*) filter (where event_name='view_sales_page') as sales_views,
    count(distinct session_id) filter (where event_name='view_sales_page' and session_id is not null) as sales_sessions,
    count(*) filter (where event_name='click_demo') as demo_clicks,
    count(*) filter (where event_name='click_checkout') as checkout_clicks,
    count(distinct session_id) filter (where event_name='click_checkout' and session_id is not null) as checkout_sessions
  from public.eduzz_page_events e,params
  where e.product_slug='menu-pro' and e.created_at>=params.since
),
acq_sources as (
  select coalesce(nullif(utm_source,''),private.menu_pro_referrer_host(referrer),'Direto') as source,
         count(distinct session_id) filter (where session_id is not null) as sessions
  from public.eduzz_page_events e,params
  where e.product_slug='menu-pro' and e.event_name='view_sales_page' and e.created_at>=params.since
  group by 1 order by sessions desc,source limit 10
)
select jsonb_build_object(
  'period_days',(select days from params),
  'storefront',jsonb_build_object(
    'active_with_traffic',(select count(*) from by_business where sessions>0),
    'sessions',coalesce((select sum(sessions) from by_business),0),
    'views',coalesce((select sum(views) from by_business),0),
    'whatsapp_generated',coalesce((select sum(whatsapp) from by_business),0),
    'whatsapp_sessions',coalesce((select sum(whatsapp_sessions) from by_business),0),
    'intent_value_cents',coalesce((select sum(intent_cents) from by_business),0),
    'conversion_rate',case when coalesce((select sum(sessions) from by_business),0)>0
      then round(
        100.0*coalesce((select sum(whatsapp_sessions) from by_business),0)
        /nullif((select sum(sessions) from by_business),0),
        2
      )
      else 0 end
  ),
  'acquisition',jsonb_build_object(
    'sales_views',(select sales_views from acq),
    'sales_sessions',(select sales_sessions from acq),
    'demo_clicks',(select demo_clicks from acq),
    'checkout_clicks',(select checkout_clicks from acq),
    'checkout_sessions',(select checkout_sessions from acq),
    'checkout_click_rate',case when (select sales_sessions from acq)>0
      then round(100.0*(select checkout_sessions from acq)/(select sales_sessions from acq),2)
      else 0 end,
    'sources',coalesce((select jsonb_agg(jsonb_build_object('source',source,'sessions',sessions)) from acq_sources),'[]'::jsonb)
  ),
  'businesses',coalesce((
    select jsonb_agg(jsonb_build_object(
      'business_id',business_id,'name',name,'slug',slug,'sessions',sessions,'views',views,
      'whatsapp_generated',whatsapp,'whatsapp_sessions',whatsapp_sessions,'intent_value_cents',intent_cents,
      'conversion_rate',case when sessions>0 then round(100.0*whatsapp_sessions/sessions,2) else 0 end
    ) order by whatsapp desc,sessions desc,name)
    from by_business
  ),'[]'::jsonb)
);
$$;

revoke all on function public.menu_pro_analytics_master(integer) from public,anon,authenticated;
grant execute on function public.menu_pro_analytics_master(integer) to service_role;
