create index if not exists menu_pro_products_category_business_fk_idx
  on public.menu_pro_products(category_id, business_id);

create index if not exists menu_pro_addons_product_business_fk_idx
  on public.menu_pro_product_addons(product_id, business_id);
