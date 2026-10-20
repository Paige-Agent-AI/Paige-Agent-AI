// The public visit rules (INT-298 MBC 7a), kept pure so they can be proven without a network
// (src/__tests__/growth-public-visit.test.ts). growth-public-visit is the only caller: it decides WHETHER a visit
// may be recorded (origin, privacy signals, automated agents, rate) and what the record may hold; the database
// writer growth_public_visit_record decides which business it belongs to. Nothing here identifies a visitor.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^pv_[0-9a-f]{64}$/;
const HOST_RE = /^[a-z0-9.-]{1,253}$/;

export type VisitKind = "page" | "funnel" | "form";
export type VisitRequest = { kind: VisitKind; targetId: string; token: string | null; step: number };

/** Why a request must not be recorded at all, or null when it may be. A browser that asks not to be tracked
 *  (Do Not Track or Global Privacy Control) and a known automated agent are never counted, so every figure built
 *  on these records is "recorded visits", and says so. */
export function notRecordedReason(headers: Headers): "privacy_signal" | "automated_agent" | null {
  if (headers.get("dnt") === "1" || headers.get("sec-gpc") === "1") return "privacy_signal";
  const ua = (headers.get("user-agent") ?? "").toLowerCase();
  if (!ua) return "automated_agent";
  if (/bot|crawl|spider|slurp|headless|lighthouse|playwright|puppeteer|phantom|selenium|preview|facebookexternalhit|embedly|curl\/|wget\/|python-|go-http|java\/|okhttp|axios|node-fetch|httpclient|monitor|pingdom|uptime/.test(ua)) {
    return "automated_agent";
  }
  return null;
}

/** Only the host of the page that sent the visitor, lower-cased; nothing of its path or query, and nothing when
 *  it is not a well-formed http(s) address. */
export function referrerHost(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return HOST_RE.test(host) ? host : null;
}

/** The request a visitor's browser may send: what it is looking at, the visit it is continuing (if any) and, for a
 *  funnel, the step it reached. Anything else is not a visit. */
export function parseVisitRequest(body: unknown): VisitRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.kind !== "page" && b.kind !== "funnel" && b.kind !== "form") return null;
  if (typeof b.target_id !== "string" || !UUID_RE.test(b.target_id)) return null;
  const token = typeof b.token === "string" && TOKEN_RE.test(b.token) ? b.token : null;
  const step = b.kind === "funnel" && typeof b.step === "number" && Number.isInteger(b.step) && b.step >= 0 && b.step <= 1000 ? b.step : 0;
  return { kind: b.kind, targetId: b.target_id.toLowerCase(), token, step };
}

/** A visit token the browser may hand to growth-public-submit; anything else is ignored there. */
export function visitTokenOf(raw: unknown): string | null {
  return typeof raw === "string" && TOKEN_RE.test(raw) ? raw : null;
}
