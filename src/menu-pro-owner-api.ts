type OwnerEnv = {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY?: string;
};

type AuthUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
};

type OwnerMembership = {
  business_id: string;
  user_id: string;
  role: "owner" | "manager" | "editor" | "viewer";
  status: string;
};

const CATALOG_EDIT_ROLES = new Set(["owner","manager","editor"]);
const SETTINGS_EDIT_ROLES = new Set(["owner","manager"]);
const ASSET_BUCKET = "menu-pro-assets";

export async function handleMenuProOwnerRequest(request: Request, env: OwnerEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/menu-pro/owner")) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: ownerCors(request) });
  }

  try {
    if (request.method === "POST" && url.pathname === "/v1/menu-pro/owner/auth/signup") {
      return created(await ownerSignup(request, env), request);
    }
    if (request.method === "POST" && url.pathname === "/v1/menu-pro/owner/auth/recover") {
      return ok(await ownerRecover(request, env), request);
    }

    const user = await requireOwnerUser(request, env);
    const memberships = await ownerMemberships(env, user, true);

    if (request.method === "GET" && url.pathname === "/v1/menu-pro/owner/me") {
      return ok({ user: { id: user.id, email: user.email || null }, businesses: await ownerBusinessCards(env, memberships) }, request);
    }

    const analyticsMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/analytics$/i);
    if (analyticsMatch && request.method === "GET") {
      const membership = membershipFor(memberships, analyticsMatch[1]);
      const days = analyticsDays(url.searchParams.get("days"));
      return ok({ analytics: await ownerAnalytics(env, membership.business_id, days) }, request);
    }

    const businessMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})$/i);
    if (businessMatch && request.method === "GET") {
      const membership = membershipFor(memberships, businessMatch[1]);
      return ok(await ownerBusinessDetail(env, membership), request);
    }
    if (businessMatch && request.method === "PATCH") {
      const membership = membershipFor(memberships, businessMatch[1], SETTINGS_EDIT_ROLES);
      const input = await readJson(request);
      return ok(await updateOwnerBusiness(env, user.id, membership, input), request);
    }

    const categoriesMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/categories$/i);
    if (categoriesMatch && request.method === "POST") {
      const membership = membershipFor(memberships, categoriesMatch[1], CATALOG_EDIT_ROLES);
      return created(await createCategory(env, user.id, membership, await readJson(request)), request);
    }

    const categoryMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/categories\/([0-9a-f-]{36})$/i);
    if (categoryMatch && request.method === "PATCH") {
      const membership = membershipFor(memberships, categoryMatch[1], CATALOG_EDIT_ROLES);
      return ok(await updateCategory(env, user.id, membership, categoryMatch[2], await readJson(request)), request);
    }
    if (categoryMatch && request.method === "DELETE") {
      const membership = membershipFor(memberships, categoryMatch[1], CATALOG_EDIT_ROLES);
      return ok(await archiveCategory(env, user.id, membership, categoryMatch[2]), request);
    }

    const productsMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/products$/i);
    if (productsMatch && request.method === "POST") {
      const membership = membershipFor(memberships, productsMatch[1], CATALOG_EDIT_ROLES);
      return created(await createProduct(env, user.id, membership, await readJson(request)), request);
    }

    const productMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/products\/([0-9a-f-]{36})$/i);
    if (productMatch && request.method === "PATCH") {
      const membership = membershipFor(memberships, productMatch[1], CATALOG_EDIT_ROLES);
      return ok(await updateProduct(env, user.id, membership, productMatch[2], await readJson(request)), request);
    }
    if (productMatch && request.method === "DELETE") {
      const membership = membershipFor(memberships, productMatch[1], CATALOG_EDIT_ROLES);
      return ok(await archiveProduct(env, user.id, membership, productMatch[2]), request);
    }

    const recommendationsMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/products\/([0-9a-f-]{36})\/recommendations$/i);
    if (recommendationsMatch && request.method === "POST") {
      const membership = membershipFor(memberships, recommendationsMatch[1], CATALOG_EDIT_ROLES);
      return created(await createRecommendation(env, user.id, membership, recommendationsMatch[2], await readJson(request)), request);
    }

    const recommendationMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/products\/([0-9a-f-]{36})\/recommendations\/([0-9a-f-]{36})$/i);
    if (recommendationMatch && request.method === "DELETE") {
      const membership = membershipFor(memberships, recommendationMatch[1], CATALOG_EDIT_ROLES);
      return ok(await archiveRecommendation(env, user.id, membership, recommendationMatch[2], recommendationMatch[3]), request);
    }

    const addonGroupsMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/products\/([0-9a-f-]{36})\/addon-groups$/i);
    if (addonGroupsMatch && request.method === "POST") {
      const membership = membershipFor(memberships, addonGroupsMatch[1], CATALOG_EDIT_ROLES);
      return created(await createAddonGroup(env, user.id, membership, addonGroupsMatch[2], await readJson(request)), request);
    }

    const addonGroupMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/products\/([0-9a-f-]{36})\/addon-groups\/([0-9a-f-]{36})$/i);
    if (addonGroupMatch && request.method === "PATCH") {
      const membership = membershipFor(memberships, addonGroupMatch[1], CATALOG_EDIT_ROLES);
      return ok(await updateAddonGroup(env, user.id, membership, addonGroupMatch[2], addonGroupMatch[3], await readJson(request)), request);
    }
    if (addonGroupMatch && request.method === "DELETE") {
      const membership = membershipFor(memberships, addonGroupMatch[1], CATALOG_EDIT_ROLES);
      return ok(await archiveAddonGroup(env, user.id, membership, addonGroupMatch[2], addonGroupMatch[3]), request);
    }

    const addonsMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/products\/([0-9a-f-]{36})\/addons$/i);
    if (addonsMatch && request.method === "POST") {
      const membership = membershipFor(memberships, addonsMatch[1], CATALOG_EDIT_ROLES);
      return created(await createAddon(env, user.id, membership, addonsMatch[2], await readJson(request)), request);
    }

    const addonMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/products\/([0-9a-f-]{36})\/addons\/([0-9a-f-]{36})$/i);
    if (addonMatch && request.method === "PATCH") {
      const membership = membershipFor(memberships, addonMatch[1], CATALOG_EDIT_ROLES);
      return ok(await updateAddon(env, user.id, membership, addonMatch[2], addonMatch[3], await readJson(request)), request);
    }
    if (addonMatch && request.method === "DELETE") {
      const membership = membershipFor(memberships, addonMatch[1], CATALOG_EDIT_ROLES);
      return ok(await archiveAddon(env, user.id, membership, addonMatch[2], addonMatch[3]), request);
    }

    const assetsMatch = url.pathname.match(/^\/v1\/menu-pro\/owner\/businesses\/([0-9a-f-]{36})\/assets$/i);
    if (assetsMatch && request.method === "POST") {
      const membership = membershipFor(memberships, assetsMatch[1], CATALOG_EDIT_ROLES);
      return created(await uploadAsset(request, env, user.id, membership), request);
    }

    throw new OwnerError(404, "Rota do painel do proprietário não encontrada");
  } catch (error) {
    const status = error instanceof OwnerError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Erro interno";
    if (status >= 500) console.error("menu_pro_owner_failed", error);
    return fail(message, status, request);
  }
}

