import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { handleMenuProOwnerRequest } from "../src/menu-pro-owner-api.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test",
  SUPABASE_SECRET_KEY: "service-test"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("portal do proprietário lista somente estabelecimentos liberados", async () => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer owner-token");
      return json({ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", email_confirmed_at: "2026-09-04T10:00:00Z" });
    }
    if (url.pathname === "/rest/v1/menu_pro_members") {
      return json([{ business_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", role: "owner", status: "active" }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_businesses" && url.searchParams.get("owner_portal_enabled") === "eq.true" && url.searchParams.has("id")) {
      return json([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_businesses" && url.searchParams.get("contact_email")) {
      return json([]);
    }
    if (url.pathname === "/rest/v1/menu_pro_businesses") {
      return json([{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        slug: "burger-do-owner",
        business_name: "Burger do Owner",
        display_name: "Burger do Owner",
        segment: "Hamburgueria",
        city_state: "Ilhéus, BA",
        status: "active",
        billing_status: "active",
        plan_code: "menu_pro_base",
        owner_portal_enabled: true,
        updated_at: "2026-09-04T12:00:00Z"
      }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_categories") {
      return json([{ id: "cat-1", is_active: true }, { id: "cat-2", is_active: false }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_products") {
      return json([{ id: "p1", is_active: true, is_available: true }, { id: "p2", is_active: true, is_available: false }, { id: "p3", is_active: false, is_available: true }]);
    }
    throw new Error("Rota inesperada: " + url.pathname + "?" + url.searchParams);
  };

  const response = await handleMenuProOwnerRequest(new Request("https://lc.example/v1/menu-pro/owner/me", {
    headers: { authorization: "Bearer owner-token" }
  }), env);
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.businesses.length, 1);
  assert.equal(body.businesses[0].public_url, "/lcai/menu/burger-do-owner");
  assert.deepEqual(body.businesses[0].metrics, { categories: 1, products: 2, available: 1 });
});

test("switch master bloqueado remove acesso mesmo com membership ativa", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return json({ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", email_confirmed_at: null });
    if (url.pathname === "/rest/v1/menu_pro_members") {
      return json([{ business_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", role: "owner", status: "active" }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_businesses" && url.searchParams.get("owner_portal_enabled") === "eq.true") return json([]);
    throw new Error("Rota inesperada: " + url.pathname);
  };
  const response = await handleMenuProOwnerRequest(new Request("https://lc.example/v1/menu-pro/owner/me", {
    headers: { authorization: "Bearer owner-token" }
  }), env);
  assert.ok(response);
  const body = await response.json();
  assert.deepEqual(body.businesses, []);
});

test("proprietário não consegue editar outro business_id", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return json({ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", email_confirmed_at: null });
    if (url.pathname === "/rest/v1/menu_pro_members") {
      return json([{ business_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", role: "owner", status: "active" }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_businesses" && url.searchParams.get("owner_portal_enabled") === "eq.true") {
      return json([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]);
    }
    throw new Error("Rota inesperada: " + url.pathname);
  };

  const response = await handleMenuProOwnerRequest(new Request("https://lc.example/v1/menu-pro/owner/businesses/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/products", {
    method: "POST",
    headers: { authorization: "Bearer owner-token", "content-type": "application/json" },
    body: JSON.stringify({ name: "Produto invasor", price_cents: 1000 })
  }), env);
  assert.ok(response);
  assert.equal(response.status, 403);
});

test("asset inválido é recusado antes do upload", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return json({ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", email_confirmed_at: null });
    if (url.pathname === "/rest/v1/menu_pro_members") {
      return json([{ business_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", role: "owner", status: "active" }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_businesses" && url.searchParams.get("owner_portal_enabled") === "eq.true") {
      return json([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]);
    }
    throw new Error("Upload não deveria alcançar rede de storage");
  };
  const form = new FormData();
  form.append("file", new File(["not-image"], "arquivo.txt", { type: "text/plain" }));
  const response = await handleMenuProOwnerRequest(new Request("https://lc.example/v1/menu-pro/owner/businesses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/assets", {
    method: "POST",
    headers: { authorization: "Bearer owner-token" },
    body: form
  }), env);
  assert.ok(response);
  assert.equal(response.status, 400);
});

test("HTML do portal compila JavaScript inline e contém os módulos essenciais", () => {
  const html = readFileSync(new URL("../public/menu-pro-owner.html", import.meta.url), "utf8");
  assert.match(html, /Painel do proprietário/);
  assert.match(html, /Gerenciar cardápio/);
  assert.match(html, /Configurações/);
  assert.match(html, /Novo produto/);
  assert.match(html, /Categorias/);
  assert.match(html, /Enviar imagem/);
  assert.match(html, /Logotipo do estabelecimento/);
  assert.match(html, /Grupos de adicionais/);
  assert.match(html, /newAddonGroup/);
  assert.match(html, /Venda complementar/);
  assert.match(html, /addRecommendation/);
  assert.match(html, /recommendProductSelect/);
  assert.match(html, /purpose","logo"/);
  assert.match(html, /resetPane/);
  assert.match(html, /\/v1\/menu-pro\/owner\/auth\/signup/);
  assert.match(html, /\/v1\/menu-pro\/owner\/auth\/recover/);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach(script => assert.doesNotThrow(() => new Function(script)));
});


test("cadastro do proprietário usa retorno próprio e exige e-mail previamente liberado", async () => {
  let signupCalled = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/menu_pro_businesses") {
      assert.equal(url.searchParams.get("owner_portal_enabled"), "eq.true");
      assert.equal(url.searchParams.get("contact_email"), "eq.owner@example.com");
      return json([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]);
    }
    if (url.pathname === "/auth/v1/signup") {
      signupCalled = true;
      assert.equal(url.searchParams.get("redirect_to"), "https://lc.example/lcai/menu-pro/painel");
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.email, "owner@example.com");
      assert.equal(body.data.account_type, "menu_pro_owner");
      return json({ user: { id: "u-1" }, session: null });
    }
    throw new Error("Rota inesperada: " + url.pathname);
  };
  const response = await handleMenuProOwnerRequest(new Request("https://lc.example/v1/menu-pro/owner/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password: "12345678", full_name: "Owner" })
  }), env);
  assert.ok(response);
  assert.equal(response.status, 201);
  assert.equal(signupCalled, true);
  const body = await response.json();
  assert.equal(body.confirmation_required, true);
});

test("cadastro não cria usuário para e-mail sem portal liberado", async () => {
  let authCalled = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/menu_pro_businesses") return json([]);
    if (url.pathname.startsWith("/auth/v1/")) authCalled = true;
    return json({});
  };
  const response = await handleMenuProOwnerRequest(new Request("https://lc.example/v1/menu-pro/owner/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "naoautorizado@example.com", password: "12345678" })
  }), env);
  assert.ok(response);
  assert.equal(response.status, 201);
  assert.equal(authCalled, false);
});

test("recuperação de senha retorna diretamente ao Portal do Proprietário", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/auth/v1/recover");
    assert.equal(url.searchParams.get("redirect_to"), "https://lc.example/lcai/menu-pro/painel");
    return json({});
  };
  const response = await handleMenuProOwnerRequest(new Request("https://lc.example/v1/menu-pro/owner/auth/recover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com" })
  }), env);
  assert.ok(response);
  assert.equal(response.status, 200);
});


test("proprietário configura venda complementar somente entre produtos do próprio negócio", async () => {
  const sourceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const recommendedId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  let inserted: any = null;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      return json({ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", email_confirmed_at: null });
    }
    if (url.pathname === "/rest/v1/menu_pro_members") {
      return json([{ business_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", role: "owner", status: "active" }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_businesses" && url.searchParams.get("owner_portal_enabled") === "eq.true") {
      return json([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]);
    }
    if (url.pathname === "/rest/v1/menu_pro_products") {
      const id = String(url.searchParams.get("id") || "").replace(/^eq\./, "");
      if (id === sourceId) return json([{ id: sourceId, name: "Burger", price_cents: 2890 }]);
      if (id === recommendedId) return json([{ id: recommendedId, name: "Refrigerante", price_cents: 600 }]);
      return json([]);
    }
    if (url.pathname === "/rest/v1/menu_pro_product_recommendations" && (init?.method || "GET") === "GET") {
      return json([]);
    }
    if (url.pathname === "/rest/v1/menu_pro_product_recommendations" && init?.method === "POST") {
      inserted = JSON.parse(String(init.body || "{}"));
      return json([{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", ...inserted }], 201);
    }
    if (url.pathname === "/rest/v1/menu_pro_admin_activity") return new Response("", { status: 201 });
    throw new Error("Rota inesperada: " + url.pathname + "?" + url.searchParams);
  };

  const response = await handleMenuProOwnerRequest(new Request(
    "https://lc.example/v1/menu-pro/owner/businesses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/products/" + sourceId + "/recommendations",
    {
      method: "POST",
      headers: { authorization: "Bearer owner-token", "content-type": "application/json" },
      body: JSON.stringify({ recommended_product_id: recommendedId, label: "Uma bebida combina com seu burger" })
    }
  ), env);
  assert.ok(response);
  assert.equal(response.status, 201);
  assert.equal(inserted.source_product_id, sourceId);
  assert.equal(inserted.recommended_product_id, recommendedId);
  assert.equal(inserted.business_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});
