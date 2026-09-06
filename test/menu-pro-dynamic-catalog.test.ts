import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { handleEduzzRequest } from "../src/eduzz-pages.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "service-test"
};

test("Menu Pro publica catálogo dinâmico sem expor dados administrativos", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/menu_pro_businesses") {
      return Response.json([{
        id: "business-1",
        slug: "brasa-teste",
        display_name: "Brasa Teste",
        business_name: "Brasa Teste LTDA",
        segment: "Hamburgueria",
        city_state: "Ilhéus, BA",
        order_whatsapp: "+55 (73) 99999-9999",
        status: "active",
        settings: {
          service_modes: ["Entrega", "Retirada"],
          payment_methods: ["Pix"],
          delivery_fee_cents: 500,
          minimum_order_cents: 2000,
          cover_image_url: "https://project.supabase.co/storage/v1/object/public/menu-pro-assets/business/cover.webp"
        },
        theme: { brand_initials: "BT", accent: "#c75e2d", logo_url: "https://project.supabase.co/storage/v1/object/public/menu-pro-assets/business/logo.webp" },
        metadata: { is_demo: false, internal_note: "não expor" }
      }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_categories") {
      return Response.json([{ id: "cat-1", name: "Burgers", slug: "burgers", sort_order: 10 }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_products") {
      return Response.json([{
        id: "prod-1", category_id: "cat-1", name: "Burger",
        description: "Artesanal", price_cents: 2890,
        image_url: "https://project.supabase.co/storage/v1/object/public/menu-pro-assets/business/burger.webp", image_alt: "Burger",
        is_available: true, is_featured: true, sort_order: 10, tags: ["burger"]
      },{
        id: "prod-2", category_id: "cat-1", name: "Refrigerante",
        description: "Lata", price_cents: 600,
        image_url: "https://project.supabase.co/storage/v1/object/public/menu-pro-assets/business/refri.webp", image_alt: "Refrigerante",
        is_available: true, is_featured: false, sort_order: 20, tags: ["bebida"]
      }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_product_addons") {
      return Response.json([{ id: "add-1", product_id: "prod-1", group_id: "grp-1", name: "Bacon", price_cents: 500, sort_order: 10 }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_addon_groups") {
      return Response.json([{ id: "grp-1", product_id: "prod-1", name: "Extras", selection_type: "multiple", min_select: 0, max_select: 2, sort_order: 10 }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_product_recommendations") {
      return Response.json([{ source_product_id: "prod-1", recommended_product_id: "prod-2", label: "Uma bebida combina com seu burger", sort_order: 10 }]);
    }
    throw new Error("Rota inesperada: " + url.pathname);
  };

  const response = await handleEduzzRequest(
    new Request("https://lc.example/v1/menu-pro/catalog/brasa-teste"),
    env
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /stale-while-revalidate/);

  const body = await response.json();
  assert.equal(body.business.name, "Brasa Teste");
  assert.equal(body.business.order_whatsapp, "5573999999999");
  assert.equal(body.business.delivery_fee, 5);
  assert.equal(body.business.internal_note, undefined);
  assert.deepEqual(body.cats, ["Todos", "Burgers"]);
  assert.equal(body.products[0].price, 28.9);
  assert.equal(body.products[0].cat, "Burgers");
  assert.match(body.business.logo_url, /^\/lcai\/v1\/menu-pro\/image\?src=/);
  assert.match(body.business.cover_image_url, /^\/lcai\/v1\/menu-pro\/image\?src=/);
  assert.match(body.products[0].img, /^\/lcai\/v1\/menu-pro\/image\?src=/);
  assert.deepEqual(body.products[0].addons, [["Bacon", 5]]);
  assert.equal(body.products[0].addon_groups[0].name, "Extras");
  assert.equal(body.products[0].addon_groups[0].max_select, 2);
  assert.equal(body.products[0].addon_groups[0].options[0].name, "Bacon");
  assert.equal(body.products[0].recommendations[0].product_id, "prod-2");
  assert.equal(body.products[0].recommendations[0].label, "Uma bebida combina com seu burger");
  assert.deepEqual(body.products[0].tags, ["burger"]);
});

test("Menu Pro não publica tenant inexistente ou não publicado", async () => {
  globalThis.fetch = async () => Response.json([]);
  const response = await handleEduzzRequest(
    new Request("https://lc.example/v1/menu-pro/catalog/rascunho"),
    env
  );
  assert.ok(response);
  assert.equal(response.status, 404);
});

test("demo e rota pública usam a engine externa real e suportam embed", async () => {
  globalThis.fetch = async () => { throw new Error("A página HTML não deve consultar rede no servidor"); };

  const demo = await handleEduzzRequest(
    new Request("https://lc.example/eduzz/menu-pro/exemplo?embed=1"),
    env
  );
  assert.ok(demo);
  const demoHtml = await demo.text();
  assert.match(demoHtml, /data-menu-slug="brasa-burger-demo"/);
  assert.match(demoHtml, /data-menu-embed="1"/);
  assert.match(demoHtml, /menu-pro-app\.js/);
  assert.match(demoHtml, /menu-pro-app\.css/);
  assert.match(demoHtml, /name="robots" content="noindex,follow"/);
  assert.match(demoHtml, /role="dialog"/);
  assert.match(demoHtml, /previewModal/);
  assert.doesNotMatch(demoHtml, /const products=\[/);

  const publicMenu = await handleEduzzRequest(
    new Request("https://lc.example/menu/minha-pizzaria"),
    env
  );
  assert.ok(publicMenu);
  const publicHtml = await publicMenu.text();
  assert.match(publicHtml, /data-menu-slug="minha-pizzaria"/);
  assert.match(publicHtml, /index,follow,max-image-preview:large/);
  assert.match(publicMenu.headers.get("content-security-policy")||"",/frame-ancestors 'self'/);
});

test("alias antigo da demo redireciona para a URL canônica preservando parâmetros", async () => {
  const response = await handleEduzzRequest(
    new Request("https://lc.example/eduzz/menu-pro/demo?utm_source=instagram"),
    env
  );
  assert.ok(response);
  assert.equal(response.status, 308);
  assert.match(response.headers.get("location")||"", /\/eduzz\/menu-pro\/exemplo\?utm_source=instagram/);
});
