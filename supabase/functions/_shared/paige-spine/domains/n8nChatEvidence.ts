import type { SpineEvidenceRpcClient, SpineRequestScope } from "../resolveEvidence.ts";
import { N8N_ACTION_WORDS, N8N_API_WORDS, N8N_MCP_WORDS, parseN8nSpineReadiness, type N8nSafeReadiness } from "./n8nReadiness.ts";
export type N8nChatEvidence = { readonly status: "available"; readonly readiness: N8nSafeReadiness } | { readonly status: "unavailable" } | { readonly status: "wrong_workspace" | "scope_changed" };
const isCurrent = (scope?: SpineRequestScope) => { try { return scope ? scope.isCurrent() : true; } catch { return false; } };
export async function loadN8nReadinessForChat(client: SpineEvidenceRpcClient, expectedTenantId: string | null, scope?: SpineRequestScope): Promise<N8nChatEvidence> {
  if (!expectedTenantId) return { status: "wrong_workspace" };
  if (!isCurrent(scope)) return { status: "scope_changed" };
  try {
    const { data, error } = await client.rpc("get_n8n_spine_readiness", {});
    if (!isCurrent(scope)) return { status: "scope_changed" };
    if (error) return { status: "unavailable" };
    if (data && typeof data === "object" && "tenant_id" in data && data.tenant_id !== expectedTenantId) return { status: "wrong_workspace" };
    const readiness = parseN8nSpineReadiness(data, expectedTenantId);
    return readiness ? { status: "available", readiness } : { status: "unavailable" };
  } catch { return isCurrent(scope) ? { status: "unavailable" } : { status: "scope_changed" }; }
}
const HEADER = "=== N8N CONNECTION READINESS — VERIFIED WORKSPACE SOURCE ===";
const FOOTER = "=== END N8N CONNECTION READINESS ===";
export function renderN8nReadinessForChat(evidence: N8nChatEvidence): string {
  if (evidence.status === "wrong_workspace" || evidence.status === "scope_changed") return "";
  if (evidence.status === "unavailable") return [HEADER, "Status: UNAVAILABLE. The connection state could not be checked. Do not claim nothing is wired, disconnected, or connected from this failed read.", FOOTER].join("\n");
  if (evidence.status !== "available") return "";
  const { api, mcp } = evidence.readiness;
  return [HEADER,
    `API connection: ${N8N_API_WORDS[api.state]}. Workflow count: ${api.workflowCount ?? "unavailable"}.`,
    `API last successful check: ${api.lastSuccessfulCheck ?? "not proven"}. Action needed: ${N8N_ACTION_WORDS[api.actionNeeded]}.`,
    `Paige tools (MCP): ${N8N_MCP_WORDS[mcp.state]}. OAuth readiness: ${mcp.oauthReadiness}.`,
    `Approved workflows: ${mcp.approvedWorkflowCount ?? "unavailable"}. Approved tools: ${mcp.approvedToolCount ?? "unavailable"}.`,
    `MCP last successful check: ${mcp.lastSuccessfulCheck ?? "not proven"}. Action needed: ${N8N_ACTION_WORDS[mcp.actionNeeded]}.`,
    "Source: current server-resolved connection records. Check timestamps describe historical successful checks, not a new provider check during this conversation. A missing check is unknown freshness.",
    "API visibility and MCP authorization are independent. Zero approved workflows counts approvals only, never the total workflows in n8n. It does not mean the n8n account is empty or prevent creating a new workflow through an authorized management tool. Use live MCP discovery for inventory; never speculate that no workflows exist. OAuth read/write consent is separate from permission for a particular action. Connection success never approves workflow execution, creation, editing, deletion, or activation; use the existing governed approval path for supported actions.",
    "STATE, NOT CAPABILITY: every line in this block describes connection state and standing pre-approvals — never which tools you hold. If your live tool manifest carries the n8n management tools (list, get, create, update, validate, activate, deactivate, archive, run), those tools are available to you RIGHT NOW regardless of the approval counts above: their writes run propose-first, and the operator approves each specific action in this conversation. Never translate this block into 'I can't' — answer capability questions from the manifest, and prove the lane live by running the cheapest read instead of describing limits you have not checked.",
    "Report the recorded readiness directly. Do not guess timeout, handshake, or grant causes when the source does not provide a cause. The n8n management tools use OAuth independently of API health; an API refusal is not an MCP failure. Do not ask the owner to supply a connection state already present in this evidence.",
    FOOTER].join("\n");
}
export async function buildN8nReadinessBlock(client: SpineEvidenceRpcClient, expectedTenantId: string | null, scope?: SpineRequestScope): Promise<string> {
  return renderN8nReadinessForChat(await loadN8nReadinessForChat(client, expectedTenantId, scope));
}
