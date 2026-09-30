/**
 * Canonical document-production contract shared by chat and the durable worker.
 *
 * This module is deliberately dependency-free so edge functions and Vitest exercise the exact
 * same validation. Generated model text is untrusted data: only the allowlisted block vocabulary
 * crosses into marketing_content, and a placeholder can never become a completed artifact.
 */

export const DOCUMENT_TYPES = [
  "guide",
  "one_pager",
  "ebook",
  "checklist",
  "worksheet",
  "proposal",
  "offer_letter",
  "sales_offer",
  "agreement_draft",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface DocumentBrief {
  version: 1;
  doc_type: DocumentType;
  title: string;
  brief: string;
  audience?: string;
  purpose?: string;
  required_facts?: Record<string, string | number | boolean>;
  target_content_id?: string;
  expected_revision?: number;
}

export interface DocumentDraft {
  docType: DocumentType;
  title: string;
  blocks: Array<Record<string, unknown>>;
}

export type BriefValidation =
  | { ok: true; value: DocumentBrief }
  | { ok: false; code: string; message: string };

export type DocumentSubmissionErrorOutcome = "capability_refused" | "capability_outcome_unknown";

/**
 * Most PostgreSQL SQLSTATEs prove the statement aborted. PostgreSQL rolls the whole statement back,
 * including a durable-work row inserted earlier in the function, so refusal is honest for explicit,
 * implicit P0001, constraint, and ordinary internal errors. Connection exceptions (class 08) and
 * statement_completion_unknown (40003), admin shutdown (57P01), and crash shutdown (57P02)
 * explicitly do NOT establish whether the statement committed; those, plus gateway/PostgREST/
 * network/missing codes, remain outcome_unknown until the intent id is reconciled.
 */
export function classifyDocumentSubmissionError(error: unknown): DocumentSubmissionErrorOutcome {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "").trim().toUpperCase()
    : "";
  if (
    /^08[0-9A-Z]{3}$/.test(code) ||
    code === "40003" ||
    code === "57P01" ||
    code === "57P02"
  ) return "capability_outcome_unknown";
  return /^[0-9A-Z]{5}$/.test(code) ? "capability_refused" : "capability_outcome_unknown";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACEHOLDER_RE = /\[[^\]]*\b(CLIENT|NAME|DATE|AMOUNT|SCOPE|COMPANY|PRICE|COST|ADDRESS|EMAIL|PHONE|YOUR|INSERT|TBD|TODO|XXX|ROLE|SALARY|CANDIDATE|COMPENSATION|EQUITY|BENEFITS|POSITION|MANAGER|PROSPECT|EXPIR)\b[^\]]*\](?!\()/i;

function nonEmptyString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function containsDocumentPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return PLACEHOLDER_RE.test(value);
  if (Array.isArray(value)) return value.some(containsDocumentPlaceholder);
  if (isPlainRecord(value)) return Object.values(value).some(containsDocumentPlaceholder);
  return false;
}

