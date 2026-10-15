/** Canonical tenant Knowledge projection. Document presence does not prove indexing coverage or Memory confirmation. */
import { useMemo } from "react";
import { useKnowledgeDocuments } from "@/hooks/useKnowledgeDocuments";
import { useOptionalTenantContext } from "@/hooks/useTenantContext";

/** One saved document, reshaped for the solo Knowledge surface. */
export interface SoloKnowledgeDoc {
  id: string;
  title: string;
  summary: string | null;
  /** Free-form category label as stored — LIVE, humanized for display, or null. */
  domain: string | null;
  tags: string[];
  source: string | null;
  chunkCount: number;
  createdAt: string;
  /** Compact relative label ("12m ago", "6h ago", "1d ago") from created_at — LIVE. */
  when: string;
  /** Domain accent color (category → color) — PREVIEW presentation only. */
  color: string;
}

export interface SoloKnowledgeData {
  loading: boolean;
  error: string | null;
  /** Loaded saved documents, newest first. */
  docs: SoloKnowledgeDoc[];
  /** Top-N newest docs for the "Recently learned" feed — LIVE. */
  recentlyLearned: SoloKnowledgeDoc[];
  /** Loaded documents with recorded chunks; not a total or complete indexing guarantee. */
  documentsIndexed: number;
  /** True only when a successful canonical read returned no documents. */
  empty: boolean;
  refresh: () => void;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  requestedDocumentError: string | null;
  requestedDocumentState: 'idle' | 'loading' | 'available' | 'missing' | 'error';
}

/** The raw row shape from the RLS-scoped select (mirrors KnowledgePanel's TenantDoc). */
interface KnowledgeDocRow {
  id: string;
  title: string;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  source: string | null;
  chunk_count: number | null;
  created_at: string;
}

/** How many docs feed the "Recently learned" feed. */
const RECENT_LIMIT = 6;

/**
 * Category → domain accent color (PREVIEW presentation only, §13). Maps recognizable
 * category slugs onto the KC domain palette; anything unknown gets a neutral violet.
 * This colors a dot — it never fabricates a value.
 */
const CATEGORY_COLOR: Record<string, string> = {
  playbook: "#E9A83A",
  doctrine: "#E9A83A",
  clients: "#8A72F5",
  threads: "#8A72F5",
  offers: "#3FA6B8",
  pricing: "#3FA6B8",
  compliance: "#E88A80",
  vault: "#E88A80",
  legal: "#E88A80",
  brand: "#F2C97A",
  voice: "#F2C97A",
  systems: "#4CC48C",
  data: "#4CC48C",
};
const DEFAULT_COLOR = "#8A72F5";

function colorForCategory(category: string | null): string {
  if (!category) return DEFAULT_COLOR;
  const key = category.toLowerCase();
  for (const token of Object.keys(CATEGORY_COLOR)) {
    if (key.includes(token)) return CATEGORY_COLOR[token];
  }
  return DEFAULT_COLOR;
}

/** "clients_and_threads" / "brand-voice" → "Clients and threads" (§13 — never a fake). */
function humanizeCategory(category: string | null): string | null {
  if (!category) return null;
  const s = category.replace(/[_-]+/g, " ").trim();
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** created_at → compact "just now" / "12m ago" / "6h ago" / "1d ago" (fixture style). */
function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function toDoc(r: KnowledgeDocRow): SoloKnowledgeDoc {
  return {
    id: r.id,
    title: r.title,
    summary: typeof r.summary === "string" && r.summary.trim() ? r.summary : null,
    domain: humanizeCategory(r.category),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
    source: typeof r.source === "string" && r.source.trim() ? r.source : null,
    chunkCount: typeof r.chunk_count === "number" ? r.chunk_count : 0,
    createdAt: r.created_at,
    when: relativeWhen(r.created_at),
    color: colorForCategory(r.category),
  };
}

export function useSoloKnowledge(requestedDocumentId?: string | null): SoloKnowledgeData {
  const tenantId = useOptionalTenantContext()?.activeTenantId ?? null;
  const { docs: rows, loading, error, reload, hasMore, loadMore } = useKnowledgeDocuments(tenantId);
  const requested = useKnowledgeDocuments(requestedDocumentId ? tenantId : null, requestedDocumentId);
  // The targeted read is newer, independent evidence. A list snapshot cannot revive a
  // requested source which that read could not find or could not authorize/read.
  const requestedDocumentState: SoloKnowledgeData['requestedDocumentState'] = !requestedDocumentId ? 'idle'
    : requested.loading ? 'loading' : requested.error ? 'error'
      : requested.docs.some(doc => doc.id === requestedDocumentId) ? 'available' : 'missing';
  const docs = useMemo(() => Array.from(new Map([
    ...rows.filter(row => row.id !== requestedDocumentId),
    ...(requestedDocumentState === 'available' ? requested.docs : []),
  ].map(row => [row.id, row])).values()).map(toDoc), [rows, requested.docs, requestedDocumentId, requestedDocumentState]);
  const recentlyLearned = useMemo(() => docs.slice(0, RECENT_LIMIT), [docs]);
  const pending = loading || (!!requestedDocumentId && requested.loading);
  return { loading: pending, error, docs, recentlyLearned, documentsIndexed: docs.filter(doc => doc.chunkCount > 0).length,
    empty: !pending && !error && docs.length === 0,
    refresh: () => { void reload(); if (requestedDocumentId) void requested.reload(); }, hasMore, loadMore,
    requestedDocumentError: requestedDocumentId ? requested.error : null, requestedDocumentState };
}
