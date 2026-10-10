/** Containment only: this endpoint grants no accounting-write authority. */
export async function refuseLegacyQuickBooksWrite(
  request: Request,
  resolveActor: () => Promise<string | null>,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const headers = { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: { ...headers, Allow: 'POST, OPTIONS' },
  });
  const authorization = request.headers.get('Authorization');
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }
  let actor: string | null;
  try { actor = await resolveActor(); } catch { actor = null; }
  if (!actor) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  // Never read provider rows, decrypt/refresh tokens, parse a target account,
  // or call accounting APIs. Authentication authorizes none of those effects.
  return new Response(JSON.stringify({
    error: 'ACCOUNTING_WRITE_UNAVAILABLE', reason: 'Accounting changes are unavailable', provider_effect: false,
  }), { status: 503, headers });
}
