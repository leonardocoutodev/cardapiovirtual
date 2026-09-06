with b as (
  select id from public.menu_pro_businesses where slug='brasa-burger-demo'
),
pairs(source_slug,recommended_slug,label,sort_order) as (
  values
    ('brasa-bacon','coca-cola-lata','Uma bebida combina com seu burger',10),
    ('brasa-bacon','guarana-lata','Uma bebida combina com seu burger',20),
    ('brasa-bacon','fritas-da-brasa','Que tal completar com uma porção?',30),
    ('smash-classico','coca-cola-lata','Uma bebida combina com seu burger',10),
    ('smash-classico','guarana-lata','Uma bebida combina com seu burger',20),
    ('smash-classico','fritas-da-brasa','Que tal completar com uma porção?',30),
    ('duplo-fogo','coca-cola-lata','Uma bebida combina com seu burger',10),
    ('duplo-fogo','guarana-lata','Uma bebida combina com seu burger',20),
    ('duplo-fogo','onion-rings','Que tal completar com uma porção?',30),
    ('combo-brasa','brownie-com-chocolate','Finalize com uma sobremesa',10),
    ('combo-brasa','milk-shake-chocolate','Finalize com uma sobremesa',20),
    ('combo-casal','brownie-com-chocolate','Finalize com uma sobremesa',10),
    ('combo-casal','milk-shake-chocolate','Finalize com uma sobremesa',20),
    ('combo-familia','brownie-com-chocolate','Finalize com uma sobremesa',10),
    ('combo-familia','milk-shake-chocolate','Finalize com uma sobremesa',20),
    ('fritas-da-brasa','coca-cola-lata','Uma bebida combina com sua porção',10),
    ('fritas-da-brasa','guarana-lata','Uma bebida combina com sua porção',20),
    ('onion-rings','coca-cola-lata','Uma bebida combina com sua porção',10),
    ('onion-rings','guarana-lata','Uma bebida combina com sua porção',20),
    ('coca-cola-lata','brownie-com-chocolate','Que tal uma sobremesa?',10),
    ('guarana-lata','brownie-com-chocolate','Que tal uma sobremesa?',10)
)
insert into public.menu_pro_product_recommendations(
  business_id,source_product_id,recommended_product_id,label,sort_order,is_active
)
select b.id,src.id,dst.id,p.label,p.sort_order,true
from b
join pairs p on true
join public.menu_pro_products src on src.business_id=b.id and src.slug=p.source_slug
join public.menu_pro_products dst on dst.business_id=b.id and dst.slug=p.recommended_slug
on conflict(source_product_id,recommended_product_id) do update set
  label=excluded.label,
  sort_order=excluded.sort_order,
  is_active=true,
  updated_at=now();
