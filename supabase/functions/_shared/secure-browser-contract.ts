/**
 * Paige-owned Secure Browser contract.
 *
 * This file contains only Paige vocabulary and no secret-bearing fields. A worker adapter may
 * implement the interface only after the separately documented external gates are cleared.
 * Until then, the control plane returns typed unavailability.
 */

export const SECURE_BROWSER_CAPABILITY_KEY = "paige_secure_browser";

export const secureBrowserLifecycleStates = [
  "requested",
  "unavailable",
  "opening",
  "awaiting_owner",
  "owner_control",
  "ready",
  "observing",
  "paused",
  "closing",
  "closed",
  "expired",
  "revoked",
  "failed",
  "outcome_unknown",
] as const;

export type SecureBrowserLifecycleState = typeof secureBrowserLifecycleStates[number];

export type SecureBrowserAuthorityState =
  | "authorized"
  | "not_authorized"
  | "unresolved"
  | "expired"
  | "revoked";

export type SecureBrowserScope = {
  mode: "read_only" | "propose_only";
  allowedOrigins: string[];
  allowedReadKinds: Array<"page_text" | "status" | "date" | "document_list">;
  downloads: "quarantine_only" | "disabled";
  consequentialActions: "disabled";
};

export type SecureBrowserSessionView = {
  id: string;
  threadId: string;
  purpose: string;
  targetOrigin: string;
  targetDisplayHost: string;
  scope: SecureBrowserScope;
  authority: SecureBrowserAuthorityState;
  state: SecureBrowserLifecycleState;
  stateVersion: number;
  safeReason: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SecureBrowserReceiptOutcome =
  | "succeeded"
  | "failed"
  | "refused"
  | "unreachable"
  | "outcome_unknown"
  | "completed_unrecorded";

export type SecureBrowserSafeObservation = {
  kind: "status" | "date" | "document_list" | "bounded_text";
  summary: string;
  fields: Record<string, string | number | boolean | null>;
  sourceOrigin: string;
  observedAt: string;
};

export type SecureBrowserGovernedAction = {
  actionKind: string;
  actionFingerprint: string;
  targetOrigin: string;
  summary: string;
  amountMinor?: number;
  currency?: string;
};

export type SecureBrowserUnavailableReason =
  | "feature_not_enabled"
  | "limits_not_configured"
  | "workspace_paused"
  | "worker_under_setup"
  | "budget_exhausted"
  | "concurrency_exhausted"
  | "context_busy"
  | "connection_not_available"
  | "download_unavailable"
  | "action_execution_disabled";

export type SecureBrowserOpenRequest = {
  threadId: string;
  purpose: string;
  target: string;
  scope: SecureBrowserScope;
  idempotencyKey: string;
};

export type SecureBrowserOpenResult =
  | { ok: true; session: SecureBrowserSessionView }
  | {
      ok: false;
      session: SecureBrowserSessionView | null;
      status: "unavailable" | "refused" | "failed";
      reason: SecureBrowserUnavailableReason;
    };

export type SecureBrowserControlCommand = "pause" | "resume" | "close" | "revoke";

export interface SecureBrowserWorker {
  openSession(input: SecureBrowserOpenRequest): Promise<SecureBrowserOpenResult>;
  handControl(sessionId: string): Promise<{ ok: boolean; state: SecureBrowserLifecycleState }>;
  returnControl(sessionId: string): Promise<{ ok: boolean; state: SecureBrowserLifecycleState }>;
  observe(sessionId: string, intent: string): Promise<SecureBrowserSafeObservation>;
  executeGovernedAction(
    sessionId: string,
    action: SecureBrowserGovernedAction,
    authorityRunId: string,
  ): Promise<{ outcome: SecureBrowserReceiptOutcome; verified: boolean }>;
  captureDownload(sessionId: string): Promise<{ ok: false; reason: "download_unavailable" }>;
  closeSession(sessionId: string): Promise<{ ok: boolean; state: SecureBrowserLifecycleState }>;
  emergencyStop(scope: { tenantId?: string; sessionId?: string }): Promise<{ ok: boolean }>;
}

const SENSITIVE_KEYS = /(?:password|passwd|secret|token|cookie|authorization|html|page_source|screenshot|replay|live.?view|mfa|otp|context.?id|provider)/i;
const LABELED_SECRET_VALUE = /(?:password|passwd|passcode|api[-_ ]?key|client[-_ ]?secret|secret|access[-_ ]?token|refresh[-_ ]?token|session[-_ ]?token|token|authorization|cookie|mfa(?:[-_ ]?code)?|otp)\s*(?:is|=|:)\s*["'`]?\S{4,}/i;
const BEARER_VALUE = /\bbearer\s+[a-z0-9._~+/-]{8,}={0,2}\b/i;
const JWT_VALUE = /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i;

function containsSensitiveBrowserValue(value: string): boolean {
  return LABELED_SECRET_VALUE.test(value) || BEARER_VALUE.test(value) || JWT_VALUE.test(value);
}

export function normalizeSecureBrowserPurpose(raw: string): string {
  const purpose = raw.trim();
  if (purpose.length < 3 || purpose.length > 1000) {
    throw new Error("secure_browser_purpose_invalid");
  }
  if (containsSensitiveBrowserValue(purpose)) {
    throw new Error("secure_browser_sensitive_value");
  }
  return purpose;
}

export function assertNoSensitiveBrowserMaterial(value: unknown, path = "payload"): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (containsSensitiveBrowserValue(value)) throw new Error(`secure_browser_sensitive_value:${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveBrowserMaterial(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(key)) throw new Error(`secure_browser_sensitive_field:${path}.${key}`);
    assertNoSensitiveBrowserMaterial(nested, `${path}.${key}`);
  }
}

export function normalizeSecureBrowserTarget(raw: string): { origin: string; displayHost: string } {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:") throw new Error("secure_browser_https_target_required");
  if (url.username || url.password) throw new Error("secure_browser_target_credentials_forbidden");
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    throw new Error("secure_browser_public_target_required");
  }
  return { origin: url.origin, displayHost: url.hostname.toLocaleLowerCase() };
}

export function validateSecureBrowserScope(value: unknown): SecureBrowserScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("secure_browser_scope_invalid");
  }
  assertNoSensitiveBrowserMaterial(value);
  const candidate = value as Partial<SecureBrowserScope>;
  if (candidate.mode !== "read_only" && candidate.mode !== "propose_only") {
    throw new Error("secure_browser_scope_mode_invalid");
  }
  if (candidate.consequentialActions !== "disabled") {
    throw new Error("secure_browser_action_execution_disabled");
  }
  if (candidate.downloads !== "quarantine_only" && candidate.downloads !== "disabled") {
    throw new Error("secure_browser_download_scope_invalid");
  }
  if (!Array.isArray(candidate.allowedOrigins) || candidate.allowedOrigins.length < 1 || candidate.allowedOrigins.length > 10) {
    throw new Error("secure_browser_origins_invalid");
  }
  const allowedOrigins = candidate.allowedOrigins.map((origin) => normalizeSecureBrowserTarget(origin).origin);
  const allowedKinds = new Set(["page_text", "status", "date", "document_list"]);
  if (!Array.isArray(candidate.allowedReadKinds) || candidate.allowedReadKinds.length < 1 ||
      candidate.allowedReadKinds.some((kind) => !allowedKinds.has(kind))) {
    throw new Error("secure_browser_read_scope_invalid");
  }
  return {
    mode: candidate.mode,
    allowedOrigins: [...new Set(allowedOrigins)],
    allowedReadKinds: [...new Set(candidate.allowedReadKinds)],
    downloads: candidate.downloads,
    consequentialActions: "disabled",
  } as SecureBrowserScope;
}

/** Deliberately inert until the vendor and credential gates are independently cleared. */
export class UnavailableSecureBrowserWorker implements SecureBrowserWorker {
  async openSession(): Promise<SecureBrowserOpenResult> {
    return { ok: false, session: null, status: "unavailable", reason: "worker_under_setup" };
  }
  async handControl(): Promise<{ ok: boolean; state: SecureBrowserLifecycleState }> {
    return { ok: false, state: "unavailable" };
  }
  async returnControl(): Promise<{ ok: boolean; state: SecureBrowserLifecycleState }> {
    return { ok: false, state: "unavailable" };
  }
  async observe(): Promise<SecureBrowserSafeObservation> {
    throw new Error("secure_browser_worker_under_setup");
  }
  async executeGovernedAction(): Promise<{ outcome: SecureBrowserReceiptOutcome; verified: boolean }> {
    return { outcome: "refused", verified: false };
  }
  async captureDownload(): Promise<{ ok: false; reason: "download_unavailable" }> {
    return { ok: false, reason: "download_unavailable" };
  }
  async closeSession(): Promise<{ ok: boolean; state: SecureBrowserLifecycleState }> {
    return { ok: true, state: "closed" };
  }
  async emergencyStop(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}
