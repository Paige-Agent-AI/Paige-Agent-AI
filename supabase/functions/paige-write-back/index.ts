import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";
import { resolveTenantForUser } from "../_shared/tenant-for-user.ts";
import { phoneOrAddressText, setUserPrimaryAddress } from "../_shared/user-contact-methods.ts";
import {
  authorizeWriteBackTarget,
  decideWriteBack,
  writeBackGovernedAuditRow,
  type WriteBackAuthzDeps,
  type WriteBackGovernedAudit,
} from "../_shared/paige-write-back/governed-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Whitelist of allowed field paths
const ALLOWED_FIELDS: Record<string, { table: string; column: string; type: "string" | "boolean" | "number" | "date" }> = {
  // Foundation fields (businesses table)
  "foundation.entity_type": { table: "businesses", column: "entity_type", type: "string" },
  "foundation.state_of_formation": { table: "businesses", column: "state_of_formation", type: "string" },
  "foundation.formation_date": { table: "businesses", column: "formation_date", type: "date" },
  "foundation.registered_agent_name": { table: "businesses", column: "registered_agent_name", type: "string" },
  "foundation.registered_agent_address": { table: "businesses", column: "registered_agent_address", type: "string" },
  "foundation.registered_agent_state": { table: "businesses", column: "registered_agent_state", type: "string" },
  "foundation.ein": { table: "businesses", column: "ein", type: "string" },
  "foundation.business_address_type": { table: "businesses", column: "business_address_type", type: "string" },
  "foundation.street_address": { table: "businesses", column: "business_street_address", type: "string" },
  "foundation.city": { table: "businesses", column: "business_city", type: "string" },
  "foundation.state": { table: "businesses", column: "business_state", type: "string" },
  "foundation.zip": { table: "businesses", column: "business_zip", type: "string" },
  "foundation.business_phone": { table: "businesses", column: "business_phone", type: "string" },
  "foundation.phone_411_listed": { table: "businesses", column: "phone_411_listed", type: "boolean" },
  "foundation.bank_name": { table: "businesses", column: "bank_name", type: "string" },
  "foundation.bank_account_opened": { table: "businesses", column: "bank_account_opened_date", type: "date" },
  "foundation.has_bank_account": { table: "businesses", column: "has_bank_account", type: "boolean" },
  "foundation.legal_name": { table: "businesses", column: "legal_name", type: "string" },
  "foundation.dba": { table: "businesses", column: "dba", type: "string" },
  "foundation.naics": { table: "businesses", column: "naics", type: "string" },
  // Public presence fields (business_public_presence table)
  "public_presence.website_url": { table: "business_public_presence", column: "website_url", type: "string" },
  "public_presence.google_business_url": { table: "business_public_presence", column: "google_business_url", type: "string" },
  "public_presence.yelp_url": { table: "business_public_presence", column: "yelp_url", type: "string" },
  "public_presence.linkedin_url": { table: "business_public_presence", column: "linkedin_url", type: "string" },
  "public_presence.facebook_url": { table: "business_public_presence", column: "facebook_url", type: "string" },
  "public_presence.website_live": { table: "business_public_presence", column: "website_live", type: "boolean" },
  "public_presence.google_business_claimed": { table: "business_public_presence", column: "google_business_claimed", type: "boolean" },
  // Personal info audit fields (credit_report_personal_info table)
  "personal_info.status": { table: "credit_report_personal_info", column: "status", type: "string" },
  "foundation.business_email": { table: "businesses", column: "business_email", type: "string" },
  // Profile fields
  "profile.full_name": { table: "profiles", column: "full_name", type: "string" },
  "profile.city": { table: "profiles", column: "city", type: "string" },
  "profile.state": { table: "profiles", column: "state", type: "string" },
  "profile.address": { table: "profiles", column: "address", type: "string" },
  "profile.postal_code": { table: "profiles", column: "postal_code", type: "string" },
  // A person's phone is a contact method, not a profiles column: it becomes their primary phone.
  "profile.phone": { table: "_user_contact_method", column: "phone", type: "string" },
  // Intake / goal discovery fields (written by Paige after the intake conversation)
  "intake.primary_goal": { table: "profiles", column: "primary_goal", type: "string" },
  "intake.primary_goal_category": { table: "profiles", column: "primary_goal_category", type: "string" },
  "intake.goal_timeline": { table: "profiles", column: "goal_timeline", type: "string" },
  "intake.goal_amount": { table: "profiles", column: "goal_amount", type: "number" },
  "intake.experience_level": { table: "profiles", column: "experience_level", type: "string" },
  "intake.financing_preference": { table: "profiles", column: "financing_preference", type: "string" },
  "intake.biggest_obstacle": { table: "profiles", column: "biggest_obstacle", type: "string" },
  "intake.intake_responses": { table: "profiles", column: "intake_responses", type: "string" },
  "intake.complete": { table: "_intake_op", column: "complete", type: "boolean" },
  // Sensitive PII fields — routed through update_profile_ssn with server-side encryption key
  "profile.ssn": { table: "_ssn_op", column: "ssn", type: "string" },
  "profile.date_of_birth": { table: "_ssn_op", column: "date_of_birth", type: "date" },
  // Funding goal fields (funding_profiles table)
  "funding.objective": { table: "funding_profiles", column: "funding_objective", type: "string" },
  "funding.target_amount": { table: "funding_profiles", column: "target_amount", type: "number" },
  "funding.timeline": { table: "funding_profiles", column: "timeline", type: "string" },
  // Account management operations (handled specially)
  "accounts.mark_not_mine": { table: "_account_op", column: "mark_not_mine", type: "string" },
  "accounts.mark_duplicate": { table: "_account_op", column: "mark_duplicate", type: "string" },
  "accounts.update_bureau_source": { table: "_account_op", column: "update_bureau_source", type: "string" },
  "accounts.merge_duplicates": { table: "_account_op", column: "merge_duplicates", type: "string" },
};

