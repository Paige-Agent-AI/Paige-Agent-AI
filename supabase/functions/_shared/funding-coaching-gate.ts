// THE FUNDING & COACHING TOOLS HARNESS GATE — the ONE HOME (§18) for "may this finance/credit provider
// run for THIS workspace right now?", resolved FAIL-CLOSED before any provider contact (owner ruling
// 2026-09-13).
//
// WHAT THIS IS. The "Funding & Coaching Tools" Marketplace package groups the finance/credit providers —
// NOT the universal Solo baseline (§2: finance/credit is never a platform default; it is an opt-in
// preset). Every provider must REFUSE — before contacting the provider or writing anything — unless the
// server confirms the gating facts below. This module resolves those facts and returns one honest verdict.
//
// SCOPE OF THIS SLICE (§13 — do NOT read "the gate exists" as "all finance provider contact is gated").
// This module is WIRED into THREE provider functions today — `smartcredit-pull-snapshot`,
// `nav-pull-profile`, and `business-verifier` (whose fan-out covers Secretary-of-State, OpenCorporates,
// SEC-EDGAR, D&B, LexisNexis, TransUnion Business, Array) — i.e. 9 of the package's providers. Plaid
// (`plaid-*` / `paige-plaid-*`) and iSoftpull are SEPARATE finance entrypoints NOT gated by this module
// yet; they are owed the same gate in a follow-up slice (their own requireAdmin/auth doors govern them
// until then). Do not mistake "3 functions gated" for "every finance provider contact is package-gated".
//
// THE FOUR FACTS (owner ruling). A provider runs only when all hold:
//   (1) PACKAGE ENTITLEMENT — the tenant holds the Funding & Coaching Tools package. Resolved here from
//       the EXACT `is_finance` predicate the persona resolver uses (mig 20260805130000): an ACTIVE install
//       of ANY `is_finance` marketplace item, OR the generic `tenants.features.finance_in_scope` flag. This
//       module is a second READER of that canonical predicate (exactly as growth-page-draft /
//       paige-public-chat read the flag) — NOT a parallel entitlement system.
//   (2) CONNECTION / CONSENT — the tenant has the required Financial connection OR recorded consent/setup
//       state for the provider. NO per-tenant Financial connection model exists for these providers today,
//       so `resolveFundingProviderConnectionState` returns ABSENT for all of them → the gate refuses.
//       Financial Integrations (owner item 6) will later populate that single read point — DO NOT create a
//       table here.
//   (3) AUTHORITY — the caller has tenant-scoped authority to the target. This stays with each provider's
//       EXISTING door (`can_access_contact` / the business-verifier RLS-read door), which runs and 403s
//       BEFORE this gate. The gate's `authorized` fact is therefore OPTIONAL: the three wired providers
//       omit it (authority resolved upstream); it exists so a future caller that wants the gate to also
//       carry authority can pass it and get a `not_authorized` verdict.
//   (4) GATEWAY / risk / approval / budget — the provider's own governed seam. Unchanged here.
//
// HONEST TODAY (§13). Every provider refuses today — but NOT uniformly because of entitlement. The
// universal refusal rests on the CONNECTION fact: `resolveFundingProviderConnectionState` returns ABSENT
// for all three (no Financial connection model exists yet) → `connection_missing`. Entitlement is NOT
// universally `not_entitled`: the `is_finance`/`finance_in_scope` predicate already resolves `entitled`
// for any tenant carrying `features.finance_in_scope=true` (the mig 20260805130000 backfill of
// `playbook='funding'` tenants). CONSEQUENCE (flag to Marketplace #670 + Financial Integrations #6 BEFORE
// the connection point goes live): once `resolveFundingProviderConnectionState` can return satisfied, ANY
// `finance_in_scope` tenant is immediately allowed — a BROADER set than "installed the Funding & Coaching
// Tools bundle". That breadth is owner-directed (the ruling said reuse the existing is_finance seam), but
// it must be a conscious choice, not a surprise. This module still seeds no install and activates no provider.
//
// FAIL CLOSED ON ANY ERROR (§13/§32). An entitlement READ error resolves to `read_error` → `unavailable`
// (never `entitled`); a missing tenant is `read_error`. The gate never allows on an error it could not
// resolve.
//
// SHAPE. A PURE decision core (`decideFundingCoachingGate`) over injected facts — so the matrix is a unit
// test, not an integration ceremony — plus an ASYNC resolver (`resolveFundingCoachingGate`) that reads the
// two server-side facts, mirroring the pure-core + async-gatherer split of the capability-status seam.
// Imports ONLY types (nothing runtime), so it bundles into every provider function and is portable.

