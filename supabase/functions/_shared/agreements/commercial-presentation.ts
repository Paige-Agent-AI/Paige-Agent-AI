import {
  type CollectionTerms,
  integer,
  MAX_SCHEDULE,
  object,
  only,
  parseCollectionTerms,
  UUID,
} from "../sales-collections/contract.ts";
import {
  previewCollectionSchedule,
  type ScheduleRow,
} from "../sales-collections/model.ts";
import {
  type CommercialConditions,
  parseCommercialConditions,
  type ResolvedCommercialLine,
  validateCommercialConditionLines,
} from "../sales-commercial/conditions.ts";
import { sha256Hex } from "./token.ts";
export type PresentationSource = {
  tenant_id: string;
  client_id: string;
  offer_id: string;
  agreement_id: string;
  agreement_version: number;
  agreement_updated_at: string;
  body_source: "paige_draft" | "tenant_template";
  status: "draft";
  content_sha256: null;
  terms_id: string;
  terms_version: number;
  terms_updated_at: string;
  invoice_id: string;
  invoice_version: number;
  invoice_draft_version: number;
  invoice_updated_at: string;
};
export type CommercialPresentationPayload = {
  schema_version: 1;
  source: PresentationSource;
  title: string;
  body_sha256: string;
  principal_minor: number;
  currency: "usd";
  amount_basis: "total";
  collection_terms: CollectionTerms;
  obligations: ScheduleRow[];
  conditions: CommercialConditions;
  lines: ResolvedCommercialLine[];
};
export type PreparedCommercialPresentation = {
  payload: CommercialPresentationPayload;
  payload_digest: string;
  appendix: string;
};
export type RenderedCommercialPresentation = PreparedCommercialPresentation & {
  document_bytes: Uint8Array;
  document_sha256: string;
  presented_body_markdown: string;
  presented_body_sha256: string;
};
const refuse = (): never => {
  throw Error("COMMERCIAL_PRESENTATION_UNAVAILABLE");
};
const keys = [
  "tenant_id",
  "client_id",
  "offer_id",
  "agreement_id",
  "agreement_version",
  "agreement_updated_at",
  "body_source",
  "status",
  "content_sha256",
  "terms_id",
  "terms_version",
  "terms_updated_at",
  "invoice_id",
  "invoice_version",
  "invoice_draft_version",
  "invoice_updated_at",
];
/** Stable source binding only; this digest is not approval, signature or authority. */
export function canonicalPresentationJson(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalPresentationJson).join(",") + "]";
  }
  if (object(value)) {
    return "{" + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ":" + canonicalPresentationJson(value[key])
    ).join(",") + "}";
  }
  if (
    value === null || typeof value === "string" || typeof value === "boolean" ||
    typeof value === "number" && Number.isFinite(value)
  ) return JSON.stringify(value);
  return refuse();
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const text = (value: unknown, max: number): string =>
  typeof value === "string" && value.trim() && value.length <= max
    ? value
    : refuse();
/** Inputs must be resolved by the canonical caller under current tenant/actor authority.
 * Only explicit complete recorded facts qualify. No prose/PDF parsing or historical inference. */
