import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

/**
 * EXP00 O-3 (owner defect 2026-10-19): PAIGE Inc's own company read capabilities — the
 * Platform Operator's conversational COO tools.
 *
 * The owner asked "who we have joined so far?" from the operator console and got tenant-CRM
 * routing ("tenant not resolved") plus unverified absence claims, because no company-scoped
 * data source existed in chat. These declarations front the SAME canonical RPCs the
 * Customers desk and Billing read (O-1/O-2) — one source of truth, no second engine.
 *
 * Scope honesty: these are PLATFORM reads. The SQL executors gate on
 * is_platform_admin(auth.uid()) — a workspace role grants nothing, and chat dispatches them
 * through the caller-JWT client so the database gate is enforced on every call. The shared
 * tenant-scope seam (current_user_tenant_id) resolves NULL for an operator by design; the
 * reads proceed on the operator identity, never on a tenant. tenantScope below names the
 * shared seam as the Kit contract requires while the RPC is the authority.
 */

const scope = { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] } as const;
const availability = { resolver: "paige-capability-status", states: ["live", "not_for_tier", "unavailable"] } as const;
const surface = "/operator";

export const PLATFORM_CUSTOMER_OVERVIEW_CAPABILITY = defineCapability({
  identity: { id: "platform.customers_overview", version: 1, domain: "platform", owner: "paige-platform-operator", humanSurface: surface,
    description: "PAIGE Inc company view: one row per customer who joined the platform — business name, enrollment state, subscription status with trial-vs-paid truth, whether the workspace provisioned, welcome-email state, and who needs attention. Platform Operator only; the RPC gate is is_platform_admin." },
  input: objectInputSchema({ properties: {}, required: [] }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("platform.customers_overview.read") },
  tenantScope: scope,
  availability,
  providerBinding: { kind: "internal", operation: "public.operator_commercial_customers", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

export const PLATFORM_COMMERCIAL_SUMMARY_CAPABILITY = defineCapability({
  identity: { id: "platform.commercial_summary", version: 1, domain: "platform", owner: "paige-platform-operator", humanSurface: surface,
    description: "PAIGE Inc commercial truth: trials vs paid, real ARR from live Stripe-backed subscriptions only, collected cash from PAID invoices only, open receivables, upcoming renewals, the payment method on file, and the 90-day signup funnel. Platform Operator only; trials are intent, never cash." },
  input: objectInputSchema({ properties: {}, required: [] }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("platform.commercial_summary.read") },
  tenantScope: scope,
  availability,
  providerBinding: { kind: "internal", operation: "public.operator_billing_overview", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

export const PLATFORM_OPERATOR_READ_CAPABILITIES = [
  {
    key: "platform.customers_overview", domain: "platform", owner: "paige-platform-operator",
    humanSurface: surface, readiness: "none", selfDescribe: true,
    action: { classification: "read" as const, executor: "public.operator_commercial_customers", chatTool: "platform_customer_overview",
      seatAuthority: "member" as const,
      idempotency: "Existing caller-JWT platform-admin-gated read; the RPC refuses anyone but a platform admin. No rows written.",
      riskPolicyKey: "read_only" as const, approvalAuthority: "none" as const },
    chatBinding: "LIVE" as const, mindBinding: "UNAVAILABLE" as const, sharedPrimitiveChange: "NONE" as const, maturity: "PARTIAL" as const,
  },
  {
    key: "platform.commercial_summary", domain: "platform", owner: "paige-platform-operator",
    humanSurface: surface, readiness: "none", selfDescribe: true,
    action: { classification: "read" as const, executor: "public.operator_billing_overview", chatTool: "platform_commercial_summary",
      seatAuthority: "member" as const,
      idempotency: "Existing caller-JWT platform-admin-gated read; the RPC refuses anyone but a platform admin. No rows written.",
      riskPolicyKey: "read_only" as const, approvalAuthority: "none" as const },
    chatBinding: "LIVE" as const, mindBinding: "UNAVAILABLE" as const, sharedPrimitiveChange: "NONE" as const, maturity: "PARTIAL" as const,
  },
] as const satisfies readonly SpineCapability[];

export const PLATFORM_OPERATOR_READ_TOOLS = [
  { type: "function" as const, function: {
    name: "platform_customer_overview",
    description: PLATFORM_CUSTOMER_OVERVIEW_CAPABILITY.identity.description,
    parameters: PLATFORM_CUSTOMER_OVERVIEW_CAPABILITY.input,
  } },
  { type: "function" as const, function: {
    name: "platform_commercial_summary",
    description: PLATFORM_COMMERCIAL_SUMMARY_CAPABILITY.identity.description,
    parameters: PLATFORM_COMMERCIAL_SUMMARY_CAPABILITY.input,
  } },
];
