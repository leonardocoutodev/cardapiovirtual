import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { handleEduzzWebhookRequest, verifyEduzzSignature } from "../src/eduzz-webhook.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const baseEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "service-test",
  EDUZZ_WEBHOOK_SECRET: "eduzz-secret-test"
};

const paidPayload = {
  id: "evt_paid_001",
  event: "myeduzz.invoice_paid",
  sentDate: "2026-09-04T16:50:00.000Z",
  data: {
    id: "invoice-001",
    status: "paid",
    buyer: {
      id: "buyer-001",
      name: "Cliente Teste",
      document: "11122233344",
      email: "cliente@example.com",
      cellphone: "73999999999",
      address: { street: "Rua que não deve ser persistida", number: "10" }
    },
    offer: { name: "LC Menu Pro" },
    utm: { source: "instagram", medium: "social", campaign: "menu_pro" },
    price: { currency: "BRL", value: 197 },
    paid: { currency: "BRL", value: 197 },
    paymentMethod: "pix",
    transaction: { id: "transaction-001", key: "secret-transaction-key" },
    contract: { id: "contract-001", status: "upToDate" },
    items: [{
      productId: "product-menu-pro",
      name: "LC Menu Pro",
      billingType: "recurrence",
      skuReference: "lc-menu-pro",
      isBump: false,
      price: { currency: "BRL", value: 197 }
    }]
  }
};

function signature(secret: string, raw: string) {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

test("verificação HMAC da Eduzz usa o corpo bruto e aceita prefixo sha256", async () => {
  const raw = JSON.stringify({ id: "ping-1", event: "ping", data: { message: "ping" } });
  const sig = signature(baseEnv.EDUZZ_WEBHOOK_SECRET, raw);
  assert.equal(await verifyEduzzSignature(baseEnv.EDUZZ_WEBHOOK_SECRET, raw, sig), true);
  assert.equal(await verifyEduzzSignature(baseEnv.EDUZZ_WEBHOOK_SECRET, raw, "sha256=" + sig), true);
  assert.equal(await verifyEduzzSignature(baseEnv.EDUZZ_WEBHOOK_SECRET, raw + "x", sig), false);
});

test("endpoint de status não expõe a chave e informa quando falta configuração", async () => {
  const r = await handleEduzzWebhookRequest(
    new Request("https://lc.example/v1/webhooks/eduzz"),
    { ...baseEnv, EDUZZ_WEBHOOK_SECRET: undefined }
  );
  assert.ok(r);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.configured, false);
  assert.equal(body.product_filter_mode, "exact_name_fallback");
  assert.equal(JSON.stringify(body).includes("eduzz-secret-test"), false);
});

test("webhook rejeita assinatura inválida antes de acessar o banco", async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error("não deveria acessar o Supabase"); };
  const raw = JSON.stringify(paidPayload);
  const r = await handleEduzzWebhookRequest(
    new Request("https://lc.example/v1/webhooks/eduzz", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": "invalid" },
      body: raw
    }),
    baseEnv
  );
  assert.ok(r);
  assert.equal(r.status, 401);
  assert.equal(fetched, false);
});