export async function prepareCommercialPresentation(
  input: unknown,
): Promise<PreparedCommercialPresentation> {
  if (!object(input)) return refuse();
  only(input, [
    "schema_version",
    "source",
    "title",
    "body_markdown",
    "principal_minor",
    "currency",
    "collection_terms",
    "conditions",
    "lines",
  ]);
  if (input.schema_version !== 1 || !object(input.source)) return refuse();
  const raw = input.source;
  only(raw, keys);
  if (keys.some((k) => !(k in raw))) return refuse();
  if (
    [
      "tenant_id",
      "client_id",
      "offer_id",
      "agreement_id",
      "terms_id",
      "invoice_id",
    ].some((k) => typeof raw[k] !== "string" || !UUID.test(String(raw[k]))) ||
    !["paige_draft", "tenant_template"].includes(String(raw.body_source)) ||
    raw.status !== "draft" || raw.content_sha256 !== null
  ) return refuse();
  integer(raw.agreement_version, 1);
  integer(raw.terms_version, 0);
  integer(raw.invoice_version, 1);
  integer(raw.invoice_draft_version, 1);
  if (
    typeof raw.invoice_updated_at !== "string" ||
    raw.invoice_updated_at.length > 50 ||
    !Number.isFinite(Date.parse(raw.invoice_updated_at))
  ) return refuse();
  if (
    typeof raw.agreement_updated_at !== "string" ||
    raw.agreement_updated_at.length > 50 ||
    !Number.isFinite(Date.parse(raw.agreement_updated_at))
  ) return refuse();
  if (
    typeof raw.terms_updated_at !== "string" ||
    raw.terms_updated_at.length > 50 ||
    !Number.isFinite(Date.parse(raw.terms_updated_at))
  ) return refuse();
  const title = text(input.title, 200),
    body = text(input.body_markdown, 200000),
    principal = integer(input.principal_minor, 1);
  // Current canonical conditions validator supports USD only. Do not widen it here.
  if (input.currency !== "usd" || !object(input.collection_terms)) {
    return refuse();
  }
  const schedule = input.collection_terms;
  if (!object(schedule.late_fee) || !object(schedule.interest)) return refuse();
  const late = schedule.late_fee, interest = schedule.interest;
  if (
    ["fixed_cents", "rate_bps", "grace_days", "agreement_basis"].some((k) =>
      !(k in late)
    ) || ["annual_bps", "agreement_basis"].some((k) => !(k in interest))
  ) return refuse();
  const terms = parseCollectionTerms(schedule);
  // Current presented obligations cover principal only; accruing charge computation is not acceptance.
  if (
    terms.late_fee.fixed_cents !== 0 || terms.late_fee.rate_bps !== 0 ||
    terms.interest.annual_bps !== 0 || terms.currency !== input.currency ||
    terms.total_cents !== principal || terms.count === null ||
    terms.kind === "recurring"
  ) return refuse();
  const preview = previewCollectionSchedule(terms, MAX_SCHEDULE);
  if (
    preview.amount_basis !== "total" || preview.has_more ||
    preview.rows.length !== terms.count ||
    !preview.rows.length
  ) return refuse();
  const conditions = parseCommercialConditions(input.conditions);
  if (
    !conditions || conditions.tax.state === "unknown" ||
    conditions.fees.state === "unknown" || !Array.isArray(input.lines) ||
    !input.lines.length
  ) return refuse();
  validateCommercialConditionLines(
    conditions,
    input.lines as ResolvedCommercialLine[],
    input.currency,
  );
  const lines = (input.lines as ResolvedCommercialLine[]).map((line) => ({
    unit_minor: line.unit_minor,
    quantity: line.quantity,
  }));
  const payload: CommercialPresentationPayload = {
    schema_version: 1,
    source: structuredClone(raw) as PresentationSource,
    title,
    body_sha256: await sha256Hex(body),
    principal_minor: principal,
    currency: "usd",
    amount_basis: preview.amount_basis,
    collection_terms: terms,
    obligations: preview.rows,
    conditions,
    lines,
  };
  const digest = await sha256Hex(canonicalPresentationJson(payload));
  // Display formatting only: canonical minor units and schedule rows are unchanged.
  // Internal IDs, schema and source digests remain in the proof payload, not the contract text.
  const money = (minor: number) =>
    `USD ${
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(minor / 100)
    }`;
  const human = (value: string) => value.replace(/[\r\n\t]+/g, " ").trim();
  const treatment = (name: string, value: CommercialConditions["tax"]) =>
    [
      `${name}: ${
        value.state === "not_applicable"
          ? "Not applicable."
          : "Recorded included charges."
      }`,
      ...value.charges.map((charge) =>
        `${money(charge.amount_minor)} included in invoice item ${
          charge.line_index + 1
        }.`
      ),
      `Source: ${human(value.source!)}`,
      `Policy: ${human(value.policy!)}`,
    ].join(" ");
  const appendix = [
    "## Commercial terms",
    `Principal: ${money(principal)}`,
    "### Dated payments",
    ...preview.rows.map((row) =>
      `${row.sequence}. ${row.due_date} - ${money(row.amount_cents)}${
        row.label ? " - " + human(row.label) : ""
      }`
    ),
    "### Tax and fees",
    treatment("Tax", conditions.tax),
    treatment("Fees", conditions.fees),
    "Recorded tax and fee amounts are included in the invoice items. They do not add amounts to the dated payments above.",
  ].join("\n\n");
  return freeze({ payload, payload_digest: digest, appendix });
}
/** Preparation/rendering only. Caller must independently bind expected to existing approval,
 * resolve source again and atomically freeze this exact payload with the presented document. */
export async function renderCommercialPresentation(
  current: unknown,
  expected: PreparedCommercialPresentation,
  renderer?: (
    input: { title: string; bodyMarkdown: string },
  ) => Promise<Uint8Array>,
): Promise<RenderedCommercialPresentation> {
  const captured = structuredClone(current);
  const prepared = await prepareCommercialPresentation(captured);
  if (
    !expected || prepared.payload_digest !== expected.payload_digest ||
    canonicalPresentationJson(prepared.payload) !==
      canonicalPresentationJson(expected.payload) ||
    prepared.appendix !== expected.appendix
  ) throw Error("COMMERCIAL_PRESENTATION_CHANGED");
  const body = (captured as Record<string, unknown>).body_markdown as string;
  const render = renderer ?? (await import("./document.ts")).renderPresentedPdf;
  const presentedBody = `${body}\n\n${prepared.appendix}`;
  const bytes = await render({
    title: prepared.payload.title,
    bodyMarkdown: presentedBody,
  });
  return {
    ...prepared,
    document_bytes: bytes,
    document_sha256: await sha256Hex(bytes),
    presented_body_markdown: presentedBody,
    presented_body_sha256: await sha256Hex(presentedBody),
  };
}
