import type { SpineCapability } from "../contracts.ts";

// The canonical durable outcome remains separate from Chat submission metadata.
// Studio excludes document_generate and explicitly refuses durable submission.
export const LONG_FORM_DOCUMENT_AUTHORING = {
  key: "long_form.document_authoring",
  domain: "long_form",
  owner: "paige-long-form-capability-lane",
  humanSurface: "/solo/:account/command-center/paige",
  action: undefined,
  outcome: {
    kinds: ["succeeded", "failed", "blocked", "cancelled", "expired", "outcome_unknown"],
    projector: "public.record_capability_run",
    railVisibility: "PARTIAL: terminal success is atomic with verified artifact readback, reconnect turn, and a tenant-safe capability receipt; authenticated deployed readback remains owed.",
  },
  chatBinding: "LIVE",
  mindBinding: "PARTIAL",
  sharedPrimitiveChange: "NONE",
  maturity: "PARTIAL",
} as const satisfies SpineCapability;

export const LONG_FORM_DOCUMENT_CHAT_SUBMISSION = {
  key: "research_knowledge.document_generate",
  domain: "research_knowledge",
  owner: "paige-long-form-capability-lane",
  humanSurface: "/solo/:account/command-center/paige",
  selfDescribe: true,
  readiness: "none",
  action: {
    classification: "mutate",
    executor: "public.submit_paige_document_work",
    chatTool: "document_generate",
    seatAuthority: "workspace-admin",
    riskPolicyKey: "ordinary",
    approvalAuthority: "chat-canonical",
    idempotency: "Existing caller-JWT submission binds a stable per-turn/call document intent to the owned thread and validated brief. Same-intent replay requires matching stored payload and returns the existing work row, but may wake an active worker again. A lost transport response remains unknown and requires canonical readback; submission is not a completed artifact or a full-operation exactly-once guarantee. Studio submission is refused.",
  },
  chatBinding: "LIVE",
  mindBinding: "UNAVAILABLE",
  sharedPrimitiveChange: "NONE",
  maturity: "PARTIAL",
} as const satisfies SpineCapability;

export const LONG_FORM_CAPABILITIES = [LONG_FORM_DOCUMENT_AUTHORING, LONG_FORM_DOCUMENT_CHAT_SUBMISSION] as const;
