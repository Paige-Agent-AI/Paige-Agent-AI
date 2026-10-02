// agreement-document — handing back the retained record (INT-163). `verify_jwt = false`.
//
// ESIGN's retention requirement is that the completed record stays ACCESSIBLE TO BOTH PARTIES, and
// the two parties reach it by different doors because they are different kinds of person:
//
//   • THE SIGNER has no account on this platform and never will. Their door is their token — the
//     signing token while the agreement is open, which opens the PRESENTED document, and the
//     365-day retrieval token minted at completion, which opens the SEALED one. That is why this
//     function cannot demand a JWT.
//   • THE BUSINESS has an account. Their door is their own session, admin-gated and tenant-scoped,
//     exactly like every other authenticated read in the engine.
//
// The review found the second door missing entirely: the completion email told the workspace its
// signed contract was "in your workspace", and no surface, endpoint or RPC could produce it. Half of
// a legal retention obligation had no delivery path at all. Both doors live here rather than in two
// functions because they are one act — fetch this sealed document — differing only in how the caller
// proves they may (§18).
//
// WHAT NEVER LEAVES. No signed URL is handed to anybody: the bytes are streamed through this
// function, so the private bucket stays private and no link outlives the request. A token lookup
// returns no tenant id, no staff address, and no other agreement. Every refusal is the same refusal.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { overRateLimit, trustedClientIp } from "../_shared/rateLimit.ts";
import { sha256Hex } from "../_shared/agreements/token.ts";
import { TOKEN_SHAPE } from "../_shared/agreements/signing-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * ONE REFUSAL, whatever the cause — unknown, malformed, expired, revoked, not yet completed, not
 * yours. Distinguishing them tells a stranger which agreements exist.
 */
const refuse = () =>
  json({ ok: false, error: "This link is not valid. Ask the sender for a new copy." }, 404);

const serviceClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json({ ok: false, error: "GET only" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);
  const ip = trustedClientIp(req);

  // Per-address ceiling first, before anything is read or hashed. Fail-OPEN: a limiter hiccup must
  // not deny somebody their own signed contract, and entropy is what defeats guessing a token.
  if (await overRateLimit(db, `ad:ip:${ip}`, 30, 60) || await overRateLimit(db, `ad:iph:${ip}`, 200, 3600)) {
    return json({ ok: false, error: "Too many attempts. Please wait a moment and try again." }, 429);
  }

  const token = (url.searchParams.get("token") ?? "").trim();
  const agreementParam = (url.searchParams.get("agreementId") ?? "").trim();

  let sealedKey: string | null = null;
  let filename = "agreement.pdf";

  if (token) {
    // ── DOOR ONE: the signer's retrieval token ───────────────────────────────────────────────────
    if (!TOKEN_SHAPE.test(token)) return refuse();
    const tokenHash = await sha256Hex(token);
    // Keyed on the HASH, never the plaintext: the limiter persists its bucket durably, so keying on
    // the raw value would re-store the one credential we went to the trouble of never storing.
    if (await overRateLimit(db, `ad:tok:${tokenHash.slice(0, 32)}`, 10, 60, true)) {
      return json({ ok: false, error: "Too many attempts. Please wait a minute." }, 429);
    }

    const { data: signer } = await db.from("paige_agreement_signers")
      .select("agreement_id,token_expires_at,token_revoked_at")
      .eq("token_hash", tokenHash).maybeSingle();
    if (!signer) return refuse();
    if (signer.token_revoked_at) return refuse();
    if (!signer.token_expires_at || new Date(String(signer.token_expires_at)).getTime() <= Date.now()) return refuse();

    // The agreement is read FROM THE TOKEN ROW. No query parameter names or steers it.
    const { data: agreement } = await db.from("paige_agreements")
      .select("id,title,status,content_storage_key,sealed_storage_key")
      .eq("id", signer.agreement_id).maybeSingle();
    if (!agreement) return refuse();

    // ── ONE TOKEN, TWO DOCUMENTS, decided by the agreement's state — not by the caller ────────────
    // BEFORE completion the signing token opens the PRESENTED document: the exact frozen bytes the
    // signing record will later swear by. That capability existed, was deleted with the HTML page,
    // and its absence made the sealed record dishonest — it prints "SHA-256 of the file" over a file
    // the signer had no way to read. AFTER completion the retrieval token opens the SEALED copy.
    // The signer never names which; the row does.
    if (agreement.status === "completed") {
      if (!agreement.sealed_storage_key) return refuse();
      sealedKey = String(agreement.sealed_storage_key);
    } else if (["sent", "viewed", "partially_signed"].includes(String(agreement.status))) {
      if (!agreement.content_storage_key) return refuse();
      sealedKey = String(agreement.content_storage_key);
    } else {
      return refuse();
    }
    filename = safeFilename(String(agreement.title));
  } else {
    // ── DOOR TWO: the workspace's own session ────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader || !agreementParam) return refuse();

    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData } = await caller.auth.getUser();
    if (!userData?.user?.id) return refuse();

    // Tenant from the CALLER'S session, never from the request — the whole point of this engine's
    // §9 posture, and the exact inverse of `docusign-send-envelope`.
    const { data: tenantId } = await caller.rpc("current_user_tenant_id");
    if (!tenantId) return refuse();
    const { data: isAdmin } = await caller.rpc("is_tenant_admin", { _tenant: tenantId });
    if (isAdmin !== true) return refuse();

    const { data: agreement } = await db.from("paige_agreements")
      .select("id,title,status,sealed_storage_key")
      .eq("id", agreementParam).eq("tenant_id", tenantId).maybeSingle();
    if (!agreement || agreement.status !== "completed" || !agreement.sealed_storage_key) return refuse();
    sealedKey = String(agreement.sealed_storage_key);
    filename = safeFilename(String(agreement.title));
  }

  const file = await db.storage.from("paige-agreements").download(sealedKey);
  if (file.error || !file.data) {
    // A completed agreement whose sealed copy will not read is a real problem for the record, so it
    // is logged loudly rather than folded into the generic refusal in silence.
    console.error("[agreement-document] sealed document could not be read", {
      sealedKey, error: file.error?.message,
    });
    return json({
      ok: false,
      error: "This document is temporarily unavailable. Please try again shortly.",
    }, 503);
  }

  return new Response(await file.data.arrayBuffer(), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      // The bytes are a signed legal document. Nothing caches them anywhere but the reader's screen.
      "Cache-Control": "no-store, private",
    },
  });
});

/** A filename derived from the title, stripped of anything that could break the header or a path. */
function safeFilename(title: string): string {
  const base = title.replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
  return `${base || "agreement"}.pdf`;
}
