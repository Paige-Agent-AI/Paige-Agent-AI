import type { SpineCapability } from "../contracts.ts";

/** C0b declarations of incumbent adapters, not new executors. Chat binding names
 * code already wired on the existing surface; PARTIAL does not assert authenticated
 * acceptance, provider availability, Rail completeness or automatic safe retry.
 * Existing Chat gates, caller-JWT/RLS checks and trusted internal service boundaries
 * remain the authority. Hidden duplicate/internal tools remain hidden.
 */
export const C0B_INCUMBENT_ADAPTER_CAPABILITIES = ([
  { key: "calendar.book_meeting", tool: "calendar_book_meeting", domain: "calendar", owner: "paige-calendar",
    executor: "public.create_internal_booking", classification: "mutate", riskPolicyKey: "high", seatAuthority: "workspace-admin", selfDescribe: true,
    idempotency: "Not idempotent: the existing caller-JWT booking RPC inserts a new internal booking for each call. Chat supplies no request key or operation receipt; blind retry may create another booking. Tenant, host and contact checks remain in the RPC." },
  { key: "calendar.link_send", tool: "calendar_link_send", domain: "calendar", owner: "paige-calendar",
    executor: "edge.paige-ai-chat", classification: "external_effect", riskPolicyKey: "high", seatAuthority: "member", selfDescribe: true,
    idempotency: "Existing sendCalendarLink composes shareability and tenant checks with caller-JWT send-message. Chat passes no request key; no blind retry or exactly-once claim. Sent, queued, refused, failed and unknown outcomes remain distinct; provider acceptance is not delivery." },
  { key: "business_profile.propose_brief_update", tool: "propose_business_brief_update", domain: "business_profile", owner: "solo-setup",
    executor: "public.stage_solo_business_brief_proposal", classification: "mutate", riskPolicyKey: "ordinary", seatAuthority: "workspace-admin", selfDescribe: true,
    idempotency: "Stages a fresh proposal identifier in the existing business brief using server-derived tenant and verified Chat actor through the service-only RPC. No request-key receipt. Staging does not save business truth; the owner must review and save in Setup." },
  { key: "business_profile.update_legacy", tool: "update_business_profile", domain: "business_profile", owner: "solo-setup",
    executor: "edge.paige-ai-chat", classification: "mutate", riskPolicyKey: "ordinary", seatAuthority: "workspace-admin", selfDescribe: false,
    idempotency: "Hidden incumbent composite: business fields stage a fresh proposal; visual brand assets merge into tenants.brand and write an audit. No atomic operation receipt or expected-version guard; partial completion and concurrent merges are not safe blind retries. Sending identity is refused and handed to Connections." },
  { key: "platform_meta.capability_status", tool: "capability_status", domain: "platform_meta", owner: "paige-platform-meta",
    executor: "edge.paige-ai-chat", classification: "read", riskPolicyKey: "read_only", seatAuthority: "member", selfDescribe: false,
    idempotency: "Read-only gatherCapabilityProjection uses the same server-resolved per-turn cached projection as the prompt. It writes no rows and grants no authority; unavailable readiness and specialist facts retain their existing honest availability." },
  { key: "platform_meta.improvement_propose", tool: "improvement_propose", domain: "platform_meta", owner: "paige-platform-meta",
    executor: "edge.paige-ai-chat", classification: "mutate", riskPolicyKey: "ordinary", seatAuthority: "workspace-admin", selfDescribe: false,
    idempotency: "Not idempotent: caller-JWT insert into paige_improvement_proposals creates a new proposal each call, tenant-stamped from server persona and subject to RLS. No request-key receipt. A proposal neither applies a change nor decides its own approval." },
  { key: "platform_meta.improvement_decide", tool: "improvement_decide", domain: "platform_meta", owner: "paige-platform-meta",
    executor: "edge.paige-ai-chat", classification: "mutate", riskPolicyKey: "high", seatAuthority: "workspace-admin", selfDescribe: false,
    idempotency: "Caller-JWT update is constrained to the exact proposal id and status proposed under RLS, with verified decided_by and a timestamp. Already-decided or absent proposals are refused, not replayed as success. No stored operation receipt or automatic apply authority." },
  { key: "agents.list", tool: "list_subagents", domain: "agents", owner: "paige-specialists",
    executor: "edge.paige-orchestrator", classification: "read", riskPolicyKey: "read_only", seatAuthority: "workspace-admin", selfDescribe: true,
    idempotency: "Existing tool_search is a read of platform-default and server-resolved tenant specialist metadata with funding gating. Chat uses the trusted internal service boundary after workspace-admin admission. No invocation, provider execution or future authority is granted by listing." },
  { key: "agents.delegate", tool: "delegate_to_subagent", domain: "agents", owner: "paige-specialists",
    executor: "edge.paige-orchestrator", classification: "external_effect", riskPolicyKey: "high", seatAuthority: "workspace-admin", selfDescribe: true,
    idempotency: "Existing tool_invoke uses the trusted internal service boundary with server-derived tenant, funding and verified user context. Chat supplies no request key; an invocation receipt is not an exactly-once retry guard. Runtime and provider outcomes remain authoritative; metadata does not activate a specialist." },
  { key: "agents.forge", tool: "forge_subagent", domain: "agents", owner: "paige-specialists",
    executor: "edge.subagent-forge", classification: "mutate", riskPolicyKey: "ordinary", seatAuthority: "workspace-admin", selfDescribe: true,
    idempotency: "Existing propose route enforces trusted internal agent origin, tenant/funding scope and quotas. Chat supplies no request-key receipt; slug or proposal handling does not establish full-operation retry safety. Agent-origin approve/reject is refused; soft versus queued results retain their existing meaning." },
] as const).map(({ key, tool, domain, owner, executor, classification, riskPolicyKey, seatAuthority, selfDescribe, idempotency }) => ({
  key, domain, owner, humanSurface: "PAIGE workspace", readiness: "none", selfDescribe,
  action: { executor, classification, chatTool: tool, riskPolicyKey, seatAuthority,
    approvalAuthority: classification === "read" ? "none" : "chat-canonical", idempotency },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