/** The finance/credit providers governed by the Funding & Coaching Tools package. */
export type FundingProviderKey = "smartcredit" | "nav" | "business_verifier";

/** (1) The package-entitlement fact. `read_error` is the fail-closed value — an unresolved read, never a
 *  silent `not_entitled` (which would wrongly tell the tenant to "install" when we actually failed to look). */
export type FundingEntitlement = "entitled" | "not_entitled" | "read_error";

/** (2) The canonical per-provider connection/consent fact. `satisfied:true` carries HOW (a connected data
 *  source, or recorded consent/setup state); `satisfied:false` carries WHICH requirement is missing, so the
 *  verdict can distinguish `connection_missing` from `consent_missing`. Each member also declares the
 *  OTHER field as optional so `conn.missing` / `conn.via` are accessible on the union WITHOUT relying on
 *  discriminant narrowing (the repo's tsc config does not narrow discriminated unions); construction still
 *  requires the correct field for each `satisfied` value. */
export type FundingConnectionFact =
  | { satisfied: true; via: "connection" | "consent"; missing?: "connection" | "consent" }
  | { satisfied: false; missing: "connection" | "consent"; via?: "connection" | "consent" };

/** The server-resolved facts the pure decision composes. Injected for unit-testability. */
export type FundingGateFacts = {
  entitlement: FundingEntitlement;
  connection: FundingConnectionFact;
  /** OPTIONAL caller-authority fact. The wired providers enforce authority via their existing door BEFORE
   *  the gate, so they OMIT this (undefined ⇒ authority resolved upstream). A caller that routes authority
   *  through the gate passes `false` to get a `not_authorized` refusal. */
  authorized?: boolean;
  /** OPTIONAL: whether the remediation SURFACES a refusal would point to actually exist yet (the Marketplace
   *  bundle to install / the Financial connection surface to connect). When this is not `true` a refusal may
   *  NOT emit a `setup_required` "install/connect" instruction — that would be a dead remediation path — so
   *  every refusal resolves the honest `unavailable` instead (see FUNDING_TOOLS_REMEDIATION_LIVE). Defaults
   *  to false (fail-honest): a caller that does not assert the surfaces are live gets `unavailable`. */
  remediationLive?: boolean;
};

/**
 * (Codex #1222 review · owner ruling 2026-09-13) WHETHER THE REMEDIATION SURFACES EXIST YET. A refusal may
 * only tell the tenant to "install the package" / "connect your data source" when that surface actually
 * exists to act on. Today the Marketplace "Funding & Coaching Tools" bundle is UNSEEDED and no
 * Settings → Integrations → Financial connection surface ships, so a `setup_required` remediation would be a
 * DEAD instruction — the owner directed the package stay honestly UNAVAILABLE until BOTH surfaces are merged
 * AND deployed. This constant makes every refusal from this gate resolve `unavailable` until then.
 *
 * IT IS NOT A GRANT FLAG. It never enables a provider — the gate fails MORE closed with it false (it only
 * downgrades a refusal's message from "install/connect" to "not available yet"). Flipping it `true` is a
 * one-line, DELIBERATE change once Marketplace #670 seeds the bundle and Financial Integrations #6 ships the
 * connection surface — never a runtime access decision, never a mutable global that gates provider contact.
 */
export const FUNDING_TOOLS_REMEDIATION_LIVE = false;

/** Why the gate decided as it did. */
export type FundingGateState =
  | "allowed"
  | "entitlement_missing"
  | "connection_missing"
  | "consent_missing"
  | "not_authorized";

