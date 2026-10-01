import type { SpineCapability } from "../contracts.ts";

// Durable long-form authoring is reachable from the existing document_generate Chat tool, but that
// tool also has an intentional Studio-session auto lane. The current Spine action vocabulary can
// describe only `chat-canonical` approval for mutations, so declaring an action here would falsely
// claim that every invocation uses the rendered Chat approval gate. Coordinator/Platform Reach
// explicitly rejected that false declaration and the parallel governedExecution path.
//
// This entry therefore registers the durable capability and its verified terminal outcome only.
// The action is deliberately absent until the shared Spine contract gains the ratified authority
// vocabulary for an already-authorized Studio build session. Runtime execution remains the exact
// public.submit_paige_document_work RPC; completion is not success until atomic artifact readback,
// reconnect turn persistence, and record_capability_run all commit together.
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

export const LONG_FORM_CAPABILITIES = [LONG_FORM_DOCUMENT_AUTHORING] as const;
