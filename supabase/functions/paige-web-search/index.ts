import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { parseResearchSourcePolicy, researchSourceUrl, RESEARCH_SEARCH_LIMIT } from "../_shared/research-source-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SearchResult = { title: string; description: string; url: string };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!bearer) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // This is an INTERNAL utility: paige-ai-chat and paige-deep-research invoke it
    // server-to-server with the service-role key. Accept that trusted caller directly;
    // any other caller must present a valid end-user JWT. (verify_jwt is off at the
    // platform layer so this in-function check is the sole gate — never remove it.)
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isInternal = serviceKey.length > 0 && bearer === serviceKey;
    if (!isInternal) {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: claimsData, error: claimsErr } = await sb.auth.getClaims(bearer);
      if (claimsErr || !claimsData?.claims) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return new Response(JSON.stringify({ error: "Invalid search request." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    let policy;
    try { policy = parseResearchSourcePolicy(body); }
    catch { return new Response(JSON.stringify({ error: "Invalid search source constraints." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
    const requestedLimit = body.limit === undefined ? RESEARCH_SEARCH_LIMIT : body.limit;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > RESEARCH_SEARCH_LIMIT) return new Response(JSON.stringify({ error: "Search limit must be an integer from 1 to 5." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const limit = Math.min(requestedLimit, policy.max_sources ?? RESEARCH_SEARCH_LIMIT);
    const { query } = body;
    const q = typeof query === "string" ? query.trim() : "";

    if (!q || q.length < 2 || q.length > 500) {
      return new Response(
        JSON.stringify({ error: "Invalid query. Provide 2-500 characters." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          configured: false,
          query: q,
          results: [] as SearchResult[],
          note: "Web search is not yet configured. Set the Firecrawl API key to enable live web search.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fcRes = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: q,
        limit,
        sources: ["web"],
        ...(policy.allowed_domains ? { includeDomains: policy.allowed_domains } : {}),
      }),
    });

    if (!fcRes.ok) {
      const body = await fcRes.text().catch(() => "");
      console.error(`[paige-web-search] Firecrawl API error ${fcRes.status}: ${body.slice(0, 500)}`);
      return new Response(
        JSON.stringify({
          configured: true,
          query: q,
          results: [] as SearchResult[],
          error: `Search provider returned ${fcRes.status}.`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await fcRes.json();
    // Firecrawl v2 search response shape: { success, data: { web: [...], news: [...], images: [...] } }
    // Older shapes also possible: data.data (array), data.web (array), data.results (array)
    let raw: any[] = [];
    if (Array.isArray(data?.data?.web)) {
      raw = data.data.web;
    } else if (Array.isArray(data?.data)) {
      raw = data.data;
    } else if (Array.isArray(data?.web)) {
      raw = data.web;
    } else if (Array.isArray(data?.results)) {
      raw = data.results;
    }
    console.log(`[paige-web-search] firecrawl returned ${raw.length} raw results. Top-level keys: ${Object.keys(data ?? {}).join(",")}`);

    const seen = new Set<string>();
    const results: SearchResult[] = raw
      .map((r: any) => ({
        title: String(r?.title ?? r?.metadata?.title ?? "").slice(0, 240),
        description: String(r?.description ?? r?.snippet ?? r?.metadata?.description ?? "")
          .replace(/<[^>]+>/g, "")
          .slice(0, 600),
        url: researchSourceUrl(r?.url ?? r?.metadata?.sourceURL ?? "", policy) ?? "",
      }))
      .filter((r: SearchResult) => {
        if (!r.url || seen.has(r.url)) return false;
        seen.add(r.url); return true;
      }).slice(0, limit);

    return new Response(
      JSON.stringify({
        configured: true,
        query: q,
        results,
        count: results.length,
        provider: "firecrawl",
        fetched_at: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[paige-web-search] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
