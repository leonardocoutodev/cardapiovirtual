-- LC Menu Pro — Phase 5: privacy-first storefront analytics

create table if not exists public.menu_pro_analytics_events (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid unique references public.eduzz_page_events(id) on delete set null,
  business_id uuid not null references public.menu_pro_businesses(id) on delete cascade,
  session_id text,
  event_name text not null
    check (event_name in (
      'menu_view','menu_open_product','menu_add_cart','menu_open_cart','menu_generate_whatsapp',
      'demo_view','demo_open_product','demo_add_cart','demo_open_cart','demo_generate_whatsapp',
      'menu_category','menu_search'
    )),
  product_id uuid references public.menu_pro_products(id) on delete set null,
  product_name text,
  path text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  item_count integer check (item_count is null or item_count between 0 and 10000),
  value_cents integer check (value_cents is null or value_cents between 0 and 100000000),
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 8192),
  created_at timestamptz not null default now()
);

alter table public.menu_pro_analytics_events enable row level security;
revoke all on table public.menu_pro_analytics_events from public, anon, authenticated;
grant select, insert, update, delete on table public.menu_pro_analytics_events to service_role;

create index if not exists menu_pro_analytics_business_created_idx
  on public.menu_pro_analytics_events(business_id, created_at desc);
create index if not exists menu_pro_analytics_business_event_created_idx
  on public.menu_pro_analytics_events(business_id, event_name, created_at desc);
create index if not exists menu_pro_analytics_product_event_created_idx
  on public.menu_pro_analytics_events(product_id, event_name, created_at desc)
  where product_id is not null;
create index if not exists menu_pro_analytics_business_session_idx
  on public.menu_pro_analytics_events(business_id, session_id)
  where session_id is not null;

create or replace function private.menu_pro_referrer_host(p_referrer text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_referrer,'') ~* '^https?://'
      then left(lower(regexp_replace(p_referrer, '^https?://([^/?#]+).*$','\1','i')), 253)
    else null
  end;
$$;

create or replace function private.capture_menu_pro_analytics_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_business_id uuid;
  v_product_id uuid;
  v_product_name text;
  v_event text;
  v_total numeric;
  v_items integer;
  v_meta jsonb;
begin
  if new.product_slug <> 'menu-pro' then return new; end if;
  if new.event_name not in (
    'menu_view','menu_open_product','menu_add_cart','menu_open_cart','menu_generate_whatsapp',
    'view_demo','demo_open_product','demo_add_cart','demo_open_cart','demo_generate_whatsapp',
    'menu_category','menu_search'
  ) then return new; end if;

  v_slug := left(coalesce(new.metadata->>'business_slug',''), 100);
  if v_slug = '' then return new; end if;

  select b.id into v_business_id
  from public.menu_pro_businesses b
  where b.slug = v_slug
  limit 1;
  if v_business_id is null then return new; end if;

  v_event := case new.event_name when 'view_demo' then 'demo_view' else new.event_name end;

  if coalesce(new.metadata->>'product_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select p.id, left(p.name,140)
    into v_product_id, v_product_name
    from public.menu_pro_products p
    where p.id = (new.metadata->>'product_id')::uuid
      and p.business_id = v_business_id
    limit 1;
  end if;
  if v_product_name is null then
    v_product_name := nullif(left(coalesce(new.metadata->>'product',''),140),'');
  end if;

  begin
    v_total := nullif(new.metadata->>'total','')::numeric;
  exception when others then
    v_total := null;
  end;
  begin
    v_items := nullif(new.metadata->>'items','')::integer;
  exception when others then
    begin
      v_items := nullif(new.metadata->>'qty','')::integer;
    exception when others then
      v_items := null;
    end;
  end;

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'version', nullif(left(coalesce(new.metadata->>'version',''),60),''),
    'products', case when coalesce(new.metadata->>'products','') ~ '^[0-9]+$'
      then least((new.metadata->>'products')::integer,10000) else null end
  ));

  insert into public.menu_pro_analytics_events(
    source_event_id,business_id,session_id,event_name,product_id,product_name,path,
    referrer_host,utm_source,utm_medium,utm_campaign,utm_content,utm_term,
    item_count,value_cents,metadata,created_at
  )
  values(
    new.id,
    v_business_id,
    nullif(left(coalesce(new.session_id,''),120),''),
    v_event,
    v_product_id,
    v_product_name,
    nullif(left(coalesce(new.path,''),300),''),
    private.menu_pro_referrer_host(new.referrer),
    nullif(left(coalesce(new.utm_source,''),160),''),
    nullif(left(coalesce(new.utm_medium,''),160),''),
    nullif(left(coalesce(new.utm_campaign,''),160),''),
    nullif(left(coalesce(new.utm_content,''),160),''),
    nullif(left(coalesce(new.utm_term,''),160),''),
    case when v_items between 0 and 10000 then v_items else null end,
    case when v_total is not null and v_total >= 0 and v_total <= 1000000 then round(v_total*100)::integer else null end,
    v_meta,
    new.created_at
  )
  on conflict (source_event_id) do nothing;

  return new;
