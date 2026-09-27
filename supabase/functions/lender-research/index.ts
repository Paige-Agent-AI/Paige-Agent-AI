import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---------------------------------------------------------------------------
// Engine output contract (shared verbatim with paige-deep-research). This
// caller consumes it; it never fabricates a lender fact of its own.
// ---------------------------------------------------------------------------
interface DeepResearchSource {
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
interface DeepResearchFinding {
  text: string;
  citations: number[];
  confidence: "high" | "medium" | "low";
  unverifiedFields?: string[];
}
// D1/B1 — the engine's gate-survived entity dossier (per-field cited). Present
// only when the engine detected a single-entity target; absent on list queries.
// Every field here already survived the deterministic validateProfile gate, so
// this caller reads it STRUCTURED and never re-scrapes free text (§13).
interface DossierPerson {
  name: string;
  name_citations: number[];
  title?: string;
  contact?: { email?: string; phone?: string; profile_url?: string };
  contact_status: "verified" | "not_public";
  confidence: "high" | "medium" | "low";
}
interface DossierRecord { name: string; description?: string; detail?: string; citations: number[] }
interface DossierLocation { address?: string; locality?: string; phone?: string; site?: string; citations: number[] }
interface EntityProfile {
  name: string;
  kind: "organization" | "person";
  summary: string;
  people: { status: string; items: DossierPerson[]; note: string };
  divisions: { status: string; items: DossierRecord[]; note: string };
  offerings: { status: string; items: DossierRecord[]; note: string };
  locations: { status: string; items: DossierLocation[]; note: string };
  unverified_notes: string[];
  headline: string;
}
interface DeepResearchResult {
  run_id: string;
  question: string;
  findings: DeepResearchFinding[];
  sources: DeepResearchSource[];
  entity_profile?: EntityProfile | null;
  coverage: {
    stop_reason: string;
    hops_used: number;
    searches: number;
    reads: number;
    note: string;
    configured: boolean;
  };
}

// A lender card, mirrors the shape the UI already renders. Fields that did not
// survive the engine's validation with a citation are `null` → "Not listed".
interface Lender {
  name: string;
  type: string;
  products: string[];
  minimumRequirements: string;
  estimatedRates: string | null;
  contactInfo: string | null;
  website: string | null;
  locationMatch: string;
  notes: string;
  citations: number[];
  confidence: "high" | "medium" | "low";
  unverifiedFields: string[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Query construction — turns structured criteria into a natural-language goal
// for the domain-agnostic engine. The engine receives `domain:"funding"` as an
// opaque hint only; no funding vocabulary lives inside the engine.
// ---------------------------------------------------------------------------
function buildLenderQuery(c: any): string {
  const loc = c?.location ?? {};
  const where = [loc.city, loc.state].filter(Boolean).join(", ") || "the United States";
  const types = Array.isArray(c?.fundingTypes) && c.fundingTypes.length
    ? c.fundingTypes.join(", ")
    : "small business financing";
  const amount = c?.fundingAmountMin && c?.fundingAmountMax
    ? `between $${Number(c.fundingAmountMin).toLocaleString()} and $${Number(c.fundingAmountMax).toLocaleString()}`
    : "of any size";
  const entity = c?.entityType ? ` for a ${c.entityType}` : "";
  const tib = c?.timeInBusiness ? ` in business ${c.timeInBusiness}` : "";
  return (
    `Identify real, currently operating lenders (banks, credit unions, SBA-preferred lenders, ` +
    `CDFIs, and commercial or online lenders) that serve businesses in ${where} and offer ${types} ` +
    `${amount}${entity}${tib}. For each lender find the exact legal name, official website, a public ` +
    `contact phone number, the products offered, minimum qualifying requirements, and published rate ` +
    `ranges. Only report lenders and details that appear on a cited source.`
  );
}

// ---------------------------------------------------------------------------
// Field extractors — best-effort parse of a cited finding into lender fields.
// Every extracted field is gated by (a) a citation existing and (b) the field
// NOT being listed in the engine's unverifiedFields for that finding.
// ---------------------------------------------------------------------------
function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// NOTE: the earlier prose-scraping helpers (extractWebsite/extractPhone/
// extractRate/deriveName) were REMOVED — they re-extracted contact facts from
// ungrounded model prose, bypassing the engine's deterministic gate (#165).
// mapFindingsToLenders now consumes only the engine's validated structured
// fields (f.name/f.website/f.phone/f.values).

// ---------------------------------------------------------------------------
// mapFindingsToLenders — cited fields ONLY. Drops any lender with no surviving
// contact vector (strict default). Never emits a bare fabricated value.
// ---------------------------------------------------------------------------
function mapFindingsToLenders(dr: DeepResearchResult, strict: boolean): Lender[] {
  const byIndex = new Map(dr.sources.map((s) => [s.index, s]));
  const out: Lender[] = [];

  for (const f of dr.findings) {
    // Engine invariant: a finding without citations is illegal. Guard anyway.
    const cites = (f.citations ?? []).filter((c) => byIndex.get(c) && !byIndex.get(c)!.excluded);
    if (cites.length === 0) continue;

    const primary = byIndex.get(cites[0]);
    const text = f.text ?? "";

    // §13/#165 — consume ONLY the engine's gate-survived STRUCTURED fields.
    // NEVER regex f.text: the summary prose is ungrounded model output, and
    // scraping it would resurrect the exact fabrication this fix kills. Only
    // what appears in f.name/f.website/f.phone/f.values passed validation.
    const name = (f.name ?? "").trim();
    if (!name) continue; // no VALIDATED entity name → not a lender row (never a page title)

    const website = (f.website ?? "").trim() || null;    // host-vouched by the engine
    const contactInfo = (f.phone ?? "").trim() || null;  // last-10 matched in cited text

    // rate — the first VALIDATED figure that reads as a percentage (its digits
    // were confirmed present in a cited source). Never a scraped/fabricated range.
    const values = Array.isArray(f.values) ? f.values : [];
    const rawRate = values.find((v) => /\d\s*%/.test(String(v))) ?? null;
    const estimatedRates = rawRate
      ? `${rawRate} — as listed on ${primary ? hostOf(primary.url) : "the cited source"}, verify directly`
      : "Contact lender for rates";

    // strict: a lender survives only if ≥1 contact vector (website OR phone) held.
    if (strict && !website && !contactInfo) continue;

    const missing: string[] = [];
    if (!website) missing.push("website");
    if (!contactInfo) missing.push("phone");
    if (!rawRate) missing.push("rates");

    out.push({
      name,
      type: "Lender",
      products: [],
      minimumRequirements: text.slice(0, 400), // composed text = validated bits only
      estimatedRates,
      contactInfo,
      website,
      locationMatch: primary ? `Cited from ${hostOf(primary.url)}` : "",
      notes: text,
      citations: cites,
      confidence: f.confidence,
      unverifiedFields: missing,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// D3 — map a gate-survived entity_profile → lender cards using its STRUCTURED,
// per-field-cited records (divisions→type, offerings→products, people→contacts,
// locations→website/phone). Reads only fields that passed the engine's gate;
// never re-scrapes free text. Fires only when the engine returned a dossier
// (single-entity target); list queries fall back to mapFindingsToLenders.
// ---------------------------------------------------------------------------
function mapProfileToLenders(ep: EntityProfile, strict: boolean): Lender[] {
  const products = (ep.offerings?.items ?? []).map((o) => o.name).filter(Boolean);
  const type = (ep.divisions?.items?.[0]?.name) || "Lender";

  // First verified person contact, then any verified location contact.
  const person = (ep.people?.items ?? []).find((p) => p.contact_status === "verified" && (p.contact?.phone || p.contact?.email));
  const loc = (ep.locations?.items ?? []).find((l) => l.phone || l.site);
  const contactInfo = person?.contact?.phone || loc?.phone || null;
  const website = loc?.site || person?.contact?.profile_url || null;

  const citations = Array.from(new Set([
    ...(ep.people?.items ?? []).flatMap((p) => p.name_citations ?? []),
    ...(ep.offerings?.items ?? []).flatMap((o) => o.citations ?? []),
    ...(ep.divisions?.items ?? []).flatMap((d) => d.citations ?? []),
  ]));

  if (strict && !website && !contactInfo) return []; // no surviving contact vector

  const missing: string[] = [];
  if (!website) missing.push("website");
  if (!contactInfo) missing.push("phone");
  if (!products.length) missing.push("products");

  return [{
    name: ep.name,
    type,
    products,
    minimumRequirements: ep.summary || "",
    estimatedRates: "Contact lender for rates",
    contactInfo,
    website,
    locationMatch: loc?.locality || loc?.address || "",
    notes: ep.headline || ep.summary || "",
    citations,
    confidence: person?.confidence ?? "medium",
    unverifiedFields: missing,
  }];
}

// ---------------------------------------------------------------------------
// synthesizeCitedCommentary — cited [n] prose or null. Built ONLY from findings
// that already survived the engine's validation; no new LLM call, no fabrication.
// ---------------------------------------------------------------------------
function synthesizeCitedCommentary(dr: DeepResearchResult, isDeep: boolean): string | null {
  if (!isDeep) return null;
  if (!dr.findings.length) return null;
  const body = dr.findings
    .filter((f) => (f.citations ?? []).length > 0)
    .map((f) => `${f.text} ${f.citations.map((c) => `[${c}]`).join("")}`)
    .join(" ");
  if (!body.trim()) return null;
  return (
    `${body}\n\nEvery figure above is drawn from the cited sources — lender terms change ` +
    `frequently, so confirm each rate, requirement, and contact detail directly before acting.`
  );
}

// ---------------------------------------------------------------------------
// Honest degraded states (D3). Invariant: results:[] and market_commentary:null
// in every degraded state; nothing fabricated is ever persisted.
// ---------------------------------------------------------------------------
type DegradedState = "unconfigured" | "no_sources" | "unverified" | "error";

const DEGRADED_MESSAGES: Record<DegradedState, string> = {
  unconfigured:
    "Live research is not connected yet. I can't look up lenders without a verified web source, and I won't guess names, rates, or phone numbers. Ask your admin to connect web search (Firecrawl).",
  no_sources:
    "I searched but couldn't find verifiable sources for these criteria. Rather than show made-up lenders, I'm showing nothing. Try widening the location or funding type.",
  unverified:
    "I found some pages but couldn't verify them against reliable sources. Here are the raw links I found — verify each one yourself before acting.",
  error:
    "Web search is having trouble right now (temporary). I didn't get sources, so I have no results — nothing was made up to fill the gap.",
};

interface DegradedResult {
  body: Record<string, unknown>;
  status: number;
  persist: null | { search_status: string; provenance: string; sources: unknown[] };
}

function degraded(
  state: DegradedState,
  dr: DeepResearchResult | null,
  isDeepResearch: boolean,
): DegradedResult {
  const rawLinks = (dr?.sources ?? [])
    .filter((s) => !s.excluded)
    .map((s) => ({ url: s.url, title: s.title, reliability: s.reliability, tier: s.tier }));

  const body: Record<string, unknown> = {
    success: true,
    results: [],
    lenders: [], // legacy alias for the existing UI
    market_commentary: null,
    marketCommentary: null, // legacy alias
    is_deep_research: isDeepResearch,
    sources: dr?.sources ?? [],
    provenance: state,
    search_status: state,
    configured: state !== "unconfigured",
    lowConfidence: state === "unverified",
    rawLinks: state === "unverified" ? rawLinks : [],
    message: DEGRADED_MESSAGES[state],
    coverage: dr?.coverage ?? null,
  };

  // Persistence per D3: unconfigured + error persist NOTHING; no_sources +
  // unverified write an audit row carrying results:[] and only raw links.
  let persist: DegradedResult["persist"] = null;
  if (state === "no_sources") {
    persist = { search_status: "no_sources", provenance: "no_sources", sources: dr?.sources ?? [] };
  } else if (state === "unverified") {
    persist = { search_status: "unverified", provenance: "unverified", sources: dr?.sources ?? [] };
  }

  return { body, status: 200, persist };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    // --- Role gate (admin) ---
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const userRoles = roles?.map((r: { role: string }) => r.role) || [];
    if (!userRoles.includes("admin")) {
      return json({ error: "Access denied. Admin role required." }, 403);
    }

    // --- D5: §2 funding-preset gate ---
    // The lender/funding surface is opt-in per account. We mirror the exact gate
    // the platform already uses for every funding surface: the SECURITY-DEFINER
    // RPC check_feature_access(user_id, 'funding_tools'), which reads
    // subscription_plans.has_funding_tools (and honors admin/complimentary
    // bypass). Same predicate as <PlanGate feature="funding_tools"> in the UI.
    const { data: fundingEnabled, error: gateError } = await supabase.rpc("check_feature_access", {
      _user_id: user.id,
      _feature: "funding_tools",
    });
    if (gateError) {
      console.error("Funding-preset gate check failed:", gateError);
      return json({ error: "Unable to verify funding access." }, 500);
    }
    if (!fundingEnabled) {
      return json(
        { error: "Funding tools are not enabled for this account. Enable the funding preset to run lender research." },
        403,
      );
    }

    const { searchCriteria, isDeepResearch, clientUserId } = await req.json();
    if (!searchCriteria?.location?.state) {
      return json({ error: "Location (state) is required" }, 400);
    }
    const isDeep = Boolean(isDeepResearch);

    // --- Route through the grounded deep-research engine. No fabrication path. ---
    let dr: DeepResearchResult;
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/paige-deep-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({
          question: buildLenderQuery(searchCriteria),
          user_id: user.id,
          client_user_id: clientUserId ?? null,
          domain: "funding",
          caller: "lender-research",
          max_hops: isDeep ? 3 : 2,
          freshness_days: 365,
          strict: true,
          persist: false, // this caller owns persistence into lender_research_results
        }),
      });
      if (!resp.ok) {
        console.error("paige-deep-research returned", resp.status);
        const d = degraded("error", null, isDeep);
        return json(d.body, d.status);
      }
      dr = (await resp.json()) as DeepResearchResult;
    } catch (e) {
      console.error("paige-deep-research call failed:", e);
      const d = degraded("error", null, isDeep);
      return json(d.body, d.status);
    }

    // --- Degraded: search unavailable ---
    if (!dr.coverage?.configured) {
      const d = degraded("unconfigured", dr, isDeep);
      return json(d.body, d.status); // persist nothing
    }

    // --- Map cited results → lender cards (validated fields only) ---
    // D3: when the engine returned a structured entity_profile, consume it
    // directly (divisions/people/offerings/locations); otherwise fall back to the
    // per-finding structured mapping. Neither path ever scrapes free text.
    const lenders = dr.entity_profile
      ? mapProfileToLenders(dr.entity_profile, true)
      : mapFindingsToLenders(dr, true);

    if (lenders.length === 0) {
      // Distinguish "found unverifiable pages" from "found nothing at all".
      const hasRawLinks = dr.sources.filter((s) => !s.excluded).length > 0;
      const d = degraded(hasRawLinks ? "unverified" : "no_sources", dr, isDeep);
      if (d.persist) {
        const { error: auditErr } = await supabase.from("lender_research_results").insert({
          user_id: user.id,
          client_user_id: clientUserId ?? null,
          search_criteria: searchCriteria,
          results: [],
          market_commentary: null,
          is_deep_research: isDeep,
          search_status: d.persist.search_status,
          provenance: d.persist.provenance,
          sources: d.persist.sources,
        });
        if (auditErr) console.error("Error saving audit row:", auditErr);
      }
      return json(d.body, d.status);
    }

    // --- Verified results ---
    const marketCommentary = synthesizeCitedCommentary(dr, isDeep);

    const { data: saved, error: saveError } = await supabase
      .from("lender_research_results")
      .insert({
        user_id: user.id,
        client_user_id: clientUserId ?? null,
        search_criteria: searchCriteria,
        results: lenders,
        market_commentary: marketCommentary,
        is_deep_research: isDeep,
        search_status: "complete",
        provenance: "verified",
        sources: dr.sources,
      })
      .select()
      .single();

    if (saveError) console.error("Error saving results:", saveError);

    return json({
      success: true,
      results: lenders,
      lenders, // legacy alias for the existing UI
      market_commentary: marketCommentary,
      marketCommentary, // legacy alias
      is_deep_research: isDeep,
      sources: dr.sources,
      provenance: "verified",
      search_status: "complete",
      run_id: dr.run_id,
      coverage: dr.coverage,
      savedId: saved?.id,
    });
  } catch (error) {
    console.error("Lender research error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