class OwnerError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}


async function ownerSignup(request: Request, env: OwnerEnv): Promise<any> {
  const input = await readJson(request);
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const fullName = String(input.full_name || "").trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OwnerError(400, "Informe um e-mail válido.");
  if (password.length < 8 || password.length > 128) throw new OwnerError(400, "A senha deve ter entre 8 e 128 caracteres.");

  const eligible = await restGet<any[]>(env, "menu_pro_businesses", {
    select: "id",
    contact_email: "eq." + postgrestValue(email),
    owner_portal_enabled: "eq.true",
    status: "not.in.(cancelled,archived)",
    limit: "1"
  });

  if (!eligible.length) {
    return { user: null, session: null, confirmation_required: true, message: "Se este e-mail estiver autorizado, você receberá as instruções de acesso." };
  }

  const redirectTo = new URL("/lcai/menu-pro/painel", request.url).toString();
  const auth = await ownerAuthFetch(env, "/signup?redirect_to=" + encodeURIComponent(redirectTo), {
    method: "POST",
    body: JSON.stringify({
      email: email,
      password: password,
      data: fullName ? { full_name: fullName, account_type: "menu_pro_owner" } : { account_type: "menu_pro_owner" }
    })
  });
  return {
    user: auth.user || null,
    session: auth.session || null,
    confirmation_required: !auth.session,
    message: auth.session ? "Acesso criado." : "Confira seu e-mail para confirmar o acesso."
  };
}

async function ownerRecover(request: Request, env: OwnerEnv): Promise<any> {
  const input = await readJson(request);
  const email = String(input.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OwnerError(400, "Informe um e-mail válido.");
  const redirectTo = new URL("/lcai/menu-pro/painel", request.url).toString();
  try {
    await ownerAuthFetch(env, "/recover?redirect_to=" + encodeURIComponent(redirectTo), {
      method: "POST",
      body: JSON.stringify({ email: email })
    });
  } catch (error) {
    if (error instanceof OwnerError && (error.status === 429 || error.status >= 500)) throw error;
  }
  return { ok: true, message: "Se a conta existir, enviaremos as instruções de recuperação." };
}

async function ownerAuthFetch(env: OwnerEnv, path: string, init: RequestInit): Promise<any> {
  const response = await fetch(env.SUPABASE_URL + "/auth/v1" + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: "Bearer " + env.SUPABASE_PUBLISHABLE_KEY,
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
  const raw = await response.text();
  let parsed: any = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const message = parsed?.message || parsed?.msg || parsed?.error_description || parsed?.error || "Não foi possível concluir a autenticação.";
    throw new OwnerError(response.status >= 500 ? 502 : response.status, String(message).slice(0, 300));
  }
  return parsed || {};
}

async function requireOwnerUser(request: Request, env: OwnerEnv): Promise<AuthUser> {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new OwnerError(401, "Faça login para acessar seu cardápio.");
  const token = auth.slice(7).trim();
  if (!token) throw new OwnerError(401, "Sessão inválida.");

  const response = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: "Bearer " + token
    }
  });
  if (!response.ok) throw new OwnerError(401, "Sua sessão expirou. Entre novamente.");
  const user = await response.json() as AuthUser;
  if (!user.id) throw new OwnerError(401, "Sessão inválida.");
  return user;
}

async function ownerMemberships(env: OwnerEnv, user: AuthUser, claim: boolean): Promise<OwnerMembership[]> {
  let rows = await restGet<OwnerMembership[]>(env, "menu_pro_members", {
    select: "business_id,user_id,role,status",
    user_id: "eq." + user.id,
    status: "eq.active",
    limit: "100"
  });

  if (claim && user.email && user.email_confirmed_at) {
    await claimByVerifiedEmail(env, user);
    rows = await restGet<OwnerMembership[]>(env, "menu_pro_members", {
      select: "business_id,user_id,role,status",
      user_id: "eq." + user.id,
      status: "eq.active",
      limit: "100"
    });
  }

  if (!rows.length) return [];
  const allowed = await restGet<any[]>(env, "menu_pro_businesses", {
    select: "id",
    id: "in.(" + rows.map(item => item.business_id).join(",") + ")",
    owner_portal_enabled: "eq.true",
    status: "not.in.(cancelled,archived)",
    limit: "100"
  });
  const allowedIds = new Set(allowed.map(item => String(item.id)));
  return rows.filter(item => allowedIds.has(item.business_id));
}

