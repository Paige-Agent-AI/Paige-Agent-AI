// Helper for the in-app /mcp/authorize consent screen.
// Action "lookup": returns client info + validated request params. If a Supabase session is
//   present, scopes are elevated per the caller's server-derived tier: platform owner —
//   super_admin role in user_roles OR the bootstrap owner_email — gets the full owner scope
//   set; tenant owner/admin get the tenant scope set (minus platform.*/*.delete); everyone
//   else fails closed to zero. Destructive `*.delete` scopes are owner-only.
// Action "approve": requires the user's Supabase JWT, mints an authz code with the elevated
//   scopes, returns the redirect URL.
// Action "deny":    requires the user's JWT, returns the error redirect URL.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SUPPORTED_SCOPES = new Set([
  "crm.read", "crm.write", "crm.delete",
  "workflows.run",
  "btf.read", "btf.write",
  "admin.read", "admin.write", "admin.delete",
  "platform.read", "platform.write",
  // Self-scoped scopes for end-user (client) connections. These NEVER grant
  // access to anyone else's data — every self.* tool resolves the calling
  // user back to their own `clients` row and scopes reads/writes accordingly.
  "self.read", "self.write", "self.chat",
]);

// Client (end-user) grant — narrow, self-scoped only. Lets the user chat
// with Paige, view + update their own profile/business, log progress, and
// message their coach. NEVER includes crm/admin/platform/btf-wide scopes.
const CLIENT_AUTOGRANT = ["self.read", "self.write", "self.chat"];

// Tenant Admin grant — operator power inside their tenant. Includes bulk
// delete (crm.delete) because admins must be able to run the business.
// Excludes admin.delete (permanent role removal, member suspension) and
// platform.* (cross-tenant / infra).
const TENANT_ADMIN_AUTOGRANT = [
  "crm.read", "crm.write", "crm.delete",
  "workflows.run",
  "btf.read", "btf.write",
  "admin.read", "admin.write",
];

// Tenant Owner grant — everything an admin has PLUS permanent destructive
// actions inside their tenant (remove coach role, suspend members, etc).
// Still excludes platform.* — they cannot touch other tenants or platform infra.
const TENANT_OWNER_AUTOGRANT = [
  ...TENANT_ADMIN_AUTOGRANT,
  "admin.delete",
];

// Platform Owner grant — full god mode. Cross-tenant ops, sub-agent forge,
// MCP client registry, workflow registry, doctrine sweeps. Hardcoded to the
// single platform owner in app_settings_owner.
const PLATFORM_OWNER_AUTOGRANT = [
  ...TENANT_OWNER_AUTOGRANT,
  "platform.read", "platform.write",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function randToken(bytes = 48) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tryGetUser(authHeader: string) {
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data } = await userClient.auth.getUser();
  return data.user ?? null;
}

type Tier = "platform_owner" | "tenant_owner" | "tenant_admin" | "client" | null;

