import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { handleMenuProSalesPage } from "../src/eduzz-sales-page.ts";
import { handleEduzzRequest } from "../src/eduzz-pages.ts";

const originalFetch = globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch});

test("página comercial usa demonstração real em vez de mockup de cardápio em CSS", async()=>{
  const r=handleMenuProSalesPage(new Request("https://lc.example/eduzz/menu-pro?utm_source=bio&utm_medium=link_hub&secret=nao-repassar"));
  assert.ok(r);
  assert.equal(r.status,200);
  const html=await r.text();
  assert.match(html,/data-demo-frame/);
  assert.match(html,/Demonstração real/);
  assert.match(html,/Portal do proprietário/);
  assert.match(html,/Analytics com privacidade/);
  assert.doesNotMatch(html,/class="phone"/);
  assert.doesNotMatch(html,/class="screen"/);
  assert.doesNotMatch(html,/SABOR & CIA/);
  assert.doesNotMatch(html,/secret=nao-repassar/);
  assert.match(html,/utm_source=bio/);
  assert.match(html,/utm_medium=link_hub/);
});

test("checkout recebe conteúdo por posição e não parâmetros arbitrários", async()=>{
  const r=handleMenuProSalesPage(new Request("https://lc.example/eduzz/menu-pro?utm_source=instagram&utm_campaign=menu&foo=bar"));
  assert.ok(r);
  const html=await r.text();
  assert.match(html,/utm_content=checkout_nav/);
  assert.match(html,/utm_content=checkout_hero/);
  assert.match(html,/utm_content=checkout_offer/);
  assert.match(html,/utm_content=checkout_closing/);
  assert.match(html,/utm_content=checkout_sticky/);
  assert.doesNotMatch(html,/foo=bar/);
});

test("página comercial inclui SEO, acessibilidade e hardening de resposta", async()=>{
  const r=handleMenuProSalesPage(new Request("https://lc.example/eduzz/menu-pro"));
  assert.ok(r);
  const html=await r.text();
  assert.match(html,/name="robots"/);
  assert.match(html,/application\/ld\+json/);
  assert.match(html,/twitter:card/);
  assert.match(html,/class="skip"/);
  assert.match(html,/menu-pro-sales\.js/);
  assert.match(r.headers.get("content-security-policy")||"",/frame-src 'self'/);
  assert.equal(r.headers.get("x-frame-options"),"DENY");
  assert.match(r.headers.get("cache-control")||"",/s-maxage=300/);
});

test("analytics comercial rejeita evento fora da allowlist", async()=>{
  let fetched=false;
  globalThis.fetch=async()=>{fetched=true;return new Response("",{status:201})};
  const r=await handleEduzzRequest(new Request("https://lc.example/v1/eduzz/menu-pro/event",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({event_name:"evento_inventado",session_id:"s1"})
  }),{SUPABASE_URL:"https://project.supabase.co",SUPABASE_SECRET_KEY:"service-test"});
  assert.ok(r);
  assert.equal(r.status,422);
  assert.equal(fetched,false);
});

test("analytics comercial aceita eventos conhecidos e sanitiza metadata", async()=>{
  let inserted:any=null;
  globalThis.fetch=async(_input,init)=>{
    inserted=JSON.parse(String(init?.body||"{}"));
    return new Response("",{status:201});
  };
  const r=await handleEduzzRequest(new Request("https://lc.example/v1/eduzz/menu-pro/event",{
    method:"POST",
    headers:{"content-type":"application/json","cf-connecting-ip":"203.0.113.10"},
    body:JSON.stringify({
      event_name:"click_checkout",session_id:"s2",path:"/eduzz/menu-pro",
      metadata:{placement:"hero",label:"Comprar",customer:"não armazenar",phone:"73999999999"}
    })
  }),{SUPABASE_URL:"https://project.supabase.co",SUPABASE_SECRET_KEY:"service-test"});
  assert.ok(r);
  assert.equal(r.status,200);
  assert.equal(inserted.metadata.placement,"hero");
  assert.equal(inserted.metadata.label,"Comprar");
  assert.equal(inserted.metadata.customer,undefined);
  assert.equal(inserted.metadata.phone,undefined);
});

test("analytics comercial limita payload declarado", async()=>{
  const r=await handleEduzzRequest(new Request("https://lc.example/v1/eduzz/menu-pro/event",{
    method:"POST",
    headers:{"content-type":"application/json","content-length":"20000"},
    body:JSON.stringify({event_name:"view_sales_page",session_id:"s3"})
  }),{SUPABASE_URL:"https://project.supabase.co",SUPABASE_SECRET_KEY:"service-test"});
  assert.ok(r);
  assert.equal(r.status,413);
});


test("assets externos da página comercial têm sintaxe e estilos esperados", () => {
  const js = readFileSync(new URL("../public/assets/menu-pro-sales.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/assets/menu-pro.css", import.meta.url), "utf8");
  assert.doesNotThrow(() => new Function(js));
  assert.match(js, /thresholds=\[25,50,75,90\]/);
  assert.match(js, /send\("scroll_"\+value/);
  assert.match(js, /data-demo-frame/);
  assert.match(css, /\.live-demo-frame/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /\.phone\{/);
  assert.doesNotMatch(css, /SABOR & CIA/);
});


test("engine real do Menu Pro possui persistência, acessibilidade, preview e analytics de funil", () => {
  const js = readFileSync(new URL("../public/assets/menu-pro-app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/assets/menu-pro-app.css", import.meta.url), "utf8");
  assert.doesNotThrow(() => new Function(js));
  assert.match(js, /CART_TTL=6\*60\*60\*1000/);
  assert.match(js, /function trapFocus/);
  assert.match(js, /demo_whatsapp_opened/);
  assert.match(js, /checkout_form_started/);
  assert.match(js, /addon_select/);
  assert.match(js, /data-addon-id/);
  assert.match(js, /function recommendationsFor/);
  assert.match(js, /function showUpsell/);
  assert.match(js, /recommendation_add/);
  assert.match(js, /recommendation_view/);
  assert.match(js, /cartRecommendations/);
  assert.match(css, /\.close-sheet/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /var\(--accent\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("demo não contém mockup estático e usa preview antes de abrir WhatsApp", async () => {
  const r = await handleEduzzRequest(new Request("https://lc.example/eduzz/menu-pro/exemplo?embed=1"),{
    SUPABASE_URL:"https://project.supabase.co",
    SUPABASE_SECRET_KEY:"service-test"
  });
  assert.ok(r);
  const html = await r.text();
  assert.match(html,/Ver mensagem do pedido/);
  assert.match(html,/Mensagem pronta/);
  assert.match(html,/Abrir no WhatsApp/);
  assert.match(html,/data-menu-embed="1"/);
  assert.match(html,/upsellModal/);
  assert.match(html,/Complete seu pedido/);
  assert.match(html,/cartRecommendations/);
  assert.match(html,/menu-pro-app\.js\?v=11/);
  assert.equal(r.headers.get("cache-control"),"no-store");
  assert.doesNotMatch(html,/SABOR & CIA|X-Bacon Artesanal/);
});