async function claimByVerifiedEmail(env: OwnerEnv, user: AuthUser): Promise<void> {
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) return;

  const businesses = await restGet<any[]>(env, "menu_pro_businesses", {
    select: "id,owner_user_id,contact_email,owner_portal_enabled,status,is_demo",
    contact_email: "eq." + postgrestValue(email),
    owner_portal_enabled: "eq.true",
    status: "not.in.(cancelled,archived)",
    limit: "20"
  });

  for (const business of businesses) {
    if (business.owner_user_id && business.owner_user_id !== user.id) continue;

    const existingMembership = await restGet<any[]>(env, "menu_pro_members", {
      select: "business_id,user_id,role,status",
      business_id: "eq." + business.id,
      user_id: "eq." + user.id,
      limit: "1"
    });
    if (existingMembership.length) continue;

    await restPatch(env, "menu_pro_businesses", "id=eq." + business.id, {
      owner_user_id: user.id,
      owner_portal_claimed_at: new Date().toISOString()
    });
    await restUpsert(env, "menu_pro_members?on_conflict=business_id,user_id", {
      business_id: business.id,
      user_id: user.id,
      role: "owner",
      status: "active",
      accepted_at: new Date().toISOString()
    });
    await logActivity(env, business.id, user.id, "owner_portal_claimed", { email: email });
  }
}

function membershipFor(memberships: OwnerMembership[], businessId: string, allowed?: Set<string>): OwnerMembership {
  const membership = memberships.find(item => item.business_id === businessId && item.status === "active");
  if (!membership) throw new OwnerError(403, "Você não tem acesso a este estabelecimento.");
  if (allowed && !allowed.has(membership.role)) throw new OwnerError(403, "Seu perfil não pode alterar esta informação.");
  return membership;
}

async function ownerBusinessCards(env: OwnerEnv, memberships: OwnerMembership[]): Promise<any[]> {
  if (!memberships.length) return [];
  const ids = memberships.map(item => item.business_id);
  const businesses = await restGet<any[]>(env, "menu_pro_businesses", {
    select: "id,slug,business_name,display_name,segment,city_state,status,billing_status,plan_code,owner_portal_enabled,updated_at",
    id: "in.(" + ids.join(",") + ")",
    limit: "100"
  });

  return Promise.all(businesses.map(async business => {
    const role = memberships.find(item => item.business_id === business.id)?.role || "viewer";
    const [categories, products] = await Promise.all([
      restGet<any[]>(env, "menu_pro_categories", { select: "id,is_active", business_id: "eq." + business.id, limit: "1000" }),
      restGet<any[]>(env, "menu_pro_products", { select: "id,is_active,is_available", business_id: "eq." + business.id, limit: "3000" })
    ]);
    return {
      ...business,
      role: role,
      public_url: business.status === "active" || business.status === "published" ? "/lcai/menu/" + business.slug : null,
      metrics: {
        categories: categories.filter(item => item.is_active !== false).length,
        products: products.filter(item => item.is_active !== false).length,
        available: products.filter(item => item.is_active !== false && item.is_available !== false).length
      }
    };
  }));
}


async function ownerAnalytics(env: OwnerEnv, businessId: string, days: number): Promise<any> {
  const analytics = await restRpc<any>(env, "menu_pro_analytics_business", {
    p_business_id: businessId,
    p_days: days
  });
  return analytics && typeof analytics === "object" ? analytics : {
    period_days: days,
    metrics: {},
    funnel: {},
    daily: [],
    top_products: [],
    sources: []
  };
}

function analyticsDays(value: string | null): number {
  const days = Number(value || 30);
  if (!Number.isFinite(days)) return 30;
  return Math.max(1, Math.min(365, Math.round(days)));
}

async function ownerBusinessDetail(env: OwnerEnv, membership: OwnerMembership): Promise<any> {
  const businesses = await restGet<any[]>(env, "menu_pro_businesses", {
    select: "id,slug,business_name,display_name,segment,contact_email,contact_whatsapp,order_whatsapp,city_state,status,billing_status,plan_code,settings,theme,owner_portal_enabled,updated_at",
    id: "eq." + membership.business_id,
    limit: "1"
  });
  const business = businesses[0];
  if (!business) throw new OwnerError(404, "Estabelecimento não encontrado.");

  const [categories, products, addons, addonGroups, recommendations] = await Promise.all([
    restGet<any[]>(env, "menu_pro_categories", {
      select: "id,business_id,name,slug,description,sort_order,is_active,updated_at",
      business_id: "eq." + business.id,
      order: "sort_order.asc,name.asc",
      limit: "1000"
    }),
    restGet<any[]>(env, "menu_pro_products", {
      select: "id,business_id,category_id,sku,name,slug,description,price_cents,compare_at_price_cents,image_url,image_alt,is_active,is_available,is_featured,sort_order,tags,updated_at",
      business_id: "eq." + business.id,
      order: "sort_order.asc,name.asc",
      limit: "3000"
    }),
    restGet<any[]>(env, "menu_pro_product_addons", {
      select: "id,business_id,product_id,group_id,name,price_cents,is_active,sort_order,updated_at",
      business_id: "eq." + business.id,
      order: "sort_order.asc,name.asc",
      limit: "10000"
    }),
    restGet<any[]>(env, "menu_pro_addon_groups", {
      select: "id,business_id,product_id,name,selection_type,min_select,max_select,is_active,sort_order,updated_at",
      business_id: "eq." + business.id,
      order: "sort_order.asc,name.asc",
      limit: "3000"
    }),
    restGet<any[]>(env, "menu_pro_product_recommendations", {
      select: "id,business_id,source_product_id,recommended_product_id,label,is_active,sort_order,updated_at",
      business_id: "eq." + business.id,
      order: "sort_order.asc,created_at.asc",
      limit: "10000"
    })
  ]);

  const addonMap = new Map<string, any[]>();
  for (const addon of addons) {
    const list = addonMap.get(addon.product_id) || [];
    list.push(addon);
    addonMap.set(addon.product_id, list);
  }
  const groupMap = new Map<string, any[]>();
  for (const group of addonGroups) {
    const list = groupMap.get(group.product_id) || [];
    list.push(group);
    groupMap.set(group.product_id, list);
  }
  const recommendationMap = new Map<string, any[]>();
  for (const recommendation of recommendations) {
    const list = recommendationMap.get(recommendation.source_product_id) || [];
    list.push(recommendation);
    recommendationMap.set(recommendation.source_product_id, list);
  }

  return {
    business: {
      ...business,
      role: membership.role,
      public_url: business.status === "active" || business.status === "published" ? "/lcai/menu/" + business.slug : null
    },
    categories: categories,
    products: products.map(product => ({ ...product, addons: addonMap.get(product.id) || [], addon_groups: groupMap.get(product.id) || [], recommendations: recommendationMap.get(product.id) || [] })),
    permissions: {
      edit_settings: SETTINGS_EDIT_ROLES.has(membership.role),
      edit_catalog: CATALOG_EDIT_ROLES.has(membership.role)
    }
  };
}