export function validateDocumentBrief(input: unknown): BriefValidation {
  if (!isPlainRecord(input)) {
    return { ok: false, code: "document_brief_invalid", message: "The document brief must be an object." };
  }
  const allowed = new Set([
    "version", "doc_type", "title", "brief", "audience", "purpose", "required_facts",
    "target_content_id", "expected_revision",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return { ok: false, code: "document_brief_unknown_field", message: "The document brief contains an unsupported field." };
  }
  if (input.version !== 1) {
    return { ok: false, code: "document_brief_version_invalid", message: "The document brief version is unsupported." };
  }
  if (typeof input.doc_type !== "string" || !DOCUMENT_TYPES.includes(input.doc_type as DocumentType)) {
    return { ok: false, code: "document_type_invalid", message: "Choose a supported document type." };
  }
  if (!nonEmptyString(input.title, 200) || !nonEmptyString(input.brief, 12_000)) {
    return { ok: false, code: "document_brief_required", message: "A title and bounded authoring brief are required." };
  }
  if (containsDocumentPlaceholder(input.title) || containsDocumentPlaceholder(input.brief)) {
    return { ok: false, code: "document_specifics_missing", message: "Replace fill-in-the-blank placeholders with the real details before authoring." };
  }
  for (const field of ["audience", "purpose"] as const) {
    if (input[field] !== undefined && !nonEmptyString(input[field], 2_000)) {
      return { ok: false, code: `document_${field}_invalid`, message: `${field} must be a non-empty bounded string.` };
    }
  }
  if (input.required_facts !== undefined) {
    if (!isPlainRecord(input.required_facts) || Object.keys(input.required_facts).length > 50) {
      return { ok: false, code: "document_required_facts_invalid", message: "Required facts must be a bounded object." };
    }
    for (const [key, value] of Object.entries(input.required_facts)) {
      if (!nonEmptyString(key, 100) || !["string", "number", "boolean"].includes(typeof value)) {
        return { ok: false, code: "document_required_facts_invalid", message: "Required facts must use short keys and scalar values." };
      }
      if (typeof value === "string" && (!nonEmptyString(value, 2_000) || containsDocumentPlaceholder(value))) {
        return { ok: false, code: "document_specifics_missing", message: "Required facts must contain real bounded values." };
      }
    }
  }

  if (input.target_content_id !== undefined && (typeof input.target_content_id !== "string" || !UUID_RE.test(input.target_content_id))) {
    return { ok: false, code: "document_target_invalid", message: "The revision target is invalid." };
  }
  if (input.expected_revision !== undefined && (!Number.isInteger(input.expected_revision) || Number(input.expected_revision) < 1)) {
    return { ok: false, code: "document_revision_invalid", message: "The expected revision must be a positive integer." };
  }
  if (Boolean(input.target_content_id) !== Boolean(input.expected_revision)) {
    return { ok: false, code: "document_revision_pair_required", message: "A revision target and expected revision must be supplied together." };
  }

  const serialized = JSON.stringify(input);
  if (serialized.length > 32_000) {
    return { ok: false, code: "document_brief_too_large", message: "The document brief is too large." };
  }
  return { ok: true, value: JSON.parse(serialized) as DocumentBrief };
}

export function validDocumentBlock(block: unknown): block is Record<string, unknown> {
  return normalizeDocumentBlock(block) !== null;
}

function optionalString(value: unknown, max = 50_000): string | undefined {
  return nonEmptyString(value, max) ? value.trim() : undefined;
}

export function normalizeDocumentBlock(block: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(block)) return null;
  const required = (value: unknown) => optionalString(value);
  switch (block.type) {
    case "cover": {
      const title = required(block.title);
      return title ? { type: "cover", title, ...(optionalString(block.eyebrow, 500) ? { eyebrow: optionalString(block.eyebrow, 500) } : {}), ...(optionalString(block.subhead, 2_000) ? { subhead: optionalString(block.subhead, 2_000) } : {}) } : null;
    }
    case "section-header":
    case "chapter-divider": {
      const title = required(block.title);
      if (!title) return null;
      const number = Number.isInteger(block.number) && Number(block.number) >= 0 && Number(block.number) <= 999 ? Number(block.number) : undefined;
      return { type: block.type, title, ...(number !== undefined ? { number } : {}), ...(optionalString(block.kicker, 500) ? { kicker: optionalString(block.kicker, 500) } : {}), ...(block.type === "chapter-divider" && optionalString(block.subhead, 2_000) ? { subhead: optionalString(block.subhead, 2_000) } : {}) };
    }
    case "toc": {
      const entries = Array.isArray(block.entries) ? block.entries.map((entry) => optionalString(entry, 500)).filter(Boolean).slice(0, 60) : undefined;
      return { type: "toc", ...(optionalString(block.title, 500) ? { title: optionalString(block.title, 500) } : {}), ...(entries?.length ? { entries } : {}) };
    }
    case "prose": {
      const markdown = required(block.markdown);
      return markdown ? { type: "prose", markdown } : null;
    }
    case "callout": {
      const body = required(block.body);
      if (!body) return null;
      const variant = ["tip", "warning", "key-insight", "definition", "example", "do-this"].includes(String(block.variant)) ? block.variant : undefined;
      return { type: "callout", body, ...(variant ? { variant } : {}), ...(optionalString(block.title, 500) ? { title: optionalString(block.title, 500) } : {}) };
    }
    case "pull-quote": {
      const quote = required(block.quote);
      return quote ? { type: "pull-quote", quote, ...(optionalString(block.attribution, 500) ? { attribution: optionalString(block.attribution, 500) } : {}) } : null;
    }
    case "stat": {
      const value = required(block.value);
      const label = required(block.label);
      return value && label ? { type: "stat", value, label } : null;
    }
    case "list": {
      const items = Array.isArray(block.items) ? block.items.map((item) => optionalString(item, 2_000)).filter(Boolean).slice(0, 100) : [];
      if (!items.length) return null;
      const style = ["bullet", "numbered", "checklist"].includes(String(block.style)) ? block.style : undefined;
      return { type: "list", items, ...(style ? { style } : {}) };
    }
    case "worksheet-field": {
      const label = required(block.label);
      if (!label) return null;
      const field = ["line", "lines", "box", "scale", "checkbox"].includes(String(block.field)) ? block.field : undefined;
      const lines = Number.isInteger(block.lines) ? Math.max(1, Math.min(12, Number(block.lines))) : undefined;
      const scaleMin = Number.isInteger(block.scaleMin) ? Number(block.scaleMin) : undefined;
      const scaleMax = Number.isInteger(block.scaleMax) ? Number(block.scaleMax) : undefined;
      return { type: "worksheet-field", label, ...(field ? { field } : {}), ...(optionalString(block.helper, 1_000) ? { helper: optionalString(block.helper, 1_000) } : {}), ...(lines !== undefined ? { lines } : {}), ...(scaleMin !== undefined ? { scaleMin } : {}), ...(scaleMax !== undefined ? { scaleMax } : {}), ...(optionalString(block.minLabel, 500) ? { minLabel: optionalString(block.minLabel, 500) } : {}), ...(optionalString(block.maxLabel, 500) ? { maxLabel: optionalString(block.maxLabel, 500) } : {}) };
    }
    case "pricing-table": {
      const rows = Array.isArray(block.rows) ? block.rows.flatMap((row) => {
        if (!isPlainRecord(row)) return [];
        const item = required(row.item);
        const amount = required(row.amount);
        return item && amount ? [{ item, amount, ...(optionalString(row.detail, 2_000) ? { detail: optionalString(row.detail, 2_000) } : {}) }] : [];
      }).slice(0, 50) : [];
      return rows.length ? { type: "pricing-table", rows, ...(optionalString(block.caption, 500) ? { caption: optionalString(block.caption, 500) } : {}), ...(optionalString(block.total, 500) ? { total: optionalString(block.total, 500) } : {}) } : null;
    }
    case "cta": {
      const headline = required(block.headline);
      const action = required(block.action);
      const href = optionalString(block.href, 2_000);
      const safeHref = href && /^https:\/\//i.test(href) ? href : undefined;
      return headline && action ? { type: "cta", headline, action, ...(safeHref ? { href: safeHref } : {}) } : null;
    }
    default: return null;
  }
}

