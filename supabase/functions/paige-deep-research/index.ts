// paige-deep-research — Paige's universal, cited, multi-hop research engine (#165/#166).
//
// A bounded PLAN → SEARCH → READ → GAP-CHECK loop, then exactly ONE Claude synthesis
// call, followed by a deterministic anti-fabrication gate. Every returned finding carries
// at least one citation that resolves to a real, non-excluded source. Nothing is invented:
// if web search is unconfigured, or no sources survive validation, the engine returns
// `findings: []` with an honest note — it never fabricates a fact to fill the gap (§13).
//
// The engine is DOMAIN-AGNOSTIC. It carries no vertical or finance vocabulary of any kind
// (§2/§4). `domain` and `caller` are opaque hint strings that only ever colour the search
// queries the planner writes and are persisted verbatim; they are never branched on in code.
//
// Reuse, don't reinvent (§13):
//   • search  → POST ${SUPABASE_URL}/functions/v1/paige-web-search   (Firecrawl; honours its
//               own `configured:false` path — we propagate it, never fabricate).
//   • read    → POST ${SUPABASE_URL}/functions/v1/fetch-url-content  (SSRF-guarded fetch).
//   • models  → _shared/model-router.ts routedChatCompletion(jobKind):
//               "extract" (PLAN/GAP-CHECK, cheap) · "score" (tie-breaks, cheap) ·
//               "doc_draft" (the ONE final synthesis → Claude reasoning tier = claude-sonnet-5).
//
// Persistence is via the SERVICE-ROLE client into research_runs + research_sources —
// the service role is the write boundary. (CORRECTION 2026-10-03, M0: this header used to
// claim persistence is "RLS declared for direct client reads"; production grants prove
// direct client reads were never usable — table grants are owner-only and the canonical
// read path is the governed RPC pair added by migration 20270540000000. History preserved;
// claim corrected.)
//
// TENANT LINEAGE (M0, owner ruling 2026-10-03): every PERSISTED run carries the exact
// resolved workspace, and sources inherit it verbatim. Lineage is strict for persistence:
// user JWT → current_user_tenant_id; service-role caller → profiles.active_tenant_id of the
// validated acting user — and NO first-membership fallback (too ambiguous: the platform must
// not persist a run under guessed ownership). Ambiguous lineage SKIPS persistence with an
// honest log while the research itself still runs and returns. An optional
// body.expected_tenant_id is a CROSS-CHECK only (a mismatch skips persistence); it is never
// the persisted value and never authority.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { routedChatCompletion } from "../_shared/model-router.ts";
import { strategizeBeforeReasoning } from "../_shared/reasoning/strategize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Hard bounds (A2 — enforced, not advisory) ───────────────────────────────
const MAX_HOPS = 3;                 // absolute ceiling; request clamps to 1..3, default 2
const MAX_QUERIES_PER_HOP = 4;
const MAX_TOTAL_SEARCHES = 10;
const MAX_READS = 6;
const WALL_CLOCK_MS = 60_000;
const COST_CEILING_USD = 0.15;      // soft — logged, breaks gathering, still synthesises
const READ_BODY_MAX = 6_000;        // chars kept per fetched page

// Rough per-op cost estimate (USD) — only for the soft ceiling log/break, never billed.
const COST = { search: 0.001, read: 0.0005, cheapLLM: 0.002, synthesis: 0.03 };

// ── Conditional dossier bounds (A8) ─────────────────────────────────────────
// The general-question path (entityTarget === null) uses the constants above
// UNCHANGED. When — and ONLY when — an entity target is detected, the engine
// widens to these bounds so a full business/entity dossier can be assembled in
// one bounded run. Nothing else about the general path changes.
const MAX_HOPS_DOSSIER = 4;
const MAX_QUERIES_PER_HOP_DOSSIER = 6;
const MAX_TOTAL_SEARCHES_DOSSIER = 18;
const MAX_READS_DOSSIER = 10;
const WALL_CLOCK_MS_DOSSIER = 90_000;
const COST_CEILING_USD_DOSSIER = 0.10; // soft; general stays 0.15

interface RunBounds {
  MAX_HOPS: number;
  MAX_QUERIES_PER_HOP: number;
  MAX_TOTAL_SEARCHES: number;
  MAX_READS: number;
  WALL_CLOCK_MS: number;
  COST_CEILING_USD: number;
}
const DEFAULT_BOUNDS: RunBounds = {
  MAX_HOPS, MAX_QUERIES_PER_HOP, MAX_TOTAL_SEARCHES, MAX_READS, WALL_CLOCK_MS, COST_CEILING_USD,
};
const DOSSIER_BOUNDS: RunBounds = {
  MAX_HOPS: MAX_HOPS_DOSSIER,
  MAX_QUERIES_PER_HOP: MAX_QUERIES_PER_HOP_DOSSIER,
  MAX_TOTAL_SEARCHES: MAX_TOTAL_SEARCHES_DOSSIER,
  MAX_READS: MAX_READS_DOSSIER,
  WALL_CLOCK_MS: WALL_CLOCK_MS_DOSSIER,
  COST_CEILING_USD: COST_CEILING_USD_DOSSIER,
};

type StopReason =
  | "answered" | "max_hops" | "budget" | "wall_clock"
  | "no_results" | "unconfigured" | "error";

// ── Request contract (A1) ───────────────────────────────────────────────────
interface DeepResearchRequest {
  question: string;
  user_id: string;
  client_user_id?: string | null;
  domain?: string;
  max_hops?: number;
  freshness_days?: number;
  persist?: boolean;
  /** Optional CROSS-CHECK (never authority): when provided and ≠ the server-resolved
   *  lineage tenant, persistence is SKIPPED — an upstream context disagreement is treated
   *  as ambiguous, not resolved in the caller's favor. */
  expected_tenant_id?: string;
  strict?: boolean;
  caller?: string;   // opaque provenance tag (e.g. "chat" | "manual" | an opted-in caller)
  // A7 — caller-supplied flavor facets. An opt-in vertical surface may inject its
  // OWN extra search-facet templates (with `{name}`/`{site}` placeholders) that are
  // appended after the universal facets in dossier mode. The engine holds ZERO
  // vertical vocabulary; any domain-specific facet wording lives in the CALLER
  // (§2/§9). This is the injection MECHANISM only — never a vertical literal here.
  flavor_facets?: string[];
}

// ── Output contract (A6) ────────────────────────────────────────────────────
interface Finding {
  text: string;
  citations: number[];
  confidence: "high" | "medium" | "low";
  unverifiedFields?: string[];
  // VALIDATED structured specifics — the ONLY trustworthy source of these facts.
  // Populated solely from values that survived the deterministic gate in
  // validateAndBind. Downstream callers MUST read these structured fields, never
  // regex the free-text `text` field (which can carry ungrounded model prose).
  name?: string;
  website?: string;
  phone?: string;
  values?: string[];
}
interface OutSource {
  index: number;
  url: string;
  title: string;
  snippet: string;
  reliability_score: number;
  tier: "T1" | "T2" | "T3" | "T4" | "T5";
  reliability: "high" | "medium" | "low";
  published_at: string | null;
  fetched_at: string;
  excluded: boolean;
}
// ── Entity dossier output schema (Section B1) ───────────────────────────────
// Every field carries its OWN per-field citations and is proven against ONLY
// those sources by the deterministic validateProfile gate. Nothing here is
// emitted unless it survived that gate against a real, non-excluded source.
type EntityKind = "organization" | "person";

interface ProfilePerson {
  name: string;
  name_citations: number[];              // ≥1 required; else person dropped
  title?: string;
  title_citations: number[];             // ⊆ resolved(name_citations); else title omitted
  contact?: {
    email?: string;   email_citations: number[];        // verbatim in cited source; else omitted
    phone?: string;   phone_citations: number[];         // last-10 via phonesIn(); else omitted
    profile_url?: string; profile_url_citations: number[]; // host-vouched; else omitted
  };
  division?: string; division_citations: number[];       // ⊆ resolved(name_citations); else Unassigned
  contact_status: "verified" | "not_public";             // "verified" iff email|phone|profile_url survived
  confidence: "high" | "medium" | "low";                 // deriveConfidence(name-grounding sources)
  reliability_label: string;                             // Corroborated | Single authoritative source | Single low-tier source — treat as a lead
  unverified_fields: string[];                           // fields the model proposed that a gate dropped
  email_flags?: string[];                                // e.g. "personal-domain"
}
interface ProfileDivision { name: string; description?: string; citations: number[]; status_note?: string; }
interface ProfileOffering { name: string; detail?: string; citations: number[]; }
interface ProfileLocation {
  label?: string; address?: string; address_citations: number[];
  locality?: string; locality_citations: number[];       // city/region-only, separate from address
  phone?: string; phone_citations: number[];
  site?: string; site_citations: number[];
  citations: number[];
}
interface ProfileSection<T> { status: "verified" | "partial" | "not_found"; items: T[]; note: string; }

interface EntityProfile {
  name: string;
  kind: EntityKind;
  summary: string;                       // 1–3 sentence grounded overview, cited via findings
  people:    ProfileSection<ProfilePerson>;
  divisions: ProfileSection<ProfileDivision>;
  offerings: ProfileSection<ProfileOffering>;
  locations: ProfileSection<ProfileLocation>;
  unverified_notes: string[];            // deterministic honesty trail (the LLM never writes these)
  headline: string;
  coverage: {
    people_found: number;
    people_with_verified_contact: number;
    divisions_found: number;
    locations_found: number;
  };
}

interface DeepResearchResult {
  run_id: string;
  question: string;
  findings: Finding[];
  sources: OutSource[];
  // Present ONLY in dossier mode (entity target detected) AND only when ≥1 typed
  // item survived the profile gate. Absent on the general path → back-compat.
  entity_profile?: EntityProfile;
  coverage: {
    stop_reason: string;
    hops_used: number;
    searches: number;
    reads: number;
    note: string;
    configured: boolean;
    // Mirror of entity_profile.unverified_notes for consumers that read only
    // `coverage`. Canonical source is entity_profile.unverified_notes.
    unverified_notes?: string[];
  };
}