async function updateOwnerBusiness(env: OwnerEnv, actorId: string, membership: OwnerMembership, input: Record<string, unknown>): Promise<any> {
  const rows = await restGet<any[]>(env, "menu_pro_businesses", {
    select: "id,display_name,segment,contact_email,contact_whatsapp,order_whatsapp,city_state,settings,theme,status",
    id: "eq." + membership.business_id,
    limit: "1"
  });
  const existing = rows[0];
  if (!existing) throw new OwnerError(404, "Estabelecimento não encontrado.");

  const patch: Record<string, unknown> = {};
  for (const field of ["display_name","segment","contact_whatsapp","order_whatsapp","city_state"]) {
    if (input[field] !== undefined) patch[field] = limitedText(input[field], field === "display_name" ? 140 : 180, true);
  }

  if (input.settings !== undefined) {
    if (!isObject(input.settings)) throw new OwnerError(400, "Configurações inválidas.");
    const s = input.settings as Record<string, unknown>;
    const settings = isObject(existing.settings) ? { ...existing.settings } : {};
    if (s.business_hours !== undefined) settings.business_hours = limitedText(s.business_hours, 160, true);
    if (s.subtitle !== undefined) settings.subtitle = limitedText(s.subtitle, 180, true);
    if (s.eta_text !== undefined) settings.eta_text = limitedText(s.eta_text, 80, true);
    if (s.cover_image_url !== undefined) settings.cover_image_url = optionalHttpsUrl(s.cover_image_url);
    if (s.minimum_order_cents !== undefined) settings.minimum_order_cents = integer(s.minimum_order_cents, 0, 100000000);
    if (s.delivery_fee_cents !== undefined) settings.delivery_fee_cents = integer(s.delivery_fee_cents, 0, 100000000);
    if (s.service_modes !== undefined) settings.service_modes = stringList(s.service_modes, 8, 60);
    if (s.payment_methods !== undefined) settings.payment_methods = stringList(s.payment_methods, 12, 80);
    patch.settings = settings;
  }

  if (input.theme !== undefined) {
    if (!isObject(input.theme)) throw new OwnerError(400, "Identidade visual inválida.");
    const t = input.theme as Record<string, unknown>;
    const theme = isObject(existing.theme) ? { ...existing.theme } : {};
    if (t.brand_initials !== undefined) theme.brand_initials = limitedText(t.brand_initials, 5, true);
    if (t.accent !== undefined) theme.accent = optionalHex(t.accent);
    if (t.logo_url !== undefined) theme.logo_url = optionalHttpsUrl(t.logo_url);
    patch.theme = theme;
  }

  if (!Object.keys(patch).length) return { business: existing, changed: false };
  const changed = await restPatchReturning(env, "menu_pro_businesses", "id=eq." + membership.business_id, patch);
  await logActivity(env, membership.business_id, actorId, "owner_business_updated", { fields: Object.keys(patch) });
  return { business: changed[0] || null, changed: true };
}

async function createCategory(env: OwnerEnv, actorId: string, membership: OwnerMembership, input: Record<string, unknown>): Promise<any> {
  const name = requiredText(input.name, 80, "Nome da categoria");
  const slug = await uniqueSlug(env, "menu_pro_categories", membership.business_id, name, null);
  const created = await restPost<any[]>(env, "menu_pro_categories", {
    business_id: membership.business_id,
    name: name,
    slug: slug,
    description: limitedText(input.description, 500, true),
    sort_order: integer(input.sort_order, 0, 10000, 100),
    is_active: input.is_active !== false
  });
  await logActivity(env, membership.business_id, actorId, "owner_category_created", { category_id: created[0]?.id || null, name: name });
  return { category: created[0] || null };
}

async function updateCategory(env: OwnerEnv, actorId: string, membership: OwnerMembership, categoryId: string, input: Record<string, unknown>): Promise<any> {
  await assertCategory(env, membership.business_id, categoryId);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = requiredText(input.name, 80, "Nome da categoria");
  if (input.description !== undefined) patch.description = limitedText(input.description, 500, true);
  if (input.sort_order !== undefined) patch.sort_order = integer(input.sort_order, 0, 10000);
  if (input.is_active !== undefined) patch.is_active = Boolean(input.is_active);
  if (!Object.keys(patch).length) return { changed: false };
  const changed = await restPatchReturning(env, "menu_pro_categories", "id=eq." + categoryId + "&business_id=eq." + membership.business_id, patch);
  await logActivity(env, membership.business_id, actorId, "owner_category_updated", { category_id: categoryId, fields: Object.keys(patch) });
  return { category: changed[0] || null, changed: true };
}

