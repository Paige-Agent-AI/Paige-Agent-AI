// _shared/service-role-bearer.ts — is this request from a platform edge function, and nothing else?
//
// For an internal-only function whose ONLY legitimate caller is another edge function holding the
// service-role key. The gateway's verify_jwt is not that check: the public publishable (anon) key is a
// validly signed token, and so is any signed-in person's JWT. This accepts exactly one bearer, the
// service-role key, compared in constant time. A cron token is NOT accepted here — a function that
// cron also calls uses `isAuthorizedInternalCaller` in `systems-check-http.ts` instead.
//
// Pure: no env read, no network. The caller passes the key it already holds.

const encoder = new TextEncoder();

/** The bearer token in an Authorization header value, or null when there is none. */
export function bearerToken(authorization: string | null | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec((authorization ?? "").trim());
  const token = m?.[1]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

/** Constant-time equality over the UTF-8 bytes. Runs the full length of the longer input. */
export function constantTimeEquals(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * True only when the Authorization header carries the service-role key itself. Fails closed: no
 * header, a non-Bearer scheme, an empty token, or an unset or whitespace-only key all return false.
 */
export function isServiceRoleBearer(
  authorization: string | null | undefined,
  serviceKey: string | null | undefined,
): boolean {
  // Trimmed like the token: an env value with a trailing newline must not 401 the only producer
  // (fetch strips trailing whitespace from the header it sends).
  const key = (serviceKey ?? "").trim();
  if (!key) return false;
  const token = bearerToken(authorization);
  if (!token) return false;
  return constantTimeEquals(token, key);
}
