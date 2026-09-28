/**
 * useSoloKnowledge — the Solo Paige › "Knowledge" adapter (§18: composes the EXISTING
 * `tenant_knowledge_docs` read the KnowledgePanel/TenantKnowledgeAdmin already ship,
 * never a new query family).
 *
 * A THIN read layer. It surfaces the tenant's REAL indexed documents so the solo
 * Knowledge surface can populate its doc list + the "Recently learned" feed + the
 * documents-indexed stat — from live data instead of the `KC` design fixture.
 *
 * Seam reused (data only):
 *   • supabase.from("tenant_knowledge_docs").select(...).order(created_at desc)
 *     — the SAME RLS-tenant-scoped select KnowledgePanel uses (id, title, summary,
 *     category, tags, source, chunk_count, created_at).
 *
 * §9 TENANT ISOLATION: passes NO tenant_id — RLS on `tenant_knowledge_docs` scopes
 * the read to the caller's tenant (current_user_tenant_id()), so a sub-account sees
 * ITS OWN docs only, never the parent's. Do not re-widen.
 *
 * §13/§31 HONESTY — what is LIVE vs Preview:
 *   • docs / recentlyLearned → LIVE   real rows, ordered created_at desc
 *   • documentsIndexed       → LIVE   real COUNT of the tenant's docs
 *   • color (per doc)        → PREVIEW presentation only (category → domain color)
 *   • empty ("Nothing indexed yet") → HONEST when the tenant has 0 docs; NEVER a
 *     fabricated doc/count is emitted.
 *
 * EXPLICITLY NOT SOURCED (stay design fixture / Preview in the UI — real docs can
 * populate a LIST, not a 3D clustering, and there is no seam for these):
 *   • the 6-domain BrainCanvas graph + per-domain "trained Xh ago"
 *   • the g4 stat tiles other than "Documents indexed": Citations this week,
 *     Gaps she flagged, Retrieval accuracy — Preview unless a real source exists.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOptionalTenantContext } from "@/hooks/useTenantContext";

/** One indexed document, reshaped for the solo Knowledge surface. */
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
  /** Every indexed doc, newest first — LIVE. */
  docs: SoloKnowledgeDoc[];
  /** Top-N newest docs for the "Recently learned" feed — LIVE. */
  recentlyLearned: SoloKnowledgeDoc[];
  /** Real COUNT of the tenant's indexed documents — LIVE. */
  documentsIndexed: number;
  /** True (and only true) when the tenant has genuinely nothing indexed. */
  empty: boolean;
  refresh: () => void;
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

export function useSoloKnowledge(): SoloKnowledgeData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The documents, and the workspace they were read for. Returned only for that workspace, so a
  // switch never shows the previous workspace's documents while the new read is in flight.
  const [loaded, setLoaded] = useState<{ tenant: string | null; docs: SoloKnowledgeDoc[] }>({ tenant: null, docs: [] });
  // Only the latest read may write: a switch starts a second read, and the first can land late.
  const generation = useRef(0);

  const activeTenantId = useOptionalTenantContext()?.activeTenantId ?? null;

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    // RLS decides what the caller MAY read (§9). It is not enough to decide what this workspace
    // IS: a super_admin acting as one workspace is admitted to every workspace's documents, and a
    // member of several workspaces to all of theirs. So the read is also bound to the active
    // workspace — a narrowing, never a grant. The generated types don't carry this recent table,
    // so the select is cast, mirroring KnowledgePanel/NetworkKbInsights.
    let query = supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("tenant_knowledge_docs" as any)
      .select("id, title, summary, category, tags, source, chunk_count, created_at")
      .order("created_at", { ascending: false });
    if (activeTenantId) query = query.eq("tenant_id", activeTenantId);
    const { data, error: selErr } = await query;
    if (mine !== generation.current) return;
    if (selErr) {
      setError(selErr.message);
      setLoaded({ tenant: activeTenantId, docs: [] });
      setLoading(false);
      return;
    }
    const rows = ((data as unknown as KnowledgeDocRow[] | null) ?? []).filter(
      (r): r is KnowledgeDocRow => !!r && typeof r.id === "string" && typeof r.title === "string",
    );
    setLoaded({ tenant: activeTenantId, docs: rows.map(toDoc) });
    setLoading(false);
  }, [activeTenantId]);

  const docs = useMemo(
    () => (loaded.tenant === activeTenantId ? loaded.docs : []),
    [loaded, activeTenantId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const recentlyLearned = useMemo(() => docs.slice(0, RECENT_LIMIT), [docs]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return {
    loading,
    error,
    docs,
    recentlyLearned,
    documentsIndexed: docs.length,
    empty: !loading && !error && docs.length === 0,
    refresh,
  };
}
