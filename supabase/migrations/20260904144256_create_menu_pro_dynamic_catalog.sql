-- LC Menu Pro — Phase 3: dynamic catalog foundation

create table if not exists public.menu_pro_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.menu_pro_businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text check (description is null or char_length(description) <= 500),
  sort_order integer not null default 100 check (sort_order between -10000 and 10000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, slug),
  unique (id, business_id)
);

create index if not exists menu_pro_categories_business_active_sort_idx
  on public.menu_pro_categories(business_id, is_active, sort_order, name);

create table if not exists public.menu_pro_products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.menu_pro_businesses(id) on delete cascade,
  category_id uuid,
  sku text check (sku is null or char_length(sku) <= 80),
  name text not null check (char_length(name) between 1 and 140),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text check (description is null or char_length(description) <= 1200),
  price_cents integer not null check (price_cents >= 0 and price_cents <= 100000000),
  compare_at_price_cents integer check (compare_at_price_cents is null or compare_at_price_cents >= price_cents),
  image_url text check (image_url is null or char_length(image_url) <= 2000),
  image_alt text check (image_alt is null or char_length(image_alt) <= 200),
  is_active boolean not null default true,
  is_available boolean not null default true,
  is_featured boolean not null default false,
  sort_order integer not null default 100 check (sort_order between -10000 and 10000),
  tags text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, slug),
  unique (id, business_id),
  constraint menu_pro_products_category_business_fkey
    foreign key (category_id, business_id)
    references public.menu_pro_categories(id, business_id)
    on delete set null
);

create index if not exists menu_pro_products_business_active_sort_idx
  on public.menu_pro_products(business_id, is_active, sort_order, name);
create index if not exists menu_pro_products_category_active_sort_idx
  on public.menu_pro_products(category_id, is_active, sort_order, name);
create index if not exists menu_pro_products_featured_idx
  on public.menu_pro_products(business_id, is_featured, is_available)
  where is_active = true;

