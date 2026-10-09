// INT-345 K-3 — the ONE per-tenant Twilio provisioning core (§18: one home).
//
// Extracted VERBATIM from provision-tenant-twilio's loop so the governed tenant
// setup action (comms-setup-calling) and the super-admin backfill execute the
// SAME steps: subaccount (adopt-or-create) → subaccount API key → Vault secret
// → 1-per-tenant row (service-role, explicit tenant_id) → TwiML app (non-fatal).
//
// DOCTRINE (carried from the backfill):
//  §9  The INSERT goes through the SERVICE-ROLE client so
//      set_tenant_twilio_subaccount_tenant() sees current_user_tenant_id()=null
//      and honors the EXPLICIT tenant_id. tenant_id is a parameter of the CALLER
//      (server-derived upstream), never a client body value.
//  §13 Honest: masterCreds unset => blocked_needs_config, NOTHING provisioned.
//      Real SIDs or real errors, never fabricated. `inbound_webhook_secret` is
//      deliberately NOT set — the DB default owns it.
//  §34  The API-key SECRET exists only in the Vault write; it is never logged,
//      returned, or stored in a table.
//
// Idempotent by construction: an existing row ⇒ skipped_existing; a 23505 on
// insert (race) ⇒ skipped_existing; the Vault write upserts by name; the TwiML
// app ensure is idempotent on twiml_app_sid.
import {
  createSubaccount,
  createSubaccountApiKey,
  ensureTwimlApp,
  masterCreds,
  type SupabaseAdminLike,
} from "./twilio.ts";

export type ProvisionStepName = "subaccount" | "api_key" | "vault" | "row" | "twiml_app";

export interface ProvisionStep {
  step: ProvisionStepName;
  status: "done" | "adopted" | "skipped" | "failed" | "planned";
  error?: string;
}

export interface TenantProvisionInput {
  tenantId: string;
  tenantName: string | null;
  /** Orphan adoption: an EXISTING Twilio subaccount SID to adopt instead of creating. */
  adoptSid?: string;
  /** Report the plan without calling Twilio or writing anything. */
  dryRun?: boolean;
}

export interface TenantProvisionResult {
  tenant_id: string;
  name: string | null;
  outcome:
    | "provisioned"
    | "adopted"
    | "skipped_existing"
    | "failed"
    | "blocked_needs_config"
    | "would_provision"
    | "would_adopt";
  steps: ProvisionStep[];
  subaccount_sid?: string | null; // REAL Twilio ACxx… on success, else omitted
  api_key_sid?: string | null;    // REAL Twilio SK… on success (NEVER the secret, §34)
  twiml_app_sid?: string | null;  // REAL Twilio AP… or null when minting failed (non-fatal)
  twiml_app_error?: string | null;
  error?: string | null;
}

/** Map Twilio's subaccount status onto our CHECK enum (pending|active|suspended|closed). */
export function mapSubaccountStatus(twilioStatus: unknown): "pending" | "active" | "suspended" | "closed" {
  const s = String(twilioStatus ?? "").toLowerCase();
  if (s === "active" || s === "suspended" || s === "closed") return s;
  // A freshly created subaccount is active; default there rather than to 'pending'.
  return "active";
}

/** The deterministic subaccount FriendlyName convention (adoption reconciliation keys on it). */
export function tenantFriendlyName(tenantId: string, tenantName: string | null): string {
  return tenantName && tenantName.trim() ? `Paige — ${tenantName.trim()}` : `Paige tenant ${tenantId}`;
}

/**
 * Provision (or adopt) ONE tenant's Twilio subaccount, idempotently. All writes
 * go through the SERVICE-ROLE admin client. Every step reports its own status
 * so a caller can drive "step m of n" surfaces; `blocked_needs_config` means
 * the platform's master Twilio credentials are absent (nothing happened).
 */