// Internal working record for a discovered source.
interface SourceRec {
  index: number;              // assigned in rank order at the end; provisional during loop
  url: string;
  title: string;
  snippet: string;            // from search description
  content: string;            // full-page body (truncated), "" until read
  read: boolean;
  host: string;               // eTLD+1
  published_at: string | null;
  fetched_at: string;
  // ranking outputs
  authority: number;
  recency: number;
  corroboration: number;
  reliability_score: number;
  tier: "T1" | "T2" | "T3" | "T4" | "T5";
  reliability: "high" | "medium" | "low";
  excluded: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ── eTLD+1 + authority classification (B1) ──────────────────────────────────
// Two-part TLDs we may encounter; keeps eTLD+1 from collapsing to "co.uk".
const MULTI_TLDS = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "co.jp", "com.au", "gov.au", "co.nz",
  "com.br", "co.in", "gov.in",
]);

function etld1(hostname: string): string {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_TLDS.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

function hostOf(url: string): string {
  try { return etld1(new URL(url).hostname); } catch { return ""; }
}

// T2 established-institution / major-press allowlist (generic; no vertical content).
const T2_ALLOW = new Set([
  "reuters.com", "bloomberg.com", "apnews.com", "ap.org", "wsj.com",
  "ft.com", "economist.com", "nytimes.com", "washingtonpost.com", "bbc.co.uk",
  "npr.org", "nature.com", "science.org", "who.int", "worldbank.org", "oecd.org",
  "iso.org", "ieee.org", "w3.org",
]);

// T5 content-farm / SEO-spam / UGC-aggregator denylist → hard-excluded, never citable.
const T5_DENY = new Set([
  "pinterest.com", "quora.com", "answers.com", "ehow.com", "buzzfeed.com",
  "medium.com", "reddit.com", "wikihow.com", "slideshare.net", "scribd.com",
  "blogspot.com", "wordpress.com", "tumblr.com", "facebook.com", "instagram.com",
  "tiktok.com", "x.com", "twitter.com",
]);

const T1_TLDS = [".gov", ".edu", ".mil", ".int"];

function classifyAuthority(host: string, hostname: string): { tier: SourceRec["tier"]; authority: number } {
  const hn = hostname.toLowerCase();
  if (T1_TLDS.some((t) => hn.endsWith(t) || hn.includes(t + "."))) return { tier: "T1", authority: 1.0 };
  if (host.endsWith(".gov") || host.endsWith(".edu") || host.endsWith(".mil") || host.endsWith(".int")) {
    return { tier: "T1", authority: 1.0 };
  }
  if (T2_ALLOW.has(host)) return { tier: "T2", authority: 0.8 };
  if (T5_DENY.has(host)) return { tier: "T5", authority: 0.15 };
  return { tier: "T4", authority: 0.35 };
}

// Meaningful (>3 char, non-stopword) lowercased tokens.
const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "your", "you", "are",
  "was", "were", "will", "have", "has", "not", "but", "all", "can", "how",
  "what", "when", "which", "who", "why", "about", "into", "over", "than",
]);
function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((t) => !STOP.has(t));
}
function tokenSet(s: string): Set<string> {
  return new Set(tokens(s));
}

// ── rankSources (B1) — deterministic; ties broken deterministically ─────────
// authority/recency/corroboration → reliability ∈ [0,1]. Exclude <0.25 and T5.
function rankSources(sources: SourceRec[], freshnessDays: number): SourceRec[] {
  const now = Date.now();
  // Precompute per-source token sets for corroboration (title + snippet + body head).
  const tsets = sources.map((s) => tokenSet(`${s.title} ${s.snippet} ${s.content.slice(0, 1200)}`));

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const hostname = (() => { try { return new URL(s.url).hostname; } catch { return s.host; } })();
    const { tier, authority } = classifyAuthority(s.host, hostname);
    s.tier = tier;
    s.authority = authority;

    // recency
    if (s.published_at) {
      const ageDays = Math.max(0, (now - Date.parse(s.published_at)) / 86_400_000);
      s.recency = Number.isFinite(ageDays) ? clamp01(1 - ageDays / freshnessDays) : 0.4;
    } else {
      s.recency = 0.4; // unknown date
    }

    // corroboration: central tokens independently echoed by ≥1 source on a DIFFERENT eTLD+1.
    const mine = tsets[i];
    let corroborated = false;
    for (let j = 0; j < sources.length; j++) {
      if (j === i) continue;
      if (sources[j].host === s.host || !sources[j].host) continue;
      let overlap = 0;
      for (const tk of tsets[j]) if (mine.has(tk)) { overlap++; if (overlap >= 4) break; }
      if (overlap >= 4) { corroborated = true; break; }
    }
    s.corroboration = corroborated ? 1.0 : 0.3;

    s.reliability_score = clamp01(0.45 * s.authority + 0.25 * s.recency + 0.30 * s.corroboration);

    // Exclusions: T5 hard-excluded; anything below 0.25 excluded (kept for audit).
    s.excluded = tier === "T5" || s.reliability_score < 0.25;

    // Bucket for UI badges: high = T1/T2 corroborated; low = T4/T5 or single-source; else medium.
    if (s.excluded) s.reliability = "low";
    else if ((tier === "T1" || tier === "T2") && s.corroboration >= 1.0) s.reliability = "high";
    else if (tier === "T4" || tier === "T5" || s.corroboration < 1.0) s.reliability = "low";
    else s.reliability = "medium";
  }

  // Deterministic sort: score desc, then authority desc, then recency desc, then url.
  const ranked = [...sources].sort((a, b) =>
    b.reliability_score - a.reliability_score ||
    b.authority - a.authority ||
    b.recency - a.recency ||
    a.url.localeCompare(b.url)
  );
  return ranked;
}

// ── Firecrawl fan-out via paige-web-search (honours configured:false) ───────
interface WebSearchOut {
  configured: boolean;
  results: Array<{ title: string; description: string; url: string; published_at?: string | null }>;
}
async function callWebSearch(
  supabaseUrl: string,
  serviceKey: string,
  query: string,
): Promise<WebSearchOut> {
  let body: any = {};
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/paige-web-search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) {
      // A non-OK response is NOT "0 results" (§13). Most often the search
      // function isn't deployed (404) — which would otherwise masquerade as an
      // empty search and make Paige say "no sources" instead of "search
      // unavailable". A 404 → surface as unconfigured (honest "not connected");
      // any other error → treat as this-query-empty so one flaky call doesn't
      // abort the whole run.
      console.error(`[paige-deep-research] paige-web-search HTTP ${r.status} for query "${query.slice(0, 60)}"`);
      if (r.status === 404) return { configured: false, results: [] };
      return { configured: true, results: [] };
    }
    body = await r.json().catch(() => ({}));
  } catch (e) {
    // A transient network failure on ONE query must not crash the run or be
    // mislabeled as "search offline" — treat it as this query returning nothing.
    console.error("[paige-deep-research] web-search query failed:", (e as Error)?.message);
    return { configured: true, results: [] };
  }
  if (body?.configured === false) return { configured: false, results: [] };
  const results = Array.isArray(body?.results) ? body.results : [];
  return {
    configured: true,
    results: results.map((x: any) => ({
      title: String(x?.title ?? ""),
      description: String(x?.description ?? ""),
      url: String(x?.url ?? ""),
      published_at: x?.published_at ?? x?.date ?? null,
    })).filter((x: any) => x.url),
  };
}

function upsertSource(sources: SourceRec[], hit: { title: string; description: string; url: string; published_at?: string | null }): void {
  if (!hit.url || sources.find((s) => s.url === hit.url)) return;
  sources.push({
    index: -1,
    url: hit.url,
    title: hit.title || hit.url,
    snippet: (hit.description || "").slice(0, 600),
    content: "",
    read: false,
    host: hostOf(hit.url),
    published_at: hit.published_at ?? null,
    fetched_at: new Date().toISOString(),
    authority: 0, recency: 0, corroboration: 0,
    reliability_score: 0, tier: "T4", reliability: "low", excluded: false,
  });
}