export function normalizeDocumentDraft(input: unknown, brief: DocumentBrief): DocumentDraft {
  if (!isPlainRecord(input)) throw new Error("DOCUMENT_OUTPUT_INVALID");
  const rawBlocks = Array.isArray(input.blocks) ? input.blocks : [];
  const blocks = rawBlocks.map(normalizeDocumentBlock).filter((block): block is Record<string, unknown> => block !== null).slice(0, 80);
  if (blocks.length === 0) throw new Error("DOCUMENT_OUTPUT_EMPTY");
  if (containsDocumentPlaceholder(input.title) || containsDocumentPlaceholder(blocks)) {
    throw new Error("DOCUMENT_OUTPUT_PLACEHOLDER");
  }
  const title = nonEmptyString(input.title, 200) ? input.title.trim() : brief.title.trim();
  const docType = brief.doc_type;
  if (blocks[0].type !== "cover") {
    if (blocks.length >= 80) blocks.length = 79;
    blocks.unshift({ type: "cover", title });
  }
  return { docType, title, blocks };
}

export function parseDocumentModelOutput(content: string, brief: DocumentBrief): DocumentDraft {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced);
  } catch {
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("DOCUMENT_OUTPUT_NOT_JSON");
    try { parsed = JSON.parse(fenced.slice(start, end + 1)); }
    catch { throw new Error("DOCUMENT_OUTPUT_NOT_JSON"); }
  }
  return normalizeDocumentDraft(parsed, brief);
}

export function buildDocumentAuthoringPrompt(brief: DocumentBrief): string {
  return [
    "Author a substantial private draft document from the bounded brief below.",
    "Return JSON only: {\"doc_type\":string,\"title\":string,\"blocks\":object[]}.",
    "Allowed shapes: cover{title,eyebrow?,subhead?}; toc{title?,entries?}; section-header/chapter-divider{title,number?,kicker?,subhead?}; prose{markdown}; callout{body,title?,variant?}; pull-quote{quote,attribution?}; stat{value,label}; list{items,style?}; worksheet-field{label,helper?,field?,lines?}; pricing-table{rows:[{item,amount,detail?}],caption?,total?}; cta{headline,action,href?}.",
    "The first block must be cover. Use real supplied facts only. Never emit bracketed placeholders, invented facts, citations, legal claims, signatures, or an assertion that counsel reviewed the draft.",
    "An agreement_draft is an attorney-review draft artifact only, never a signable agreement and never legal advice.",
    `BRIEF_JSON=${JSON.stringify(brief)}`,
  ].join("\n");
}
