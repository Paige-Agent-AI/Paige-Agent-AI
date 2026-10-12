import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Legacy callback did not consume nonce or establish company ownership.
// Refuse before code/state inspection, tokens, provider calls or private rows.
serve(async (req) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...headers, Allow: "GET, OPTIONS" } });
  return new Response(JSON.stringify({ error: "PROVIDER_LIFECYCLE_UNAVAILABLE", reason: "Company connection authorization is unavailable", provider_effect: false }), { status: 503, headers });
});
