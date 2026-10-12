/**
 * `clients` Domain Snapshot adapter (Operating Fabric F2b) — a projection over the Client Experience
 * department's governed measurements. Owner: `client_experience` (the producer's owning department for
 * `business.*` keys; this adapter only shapes the figures).
 *
 * What it reads, one at a time, through `readBusinessMetric` only (via `./issuer-metric.ts`):
 *   a) active clients now           → clients.active                                   (right now)
 *   b) where clients are now        → clients.paused, clients.churned, clients.past    (right now)
 *   c) where onboarding stands now  → clients.onboarding_in_progress,
 *                                     clients.onboarding_completed                     (right now)
 *
 * Every figure is current state; no client history exists to compare, so this domain never carries a
 * change. Leads are NOT clients here: the producer counts client stages only, and leads belong to the
 * sales pipeline and campaigns. Two questions an owner will ask have no governed source at all — new
 * clients in the period and clients at risk — and the coverage note says so every time rather than
 * leaving a silence that reads as zero. That standing note goes LAST and is kept to one short clause:
 * the note is bounded for length, and a gap found in this read (onboarding not recorded, a figure the
 * source calls incomplete) must never be the part that gets cut.
 *
 * §2: one producer stage carries finance wording. It is folded into "past clients" with alumni, and that
 * word never appears in any label, note or key this adapter writes.
 */

import type { MetricCaller } from "../../analytics-metrics/read.ts";
import { contextDegraded, type ContextSourceResult } from "../mod.ts";
import type { DomainSnapshot, DomainSnapshotAdapter } from "../snapshot.ts";
import {
  closedBuckets,
  countFigure,
  droppedBucketNote,
  emptyIssuerDraft,
  finishIssuerSnapshot,
  ISSUER_METRIC_REASON,
  ISSUER_NOTE,
  noteIssuerSource,
  pushIssuerHeadline,
  readIssuerFigure,
  SETTINGS_PRODUCER_DEFINITIONAL_EXCLUSION,
  type ClosedBucketMap,
  type IssuerMetric,
  type IssuerSnapshotDraft,
} from "./issuer-metric.ts";

export const CLIENTS_ADAPTER_ID = "clients.issuer_metrics.v1";
/** The producer's owning department for every `business.*` key (settings producer, owner CASE). */
export const CLIENTS_OWNER = "client_experience";

export const CLIENTS_METRICS = {
  active: "business.active_clients_current",
  lifecycle: "business.lifecycle_current",
  onboarding: "business.onboarding_current",
} as const;

/**
 * The producer's client stages (clients_lifecycle_stage_check, 20260629160438) → this adapter's buckets.
 * `client_active` is known and not shown here (read a counts it under its own definition). Any other key
 * — a lead stage included — is unknown to this map and is dropped and counted, never shown.
 */
const LIFECYCLE_MAP: ClosedBucketMap = {
  client_active: null,
  client_paused: "paused",
  client_churned: "churned",
  client_funded: "past",
  client_alumni: "past",
};

/**
 * The onboarding stages the clients table accepts (clients_onboarding_stage_check, 20260629160438).
 * `pre_invite` is known and not shown: the producer itself says it does not establish onboarding.
 */
const ONBOARDING_MAP: ClosedBucketMap = {
  pre_invite: null,
  invited: "in_progress",
  signing_agreement: "in_progress",
  accepting_payment: "in_progress",
  completing_intake: "in_progress",
  uploading_docs: "in_progress",
  completed: "completed",
};

const ACTIVE = { key: "clients.active", label: "Active clients (leads are not counted here)", noun: "active clients" } as const;
const LIFECYCLE = {
  noun: "clients by stage",
  figures: [
    { bucket: "paused", key: "clients.paused", label: "Paused clients" },
    { bucket: "churned", key: "clients.churned", label: "Clients who have left" },
    { bucket: "past", key: "clients.past", label: "Past clients (finished working together)" },
  ],
} as const;
const ONBOARDING = {
  noun: "client onboarding",
  hiddenNote: (n: number) =>
    `${n === 1 ? "one client is" : `${n} clients are`} at the stage before the onboarding invitation and not counted as onboarding`,
  figures: [
    { bucket: "in_progress", key: "clients.onboarding_in_progress", label: "Clients part-way through onboarding" },
    { bucket: "completed", key: "clients.onboarding_completed", label: "Clients who finished onboarding" },
  ],
} as const;

export const CLIENTS_NOTE = {
  // One clause covering both standing gaps and where leads live; short so it rarely competes for length.
  standing: "new clients this period and clients at risk are not measured yet; leads are counted under sales",
  onboardingNotRecorded: "onboarding steps are not being recorded, so onboarding progress is unknown",
  noClientsToOnboard: "there are no clients to onboard yet",
  onboardingPartlyRecorded: "some clients' onboarding steps are not recorded, so onboarding counts are incomplete",
} as const;

function addBuckets(
  draft: IssuerSnapshotDraft,
  metric: IssuerMetric,
  partial: boolean,
  map: ClosedBucketMap,
  group: {
    readonly noun: string;
    readonly figures: readonly { readonly bucket: string; readonly key: string; readonly label: string }[];
    /** Said when known-but-not-shown records exist, so a hidden bucket never reads as zero. */
    readonly hiddenNote?: (n: number) => string;
    /** Said instead of the generic note when the read is partial, naming what may be missing. */
    readonly partialNote?: string;
  },
): void {
  const buckets = closedBuckets(metric, map);
  for (const f of group.figures) {
    pushIssuerHeadline(draft, {
      key: f.key,
      label: f.label,
      // Absent from a COMPLETE distribution is a real zero for that bucket. Absent from a partial one is
      // unknown: the records the producer left out may belong there, so it is null, never an inferred 0.
      // A positive count still stands either way.
      value: buckets.counts[f.bucket] ?? (partial ? null : 0),
      unit: "count",
      basis: "point_in_time",
    }, group.noun);
  }
  if (partial) draft.notes.push(group.partialNote ?? ISSUER_NOTE.partial(group.noun));
  if (buckets.dropped > 0) draft.notes.push(droppedBucketNote(group.noun, buckets.dropped));
  if (buckets.hidden > 0 && group.hiddenNote !== undefined) draft.notes.push(group.hiddenNote(buckets.hidden));
}

