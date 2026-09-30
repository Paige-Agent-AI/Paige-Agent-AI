/**
 * Tier → feature baseline — the §60 ONE HOME for "which account type gets which
 * feature" (owner-ruled 2026-08-11).
 *
 * WHY THIS EXISTS (§60 same-tier feature parity + structural enforcement):
 * A feature's availability per tier was previously decided ad-hoc inside each
 * render gate — an `account_type === "agency"` here, a `parent_tenant_id` check
 * there — so the SAME capability could silently appear on one account type and
 * vanish on another by accident of which branch/route/emptyState it was bolted
 * into (§56). That is exactly the leak this file closes: features DECLARE their
 * tiers HERE, once, and every render gate reads the answer through `hasFeature`
 * / `useTierFeatures`. A new tier, or a change to who gets a feature, is a
 * one-line edit in this map — never a hunt across dozens of gates.
 *
 * SCOPE — this is the BASELINE only:
 *   - Opt-in installs (a Marketplace skill, a Playbook capability toggled via
 *     `tenants.features`) layer ON TOP of this baseline (§2 finance-as-opt-in is
 *     the canonical example) and are NOT encoded here. This map is the
 *     coaching-generic, always-on floor per tier; the ∪-with-opt-ins merge lives
 *     at the call site (see `useTierFeatures` for where it would layer in).
 *   - This is the BUILD-TIME / UI structural lock: every render gate derives its
 *     answer here (enforced by `lint:tier-features`), so the SAME capability can
 *     never silently appear on one tier and vanish on another. For most features
 *     that is backed by server RLS/RPC authority (§9), so the UI mirror is the
 *     convenience layer. `customer_portal_invite` IS now server-enforced too — the
 *     RPC `create_tenant_invite_token` rejects a `_kind='consumer'` mint for a pure
 *     AGENCY target tenant only (migration 20260824000000 narrowed the guard from
 *     agency+enterprise → agency, matching the Enterprise HYBRID ruling; enterprise
 *     now gets portal-invite on BOTH layers, closing flag 1 from PR #458).
 *     Likewise `growth`/`studio` gate the /admin/campaigns + /admin/studio routes
 *     via `RequireFeature` (not nav-only, §13). The UI helper and the server gate
 *     mirror one owner ruling (2026-08-11).
 *
 * PURE by construction — no data fetch, no `any`. Callers pass the already-
 * resolved `TierClassification` (from `useTenantContext`). Keep the tier
 * vocabulary in lockstep with `accountCapabilities.ts` + `tierLabels.ts`.
 *
 * CI: `scripts/ci/tier-feature-lint.mjs` (`npm run lint:tier-features`) fails any
 * NEW render-gate that hardcodes `account_type ===` / a tenant-UUID compare
 * instead of routing through this helper (routing sites carry an inline
 * `// tier-feature-exempt: <reason>` marker).
 */

import type { TierClassification } from "@/lib/agency/tierLabels";

export type { TierClassification };

/**
 * The features whose per-tier availability this baseline governs. String-literal
 * union so `hasFeature`/`getTierFeatureSet` are typo-proof and the CI/tests can
 * enumerate the surface. Add a feature here, then add it to the baseline sets
 * below for every tier that gets it.
 */
