/** Transport extension for the EXISTING tenant Zapier Workflow API connector.
 * This owns no credentials, refresh, approval, Work, retry or receipt store.
 * It is server-only and must be mounted behind the original authenticated door.
 */
import { prepareZapierWorkflowRequest, projectZapierWorkflowResponse, type ZapierWorkflowRequest } from "./zapier-workflow-contract.ts";
import { createWeeklyDraftDeadline } from "./paige-orchestration/weekly-draft-deadline.ts";

export type ZapierWorkflowScope = Readonly<{ tenantId: string; actorId: string }>;
type Grant = { tenantId: string; generation: string; accessToken: string; scopes: readonly string[]; expiresAt: string };
export type ZapierWorkflowApiDeps = {
  /** ONE original native check atomically checks actor, workspace, role AND the
   * current grant generation when provided. Writes additionally require the
   * original Trust/Work claim for these exact captured bytes. That native check
   * is the admission/disclosure linearization point; never compose separately
   * awaited role and grant booleans or accept a caller/model-supplied flag. */
  verifyOriginalAuthority: (scope: ZapierWorkflowScope, request: ZapierWorkflowRequest, generation: string | null) => Promise<boolean>;
  /** Existing service-only tenant connector lookup/refresh, never model input. */
  loadGrant: (scope: ZapierWorkflowScope) => Promise<Grant | null>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
};
type ApiResult = { state: "refused" | "unavailable" | "outcome_unknown" | "observed" | "acknowledged"; code?: string; provider?: Record<string, unknown> };
const ORIGIN = "https://api.zapier.com";
const MAX_BYTES = 256 * 1024;

const cancelBody = (response: Response) => { void response.body?.cancel().catch(() => {}); };
export async function readZapierProviderJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) {
    cancelBody(response); throw new Error("response_invalid");
  }
  if (!response.body) throw new Error("response_invalid");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", stop, { once: true });
  let size = 0;
  try {
    while (true) {
      if (signal?.aborted) { stop(); throw new Error("response_aborted"); }
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) { stop(); throw new Error("response_invalid"); }
      chunks.push(next.value);
    }
  } finally { signal?.removeEventListener("abort", stop); reader.releaseLock(); }
  if (signal?.aborted) throw new Error("response_aborted");
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** No retry exists here. A write crossing the dispatch boundary remains UNKNOWN
 * until original provider readback reconciles it; a generic 2xx is not completed
 * onboarding. The host retains the original Work/result/receipt identity. */
export async function callZapierWorkflowApi(scope: ZapierWorkflowScope, operation: string, args: unknown,
  deps: ZapierWorkflowApiDeps): Promise<ApiResult> {
  let dispatched = false, retired = false;
  let request: ZapierWorkflowRequest;
  try { request = prepareZapierWorkflowRequest(operation, args); }
  catch { return { state: "refused", code: "invalid_arguments" }; }
  const uncertain = (code: string): ApiResult => ({ state: dispatched && request.effect !== "read" ? "outcome_unknown" : "unavailable", code });
  const snapshot = Object.freeze({ tenantId: scope.tenantId, actorId: scope.actorId });
  // Capture the expected identity before any caller-controlled asynchronous stage.
  const originalId = (args as Record<string, unknown>)?.workflow_id;
  const expectedId = typeof originalId === "string" ? originalId : undefined;
  const originalApp = (args as Record<string, unknown>)?.app;
  const expectedApp = typeof originalApp === "string" ? originalApp : undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const within = createWeeklyDraftDeadline(10000, () => !retired && !controller.signal.aborted);
  const timer = setTimeout(abort, 10000);
  deps.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (!snapshot.tenantId || !snapshot.actorId || deps.signal?.aborted
      || await within(() => deps.verifyOriginalAuthority(snapshot, request, null)) !== true) return { state: "refused", code: "authority_refused" };
    const rawGrant = await within(() => deps.loadGrant(snapshot));
    if (!rawGrant) return { state: "refused", code: "not_connected" };
    const grant = Object.freeze({ ...rawGrant, scopes: Object.freeze([...rawGrant.scopes]) });
    if (grant.tenantId !== snapshot.tenantId) return { state: "refused", code: "connection_scope_mismatch" };
    if (!grant.scopes.includes(request.requiredScope)) return { state: "refused", code: "scope_required" };
    if (!grant.generation || !grant.accessToken || !/^[A-Za-z0-9._~+/-]+=*$/.test(grant.accessToken)
      || grant.accessToken.length > 16384 || !Number.isFinite(Date.parse(grant.expiresAt))
      || Date.parse(grant.expiresAt) <= Date.now()) return { state: "refused", code: "authorization_expired" };
    if (await within(() => deps.verifyOriginalAuthority(snapshot, request, grant.generation)) !== true) return { state: "refused", code: "authority_refused" };
    const response = await within(() => {
      dispatched = true;
      return deps.fetch(`${ORIGIN}${request.path}`, { method: request.method, redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${grant.accessToken}`, Accept: "application/json", ...(request.body ? { "Content-Type": "application/json" } : {}) },
        ...(request.body ? { body: request.body } : {}) });
    });
    if (!response.ok) {
      cancelBody(response);
      if (response.status === 401 || response.status === 403) return { state: "refused", code: "provider_authorization_refused" };
      return uncertain("provider_response_unconfirmed");
    }
    const acknowledgement = operation === "pause" || operation === "resume";
    const raw = acknowledgement ? null : await within(() => readZapierProviderJson(response, controller.signal));
    if (acknowledgement) cancelBody(response);
    const projected = projectZapierWorkflowResponse(operation, raw, expectedId, expectedApp);
    if (await within(() => deps.verifyOriginalAuthority(snapshot, request, grant.generation)) !== true) return uncertain("authority_changed_after_dispatch");
    return { state: acknowledgement ? "acknowledged" : "observed", provider: projected };
  } catch { return uncertain("provider_response_unconfirmed"); }
  finally {
    retired = true; clearTimeout(timer); controller.abort();
    deps.signal?.removeEventListener("abort", abort);
  }
}
