import type { SpineCapability } from "../contracts.ts";

// Stored credit-document review only, separate from Knowledge CRUD and research execution.
// Resuming derives the existing proposal from stored analysis; it saves no fields and
// grants no approval. Both verbs keep their prior internal-only self-description.
export const DOCUMENT_REVIEW_READ_CAPABILITIES = [
  { key: "research_knowledge.document_pending_reviews", tool: "document_pending_reviews" },
  { key: "research_knowledge.document_resume_review", tool: "document_resume_review" },
].map(({ key, tool }) => ({
  key, domain: "research_knowledge", owner: "paige-document-review", humanSurface: "PAIGE workspace", readiness: "none", selfDescribe: false,
  action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: tool, seatAuthority: "member",
    idempotency: "existing caller-JWT stored-document read and pure proposal projection; no rows written", riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