async function archiveCategory(env: OwnerEnv, actorId: string, membership: OwnerMembership, categoryId: string): Promise<any> {
  await assertCategory(env, membership.business_id, categoryId);
  const products = await restGet<any[]>(env, "menu_pro_products", {
    select: "id",
    business_id: "eq." + membership.business_id,
    category_id: "eq." + categoryId,
    is_active: "eq.true",
    limit: "1"
  });
  if (products.length) throw new OwnerError(409, "Esta categoria ainda possui produtos ativos. Mova ou desative os produtos antes.");
  await restPatch(env, "menu_pro_categories", "id=eq." + categoryId + "&business_id=eq." + membership.business_id, { is_active: false });
  await logActivity(env, membership.business_id, actorId, "owner_category_archived", { category_id: categoryId });
  return { archived: true };
}

async function createProduct(env: OwnerEnv, actorId: string, membership: OwnerMembership, input: Record<string, unknown>): Promise<any> {
  const name = requiredText(input.name, 140, "Nome do produto");
  const categoryId = await optionalCategoryId(env, membership.business_id, input.category_id);
  const price = integer(input.price_cents, 0, 100000000);
  const slug = await uniqueSlug(env, "menu_pro_products", membership.business_id, name, null);
  const created = await restPost<any[]>(env, "menu_pro_products", {
    business_id: membership.business_id,
    category_id: categoryId,
    sku: limitedText(input.sku, 80, true),
    name: name,
    slug: slug,
    description: limitedText(input.description, 1200, true),
    price_cents: price,
    compare_at_price_cents: optionalInteger(input.compare_at_price_cents, price, 100000000),
    image_url: optionalHttpsUrl(input.image_url),
    image_alt: limitedText(input.image_alt, 200, true) || name,
    is_active: input.is_active !== false,
    is_available: input.is_available !== false,
    is_featured: input.is_featured === true,
    sort_order: integer(input.sort_order, 0, 10000, 100),
    tags: stringList(input.tags, 20, 50)
  });
  await logActivity(env, membership.business_id, actorId, "owner_product_created", { product_id: created[0]?.id || null, name: name });
  return { product: created[0] || null };
}

async function updateProduct(env: OwnerEnv, actorId: string, membership: OwnerMembership, productId: string, input: Record<string, unknown>): Promise<any> {
  const product = await assertProduct(env, membership.business_id, productId);
  const patch: Record<string, unknown> = {};
  if (input.category_id !== undefined) patch.category_id = await optionalCategoryId(env, membership.business_id, input.category_id);
  if (input.sku !== undefined) patch.sku = limitedText(input.sku, 80, true);
  if (input.name !== undefined) patch.name = requiredText(input.name, 140, "Nome do produto");
  if (input.description !== undefined) patch.description = limitedText(input.description, 1200, true);
  if (input.price_cents !== undefined) patch.price_cents = integer(input.price_cents, 0, 100000000);
  const effectivePrice = Number(patch.price_cents ?? product.price_cents ?? 0);
  if (input.compare_at_price_cents !== undefined) patch.compare_at_price_cents = optionalInteger(input.compare_at_price_cents, effectivePrice, 100000000);
  if (input.image_url !== undefined) patch.image_url = optionalHttpsUrl(input.image_url);
  if (input.image_alt !== undefined) patch.image_alt = limitedText(input.image_alt, 200, true);
  if (input.is_active !== undefined) patch.is_active = Boolean(input.is_active);
  if (input.is_available !== undefined) patch.is_available = Boolean(input.is_available);
  if (input.is_featured !== undefined) patch.is_featured = Boolean(input.is_featured);
  if (input.sort_order !== undefined) patch.sort_order = integer(input.sort_order, 0, 10000);
  if (input.tags !== undefined) patch.tags = stringList(input.tags, 20, 50);
  if (!Object.keys(patch).length) return { product: product, changed: false };

  const changed = await restPatchReturning(env, "menu_pro_products", "id=eq." + productId + "&business_id=eq." + membership.business_id, patch);
  await logActivity(env, membership.business_id, actorId, "owner_product_updated", { product_id: productId, fields: Object.keys(patch) });
  return { product: changed[0] || null, changed: true };
}

async function archiveProduct(env: OwnerEnv, actorId: string, membership: OwnerMembership, productId: string): Promise<any> {
  await assertProduct(env, membership.business_id, productId);
  await restPatch(env, "menu_pro_products", "id=eq." + productId + "&business_id=eq." + membership.business_id, { is_active: false, is_available: false });
  await logActivity(env, membership.business_id, actorId, "owner_product_archived", { product_id: productId });
  return { archived: true };
}

async function createRecommendation(env: OwnerEnv, actorId: string, membership: OwnerMembership, sourceProductId: string, input: Record<string, unknown>): Promise<any> {
  await assertProduct(env, membership.business_id, sourceProductId);
  const recommendedProductId = String(input.recommended_product_id || "");
  if (!recommendedProductId) throw new OwnerError(400, "Escolha um produto para recomendar.");
  if (recommendedProductId === sourceProductId) throw new OwnerError(400, "Um produto não pode recomendar ele mesmo.");
  await assertProduct(env, membership.business_id, recommendedProductId);
  const existing = await restGet<any[]>(env, "menu_pro_product_recommendations", {
    select: "id,is_active",
    business_id: "eq." + membership.business_id,
    source_product_id: "eq." + sourceProductId,
    recommended_product_id: "eq." + recommendedProductId,
    limit: "1"
  });
  let recommendation: any = null;
  if (existing.length) {
    const changed = await restPatchReturning<any[]>(env, "menu_pro_product_recommendations", "id=eq." + existing[0].id + "&business_id=eq." + membership.business_id, {
      is_active: true,
      label: limitedText(input.label, 100, true),
      sort_order: integer(input.sort_order, 0, 10000, 100)
    });
    recommendation = changed[0] || null;
  } else {
    const created = await restPost<any[]>(env, "menu_pro_product_recommendations", {
      business_id: membership.business_id,
      source_product_id: sourceProductId,
      recommended_product_id: recommendedProductId,
      label: limitedText(input.label, 100, true),
      sort_order: integer(input.sort_order, 0, 10000, 100),
      is_active: true
    });
    recommendation = created[0] || null;
  }
  await logActivity(env, membership.business_id, actorId, "owner_recommendation_saved", { source_product_id: sourceProductId, recommended_product_id: recommendedProductId });
  return { recommendation };
}

