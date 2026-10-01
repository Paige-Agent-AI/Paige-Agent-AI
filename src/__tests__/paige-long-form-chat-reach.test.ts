import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getSpineCapability, PAIGE_SPINE_CAPABILITIES, validateSpineRegistry } from "@/../supabase/functions/_shared/paige-spine/registry.ts";

const chat = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const dashboard = readFileSync("src/components/dashboard/PaigeAIChat.tsx", "utf8");
const studio = readFileSync("src/components/admin/studio/StudioChat.tsx", "utf8");
const worker = readFileSync("supabase/functions/paige-document-worker/index.ts", "utf8");

describe("durable long-form Chat reach", () => {
  it("registers the outcome honestly without claiming the unavailable approval vocabulary", () => {
    expect(validateSpineRegistry(PAIGE_SPINE_CAPABILITIES)).toEqual([]);
    const capability = getSpineCapability("long_form.document_authoring");
    expect(capability).toMatchObject({
      chatBinding: "LIVE",
      maturity: "PARTIAL",
      action: undefined,
      outcome: { projector: "public.record_capability_run" },
    });
  });

  it("submits a bounded brief to the canonical durable RPC instead of model-authored blocks", () => {
    const tool = chat.slice(chat.indexOf('name: "document_generate"'), chat.indexOf('name: "growth_list"'));
    const handlerStart = chat.indexOf('} else if (tc.function.name === "document_generate") {');
    const handler = chat.slice(handlerStart, chat.indexOf('} else if (tc.function.name === "growth_list") {', handlerStart));
    expect(tool).toContain('required: ["doc_type", "title", "brief"]');
    expect(tool).not.toContain('required: ["doc_type", "title", "blocks"]');
    expect(tool).not.toContain("source_refs");
    expect(handler).toContain('"submit_paige_document_work"');
    expect(handler).toContain("validateDocumentBrief(candidate)");
    expect(handler).toContain("if (targetVerified)");
    expect(handler).not.toContain("if (!result)");
    expect(handler).not.toContain('rpc("save_marketing_content"');
    expect(handler).toContain('recordDocumentSubmissionOutcome("DURABLE_DOCUMENT_IDENTITY_REQUIRED"');
    expect(handler).toContain('recordDocumentSubmissionOutcome("DURABLE_DOCUMENT_TARGET_NOT_VERIFIED"');
    expect(handler).toContain('"DURABLE_DOCUMENT_SUBMIT_FAILED"');
    expect(handler).toContain('recordDocumentSubmissionOutcome("DURABLE_DOCUMENT_WORK_ID_MISSING"');
    expect(handler).toContain("recordDocumentSubmissionOutcome(validatedBrief.code");
    expect(handler).toContain("classifyDocumentSubmissionError(submitError)");
    expect(handler).toContain("recordCapabilityRun(supabase");
    expect(handler).toContain('if (workStatus === "claimed")');
    expect(handler).toContain('} else if (workStatus === "succeeded")');
    expect(handler).toContain('"DURABLE_DOCUMENT_RECONCILIATION_REQUIRED"');
    expect(handler).toContain('"DURABLE_DOCUMENT_BLOCKED"');
    expect(handler).toContain('"DURABLE_DOCUMENT_STUDIO_ASYNC_UNAVAILABLE"');
    expect(handler).toContain("cannot resume");
    expect(handler).toContain("start a new document request");
    expect(handler).not.toContain("args.source_refs");
  });

  it("never files a failure receipt when durable settlement did not commit", () => {
    const settle = worker.slice(worker.indexOf("async function settleFailure"), worker.indexOf("async function runOne"));
    expect(settle).toContain('admin.rpc("settle_paige_document_work_failure"');
    expect(settle).not.toContain("recordCapabilityRun");
    expect(settle).toContain('if (error) {');
  });

  it("derives a retry-stable intent for each document call in a turn", () => {
    expect(chat).toContain("requestIntentId: z.string().uuid().optional()");
    expect(chat).toContain('stableRunId(["document_generate_intent", payloadRequestIntentId, String(currentDocumentCallOrdinal)])');
    expect(chat).toContain("_intent_id: documentIntentId");
    expect(dashboard).toContain("retry.requestIntentId");
    expect(studio).toContain("failedIntentRef.current.id");
  });

  it("keeps ordinary documents visibly non-signable", () => {
    const tool = chat.slice(chat.indexOf('name: "document_generate"'), chat.indexOf('name: "growth_list"'));
    expect(tool).toContain("never request signature lines");
    expect(tool).toContain("If the document is meant to be signed, use agreement_draft");
    expect(tool).not.toContain("worksheet-field signature lines");
  });
});
