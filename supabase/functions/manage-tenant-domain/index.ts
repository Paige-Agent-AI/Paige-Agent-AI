import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../_shared/comms-provider-boundary.ts";
// Tenant EMAIL sender-domain management (Resend).
//
// Verbs: list | add | refresh | set_default | remove   (the Resend sender-domain registry)
//
// §9 (fixed): the caller's tenant is SERVER-DERIVED. A non-owner admin is pinned to their OWN
// active tenant and can NEVER target another tenant via body.tenant_id (that was a live
// cross-tenant BIND/IDOR — any global-admin could register/delete a VICTIM tenant's domain).
// Only is_platform_owner() may pass an explicit body.tenant_id (a fleet operation). Every by-id
// operation is tenant-scoped so a row from another tenant can't be read/mutated/deleted by id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deriveCallerTenant } from "../_shared/tenant-domain-scope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RESEND_BASE = "https://api.resend.com";

async function resend(path: string, init: RequestInit = {}) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY missing");
  const res = await fetch(`${RESEND_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`resend_${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

function mapStatus(s: string | undefined): string {
  if (!s) return "pending";
  const k = s.toLowerCase();
  if (k === "verified") return "verified";
  if (k === "failed" || k === "temporary_failure") return "failed";
  return "verifying";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  const { data: isOwner } = await admin.rpc("is_platform_owner");
  if (!isAdmin && !isOwner) return json({ error: "forbidden" }, 403);

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const verb: string = body?.verb;

  // §9 tenant derivation — SERVER-SIDE, never trust body for a non-owner.
  //   • platform owner: may target any tenant via body.tenant_id (fleet operation).
  //   • tenant admin: pinned to their OWN active tenant. A body.tenant_id that disagrees is a
  //     forged cross-tenant attempt → reject 403 + log (§13 honest failure), never silently honor.
  const { data: profile } = await admin.from("profiles").select("active_tenant_id").eq("user_id", user.id).maybeSingle();
  const activeTenant: string | null = profile?.active_tenant_id ?? null;
  const decision = deriveCallerTenant({ isOwner: !!isOwner, bodyTenantId: body?.tenant_id, activeTenant });
  if (!decision.ok) {
    if (decision.error === "cross_tenant_forbidden") {
      console.warn(`[manage-tenant-domain] §9 REJECT cross-tenant target: user=${user.id} active=${activeTenant} attempted=${body?.tenant_id} verb=${verb}`);
    }
    return json({ error: decision.error }, decision.status);
  }
  const tenantId = decision.tenantId;
  if (verb !== "list" && !await commsProviderExecutionAllowed(admin, { tenantId, actorUserId: user.id })) return json({ error: COMMS_PROVIDER_EXECUTION_DISABLED }, 403);

  /**
   * Evidence that a real change happened to what this business sends email FROM.
   *
   * Adding, removing or re-pointing a sending domain changes the identity every
   * outbound message carries, and until now none of it left a trace: buying a
   * phone number wrote `audit_logs`, and so does `quickbooks-disconnect` for the
   * same class of act, but the whole email-identity seam wrote nothing.
   *
   * SHAPE follows the established one exactly (§18) — `audit_logs` has no
   * `tenant_id` column (it is in the §51 no-tenant-id governance set), so the
   * tenant goes in `data`, as every other writer does including the pipeline
   * RPCs. The actor is `user.id` from the verified JWT and the tenant is
   * server-derived; neither is ever taken from the request body (§9).
   *
   * NEVER BLOCKING, following `comms-purchase-number` rather than
   * `quickbooks-disconnect`: the domain is already added, removed or re-pointed
   * by the time this runs, and a failed audit write must not turn a completed
   * change into a reported failure. Logged loudly, never swallowed (§32).
   *
   * No secret goes in: the domain and the from-address local part are public by
   * construction (they appear in every message header), and the Resend API key
   * is never referenced here.
   */
  const writeDomainAudit = async (
    action: string,
    domainRowId: string | null,
    detail: Record<string, unknown>,
  ) => {
    const { error: auditErr } = await admin.from("audit_logs").insert({
      user_id: user.id,
      entity: "tenant_email_domain",
      action,
      entity_id: domainRowId,
      data: { tenant_id: tenantId, ...detail },
    });
    if (auditErr) console.error(`[manage-tenant-domain] audit write failed (${action}):`, auditErr.message);
  };

  try {
    if (verb === "list") {
      const { data } = await admin.from("tenant_email_domains").select("*").eq("tenant_id", tenantId).order("created_at");
      return json({ domains: data ?? [] });
    }

    if (verb === "add") {
      const domain = String(body.domain || "").trim().toLowerCase();
      const fromName = String(body.from_name || "").trim() || "Notifications";
      const fromLocal = String(body.from_email_local || "no-reply").trim().toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return json({ error: "invalid_domain" }, 400);
      const created = await resend("/domains", { method: "POST", body: JSON.stringify({ name: domain }) });
      const records = created?.records ?? [];
      const status = mapStatus(created?.status);
      const { data: existingDefault } = await admin
        .from("tenant_email_domains").select("id").eq("tenant_id", tenantId).eq("is_default", true).maybeSingle();
      const { data, error } = await admin
        .from("tenant_email_domains")
        .insert({
          tenant_id: tenantId, domain, from_email_local: fromLocal, from_name: fromName,
          resend_domain_id: created?.id ?? null, status, dns_records: records,
          is_default: !existingDefault, created_by_user_id: user.id,
        })
        .select().single();
      if (error) throw error;
      await writeDomainAudit("comms:sending_domain_added", data?.id ?? null, {
        domain, from_email_local: fromLocal, status,
        // Whether this became the address everything sends from, which it does
        // when the workspace had no default yet.
        became_default: !existingDefault,
      });
      return json({ domain: data });
    }

    if (verb === "refresh") {
      const id = String(body.id);
      // §9: scope the lookup to the caller's tenant — a foreign row id resolves to nothing (404).
      const { data: row } = await admin.from("tenant_email_domains").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      if (!row) return json({ error: "not_found" }, 404);
      if (row.resend_domain_id) {
        try { await resend(`/domains/${row.resend_domain_id}/verify`, { method: "POST" }); } catch (_) { /* ignore */ }
        const info = await resend(`/domains/${row.resend_domain_id}`);
        const status = mapStatus(info?.status);
        await admin.from("tenant_email_domains").update({
          status, dns_records: info?.records ?? row.dns_records,
          verified_at: status === "verified" ? new Date().toISOString() : row.verified_at,
        }).eq("id", id).eq("tenant_id", tenantId);
        // Only the TRANSITION is an event. This verb is a DNS poll the surface can
        // call repeatedly, so auditing every call would bury the one moment that
        // matters — the domain becoming verified, which is what lets mail send
        // from it — under rows that record nothing happening.
        if (row.status !== status) {
          await writeDomainAudit("comms:sending_domain_status_changed", id, {
            domain: row.domain, from_status: row.status, to_status: status,
          });
        }
      }
      const { data: fresh } = await admin.from("tenant_email_domains").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      return json({ domain: fresh });
    }

    if (verb === "set_default") {
      const id = String(body.id);
      // §9: only flip a row that belongs to the caller's tenant.
      // `domain` is selected for the audit row, not for the flip. An entry recording
      // that the default changed without naming what it changed TO is a row you
      // cannot answer the question from, which is most of the point of writing it.
      const { data: target } = await admin.from("tenant_email_domains").select("id, domain").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      if (!target) return json({ error: "not_found" }, 404);
      // Read the outgoing default BEFORE the flip — afterwards there is no way to
      // recover which domain this replaced.
      const { data: previousDefault } = await admin
        .from("tenant_email_domains").select("id, domain").eq("tenant_id", tenantId).eq("is_default", true).maybeSingle();
      await admin.from("tenant_email_domains").update({ is_default: false }).eq("tenant_id", tenantId);
      await admin.from("tenant_email_domains").update({ is_default: true }).eq("id", id).eq("tenant_id", tenantId);
      await writeDomainAudit("comms:sending_domain_set_default", id, {
        domain: target.domain,
        // null when this workspace had no default yet, which is a different event
        // from replacing one and reads as such.
        replaced_domain: previousDefault?.domain ?? null,
      });
      return json({ ok: true });
    }

    if (verb === "remove") {
      const id = String(body.id);
      // §9: scope the lookup + delete to the caller's tenant — closes the cross-tenant destructive IDOR.
      const { data: row } = await admin.from("tenant_email_domains").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      if (!row) return json({ error: "not_found" }, 404);
      if (row.resend_domain_id) {
        try { await resend(`/domains/${row.resend_domain_id}`, { method: "DELETE" }); } catch (_) { /* ignore */ }
      }
      await admin.from("tenant_email_domains").delete().eq("id", id).eq("tenant_id", tenantId);
      // The row is gone, so this audit entry is the ONLY record anywhere that this
      // domain was ever a sending identity for this business, and the only place
      // the removal is attributable. `was_default` marks the case that changed
      // what every later message sends from.
      await writeDomainAudit("comms:sending_domain_removed", id, {
        domain: row.domain, was_default: row.is_default === true, status: row.status,
      });
      return json({ ok: true });
    }

    return json({ error: "unknown_verb" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