// ── Full-page READ via fetch-url-content (SSRF-guarded) ─────────────────────
async function fetchUrl(supabaseUrl: string, serviceKey: string, url: string): Promise<string> {
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/fetch-url-content`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) return "";
    const b = await r.json().catch(() => ({}));
    return b?.success && typeof b.content === "string" ? b.content.slice(0, READ_BODY_MAX) : "";
  } catch {
    return "";
  }
}

// ── JSON parse that tolerates code-fences / stray prose around the object ────
function parseJsonLoose<T>(raw: string): T | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
  try { return JSON.parse(s) as T; } catch { /* fall through */ }
  const first = s.search(/[[{]/);
  const lastO = s.lastIndexOf("}");
  const lastA = s.lastIndexOf("]");
  const last = Math.max(lastO, lastA);
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)) as T; } catch { /* give up */ }
  }
  return null;
}

function llmContent(resp: any): string {
  return typeof resp?.choices?.[0]?.message?.content === "string"
    ? resp.choices[0].message.content
    : "";
}

// ── PLAN / GAP-CHECK (A3a) — cheap "extract" tier ───────────────────────────
interface PlanOut { done: boolean; queries: string[]; gaps?: string[] }

async function planHop(
  question: string,
  domainHint: string,
  hop: number,
  evidence: Array<{ index: number; title: string; snippet: string }>,
  strategyHint = "", // §34 L4: optional pre-reasoning steer, appended like domainHint (hop-0, non-degraded only)
): Promise<PlanOut> {
  const sys =
    "You are a research planner. Break a research goal into orthogonal, specific web-search " +
    "queries that would surface primary, authoritative sources. Return ONLY JSON of the form " +
    '{"done": boolean, "queries": string[], "gaps": string[]}. On the first hop, `done` is ' +
    "false and `queries` holds up to 4 non-overlapping sub-queries. On later hops, inspect the " +
    "evidence gathered so far: if it already answers the goal with concrete, source-backed " +
    "facts, set `done` true and return an empty `queries`; otherwise set `done` false and return " +
    "up to 4 NEW queries that target the remaining gaps. Never repeat an earlier query. No prose.";
  const evidenceBlock = evidence.length
    ? evidence.map((e) => `[${e.index}] ${e.title}\n${e.snippet}`).join("\n\n")
    : "(no evidence gathered yet)";
  const user =
    `RESEARCH GOAL: ${question}\n` +
    (domainHint ? `TOPIC HINT: ${domainHint}\n` : "") +
    (strategyHint ? `${strategyHint}\n` : "") +
    `HOP: ${hop}\n\nEVIDENCE SO FAR:\n${evidenceBlock}`;

  try {
    const resp = await routedChatCompletion("extract", {
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 700,
    });
    const parsed = parseJsonLoose<PlanOut>(llmContent(resp));
    if (!parsed) return { done: false, queries: hop === 0 ? [question] : [] };
    const queries = Array.isArray(parsed.queries)
      ? parsed.queries.filter((q) => typeof q === "string" && q.trim().length > 2).map((q) => q.trim())
      : [];
    return { done: !!parsed.done, queries, gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [] };
  } catch (e) {
    console.warn("[paige-deep-research] plan error:", (e as Error)?.message);
    return { done: false, queries: hop === 0 ? [question] : [] };
  }
}

// ── Entity-target detection (A1/A2) ─────────────────────────────────────────
// Pure, deterministic, runs ONCE before hop 0. Returns null for the general
// path (which is then byte-for-byte the pre-existing engine). Returns an
// EntityTarget only when the question is unambiguously ABOUT a specific business
// or person — a dossier request — so the enrichment fires narrowly and never
// hijacks a general how/why/compare question (A2 over-trigger guard).
interface EntityTarget {
  kind: EntityKind;
  name: string;
  seedSite: string | null;   // bare domain the caller anchored on, if any (A5 direct-site sweep)
  confidence: "high" | "medium" | "low";
}

// Framing that means "explain / compare / teach", never "profile this entity".
const GENERAL_FRAMING = /\b(how (?:do|does|to|can|should)|why|compare|versus|vs\.?|best practices?|pros and cons|difference between|explain|what is|what are|tutorial|guide to|examples? of)\b/i;

// Organisation trigger phrases (universal business vocabulary only — §2/§9 clean).
const ORG_TRIGGER = /\b(who (?:runs|owns|leads|founded)|leadership|executives?|org chart|organi[sz]ational chart|subsidiar(?:y|ies)|headquarters|contact info(?:rmation)?|profile of|dossier on|research (?:the )?(?:company|firm|business|organi[sz]ation)|background on|due diligence on|company overview)\b/i;

// Legal-entity / org suffix tokens (name + suffix ⇒ an organisation).
const ORG_SUFFIX = /\b([A-Z][A-Za-z&'.-]+(?:\s+[A-Z][A-Za-z&'.-]+){0,4})\s+(Inc|LLC|LLP|Ltd|GmbH|Corp|Co|Company|Group|Partners|Associates|Agency|Bank|Capital|Holdings|Industries|Ventures|Labs|Studios|Foundation|Institute|University|Consulting|Advisors)\.?\b/;

// Person triggers: honorific/title adjacent to a Proper-Case bigram, or an
// explicit "contact/reach/email/phone for <Name>".
const PERSON_TITLE = /\b(Mr|Mrs|Ms|Dr|Prof|CEO|CFO|COO|CTO|CMO|President|Founder|Co-?founder|Director|Chair(?:man|woman|person)?|Partner|Principal|Owner|Manager|Head)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/;
const PERSON_CONTACT = /\b(?:contact|reach|email|phone|call)\s+(?:info(?:rmation)?\s+)?(?:for|of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/;
const NAME_TITLE_SUFFIX = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+),?\s+(?:the\s+)?(CEO|CFO|COO|CTO|CMO|President|Founder|Co-?founder|Director|Chair(?:man|woman|person)?|Partner|Principal|Owner)\b/;

// Extract a bare domain / URL as the seed site (A5). Ignores obviously-generic
// hosts (search engines, encyclopedias) so they never become the anchor.
const SEED_STOP_HOSTS = new Set([
  "google.com", "bing.com", "duckduckgo.com", "wikipedia.org", "youtube.com",
]);
function extractSeedSite(question: string): string | null {
  const m = question.match(/\b((?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+)\b/i);
  if (!m) return null;
  let host = m[1].replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  const e = etld1(host);
  if (!e || SEED_STOP_HOSTS.has(e)) return null;
  // Must look like a real hostname (has a dot + a plausible TLD), not "e.g" etc.
  if (!/\.[a-z]{2,}$/.test(e)) return null;
  return e;
}

// Title-case a domain into a candidate entity name ("acme-partners.com" → "Acme Partners").
function nameFromDomain(site: string): string {
  const label = site.split(".")[0].replace(/[-_]+/g, " ").trim();
  return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

function detectEntityTarget(question: string, _domainHint: string): EntityTarget | null {
  // NOTE (A3/§4 clean-seam): `_domainHint` is intentionally IGNORED here. Detection
  // never branches on the opaque domain hint — vertical behavior belongs in the
  // calling surface (§2/§9), not in this universal detector.
  const q = question.trim();
  if (!q) return null;

  const seedSite = extractSeedSite(q);
  const hasGeneralFraming = GENERAL_FRAMING.test(q);

  // Person path (checked before org so "email for Jane Smith" wins over a stray suffix).
  const pm = PERSON_TITLE.exec(q) || PERSON_CONTACT.exec(q) || NAME_TITLE_SUFFIX.exec(q);
  if (pm) {
    // The captured name group differs by pattern; grab the Proper-Case bigram.
    const name = (pm[2] && /^[A-Z][a-z]+/.test(pm[2]) ? pm[2] : pm[1] && /^[A-Z][a-z]+/.test(pm[1]) ? pm[1] : "").trim();
    if (name && name.split(/\s+/).length >= 2) {
      return { kind: "person", name, seedSite, confidence: "high" };
    }
  }

  const orgTriggered = ORG_TRIGGER.test(q);
  const suffixMatch = ORG_SUFFIX.exec(q);

  if (suffixMatch) {
    const name = `${suffixMatch[1]} ${suffixMatch[2]}`.trim();
    return { kind: "organization", name, seedSite, confidence: "high" };
  }

  if (orgTriggered) {
    // A trigger phrase present ⇒ dossier intent even without a legal suffix.
    // Derive the name from the seed site if present, else the leading Proper-Case
    // run in the question.
    let name = seedSite ? nameFromDomain(seedSite) : "";
    if (!name) {
      const proper = q.match(/\b([A-Z][A-Za-z&'.-]+(?:\s+[A-Z][A-Za-z&'.-]+){0,4})\b/);
      name = proper ? proper[1].trim() : "";
    }
    if (name) return { kind: "organization", name, seedSite, confidence: seedSite ? "high" : "medium" };
  }

  // A2 — over-trigger guard. A bare seed site with NO general framing is a
  // profile request ("acme.com", "research acme.io"). A seed site WITH general
  // framing ("how does stripe.com pricing work") is NOT — fall through to null.
  if (seedSite && !hasGeneralFraming) {
    return { kind: "organization", name: nameFromDomain(seedSite), seedSite, confidence: "medium" };
  }

  // Everything else — how/why/compare/explain, bare proper nouns with no trigger,
  // no seed site — is the untouched general path.
  return null;
}

// ── Universal facet vocabulary (A4) ─────────────────────────────────────────
// Business/entity intelligence facets ONLY — identity, leadership, structure,
// offerings, locations/contacts, key people. ZERO vertical or finance words.
// `{name}` / `{site}` are interpolated per target.
type Facet =
  | "identity" | "leadership" | "structure" | "offerings" | "locations_contacts" | "key_people";

const UNIVERSAL_FACETS: Record<EntityKind, Record<Facet, string[]>> = {
  organization: {
    identity:            ['{name} official website about', '{name} company overview'],
    leadership:          ['{name} leadership team executives', '{name} founder ownership management'],
    structure:           ['{name} divisions business units subsidiaries', '{name} organizational structure'],
    offerings:           ['{name} products services offerings', '{name} what they do solutions'],
    locations_contacts:  ['{name} headquarters address office location', '{name} contact phone email'],
    key_people:          ['{name} executives directors leadership profiles', '{name} team staff members'],
  },
  person: {
    identity:            ['{name} biography profile background', '{name} who is professional'],
    leadership:          ['{name} title role position company'],
    structure:           ['{name} company organization affiliation'],
    offerings:           ['{name} work expertise services'],
    locations_contacts:  ['{name} contact email phone', '{name} office location based'],
    key_people:          ['{name} colleagues team associates'],
  },
};

// A7 — DOMAIN_FLAVORS injection MECHANISM. This registry is intentionally EMPTY
// in the engine: no vertical/finance flavor pack is hard-coded here (§2/§9). An
// opt-in caller supplies its own facet templates via req.flavor_facets, which the
// planner appends after the universal facets. Keys map an opaque `domain` hint to
// caller-registered templates; the engine ships NONE, so the §2 grep stays empty.
const DOMAIN_FLAVORS: Record<string, string[]> = {};

const interp = (tpl: string, name: string, site: string | null): string =>
  tpl.replace(/\{name\}/g, name).replace(/\{site\}/g, site ?? name);

// Which facets are gathered on each hop of the dossier schedule (A6).
const HOP_FACETS: Record<number, Facet[]> = {
  0: ["identity", "leadership", "structure", "offerings"],
  1: ["locations_contacts", "key_people"],
};

// Candidate person-name extraction from already-fetched page bodies. Deterministic,
// no LLM. A Proper-Case bigram sitting within ~240 chars of a role/title token,
// used ONLY to steer gap-check contact queries (never emitted as a fact). People
// facts are produced solely by the gated synthesis path.
const ROLE_WORDS = /\b(CEO|CFO|COO|CTO|CMO|President|Founder|Co-?founder|Director|Chair(?:man|woman|person)?|Partner|Principal|Owner|Manager|Head|VP|Vice President|Lead|Officer)\b/i;
function extractCandidatePeople(sources: SourceRec[]): { name: string; hasContact: boolean }[] {
  const out = new Map<string, boolean>();
  const nameRe = /\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\b/g;
  for (const s of sources) {
    const text = `${s.title}\n${s.snippet}\n${s.content}`;
    if (!text.trim()) continue;
    let m: RegExpExecArray | null;
    nameRe.lastIndex = 0;
    while ((m = nameRe.exec(text)) !== null) {
      const name = m[1].replace(/\s+/g, " ").trim();
      if (name.split(/\s+/).length < 2) continue;
      const pos = m.index;
      const window = text.slice(Math.max(0, pos - 240), pos + 240);
      if (!ROLE_WORDS.test(window)) continue;
      const contactWindow = window.toLowerCase();
      const hasContact = phonesIn(window).length > 0 || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(contactWindow);
      out.set(name, (out.get(name) ?? false) || hasContact);
      if (out.size >= 12) break;
    }
    if (out.size >= 12) break;
  }
  return Array.from(out.entries()).map(([name, hasContact]) => ({ name, hasContact }));
}

// ── Dossier hop planner (A4–A6) — pure, deterministic, no LLM round-trip ─────
// Replaces the free-form planHop in dossier mode. Facet-driven, {name}/{site}
// interpolated, one query per facet template, capped by the per-hop budget.
// Hop0: identity+leadership+structure+offerings, with a direct-site sweep (A5).
// Hop1: locations_contacts+key_people + ≤2 GAP-CHECK per-person contact queries.
// Hop2: GAP-CHECK only (contact-less people, HQ/structure corroboration).
// Hop3: contact-resolution — fires ONLY if ≥1 named person still lacks contact.
interface EntityPlan { queries: string[]; done: boolean }
function planEntityHop(
  target: EntityTarget,
  hop: number,
  sources: SourceRec[],
  flavorFacets: string[],
  perHopCap: number,
): EntityPlan {
  const { name, seedSite } = target;
  const table = UNIVERSAL_FACETS[target.kind];
  const queries: string[] = [];
  const push = (q: string) => { const t = q.trim(); if (t && !queries.includes(t)) queries.push(t); };

  if (hop === 0 || hop === 1) {
    const facets = HOP_FACETS[hop];
    // A5 direct-site sweep: on hop 0, read the entity's OWN pages first.
    if (hop === 0 && seedSite) {
      for (const f of facets) for (const tpl of table[f]) push(`site:${seedSite} ${interp(tpl, name, seedSite)}`);
    }
    for (const f of facets) for (const tpl of table[f]) push(interp(tpl, name, seedSite));

    // A7 flavor injection — caller-supplied templates appended after universals,
    // deduped by interpolated template. No vertical wording lives in this file.
    if (hop === 0) {
      for (const tpl of flavorFacets) {
        if (typeof tpl === "string" && tpl.trim()) push(interp(tpl, name, seedSite));
      }
    }

    // Hop1 gap-check: up to 2 targeted per-person contact queries for named people
    // discovered in hop-0 content who still lack a contact vector.
    if (hop === 1) {
      const need = extractCandidatePeople(sources).filter((p) => !p.hasContact).slice(0, 2);
      for (const p of need) push(`"${p.name}" ${name} email contact`);
    }
    return { queries: queries.slice(0, perHopCap), done: false };
  }

  if (hop === 2) {
    // GAP-CHECK only: contact-less named people + HQ / structure corroboration.
    const need = extractCandidatePeople(sources).filter((p) => !p.hasContact).slice(0, 2);
    for (const p of need) push(`"${p.name}" ${name} contact information`);
    push(interp('{name} headquarters address', name, seedSite));
    push(interp('{name} divisions subsidiaries overview', name, seedSite));
    return { queries: queries.slice(0, perHopCap), done: queries.length === 0 };
  }

  // Hop3 (dossier-only) — contact-resolution. Runs ONLY if a named person still
  // has no contact vector after Hop2; otherwise the loop stops here.
  const stillNeed = extractCandidatePeople(sources).filter((p) => !p.hasContact).slice(0, 2);
  if (stillNeed.length === 0) return { queries: [], done: true };
  for (const p of stillNeed) push(`"${p.name}" email address phone ${name}`);
  return { queries: queries.slice(0, perHopCap), done: false };
}

// ── SYNTHESIS (A3d/A5) — the ONE Claude reasoning call ──────────────────────
// jobKind "doc_draft" resolves to the Claude reasoning tier (claude-sonnet-5) and is NEVER
// routed to an open model (only CHEAP_KINDS are). This is the single sensitive call.
interface RawFinding {
  summary: string;
  citations: number[];
  name?: string | null;
  website?: string | null;
  phone?: string | null;
  values?: string[];
}
// Per-field-cited raw profile records (C2). Emitted in the SAME doc_draft call
// as findings (A9). Every field carries its OWN citations; the deterministic
// validateProfile gate proves each field against ONLY its own cited sources.
interface RawPerson {
  name?: string | null;            name_citations?: number[];
  title?: string | null;           title_citations?: number[];
  email?: string | null;           email_citations?: number[];
  phone?: string | null;           phone_citations?: number[];
  profile_url?: string | null;     profile_url_citations?: number[];
  division?: string | null;        division_citations?: number[];
}
interface RawDivision { name?: string | null; description?: string | null; citations?: number[] }
interface RawOffering { name?: string | null; detail?: string | null; citations?: number[] }
interface RawLocation {
  label?: string | null;
  address?: string | null;         address_citations?: number[];
  locality?: string | null;        locality_citations?: number[];
  phone?: string | null;           phone_citations?: number[];
  site?: string | null;            site_citations?: number[];
  citations?: number[];
}
interface SynthOut {
  findings: RawFinding[];
  summary?: string;
  people?: RawPerson[];
  divisions?: RawDivision[];
  offerings?: RawOffering[];
  locations?: RawLocation[];
}

async function synthesize(
  question: string,
  domainHint: string,
  citable: SourceRec[],
  entityTarget: EntityTarget | null,
): Promise<SynthOut | null> {
  // Sources passed exactly as subagent-financial-research's `[n] title\nsnippet\nurl` block,
  // generalised: include the fetched body excerpt when we have it.
  const ctx = citable.map((s) => {
    const body = s.content ? `\n${s.content.slice(0, 1500)}` : "";
    return `[${s.index}] ${s.title}\n${s.snippet}${body}\n${s.url}`;
  }).join("\n\n");

  let sys =
    "You are a rigorous research synthesizer. State a fact ONLY if it appears in the fetched " +
    "text of a specific SOURCE, and tag that fact with the source's [n]. Use NO prior " +
    "knowledge, memory, or assumptions. A factual claim is any name, phone number, website/URL, " +
    "figure, threshold, date, or statistic. If a field is not present in a source, set it to " +
    "null — never invent it. Never emit a name that does not appear verbatim in a cited source. " +
    "For any figure or requirement, append \"as listed on [n], verify directly — terms change.\" " +
    'Output ONLY JSON: {"findings":[{"summary":string,"citations":number[],"name":string|null,' +
    '"website":string|null,"phone":string|null,"values":string[]}]}. `citations` must list the ' +
    "[n] indices that support the finding and must be non-empty. `name`/`website`/`phone` are for " +
    "entity findings (leave null for prose findings). `values` holds any figures/thresholds/dates " +
    "quoted verbatim from a cited source. No prose outside the JSON.";

  // ── C1 — dossier synth extension (same single doc_draft call, A9) ──────────
  // Emit `people[]`/`divisions[]`/`offerings[]`/`locations[]` as ATOMIC arrays
  // distinct from findings, each field carrying its OWN citations. The
  // deterministic gate re-checks everything; this only asks the model to be
  // atomic and honest so the gate has clean input.
  if (entityTarget) {
    sys +=
      "\n\nThis is an ENTITY DOSSIER. In ADDITION to findings, extract atomic structured records " +
      "about the target entity, each field carrying its OWN citations array. Rules, absolute:\n" +
      "• Copy each person's name VERBATIM from the source. `name_citations` = every [n] where that " +
      "exact name string appears.\n" +
      "• Give a `title` ONLY if the SAME [n] shows that title within about one sentence of the name; " +
      "`title_citations` must be a subset of that name's citations. NEVER pair a name from one source " +
      "with a title or contact from another source.\n" +
      "• Every email, phone, and street address MUST appear VERBATIM in a cited source. Never guess " +
      "`first.last@domain`, never infer or format a phone number, never recall an address from memory. " +
      "Put each in its own field with its own citations ([email_citations], [phone_citations], " +
      "[address_citations]).\n" +
      "• Any field not present in the naming source → null. A profile with 3 real cited contacts is " +
      "correct; 10 guessed contacts is a FAILURE.\n" +
      'Extend the JSON with: "summary":string (1–3 grounded sentences), ' +
      '"people":[{"name","name_citations":[],"title","title_citations":[],"email","email_citations":[],' +
      '"phone","phone_citations":[],"profile_url","profile_url_citations":[],"division","division_citations":[]}], ' +
      '"divisions":[{"name","description","citations":[]}], "offerings":[{"name","detail","citations":[]}], ' +
      '"locations":[{"label","address","address_citations":[],"locality","locality_citations":[],' +
      '"phone","phone_citations":[],"site","site_citations":[],"citations":[]}]. ' +
      "Leave any array empty if nothing is grounded. No prose outside the JSON.";
  }

  const goalTag = entityTarget
    ? `RESEARCH GOAL: Build a cited dossier on ${entityTarget.kind === "person" ? "the person" : "the entity"} "${entityTarget.name}".\nOriginal question: ${question}\n`
    : `RESEARCH GOAL: ${question}\n`;
  const user =
    goalTag +
    (domainHint ? `TOPIC HINT: ${domainHint}\n` : "") +
    `\nSOURCES:\n${ctx}\n\nWrite grounded findings. Every finding MUST carry at least one [n] citation.` +
    (entityTarget ? " Also emit the atomic dossier records per the rules above." : "");

  try {
    const resp = await routedChatCompletion("doc_draft", {
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: entityTarget ? 3200 : 2400,
    });
    const parsed = parseJsonLoose<SynthOut>(llmContent(resp));
    if (!parsed || !Array.isArray(parsed.findings)) return { findings: [] };
    return parsed;
  } catch (e) {
    console.warn("[paige-deep-research] synthesis error:", (e as Error)?.message);
    return null;
  }
}

// ── Field-level verification helpers (A5) ───────────────────────────────────
function phonesIn(text: string): string[] {
  const raw = text.match(/(?:\+?\d[\s().-]?){9,15}\d/g) ?? [];
  return raw.map((p) => p.replace(/\D/g, "")).filter((d) => d.length >= 10 && d.length <= 15);
}
function digitsOnly(s: string): string { return s.replace(/\D/g, ""); }

// ── Deterministic post-validation + bind (A5) ───────────────────────────────
// Runs AFTER ranking. `citable` = non-excluded sources with their final `index`.
function validateAndBind(
  synth: SynthOut,
  citable: SourceRec[],
  strict: boolean,
): Finding[] {
  const byIndex = new Map<number, SourceRec>();
  for (const s of citable) byIndex.set(s.index, s);

  const out: Finding[] = [];
  for (const rf of synth.findings ?? []) {
    // Resolve citations to real, non-excluded sources; drop the rest.
    const cites = Array.from(new Set((rf.citations ?? []).filter((c) => byIndex.has(c))));
    if (cites.length === 0) continue; // empty/unresolvable citations are ILLEGAL → drop

    const cited = cites.map((c) => byIndex.get(c)!);
    const citedText = cited.map((s) => `${s.snippet}\n${s.content}`).join("\n").toLowerCase();
    const citedHosts = new Set(cited.map((s) => s.host));
    const unverified: string[] = [];

    // (1) Name check — token-set of the name must appear in a cited source. Absent → drop record.
    const name = (rf.name ?? "").trim();
    if (name) {
      const nameTokens = tokens(name);
      const present = nameTokens.length > 0 &&
        nameTokens.every((t) => citedText.includes(t));
      if (!present) continue; // name not grounded anywhere it was cited → drop whole record
    }

    // (2) Website check — emitted host must equal/subdomain a cited host (URL or body link).
    let website = (rf.website ?? "").trim() || null;
    if (website) {
      const wHost = hostOf(website.startsWith("http") ? website : `https://${website}`);
      const vouched = !!wHost && (citedHosts.has(wHost) || citedText.includes(wHost));
      if (!vouched) { website = null; unverified.push("website"); }
    }

    // (3) Phone check — emitted phone must match a phone in the cited snippets/bodies.
    let phone = (rf.phone ?? "").trim() || null;
    if (phone) {
      const want = digitsOnly(phone);
      const pool = phonesIn(citedText);
      const matched = want.length >= 10 && pool.some((p) => p.endsWith(want.slice(-10)));
      if (!matched) { phone = null; unverified.push("phone"); } // highest-harm error — never surface
    }

    // (4) Numeric / figure check — each value string must appear in a cited source.
    const values: string[] = Array.isArray(rf.values) ? rf.values : [];
    const keptValues: string[] = [];
    for (const v of values) {
      const vs = String(v).trim();
      if (!vs) continue;
      const nums = vs.match(/[\d][\d,.]*/g) ?? [];
      const grounded = nums.length === 0
        ? citedText.includes(vs.toLowerCase())
        : nums.every((n) => citedText.includes(n.toLowerCase()));
      if (grounded) keptValues.push(vs);
      else unverified.push(`value:${vs}`); // ungrounded figure dropped, never a bare fabricated range
    }

    // Emit rule: an ENTITY record (has a name) survives only if name passed AND, when a contact
    // vector was claimed, ≥1 vector (website OR phone) survived. Prose findings (no name) pass
    // on citations alone.
    const claimedContact = !!((rf.website ?? "").trim() || (rf.phone ?? "").trim());
    const survivingContact = !!(website || phone);
    if (name && claimedContact && !survivingContact) {
      if (strict) continue; // drop records where everything-but-name failed
      unverified.push("contact");
    }

    // Confidence derived deterministically from the surviving cites (A5).
    const confidence = deriveConfidence(cited);

    out.push({
      text: composeText(rf.summary, name, website, phone, keptValues),
      citations: cites,
      confidence,
      ...(unverified.length ? { unverifiedFields: unverified } : {}),
      // Structured, GATE-SURVIVED specifics. Consumers read these directly and
      // must never scrape `text` — only what appears here passed validation.
      ...(name ? { name } : {}),
      ...(website ? { website } : {}),
      ...(phone ? { phone } : {}),
      ...(keptValues.length ? { values: keptValues } : {}),
    });
  }
  return out;
}