/** The caller-facing result class. `ok` runs; `setup_required` is an honest "install/connect first";
 *  `unavailable` is a fail-closed "couldn't confirm / not authorized" (never a silent allow). */
export type FundingGateResult = "ok" | "setup_required" | "unavailable";

export type FundingGateVerdict = {
  allowed: boolean;
  result: FundingGateResult;
  state: FundingGateState;
  /** Always present — never an unexplained refusal (§13). Empty only on an `ok` allow. */
  reason: string;
};

/**
 * THE PURE DECISION. Most-restrictive-wins, fail-closed. Order: entitlement read-error (can't confirm →
 * refuse) → entitlement absent (install the package) → authority (when routed through here) → connection/
 * consent requirement. A provider runs only when every fact clears.
 *
 * REMEDIATION HONESTY (Codex #1222 · owner ruling 2026-09-13). A `setup_required` verdict tells the tenant
 * to install/connect something — an HONEST instruction ONLY when that surface exists. Until the remediation
 * surfaces are live (`facts.remediationLive === true`), every would-be `setup_required` refusal resolves the
 * honest `unavailable` instead, while KEEPING the precise `state` (entitlement/connection/consent_missing)
 * for the audit trail. The read-error and not_authorized refusals are already `unavailable` and unaffected.
 * This only ever fails MORE closed; it never widens access.
 */
export function decideFundingCoachingGate(facts: FundingGateFacts): FundingGateVerdict {
  const remediationLive = facts.remediationLive === true;
  // The honest refusal when no remediation surface exists to act on yet. Keeps the diagnostic `state`.
  const notAvailableYet = (state: FundingGateState): FundingGateVerdict => ({
    allowed: false,
    result: "unavailable",
    state,
    reason: "Funding & Coaching Tools isn't available on this workspace yet.",
  });

  // (1) ENTITLEMENT — the package gate, first and fail-closed.
  if (facts.entitlement === "read_error") {
    return {
      allowed: false,
      result: "unavailable",
      state: "entitlement_missing",
      reason: "Paige couldn't confirm the Funding & Coaching Tools package is active for this workspace, so this was not run.",
    };
  }
  if (facts.entitlement !== "entitled") {
    return remediationLive
      ? {
          allowed: false,
          result: "setup_required",
          state: "entitlement_missing",
          reason: "Install the Funding & Coaching Tools package to enable this.",
        }
      : notAvailableYet("entitlement_missing");
  }

  // (3) AUTHORITY — only when the caller routed it through the gate (the wired providers enforce it
  //     upstream and omit this). A false fact is a belt-and-suspenders refusal (already `unavailable`).
  if (facts.authorized === false) {
    return {
      allowed: false,
      result: "unavailable",
      state: "not_authorized",
      reason: "Not authorized to use this in this workspace.",
    };
  }

  // (2) CONNECTION / CONSENT — the required Financial connection or recorded consent/setup state.
  // Narrow on a const local so the discriminated-union narrowing is robust across TS versions (the repo's
  // tsc does not persist the `satisfied` discriminant across the `facts.connection.*` property path).
  const conn = facts.connection;
  if (!conn.satisfied) {
    const state: FundingGateState = conn.missing === "consent" ? "consent_missing" : "connection_missing";
    if (!remediationLive) return notAvailableYet(state);
    return conn.missing === "consent"
      ? {
          allowed: false,
          result: "setup_required",
          state: "consent_missing",
          reason: "Record the required consent before Paige can use this.",
        }
      : {
          allowed: false,
          result: "setup_required",
          state: "connection_missing",
          reason: "Connect your Financial data source before Paige can use this.",
        };
  }

  return { allowed: true, result: "ok", state: "allowed", reason: "" };
}

/**
 * (2) THE CANONICAL CONNECTION/CONSENT READ POINT. There is NO per-tenant Financial connection/consent
 * model for SmartCredit / Nav / business-verifier today, so the fact is ABSENT for all three → the gate
 * refuses (fail closed). This is the SINGLE documented read point Financial Integrations (owner item 6)
 * will back later — returning `{ satisfied:true, via:"connection" }` when a tenant has connected its
 * Financial data source, or `{ satisfied:true, via:"consent" }` when consent/setup state is on file. DO
 * NOT create a table or a second read point here.
 */