test("fatura paga do LC Menu Pro vira evento normalizado sem corpo bruto ou endereço", async () => {
  let normalized: any = null;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/rest/v1/rpc/menu_pro_process_eduzz_event");
    normalized = JSON.parse(String(init?.body || "{}")).p_event;
    return new Response(JSON.stringify({
      ok: true,
      duplicate: false,
      processing_status: "processed",
      purchase_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const raw = JSON.stringify(paidPayload);
  const r = await handleEduzzWebhookRequest(
    new Request("https://lc.example/v1/webhooks/eduzz", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": signature(baseEnv.EDUZZ_WEBHOOK_SECRET, raw)
      },
      body: raw
    }),
    baseEnv
  );
  assert.ok(r);
  assert.equal(r.status, 200);
  assert.equal(normalized.event_name, "myeduzz.invoice_paid");
  assert.equal(normalized.invoice_id, "invoice-001");
  assert.equal(normalized.transaction_id, "transaction-001");
  assert.equal(normalized.contract_id, "contract-001");
  assert.equal(normalized.product_id, "product-menu-pro");
  assert.equal(normalized.product_match, true);
  assert.equal(normalized.billing_status, "active");
  assert.equal(normalized.gross_cents, 19700);
  assert.equal(normalized.paid_cents, 19700);
  assert.equal(normalized.utm.source, "instagram");
  const serialized = JSON.stringify(normalized);
  assert.equal(serialized.includes("11122233344"), false);
  assert.equal(serialized.includes("Rua que não deve ser persistida"), false);
  assert.equal(serialized.includes("secret-transaction-key"), false);
});

test("quando IDs de produto são configurados, eles prevalecem sobre fallback por nome", async () => {
  let normalized: any = null;
  globalThis.fetch = async (_input, init) => {
    normalized = JSON.parse(String(init?.body || "{}")).p_event;
    return new Response(JSON.stringify({ ok: true, processing_status: "ignored" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const raw = JSON.stringify(paidPayload);
  const r = await handleEduzzWebhookRequest(
    new Request("https://lc.example/v1/webhooks/eduzz", {
      method: "POST",
      headers: { "x-signature": signature(baseEnv.EDUZZ_WEBHOOK_SECRET, raw) },
      body: raw
    }),
    { ...baseEnv, EDUZZ_MENU_PRO_PRODUCT_IDS: "different-product" }
  );
  assert.ok(r);
  assert.equal(r.status, 200);
  assert.equal(normalized.product_match, false);
});


test("contrato atualizado reconhece produto, status e telefone estruturado da Eduzz", async () => {
  let normalized: any = null;
  globalThis.fetch = async (_input, init) => {
    normalized = JSON.parse(String(init?.body || "{}")).p_event;
    return new Response(JSON.stringify({ ok: true, processing_status: "processed" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const payload = {
    id: "contract-event-001",
    event: "myeduzz.contract_updated",
    sentDate: "2026-09-04T17:00:00.000Z",
    data: {
      products: [{ id: "product-menu-pro", name: "LC Menu Pro", price: { currency: "BRL", value: 49.9 } }],
      contract: { id: "contract-001", status: "upToDate", payment: { method: "creditCard" } },
      customer: {
        name: "Cliente Contrato",
        email: "contrato@example.com",
        phone: { countryCode: "55", areaCode: "73", number: "999999999" }
      }
    }
  };
  const raw = JSON.stringify(payload);
  const r = await handleEduzzWebhookRequest(
    new Request("https://lc.example/v1/webhooks/eduzz", {
      method: "POST",
      headers: { "x-signature": signature(baseEnv.EDUZZ_WEBHOOK_SECRET, raw) },
      body: raw
    }),
    baseEnv
  );
  assert.ok(r);
  assert.equal(r.status, 200);
  assert.equal(normalized.product_match, true);
  assert.equal(normalized.product_id, "product-menu-pro");
  assert.equal(normalized.contract_id, "contract-001");
  assert.equal(normalized.billing_status, "active");
  assert.equal(normalized.buyer_email, "contrato@example.com");
  assert.equal(normalized.buyer_phone, "5573999999999");
});

test("fatura aberta usa o nome oficial myeduzz.invoice_opened e fica pendente", async () => {
  let normalized: any = null;
  globalThis.fetch = async (_input, init) => {
    normalized = JSON.parse(String(init?.body || "{}")).p_event;
    return new Response(JSON.stringify({ ok: true, processing_status: "processed" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const payload = {
    ...paidPayload,
    id: "evt_opened_001",
    event: "myeduzz.invoice_opened",
    data: { ...paidPayload.data, id: "invoice-opened-001", status: "open" }
  };
  const raw = JSON.stringify(payload);
  await handleEduzzWebhookRequest(
    new Request("https://lc.example/v1/webhooks/eduzz", {
      method: "POST",
      headers: { "x-signature": signature(baseEnv.EDUZZ_WEBHOOK_SECRET, raw) },
      body: raw
    }),
    baseEnv
  );
  assert.equal(normalized.billing_status, "pending");
});

test("onboarding passa a exigir compra paga quando o webhook está configurado", () => {
  const src = readFileSync(new URL("../src/eduzz-pages-v3.ts", import.meta.url), "utf8");
  assert.match(src, /if \(env\.EDUZZ_WEBHOOK_SECRET\)/);
  assert.match(src, /menu_pro_validate_eduzz_purchase/);
  assert.match(src, /paid_purchase_not_found/);
  assert.match(src, /Use o mesmo e-mail informado na compra pela Eduzz/);
});

test("migração Eduzz mantém compras e eventos fora do acesso direto do navegador", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260904164921_create_menu_pro_eduzz_automation.sql", import.meta.url), "utf8");
  assert.match(sql, /menu_pro_eduzz_events[\s\S]*enable row level security/i);
  assert.match(sql, /revoke all on table public\.menu_pro_eduzz_events from public, anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.menu_pro_eduzz_purchases from public, anon, authenticated/i);
  assert.match(sql, /event_id text primary key/i);
  assert.match(sql, /Raw webhook bodies are never stored/i);
  assert.match(sql, /menu_pro_process_eduzz_event/);
});


test("fluxo sintético pago conecta webhook Eduzz ao onboarding elegível", async () => {
  let paid = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/rpc/menu_pro_process_eduzz_event") {
      const normalized = JSON.parse(String(init?.body || "{}")).p_event;
      assert.equal(normalized.product_match, true);
      assert.equal(normalized.billing_status, "active");
      paid = true;
      return Response.json({ ok: true, processing_status: "processed", purchase_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    }
    if (url.pathname === "/rest/v1/rpc/menu_pro_validate_eduzz_purchase") {
      return Response.json(paid ? {
        eligible: true,
        purchase_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reference: "transaction-001"
      } : { eligible: false });
    }
    if (url.pathname === "/rest/v1/eduzz_onboarding_submissions") {
      assert.equal(paid, true);
      const inserted = JSON.parse(String(init?.body || "{}"));
      assert.equal(inserted.email, "cliente@example.com");
      assert.equal(inserted.metadata.purchase_verified, true);
      return Response.json([{ ...inserted, business_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }], { status: 201 });
    }
    throw new Error("Rota inesperada: " + url.pathname);
  };

  const raw = JSON.stringify(paidPayload);
  const webhook = await handleEduzzWebhookRequest(
    new Request("https://lc.example/v1/webhooks/eduzz", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature(baseEnv.EDUZZ_WEBHOOK_SECRET, raw) },
      body: raw
    }),
    { ...baseEnv, EDUZZ_MENU_PRO_PRODUCT_IDS: "product-menu-pro" }
  );
  assert.ok(webhook);
  assert.equal(webhook.status, 200);
  assert.equal(paid, true);

  const form = new FormData();
  form.set("contact_name", "Cliente Teste");
  form.set("whatsapp", "73999999999");
  form.set("email", "cliente@example.com");
  form.set("business_name", "Negócio Teste");
  form.set("segment", "Hamburgueria");
  form.set("order_whatsapp", "73999999999");
  form.set("business_hours", "18h às 23h");
  form.set("consent_accuracy", "on");
  form.set("consent_assets", "on");
  form.set("transaction_id", "transaction-001");

  const { handleEduzzRequest } = await import("../src/eduzz-pages.ts");
  const onboarding = await handleEduzzRequest(
    new Request("https://lc.example/v1/eduzz/menu-pro/onboarding", { method: "POST", body: form }),
    baseEnv
  );
  assert.ok(onboarding);
  assert.equal(onboarding.status, 200);
  const body = await onboarding.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "received");
});