// Confidence: corroboration + authority of the surviving cites.
function deriveConfidence(cited: SourceRec[]): "high" | "medium" | "low" {
  const distinctHosts = new Set(cited.map((s) => s.host)).size;
  const hasHighAuthority = cited.some((s) => s.tier === "T1" || s.tier === "T2");
  const corroborated = distinctHosts >= 2 || cited.some((s) => s.corroboration >= 1.0);
  if (hasHighAuthority && corroborated) return "high";
  // A single AUTHORITATIVE source (T1 .gov/regulator, T2 established press) is
  // "medium" — not "low/Unverified" — so a genuinely reliable lone source isn't
  // under-claimed. Only low-tier or truly uncorroborated general web is "low".
  if (hasHighAuthority) return "medium";
  if (distinctHosts >= 2) return "medium";
  return "low";
}

// Compose the finding text from ONLY the surviving, validated specifics.
function composeText(
  summary: string,
  name: string,
  website: string | null,
  phone: string | null,
  values: string[],
): string {
  const base = (summary ?? "").trim();
  const bits: string[] = [];
  if (website) bits.push(`website: ${website}`);
  if (phone) bits.push(`phone: ${phone}`);
  if (values.length) bits.push(values.join("; "));
  const detail = bits.length ? ` (${bits.join(" · ")})` : "";
  if (name) return `${name}${base ? ` — ${base}` : ""}${detail}`.trim();
  return `${base}${detail}`.trim();
}