async function archiveRecommendation(env: OwnerEnv, actorId: string, membership: OwnerMembership, sourceProductId: string, recommendationId: string): Promise<any> {
  await assertProduct(env, membership.business_id, sourceProductId);
  const rows = await restGet<any[]>(env, "menu_pro_product_recommendations", {
    select: "id,recommended_product_id",
    id: "eq." + recommendationId,
    source_product_id: "eq." + sourceProductId,
    business_id: "eq." + membership.business_id,
    limit: "1"
  });
  if (!rows.length) throw new OwnerError(404, "Sugestão não encontrada.");
  await restPatch(env, "menu_pro_product_recommendations", "id=eq." + recommendationId + "&business_id=eq." + membership.business_id, { is_active: false });
  await logActivity(env, membership.business_id, actorId, "owner_recommendation_archived", { source_product_id: sourceProductId, recommended_product_id: rows[0].recommended_product_id });
  return { archived: true };
}

async function createAddonGroup(env: OwnerEnv, actorId: string, membership: OwnerMembership, productId: string, input: Record<string, unknown>): Promise<any> {
  await assertProduct(env, membership.business_id, productId);
  const name = requiredText(input.name, 100, "Nome do grupo");
  const selectionType = input.selection_type === "single" ? "single" : "multiple";
  const minSelect = integer(input.min_select, 0, 50, selectionType === "single" ? 1 : 0);
  const rawMax = input.max_select;
  const maxSelect = rawMax === null || rawMax === undefined || rawMax === "" ? (selectionType === "single" ? 1 : null) : integer(rawMax, Math.max(1,minSelect), 50);
  const created = await restPost<any[]>(env, "menu_pro_addon_groups", {
    business_id: membership.business_id,
    product_id: productId,
    name,
    selection_type: selectionType,
    min_select: minSelect,
    max_select: maxSelect,
    sort_order: integer(input.sort_order, 0, 10000, 100),
    is_active: input.is_active !== false
  });
  await logActivity(env, membership.business_id, actorId, "owner_addon_group_created", { product_id: productId, group_id: created[0]?.id || null });
  return { group: created[0] || null };
}

async function updateAddonGroup(env: OwnerEnv, actorId: string, membership: OwnerMembership, productId: string, groupId: string, input: Record<string, unknown>): Promise<any> {
  const group = await assertAddonGroup(env, membership.business_id, productId, groupId);
  const patch: Record<string,unknown> = {};
  if (input.name !== undefined) patch.name = requiredText(input.name,100,"Nome do grupo");
  const selectionType = input.selection_type !== undefined ? (input.selection_type === "single" ? "single" : "multiple") : group.selection_type;
  if (input.selection_type !== undefined) patch.selection_type = selectionType;
  const minSelect = input.min_select !== undefined ? integer(input.min_select,0,50) : Number(group.min_select||0);
  if (input.min_select !== undefined) patch.min_select = minSelect;
  if (input.max_select !== undefined) patch.max_select = input.max_select === null || input.max_select === "" ? null : integer(input.max_select,Math.max(1,minSelect),50);
  if (selectionType === "single") {
    patch.min_select = Math.min(1,Math.max(0,minSelect));
    patch.max_select = 1;
  }
  if (input.sort_order !== undefined) patch.sort_order = integer(input.sort_order,0,10000);
  if (input.is_active !== undefined) patch.is_active = Boolean(input.is_active);
  if (!Object.keys(patch).length) return { group, changed:false };
  const changed = await restPatchReturning<any[]>(env,"menu_pro_addon_groups","id=eq."+groupId+"&product_id=eq."+productId+"&business_id=eq."+membership.business_id,patch);
  await logActivity(env,membership.business_id,actorId,"owner_addon_group_updated",{product_id:productId,group_id:groupId,fields:Object.keys(patch)});
  return { group: changed[0] || null, changed:true };
}

async function archiveAddonGroup(env: OwnerEnv, actorId: string, membership: OwnerMembership, productId: string, groupId: string): Promise<any> {
  await assertAddonGroup(env,membership.business_id,productId,groupId);
  await restPatch(env,"menu_pro_product_addons","group_id=eq."+groupId+"&business_id=eq."+membership.business_id,{group_id:null});
  await restPatch(env,"menu_pro_addon_groups","id=eq."+groupId+"&product_id=eq."+productId+"&business_id=eq."+membership.business_id,{is_active:false});
  await logActivity(env,membership.business_id,actorId,"owner_addon_group_archived",{product_id:productId,group_id:groupId});
  return { archived:true };
}

async function createAddon(env: OwnerEnv, actorId: string, membership: OwnerMembership, productId: string, input: Record<string, unknown>): Promise<any> {
  await assertProduct(env, membership.business_id, productId);
  const name = requiredText(input.name, 120, "Nome do adicional");
  const created = await restPost<any[]>(env, "menu_pro_product_addons", {
    business_id: membership.business_id,
    product_id: productId,
    group_id: await optionalAddonGroupId(env, membership.business_id, productId, input.group_id),
    name: name,
    price_cents: integer(input.price_cents, 0, 10000000, 0),
    sort_order: integer(input.sort_order, 0, 10000, 100),
    is_active: input.is_active !== false
  });
  await logActivity(env, membership.business_id, actorId, "owner_addon_created", { product_id: productId, addon_id: created[0]?.id || null });
  return { addon: created[0] || null };
}

