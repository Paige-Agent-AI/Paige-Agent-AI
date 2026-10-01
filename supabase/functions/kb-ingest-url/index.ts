// Ingest a web page into a tenant's private Knowledge Base by URL. Fetches the
// page (SSRF-safe, HTTPS-only), strips it to text with a document-grade cap,
// then hands off to kb-ingest-doc (source:'url') — forwarding the caller's JWT
// so the doc is created + chunked + embedded under the caller's tenant via RLS.
//
// Why a separate function and not fetch-url-content -> kb-ingest-doc on the
// client: (1) orchestration stays in the edge layer so Paige can call it
// (§10, callable seam), (2) fetch-url-content hard-caps at 5000 chars for chat
// snippets — useless for indexing — and other callers depend on that small cap,
// so we do a document-grade fetch here (200 KB) rather than loosen it there.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";
import { assertPublicHttpUrl, SsrfError } from "../_shared/ssrfGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  url: z.string().url().max(2000),
  title: z.string().min(1).max(300).optional(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  share_to_network: z.boolean().optional(),
  tenant_id: z.string().uuid().optional(), // platform-owner override
});

// Document-grade cap — well under kb-ingest-doc's content.max(500_000), large
// enough to capture a full article/SOP page rather than a chat-sized snippet.
const MAX_CONTENT = 200_000;

// SSRF guard: the canonical `_shared/ssrfGuard.ts assertPublicHttpUrl` (§18 one home).
// It is STRICTER than the per-hostname regex this file used to carry — it resolves the
// host and validates every resolved IP numerically, closing the DNS→private /
// IPv4-mapped-IPv6 / encoded-literal gaps a hostname regex cannot see — and it also
// enforces https-only and rejects embedded credentials. It is applied to the initial URL
// AND every redirect hop below (see safeFetch).

function json(body: unknown, status = 200) {
  const result = body && typeof body === "object" && "error" in body && !("ok" in body) ? { ...body, ingestion_started: false } : body;
  return new Response(JSON.stringify(result), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Map an SSRF-guard refusal to an honest caller-facing message + HTTP status.
// Never leaks the resolved address or the caller's URL — only the stable reason class.
function ssrfResponse(err: SsrfError): { message: string; status: number } {
  switch (err.reason) {
    case "invalid_url":
      return { message: "Invalid URL format", status: 400 };
    case "url_must_be_https":
      return { message: "Only HTTPS URLs are allowed", status: 400 };
    case "url_has_embedded_credentials":
      return { message: "URLs with embedded credentials aren't allowed", status: 400 };
    case "url_host_not_allowed":
    case "url_host_unresolvable":
    case "url_resolves_to_private_address":
    case "url_redirect_refused":
      return { message: "That link points somewhere we can't fetch.", status: 403 };
    default:
      return { message: "That link can't be fetched.", status: 400 };
  }
}

// Fetch following redirects MANUALLY so each hop's Location is re-validated
// against the SSRF guard before we follow it (Deno's default redirect:"follow"
// would chase a 302 → http://169.254.169.254 without re-checking). The guard now
// resolves DNS + validates every IP numerically per hop, so a public hostname that
// rebinds to a private address (or an encoded-IP literal) is refused, not followed.
async function safeFetch(startUrl: string, maxHops = 5): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertPublicHttpUrl(current); // throws SsrfError on a non-public / non-https target
    const res = await fetch(current, {
      headers: { "User-Agent": "Paige-AI-Bot/1.0" },
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString(); // resolve relative redirects
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

// Pull a usable title out of the raw HTML before we strip tags.
function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = m[1].replace(/\s+/g, " ").trim();
  return t.length ? t.slice(0, 300) : null;
}

function stripToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let ingestionStarted = false;
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json({ error: "Invalid authentication token" }, 401);

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { url, title, category, tags, share_to_network, tenant_id } = parsed.data;

    // Parse for the hostname title-fallback. The SSRF/HTTPS guard runs inside safeFetch
    // (the initial URL AND every redirect hop) via assertPublicHttpUrl.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return json({ error: "Invalid URL format" }, 400);
    }

    // Fetch the page (SSRF-guarded on the initial URL and re-validated per redirect hop).
    let res: Response;
    try {
      res = await safeFetch(url);
    } catch (e) {
      if (e instanceof SsrfError) {
        const { message, status } = ssrfResponse(e);
        return json({ error: message }, status);
      }
      return json({ error: `Couldn't reach the page: ${(e as Error).message}` }, 400);
    }
    if (!res.ok) return json({ error: `Failed to fetch URL: ${res.status} ${res.statusText}` }, 400);

    const contentType = res.headers.get("content-type") || "";
    let content = "";
    let derivedTitle: string | null = null;

    if (contentType.includes("text/html")) {
      const html = await res.text();
      derivedTitle = extractTitle(html);
      content = stripToText(html);
    } else if (contentType.includes("text/plain") || contentType.includes("application/json")) {
      content = (await res.text()).replace(/\s+/g, " ").trim();
    } else {
      return json({ error: "Unsupported page type. Only HTML, plain text, and JSON pages can be indexed." }, 400);
    }

    if (!content || content.length < 20) {
      return json({ error: "That page had no readable text to teach Paige." }, 400);
    }

    const truncated = content.length > MAX_CONTENT;
    content = content.slice(0, MAX_CONTENT);
    const finalTitle = (title?.trim() || derivedTitle || parsedUrl.hostname).slice(0, 300);

    // Hand off to kb-ingest-doc, forwarding the caller's JWT so the doc is
    // created + chunked + embedded under the SAME tenant via RLS. Keeping the
    // chunk/embed pipeline single-sourced (one function owns it).
    ingestionStarted = true;
    const ingestRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")!}/functions/v1/kb-ingest-doc`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
          apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
        },
        body: JSON.stringify({
          title: finalTitle,
          content,
          // kb-ingest-doc's schema takes category as string | undefined (not
          // null) — only include it when present, else omit the key entirely.
          ...(category ? { category } : {}),
          tags: tags ?? [],
          source: "url",
          source_url: url,
          share_to_network: share_to_network ?? false,
          ...(tenant_id ? { tenant_id } : {}),
        }),
      },
    );
    const ingestBody = await ingestRes.json();
    if (!ingestBody || typeof ingestBody !== "object" || Array.isArray(ingestBody)) throw new Error("Invalid ingestion response");
    return json({ ...ingestBody, truncated }, ingestRes.status);
  } catch (error) {
    console.error("[kb-ingest-url] error:", error);
    return json({ ok: false, error: ingestionStarted ? "persistence_unverified" : "ingestion_not_started", detail: ingestionStarted ? "The save could not be verified. Check your knowledge before retrying." : "The page could not be read. Nothing was indexed." }, 500);
  }
});
