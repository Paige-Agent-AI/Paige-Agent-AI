import type { SpineCapability } from "../contracts.ts";

/**
 * EXP00 O-3 (owner defect 2026-10-19): PAIGE Inc's own company read capabilities —
 * the Platform Operator's conversational COO tools.
 *
 * The owner asked "who we have joined so far?" from the operator console and got
 * tenant-CRM routing ("tenant not resolved") plus unverified absence claims, because
 * no company-scoped data source existed in chat. These capabilities front the SAME
 * canonical RPCs the Customers desk and Billing surfaces read (O-1/O-2) — one source
 * of truth, no second engine, no invented figures.
 *
 * The executors are the platform-admin-gated SQL functions themselves; chat dispatches
 * them through the CALLER-JWT client, so is_platform_admin(auth.uid()) is enforced on
 * every call by the database — the chat-side admission only shapes the refusal.
 */
export const PLATFORM_OPERATOR_READ_CAPABILITIES = [
  {
    key: "platform.customers_overview",
    domain: "platform",
    tool: "platform_customer_overview",
    summary: "Who has joined PAIGE Inc: enrollments, trials, provisioned workspaces, welcome emails, attention.",
  },
  {
    key: "platform.commercial_summary",
    domain: "platform",
    tool: "platform_commercial_summary",
    summary: "PAIGE Inc commercial truth: trials vs paid, real ARR, collected cash from paid invoices, receivables, renewals, funnel.",
  },
].map(({ key, domain, tool, summary }) => ({
  key, domain, owner: "paige-platform-operator", humanSurface: "/operator (relationships/customers · settings/billing)",
  readiness: "none", selfDescribe: true,
  action: {
    classification: "read" as const,
    executor: tool === "platform_customer_overview"
      ? "public.operator_commercial_customers"
      : "public.operator_billing_overview",
    chatTool: tool,
    idempotency: summary,
    riskPolicyKey: "read_only" as const,
    approvalAuthority: "none" as const,
  },
  chatBinding: "LIVE" as const, mindBinding: "UNAVAILABLE" as const, sharedPrimitiveChange: "NONE" as const,
  maturity: "PARTIAL" as const,
} as const satisfies SpineCapability));
