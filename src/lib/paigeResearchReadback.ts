import type { PaigeResearchResult } from "@/components/paige/chat/PaigeResearchCard";

export type ResearchHistorySource = {
  index: number; url: string; title: string | null; snippet: string | null;
  reliability_score: number | null; tier: string | null; reliability: string | null;
  published_at: string | null; fetched_at: string | null; excluded: boolean;
};
export type ResearchHistoryDetail = {
  id: string; question: string; domain: string | null; caller: string | null;
  stop_reason: string | null; configured: boolean; created_at: string;
  findings: Array<{ text: string; citations: number[]; confidence: string; unverifiedFields?: string[] }>;
  coverage: { stop_reason?: string; hops_used?: number; searches?: number; reads?: number;
    note?: string; configured?: boolean; unverified_notes?: string[] };
  entity_profile: unknown | null; sources: ResearchHistorySource[]; evidenceComplete: boolean;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nullableText = (value: unknown) => value === null || typeof value === "string";
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === "string");
const httpUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname; }
  catch { return false; }
};

/** The public member-history RPC is the authority for visibility, not a new save
 * verdict. Never repair its history, renumber sources or infer evidence from a
 * parent row. Keep metadata inspectable when the original evidence is incomplete. */
export function projectResearchHistoryRun(value: unknown, runId: string): ResearchHistoryDetail | null {
  if (!record(value) || value.id !== runId || typeof value.question !== "string"
    || typeof value.configured !== "boolean" || !nullableText(value.stop_reason)) return null;
  let complete = Array.isArray(value.sources) && Array.isArray(value.findings) && record(value.coverage);
  const sources: ResearchHistorySource[] = [];
  const indices = new Map<number, number>();
  for (const item of Array.isArray(value.sources) ? value.sources : []) {
    if (!record(item) || !Number.isInteger(item.index) || (item.index as number) < 1 || !httpUrl(item.url)
      || !nullableText(item.title) || !nullableText(item.tier) || !nullableText(item.reliability)
      || !(item.published_at === undefined || nullableText(item.published_at))
      || typeof item.excluded !== "boolean") { complete = false; continue; }
    const index = item.index as number;
    indices.set(index, (indices.get(index) ?? 0) + 1);
    sources.push({ index, url: item.url, title: item.title as string | null,
      snippet: typeof item.snippet === "string" ? item.snippet : null,
      reliability_score: typeof item.reliability_score === "number" && Number.isFinite(item.reliability_score) ? item.reliability_score : null,
      tier: item.tier as string | null, reliability: item.reliability as string | null,
      published_at: typeof item.published_at === "string" ? item.published_at : null,
      fetched_at: typeof item.fetched_at === "string" ? item.fetched_at : null, excluded: item.excluded });
  }
  if ([...indices.values()].some(count => count !== 1)) complete = false;
  const unambiguousSources = sources.filter(source => indices.get(source.index) === 1);
  const cites = (value: unknown, allowEmpty = false): value is number[] => Array.isArray(value)
    && (allowEmpty || value.length > 0) && new Set(value).size === value.length
    && value.every(index => Number.isInteger(index) && unambiguousSources.some(source => source.index === index && !source.excluded));
  const findings: ResearchHistoryDetail["findings"] = [];
  for (const item of Array.isArray(value.findings) ? value.findings : []) {
    if (!record(item) || typeof item.text !== "string" || !item.text.trim() || typeof item.confidence !== "string"
      || !cites(item.citations) || (item.unverifiedFields !== undefined && !texts(item.unverifiedFields))) { complete = false; continue; }
    findings.push({ text: item.text, confidence: item.confidence, citations: [...item.citations],
      ...(item.unverifiedFields === undefined ? {} : { unverifiedFields: [...item.unverifiedFields as string[]] }) });
  }
  const coverage: ResearchHistoryDetail["coverage"] = {};
  if (record(value.coverage)) {
    for (const key of ["searches", "reads", "hops_used"] as const) {
      const metric = value.coverage[key];
      if (metric === undefined) continue;
      if (typeof metric === "number" && Number.isInteger(metric) && metric >= 0) coverage[key] = metric;
      else complete = false;
    }
    if (typeof value.coverage.stop_reason === "string") coverage.stop_reason = value.coverage.stop_reason;
    if (typeof value.coverage.configured === "boolean") coverage.configured = value.coverage.configured;
    if (value.coverage.unverified_notes !== undefined && !texts(value.coverage.unverified_notes)) complete = false;
    else if (texts(value.coverage.unverified_notes)) coverage.unverified_notes = [...value.coverage.unverified_notes];
  }
  // The existing dossier renderer owns its fact/unverified treatment. Refuse a
  // malformed container or unresolved citation instead of casting it into JSX.
  const profile = value.entity_profile ?? null;
  if (profile !== null) {
    const textKeys = new Set(["name", "summary", "headline", "note", "status", "title", "email", "phone", "profile_url", "division",
      "contact_status", "confidence", "reliability_label", "description", "detail", "status_note", "label", "address", "locality", "site"]);
    const validNode = (node: unknown, depth = 0): boolean => {
      if (depth > 12) return false;
      if (Array.isArray(node)) return node.every(child => validNode(child, depth + 1));
      if (!record(node)) return node === null || ["string", "number", "boolean"].includes(typeof node);
      return Object.entries(node).every(([key, child]) => textKeys.has(key) ? typeof child === "string"
        : (key === "citations" || key.endsWith("_citations")) ? cites(child, true) : validNode(child, depth + 1));
    };
    if (!record(profile) || typeof profile.name !== "string" || typeof profile.summary !== "string" || typeof profile.headline !== "string"
      || !["organization", "person"].includes(String(profile.kind)) || !texts(profile.unverified_notes)
      || !["people", "divisions", "offerings", "locations"].every(key => record(profile[key]) && Array.isArray(profile[key].items) && profile[key].items.every(record))
      || !record(profile.coverage) || !Object.values(profile.coverage).every(count => typeof count === "number" && Number.isInteger(count) && count >= 0)
      || !validNode(profile)) complete = false;
  }
  // A stale synthesis note can claim verified findings/sources that the canonical
  // source rows cannot substantiate. Withhold it together with the unsafe claims.
  if (complete && record(value.coverage) && typeof value.coverage.note === "string") coverage.note = value.coverage.note;
  return { id: runId, question: value.question, configured: value.configured, stop_reason: value.stop_reason as string | null,
    domain: typeof value.domain === "string" ? value.domain : null, caller: typeof value.caller === "string" ? value.caller : null,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    sources: unambiguousSources, findings: complete ? findings : [], coverage,
    entity_profile: complete ? profile : null, evidenceComplete: complete };
}

/** Chat must retain the original reference's saved:false. Even saved:true only
 * survives a complete current canonical read; a metadata-only parent is not proof. */
export function readResearchHistoryRun(value: unknown, runId: string): Omit<PaigeResearchResult, "saved"> | null {
  const run = projectResearchHistoryRun(value, runId);
  if (!run?.evidenceComplete) return null;
  return { run_id: run.id, question: run.question, configured: run.configured, stop_reason: run.stop_reason,
    is_dossier: !!run.entity_profile, findings: run.findings, sources: run.sources,
    unverified_notes: run.coverage.unverified_notes ?? [], rehydrating: false };
}