const writeBackSchema = z.object({
  updates: z.array(z.object({
    field_path: z.string().min(1).max(100),
    field_value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    record_id: z.string().uuid().optional(),
    merge_into_id: z.string().uuid().optional(),
  })).min(1).max(20),
  target_user_id: z.string().uuid().optional(),
  // Optional provenance metadata recorded in audit_logs.
  // Set by the chat UI when writes originate from a document drop or
  // a conversational data-capture confirmation.
  source: z.enum(["document", "conversation", "manual", "paige_chat"]).optional(),
  document_type: z.string().max(120).optional(),
});

/**
 * Write ONE governed-decision row to paige_audit_log (service-role). The only trace of a REFUSED
 * cross-user write, since a refusal performs no write and reaches no `audit_logs` insert. Non-fatal:
 * a logging failure never changes the decision (mirrors skill-runner's `writeGovernedSkillAudit`).
 */
// deno-lint-ignore no-explicit-any -- the supabase client type is intentionally loose here, matching
// skill-runner and _shared/tenant-for-user.ts: a precise client type trips TS2589 for every caller.
async function writeGovernedWriteBackAudit(
  admin: any,
  actorUserId: string,
  audit: WriteBackGovernedAudit,
): Promise<void> {
  try {
    const row = writeBackGovernedAuditRow(audit);
    // supabase-js resolves a DB rejection as `{ error }` rather than THROWING, so the catch below
    // never sees it. For a REFUSED cross-user write this row is the ONLY trace — a silently-dropped
    // insert would erase a security-relevant attempt. Inspect and log the returned error loudly.
    const { error } = await admin.from("paige_audit_log").insert({
      actor_user_id: actorUserId,
      actor_role: `write_back:${audit.principal}`,
      ...row,
    });
    if (error) {
      console.error("paige-write-back governed audit not recorded", error.message ?? String(error));
    }
  } catch (e) {
    // A network/unexpected throw. Still non-fatal: a logging failure never changes the decision,
    // which has already been returned to the caller.
    console.error("paige-write-back governed audit not recorded (threw)", String(e));
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authenticate caller
    const authClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse and validate input
    const rawData = await req.json();
    let validated;
    try {
      validated = writeBackSchema.parse(rawData);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return new Response(JSON.stringify({ error: "Invalid input", details: err.issues }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw err;
    }

    const targetUserId = validated.target_user_id || user.id;

    // ── CROSS-USER WRITE — tenant-scoped authorization + the ONE governed pathway ─────────────────
    // A SELF-write (targetUserId === user.id) is the caller editing their OWN record: no IDOR, no
    // workspace scoping, and its legitimate callers include tenant-less portal consumers (the client
    // portal's own SSN/profile save) — so it stays on the direct path below, ungoverned by the
    // workspace seam, which is correct (a workspace gate would refuse a consumer saving their own
    // profile). A CROSS-USER write is where the §9 cross-tenant IDOR lived: the prior guard consulted
    // the GLOBAL `user_roles` table, which has NO tenant predicate (the §53/§59 global-role trap), so
    // a tenant-A admin could write a tenant-B user's credit/identity record. It is now authorized by
    // the TENANT bond (the caller's active workspace must own the target), with a platform owner (super_admin)
    // as the one sanctioned cross-tenant caller, and routed through `decideGovernedExecution` exactly
    // like the skill and mcp doors.
    if (targetUserId !== user.id) {
      const startedAtMs = Date.now();

      const authzDeps: WriteBackAuthzDeps = {
        // is_platform_owner() (super_admin ONLY, §53) derives from the VERIFIED JWT (auth.uid()), so it
        // MUST use the caller's token client. Super_admin — NOT is_platform_operator() — because §53
        // scopes platform_admin to all-tenant READ/fleet ops, never cross-tenant credit/identity WRITES;
        // this matches paige-ai-chat:808, the sibling cross-tenant client-data write gate.
        isPlatformOwner: async () => {
          const { data } = await authClient.rpc("is_platform_owner");
          return data === true;
        },
        // The caller's ACTIVE workspace, resolved server-side from the JWT (current_user_tenant_id) —
        // the same resolution the chat uses to authorize a scoped client.
        callerActiveTenant: async () => {
          const { data, error } = await authClient.rpc("current_user_tenant_id");
          if (error) return null;
          return (data ?? null) as string | null;
        },
        // The caller's TENANT-SCOPED role in the resolved workspace — tenant_members.role for
        // (callerTenantId, caller), the SAME source is_tenant_admin() keys on — NOT the global
        // user_roles (§53/§59): a role held for another tenant must never authorize a write here.
        // Service-role read (UNIQUE(tenant_id,user_id) → at most one row); null when not an active member.
        callerRoleInTenant: async (callerTenantId) => {
          const { data } = await supabase
            .from("tenant_members")
            .select("role")
            .eq("tenant_id", callerTenantId)
            .eq("user_id", user.id)
            .eq("status", "active")
            .maybeSingle();
          // deno-lint-ignore no-explicit-any -- single-column select row
          return (((data as any)?.role) ?? null) as string | null;
        },
        // Agency DELEGATION: does the caller manage callerTenantId as a child? `agency_can_manage_child`
        // is the SAME predicate current_user_tenant_id() uses to let an agency owner/admin (or scoped
        // team specialist) operate in a child they hold no direct membership in — admin-equivalent over
        // that child. SECURITY DEFINER, granted to service_role; called with the explicit (child, actor)
        // overload since the service client carries no auth.uid().
        callerManagesTenantViaAgency: async (callerTenantId) => {
          const { data } = await supabase.rpc("agency_can_manage_child", {
            _child: callerTenantId,
            _actor: user.id,
          });
          return data === true;
        },
        // The workspace a target belongs to (for the platform-owner path's audit scope). Service-role, so
        // get_user_primary_tenant bypasses its self-or-owner guard; falls back to the CRM clients row
        // for a target that is a clients.id / linked_user_id rather than a tenant member. `t` is a
        // zod-validated uuid (writeBackSchema.target_user_id), so the `.or()` interpolation carries no
        // PostgREST filter-injection surface; a deterministic `.order("id")` picks a stable row when a
        // linked_user_id maps to clients in more than one tenant (the #588 LIMIT-1-without-ORDER-BY lesson).
        resolveTargetTenant: async (t) => {
          const primary = await resolveTenantForUser(supabase, t);
          if (primary.tenantId) return primary.tenantId;
          const { data } = await supabase
            .from("clients")
            .select("tenant_id")
            .or(`id.eq.${t},linked_user_id.eq.${t}`)
            .not("tenant_id", "is", null)
            .order("id", { ascending: true })
            .limit(1)
            .maybeSingle();
          // deno-lint-ignore no-explicit-any -- single-column select row
          return (((data as any)?.tenant_id) ?? null) as string | null;
        },
        // The §9 boundary: is the target a MEMBER (auth user) or a CRM CLIENT of the caller's active
        // workspace? Either establishes the same-workspace bond; neither means a different workspace.
        // `t` is a zod-validated uuid, and the clients `.or()` is AND-scoped by the caller's tenant_id,
        // so there is no filter-injection surface and no cross-tenant match is possible. Result is a
        // boolean existence check, so row order is irrelevant here.
        targetSharesTenant: async (callerTenantId, t) => {
          const { data: member } = await supabase
            .from("tenant_members")
            .select("tenant_id")
            .eq("user_id", t)
            .eq("tenant_id", callerTenantId)
            .eq("status", "active")
            .maybeSingle();
          if (member) return true;
          const { data: client } = await supabase
            .from("clients")
            .select("id")
            .or(`id.eq.${t},linked_user_id.eq.${t}`)
            .eq("tenant_id", callerTenantId)
            .limit(1)
            .maybeSingle();
          return !!client;
        },
      };

      const authz = await authorizeWriteBackTarget(authzDeps, { callerUserId: user.id, targetUserId });
      const { outcome, audit } = decideWriteBack({
        authenticated: true,
        userId: user.id,
        targetUserId,
        tenantId: authz.tenantId,
        access: { allowed: authz.allowed, reason: authz.reason },
        authzBasis: authz.basis,
        fieldPaths: validated.updates.map((u) => u.field_path),
        startedAtMs,
        nowIso: new Date().toISOString(),
      });

      // The governed receipt — the ONLY trace of a refused cross-user write, since a refusal performs
      // no write and never reaches the audit_logs insert below.
      await writeGovernedWriteBackAudit(supabase, user.id, audit);

      if (outcome.kind === "refuse") {
        return new Response(JSON.stringify({ error: outcome.message }), {
          status: outcome.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const results: any[] = [];

    for (const update of validated.updates) {
      const fieldDef = ALLOWED_FIELDS[update.field_path];
      if (!fieldDef) {
        results.push({ field_path: update.field_path, success: false, error: "Field not in whitelist" });
        continue;
      }

      try {
        const { table, column } = fieldDef;

        // Handle account management operations
        if (table === "_account_op") {
          if (!update.record_id) {
            results.push({ field_path: update.field_path, success: false, error: "record_id required for account operations" });
            continue;
          }

          if (column === "mark_not_mine") {
            // Try both tables
            const { data: negItem } = await supabase.from("credit_negative_items").select("id, creditor_name, bureau, item_type, amount, status").eq("id", update.record_id).eq("user_id", targetUserId).maybeSingle();
            const { data: acctItem } = await supabase.from("credit_accounts").select("id, creditor, type, status").eq("id", update.record_id).eq("user_id", targetUserId).maybeSingle();

            if (negItem) {
              await supabase.from("credit_negative_items").update({ is_disputed_ownership: true, status: "disputed" }).eq("id", update.record_id);
              await supabase.from("audit_logs").insert({ user_id: user.id, entity: "account_modification", action: "mark_not_mine", entity_id: update.record_id, data: { creditor: negItem.creditor_name, table: "credit_negative_items", source: "paige_chat" } });
              results.push({ field_path: update.field_path, success: true, detail: `Flagged ${negItem.creditor_name} as not belonging to client` });
            } else if (acctItem) {
              await supabase.from("credit_accounts").update({ is_disputed_ownership: true, status: "disputed_ownership" }).eq("id", update.record_id);
              await supabase.from("audit_logs").insert({ user_id: user.id, entity: "account_modification", action: "mark_not_mine", entity_id: update.record_id, data: { creditor: acctItem.creditor, table: "credit_accounts", source: "paige_chat" } });
              results.push({ field_path: update.field_path, success: true, detail: `Flagged ${acctItem.creditor} as not belonging to client` });
            } else {
              results.push({ field_path: update.field_path, success: false, error: "Account not found" });
            }
          } else if (column === "mark_duplicate" || column === "merge_duplicates") {
            const mergeIntoId = update.merge_into_id;
            if (!mergeIntoId) {
              results.push({ field_path: update.field_path, success: false, error: "merge_into_id required for duplicate merge" });
              continue;
            }
            const { data: negItem } = await supabase.from("credit_negative_items").select("id, creditor_name").eq("id", update.record_id).eq("user_id", targetUserId).maybeSingle();
            if (negItem) {
              await supabase.from("credit_negative_items").update({ duplicate_of_id: mergeIntoId, status: "removed" }).eq("id", update.record_id);
              await supabase.from("audit_logs").insert({ user_id: user.id, entity: "account_modification", action: "merge", entity_id: update.record_id, data: { merged_into: mergeIntoId, creditor: negItem.creditor_name, source: "paige_chat" } });
              results.push({ field_path: update.field_path, success: true, detail: `Merged duplicate ${negItem.creditor_name}` });
            } else {
              const { data: acctItem } = await supabase.from("credit_accounts").select("id, creditor").eq("id", update.record_id).eq("user_id", targetUserId).maybeSingle();
              if (acctItem) {
                await supabase.from("credit_accounts").update({ duplicate_of_id: mergeIntoId }).eq("id", update.record_id);
                await supabase.from("audit_logs").insert({ user_id: user.id, entity: "account_modification", action: "merge", entity_id: update.record_id, data: { merged_into: mergeIntoId, creditor: acctItem.creditor, source: "paige_chat" } });
                results.push({ field_path: update.field_path, success: true, detail: `Merged duplicate ${acctItem.creditor}` });
              } else {
                results.push({ field_path: update.field_path, success: false, error: "Account not found" });
              }
            }
          } else if (column === "update_bureau_source") {
            const newBureau = String(update.field_value).toLowerCase();
            if (!["transunion", "experian", "equifax"].includes(newBureau)) {
              results.push({ field_path: update.field_path, success: false, error: "Invalid bureau value" });
              continue;
            }
            const { data: negItem } = await supabase.from("credit_negative_items").select("id, creditor_name, bureau").eq("id", update.record_id).eq("user_id", targetUserId).maybeSingle();
            if (negItem) {
              await supabase.from("credit_negative_items").update({ bureau: newBureau }).eq("id", update.record_id);
              await supabase.from("audit_logs").insert({ user_id: user.id, entity: "account_modification", action: "bureau_correction", entity_id: update.record_id, data: { creditor: negItem.creditor_name, previous_bureau: negItem.bureau, new_bureau: newBureau, source: "paige_chat" } });
              results.push({ field_path: update.field_path, success: true, detail: `Updated ${negItem.creditor_name} bureau to ${newBureau}` });
            } else {
              results.push({ field_path: update.field_path, success: false, error: "Negative item not found" });
            }
          } else {
            results.push({ field_path: update.field_path, success: false, error: "Unknown account operation" });
          }
          continue;
        }

        if (table === "businesses") {
          // Find the user's primary business
          const { data: biz } = await supabase
            .from("businesses")
            .select("id")
            .eq("owner_user_id", targetUserId)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (!biz) {
            results.push({ field_path: update.field_path, success: false, error: "No business found" });
            continue;
          }
          await supabase.from("businesses").update({ [column]: update.field_value }).eq("id", biz.id);
          results.push({ field_path: update.field_path, success: true });
        } else if (table === "business_public_presence") {
          const { data: biz } = await supabase
            .from("businesses")
            .select("id")
            .eq("owner_user_id", targetUserId)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (!biz) {
            results.push({ field_path: update.field_path, success: false, error: "No business found" });
            continue;
          }
          // Upsert public presence
          const { data: existing } = await supabase
            .from("business_public_presence")
            .select("id")
            .eq("business_id", biz.id)
            .maybeSingle();
          if (existing) {
            await supabase.from("business_public_presence").update({ [column]: update.field_value }).eq("id", existing.id);
          } else {
            await supabase.from("business_public_presence").insert({
              business_id: biz.id,
              user_id: targetUserId,
              [column]: update.field_value,
            });
          }
          results.push({ field_path: update.field_path, success: true });
        } else if (table === "_ssn_op") {
          // SSN and DOB updates are routed through update_profile_ssn so they are
          // encrypted server-side and written to pii_access_log.
          // The encryption key comes from the SSN_ENCRYPTION_KEY edge function secret —
          // it never touches the client or the database configuration.
          const encryptionKey = Deno.env.get("SSN_ENCRYPTION_KEY") ?? null;

          if (column === "ssn") {
            const raw = typeof update.field_value === "string" ? update.field_value : null;
            const cleaned = raw ? raw.replace(/-/g, "") : null;
            if (cleaned && !/^\d{9}$/.test(cleaned)) {
              results.push({ field_path: update.field_path, success: false, error: "Invalid SSN format" });
              continue;
            }
            const last4 = cleaned ? cleaned.slice(-4) : null;
            const { error: rpcErr } = await supabase.rpc("update_profile_ssn", {
              _user_id: targetUserId,
              _ssn_plaintext: cleaned,
              _ssn_last_4: last4,
              _date_of_birth: null,
              _encryption_key: encryptionKey,
            });
            if (rpcErr) throw rpcErr;
          } else if (column === "date_of_birth") {
            const dob = typeof update.field_value === "string" ? update.field_value : null;
            const { error: rpcErr } = await supabase.rpc("update_profile_ssn", {
              _user_id: targetUserId,
              _ssn_plaintext: null,
              _ssn_last_4: null,
              _date_of_birth: dob,
              _encryption_key: null,  // not needed when only updating DOB
            });
            if (rpcErr) throw rpcErr;
          }
          results.push({ field_path: update.field_path, success: true });
        } else if (table === "credit_report_personal_info") {
          if (!update.record_id) {
            results.push({ field_path: update.field_path, success: false, error: "record_id required for personal_info updates" });
            continue;
          }
          await supabase.from("credit_report_personal_info").update({ [column]: update.field_value }).eq("id", update.record_id).eq("user_id", targetUserId);
          results.push({ field_path: update.field_path, success: true });
        } else if (table === "_intake_op") {
          // intake.complete: marks intake_completed=true and inserts a client_goals row
          // using the latest profile values written in this same batch (or already on file).
          if (column === "complete" && update.field_value === true) {
            const { data: prof } = await supabase
              .from("profiles")
              .select("primary_goal, primary_goal_category, goal_amount")
              .eq("user_id", targetUserId)
              .maybeSingle();
            await supabase.from("profiles").update({
              intake_completed: true,
              intake_completed_at: new Date().toISOString(),
            }).eq("user_id", targetUserId);

            // Create a client_goals row only if we have at least the category
            if ((prof as any)?.primary_goal_category) {
              await supabase.from("client_goals").insert({
                user_id: targetUserId,
                goal_category: (prof as any).primary_goal_category,
                goal_description: (prof as any).primary_goal,
                target_amount: (prof as any).goal_amount,
                status: "active",
              });
            }
            results.push({ field_path: update.field_path, success: true });
          } else {
            results.push({ field_path: update.field_path, success: false, error: "Unknown intake operation" });
          }
        } else if (table === "_user_contact_method") {
          // The value becomes the person's primary address of that kind; the addresses they
          // already hold stay on their list.
          // A number is a phone written without formatting (the schema accepts one), so it is
          // written as its digits.
          const phone = phoneOrAddressText(update.field_value);
          if (phone === "") {
            results.push({ field_path: update.field_path, success: false, error: "A phone number is required" });
            continue;
          }
          await setUserPrimaryAddress(supabase, targetUserId, "phone", phone);
          results.push({ field_path: update.field_path, success: true });
        } else if (table === "profiles") {
          // intake.intake_responses comes through as a string from the JSON-only schema —
          // try to parse it back into an object so it lands as JSONB.
          let value: any = update.field_value;
          if (column === "intake_responses" && typeof value === "string") {
            try { value = JSON.parse(value); } catch { /* keep as string */ }
          }
          await supabase.from("profiles").update({ [column]: value }).eq("user_id", targetUserId);
          results.push({ field_path: update.field_path, success: true });
        } else if (table === "funding_profiles") {
          const { data: fp } = await supabase
            .from("funding_profiles")
            .select("id")
            .eq("user_id", targetUserId)
            .maybeSingle();
          if (fp) {
            await supabase.from("funding_profiles").update({ [column]: update.field_value }).eq("id", fp.id);
          } else {
            await supabase.from("funding_profiles").insert({ user_id: targetUserId, [column]: update.field_value });
          }
          results.push({ field_path: update.field_path, success: true });
        } else {
          results.push({ field_path: update.field_path, success: false, error: "Unknown table" });
        }
      } catch (err) {
        console.error(`Write-back error for ${update.field_path}:`, err);
        results.push({ field_path: update.field_path, success: false, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      entity: "write_back",
      action: "paige_write_back",
      data: {
        target_user_id: targetUserId,
        source: validated.source || "paige_chat",
        document_type: validated.document_type || null,
        updates: validated.updates.map(u => ({ field_path: u.field_path, success: results.find(r => r.field_path === u.field_path)?.success })),
        timestamp: new Date().toISOString(),
      },
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Write-back error:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
