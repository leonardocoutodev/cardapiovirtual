with product as (
  select p.id,p.business_id
  from public.menu_pro_products p
  join public.menu_pro_businesses b on b.id=p.business_id
  where b.slug='brasa-burger-demo' and p.slug='combo-brasa'
  limit 1
)
insert into public.menu_pro_addon_groups(business_id,product_id,name,selection_type,min_select,max_select,sort_order,is_active)
select business_id,id,'Escolha sua bebida','single',1,1,10,true
from product
on conflict(product_id,name) do update set
  selection_type='single',min_select=1,max_select=1,sort_order=10,is_active=true,updated_at=now();

with product as (
  select p.id,p.business_id
  from public.menu_pro_products p
  join public.menu_pro_businesses b on b.id=p.business_id
  where b.slug='brasa-burger-demo' and p.slug='combo-brasa'
  limit 1
), grp as (
  select g.id,g.business_id,g.product_id
  from public.menu_pro_addon_groups g
  join product p on p.id=g.product_id
  where g.name='Escolha sua bebida'
)
insert into public.menu_pro_product_addons(business_id,product_id,group_id,name,price_cents,is_active,sort_order)
select business_id,product_id,id,'Coca-Cola Lata',0,true,5 from grp
union all
select business_id,product_id,id,'Guaraná Lata',0,true,6 from grp
on conflict(product_id,name) do update set
  group_id=excluded.group_id,price_cents=excluded.price_cents,is_active=true,sort_order=excluded.sort_order,updated_at=now();

with product as (
  select p.id,p.business_id
  from public.menu_pro_products p
  join public.menu_pro_businesses b on b.id=p.business_id
  where b.slug='brasa-burger-demo' and p.slug='brasa-bacon'
  limit 1
)
insert into public.menu_pro_addon_groups(business_id,product_id,name,selection_type,min_select,max_select,sort_order,is_active)
select business_id,id,'Adicionais','multiple',0,3,20,true
from product
on conflict(product_id,name) do update set
  selection_type='multiple',min_select=0,max_select=3,sort_order=20,is_active=true,updated_at=now();

update public.menu_pro_product_addons a
set group_id=g.id,updated_at=now()
from public.menu_pro_addon_groups g
join public.menu_pro_products p on p.id=g.product_id
join public.menu_pro_businesses b on b.id=p.business_id
where b.slug='brasa-burger-demo'
  and p.slug='brasa-bacon'
  and g.name='Adicionais'
  and a.product_id=p.id
  and a.name in ('Bacon extra','Cheddar extra','Burger extra');
