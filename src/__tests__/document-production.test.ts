import { describe, expect, it } from "vitest";
import {
  buildDocumentAuthoringPrompt,
  classifyDocumentSubmissionError,
  containsDocumentPlaceholder,
  normalizeDocumentDraft,
  parseDocumentModelOutput,
  validateDocumentBrief,
  validateBusinessReviewBrief,
  type DocumentBrief,
} from "../../supabase/functions/_shared/document-production";

const brief: DocumentBrief = {
  version: 1,
  doc_type: "agreement_draft",
  title: "Program Services Draft",
  brief: "Draft an attorney-review services agreement using the supplied program scope and dates.",
  required_facts: { client: "Example Client", start_date: "October 1, 2026" },
};

const review={version:1,doc_type:'business_review',title:'Monthly operating review',brief:'Review original verified historical sources.',
  report_period:{key:'month',start:'2026-09-01T00:00:00Z',end:'2026-10-01T00:00:00Z'},evidence_refs:[`aneb_v1_${'b'.repeat(64)}`]};

describe('source-bound business review request preflight',()=>{
  const {evidence_refs: _references, ...reviewWithoutReferences}=review;
  const planned={...reviewWithoutReferences,metric_requests:[{metric_key:'sales.cash.recorded_received',metric_version:'1.0.0'}]};
  it('accepts a closed canonical source request without caller-authored facts',()=>{
    expect(validateBusinessReviewBrief(planned)).toEqual({ok:true,value:planned});
    expect(validateDocumentBrief(planned).ok).toBe(false);
  });
  it('keeps the canonical revised overdue version and the original request order',()=>{
    const input={...planned,metric_requests:[{metric_key:'sales.receivables.overdue_current',metric_version:'1.1.0'},...planned.metric_requests]};
    const result=validateBusinessReviewBrief(input);expect(result).toEqual({ok:true,value:input});
    if(result.ok){input.metric_requests.reverse();expect(result.value).not.toEqual(input);}
  });
  it.each([[],null,[null],[{metric_key:'invented',metric_version:'1.0.0'}],
    [{metric_key:'sales.receivables.overdue_current',metric_version:'1.0.0'}],
    [{...planned.metric_requests[0],values:{amount_minor:'999999'}}],
    [{...planned.metric_requests[0],tenant_id:'foreign'}],
    [{...planned.metric_requests[0],dimensions:{owner:'foreign'}}],
    [planned.metric_requests[0],planned.metric_requests[0]],Array(13).fill(planned.metric_requests[0])
  ])('refuses malformed, duplicate, unknown or caller-authored source selectors %#',metric_requests=>{
    expect(validateBusinessReviewBrief({...planned,metric_requests}).ok).toBe(false);
  });
  it.each([review.evidence_refs,null,undefined])('refuses mixed source modes even for an empty reference property %#',evidence_refs=>{
    expect(validateBusinessReviewBrief({...planned,evidence_refs}).ok).toBe(false);
  });
  it.each(['month','quarter'])('accepts only a reference-based %s request without changing legacy nine-type admission',key=>{
    const input={...review,report_period:{...review.report_period,key}};
    expect(validateBusinessReviewBrief(input)).toEqual({ok:true,value:input});
    expect(validateDocumentBrief(input).ok).toBe(false);
  });
  it.each([null,[],{}, {...review,version:'1'}, {...review,doc_type:'guide'}, {...review,title:'[CLIENT NAME]'},
    {...review,brief:''}, {...review,title:'x'.repeat(201)}, {...review,brief:'x'.repeat(12001)},
    {...review,required_facts:{revenue:1}}, {...review,report_evidence:{}}, {...review,tenant_id:'foreign'},
    {...review,actor_id:'foreign'}, {...review,target_content_id:'target'}, {...review,expected_revision:1},
    {...review,audience:'owner'}, {...review,evidence_refs:[]}, {...review,evidence_refs:[null]},
    {...review,evidence_refs:['invented']}, {...review,evidence_refs:[review.evidence_refs[0],review.evidence_refs[0]]},
    {...review,evidence_refs:Array.from({length:13},(_,i)=>`aneb_v1_${i.toString(16).padStart(64,'0')}`)},
    ...[{key:'week'},{key:['month']},{key:null},{start:'2026-09-01'},{start:'2026-02-31T00:00:00Z'},
      {start:'2026-02-29T00:00:00Z'},{start:'0000-01-01T00:00:00Z'},{end:review.report_period.start},
      {end:'2026-08-01T00:00:00Z'},{timezone:'UTC'}].map(period=>({...review,report_period:{...review.report_period,...period}}))])('refuses malformed or caller-authored report input %#',input=>expect(validateBusinessReviewBrief(input).ok).toBe(false));
  it('keeps an independent ordered request without mutating inputs or fabricating values',()=>{
    const input={...review,evidence_refs:[...review.evidence_refs,`aneb_v1_${'c'.repeat(64)}`]};
    const result=validateBusinessReviewBrief(input);expect(result.ok).toBe(true);
    if(result.ok){expect(result.value).toEqual(input);input.evidence_refs.reverse();expect(result.value.evidence_refs).toEqual(review.evidence_refs.concat(`aneb_v1_${'c'.repeat(64)}`));}
  });
  it('accepts real leap days and explicit offsets without rounding or relabeling the source period',()=>{
    const input={...review,report_period:{key:'month',start:'2024-02-29T12:34:56.123456+02:00',end:'2024-03-01T00:00:00+02:00'}};
    expect(validateBusinessReviewBrief(input)).toEqual({ok:true,value:input});
  });
});

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

  it.each([NaN, Infinity, -Infinity])("refuses a non-finite fact instead of silently serializing it to null (%s)", value => {
    expect(validateDocumentBrief({ ...brief, required_facts: { amount: value } })).toMatchObject({
      ok: false, code: "document_required_facts_invalid",
    });
  });

  it("refuses numeric overflow received through parsed JSON", () => {
    const required_facts = JSON.parse('{"amount":1e400}');
    expect(validateDocumentBrief({ ...brief, required_facts })).toMatchObject({
      ok: false, code: "document_required_facts_invalid",
    });
  });

  it("preserves finite zero, negative and fractional facts and false booleans", () => {
    const required_facts = { zero: 0, change: -12.5, ratio: 1.25, included: false, confirmed: true };
    const result = validateDocumentBrief({ ...brief, required_facts });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.required_facts).toEqual(required_facts);
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
