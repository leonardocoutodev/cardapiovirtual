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

test("analytics do proprietário exige membership do próprio estabelecimento", async () => {
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
    if (url.pathname === "/rest/v1/rpc/menu_pro_analytics_business") {
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.p_business_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      assert.equal(body.p_days, 30);
      return json({
        period_days: 30,
        metrics: { sessions: 7, views: 8, whatsapp_generated: 2, intent_value_cents: 7800, conversion_rate: 28.57 },
        funnel: {},
        daily: [],
        top_products: [],
        sources: []
      });
    }
    throw new Error("Rota inesperada: " + url.pathname + "?" + url.searchParams);
  };

  const response = await handleMenuProOwnerRequest(new Request(
    "https://lc.example/v1/menu-pro/owner/businesses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/analytics?days=30",
    { headers: { authorization: "Bearer owner-token" } }
  ), env);
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.analytics.metrics.sessions, 7);
  assert.equal(body.analytics.metrics.whatsapp_generated, 2);
});

test("analytics não pode consultar business_id de outro cliente", async () => {
  globalThis.fetch = async (input) => {
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
    throw new Error("RPC não deveria ser chamado para outro tenant");
  };
  const response = await handleMenuProOwnerRequest(new Request(
    "https://lc.example/v1/menu-pro/owner/businesses/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/analytics?days=30",
    { headers: { authorization: "Bearer owner-token" } }
  ), env);
  assert.ok(response);
  assert.equal(response.status, 403);
});

test("storefront envia UTM mas não envia PII do consumidor ao analytics", () => {
  const src = readFileSync(new URL("../public/assets/menu-pro-app.js", import.meta.url), "utf8");
  assert.match(src, /utm_source:TRACK_PARAMS\.get\("utm_source"\)/);
  assert.match(src, /menu_generate_whatsapp/);
  assert.match(src, /business_slug:SLUG/);
  const trackStart = src.indexOf("function track(name,meta)");
  assert.ok(trackStart > 0);
  const trackBlock = src.slice(trackStart, trackStart + 1400);
  assert.doesNotMatch(trackBlock, /customer|phone|street|number|neighborhood|address|orderNotes|previewText/);
});

test("migração de analytics mantém tabela fora do acesso direto do navegador", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260904160714_create_menu_pro_privacy_first_analytics.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.menu_pro_analytics_events from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.menu_pro_analytics_events to service_role/i);
  assert.match(sql, /never customer identity, phone, address or order text/i);
});

test("interfaces master e proprietário apresentam analytics sem chamar intenção de faturamento", () => {
  const owner = readFileSync(new URL("../public/menu-pro-owner.html", import.meta.url), "utf8");
  const master = readFileSync(new URL("../src/app-page.ts", import.meta.url), "utf8");
  assert.match(owner, /VALOR DE INTENÇÃO/);
  assert.match(owner, /não é faturamento confirmado/);
  assert.match(master, /Valor de intenção/);
  assert.match(master, /não representa faturamento confirmado/);
  assert.match(master, /menu-analytics/);
});