export function resolveFundingProviderConnectionState(
  _tenantId: string | null,
  _providerKey: FundingProviderKey,
): FundingConnectionFact {
  return { satisfied: false, missing: "connection" };
}

/** The minimal service-role client surface the async resolver needs (a tenant-scoped read only). */
export type FundingGateDb = {
  from: (table: string) => {
    // deno-lint-ignore no-explicit-any
    select: (cols: string) => any;
    // deno-lint-ignore no-explicit-any
    insert: (row: Record<string, unknown>) => any;
  };
};

/**
 * (1) Resolve the package-entitlement fact — the EXACT `is_finance` predicate from mig 20260805130000,
 * read with an EXPLICIT tenant id (service-role; no JWT). Two legs, either ⇒ entitled:
 *   (a) an ACTIVE install of any `is_finance` marketplace item (the catalog gate), and
 *   (b) the generic `tenants.features.finance_in_scope` flag (set by an is_finance Blueprint's install
 *       manifest; mirrors `deriveFinanceInScopeFromFeatures`).
 * Computed as two basic reads rather than an embedded join so it cannot depend on PostgREST embedded-filter
 * resolution, and FAILS CLOSED to `read_error` on any DB error or a missing tenant (§13/§32).
 *
 * Exported (E09 H0) so other server-side callers read the per-business entitlement through THIS one
 * reader rather than a second copy: `detect-credit-alerts` refuses to alert for a business it does not
 * resolve `entitled`. The SQL twin is the persona expression in `get_paige_persona_context`; the drift
 * test `detect-credit-alerts/authority.test.ts` holds the two to the same predicate.
 */
export async function resolveFinanceEntitlement(db: FundingGateDb, tenantId: string | null): Promise<FundingEntitlement> {
  if (!tenantId) return "read_error";
  try {
    // (a) active installs for this tenant — the EXISTS over marketplace_installs JOIN marketplace_items.
    const { data: installs, error: instErr } = await db
      .from("marketplace_installs")
      .select("item_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active");
    if (instErr) {
      console.error("funding-coaching-gate: marketplace_installs read failed", instErr.message ?? String(instErr));
      return "read_error";
    }
    const itemIds = (Array.isArray(installs) ? installs : [])
      .map((r: { item_id?: unknown }) => r.item_id)
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
    if (itemIds.length > 0) {
      const { data: financeItems, error: itemErr } = await db
        .from("marketplace_items")
        .select("id")
        .in("id", itemIds)
        .eq("is_finance", true)
        .limit(1);
      if (itemErr) {
        console.error("funding-coaching-gate: marketplace_items read failed", itemErr.message ?? String(itemErr));
        return "read_error";
      }
      if (Array.isArray(financeItems) && financeItems.length > 0) return "entitled";
    }

    // (b) generic features.finance_in_scope flag — mirrors _shared/client-context deriveFinanceInScopeFromFeatures.
    const { data: tenantRow, error: tenantErr } = await db
      .from("tenants")
      .select("features")
      .eq("id", tenantId)
      .maybeSingle();
    if (tenantErr) {
      console.error("funding-coaching-gate: tenants read failed", tenantErr.message ?? String(tenantErr));
      return "read_error";
    }
    const features = tenantRow?.features;
    const inScope = features && typeof features === "object" && !Array.isArray(features)
      ? ((features as Record<string, unknown>).finance_in_scope === true ||
         (features as Record<string, unknown>).finance_in_scope === "true")
      : false;
    return inScope ? "entitled" : "not_entitled";
  } catch (e) {
    console.error("funding-coaching-gate: entitlement read threw", String(e));
    return "read_error";
  }
}

/**
 * THE ASYNC RESOLVER. Composes the two server-side facts (entitlement read + connection/consent) and
 * returns the pure verdict. Everything is fail-closed: an entitlement read error resolves `unavailable`,
 * never a silent allow. `authorized` is passed through (the wired providers omit it — see the header).
 */