end;
$$;

drop trigger if exists capture_menu_pro_analytics_event
on public.eduzz_page_events;
create trigger capture_menu_pro_analytics_event
after insert on public.eduzz_page_events
for each row execute function private.capture_menu_pro_analytics_event();

revoke all on function private.menu_pro_referrer_host(text) from public, anon, authenticated;
revoke all on function private.capture_menu_pro_analytics_event() from public, anon, authenticated;

insert into public.menu_pro_analytics_events(
  source_event_id,business_id,session_id,event_name,product_id,product_name,path,
  referrer_host,utm_source,utm_medium,utm_campaign,utm_content,utm_term,
  item_count,value_cents,metadata,created_at
)
select
  e.id,
  b.id,
  nullif(left(coalesce(e.session_id,''),120),''),
  case e.event_name when 'view_demo' then 'demo_view' else e.event_name end,
  p.id,
  coalesce(left(p.name,140),nullif(left(coalesce(e.metadata->>'product',''),140),'')),
  nullif(left(coalesce(e.path,''),300),''),
  private.menu_pro_referrer_host(e.referrer),
  nullif(left(coalesce(e.utm_source,''),160),''),
  nullif(left(coalesce(e.utm_medium,''),160),''),
  nullif(left(coalesce(e.utm_campaign,''),160),''),
  nullif(left(coalesce(e.utm_content,''),160),''),
  nullif(left(coalesce(e.utm_term,''),160),''),
  case
    when coalesce(e.metadata->>'items',e.metadata->>'qty','') ~ '^[0-9]+$'
    then least(coalesce(e.metadata->>'items',e.metadata->>'qty')::integer,10000)
    else null
  end,
  case
    when coalesce(e.metadata->>'total','') ~ '^[0-9]+([.][0-9]+)?$'
    then least(round((e.metadata->>'total')::numeric*100)::integer,100000000)
    else null
  end,
  jsonb_strip_nulls(jsonb_build_object(
    'version',nullif(left(coalesce(e.metadata->>'version',''),60),''),
    'products',case when coalesce(e.metadata->>'products','') ~ '^[0-9]+$'
      then least((e.metadata->>'products')::integer,10000) else null end
  )),
  e.created_at
from public.eduzz_page_events e
join public.menu_pro_businesses b
  on b.slug = left(coalesce(e.metadata->>'business_slug',''),100)
