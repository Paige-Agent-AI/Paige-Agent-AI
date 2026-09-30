import { describe, expect, it } from "vitest";
import {
  buildDocumentAuthoringPrompt,
  classifyDocumentSubmissionError,
  containsDocumentPlaceholder,
  normalizeDocumentDraft,
  parseDocumentModelOutput,
  validateDocumentBrief,
  type DocumentBrief,
} from "../../supabase/functions/_shared/document-production";

const brief: DocumentBrief = {
  version: 1,
  doc_type: "agreement_draft",
  title: "Program Services Draft",
  brief: "Draft an attorney-review services agreement using the supplied program scope and dates.",
  required_facts: { client: "Example Client", start_date: "October 1, 2026" },
};

describe("durable document production contract", () => {
  it.each([
    "42501", "22023", "P0001", "P0002", "23505", "23514", "28000", "22000", "54000", "XX000",
    "57014", "40001", "40P01", "53000",
  ])(
    "classifies PostgreSQL statement abort %s as refused",
    (code) => expect(classifyDocumentSubmissionError({ code })).toBe("capability_refused"),
  );

  it.each([
    undefined,
    null,
    {},
    { code: "" },
    { code: "PGRST116" },
    { code: "NETWORK_ERROR" },
    { code: "08007" },
    { code: "08006" },
    { code: "40003" },
    { code: "57P01" },
    { code: "57P02" },
  ])(
    "keeps ambiguous submission error %# outcome-unknown",
    (error) => expect(classifyDocumentSubmissionError(error)).toBe("capability_outcome_unknown"),
  );

  it("accepts a bounded agreement draft without promoting it to an agreement", () => {
    const result = validateDocumentBrief(brief);
    expect(result.ok).toBe(true);
    expect(buildDocumentAuthoringPrompt(brief)).toContain("attorney-review draft artifact only");
  });

  it("rejects unknown fields, unpaired revision coordinates, and raw placeholder facts", () => {
    expect(validateDocumentBrief({ ...brief, tenant_id: "forged" }).ok).toBe(false);
    expect(validateDocumentBrief({ ...brief, target_content_id: "f99f5600-7f09-4d25-93c0-12f17b2d8d33" }).ok).toBe(false);
    expect(validateDocumentBrief({ ...brief, brief: "Draft this for [CLIENT NAME]." }).ok).toBe(false);
  });

  it("keeps markdown links but detects fill-in-the-blank placeholders", () => {
    expect(containsDocumentPlaceholder("Read [the guide](https://example.com)")).toBe(false);
    expect(containsDocumentPlaceholder("Start on [Date]")).toBe(true);
  });

  it("normalizes only allowlisted blocks and synthesizes a cover", () => {
    const draft = normalizeDocumentDraft({
      title: "Specific Draft",
      doc_type: "agreement_draft",
      blocks: [
        { type: "section-header", title: "Scope" },
        { type: "prose", markdown: "The engagement starts October 1, 2026." },
        { type: "cta", headline: "Review", action: "Open", href: "javascript:alert(1)", injected: "do not persist" },
        { type: "script", code: "do not persist" },
      ],
    }, brief);
    expect(draft.blocks.map((block) => block.type)).toEqual(["cover", "section-header", "prose", "cta"]);
    expect(draft.blocks[3]).toEqual({ type: "cta", headline: "Review", action: "Open" });
  });

  it("pins the validated document type and keeps a synthesized cover within 80 blocks", () => {
    const blocks = Array.from({ length: 80 }, (_, index) => ({ type: "prose", markdown: `Section ${index + 1}` }));
    const draft = normalizeDocumentDraft({ title: "Specific Draft", doc_type: "ebook", blocks }, brief);
    expect(draft.docType).toBe("agreement_draft");
    expect(draft.blocks).toHaveLength(80);
    expect(draft.blocks[0]).toEqual({ type: "cover", title: "Specific Draft" });
  });

  it("rejects unresolved source identifiers instead of pretending they were read", () => {
    expect(validateDocumentBrief({ ...brief, source_refs: [{ kind: "tenant_knowledge", id: "terms" }] }).ok).toBe(false);
  });
  it("parses fenced JSON and refuses empty or placeholder output", () => {
    const draft = parseDocumentModelOutput('```json\n{"doc_type":"agreement_draft","title":"Draft","blocks":[{"type":"cover","title":"Draft"},{"type":"prose","markdown":"Real terms."}]}\n```', brief);
    expect(draft.blocks).toHaveLength(2);
    expect(() => parseDocumentModelOutput('{"blocks":[]}', brief)).toThrow("DOCUMENT_OUTPUT_EMPTY");
    expect(() => parseDocumentModelOutput('{"blocks":[{"type":"cover","title":"[CLIENT NAME]"}]}', brief)).toThrow("DOCUMENT_OUTPUT_PLACEHOLDER");
  });
});