export async function provisionTenantTwilio(
  admin: SupabaseAdminLike,
  input: TenantProvisionInput,
): Promise<TenantProvisionResult> {
  const { tenantId, tenantName } = input;
  const isAdopt = typeof input.adoptSid === "string" && input.adoptSid.length > 0;
  const steps: ProvisionStep[] = [];
  const base = { tenant_id: tenantId, name: tenantName ?? null };

  // §13: master creds must exist BEFORE we touch anything.
  if (!masterCreds()) {
    return { ...base, outcome: "blocked_needs_config", steps, error: "twilio_master_not_configured" };
  }

  // Idempotency layer 1: a tenant that already HAS a row is never re-provisioned.
  const { data: existingRow, error: rowErr } = await admin
    .from("tenant_twilio_subaccounts")
    .select("twilio_subaccount_sid, api_key_sid, twiml_app_sid")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (rowErr) {
    return { ...base, outcome: "failed", steps, error: `subaccount_read_failed: ${rowErr.message}` };
  }
  if (existingRow) {
    for (const step of ["subaccount", "api_key", "vault", "row"] as ProvisionStepName[]) {
      steps.push({ step, status: "skipped" });
    }
    steps.push({
      step: "twiml_app",
      status: existingRow.twiml_app_sid ? "skipped" : "planned",
    });
    return {
      ...base,
      outcome: "skipped_existing",
      steps,
      subaccount_sid: existingRow.twilio_subaccount_sid ?? null,
      api_key_sid: existingRow.api_key_sid ?? null,
      twiml_app_sid: existingRow.twiml_app_sid ?? null,
    };
  }

  if (input.dryRun) {
    steps.push({ step: "subaccount", status: isAdopt ? "adopted" : "planned" });
    for (const step of ["api_key", "vault", "row", "twiml_app"] as ProvisionStepName[]) {
      steps.push({ step, status: "planned" });
    }
    return { ...base, outcome: isAdopt ? "would_adopt" : "would_provision", steps, subaccount_sid: isAdopt ? input.adoptSid : null };
  }

  const friendlyName = tenantFriendlyName(tenantId, tenantName);

  // 1) Resolve the subaccount SID: ADOPT the existing one, or MINT a new subaccount.
  let subSid: string | undefined;
  let twilioStatus: unknown = undefined;
  if (isAdopt) {
    subSid = input.adoptSid;
    steps.push({ step: "subaccount", status: "adopted" });
  } else {
    const sub = await createSubaccount(friendlyName);
    if (!sub.ok || !sub.data) {
      steps.push({ step: "subaccount", status: "failed", error: sub.error ?? "twilio_create_subaccount_failed" });
      return { ...base, outcome: "failed", steps, error: sub.error ?? "twilio_create_subaccount_failed" };
    }
    subSid = (sub.data as Record<string, unknown>).sid as string | undefined;
    twilioStatus = (sub.data as Record<string, unknown>).status;
    if (!subSid) {
      // Under API-Key auth auth_token is legitimately absent — a missing SID is the only fatal case.
      steps.push({ step: "subaccount", status: "failed", error: "twilio_subaccount_missing_sid" });
      return { ...base, outcome: "failed", steps, error: "twilio_subaccount_missing_sid" };
    }
    steps.push({ step: "subaccount", status: "done" });
  }

  // Definite-assignment guard: both branches above either assigned a real SID or returned.
  const sid: string = subSid as string;

  // 2) Mint a SUBACCOUNT-scoped API Key on subSid (master-authed). The SECRET is shown ONCE.
  const key = await createSubaccountApiKey(sid);
  if (!key.ok || !key.data) {
    steps.push({ step: "api_key", status: "failed", error: key.error ?? "twilio_api_key_create_failed" });
    return {
      ...base, outcome: "failed", steps,
      subaccount_sid: subSid, // real SID — report so a caller can reconcile / re-run
      error: key.error ?? "twilio_api_key_create_failed",
    };
  }
  const apiKeySid = key.data.sid;       // SK…
  const apiKeySecret = key.data.secret; // vault this immediately, NEVER log/return (§34)
  steps.push({ step: "api_key", status: "done" });

  // 3) VAULT the API-Key SECRET (never the raw secret into the table). Upsert-by-name so a
  //    re-run after a failed insert overwrites rather than duplicates.
  const vaultRef = `twilio_subaccount_api_key_secret:${tenantId}`;
  const { data: writtenRef, error: vErr } = await admin.rpc("write_channel_secret", {
    _ref: vaultRef,
    _secret: apiKeySecret,
    _description: `Twilio subaccount API-Key secret for tenant ${tenantId} (Comms C-2a).`,
  });
  if (vErr || writtenRef !== vaultRef) {
    steps.push({ step: "vault", status: "failed", error: `vault_write_failed: ${vErr?.message ?? "unexpected_ref"}` });
    return {
      ...base, outcome: "failed", steps, subaccount_sid: subSid, api_key_sid: apiKeySid,
      error: `vault_write_failed: ${vErr?.message ?? "unexpected_ref"}`,
    };
  }
  steps.push({ step: "vault", status: "done" });

  // 4) INSERT the 1-per-tenant row via SERVICE ROLE with EXPLICIT tenant_id (§9). The unique
  //    constraint uq_tenant_twilio_subaccounts_tenant makes a concurrent double-provision a
  //    conflict, which we treat as already-provisioned (idempotent).
  const { error: iErr } = await admin
    .from("tenant_twilio_subaccounts")
    .insert({
      tenant_id: tenantId,                       // honored because service-role => current_user_tenant_id()=null
      twilio_subaccount_sid: subSid,             // REAL ACxx…
      api_key_sid: apiKeySid,                     // REAL SK… (Basic-auth username, non-secret)
      auth_token_vault_ref: vaultRef,            // the Vault NAME of the API-Key secret, never the secret
      friendly_name: friendlyName,
      // Adopted subaccounts were created earlier; default them 'active' (mapSubaccountStatus
      // with undefined → 'active'), same as a fresh mint. inbound_webhook_secret: DB default.
      status: mapSubaccountStatus(twilioStatus),
    });
  if (iErr) {
    // 23505 = unique_violation => a row already exists (race / prior partial run). Idempotent skip.
    const code = (iErr as { code?: string }).code;
    if (code === "23505") {
      steps.push({ step: "row", status: "skipped" });
      return { ...base, outcome: "skipped_existing", steps, subaccount_sid: subSid, api_key_sid: apiKeySid };
    }
    steps.push({ step: "row", status: "failed", error: `insert_failed: ${iErr.message}` });
    return { ...base, outcome: "failed", steps, subaccount_sid: subSid, api_key_sid: apiKeySid, error: `insert_failed: ${iErr.message}` };
  }
  steps.push({ step: "row", status: "done" });

  // 5) Mint + persist the TwiML Application on the subaccount (Voice foundation,
  //    #140 A1). Reuse the just-minted creds (no extra Vault round-trip). A TwiML-app
  //    failure is NON-FATAL: the row is written, and ensureTwimlApp is idempotent on
  //    twiml_app_sid, so a re-run backfills the app.
  let twimlAppSid: string | null = null;
  let twimlAppError: string | null = null;
  const appRes = await ensureTwimlApp(admin, tenantId, {
    creds: { accountSid: sid, authToken: apiKeySecret, apiKeySid },
  });
  if (appRes.ok && appRes.data) twimlAppSid = appRes.data.applicationSid;
  else twimlAppError = appRes.error ?? "twiml_app_unavailable";
  steps.push({ step: "twiml_app", status: twimlAppSid ? "done" : "failed", ...(twimlAppError ? { error: twimlAppError } : {}) });

  return {
    ...base,
    outcome: isAdopt ? "adopted" : "provisioned",
    steps,
    subaccount_sid: subSid,
    api_key_sid: apiKeySid,
    twiml_app_sid: twimlAppSid,
    twiml_app_error: twimlAppError,
  };
}