export type Feature =
  // Universal (§35) — every tier, God included.
  | "command_center"
  | "systems_check"
  | "marketplace"
  | "analytics"
  | "setup"
  | "paige_hub"
  // Tenant working CRM cluster (solo · sub_account · agency · enterprise; NOT God).
  | "people_crm"
  | "pipeline"
  | "conversations"
  | "calendar"
  // Creation surfaces — Vibe Studio + Campaigns (the Growth hub). solo · sub_account ·
  // enterprise · god; NOT agency (owner ruling 2026-08-11 — an agency manages
  // sub-accounts, it doesn't run its own campaigns/creative book).
  | "growth"
  | "studio"
  // Skills engine — the methodology-anchored paige_skills a tenant RUNS on its own book.
  // §61 Standing Tier Distribution Default: this Feature is the SELF-USE gate → solo ·
  // sub_account · enterprise · god. An AGENCY does NOT self-use skills; its §61 "resell"
  // right (reselling the skill library to its sub-accounts) is a MARKETPLACE concept, NOT
  // a tier Set bit (the baseline Sets carry self-use only; Marketplace opt-ins/resale
  // layer at the call site — see the scope note above). enterprise = yes+resell (self-use
  // here via the Solo union + resell in the Marketplace layer).
  | "skills"
  // Consumer/client portal invite — THE §60 enforced lock: solo + sub_account +
  // enterprise (the HYBRID tier). A pure agency is excluded on BOTH layers.
  | "customer_portal_invite"
  // Agreements (INT-163) — send a document to one of your OWN clients for signature.
  // §61 EXCEPTION, and the same shape as `customer_portal_invite` for the same reason: this acts on
  // a direct client book. A pure Agency manages sub-accounts rather than clients, so it has no book
  // to send an agreement into; God is the platform operator, not a tenant with clients of its own.
  // Solo + Sub-account + Enterprise (the hybrid tier), mirroring the lock already ruled for portal
  // invites. Noting it as an exception rather than silently following the §61 default, because the
  // default (God/Solo/Sub YES, Agency RESELL) would put it somewhere it has nothing to act on.
  //
  // WHERE THIS IS ENFORCED (§60's honesty clause — say the layer, do not imply one). NOT here: this
  // declaration had zero `hasFeature` call sites, which the INT-163 review correctly called a flag
  // read by no code and recorded as live. Enforcement is server-side, where a flag cannot be
  // bypassed by calling the RPC directly: `trg_agreement_tier` (migration `20270405000000`) refuses
  // the INSERT for a top-level agency on every write path including the service role, and
  // `agreement-send` refuses with a sentence the operator can act on before it gets that far. The
  // declaration stays because it is how a surface asks the question; the database is what answers it.
  | "agreement_signing"
  // Trust Compass — the Solo Command Center's governed per-capability autonomy control
  // (its 3rd sub-tab). SOLO ONLY for now: sub-account release is DEFERRED pending an
  // explicit owner release (owner ruling 2026-09-06 under the Second Brain delivery
  // contract — "no subaccount delivery without explicit release"). The Command Center
  // SHELL is universal, but this sub-tab is gated OFF sub-accounts until released.
  // Enterprise inherits it via the Solo union (harmless — enterprise renders a
  // different shell); agency/god render different shells and don't carry it.
  | "trust_compass"
  // Live Conversation — speaking with Paige in real time, on the tenant's own workspace and
  // book. SOLO for now, mirroring `trust_compass` above and for the same reason: the standing
  // owner ruling of 2026-09-06 defers sub-account delivery until an explicit release, and the
  // owner named Solo when he asked for this ("I want this to be available for my solo tier for
  // all of my users", 2026-09-23). Opening it wider is a one-line edit here plus the matching
  // server scope — it is not a rebuild, which is the point of declaring it as a tier feature at
  // all. Enterprise inherits it through the Solo union below; harmless, as enterprise renders a
  // different shell (same posture as trust_compass).
  //
  // WHERE THIS IS ENFORCED (§60's honesty clause — name the layer, do not imply one). NOT here.
  // The database answers: `live_conversation_tier_allows(tenant_id)` (migration 20270422000000)
  // derives the same question from tier, and `paige_live_pilot_authorized_internal` refuses
  // admission on every path including the service role. This declaration is how a SURFACE asks
  // whether to render the entry point; it grants nothing. A brand-new Solo tenant satisfies the
  // server predicate the moment it is provisioned, with no operator action and no per-account row.
  //
  // ALSO NOT A LICENCE TO SPEAK. Tier eligibility is one of three independent conditions. The
  // rollout scope (`paige_voice_readiness.pilot_rollout_scope`, a setting that names no person)
  // and the subject's own acceptance both still apply, and the provider gate is unresolved, so
  // this ships with the scope at 'off' and refuses everyone until that one value changes.
  | "live_conversation"
  // Parent-tier only.
  | "subaccount_management"
  // Operator only.
  | "fleet_console"
  // Platform alerting — rules over platform SIGNALS, operator-scope. §61 EXCEPTION,
  // same shape as `fleet_console`: God ONLY. A rule here watches the PLATFORM (failing
  // checks, tenants at risk, LLM failover), which is the operator's book, not a
  // tenant's. Tenant-tier alerting is a SEPARATE owner decision with its own §51 matrix
  // row — assuming it now is exactly the §56 pre-build failure this helper exists to
  // stop. Owner-ruled 2026-08-20 with the A1 green light.
  | "platform_alerting";

/** The resolved tier key. `enterprise` is the HYBRID tier (Solo ∪ Agency baselines). */
export type TierKey = "god" | "agency" | "enterprise" | "sub_account" | "solo";