async function computeGrantedScopes(userId: string, userEmail: string | null, requested: string[]) {
  const base = requested.filter((s) => SUPPORTED_SCOPES.has(s));
  let granted: string[] = base;
  let tier: Tier = null;
  let tenantName: string | null = null;

  // 1. Platform Owner — global god account. TWO independent, server-derived signals,
  //    EITHER suffices (§9: keyed to the authenticated userId, never client-supplied):
  //    (a) super_admin role in user_roles — the real grantable platform-operator role
  //        (is_platform_owner()/is_super_admin() are aliases for it); (b) the bootstrap
  //    owner_email in app_settings_owner. Using ONLY (b) was the #210 break — a legitimate
  //    super_admin whose email != owner_email matched no tier and fell through to zero scopes.
  const { data: ownerRow } = await admin
    .from("app_settings_owner").select("owner_email").limit(1).maybeSingle();
  const emailIsOwner = !!(ownerRow?.owner_email && userEmail &&
    ownerRow.owner_email.toLowerCase() === userEmail.toLowerCase());
  // RLS-bypassing service-role read, matched on the authenticated userId. A DB error must
  // NOT elevate and must NOT crash to 500 — fail CLOSED to "not super_admin" (§13).
  let roleIsSuperAdmin = false;
  {
    const { data: roleRow, error: roleErr } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userId).eq("role", "super_admin").maybeSingle();
    if (roleErr) console.error("[paige-mcp-consent] super_admin role lookup failed", roleErr.message);
    else roleIsSuperAdmin = !!roleRow;
  }

  if (emailIsOwner || roleIsSuperAdmin) {
    granted = Array.from(new Set([...base, ...PLATFORM_OWNER_AUTOGRANT]));
    tier = "platform_owner";
    return { granted, tier, tenantName };
  }

  // 2. Tenant context — pick the user's primary tenant + their role inside it.
  const { data: tenantCtx } = await admin
    .rpc("get_user_primary_tenant", { _user_id: userId }) as any;
  const ctx = Array.isArray(tenantCtx) ? tenantCtx[0] : tenantCtx;
  if (ctx?.tenant_id) {
    tenantName = ctx.tenant_name ?? null;

    // 3. Tenant Owner — full operator power inside their tenant, incl. destructive
    //    role removal. No platform.* scopes.
    if (ctx.member_role === "owner") {
      granted = Array.from(new Set([...base, ...TENANT_OWNER_AUTOGRANT]));
      tier = "tenant_owner";
      return { granted, tier, tenantName };
    }

    // 4. Tenant Admin — full operator power (incl. bulk delete) but cannot
    //    permanently remove roles or touch platform infra.
    if (ctx.member_role === "admin") {
      const adminGrant = [
        // Strip platform.* and admin.delete from explicit requests; admin-tier
        // can never auto-grant or be auto-granted those.
        ...base.filter((s) => !s.startsWith("platform.") && s !== "admin.delete"),
        ...TENANT_ADMIN_AUTOGRANT,
      ];
      granted = Array.from(new Set(adminGrant));
      tier = "tenant_admin";
      return { granted, tier, tenantName };
    }
  }

  // 5. Client (end-user) — a row exists in `clients` linking this auth user
  //    to a workspace. Grant only the self-scoped scopes. Strip every
  //    operator/admin/platform scope they may have requested.
  //    E09 Slice 7: only an OPEN relationship — active, unmerged, in an active business and not
  //    paused — grants the client tier, the same row actorClient() in paige-mcp acts on.
  const { data: clientRow } = await admin
    .from("clients")
    .select("id, tenants!inner(status)")
    .eq("linked_user_id", userId)
    .eq("status", "active")
    .is("merged_into_contact_id", null)
    .eq("portal_access_state", "open")
    .eq("tenants.status", "active")
    .maybeSingle();
  if (clientRow?.id) {
    const safeBase = base.filter((s) => s.startsWith("self."));
    granted = Array.from(new Set([...safeBase, ...CLIENT_AUTOGRANT]));
    tier = "client";
    return { granted, tier, tenantName };
  }

  // 6. Anyone else (coach, broker, unlinked user) — no tier resolved. There is NO
  //    RLS backstop on the MCP service-role surface, so returning `base` here would
  //    hand the caller whatever scope they requested (including admin.* / platform.*).
  //    Fail CLOSED: no resolved tier -> no scopes. (If coaches/brokers should have
  //    MCP access, define a dedicated tier with an explicit scope allow-list rather
  //    than falling through to a verbatim grant — P0 Move 1, Task #207.)
  return { granted: [], tier: null, tenantName };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({} as any));
  const action = body.action;
  const authHeader = req.headers.get("authorization") ?? "";

  if (action === "lookup") {
    const { client_id, redirect_uri, scope, code_challenge, code_challenge_method } = body;
    if (!client_id || !redirect_uri || !code_challenge) return json({ error: "invalid_request" }, 400);
    if (code_challenge_method !== "S256") return json({ error: "unsupported_challenge_method" }, 400);
    const { data: client } = await admin
      .from("paige_mcp_oauth_clients")
      .select("client_id, client_name, client_uri, redirect_uris")
      .eq("client_id", client_id).maybeSingle();
    if (!client) return json({ error: "unknown_client" }, 404);
    if (!client.redirect_uris.includes(redirect_uri)) return json({ error: "invalid_redirect_uri" }, 400);
    const requested = String(scope ?? "crm.read").split(/\s+/).filter(Boolean);
    const valid = requested.filter((s: string) => SUPPORTED_SCOPES.has(s));
    if (valid.length === 0) return json({ error: "invalid_scope" }, 400);

    // Optionally elevate scopes based on the user's tier so the consent screen
    // reflects the permissions they will actually receive.
    let granted = valid;
    let tier: Tier = null;
    let tenantName: string | null = null;
    const user = await tryGetUser(authHeader);
    if (user) {
      const result = await computeGrantedScopes(user.id, user.email ?? null, valid);
      granted = result.granted;
      tier = result.tier;
      tenantName = result.tenantName;
    }

    return json({
      client: { id: client.client_id, name: client.client_name, uri: client.client_uri },
      scopes: granted,
      requested_scopes: valid,
      tier,
      tenant_name: tenantName,
      // Back-compat for older McpAuthorize bundles still reading `elevated`.
      elevated: tier === "platform_owner" ? "owner" : tier === "tenant_owner" ? "owner" : tier === "tenant_admin" ? "admin" : null,
      redirect_uri,
    });
  }

  // approve / deny both need the user's session.
  const user = await tryGetUser(authHeader);
  if (!user) return json({ error: "unauthenticated" }, 401);

  const { client_id, redirect_uri, scope, code_challenge, state } = body;

  if (action === "deny") {
    const u = new URL(redirect_uri);
    u.searchParams.set("error", "access_denied");
    if (state) u.searchParams.set("state", state);
    return json({ redirect_url: u.toString() });
  }

  if (action === "approve") {
    if (!client_id || !redirect_uri || !code_challenge) return json({ error: "invalid_request" }, 400);
    const { data: client } = await admin
      .from("paige_mcp_oauth_clients").select("redirect_uris").eq("client_id", client_id).maybeSingle();
    if (!client || !client.redirect_uris.includes(redirect_uri)) return json({ error: "invalid_redirect_uri" }, 400);
    const requested = String(scope ?? "crm.read").split(/\s+/).filter((s) => SUPPORTED_SCOPES.has(s));
    if (requested.length === 0) return json({ error: "invalid_scope" }, 400);

    const { granted } = await computeGrantedScopes(user.id, user.email ?? null, requested);
    if (granted.length === 0) return json({ error: "invalid_scope" }, 400);

    const code = randToken(32);
    const code_hash = await sha256Hex(code);
    await admin.from("paige_mcp_oauth_codes").insert({
      code_hash, client_id, user_id: user.id, redirect_uri, scopes: granted,
      code_challenge, code_challenge_method: "S256",
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    const u = new URL(redirect_uri);
    u.searchParams.set("code", code);
    if (state) u.searchParams.set("state", state);
    return json({ redirect_url: u.toString() });
  }

  return json({ error: "unknown_action" }, 400);
});