create table if not exists public.menu_pro_product_addons (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.menu_pro_businesses(id) on delete cascade,
  product_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  price_cents integer not null default 0 check (price_cents >= 0 and price_cents <= 10000000),
  is_active boolean not null default true,
  sort_order integer not null default 100 check (sort_order between -10000 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_pro_addons_product_business_fkey
    foreign key (product_id, business_id)
    references public.menu_pro_products(id, business_id)
    on delete cascade,
  unique (product_id, name)
);

create index if not exists menu_pro_addons_product_active_sort_idx
  on public.menu_pro_product_addons(product_id, is_active, sort_order, name);
create index if not exists menu_pro_addons_business_idx
  on public.menu_pro_product_addons(business_id, product_id);

drop trigger if exists menu_pro_categories_set_updated_at on public.menu_pro_categories;
create trigger menu_pro_categories_set_updated_at before update on public.menu_pro_categories
for each row execute function private.menu_pro_set_updated_at();
drop trigger if exists menu_pro_products_set_updated_at on public.menu_pro_products;
create trigger menu_pro_products_set_updated_at before update on public.menu_pro_products
for each row execute function private.menu_pro_set_updated_at();
drop trigger if exists menu_pro_product_addons_set_updated_at on public.menu_pro_product_addons;
create trigger menu_pro_product_addons_set_updated_at before update on public.menu_pro_product_addons
for each row execute function private.menu_pro_set_updated_at();

alter table public.menu_pro_categories enable row level security;
alter table public.menu_pro_products enable row level security;
alter table public.menu_pro_product_addons enable row level security;
revoke all on table public.menu_pro_categories from anon, authenticated;
revoke all on table public.menu_pro_products from anon, authenticated;
revoke all on table public.menu_pro_product_addons from anon, authenticated;
grant select, insert, update, delete on table public.menu_pro_categories to service_role;
grant select, insert, update, delete on table public.menu_pro_products to service_role;
grant select, insert, update, delete on table public.menu_pro_product_addons to service_role;

insert into public.menu_pro_businesses(
  slug,business_name,display_name,segment,contact_email,contact_whatsapp,order_whatsapp,
  city_state,status,plan_code,billing_status,settings,theme,metadata
)
values(
  'brasa-burger-demo','Brasa Burger Demonstração','Brasa Burger','Hamburgueria',
  'contatolcsolucoesdigitais@gmail.com','5573981250366','5573981250366',
  'Ilhéus, BA','active','menu_pro_base','active',
  jsonb_build_object(
    'business_hours','18:00–23:30',
    'service_modes',jsonb_build_array('Entrega','Retirada'),
    'payment_methods',jsonb_build_array('Pix','Cartão na entrega','Dinheiro'),
    'minimum_order_cents',2000,
    'delivery_fee_cents',500,
    'eta_text','30–45 min',
    'subtitle','Burgers artesanais, combos e porções',
    'cover_image_url','https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=88'
  ),
  jsonb_build_object('brand_initials','BB','accent','#c75e2d'),
  jsonb_build_object('is_demo',true,'source','phase3_seed')
)
on conflict (slug) do update set
  display_name=excluded.display_name,segment=excluded.segment,order_whatsapp=excluded.order_whatsapp,
  city_state=excluded.city_state,status='active',settings=excluded.settings,theme=excluded.theme,
  metadata=excluded.metadata,updated_at=now();

with b as (select id from public.menu_pro_businesses where slug='brasa-burger-demo')
insert into public.menu_pro_categories(business_id,name,slug,sort_order,is_active)
select b.id,v.name,v.slug,v.sort_order,true
from b cross join (values
  ('Destaques','destaques',10),('Burgers','burgers',20),('Combos','combos',30),
  ('Porções','porcoes',40),('Bebidas','bebidas',50),('Sobremesas','sobremesas',60)
) as v(name,slug,sort_order)
on conflict (business_id,slug) do update set
  name=excluded.name,sort_order=excluded.sort_order,is_active=true,updated_at=now();

with
b as (select id from public.menu_pro_businesses where slug='brasa-burger-demo'),
p(name,slug,category_slug,description,price_cents,image_url,featured,sort_order) as (values
('Brasa Bacon','brasa-bacon','destaques','Pão brioche, burger 180g, cheddar cremoso, bacon crocante e molho da casa.',2890,'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=500&q=86',true,10),
('Combo Brasa','combo-brasa','destaques','Brasa Bacon + fritas individuais + refrigerante lata.',3990,'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=500&q=86',true,20),
('Smash Clássico','smash-classico','burgers','Pão, smash 120g, queijo, cebola caramelizada, picles e molho especial.',2290,'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=500&q=86',false,30),
('Duplo Fogo','duplo-fogo','burgers','Dois burgers, queijo duplo, jalapeño, cebola crispy e molho picante.',3190,'https://images.unsplash.com/photo-1553979459-d2229ba7433b?auto=format&fit=crop&w=500&q=86',false,40),
('Combo Casal','combo-casal','combos','2 Smash Clássicos + fritas grande + 2 bebidas.',5990,'https://images.unsplash.com/photo-1460306855393-0410f61241c7?auto=format&fit=crop&w=500&q=86',false,50),
('Combo Família','combo-familia','combos','4 burgers clássicos + 2 fritas grandes + refrigerante 2L.',10990,'https://images.unsplash.com/photo-1499028344343-cd173ffc68a9?auto=format&fit=crop&w=500&q=86',false,60),
('Fritas da Brasa','fritas-da-brasa','porcoes','Fritas crocantes com sal da casa. Serve até 2 pessoas.',1890,'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=500&q=86',false,70),
('Onion Rings','onion-rings','porcoes','Anéis de cebola empanados e crocantes, acompanhados de molho.',2190,'https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=500&q=86',false,80),
('Coca-Cola Lata','coca-cola-lata','bebidas','350 ml, gelada.',600,'https://images.unsplash.com/photo-1629203851122-3726ecdf080e?auto=format&fit=crop&w=500&q=86',false,90),
('Guaraná Lata','guarana-lata','bebidas','350 ml, gelado.',600,'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=500&q=86',false,100),
('Brownie com Chocolate','brownie-com-chocolate','sobremesas','Brownie macio com calda de chocolate.',1490,'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=500&q=86',false,110),
('Milk-shake Chocolate','milk-shake-chocolate','sobremesas','Cremoso, 400 ml, finalizado com calda.',1790,'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=500&q=86',false,120)
)
insert into public.menu_pro_products(
 business_id,category_id,name,slug,description,price_cents,image_url,image_alt,is_active,is_available,is_featured,sort_order
)
select b.id,c.id,p.name,p.slug,p.description,p.price_cents,p.image_url,p.name,true,true,p.featured,p.sort_order
from b join p on true join public.menu_pro_categories c on c.business_id=b.id and c.slug=p.category_slug
on conflict (business_id,slug) do update set
 category_id=excluded.category_id,name=excluded.name,description=excluded.description,price_cents=excluded.price_cents,
 image_url=excluded.image_url,image_alt=excluded.image_alt,is_active=true,is_available=true,
 is_featured=excluded.is_featured,sort_order=excluded.sort_order,updated_at=now();

with
b as (select id from public.menu_pro_businesses where slug='brasa-burger-demo'),
a(product_slug,name,price_cents,sort_order) as (values
('brasa-bacon','Bacon extra',500,10),('brasa-bacon','Cheddar extra',400,20),('brasa-bacon','Burger extra',900,30),
('combo-brasa','Trocar por fritas com cheddar',500,10),('combo-brasa','Bacon extra',500,20),
('smash-classico','Smash extra',700,10),('smash-classico','Queijo extra',350,20),('smash-classico','Bacon',500,30),
('duplo-fogo','Molho picante extra',200,10),('duplo-fogo','Bacon',500,20),
('combo-casal','Bacon nos dois',900,10),('combo-casal','Cheddar nas fritas',500,20),
('combo-familia','Bacon nos burgers',1600,10),('combo-familia','Cheddar nas fritas',900,20),
('fritas-da-brasa','Cheddar',500,10),('fritas-da-brasa','Bacon',500,20),('fritas-da-brasa','Molho da casa',200,30),
('onion-rings','Molho extra',200,10),('brownie-com-chocolate','Sorvete de creme',600,10),
('milk-shake-chocolate','Chantilly',200,10),('milk-shake-chocolate','Ovomaltine',300,20)
)
insert into public.menu_pro_product_addons(business_id,product_id,name,price_cents,is_active,sort_order)
select b.id,p.id,a.name,a.price_cents,true,a.sort_order
from b join a on true join public.menu_pro_products p on p.business_id=b.id and p.slug=a.product_slug
on conflict (product_id,name) do update set
 price_cents=excluded.price_cents,is_active=true,sort_order=excluded.sort_order,updated_at=now();

comment on table public.menu_pro_categories is 'Tenant-scoped LC Menu Pro menu categories.';
comment on table public.menu_pro_products is 'Tenant-scoped LC Menu Pro products and availability.';
comment on table public.menu_pro_product_addons is 'Simple optional paid add-ons for LC Menu Pro products.';