left join public.menu_pro_products p
  on p.business_id=b.id
 and coalesce(e.metadata->>'product_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 and p.id=(e.metadata->>'product_id')::uuid
where e.product_slug='menu-pro'
  and e.event_name in (
    'menu_view','menu_open_product','menu_add_cart','menu_open_cart','menu_generate_whatsapp',
    'view_demo','demo_open_product','demo_add_cart','demo_open_cart','demo_generate_whatsapp',
    'menu_category','menu_search'
  )
on conflict (source_event_id) do nothing;

create or replace function public.menu_pro_analytics_business(p_business_id uuid, p_days integer default 30)
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
ev as (
  select e.*
  from public.menu_pro_analytics_events e, params
  where e.business_id=p_business_id and e.created_at>=params.since
),
sessions as (
  select count(distinct session_id) filter (where session_id is not null) as total
  from ev
),
funnel as (
  select
    count(distinct session_id) filter (where event_name in ('menu_view','demo_view')) as views,
    count(distinct session_id) filter (where event_name in ('menu_open_product','demo_open_product')) as product_sessions,
    count(distinct session_id) filter (where event_name in ('menu_add_cart','demo_add_cart')) as add_sessions,
    count(distinct session_id) filter (where event_name in ('menu_open_cart','demo_open_cart')) as cart_sessions,
    count(distinct session_id) filter (where event_name in ('menu_generate_whatsapp','demo_generate_whatsapp')) as whatsapp_sessions
  from ev
),
daily as (
  select created_at::date as day,
    count(*) filter (where event_name in ('menu_view','demo_view')) as views,
    count(distinct session_id) filter (where session_id is not null) as sessions,
    count(*) filter (where event_name in ('menu_generate_whatsapp','demo_generate_whatsapp')) as whatsapp,
    coalesce(sum(value_cents) filter (where event_name in ('menu_generate_whatsapp','demo_generate_whatsapp')),0) as intent_cents
  from ev group by 1 order by 1
),
products as (
  select coalesce(product_id::text,'') as product_id,
         coalesce(max(product_name),'Produto') as product_name,
         count(*) filter (where event_name in ('menu_open_product','demo_open_product')) as opens,
         count(*) filter (where event_name in ('menu_add_cart','demo_add_cart')) as adds
  from ev
  where product_id is not null or product_name is not null
  group by product_id
  order by adds desc, opens desc, product_name
  limit 10
),
sources as (
  select
    coalesce(nullif(utm_source,''),nullif(referrer_host,''),'Direto') as source,
    count(distinct session_id) filter (where session_id is not null) as sessions
  from ev
  group by 1
  order by sessions desc, source
  limit 10
)
select jsonb_build_object(
  'period_days',(select days from params),
  'metrics',jsonb_build_object(
    'sessions',(select total from sessions),
    'views',count(*) filter (where event_name in ('menu_view','demo_view')),
    'product_opens',count(*) filter (where event_name in ('menu_open_product','demo_open_product')),
    'add_to_cart',count(*) filter (where event_name in ('menu_add_cart','demo_add_cart')),
    'cart_opens',count(*) filter (where event_name in ('menu_open_cart','demo_open_cart')),
    'whatsapp_generated',count(*) filter (where event_name in ('menu_generate_whatsapp','demo_generate_whatsapp')),
    'intent_value_cents',coalesce(sum(value_cents) filter (where event_name in ('menu_generate_whatsapp','demo_generate_whatsapp')),0),
    'conversion_rate',case when (select total from sessions)>0
      then round(100.0*(select whatsapp_sessions from funnel)/(select total from sessions),2)
      else 0 end
  ),
  'funnel',jsonb_build_object(
    'view_sessions',(select views from funnel),
    'product_sessions',(select product_sessions from funnel),
    'add_sessions',(select add_sessions from funnel),
    'cart_sessions',(select cart_sessions from funnel),
    'whatsapp_sessions',(select whatsapp_sessions from funnel)
  ),
  'daily',coalesce((select jsonb_agg(jsonb_build_object('day',day,'views',views,'sessions',sessions,'whatsapp',whatsapp,'intent_cents',intent_cents) order by day) from daily),'[]'::jsonb),
  'top_products',coalesce((select jsonb_agg(jsonb_build_object('product_id',product_id,'product_name',product_name,'opens',opens,'adds',adds)) from products),'[]'::jsonb),
  'sources',coalesce((select jsonb_agg(jsonb_build_object('source',source,'sessions',sessions)) from sources),'[]'::jsonb)
)
from ev;
$$;

revoke all on function public.menu_pro_analytics_business(uuid,integer) from public,anon,authenticated;
grant execute on function public.menu_pro_analytics_business(uuid,integer) to service_role;

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
    coalesce(sum(value_cents) filter (where event_name='menu_generate_whatsapp'),0) as intent_cents
  from ev group by business_id
),
acq as (
  select
    count(*) filter (where event_name='view_sales_page') as sales_views,
    count(distinct session_id) filter (where event_name='view_sales_page' and session_id is not null) as sales_sessions,
    count(*) filter (where event_name='click_demo') as demo_clicks,
    count(*) filter (where event_name='click_checkout') as checkout_clicks
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
    'intent_value_cents',coalesce((select sum(intent_cents) from by_business),0),
    'conversion_rate',case when coalesce((select sum(sessions) from by_business),0)>0
      then round(100.0*coalesce((select sum(whatsapp) from by_business),0)/nullif((select sum(sessions) from by_business),0),2)
      else 0 end
  ),
  'acquisition',jsonb_build_object(
    'sales_views',(select sales_views from acq),
    'sales_sessions',(select sales_sessions from acq),
    'demo_clicks',(select demo_clicks from acq),
    'checkout_clicks',(select checkout_clicks from acq),
    'checkout_click_rate',case when (select sales_sessions from acq)>0
      then round(100.0*(select checkout_clicks from acq)/(select sales_sessions from acq),2)
      else 0 end,
    'sources',coalesce((select jsonb_agg(jsonb_build_object('source',source,'sessions',sessions)) from acq_sources),'[]'::jsonb)
  ),
  'businesses',coalesce((
    select jsonb_agg(jsonb_build_object(
      'business_id',business_id,'name',name,'slug',slug,'sessions',sessions,'views',views,
      'whatsapp_generated',whatsapp,'intent_value_cents',intent_cents,
      'conversion_rate',case when sessions>0 then round(100.0*whatsapp/sessions,2) else 0 end
    ) order by whatsapp desc,sessions desc,name)
    from by_business
  ),'[]'::jsonb)
);
$$;

revoke all on function public.menu_pro_analytics_master(integer) from public,anon,authenticated;
grant execute on function public.menu_pro_analytics_master(integer) to service_role;

comment on table public.menu_pro_analytics_events is
  'Privacy-first LC Menu Pro storefront analytics. Contains behavioral events and commercial intent values, never customer identity, phone, address or order text.';
