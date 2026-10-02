// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@/components/ui/dialog";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submitExtraction: vi.fn(), extractionStatus: vi.fn(), extractionReview: vi.fn(),
  saveReview: vi.fn(), publicationStatus: vi.fn(), hash: vi.fn(), submitPublication: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/knowledge-extraction-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge-extraction-service")>();
  return { ...actual, submitKnowledgeExtraction: mocks.submitExtraction, readKnowledgeExtractionStatus: mocks.extractionStatus, readKnowledgeExtractionReview: mocks.extractionReview };
});
vi.mock("@/lib/knowledge-review-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge-review-service")>();
  return { ...actual, saveKnowledgeReview: mocks.saveReview, readKnowledgePublicationStatus: mocks.publicationStatus, sha256Hex: mocks.hash };
});
vi.mock("@/lib/knowledge-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge-service")>();
  return { ...actual, submitKnowledgePublication: mocks.submitPublication };
});
import { AddKnowledgeFlow } from "@/solo/knowledge/AddKnowledgeFlow";
import { ExtractionConsumerError } from "@/lib/knowledge-extraction-service";
import { KnowledgeReviewServiceError } from "@/lib/knowledge-review-service";

const REF = { tenantId: "tenant-a", intentId: "intent-a", documentId: "doc-a", workId: "work-a", revision: 1 };
const status = (work_status: string, extra: Record<string, unknown> = {}) => ({ work_id: "work-a", capability_key: "knowledge.extract", work_kind: "knowledge_extract", work_status, attempt_count: 1, max_attempts: 3, blocked_reason: null, error_code: null, safe_summary: null, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", settled_at: null, ...extra });
const review = { phase: "awaiting_review" as const, tenant_id: "tenant-a", document_id: "doc-a", revision: 2, record_state: "draft" as const, source_coverage: "complete" as const, source_binding: null, extraction_work_id: "work-a", extraction_source_binding: null, pending_review: { schema_version: 1, extracted_content: "Extracted source text", reviewed_content: null, extraction_version: "v1", coverage: "complete" as const } };

let container: HTMLDivElement, root: Root, onPublished: () => void;
const render = async () => { await act(async () => root.render(<Dialog open onOpenChange={() => {}}><AddKnowledgeFlow tenantId="tenant-a" onPublished={onPublished} onClose={() => {}} /></Dialog>)); };
const body = () => document.body.textContent ?? "";
const button = (text: string) => { const b = [...document.body.querySelectorAll("button")].find(b => b.textContent?.trim() === text); expect(b, `button ${text}`).toBeTruthy(); return b!; };
const field = (id: string) => { const el = document.getElementById(id) as HTMLInputElement & HTMLTextAreaElement; expect(el, `field ${id}`).toBeTruthy(); return el; };
const set = (el: HTMLInputElement & HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const click = async (text: string) => { await act(async () => { button(text).click(); }); };
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  onPublished = vi.fn(() => {});
  mocks.submitExtraction.mockReset().mockResolvedValue({ reference: REF, status: "claimed", replayed: false });
  mocks.extractionStatus.mockReset().mockResolvedValue(status("succeeded"));
  mocks.extractionReview.mockReset().mockResolvedValue(review);
  mocks.saveReview.mockReset().mockResolvedValue({ revision: 3, outcome: "capability_succeeded", runId: "run-a" });
  mocks.publicationStatus.mockReset().mockResolvedValue({ phase: "resolved", status: "succeeded" });
  mocks.hash.mockReset().mockResolvedValue("a".repeat(64));
  mocks.submitPublication.mockReset().mockResolvedValue({ work_id: "pub-work", document_id: "doc-a", status: "claimed", replayed: false, revision: 3 });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

describe("the governed Knowledge add flow", () => {
  it("drives submit → read → review → publish with exact arguments and truthful completion", async () => {
    await render();
    set(field("knowledge-add-title"), "Discovery script");
    set(field("knowledge-add-content"), "The exact pasted text");
    await click("Send to Paige");
    expect(mocks.submitExtraction).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ tenantId: "tenant-a" }), expect.objectContaining({ title: "Discovery script", kind: "paste", content: "The exact pasted text" }));
    await tick(800);
    expect(mocks.extractionStatus).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.anything(), REF);
    expect(body()).toContain("Review what Paige read");
    set(field("knowledge-review-content"), "Reviewed source text");
    set(field("knowledge-review-tags"), "intake");
    await click("Save review");
    expect(mocks.saveReview).toHaveBeenCalledExactlyOnceWith(expect.anything(), "tenant-a", "doc-a", "work-a", 2, "Reviewed source text", { title: "Discovery script", summary: null, category: null, tags: ["intake"] });
    await click("Publish to Knowledge");
    expect(mocks.hash).toHaveBeenCalledWith("Reviewed source text");
    expect(mocks.submitPublication).toHaveBeenCalledExactlyOnceWith(expect.anything(), "tenant-a", "doc-a", "work-a", 3, expect.any(String), "a".repeat(64));
    await tick(800);
    expect(body()).toContain("Published. The reviewed text is now part of Knowledge.");
    expect(onPublished).toHaveBeenCalledExactlyOnceWith();
  });

  it("keeps polling while Paige reads, then proceeds", async () => {
    mocks.extractionStatus.mockResolvedValueOnce(status("claimed")).mockResolvedValueOnce(status("claimed")).mockResolvedValue(status("succeeded"));
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800 + 1500 + 1500);
    expect(mocks.extractionStatus).toHaveBeenCalledTimes(3);
    expect(body()).toContain("Review what Paige read");
  });

  it("replays the SAME intent after an unconfirmed submission, never a duplicate", async () => {
    mocks.submitExtraction.mockRejectedValueOnce(new ExtractionConsumerError("EXTRACTION_SUBMISSION_UNKNOWN", "lost", true));
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    expect(body()).toContain("Submission unconfirmed");
    expect(body()).toContain("never a duplicate");
    await click("Retry same request");
    expect(mocks.submitExtraction).toHaveBeenCalledTimes(2);
    const first = mocks.submitExtraction.mock.calls[0][2] as { intent_id: string };
    const second = mocks.submitExtraction.mock.calls[1][2] as { intent_id: string };
    expect(second.intent_id).toBe(first.intent_id);
  });

  it("halts honestly when the reading fails and offers no publish path", async () => {
    mocks.extractionStatus.mockResolvedValue(status("failed", { safe_summary: "The stored file could not be read." }));
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800);
    expect(body()).toContain("Reading failed");
    expect(body()).toContain("The stored file could not be read.");
    expect(mocks.extractionReview).not.toHaveBeenCalled();
  });

  it("reloads the review after a save conflict instead of repeating the save", async () => {
    mocks.saveReview.mockRejectedValueOnce(new KnowledgeReviewServiceError("40001", "KNOWLEDGE_REVIEW_CONFLICT"));
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800);
    set(field("knowledge-review-content"), "Reviewed once");
    await click("Save review");
    expect(body()).toContain("Review changed");
    await click("Reload review");
    expect(mocks.extractionReview).toHaveBeenCalledTimes(2);
    expect(mocks.saveReview).toHaveBeenCalledTimes(1);
    expect(body()).toContain("Review what Paige read");
  });

  it("refuses a second publication while one is in flight", async () => {
    const { KnowledgeServiceError } = await import("@/lib/knowledge-service");
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800);
    await click("Save review");
    mocks.submitPublication.mockRejectedValueOnce(new KnowledgeServiceError("55000", "KNOWLEDGE_PUBLICATION_PENDING"));
    await click("Publish to Knowledge");
    expect(body()).toContain("Already publishing");
    expect(body()).toContain("do not start another");
  });

  it("never re-publishes after an unconfirmed publication; check status only", async () => {
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800);
    await click("Save review");
    await click("Publish to Knowledge");
    mocks.publicationStatus.mockResolvedValue({ phase: "reconcile", status: "outcome_unknown", errorCode: "completion_unknown" });
    await tick(800 + 1500);
    expect(body()).toContain("Publication unconfirmed");
    expect(body()).toContain("do not publish again");
    expect([...document.body.querySelectorAll("button")].some(b => b.textContent?.trim() === "Publish again")).toBe(false);
    expect(mocks.submitPublication).toHaveBeenCalledTimes(1);
  });

  it("a failed publication may publish again under a NEW intent", async () => {
    mocks.publicationStatus.mockResolvedValueOnce({ phase: "resolved", status: "failed", errorCode: "embedding_failed" }).mockResolvedValue({ phase: "resolved", status: "succeeded" });
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800);
    await click("Save review");
    await click("Publish to Knowledge");
    await tick(800 + 1500);
    expect(body()).toContain("Publication failed");
    await click("Publish again");
    expect(mocks.submitPublication).toHaveBeenCalledTimes(2);
    const first = mocks.submitPublication.mock.calls[0][5] as string;
    const second = mocks.submitPublication.mock.calls[1][5] as string;
    expect(second).not.toBe(first);
    await tick(800 + 1500);
    expect(onPublished).toHaveBeenCalledExactlyOnceWith();
  });

  it("rejects unsupported files before any upload", async () => {
    await render();
    await click("Text file");
    const input = field("knowledge-add-file") as unknown as HTMLInputElement & { files: FileList };
    Object.defineProperty(input, "files", { value: { 0: new File(["x"], "doc.pdf", { type: "application/pdf" }), length: 1, item: () => new File(["x"], "doc.pdf") } });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    set(field("knowledge-add-title"), "Notes");
    await click("Send to Paige");
    expect(body()).toContain(".txt, .md, .markdown, .csv and .json");
    expect(mocks.submitExtraction).not.toHaveBeenCalled();
  });
});
