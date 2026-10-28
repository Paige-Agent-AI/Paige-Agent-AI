// The REAL HTTPS verification behind any "the hosted copy is live" claim (WEB-07's rule, held
// since the domain spine: a name is web_live only when the address actually serves the content
// over HTTPS — a provider dashboard saying "deployed" is never enough).
//
// This module FETCHES the deployed address and compares the served bytes with the exported bytes.
// It never throws outward: every failure is a structured reason. Verification failure does not
// remove the deployment — the door records `verify_failed` and a human decides (the guidance's
// recovery step exists for exactly this).

export interface VerificationResult {
  verified: boolean;
  /** The HTTP status the address actually answered with (when it answered). */
  status?: number;
  /** The address actually served (after redirects), when it differs from the requested one. */
  finalUrl?: string;
  reason?: "not_https" | "unreachable" | "http_error" | "content_mismatch";
}

export async function verifyHttpsDeployment(
  url: string,
  expectedHtml: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerificationResult> {
  if (!/^https:\/\//i.test(url)) return { verified: false, reason: "not_https" };
  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: "follow", headers: { "user-agent": "Paige-hosting-verification/1" } });
  } catch {
    return { verified: false, reason: "unreachable" };
  }
  if (!res.ok) return { verified: false, status: res.status, reason: "http_error" };
  const finalUrl = res.url || url;
  if (!/^https:\/\//i.test(finalUrl)) return { verified: false, status: res.status, finalUrl, reason: "not_https" };
  let body: string;
  try {
    body = await res.text();
  } catch {
    return { verified: false, status: res.status, reason: "unreachable" };
  }
  if (body !== expectedHtml) return { verified: false, status: res.status, finalUrl, reason: "content_mismatch" };
  return { verified: true, status: res.status, finalUrl };
}