/**
 * Resolve the tier key from an already-resolved classification.
 *
 * God = platform operator with NO active tenant (`isPlatformStaff` true and no
 * `account_type`). Otherwise map the tenant's `account_type`:
 *   'agency' → agency · 'enterprise' → enterprise · 'sub_account' → sub_account ·
 *   'standalone' / null / anything-else → solo (fail-safe to the least-privileged
 *   tenant tier).
 *
 * NOTE (§51 ABSOLUTE INVARIANT): a child (non-null `parent_tenant_id`) is NEVER a
 * manager tier — so parentage is checked FIRST. This both maps the legacy
 * `account_type='standalone'` sub-accounts (parented, but not typed `sub_account`)
 * to `sub_account` rather than `solo`, AND defends against a mistyped child (the
 * Antonio Daniel LLC bug — `account_type='agency'` while parented) resolving to a
 * manager tier. `account_type='sub_account'` is the current provisioning value and
 * resolves the same way; the switch below only runs for top-level tenants.
 */
export function resolveTierKey(c: TierClassification): TierKey {
  if (c.isPlatformStaff && !c.account_type) return "god";
  // Parent-first (§51): any parented tenant is a sub-account under the single-level
  // agency model. Mirrors AgentPresence.deriveAccountType's proven parent-first check.
  if (c.parent_tenant_id) return "sub_account";
  switch (c.account_type) {
    case "agency":
      return "agency";
    case "enterprise":
      return "enterprise";
    case "sub_account":
      return "sub_account";
    default:
      // 'standalone', null, or an unknown/unresolved type → solo (least-privileged).
      return "solo";
  }
}

/**
 * STRICT Solo-shell mount gate (§51/§58). Unlike `resolveTierKey` — which fail-safes
 * a `null`/unknown `account_type` to the least-privileged "solo" — this requires the
 * LITERAL `account_type='standalone'` on a top-level (no-parent) tenant. It exists so
 * the flag-gated Solo greenfield shell (Admin.tsx) can NEVER take over a freshly
 * provisioned tenant whose `account_type` is still `null`, a mistyped child, or an
 * operator/retired row. Kept in this one home so no render gate hardcodes an
 * `account_type ===` compare (§60 lint:tier-features).
 */
export function isSoloStandalone(c: TierClassification): boolean {
  return !c.parent_tenant_id && c.account_type === "standalone";
}

// --- Baseline building blocks ------------------------------------------------

/** Universal surfaces (§35) — present on every tier, God included. */
const UNIVERSAL: readonly Feature[] = [
  "command_center",
  "systems_check",
  "marketplace",
  "analytics",
  "setup",
  "paige_hub",
];

/**
 * Tenant working CRM cluster — People/Pipeline/Conversations every TENANT tier has
 * today (NOT God, which is the platform operator, not a book of clients).
 *
 * OWNER-DECISION (deferred, task #124): confirm whether Agency keeps
 * People/Pipeline/Conversations. Included here to match current behavior; the
 * fuller Agency-baseline ruling is task #124. If the owner rules Agency should NOT
 * carry these, drop them from AGENCY (and ENTERPRISE, which inherits it).
 *
 * NOTE (§60, 2026-08-11): `growth` is NO LONGER part of this cluster — the creation
 * surfaces (Growth hub = Campaigns + Vibe Studio) split into CREATION_SURFACES
 * below because the owner ruled they are NOT available to agencies.
 */
const TENANT_WORKING: readonly Feature[] = [
  "people_crm",
  "pipeline",
  "conversations",
  "calendar",
];

/**
 * Creation surfaces — the Growth hub (Campaigns) + Vibe Studio. OWNER RULING
 * (2026-08-11): available to solo · sub_account · enterprise · god — NOT agency.
 * An agency manages sub-accounts, so it does not carry its own campaign/creative
 * book; enterprise KEEPS creation (it is built creation-capable like solo/sub, a
 * deliberate flagged choice distinct from agency — the fuller Enterprise baseline
 * is task #124); god carries them for §35 operator dogfooding.
 */
const CREATION_SURFACES: readonly Feature[] = ["growth", "studio"];

// --- Per-tier baselines ------------------------------------------------------
//
// Each tier's ReadonlySet is the coaching-generic, always-on feature floor for
// that account type. Enterprise is built as a SUPERSET of Agency (spread agency
// + any enterprise-only extras) so it can never silently fall BELOW agency.

