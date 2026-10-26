// cf-stream-verify — EXP10 one-shot READ-ONLY canary for the Cloudflare Stream backend
// API wiring (owner directives 2026-10-24/25).
//
// WHAT THIS IS: the owner verified a test video uploads and plays in the Cloudflare
// dashboard; what remains UNVERIFIED is that PAIGE's backend can reach the Stream API
// with the production-saved secrets. This probe answers exactly that: it reads
// CLOUDFLARE_STREAM_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from the edge environment (the
// ONLY place the token ever exists server-side), performs ONE GET of the single
// hardcoded test video UID, and returns ONLY non-secret metadata: {ok, uid, status,
// duration, created, account_id_match}. The token value is NEVER echoed, logged, or
// returned — any failure returns only a closed code.
//
// WHY verify_jwt=false: this is a GET-reachable read-only canary over an ALREADY-PUBLIC
// video (the owner's test upload plays publicly); the response discloses nothing beyond
// what the video's public player already shows. It is deployed for verification and is
// retired or absorbed into the governed media door in the implementation PR. Precedent:
// security-canary-probe. No write path exists here — the function cannot create, modify,
// or delete anything in Cloudflare.

const TEST_VIDEO_UID = "650092261481ddfac3d4da12d3b9aff3";
const EXPECTED_ACCOUNT = "ba54ec3b1c0b5b0cb4a928d384aeda12";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // Read-only canary: GET only. Anything else is refused without touching Cloudflare.
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405, headers: cors });
  }

  const token = Deno.env.get("CLOUDFLARE_STREAM_API_TOKEN");
  const account = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  // Secret PRESENCE only — the value never crosses this line in any response or log.
  if (!token || !account) {
    return new Response(
      JSON.stringify({ ok: false, error: "secrets_missing", detail: {
        token_present: typeof token === "string" && token.length > 0,
        account_present: typeof account === "string" && account.length > 0 } }),
      { status: 503, headers: cors });
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/stream/${TEST_VIDEO_UID}`,
      { headers: { Authorization: `Bearer ${token}` }, method: "GET" },
    );
    // Closed-vocabulary failure: only the HTTP status crosses, never provider prose
    // (which could echo request material) and never our credential.
    if (!res.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "cloudflare_refused", http_status: res.status }),
        { status: 200, headers: cors });
    }
    const body = await res.json();
    const v = (body?.result ?? {}) as Record<string, unknown>;
    return new Response(JSON.stringify({
      ok: true,
      uid: v.uid ?? null,
      status: v.status ?? null,
      duration: typeof v.duration === "number" ? v.duration : null,
      created: v.created ?? null,
      // The expected account is owner-published coordination data, not a secret.
      account_id_match: account === EXPECTED_ACCOUNT,
    }), { status: 200, headers: cors });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "transport_failed" }), {
      status: 200, headers: cors });
  }
});