// ── Deterministic profile validation (Section C) ────────────────────────────
// Runs AFTER validateAndBind, over the SAME byIndex map of non-excluded ranked
// sources. Every field is proven against the concatenated snippet+content of
// ITS OWN citations only. The LLM never writes an unverified_note — those are
// emitted deterministically here, once per drop. Nothing survives that is not
// quoted from a real cited source (§13).
const FREE_MAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com",
  "proton.me", "protonmail.com", "live.com", "msn.com",
]);
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;
const SUFFIX_TOKENS =
  "Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Suite|Ste|" +
  "Floor|Fl|Plaza|Parkway|Pkwy|Highway|Hwy|Place|Pl|Terrace|Ter|Circle|Cir|Square|Sq";
const SUFFIX_RE = new RegExp(`\\b(?:${SUFFIX_TOKENS})\\b`, "i");

// Short-token variant: keeps 2–3 char tokens (names/titles like "Ng", "CEO").
function shortTokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z]+/g) ?? []).filter((t) => t.length >= 2 && !STOP.has(t));
}

function resolveCites(cites: number[] | undefined, byIndex: Map<number, SourceRec>): number[] {
  return Array.from(new Set((cites ?? []).filter((c) => byIndex.has(c))));
}
function textOfCites(cites: number[], byIndex: Map<number, SourceRec>): string {
  return cites.map((c) => byIndex.get(c)!).map((s) => `${s.snippet}\n${s.content}`).join("\n").toLowerCase();
}
function normalizeSpace(s: string): string { return s.toLowerCase().replace(/\s+/g, " ").trim(); }

// All tokens must occur within a `window`-char span anchored on the first token.
function tokensWithinWindow(text: string, toks: string[], window: number): boolean {
  if (toks.length === 0) return false;
  const first = toks[0];
  let from = 0;
  for (;;) {
    const p = text.indexOf(first, from);
    if (p < 0) return false;
    const slice = text.slice(Math.max(0, p - window), p + window);
    if (toks.every((t) => slice.includes(t))) return true;
    from = p + 1;
  }
}

function reliabilityLabel(conf: "high" | "medium" | "low"): string {
  if (conf === "high") return "Corroborated";
  if (conf === "medium") return "Single authoritative source";
  return "Single low-tier source — treat as a lead";
}

