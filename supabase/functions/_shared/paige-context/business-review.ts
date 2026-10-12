/**
 * Business review — the one composition entry point behind "How is my business performing this week,
 * and what needs my attention?" (Operating Fabric F2a).
 *
 * WHAT IT IS. A read-only assembly: resolve the period, build the domain adapters that exist today
 * (`payments` and `sales_pipeline` over the Sales department's governed measurements — F2a; `operations`
 * over Operations' and `clients` over Client Experience's — F2b; all through the one metric issuer), compose the
 * Business Operating Snapshot through the F1 seam (`./snapshot.ts`), and render its bounded projection.
 * Every other requested domain is reported honestly by the composer: not connected, or not wired yet.
 *
 * WHAT IT IS NOT. It is not a tool definition or a Spine registration itself — those live in
 * `_shared/paige-context/business-review-chat.ts` and `_shared/paige-spine/domains/business-review.ts`
 * (E2-1, PR #2075, ship-dark: wired, and unreachable from a typed Solo turn while INT-346 holds).
 * This module is the composition entry point the tool dispatch calls.
 *
 * SCOPE IS OBSERVED, NOT ASSUMED. The caller is the authenticated user's client. It is wrapped so every
 * `current_user_tenant_id()` answer it returns — including the ones the metric reads make before and
 * after each measurement — becomes the composer's live scope epoch. The workspace is read once before
 * composing (a mismatch reads nothing) and once after (a switch voids every domain as `scope_changed`).
 *
 * READ-ONLY CARVE-OUT, stated plainly: the metric issuer writes short-lived evidence references and
 * revokes the caller's previous one for the same metric and range. Nothing here persists a value.
 */

import type { MetricCaller } from "../analytics-metrics/read.ts";
import { contextDegraded, degradationLedger, type AccountShape, type ContextIdentity, type ContextSourceResult } from "./mod.ts";
import {
  composeOperatingSnapshot,
  projectOperatingSnapshot,
  resolveSnapshotPeriod,
  selectSnapshotDomains,
  SNAPSHOT_MAX_TIMEOUT_MS,
  SNAPSHOT_REASON,
  type BusinessOperatingSnapshot,
  type DomainSnapshot,
} from "./snapshot.ts";
import { createClientsSnapshotAdapter } from "./adapters/clients.ts";
import { createOperationsSnapshotAdapter } from "./adapters/operations.ts";
import { createPaymentsSnapshotAdapter } from "./adapters/payments.ts";
import { createSalesPipelineSnapshotAdapter } from "./adapters/sales-pipeline.ts";

export const BUSINESS_REVIEW_DEFAULT_PERIOD = "last_7_days";
/** Each metric read is several RPCs and an adapter reads up to four metrics one after another. */
export const BUSINESS_REVIEW_DEFAULT_TIMEOUT_MS = 10_000;

export type BusinessReviewWho = {
  readonly actorId: string;
  readonly tenantId: string | null;
  readonly role: string | null;
  readonly accountShape: AccountShape | null;
};

export type BusinessReviewRequest = {
  /** A snapshot period key; default `last_7_days`. */
  readonly period?: string;
  /** IANA time zone the period is computed in. */
  readonly timezone: string;
  readonly customStart?: string;
  readonly customEnd?: string;
  /** Plain-language areas to focus on; none → the default review set. */
  readonly focus?: readonly string[];
};

