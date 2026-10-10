// INT-334 — WHY A MODEL CALL FAILED, as the provider's own response proves it. One home (§18) for the
// classification the Model Fabric's fallback decision (paige-turn/route.ts `mayFallback`) and the
// trace's error record both read.
//
// The 2026-10-06 Anthropic outage was recorded as `issue_codes: ["unclassified"]` for three hours:
// the capture deliberately keeps no provider text (it can echo request material), so nothing could
// say what the 400s were. This classifier reads the response's status, its error type, its error
// code and a small set of recognised message phrases IN MEMORY, and returns only a closed class.
// The message itself is never returned, stored or logged.
//
// IT NEVER INFERS. A class is assigned only when the response proves it (a status, a provider error
// type or code, or a phrase the provider uses for exactly that condition). Body length, timing, or
// "it is probably billing" are not evidence: anything unproven is `unknown`. A 400 the provider does
// not attribute to billing or limits is `invalid_request` — another provider would get the same
// broken request, so it is never a reason to fall back.
//
// Pure TypeScript, no imports.

export const PROVIDER_FAILURE_CLASSES = [
  "auth_config",       // the key or configuration is missing or rejected
  "billing",           // the provider said the account lacks credit / has a billing problem
  "rate_limit",        // a rate, usage or spend limit the provider named
  "model_unavailable", // the model does not exist or this key may not use it
  "invalid_request",   // the provider attributed the failure to the request
  "provider_outage",   // a server-side error, overload, timeout or broken connection
  "unknown",
] as const;
export type ProviderFailureClass = (typeof PROVIDER_FAILURE_CLASSES)[number];

export interface ProviderFailureEvidence {
  provider: "anthropic" | "openai" | "featherless" | "groq" | string;
  /** HTTP status; 0 for a request that never got a response. */
  status: number;
  /** The provider's error type (`error.type`), when the body parsed. */
  errorType?: string | null;
  /** The provider's error code (`error.code`), when it has one (OpenAI). */
  errorCode?: string | null;
  /** The provider's message — read here, never kept. */
  message?: string | null;
  /** The request never got a response: a timeout, an abort or a reset connection. */
  transport?: "timeout" | "network" | null;
}

const BILLING = /\bcredit balance\b|\binsufficient (?:credit|funds|balance)\b|\bbilling\b|\bpayment (?:required|method)\b|\bquota exceeded\b|\bexceeded your current quota\b/i;
const LIMIT = /\b(?:usage|spend(?:ing)?|rate) limits?\b|\breached your (?:specified )?(?:api )?usage limit\b|\btoo many requests\b/i;
const MODEL = /\bmodel\b[^.]{0,60}\b(?:not found|does not exist|not available|not supported|deprecated|access)\b|\bno access to (?:the )?model\b/i;

export function classifyProviderFailure(e: ProviderFailureEvidence): ProviderFailureClass {
  if (e.transport === "timeout" || e.transport === "network") return "provider_outage";
  const status = Number.isFinite(e.status) ? e.status : 0;
  const type = (e.errorType ?? "").toLowerCase();
  const code = (e.errorCode ?? "").toLowerCase();
  const msg = typeof e.message === "string" ? e.message.slice(0, 2000) : "";

  // Codes and types the providers define for exactly these conditions.
  if (code === "insufficient_quota" || code === "billing_hard_limit_reached" || code === "billing_not_active") return "billing";
  if (code === "rate_limit_exceeded" || type === "rate_limit_error") return "rate_limit";
  if (code === "model_not_found" || type === "not_found_error") return "model_unavailable";
  if (type === "authentication_error" || code === "invalid_api_key" || status === 401) return "auth_config";
  if (type === "permission_error" || status === 403) return MODEL.test(msg) ? "model_unavailable" : "auth_config";
  if (type === "overloaded_error" || type === "api_error" || status === 529 || (status >= 500 && status <= 599)) return "provider_outage";

  if (status === 429) {
    if (BILLING.test(msg)) return "billing";
    return "rate_limit";
  }
  if (status === 402) return "billing";
  if (status === 404) return MODEL.test(msg) ? "model_unavailable" : "unknown";
  if (status === 400 || status === 413 || status === 422 || type === "invalid_request_error") {
    // A 400 is the request's fault unless the provider says otherwise in words it uses for that.
    if (BILLING.test(msg)) return "billing";
    if (LIMIT.test(msg)) return "rate_limit";
    if (MODEL.test(msg)) return "model_unavailable";
    return msg || type ? "invalid_request" : "unknown";
  }
  return "unknown";
}