async function updateAddon(env: OwnerEnv, actorId: string, membership: OwnerMembership, productId: string, addonId: string, input: Record<string, unknown>): Promise<any> {
  await assertProduct(env, membership.business_id, productId);
  await assertAddon(env, membership.business_id, productId, addonId);
  const patch: Record<string, unknown> = {};
  if (input.group_id !== undefined) patch.group_id = await optionalAddonGroupId(env, membership.business_id, productId, input.group_id);
  if (input.name !== undefined) patch.name = requiredText(input.name, 120, "Nome do adicional");
  if (input.price_cents !== undefined) patch.price_cents = integer(input.price_cents, 0, 10000000);
  if (input.sort_order !== undefined) patch.sort_order = integer(input.sort_order, 0, 10000);
  if (input.is_active !== undefined) patch.is_active = Boolean(input.is_active);
  if (!Object.keys(patch).length) return { changed: false };
  const changed = await restPatchReturning(env, "menu_pro_product_addons", "id=eq." + addonId + "&product_id=eq." + productId + "&business_id=eq." + membership.business_id, patch);
  await logActivity(env, membership.business_id, actorId, "owner_addon_updated", { product_id: productId, addon_id: addonId, fields: Object.keys(patch) });
  return { addon: changed[0] || null, changed: true };
}

async function archiveAddon(env: OwnerEnv, actorId: string, membership: OwnerMembership, productId: string, addonId: string): Promise<any> {
  await assertProduct(env, membership.business_id, productId);
  await assertAddon(env, membership.business_id, productId, addonId);
  await restPatch(env, "menu_pro_product_addons", "id=eq." + addonId + "&product_id=eq." + productId + "&business_id=eq." + membership.business_id, { is_active: false });
  await logActivity(env, membership.business_id, actorId, "owner_addon_archived", { product_id: productId, addon_id: addonId });
  return { archived: true };
}

async function uploadAsset(request: Request, env: OwnerEnv, actorId: string, membership: OwnerMembership): Promise<any> {
  if (!env.SUPABASE_SECRET_KEY) throw new OwnerError(503, "Upload temporariamente indisponível.");
  let form: FormData;
  try { form = await request.formData(); } catch { throw new OwnerError(400, "Arquivo inválido."); }
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new OwnerError(400, "Selecione uma imagem.");
  if (!["image/jpeg","image/png","image/webp"].includes(file.type)) throw new OwnerError(400, "Use JPEG, PNG ou WebP.");
  if (file.size > 5242880) throw new OwnerError(400, "A imagem deve ter no máximo 5 MB.");

  const purposeRaw = String(form.get("purpose") || "product");
  const purpose = ["product","cover","logo"].includes(purposeRaw) ? purposeRaw : "product";
  const ext = file.type === "image/png" ? ".png" : file.type === "image/webp" ? ".webp" : ".jpg";
  const path = membership.business_id + "/" + purpose + "/" + crypto.randomUUID() + ext;
  const encoded = path.split("/").map(encodeURIComponent).join("/");

  const response = await fetch(env.SUPABASE_URL + "/storage/v1/object/" + ASSET_BUCKET + "/" + encoded, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      authorization: "Bearer " + env.SUPABASE_SECRET_KEY,
      "content-type": file.type,
      "x-upsert": "false"
    },
    body: file
  });
  if (!response.ok) throw new OwnerError(502, "Não foi possível enviar a imagem.");

  const publicUrl = env.SUPABASE_URL + "/storage/v1/object/public/" + ASSET_BUCKET + "/" + encoded;
  await logActivity(env, membership.business_id, actorId, "owner_asset_uploaded", { purpose: purpose, path: path, size: file.size });
  return { url: publicUrl, path: path, mime_type: file.type, size: file.size };
}

async function assertCategory(env: OwnerEnv, businessId: string, categoryId: string): Promise<any> {
  const rows = await restGet<any[]>(env, "menu_pro_categories", { select: "id,name", id: "eq." + categoryId, business_id: "eq." + businessId, limit: "1" });
  if (!rows.length) throw new OwnerError(404, "Categoria não encontrada.");
  return rows[0];
}
async function assertProduct(env: OwnerEnv, businessId: string, productId: string): Promise<any> {
  const rows = await restGet<any[]>(env, "menu_pro_products", { select: "id,name,price_cents", id: "eq." + productId, business_id: "eq." + businessId, limit: "1" });
  if (!rows.length) throw new OwnerError(404, "Produto não encontrado.");
  return rows[0];
}
async function assertAddonGroup(env: OwnerEnv, businessId: string, productId: string, groupId: string): Promise<any> {
  const rows = await restGet<any[]>(env,"menu_pro_addon_groups",{select:"id,name,selection_type,min_select,max_select",id:"eq."+groupId,product_id:"eq."+productId,business_id:"eq."+businessId,limit:"1"});
  if (!rows.length) throw new OwnerError(404,"Grupo de adicionais não encontrado.");
  return rows[0];
}
async function optionalAddonGroupId(env: OwnerEnv,businessId: string,productId: string,value: unknown): Promise<string|null> {
  if (value === null || value === undefined || value === "") return null;
  const id = String(value);
  await assertAddonGroup(env,businessId,productId,id);
  return id;
}

async function assertAddon(env: OwnerEnv, businessId: string, productId: string, addonId: string): Promise<any> {
  const rows = await restGet<any[]>(env, "menu_pro_product_addons", { select: "id,name", id: "eq." + addonId, product_id: "eq." + productId, business_id: "eq." + businessId, limit: "1" });
  if (!rows.length) throw new OwnerError(404, "Adicional não encontrado.");
  return rows[0];
}
async function optionalCategoryId(env: OwnerEnv, businessId: string, value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  const id = String(value);
  await assertCategory(env, businessId, id);
  return id;
}