const SOLO_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  ...UNIVERSAL,
  ...TENANT_WORKING,
  ...CREATION_SURFACES, // solo runs its own campaigns/Studio
  "customer_portal_invite", // solo owns its own client book → can invite clients
  "agreement_signing", // and can send that client an agreement to sign
  "skills", // §61 self-use — solo runs the skills engine on its own book
  "trust_compass", // Solo governs its own per-capability autonomy (Command Center 3rd sub-tab)
  "live_conversation", // Solo can speak with Paige in real time on its own workspace (server-enforced)
]);

const SUB_ACCOUNT_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  ...UNIVERSAL,
  ...TENANT_WORKING,
  ...CREATION_SURFACES, // a sub-account runs its own campaigns/Studio
  "customer_portal_invite", // a sub-account runs its OWN client book → can invite
  "agreement_signing", // same book, same capability as Solo
  "skills", // §61 self-use — a sub-account runs the skills engine on its own book
  // NO "trust_compass" — sub-account release DEFERRED pending explicit owner release
  // (owner ruling 2026-09-06). The Command Center shell is universal, but this sub-tab
  // is gated OFF sub-accounts for now.
]);

const AGENCY_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  ...UNIVERSAL,
  ...TENANT_WORKING, // OWNER-DECISION (task #124): agency CRM cluster pending confirmation
  "subaccount_management",
  // NOTE: NO CREATION_SURFACES — an agency EXCLUDES growth + studio (owner ruling
  // 2026-08-11): it manages sub-accounts, it does not run its own campaigns/creative.
  // NOTE: NO `customer_portal_invite` — an agency manages sub-accounts, not a
  // direct consumer client book (owner ruling 2026-08-11). THE §60 lock. Enforced
  // BOTH server-side (create_tenant_invite_token's consumer guard, migration
  // 20260823000000) AND at the UI/build-time layer across all 5 minters + this
  // CI-guarded helper.
]);

// Enterprise = the HYBRID tier (owner-locked 2026-08-11). It is the ONLY tier that
// inherits BOTH baselines: the full Solo/Sub-account "doing" surface (CRM, creation,
// customer_portal_invite) AND the Agency "managing" surface (subaccount_management).
// Built as a strict UNION so it can never silently fall below either parent. This
// closes flag 1 from PR #458 — before this ruling enterprise carried creation but NOT
// customer_portal_invite, an internal inconsistency (creation-capable yet unable to
// invite the very clients those campaigns are for). Per-tenant Enterprise
// customization layers ON TOP per the §60 Enterprise carve-out.
const ENTERPRISE_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  ...SOLO_FEATURES, // the full doing surface: CRM + creation + customer_portal_invite
  ...AGENCY_FEATURES, // + the managing surface: subaccount_management
  ...CREATION_SURFACES, // explicit (already in SOLO) — enterprise is never non-creation
]);

const GOD_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  ...UNIVERSAL,
  ...CREATION_SURFACES, // §35 dogfooding — operators use the creation tools too
  "fleet_console",
  "platform_alerting", // operator-scope alert rules over platform signals (§61 exception, God-only)
  "skills", // §61/§35 — God dogfoods the skills engine (source of truth §57)
  // NOTE: NO tenant CRM cluster (people/pipeline/conversations) and NO
  // customer_portal_invite — God is the platform operator, not a tenant with a
  // client book. Creation surfaces ARE carried for operator dogfooding (§35).
]);

/**
 * The §60 source-of-truth map. Every render gate resolves its answer through
 * this, never through an inline `account_type` compare.
 */
const TIER_FEATURE_BASELINE: Record<TierKey, ReadonlySet<Feature>> = {
  god: GOD_FEATURES,
  agency: AGENCY_FEATURES,
  enterprise: ENTERPRISE_FEATURES,
  sub_account: SUB_ACCOUNT_FEATURES,
  solo: SOLO_FEATURES,
};

/** The baseline feature set for a classification (§60). PURE — no data fetch. */
export function getTierFeatureSet(c: TierClassification): ReadonlySet<Feature> {
  return TIER_FEATURE_BASELINE[resolveTierKey(c)];
}

/** Does this tier's baseline include `feature`? The one render-gate primitive. */
export function hasFeature(c: TierClassification, feature: Feature): boolean {
  return getTierFeatureSet(c).has(feature);
}
