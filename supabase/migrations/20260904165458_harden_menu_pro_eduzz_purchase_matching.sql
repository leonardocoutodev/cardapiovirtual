
-- Phase 6 hardening: make paid-purchase fallback deterministic when no transaction reference is present.

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

  if p.id is null and v_email<>'' then
    select * into p
    from public.menu_pro_eduzz_purchases
    where billing_status='active'
      and onboarding_submission_id is null
      and lower(buyer_email)=v_email
    order by paid_at desc nulls last,updated_at desc
    limit 1;
  end if;

  if p.id is null then
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

  if p.id is null then
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