export type BusinessReviewResult =
  | { readonly ok: true; readonly snapshot: BusinessOperatingSnapshot; readonly projection: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The latest workspace the caller's own client reported. Never a tenant id: a failed or unreadable answer
 * leaves this value, which no real workspace equals, so the scope check fails closed.
 */
const SCOPE_UNREADABLE = "\u0000scope_unreadable";

const SCOPE_RPC = "current_user_tenant_id";

/** A workspace answer, or SCOPE_UNREADABLE for an error, an empty answer or a thrown call. */
function scopeAnswer(result: { data: unknown; error: unknown } | null | undefined): string {
  return !result?.error && typeof result?.data === "string" && result.data !== "" ? result.data : SCOPE_UNREADABLE;
}

function observingCaller(caller: MetricCaller): { readonly caller: MetricCaller; readonly latest: () => string } {
  let latestTenant = SCOPE_UNREADABLE;
  const observed: MetricCaller = {
    rpc(name, args) {
      if (name !== SCOPE_RPC) return caller.rpc(name, args);
      let pending: PromiseLike<{ data: unknown; error: { code?: string } | null }>;
      try {
        pending = caller.rpc(name, args);
      } catch (error) {
        latestTenant = SCOPE_UNREADABLE;
        return Promise.reject(error);
      }
      return Promise.resolve(pending).then(
        (result) => {
          latestTenant = scopeAnswer(result);
          return result;
        },
        (error) => {
          latestTenant = SCOPE_UNREADABLE;
          throw error;
        },
      );
    },
  };
  return { caller: observed, latest: () => latestTenant };
}

/**
 * One explicit workspace read through the observing caller, bounded by `timeoutMs`. Returns THIS
 * read's answer — never a later one from a read still in flight — and SCOPE_UNREADABLE when it failed
 * or did not answer in time, so a hung workspace lookup fails closed instead of hanging the review.
 */
async function readScope(caller: MetricCaller, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(SCOPE_UNREADABLE), timeoutMs);
  });
  let answer: Promise<string>;
  try {
    answer = Promise.resolve(caller.rpc(SCOPE_RPC)).then(scopeAnswer, () => SCOPE_UNREADABLE);
  } catch {
    answer = Promise.resolve(SCOPE_UNREADABLE);
  }
  try {
    return await Promise.race([answer, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Every domain voided: the workspace changed after the reads, so nothing from them survives. */
function voidForScopeChange(snapshot: BusinessOperatingSnapshot): BusinessOperatingSnapshot {
  const domains: Record<string, ContextSourceResult<DomainSnapshot>> = {};
  for (const d of snapshot.requested) domains[d] = contextDegraded<DomainSnapshot>(SNAPSHOT_REASON.scopeChanged);
  return { ...snapshot, domains, degradation: [...degradationLedger(domains)] };
}

/**
 * Compose one business review. `caller` must be the authenticated user's own client (caller JWT): the
 * server re-resolves workspace, membership and role on every read. `who` is what the runtime already
 * resolved for this turn; nothing in `request` can widen it. Returns a refusal only for a bad period;
 * every other gap is inside the snapshot with a reason.
 */
export async function composeBusinessReview(
  caller: MetricCaller,
  who: BusinessReviewWho,
  request: BusinessReviewRequest,
  opts?: { readonly now?: Date; readonly timeoutMs?: number; readonly clock?: () => number },
): Promise<BusinessReviewResult> {
  const now = opts?.now ?? new Date();
  const injectedNow = opts?.now;
  const clock = opts?.clock ?? (injectedNow !== undefined ? () => injectedNow.getTime() : Date.now);

  const resolved = resolveSnapshotPeriod({
    key: request.period ?? BUSINESS_REVIEW_DEFAULT_PERIOD,
    now,
    timezone: request.timezone,
    customStart: request.customStart,
    customEnd: request.customEnd,
  });
  // `in` narrows under both strict and the app tsconfig (strict:false).
  if ("reason" in resolved) return { ok: false, reason: resolved.reason };
  const period = resolved.period;

  const scope = observingCaller(caller);
  const tenantId = who.tenantId;
  const identity: ContextIdentity = {
    actorId: who.actorId,
    tenantId,
    workspaceId: tenantId,
    role: who.role,
    actAsClientId: null,
    accountShape: who.accountShape,
    scopeEpoch: tenantId ?? SCOPE_UNREADABLE,
  };
  const domains = selectSnapshotDomains({ focus: request.focus });
  const adapters = [
    createPaymentsSnapshotAdapter(scope.caller, { tenantId }, clock),
    createSalesPipelineSnapshotAdapter(scope.caller, { tenantId }, clock),
    createOperationsSnapshotAdapter(scope.caller, { tenantId }, clock),
    createClientsSnapshotAdapter(scope.caller, { tenantId }, clock),
  ];
  // Clamped the way the composer clamps it, so the workspace reads share the adapters' budget.
  const asked = opts?.timeoutMs;
  const whole = typeof asked === "number" && Number.isFinite(asked) ? Math.floor(asked) : 0;
  const timeoutMs = whole >= 1 ? Math.min(whole, SNAPSHOT_MAX_TIMEOUT_MS) : BUSINESS_REVIEW_DEFAULT_TIMEOUT_MS;

  // No workspace: the composer reports it for every domain, with no read and no RPC. Otherwise the
  // workspace is read first; a mismatch, an error or no answer in time makes the composer void every
  // domain before any adapter runs. Its getter is then pinned to "unreadable", so a late answer from
  // the timed-out lookup cannot reopen the scope.
  const hasWorkspace = tenantId !== null && tenantId !== "";
  const held = hasWorkspace && (await readScope(scope.caller, timeoutMs)) === tenantId;

  let snapshot = await composeOperatingSnapshot({
    identity,
    period,
    domains,
    adapters,
    now,
    currentScopeEpoch: held ? scope.latest : () => SCOPE_UNREADABLE,
    timeoutMs,
  });

  // The composer re-checked the last answer it saw; read the workspace once more, explicitly and
  // bounded, after every adapter has settled. A switch, an error or no answer still voids everything.
  if (held && (await readScope(scope.caller, timeoutMs)) !== tenantId) {
    snapshot = voidForScopeChange(snapshot);
  }

  return { ok: true, snapshot, projection: projectOperatingSnapshot(snapshot) };
}