export async function resolveFundingCoachingGate(
  db: FundingGateDb,
  opts: { tenantId: string | null; providerKey: FundingProviderKey; authorized?: boolean },
): Promise<FundingGateVerdict> {
  let entitlement: FundingEntitlement;
  try {
    entitlement = await resolveFinanceEntitlement(db, opts.tenantId);
  } catch (e) {
    console.error("funding-coaching-gate: resolver threw", String(e));
    entitlement = "read_error";
  }
  const connection = resolveFundingProviderConnectionState(opts.tenantId, opts.providerKey);
  // `remediationLive` is the module constant (false today): while the Marketplace bundle and the Financial
  // connection surface do not exist, a refusal resolves the honest `unavailable`, never a dead
  // "install/connect" instruction (Codex #1222 · owner ruling 2026-09-13).
  return decideFundingCoachingGate({
    entitlement,
    connection,
    authorized: opts.authorized,
    remediationLive: FUNDING_TOOLS_REMEDIATION_LIVE,
  });
}

/** The governed-decision row for `paige_audit_log`, shaped EXACTLY like the sibling door row-builders
 *  (`contactScopedGovernedAuditRow` / `businessVerifyGovernedAuditRow`) so it lands on the same channel.
 *  `enforcement: "funding_coaching_entitlement_gate"` names the real reason honestly — never the
 *  `authority` label the authority doors use (§13). The caller adds `actor_user_id` / `actor_role`. */
export function fundingGateAuditRow(params: {
  /** The `paige_audit_log` action-name stem (e.g. `smartcredit_pull` → `smartcredit_pull_funding_gate_refuse`). */
  actionPrefix: string;
  /** The canonical action-risk capability key (recorded as provenance, e.g. `smartcredit_pull_snapshot`). */
  capability: string;
  /** The `target_type` column value (e.g. `smartcredit_snapshot`). */
  targetType: string;
  providerKey: FundingProviderKey;
  /** The SUBJECT's workspace, resolved server-side — never the request body. Null when unresolved. */
  tenantId: string | null;
  /** The subject the decision was about (contact or business), for the payload. */
  subjectKind: "contact" | "business";
  subjectId: string;
  verdict: FundingGateVerdict;
  startedAtMs: number;
  nowIso: string;
}): { action: string; tenant_id: string | null; target_type: string; target_id: null; payload: Record<string, unknown> } {
  return {
    action: `${params.actionPrefix}_funding_gate_${params.verdict.allowed ? "allow" : "refuse"}`,
    tenant_id: params.tenantId,
    target_type: params.targetType,
    target_id: null,
    payload: {
      capability: params.capability,
      enforcement: "funding_coaching_entitlement_gate",
      package: "funding_and_coaching_tools",
      provider: params.providerKey,
      decision: params.verdict.allowed ? "allow" : "refuse",
      gate_result: params.verdict.result,
      gate_state: params.verdict.state,
      reason: params.verdict.reason,
      [`${params.subjectKind}_id`]: params.subjectId,
      tenant_source: "server",
      decided_at: params.nowIso,
      decision_ms: Math.max(0, Date.now() - params.startedAtMs),
    },
  };
}

/** Record ONE funding-gate decision on `paige_audit_log` (service-role), reusing the providers' existing
 *  audit channel. Non-fatal: a logging failure never changes the decision (mirrors each door's
 *  writeGoverned*Audit). supabase-js resolves a DB rejection as `{ error }`, so inspect and log it loudly. */
export async function recordFundingGateDecision(
  db: FundingGateDb,
  params: {
    actorUserId: string | null;
    actorRole: string;
    row: ReturnType<typeof fundingGateAuditRow>;
  },
): Promise<void> {
  try {
    const { error } = await db.from("paige_audit_log").insert({
      actor_user_id: params.actorUserId,
      actor_role: params.actorRole,
      ...params.row,
    });
    if (error) console.error("funding-coaching-gate audit not recorded", error.message ?? String(error));
  } catch (e) {
    console.error("funding-coaching-gate audit not recorded (threw)", String(e));
  }
}