async function uniqueSlug(env: OwnerEnv, table: string, businessId: string, name: string, currentId: string | null): Promise<string> {
  const base = slugify(name).slice(0, 72) || "item";
  let candidate = base;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const query: Record<string,string> = { select: "id", business_id: "eq." + businessId, slug: "eq." + candidate, limit: "1" };
    const rows = await restGet<any[]>(env, table, query);
    if (!rows.length || (currentId && rows[0].id === currentId)) return candidate;
    candidate = base.slice(0, 62) + "-" + crypto.randomUUID().replace(/-/g,"").slice(0,8);
  }
  throw new OwnerError(409, "Não foi possível gerar um identificador único.");
}

function slugify(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").replace(/-+/g,"-");
}

async function logActivity(env: OwnerEnv, businessId: string, actorId: string, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    await restPost(env, "menu_pro_admin_activity", { business_id: businessId, actor_user_id: actorId, action: action, details: details }, false);
  } catch (error) {
    console.warn("menu_pro_owner_activity_failed", error);
  }
}

async function restRpc<T = any>(env: OwnerEnv, fn: string, body: Record<string,unknown>): Promise<T> {
  return restFetch<T>(env, "rpc/" + fn, { method: "POST", body: JSON.stringify(body) });
}
async function restGet<T>(env: OwnerEnv, table: string, query: Record<string,string>): Promise<T> {
  const params = new URLSearchParams(query);
  return restFetch<T>(env, table + "?" + params.toString(), { method: "GET" });
}
async function restPost<T = any>(env: OwnerEnv, table: string, body: unknown, returning = true): Promise<T> {
  return restFetch<T>(env, table, { method: "POST", body: JSON.stringify(body), headers: { Prefer: returning ? "return=representation" : "return=minimal" } });
}
async function restUpsert<T = any>(env: OwnerEnv, path: string, body: unknown): Promise<T> {
  return restFetch<T>(env, path, { method: "POST", body: JSON.stringify(body), headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
}
async function restPatch(env: OwnerEnv, table: string, filter: string, body: unknown): Promise<void> {
  await restFetch(env, table + "?" + filter, { method: "PATCH", body: JSON.stringify(body), headers: { Prefer: "return=minimal" } });
}
async function restPatchReturning<T = any>(env: OwnerEnv, table: string, filter: string, body: unknown): Promise<T> {
  return restFetch<T>(env, table + "?" + filter, { method: "PATCH", body: JSON.stringify(body), headers: { Prefer: "return=representation" } });
}
async function restFetch<T = any>(env: OwnerEnv, path: string, init: RequestInit): Promise<T> {
  if (!env.SUPABASE_SECRET_KEY) throw new OwnerError(503, "Serviço temporariamente indisponível.");
  const response = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      authorization: "Bearer " + env.SUPABASE_SECRET_KEY,
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  const raw = await response.text();
  let parsed: any = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const message = parsed?.message || parsed?.error || "Falha ao acessar os dados do cardápio.";
    throw new OwnerError(response.status >= 500 ? 502 : response.status, String(message).slice(0,300));
  }
  return parsed as T;
}

function requiredText(value: unknown, max: number, label: string): string {
  const text = String(value || "").trim();
  if (!text) throw new OwnerError(400, label + " é obrigatório.");
  if (text.length > max) throw new OwnerError(400, label + " excede o limite permitido.");
  return text;
}
function limitedText(value: unknown, max: number, nullable: boolean): string | null {
  const text = String(value ?? "").trim();
  if (!text) return nullable ? null : "";
  return text.slice(0,max);
}
function integer(value: unknown, min: number, max: number, fallback?: number): number {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new OwnerError(400, "Valor numérico inválido.");
  return Math.min(max, Math.max(min, Math.round(n)));
}
function optionalInteger(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  return integer(value,min,max);
}
function optionalHttpsUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error();
    return url.toString().slice(0,2000);
  } catch { throw new OwnerError(400, "A imagem deve usar uma URL HTTPS válida."); }
}
function optionalHex(value: unknown): string | null {
  const color = String(value ?? "").trim();
  if (!color) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new OwnerError(400, "Cor inválida. Use o formato #RRGGBB.");
  return color.toLowerCase();
}
function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new OwnerError(400, "Lista inválida.");
  return value.map(item => String(item).trim()).filter(Boolean).slice(0,maxItems).map(item => item.slice(0,maxLength));
}
function isObject(value: unknown): value is Record<string,unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function postgrestValue(value: string): string { return value.replace(/[(),]/g,"").slice(0,320); }

async function readJson(request: Request): Promise<Record<string,unknown>> {
  let data: unknown;
  try { data = await request.json(); } catch { throw new OwnerError(400, "JSON inválido."); }
  if (!isObject(data)) throw new OwnerError(400, "Dados inválidos.");
  return data;
}

function ownerCors(request: Request): Headers {
  const origin = request.headers.get("origin");
  const same = new URL(request.url).origin;
  const headers = new Headers({ "content-type":"application/json; charset=utf-8", "cache-control":"no-store" });
  if (origin && origin === same) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    headers.set("access-control-allow-headers", "authorization,content-type");
    headers.set("vary","Origin");
  }
  return headers;
}
function ok(body: unknown, request: Request): Response { return new Response(JSON.stringify(body), { status:200, headers:ownerCors(request) }); }
function created(body: unknown, request: Request): Response { return new Response(JSON.stringify(body), { status:201, headers:ownerCors(request) }); }
function fail(message: string, status: number, request: Request): Response { return new Response(JSON.stringify({ error: message }), { status:status, headers:ownerCors(request) }); }