// C4 — the highest-risk gate. Every person field proven against ITS OWN cites.
function bindPerson(
  rp: RawPerson,
  byIndex: Map<number, SourceRec>,
  notes: string[],
): { person: ProfilePerson | null; dropped: number } {
  const rawName = (rp.name ?? "").trim();
  const nameCites = resolveCites(rp.name_citations, byIndex);
  const nToks = shortTokens(rawName);

  // NAME gate — ≥2 tokens, ≥1 cite, every token present, 240-char adjacency.
  if (nToks.length < 2 || nameCites.length === 0) {
    if (rawName) notes.push(`Dropped person "${rawName}" — name not grounded in a cited source.`);
    return { person: null, dropped: 0 };
  }
  const nameText = textOfCites(nameCites, byIndex);
  if (!nToks.every((t) => nameText.includes(t))) {
    notes.push(`Dropped person "${rawName}" — name tokens not all present in its cited source.`);
    return { person: null, dropped: 0 };
  }
  if (!tokensWithinWindow(nameText, nToks, 240)) {
    notes.push(`Dropped person "${rawName}" — name tokens not adjacent within one passage (possible split-source fabrication).`);
    return { person: null, dropped: 0 };
  }

  const nameCiteSet = new Set(nameCites);
  const unverified: string[] = [];
  let dropped = 0;

  // TITLE gate — non-empty subset of name cites + 240-char co-occurrence.
  let title: string | undefined;
  let titleCitations: number[] = [];
  const rawTitle = (rp.title ?? "").trim();
  if (rawTitle) {
    const tCites = resolveCites(rp.title_citations, byIndex);
    if (tCites.length > 0 && tCites.every((c) => nameCiteSet.has(c))) {
      const tText = textOfCites(tCites, byIndex);
      const tToks = shortTokens(rawTitle);
      if (tToks.length > 0 && tToks.every((t) => tText.includes(t)) &&
          tokensWithinWindow(tText, [nToks[0], ...tToks], 240)) {
        title = rawTitle; titleCitations = tCites;
      }
    }
    if (!title) { unverified.push("title"); dropped++; }
  }

  // DIVISION gate — same discipline; fail ⇒ Unassigned bucket (person kept).
  let division: string | undefined;
  let divisionCitations: number[] = [];
  const rawDiv = (rp.division ?? "").trim();
  if (rawDiv) {
    const dCites = resolveCites(rp.division_citations, byIndex);
    if (dCites.length > 0 && dCites.every((c) => nameCiteSet.has(c))) {
      const dText = textOfCites(dCites, byIndex);
      const dToks = shortTokens(rawDiv);
      if (dToks.length > 0 && dToks.every((t) => dText.includes(t)) &&
          tokensWithinWindow(dText, [nToks[0], ...dToks], 240)) {
        division = rawDiv; divisionCitations = dCites;
      }
    }
    if (!division) { unverified.push("division"); dropped++; }
  }

  // Contamination union — contact cites must be a subset of name+title+division cites.
  const unionSet = new Set<number>([...nameCites, ...titleCitations, ...divisionCitations]);

  // EMAIL gate — regex-valid, verbatim, contamination-subset, host-vouched.
  let email: string | undefined;
  let emailCitations: number[] = [];
  const emailFlags: string[] = [];
  const rawEmail = (rp.email ?? "").trim().toLowerCase();
  if (rawEmail) {
    const eCites = resolveCites(rp.email_citations, byIndex);
    const subsetOk = eCites.length > 0 && eCites.every((c) => unionSet.has(c));
    if (EMAIL_RE.test(rawEmail) && subsetOk) {
      const eText = textOfCites(eCites, byIndex);
      const eHost = etld1((rawEmail.split("@")[1] ?? ""));
      if (eText.includes(rawEmail) && eHost) {
        const citedHosts = new Set(eCites.map((c) => byIndex.get(c)!.host));
        const hostOk = citedHosts.has(eHost) || nameText.includes(eHost) || FREE_MAIL.has(eHost);
        if (hostOk) {
          email = rawEmail; emailCitations = eCites;
          if (FREE_MAIL.has(eHost)) emailFlags.push("personal-domain");
        }
      }
    }
    if (!email) {
      unverified.push("email"); dropped++;
      notes.push(`Dropped email for "${rawName}" — not verbatim in a source cited for this person.`);
    }
  }

  // PHONE gate — last-10 match scoped to phone cites, same contamination guard.
  let phone: string | undefined;
  let phoneCitations: number[] = [];
  const rawPhone = (rp.phone ?? "").trim();
  if (rawPhone) {
    const pCites = resolveCites(rp.phone_citations, byIndex);
    const subsetOk = pCites.length > 0 && pCites.every((c) => unionSet.has(c));
    const want = digitsOnly(rawPhone);
    if (subsetOk && want.length >= 10 &&
        phonesIn(textOfCites(pCites, byIndex)).some((p) => p.endsWith(want.slice(-10)))) {
      phone = rawPhone; phoneCitations = pCites;
    }
    if (!phone) {
      unverified.push("phone"); dropped++;
      notes.push(`Dropped phone for "${rawName}" — no matching number in cited sources.`);
    }
  }

  // profile_url — host equals/subdomains a cited host OR URL string in cited text.
  let profileUrl: string | undefined;
  let profileUrlCitations: number[] = [];
  const rawUrl = (rp.profile_url ?? "").trim();
  if (rawUrl) {
    const uCites = resolveCites(rp.profile_url_citations, byIndex);
    if (uCites.length > 0) {
      const uText = textOfCites(uCites, byIndex);
      const uHost = hostOf(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
      const citedHosts = new Set(uCites.map((c) => byIndex.get(c)!.host));
      if (uHost && (citedHosts.has(uHost) || uText.includes(rawUrl.toLowerCase()))) {
        profileUrl = rawUrl; profileUrlCitations = uCites;
      }
    }
    if (!profileUrl) { unverified.push("profile_url"); dropped++; }
  }

  const hasContact = !!(email || phone || profileUrl);
  const nameRecs = nameCites.map((c) => byIndex.get(c)!);
  const confidence = deriveConfidence(nameRecs);

  const person: ProfilePerson = {
    name: rawName,
    name_citations: nameCites,
    ...(title ? { title } : {}),
    title_citations: titleCitations,
    ...(hasContact
      ? {
          contact: {
            ...(email ? { email } : {}), email_citations: emailCitations,
            ...(phone ? { phone } : {}), phone_citations: phoneCitations,
            ...(profileUrl ? { profile_url: profileUrl } : {}), profile_url_citations: profileUrlCitations,
          },
        }
      : {}),
    ...(division ? { division } : {}),
    division_citations: divisionCitations,
    contact_status: hasContact ? "verified" : "not_public",
    confidence,
    reliability_label: reliabilityLabel(confidence),
    unverified_fields: unverified,
    ...(emailFlags.length ? { email_flags: emailFlags } : {}),
  };
  return { person, dropped };
}

// C5 — address emitted only as a contiguous, cited number-through-suffix span.
function bindAddress(
  rawAddr: string,
  addrCites: number[] | undefined,
  byIndex: Map<number, SourceRec>,
): { address?: string; citations: number[]; ok: boolean } {
  const addr = (rawAddr ?? "").trim();
  const cites = resolveCites(addrCites, byIndex);
  if (!addr || cites.length === 0) return { citations: cites, ok: false };
  if (!/^\s*\d+/.test(addr)) return { citations: cites, ok: false };       // (1) leading number
  if (!SUFFIX_RE.test(addr)) return { citations: cites, ok: false };       // (2) recognized suffix
  const srcNorm = normalizeSpace(
    cites.map((c) => byIndex.get(c)!).map((s) => `${s.snippet} ${s.content}`).join(" "),
  );
  const m = addr.match(new RegExp(`\\d+[^\\n,]*?\\b(?:${SUFFIX_TOKENS})\\b\\.?`, "i"));
  const span = m ? m[0] : addr;
  if (!srcNorm.includes(normalizeSpace(span))) return { citations: cites, ok: false }; // (3) contiguous
  return { address: span.trim(), citations: cites, ok: true };
}

// C6 — division / offering / location record gates.
function bindDivision(rd: RawDivision, byIndex: Map<number, SourceRec>): ProfileDivision | null {
  const name = (rd.name ?? "").trim();
  const cites = resolveCites(rd.citations, byIndex);
  if (!name || cites.length === 0) return null;
  const text = textOfCites(cites, byIndex);
  const nToks = shortTokens(name);
  if (nToks.length === 0 || !nToks.every((t) => text.includes(t))) return null;
  let description: string | undefined;
  const rawDesc = (rd.description ?? "").trim();
  if (rawDesc && shortTokens(rawDesc).some((t) => text.includes(t))) description = rawDesc;
  return { name, citations: cites, ...(description ? { description } : {}) };
}
function bindOffering(ro: RawOffering, byIndex: Map<number, SourceRec>): ProfileOffering | null {
  const name = (ro.name ?? "").trim();
  const cites = resolveCites(ro.citations, byIndex);
  if (!name || cites.length === 0) return null;
  const text = textOfCites(cites, byIndex);
  const nToks = shortTokens(name);
  if (nToks.length === 0 || !nToks.every((t) => text.includes(t))) return null;
  let detail: string | undefined;
  const rawDetail = (ro.detail ?? "").trim();
  if (rawDetail && shortTokens(rawDetail).some((t) => text.includes(t))) detail = rawDetail;
  return { name, citations: cites, ...(detail ? { detail } : {}) };
}
function bindLocation(rl: RawLocation, byIndex: Map<number, SourceRec>): ProfileLocation | null {
  const cites = resolveCites(rl.citations, byIndex);
  const addr = bindAddress((rl.address ?? "").trim(), rl.address_citations, byIndex);

  let locality: string | undefined;
  let localityCitations: number[] = [];
  const rawLoc = (rl.locality ?? "").trim();
  if (rawLoc) {
    const lCites = resolveCites(rl.locality_citations, byIndex);
    if (lCites.length > 0) {
      const lNorm = normalizeSpace(
        lCites.map((c) => byIndex.get(c)!).map((s) => `${s.snippet} ${s.content}`).join(" "),
      );
      if (lNorm.includes(normalizeSpace(rawLoc))) { locality = rawLoc; localityCitations = lCites; }
    }
  }

  let phone: string | undefined;
  let phoneCitations: number[] = [];
  const rawPhone = (rl.phone ?? "").trim();
  if (rawPhone) {
    const pCites = resolveCites(rl.phone_citations, byIndex);
    const want = digitsOnly(rawPhone);
    if (pCites.length > 0 && want.length >= 10 &&
        phonesIn(textOfCites(pCites, byIndex)).some((p) => p.endsWith(want.slice(-10)))) {
      phone = rawPhone; phoneCitations = pCites;
    }
  }

  let site: string | undefined;
  let siteCitations: number[] = [];
  const rawSite = (rl.site ?? "").trim();
  if (rawSite) {
    const sCites = resolveCites(rl.site_citations, byIndex);
    if (sCites.length > 0) {
      const sHost = hostOf(rawSite.startsWith("http") ? rawSite : `https://${rawSite}`);
      const citedHosts = new Set(sCites.map((c) => byIndex.get(c)!.host));
      const sText = textOfCites(sCites, byIndex);
      if (sHost && (citedHosts.has(sHost) || sText.includes(sHost))) { site = rawSite; siteCitations = sCites; }
    }
  }

  if (!addr.ok && !locality && !phone && !site) return null; // nothing survived → drop location
  return {
    ...(rl.label ? { label: String(rl.label).trim() } : {}),
    ...(addr.ok && addr.address ? { address: addr.address } : {}),
    address_citations: addr.ok ? addr.citations : [],
    ...(locality ? { locality } : {}),
    locality_citations: localityCitations,
    ...(phone ? { phone } : {}),
    phone_citations: phoneCitations,
    ...(site ? { site } : {}),
    site_citations: siteCitations,
    citations: cites.length ? cites : addr.citations,
  };
}

function sectionStatus<T>(items: T[], hadDrops: boolean): "verified" | "partial" | "not_found" {
  if (items.length === 0) return "not_found";
  return hadDrops ? "partial" : "verified";
}

// C10 — headline from the deterministic counts + first honesty notes.
function buildHeadline(
  cov: EntityProfile["coverage"],
  notes: string[],
): string {
  const parts: string[] = ["entity"];
  if (cov.divisions_found) parts.push(`${cov.divisions_found} division${cov.divisions_found === 1 ? "" : "s"}`);
  if (cov.people_found) {
    parts.push(`${cov.people_found} ${cov.people_found === 1 ? "person" : "people"} (${cov.people_with_verified_contact} with direct contact)`);
  }
  const verified = `Verified: ${parts.join(" + ")}.`;
  const gaps = notes.slice(0, 3).join(" ");
  return gaps ? `${verified} Could not verify: ${gaps}` : verified;
}

// C3/C7-C11 — orchestrator. Returns null (emit rule C11) unless ≥1 typed item survived.
function validateProfile(
  raw: SynthOut,
  citable: SourceRec[],
  rankedAll: SourceRec[],
  target: EntityTarget,
  findings: Finding[],
  readsDone: number,
): EntityProfile | null {
  const byIndex = new Map<number, SourceRec>();
  for (const s of citable) byIndex.set(s.index, s);

  const notes: string[] = [];
  let droppedFields = 0;

  // PEOPLE
  const people: ProfilePerson[] = [];
  let peopleDrops = false;
  for (const rp of raw.people ?? []) {
    const { person, dropped } = bindPerson(rp, byIndex, notes);
    droppedFields += dropped;
    if (dropped > 0) peopleDrops = true;
    if (person) {
      if (person.unverified_fields.length || person.contact_status === "not_public") peopleDrops = true;
      people.push(person);
    } else {
      peopleDrops = true;
    }
  }

  // DIVISIONS / OFFERINGS
  const divisions: ProfileDivision[] = [];
  let divDrops = false;
  for (const rd of raw.divisions ?? []) {
    const d = bindDivision(rd, byIndex);
    if (d) divisions.push(d); else divDrops = true;
  }
  const offerings: ProfileOffering[] = [];
  let offDrops = false;
  for (const ro of raw.offerings ?? []) {
    const o = bindOffering(ro, byIndex);
    if (o) offerings.push(o); else offDrops = true;
  }

  // LOCATIONS
  const locations: ProfileLocation[] = [];
  let locDrops = false;
  let anyAddress = false;
  for (const rl of raw.locations ?? []) {
    const l = bindLocation(rl, byIndex);
    if (l) { locations.push(l); if (l.address) anyAddress = true; } else locDrops = true;
  }

  // C11 emit rule — nothing typed survived ⇒ omit profile, fall back to findings.
  if (people.length === 0 && divisions.length === 0 && offerings.length === 0 && locations.length === 0) {
    return null;
  }

  // C8 — deterministic honest-coverage notes (the LLM never writes these).
  const pagesFetched = readsDone > 0 || rankedAll.some((s) => s.read);
  if (people.length === 0 && pagesFetched) {
    notes.push("No individual people could be verified against the sources retrieved. Any names seen could not be confirmed on a cited page.");
  }
  if (people.length > 0 && people.every((p) => p.contact_status === "not_public")) {
    notes.push("No direct executive contacts were publicly listed. Names and titles are shown; use the organization's main channels below.");
  }
  if (locations.length > 0 && !anyAddress) {
    notes.push("No street address was verifiable on a cited page. Only a stated city/region is shown.");
  }
  const TEAM_PAGE = /(about|team|leadership|management|people|staff|board|our-|company|contact|executives?)/i;
  const sawTeamPage = rankedAll.some((s) => TEAM_PAGE.test(s.url) || TEAM_PAGE.test(s.title));
  if (!sawTeamPage) {
    notes.push("A leadership or team page was not found; the people section may be incomplete.");
  }
  if (droppedFields > 0) {
    notes.push(`${droppedFields} proposed contact detail${droppedFields === 1 ? "" : "s"} ${droppedFields === 1 ? "was" : "were"} dropped for failing source verification.`);
  }

  // C9 — per-section status; empty section renders an explicit not_found note.
  const peopleSection: ProfileSection<ProfilePerson> = {
    status: sectionStatus(people, peopleDrops), items: people,
    note: people.length ? "" : "No individual people could be verified in the sources found.",
  };
  const divisionsSection: ProfileSection<ProfileDivision> = {
    status: sectionStatus(divisions, divDrops), items: divisions,
    note: divisions.length ? "" : "No divisions were stated in the sources found.",
  };
  const offeringsSection: ProfileSection<ProfileOffering> = {
    status: sectionStatus(offerings, offDrops), items: offerings,
    note: offerings.length ? "" : "No offerings were stated in the sources found.",
  };
  const locationsSection: ProfileSection<ProfileLocation> = {
    status: sectionStatus(locations, locDrops), items: locations,
    note: locations.length ? "" : "No verifiable location was found in the sources.",
  };

  // Summary — grounded from gate-survived findings ONLY. raw.summary is
  // prompt-trusted model prose (could carry an ungated name/address/phone) and
  // must NEVER reach the user under the "everything is cited" promise (§13).
  // When no findings survived, use a safe deterministic string, not model text.
  const summary = findings.length
    ? findings.slice(0, 2).map((f) => f.text).join(" ")
    : `${target.name} — limited public information could be verified.`;

  const cov = {
    people_found: people.length,
    people_with_verified_contact: people.filter((p) => p.contact_status === "verified").length,
    divisions_found: divisions.length,
    locations_found: locations.length,
  };

  return {
    name: target.name,
    kind: target.kind,
    summary,
    people: peopleSection,
    divisions: divisionsSection,
    offerings: offeringsSection,
    locations: locationsSection,
    unverified_notes: notes,
    headline: buildHeadline(cov, notes),
    coverage: cov,
  };
}

// ── Persistence (service-role) ──────────────────────────────────────────────
async function persistRun(
  serviceUrl: string,
  serviceKey: string,
  runId: string,
  req: DeepResearchRequest,
  result: DeepResearchResult,
  tenantId: string | null,
): Promise<void> {
  // M0 FAIL-CLOSED FOR PERSISTENCE: without unambiguous tenant lineage the run is NOT
  // stored — the research result still returns to the caller, but the platform never
  // persists a run under guessed ownership (owner ruling 2026-10-03).
  if (!tenantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    console.warn(
      "[paige-deep-research] persistence skipped: tenant lineage unresolved/ambiguous (M0 fail-closed; the run's result is still returned)",
    );
    return;
  }
  try {
    const admin = createClient(serviceUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: runErr } = await admin.from("research_runs").insert({
      id: runId,
      tenant_id: tenantId,
      user_id: req.user_id,
      client_user_id: req.client_user_id ?? null,
      question: req.question,
      domain: req.domain ?? "general",
      caller: req.caller ?? "chat",
      findings: result.findings,
      coverage: result.coverage,
      stop_reason: result.coverage.stop_reason,
      configured: result.coverage.configured,
      // B2 — nullable dossier profile; null on the general path (back-compat).
      entity_profile: result.entity_profile ?? null,
    });
    if (runErr) { console.error("[paige-deep-research] persist run failed:", runErr.message); return; }

    if (result.sources.length) {
      // Sources inherit the parent run's lineage VERBATIM — never independently resolved.
      const rows = result.sources.map((s) => ({
        run_id: runId,
        tenant_id: tenantId,
        user_id: req.user_id,
        source_index: s.index,
        url: s.url,
        title: s.title,
        snippet: s.snippet,
        reliability_score: s.reliability_score,
        tier: s.tier,
        reliability: s.reliability,
        published_at: s.published_at,
        fetched_at: s.fetched_at,
        excluded: s.excluded,
      }));
      const { error: srcErr } = await admin.from("research_sources").insert(rows);
      if (srcErr) console.error("[paige-deep-research] persist sources failed:", srcErr.message);
    }
  } catch (e) {
    console.error("[paige-deep-research] persist error:", (e as Error)?.message);
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let t0 = Date.now();
  const runId = crypto.randomUUID();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: DeepResearchRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length < 3) return json({ error: "question is required (min 3 chars)" }, 400);
  if (!body.user_id || typeof body.user_id !== "string") return json({ error: "user_id is required" }, 400);

  const domainHint = typeof body.domain === "string" ? body.domain : "general";

  // ── Entity-target detection (A1/A2) — runs ONCE, before hop 0 ──────────────
  // null ⇒ the general-question path, which is byte-for-byte the pre-existing
  // engine (DEFAULT_BOUNDS, planHop, no profile). Non-null ⇒ dossier mode: wider
  // bounds (A8), facet-driven planning (A4-A6), and the profile gate (Section C).
  const entityTarget = detectEntityTarget(question, domainHint);
  const BND: RunBounds = entityTarget ? DOSSIER_BOUNDS : DEFAULT_BOUNDS;
  // A7 — flavor injection MECHANISM only. Effective facets = the (empty) in-file
  // registry keyed by the opaque domain hint + any caller-supplied templates.
  // No vertical vocabulary lives in this file (§2/§9 grep must stay empty).
  const flavorFacets: string[] = [
    ...(DOMAIN_FLAVORS[domainHint] ?? []),
    ...(Array.isArray(body.flavor_facets) ? body.flavor_facets.filter((f) => typeof f === "string") : []),
  ];

  // General path default stays 2 (unchanged). Dossier mode, when the caller does
  // not pin max_hops, defaults to the dossier ceiling so the Hop2/Hop3 gap-check
  // + contact-resolution schedule (A6) can actually run; Hop3 still self-skips
  // when no named person is missing a contact.
  const requestedHops = Number.isFinite(body.max_hops as number)
    ? Number(body.max_hops)
    : (entityTarget ? BND.MAX_HOPS : 2);
  const effectiveMaxHops = Math.max(1, Math.min(BND.MAX_HOPS, requestedHops));
  const freshnessDays = Number.isFinite(body.freshness_days as number) && Number(body.freshness_days) > 0
    ? Number(body.freshness_days) : 365;
  const persist = body.persist !== false;
  const strict = body.strict !== false;

  const sources: SourceRec[] = [];
  let searches = 0;
  let reads = 0;
  let hopsUsed = 0;
  let costUSD = 0;
  let stop: StopReason = "max_hops";
  let configured = true;

  // ── §9/#361 server-resolved tenant — NEVER trust a body tenant field ────────
  // A tenant is derived SERVER-SIDE only. A service-role bearer (every current caller:
  // paige-ai-chat, subagent-financial-research, lender-research) is trusted to name the
  // acting user via the already-validated body.user_id — we then look the tenant up
  // ourselves (profiles.active_tenant_id, else first active tenant_members row — the repo's
  // canonical resolution, mirrored from admin-list-users). A user JWT is instead pinned to
  // its OWN tenant via the current_user_tenant_id RLS rpc (the paige-eval pattern); body.user_id
  // is NOT trusted for a JWT caller. On any miss → null (research still runs; strategize just
  // gets no memory anchors and writes a platform-null trace — §13 honest-degrade).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let resolvedTenantId: string | null = null;
  // M0: the STRICT lineage used ONLY for persistence (see the auth block below). Null ⇒
  // ambiguous ⇒ persistence is skipped, never guessed.
  let lineageTenantId: string | null = null;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    if (bearer && bearer === SERVICE_KEY) {
      // Trusted service-role caller → derive tenant from the (trusted) body.user_id).
      // TWO resolutions with different strictness (M0):
      //   resolvedTenantId — for strategize/tracing: active_tenant_id, else first active
      //     membership (honest-degrade context only; nothing persisted under it).
      //   lineageTenantId — for PERSISTENCE: active_tenant_id ONLY. A user whose active
      //     workspace is unset has AMBIGUOUS ownership and the run is NOT persisted
      //     (fail-closed per the owner ruling — never a guessed membership).
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      if (userId) {
        const { data: prof } = await admin
          .from("profiles").select("active_tenant_id").eq("user_id", userId).maybeSingle();
        const activeTid = (prof?.active_tenant_id as string | null) ?? null;
        lineageTenantId = activeTid && UUID_RE.test(activeTid) ? activeTid : null;
        let tid: string | null = activeTid;
        if (!tid) {
          const { data: memberRows } = await admin
            .from("tenant_members").select("tenant_id")
            .eq("user_id", userId).eq("status", "active")
            .order("joined_at", { ascending: true }).limit(1);
          tid = (memberRows?.[0]?.tenant_id as string | null) ?? null;
        }
        resolvedTenantId = tid && UUID_RE.test(tid) ? tid : null;
      }
    } else if (bearer) {
      // User JWT → pin to the caller's OWN tenant via RLS rpc (body.user_id NOT trusted here).
      const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await anon.auth.getUser();
      if (user) {
        const { data: activeTenant } = await anon.rpc("current_user_tenant_id");
        resolvedTenantId = typeof activeTenant === "string" && UUID_RE.test(activeTenant) ? activeTenant : null;
        // The JWT path is exact by construction (RLS-pinned resolver) — lineage = resolved.
        lineageTenantId = resolvedTenantId;
      }
    }
  } catch (e) {
    console.warn("[paige-deep-research] tenant resolution failed (non-fatal):", (e as Error)?.message);
    resolvedTenantId = null;
    lineageTenantId = null;
  }

  // M0 CROSS-CHECK: an upstream expected_tenant_id is honored only when it AGREES with the
  // server-resolved lineage. A disagreement is ambiguity — persistence is skipped, the
  // caller's value is never persisted and never granted authority.
  const expectedTenant = typeof body.expected_tenant_id === "string" && UUID_RE.test(body.expected_tenant_id)
    ? (body.expected_tenant_id as string).toLowerCase()
    : null;
  if (expectedTenant && lineageTenantId && expectedTenant !== lineageTenantId) {
    console.warn(
      "[paige-deep-research] persistence skipped: upstream expected_tenant_id disagrees with the server-resolved lineage (treated as ambiguous, §9/M0)",
    );
    lineageTenantId = null;
  }

  try {
  // §34 L4 phase-1: strategize BEFORE the research loop. Honest-degrade — it NEVER throws and can never
  // break the run (contract in strategize.ts); its one reason:strategize trace self-writes to L1 (§34).
  // Only the GENERAL path (planHop) consumes the strategy; dossier mode uses the deterministic
  // planEntityHop and would discard it — so skip the frontier "plan" call there rather than pay for a
  // strategy nothing reads (§13/efficiency). General-path runs still land the trace + steer hop-0.
  const strategy = entityTarget
    ? null
    : await strategizeBeforeReasoning({
        task: question,
        tenantId: resolvedTenantId,   // §9/#361: server-resolved, NEVER body.user_id
        taskId: runId,                // correlates the trace to this exact research run
        // agentId omitted → defaults to "paige-strategist" (the first live paige-strategist trace row)
      });

  // §32 correctness: reset the wall-clock baseline AFTER strategize so pre-reasoning latency is NOT
  // billed against the gathering budget. The three WALL_CLOCK_MS comparisons below all read this t0.
  t0 = Date.now();

  // ── Bounded PLAN → SEARCH → READ → GAP-CHECK loop (A3) ────────────────────
  outer:
  for (let hop = 0; hop < effectiveMaxHops; hop++) {
    hopsUsed = hop + 1;

    if (Date.now() - t0 > BND.WALL_CLOCK_MS) { stop = "wall_clock"; break; }
    if (costUSD > BND.COST_CEILING_USD) { console.warn(`[paige-deep-research] soft cost ceiling hit ($${costUSD.toFixed(3)})`); stop = "budget"; break; }

    // (a) PLAN / GAP-CHECK. Dossier mode uses the pure, deterministic facet
    // planner (A4-A6) — no LLM round-trip for query generation. General mode is
    // unchanged: the cheap "extract"-tier planHop.
    let queries: string[];
    if (entityTarget) {
      const eplan = planEntityHop(entityTarget, hop, sources, flavorFacets, BND.MAX_QUERIES_PER_HOP);
      if (eplan.done && hop > 0) { stop = "answered"; break; }
      queries = eplan.queries.slice(0, BND.MAX_QUERIES_PER_HOP);
      if (queries.length === 0) {
        if (hop === 0) queries = [entityTarget.name];
        else { stop = "answered"; break; }
      }
    } else {
      const evidence = sources
        .filter((s) => s.read || s.snippet)
        .slice(0, 12)
        .map((s, i) => ({ index: i + 1, title: s.title, snippet: (s.content || s.snippet).slice(0, 400) }));
      costUSD += COST.cheapLLM;
      // §34 L4 phase-1: steer ONLY the hop-0 planner, and ONLY with a real (non-degraded) strategy — a
      // fallback strategy injects nothing (§13). Appended as ONE string, exactly like domainHint above.
      const strategyHint = (hop === 0 && strategy && !strategy.degraded)
        ? `STRATEGY: ${strategy.approach}` +
          (strategy.decomposition.length
            ? `\nKEY SUB-GOALS:\n${strategy.decomposition.slice(0, 3).map((d) => `- ${d}`).join("\n")}`
            : "")
        : "";
      const plan = await planHop(question, domainHint, hop, evidence, strategyHint);
      if (plan.done && hop > 0) { stop = "answered"; break; }
      queries = plan.queries.slice(0, BND.MAX_QUERIES_PER_HOP);
      if (queries.length === 0) {
        if (hop === 0) queries.push(question);
        else { stop = "answered"; break; }
      }
    }

    // (b) SEARCH — Firecrawl fan-out
    for (const q of queries) {
      if (searches >= BND.MAX_TOTAL_SEARCHES) break;
      if (Date.now() - t0 > BND.WALL_CLOCK_MS) { stop = "wall_clock"; break outer; }
      const r = await callWebSearch(SUPABASE_URL, SERVICE_KEY, q);
      if (!r.configured) { configured = false; stop = "unconfigured"; break outer; } // §13 — never fabricate
      searches++;
      costUSD += COST.search;
      for (const hit of r.results) upsertSource(sources, hit);
    }

    // (c) READ — top-ranked unread sources' full body
    const ranked = rankSources(sources, freshnessDays);
    for (const s of ranked) {
      if (reads >= BND.MAX_READS) break;
      if (s.read || s.excluded) continue;
      if (Date.now() - t0 > BND.WALL_CLOCK_MS) { stop = "wall_clock"; break outer; }
      const live = sources.find((x) => x.url === s.url)!;
      const content = await fetchUrl(SUPABASE_URL, SERVICE_KEY, s.url);
      live.read = true;
      reads++;
      costUSD += COST.read;
      if (content) live.content = content;
    }

    if (searches >= BND.MAX_TOTAL_SEARCHES && reads >= BND.MAX_READS) { stop = "budget"; break; }
    if (hop + 1 >= effectiveMaxHops) stop = "max_hops";
  }

  // ── Assemble ranked sources for output + citation binding ─────────────────
  const rankedFinal = rankSources(sources, freshnessDays);
  rankedFinal.forEach((s, i) => { s.index = i + 1; }); // stable 1-based citation indices
  const citable = rankedFinal.filter((s) => !s.excluded);

  const outSources: OutSource[] = rankedFinal.map((s) => ({
    index: s.index,
    url: s.url,
    title: s.title,
    snippet: s.snippet,
    reliability_score: Number(s.reliability_score.toFixed(3)),
    tier: s.tier,
    reliability: s.reliability,
    published_at: s.published_at,
    fetched_at: s.fetched_at,
    excluded: s.excluded,
  }));

  // ── Return invariants (A6) — the honest-empty short-circuits ──────────────
  const buildResult = (findings: Finding[], stopReason: string, note: string): DeepResearchResult => ({
    run_id: runId,
    question,
    findings,
    sources: outSources,
    coverage: { stop_reason: stopReason, hops_used: hopsUsed, searches, reads, note, configured },
  });

  // Unconfigured → no synthesis, findings [], persist NOTHING (test iii).
  if (!configured) {
    return json(buildResult(
      [], "unconfigured",
      "Live web search is not connected, so no sources could be gathered. No facts were produced — nothing was invented.",
    ));
  }

  // No citable sources at all → honest-empty. Persist an audit run (attempt happened).
  if (citable.length === 0) {
    const result = buildResult(
      [], searches === 0 ? "no_results" : (stop === "max_hops" ? "no_results" : stop),
      sources.length === 0
        ? "Search ran but returned no results. No verifiable sources, so no findings — nothing was fabricated."
        : "Sources were found but none met the reliability bar. No findings produced rather than surface unverifiable claims.",
    );
    if (persist) await persistRun(SUPABASE_URL, SERVICE_KEY, runId, body, result, lineageTenantId);
    return json(result);
  }

  // ── SYNTHESIZE — exactly ONE Claude reasoning call (A9) ───────────────────
  // In dossier mode the SAME call additionally emits the atomic per-field-cited
  // profile records; there is never a second model round-trip.
  costUSD += COST.synthesis;
  const synth = await synthesize(question, domainHint, citable, entityTarget);
  if (!synth) {
    const result = buildResult([], "error", "Synthesis failed; no findings returned rather than risk fabrication.");
    if (persist) await persistRun(SUPABASE_URL, SERVICE_KEY, runId, body, result, lineageTenantId);
    return json(result);
  }

  // ── POST-VALIDATION gate ──────────────────────────────────────────────────
  const findings = validateAndBind(synth, citable, strict);

  // ── DOSSIER profile gate (Section C) — runs AFTER validateAndBind, over the
  // same non-excluded ranked sources. Emitted only if ≥1 typed item survived.
  const entityProfile = entityTarget
    ? validateProfile(synth, citable, rankedFinal, entityTarget, findings, reads)
    : null;

  const finalStop = (findings.length > 0 || entityProfile)
    ? (stop === "unconfigured" ? "answered" : stop)
    : "no_results";
  const note = findings.length > 0
    ? `Verified ${findings.length} finding(s) across ${citable.length} citable source(s).`
    : (entityProfile
        ? "Structured entity profile assembled from cited sources; see entity_profile for the verified intel and its unverified gaps."
        : "The model produced no claim that survived source verification. Reporting nothing rather than an unverified fact.");

  const result = buildResult(findings, finalStop, note);
  if (entityProfile) {
    result.entity_profile = entityProfile;
    // Mirror the canonical honesty trail into coverage for consumers that read
    // only `coverage` (B1). entity_profile.unverified_notes stays canonical.
    result.coverage.unverified_notes = entityProfile.unverified_notes;
  }
  if (persist) await persistRun(SUPABASE_URL, SERVICE_KEY, runId, body, result, lineageTenantId);
  return json(result);
  } catch (e) {
    // §13 — any unexpected failure returns a STRUCTURED honest error, never a
    // bare 500 and never a fabricated result. Nothing is persisted on this path.
    console.error("[paige-deep-research] run error:", (e as Error)?.message);
    return json({
      run_id: runId,
      question,
      findings: [],
      sources: [],
      coverage: {
        stop_reason: "error",
        hops_used: hopsUsed,
        searches,
        reads,
        note: "Research hit an unexpected error; returning no findings rather than risk an unverified answer.",
        configured,
      },
    });
  }
});