/**
 * The clients adapter. Same rules as the Sales adapters: `caller` is the authenticated user's own
 * client (every read re-resolves workspace and role on the server), the scope must equal the composer's
 * identity, reads run one after another, and the abort signal is checked before each.
 */
export function createClientsSnapshotAdapter(
  caller: MetricCaller,
  scope: { readonly tenantId: string | null },
  clock: () => number = Date.now,
): DomainSnapshotAdapter {
  return {
    domain: "clients",
    owner: CLIENTS_OWNER,
    async read(ctx): Promise<ContextSourceResult<DomainSnapshot>> {
      if (ctx.identity.tenantId !== scope.tenantId) return contextDegraded(ISSUER_METRIC_REASON.scopeMismatch);
      const aborted = () => ctx.signal?.aborted === true;
      const tenantId = scope.tenantId;
      const draft = emptyIssuerDraft();

      // a) active clients now
      if (aborted()) return contextDegraded(ISSUER_METRIC_REASON.aborted);
      const active = await readIssuerFigure(caller, tenantId, CLIENTS_METRICS.active, ctx.period, ctx.now, {
        kind: "count",
        ownerDepartment: CLIENTS_OWNER,
        definitionalExclusions: [SETTINGS_PRODUCER_DEFINITIONAL_EXCLUSION],
      }, clock);
      if ("metric" in active) {
        const n = countFigure(active.metric);
        if (n === null) {
          draft.failures.push({ reason: ISSUER_METRIC_REASON.shapeUnexpected, headline: true });
          draft.notes.push(ISSUER_NOTE.failed(ACTIVE.noun));
        } else {
          draft.headlineReads += 1;
          noteIssuerSource(draft, CLIENTS_ADAPTER_ID, active.metric, CLIENTS_OWNER);
          pushIssuerHeadline(draft, { key: ACTIVE.key, label: ACTIVE.label, value: n, unit: "count", basis: "point_in_time" }, ACTIVE.noun);
          if (active.partial) draft.notes.push(ISSUER_NOTE.partial(ACTIVE.noun));
        }
      } else {
        draft.failures.push({ reason: active.failure, headline: true });
        draft.notes.push(ISSUER_NOTE.failed(ACTIVE.noun));
      }

      // b) clients by stage now
      if (aborted()) return contextDegraded(ISSUER_METRIC_REASON.aborted);
      const lifecycle = await readIssuerFigure(caller, tenantId, CLIENTS_METRICS.lifecycle, ctx.period, ctx.now, {
        kind: "distribution",
        ownerDepartment: CLIENTS_OWNER,
      }, clock);
      if ("metric" in lifecycle) {
        draft.headlineReads += 1;
        noteIssuerSource(draft, CLIENTS_ADAPTER_ID, lifecycle.metric, CLIENTS_OWNER);
        addBuckets(draft, lifecycle.metric, lifecycle.partial, LIFECYCLE_MAP, LIFECYCLE);
      } else {
        draft.failures.push({ reason: lifecycle.failure, headline: true });
        draft.notes.push(ISSUER_NOTE.failed(LIFECYCLE.noun));
      }

      // c) onboarding now
      if (aborted()) return contextDegraded(ISSUER_METRIC_REASON.aborted);
      const onboarding = await readIssuerFigure(caller, tenantId, CLIENTS_METRICS.onboarding, ctx.period, ctx.now, {
        kind: "distribution",
        ownerDepartment: CLIENTS_OWNER,
      }, clock);
      if ("metric" in onboarding) {
        draft.headlineReads += 1;
        noteIssuerSource(draft, CLIENTS_ADAPTER_ID, onboarding.metric, CLIENTS_OWNER);
        const values = onboarding.metric.values;
        // The producer lists nothing only when there is no client at all (clients with no recorded
        // onboarding make the read unavailable instead). Nothing to onboard is not "all onboarded".
        if (values !== null && values.kind === "distribution" && values.items.length === 0 && !onboarding.partial) {
          draft.notes.push(CLIENTS_NOTE.noClientsToOnboard);
        } else {
          addBuckets(draft, onboarding.metric, onboarding.partial, ONBOARDING_MAP, { ...ONBOARDING, partialNote: CLIENTS_NOTE.onboardingPartlyRecorded });
        }
      } else {
        draft.failures.push({ reason: onboarding.failure, headline: true });
        draft.notes.push(
          onboarding.failure === ISSUER_METRIC_REASON.sourceUnavailable
            ? CLIENTS_NOTE.onboardingNotRecorded
            : ISSUER_NOTE.failed(ONBOARDING.noun),
        );
      }

      // Standing gaps last: a gap found in this read outranks them if the note is trimmed for length.
      draft.notes.push(CLIENTS_NOTE.standing);
      return finishIssuerSnapshot(draft, { domain: "clients", owner: CLIENTS_OWNER, period: ctx.period, now: ctx.now });
    },
  };
}
