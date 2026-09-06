
-- LC Menu Pro — Phase 6: Eduzz automation.
-- Signed, idempotent webhook events drive purchase/billing state and paid onboarding linkage.

create table if not exists public.menu_pro_eduzz_purchases (
  id uuid primary key default gen_random_uuid(),
  invoice_id text not null unique,
  transaction_id text,
  contract_id text,
  buyer_name text,
  buyer_email text not null,
  buyer_phone text,
  product_id text,
  product_name text,
  offer_name text,
  source_status text,
  billing_status text not null default 'pending'
    check (billing_status in ('unknown','pending','active','past_due','cancelled')),
  payment_method text,
  currency text,
  gross_cents integer check (gross_cents is null or gross_cents between 0 and 1000000000),
  paid_cents integer check (paid_cents is null or paid_cents between 0 and 1000000000),
  paid_at timestamptz,
  contract_status text,
  last_event_id text,
  last_event_name text,
  onboarding_submission_id uuid references public.eduzz_onboarding_submissions(id) on delete set null,
  business_id uuid references public.menu_pro_businesses(id) on delete set null,
  utm jsonb not null default '{}'::jsonb check (pg_column_size(utm) <= 8192),
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists menu_pro_eduzz_purchases_email_idx
  on public.menu_pro_eduzz_purchases(lower(buyer_email), billing_status, paid_at desc);
create index if not exists menu_pro_eduzz_purchases_transaction_idx
  on public.menu_pro_eduzz_purchases(transaction_id)
  where transaction_id is not null;
create index if not exists menu_pro_eduzz_purchases_contract_idx
  on public.menu_pro_eduzz_purchases(contract_id, updated_at desc)
  where contract_id is not null;
create index if not exists menu_pro_eduzz_purchases_business_idx
  on public.menu_pro_eduzz_purchases(business_id, updated_at desc)
  where business_id is not null;

alter table public.menu_pro_eduzz_purchases enable row level security;
revoke all on table public.menu_pro_eduzz_purchases from public, anon, authenticated;
grant select, insert, update, delete on table public.menu_pro_eduzz_purchases to service_role;

create table if not exists public.menu_pro_eduzz_events (
  event_id text primary key,
  event_name text not null,
  invoice_id text,
  transaction_id text,
  contract_id text,
  product_id text,
  product_name text,
  product_match boolean not null default false,
  processing_status text not null default 'received'
    check (processing_status in ('received','processed','ignored','failed')),
  payload_sha256 text not null,
  error text,
  sent_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  purchase_id uuid references public.menu_pro_eduzz_purchases(id) on delete set null,
  business_id uuid references public.menu_pro_businesses(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 8192)
);

create index if not exists menu_pro_eduzz_events_received_idx
  on public.menu_pro_eduzz_events(received_at desc);
create index if not exists menu_pro_eduzz_events_name_received_idx
  on public.menu_pro_eduzz_events(event_name, received_at desc);
create index if not exists menu_pro_eduzz_events_processing_idx
  on public.menu_pro_eduzz_events(processing_status, received_at desc);

alter table public.menu_pro_eduzz_events enable row level security;
revoke all on table public.menu_pro_eduzz_events from public, anon, authenticated;
grant select, insert, update, delete on table public.menu_pro_eduzz_events to service_role;

drop trigger if exists menu_pro_eduzz_purchases_set_updated_at on public.menu_pro_eduzz_purchases;
create trigger menu_pro_eduzz_purchases_set_updated_at
before update on public.menu_pro_eduzz_purchases
for each row execute function private.menu_pro_set_updated_at();

create or replace function private.menu_pro_eduzz_apply_business_billing(
  p_business_id uuid,
  p_billing_status text,
  p_event_name text,
  p_invoice_id text,
  p_contract_id text,
  p_purchase_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.menu_pro_businesses%rowtype;
  v_status text;
  v_meta jsonb;
begin
  if p_business_id is null then return; end if;
  select * into b from public.menu_pro_businesses where id=p_business_id for update;
  if not found or b.is_demo then return; end if;

  v_status := b.status;
  v_meta := coalesce(b.metadata,'{}'::jsonb);

  if p_billing_status in ('past_due','cancelled') and b.status in ('published','active') then
    v_status := 'suspended';
    v_meta := v_meta || jsonb_build_object(
      'billing_suspended_by_eduzz', true,
      'billing_previous_status', b.status
    );
  elsif p_billing_status='active'
    and b.status='suspended'
    and coalesce((v_meta->>'billing_suspended_by_eduzz')::boolean,false)=true then
    v_status := case
      when v_meta->>'billing_previous_status'='published' then 'published'
      else 'active'
    end;
    v_meta := (v_meta - 'billing_suspended_by_eduzz' - 'billing_previous_status');
  end if;

  v_meta := v_meta || jsonb_strip_nulls(jsonb_build_object(
    'eduzz_last_event', p_event_name,
    'eduzz_last_invoice_id', p_invoice_id,
    'eduzz_contract_id', p_contract_id,
    'eduzz_purchase_id', p_purchase_id
  ));

  update public.menu_pro_businesses
  set billing_status=p_billing_status,
      status=v_status,
      metadata=v_meta,
      updated_at=now()
  where id=p_business_id;

  insert into public.menu_pro_admin_activity(
    business_id,actor_user_id,action,details
  ) values (
    p_business_id,null,'eduzz_billing_updated',
    jsonb_strip_nulls(jsonb_build_object(
      'event_name',p_event_name,
      'invoice_id',p_invoice_id,
      'contract_id',p_contract_id,
      'purchase_id',p_purchase_id,
      'billing_from',b.billing_status,
      'billing_to',p_billing_status,
      'status_from',b.status,
      'status_to',v_status
    ))
  );
end;
$$;

create or replace function public.menu_pro_process_eduzz_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id text := nullif(left(trim(coalesce(p_event->>'event_id','')),180),'');
  v_event_name text := nullif(left(trim(coalesce(p_event->>'event_name','')),120),'');
  v_invoice_id text := nullif(left(trim(coalesce(p_event->>'invoice_id','')),180),'');
  v_transaction_id text := nullif(left(trim(coalesce(p_event->>'transaction_id','')),180),'');
  v_contract_id text := nullif(left(trim(coalesce(p_event->>'contract_id','')),180),'');
  v_product_id text := nullif(left(trim(coalesce(p_event->>'product_id','')),180),'');
  v_product_name text := nullif(left(trim(coalesce(p_event->>'product_name','')),240),'');
  v_product_match boolean := coalesce((p_event->>'product_match')::boolean,false);
  v_payload_sha text := nullif(left(trim(coalesce(p_event->>'payload_sha256','')),128),'');
  v_billing text := nullif(left(trim(coalesce(p_event->>'billing_status','')),40),'');
  v_source_status text := nullif(left(trim(coalesce(p_event->>'source_status','')),80),'');
  v_buyer_name text := nullif(left(trim(coalesce(p_event->>'buyer_name','')),240),'');
  v_buyer_email text := lower(nullif(left(trim(coalesce(p_event->>'buyer_email','')),320),''));
  v_buyer_phone text := nullif(left(regexp_replace(coalesce(p_event->>'buyer_phone',''),'[^0-9+]','','g'),40),'');
  v_offer_name text := nullif(left(trim(coalesce(p_event->>'offer_name','')),240),'');
  v_payment_method text := nullif(left(trim(coalesce(p_event->>'payment_method','')),80),'');
  v_currency text := upper(nullif(left(trim(coalesce(p_event->>'currency','')),12),''));
  v_gross_cents integer;
  v_paid_cents integer;
  v_sent_at timestamptz;
  v_paid_at timestamptz;
  v_contract_status text := nullif(left(trim(coalesce(p_event->>'contract_status','')),80),'');
  v_purchase public.menu_pro_eduzz_purchases%rowtype;
  v_existing_event public.menu_pro_eduzz_events%rowtype;
  v_utm jsonb := case when jsonb_typeof(p_event->'utm')='object' then p_event->'utm' else '{}'::jsonb end;
  v_metadata jsonb := case when jsonb_typeof(p_event->'metadata')='object' then p_event->'metadata' else '{}'::jsonb end;
begin
  if v_event_id is null or v_event_name is null or v_payload_sha is null then
    raise exception 'Invalid normalized Eduzz event';
  end if;

  select * into v_existing_event
  from public.menu_pro_eduzz_events
  where event_id=v_event_id;
  if found then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'event_id',v_event_id,
      'processing_status',v_existing_event.processing_status,
      'purchase_id',v_existing_event.purchase_id,
      'business_id',v_existing_event.business_id
    );
  end if;

  begin v_gross_cents := nullif(p_event->>'gross_cents','')::integer;
  exception when others then v_gross_cents := null; end;
  begin v_paid_cents := nullif(p_event->>'paid_cents','')::integer;
  exception when others then v_paid_cents := null; end;
  begin v_sent_at := nullif(p_event->>'sent_at','')::timestamptz;
  exception when others then v_sent_at := null; end;
  begin v_paid_at := nullif(p_event->>'paid_at','')::timestamptz;
  exception when others then v_paid_at := null; end;

  if v_gross_cents is not null and (v_gross_cents<0 or v_gross_cents>1000000000) then v_gross_cents:=null; end if;
  if v_paid_cents is not null and (v_paid_cents<0 or v_paid_cents>1000000000) then v_paid_cents:=null; end if;
  if v_billing not in ('unknown','pending','active','past_due','cancelled') then v_billing:=null; end if;

  insert into public.menu_pro_eduzz_events(
    event_id,event_name,invoice_id,transaction_id,contract_id,product_id,product_name,
    product_match,processing_status,payload_sha256,sent_at,metadata
  ) values (
    v_event_id,v_event_name,v_invoice_id,v_transaction_id,v_contract_id,v_product_id,v_product_name,
    v_product_match,'received',v_payload_sha,v_sent_at,
    jsonb_strip_nulls(jsonb_build_object(
      'source_status',v_source_status,
      'contract_status',v_contract_status
    ))
  );

  if v_event_name='ping' then
    update public.menu_pro_eduzz_events
    set processing_status='processed',processed_at=now()
    where event_id=v_event_id;
    return jsonb_build_object('ok',true,'event_id',v_event_id,'ping',true);
  end if;

  if not v_product_match then
    update public.menu_pro_eduzz_events
    set processing_status='ignored',processed_at=now()
    where event_id=v_event_id;
    return jsonb_build_object('ok',true,'event_id',v_event_id,'ignored','product_not_matched');
  end if;

  if v_invoice_id is not null then
    insert into public.menu_pro_eduzz_purchases(
      invoice_id,transaction_id,contract_id,buyer_name,buyer_email,buyer_phone,
      product_id,product_name,offer_name,source_status,billing_status,
      payment_method,currency,gross_cents,paid_cents,paid_at,contract_status,
      last_event_id,last_event_name,utm,metadata
    ) values (
      v_invoice_id,v_transaction_id,v_contract_id,v_buyer_name,coalesce(v_buyer_email,'unknown@invalid.local'),v_buyer_phone,
      v_product_id,v_product_name,v_offer_name,v_source_status,coalesce(v_billing,'unknown'),
      v_payment_method,v_currency,v_gross_cents,v_paid_cents,v_paid_at,v_contract_status,
      v_event_id,v_event_name,v_utm,v_metadata
    )
    on conflict (invoice_id) do update
    set transaction_id=coalesce(excluded.transaction_id,public.menu_pro_eduzz_purchases.transaction_id),
        contract_id=coalesce(excluded.contract_id,public.menu_pro_eduzz_purchases.contract_id),
        buyer_name=coalesce(excluded.buyer_name,public.menu_pro_eduzz_purchases.buyer_name),
        buyer_email=case when excluded.buyer_email<>'unknown@invalid.local' then excluded.buyer_email else public.menu_pro_eduzz_purchases.buyer_email end,
        buyer_phone=coalesce(excluded.buyer_phone,public.menu_pro_eduzz_purchases.buyer_phone),
        product_id=coalesce(excluded.product_id,public.menu_pro_eduzz_purchases.product_id),
        product_name=coalesce(excluded.product_name,public.menu_pro_eduzz_purchases.product_name),
        offer_name=coalesce(excluded.offer_name,public.menu_pro_eduzz_purchases.offer_name),
        source_status=coalesce(excluded.source_status,public.menu_pro_eduzz_purchases.source_status),
        billing_status=coalesce(v_billing,public.menu_pro_eduzz_purchases.billing_status),
        payment_method=coalesce(excluded.payment_method,public.menu_pro_eduzz_purchases.payment_method),
        currency=coalesce(excluded.currency,public.menu_pro_eduzz_purchases.currency),
        gross_cents=coalesce(excluded.gross_cents,public.menu_pro_eduzz_purchases.gross_cents),
        paid_cents=coalesce(excluded.paid_cents,public.menu_pro_eduzz_purchases.paid_cents),
        paid_at=coalesce(excluded.paid_at,public.menu_pro_eduzz_purchases.paid_at),
        contract_status=coalesce(excluded.contract_status,public.menu_pro_eduzz_purchases.contract_status),
        last_event_id=excluded.last_event_id,
        last_event_name=excluded.last_event_name,
        utm=case when excluded.utm<>'{}'::jsonb then excluded.utm else public.menu_pro_eduzz_purchases.utm end,
        metadata=public.menu_pro_eduzz_purchases.metadata || excluded.metadata,
        updated_at=now()
    returning * into v_purchase;
  elsif v_contract_id is not null then
    select * into v_purchase
    from public.menu_pro_eduzz_purchases
    where contract_id=v_contract_id
    order by updated_at desc
    limit 1
    for update;

    if not found and v_buyer_email is not null then
      select * into v_purchase
      from public.menu_pro_eduzz_purchases
      where lower(buyer_email)=v_buyer_email
        and (v_product_id is null or product_id=v_product_id)
      order by paid_at desc nulls last, updated_at desc
      limit 1
      for update;
    end if;

    if found then
      update public.menu_pro_eduzz_purchases
      set contract_id=coalesce(v_contract_id,contract_id),
          contract_status=coalesce(v_contract_status,contract_status),
          billing_status=coalesce(v_billing,billing_status),
          last_event_id=v_event_id,
          last_event_name=v_event_name,
          metadata=metadata || v_metadata,
          updated_at=now()
      where id=v_purchase.id
      returning * into v_purchase;
    end if;
  end if;

  if v_purchase.id is not null and v_purchase.business_id is not null and v_billing is not null then
    perform private.menu_pro_eduzz_apply_business_billing(
      v_purchase.business_id,v_billing,v_event_name,
      coalesce(v_invoice_id,v_purchase.invoice_id),
      coalesce(v_contract_id,v_purchase.contract_id),
      v_purchase.id
    );
  end if;

  update public.menu_pro_eduzz_events
  set processing_status=case when v_purchase.id is null then 'ignored' else 'processed' end,
      processed_at=now(),
      purchase_id=v_purchase.id,
      business_id=v_purchase.business_id,
      metadata=metadata || jsonb_strip_nulls(jsonb_build_object(
        'billing_status',v_billing,
        'unmatched_reason',case when v_purchase.id is null then 'no_invoice_or_purchase_match' else null end
      ))
  where event_id=v_event_id;

  return jsonb_build_object(
    'ok',true,'duplicate',false,'event_id',v_event_id,
    'processing_status',case when v_purchase.id is null then 'ignored' else 'processed' end,
    'purchase_id',v_purchase.id,'business_id',v_purchase.business_id,
    'billing_status',v_billing
  );
exception when others then
  update public.menu_pro_eduzz_events
  set processing_status='failed',
      error=left(sqlerrm,1000),
      processed_at=now()
  where event_id=v_event_id;
  raise;
end;
$$;

revoke all on function public.menu_pro_process_eduzz_event(jsonb) from public,anon,authenticated;
grant execute on function public.menu_pro_process_eduzz_event(jsonb) to service_role;

create or replace function public.menu_pro_validate_eduzz_purchase(
  p_email text,
  p_reference text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.menu_pro_eduzz_purchases%rowtype;
  v_email text := lower(trim(coalesce(p_email,'')));
  v_ref text := trim(coalesce(p_reference,''));
begin
  if v_ref<>'' then
    select * into p
    from public.menu_pro_eduzz_purchases
    where billing_status='active'
      and onboarding_submission_id is null
      and (invoice_id=v_ref or transaction_id=v_ref)
    order by paid_at desc nulls last,updated_at desc
    limit 1;
  end if;

  if not found and v_email<>'' then
    select * into p
    from public.menu_pro_eduzz_purchases
    where billing_status='active'
      and onboarding_submission_id is null
      and lower(buyer_email)=v_email
    order by paid_at desc nulls last,updated_at desc
    limit 1;
  end if;

  if not found then
    return jsonb_build_object('eligible',false,'reason','paid_purchase_not_found');
  end if;

  if v_email<>'' and lower(p.buyer_email)<>v_email then
    return jsonb_build_object('eligible',false,'reason','buyer_email_mismatch');
  end if;

  return jsonb_build_object(
    'eligible',true,
    'purchase_id',p.id,
    'invoice_id',p.invoice_id,
    'transaction_id',p.transaction_id,
    'reference',coalesce(p.transaction_id,p.invoice_id),
    'buyer_email',p.buyer_email
  );
end;
$$;

revoke all on function public.menu_pro_validate_eduzz_purchase(text,text) from public,anon,authenticated;
grant execute on function public.menu_pro_validate_eduzz_purchase(text,text) to service_role;

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
  p public.menu_pro_eduzz_purchases%rowtype;
  v_business_id uuid;
  v_slug text;
  v_attempt integer := 0;
  v_reference text;
begin
  select * into s
  from public.eduzz_onboarding_submissions
  where id=p_submission_id
  for update;

  if not found then raise exception 'Menu Pro onboarding submission not found'; end if;
  if s.product_slug<>'menu-pro' then return null; end if;
  if s.business_id is not null then return s.business_id; end if;

  v_reference:=trim(coalesce(s.eduzz_transaction_id,''));

  if v_reference<>'' then
    select * into p
    from public.menu_pro_eduzz_purchases
    where billing_status='active'
      and onboarding_submission_id is null
      and (invoice_id=v_reference or transaction_id=v_reference)
    order by paid_at desc nulls last,updated_at desc
    limit 1
    for update;
  end if;

  if not found then
    select * into p
    from public.menu_pro_eduzz_purchases
    where billing_status='active'
      and onboarding_submission_id is null
      and lower(buyer_email)=lower(s.email)
    order by paid_at desc nulls last,updated_at desc
    limit 1
    for update;
  end if;

  if p.id is not null and p.business_id is not null then
    v_business_id:=p.business_id;
  elsif p.id is null and s.eduzz_transaction_id is not null then
    select id into v_business_id
    from public.menu_pro_businesses
    where eduzz_transaction_id=s.eduzz_transaction_id
    limit 1;
  end if;

  if v_business_id is null then
    v_slug:=private.menu_pro_unique_slug(coalesce(s.display_name,s.business_name));

    loop
      begin
        insert into public.menu_pro_businesses(
          slug,business_name,display_name,segment,contact_email,contact_whatsapp,
          order_whatsapp,city_state,status,plan_code,billing_status,eduzz_transaction_id,
          onboarding_completed_at,settings,theme,metadata
        ) values (
          v_slug,s.business_name,coalesce(nullif(s.display_name,''),s.business_name),
          s.segment,s.email,s.whatsapp,s.order_whatsapp,s.city_state,
          'onboarding_received','menu_pro_base',
          case when p.id is not null then p.billing_status else 'unknown' end,
          coalesce(p.transaction_id,p.invoice_id,s.eduzz_transaction_id),
          s.created_at,
          jsonb_strip_nulls(jsonb_build_object(
            'business_hours',s.business_hours,'instagram',s.instagram,'website',s.website,
            'address',s.address,'service_modes',to_jsonb(s.service_modes),
            'payment_methods',to_jsonb(s.payment_methods),'delivery_fee_mode',s.delivery_fee_mode,
            'delivery_fee_details',s.delivery_fee_details,'service_areas',s.service_areas,
            'minimum_order',s.minimum_order,'pix_key',s.pix_key,'finalization_channel',s.finalization_channel
          )),
          jsonb_strip_nulls(jsonb_build_object(
            'brand_colors',s.brand_colors,'visual_preferences',s.visual_preferences,'has_logo',s.has_logo
          )),
          jsonb_strip_nulls(jsonb_build_object(
            'source','eduzz_onboarding','source_submission_id',s.id,
            'menu_source',s.menu_source,'categories',s.categories,'onboarding_status',s.status,
            'eduzz_purchase_id',p.id,'eduzz_invoice_id',p.invoice_id,'eduzz_contract_id',p.contract_id
          ))
        ) returning id into v_business_id;
        exit;
      exception when unique_violation then
        if coalesce(p.transaction_id,p.invoice_id,s.eduzz_transaction_id) is not null then
          select id into v_business_id
          from public.menu_pro_businesses
          where eduzz_transaction_id=coalesce(p.transaction_id,p.invoice_id,s.eduzz_transaction_id)
          limit 1;
          if v_business_id is not null then exit; end if;
        end if;
        v_attempt:=v_attempt+1;
        if v_attempt>5 then raise; end if;
        v_slug:=left(private.menu_pro_slugify(coalesce(s.display_name,s.business_name)),58)
          ||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
      end;
    end loop;
  end if;

  update public.eduzz_onboarding_submissions
  set business_id=v_business_id,
      eduzz_transaction_id=coalesce(eduzz_transaction_id,p.transaction_id,p.invoice_id),
      updated_at=now()
  where id=s.id;

  if p.id is not null then
    update public.menu_pro_eduzz_purchases
    set onboarding_submission_id=s.id,
        business_id=v_business_id,
        updated_at=now()
    where id=p.id;

    perform private.menu_pro_eduzz_apply_business_billing(
      v_business_id,p.billing_status,coalesce(p.last_event_name,'onboarding_linked'),
      p.invoice_id,p.contract_id,p.id
    );
  end if;

  return v_business_id;
end;
$$;

revoke all on function private.provision_menu_pro_business(uuid) from public,anon,authenticated;

create or replace function public.menu_pro_eduzz_admin_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with p as (
  select * from public.menu_pro_eduzz_purchases
),
e as (
  select * from public.menu_pro_eduzz_events
)
select jsonb_build_object(
  'events_total',(select count(*) from e),
  'events_failed',(select count(*) from e where processing_status='failed'),
  'last_event_at',(select max(received_at) from e),
  'paid_invoices',(select count(*) from p where billing_status='active'),
  'awaiting_onboarding',(select count(*) from p where billing_status='active' and onboarding_submission_id is null),
  'linked_businesses',(select count(distinct business_id) from p where business_id is not null),
  'past_due',(select count(*) from p where billing_status='past_due'),
  'cancelled',(select count(*) from p where billing_status='cancelled'),
  'confirmed_paid_cents',coalesce((select sum(coalesce(paid_cents,gross_cents,0)) from p where billing_status='active'),0),
  'recent_purchases',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',x.id,'invoice_id',x.invoice_id,'transaction_id',x.transaction_id,'contract_id',x.contract_id,
      'buyer_name',x.buyer_name,'buyer_email',x.buyer_email,'product_id',x.product_id,'product_name',x.product_name,
      'billing_status',x.billing_status,'source_status',x.source_status,'paid_cents',x.paid_cents,
      'gross_cents',x.gross_cents,'paid_at',x.paid_at,'business_id',x.business_id,
      'onboarding_submission_id',x.onboarding_submission_id,'last_event_name',x.last_event_name,'updated_at',x.updated_at
    ) order by x.updated_at desc)
    from (select * from p order by updated_at desc limit 25) x
  ),'[]'::jsonb),
  'recent_events',coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_id',x.event_id,'event_name',x.event_name,'invoice_id',x.invoice_id,
      'product_match',x.product_match,'processing_status',x.processing_status,
      'purchase_id',x.purchase_id,'business_id',x.business_id,'sent_at',x.sent_at,'received_at',x.received_at
    ) order by x.received_at desc)
    from (select * from e order by received_at desc limit 40) x
  ),'[]'::jsonb)
);
$$;

revoke all on function public.menu_pro_eduzz_admin_summary() from public,anon,authenticated;
grant execute on function public.menu_pro_eduzz_admin_summary() to service_role;

comment on table public.menu_pro_eduzz_purchases is
  'LC Menu Pro Eduzz purchase and recurring billing state. Service-role only; buyer fields are used for paid onboarding matching.';
comment on table public.menu_pro_eduzz_events is
  'Idempotent audit log of normalized Eduzz webhook events. Raw webhook bodies are never stored.';
