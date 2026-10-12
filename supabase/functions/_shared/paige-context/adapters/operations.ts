/**
 * `operations` Domain Snapshot adapter (Operating Fabric F2b) — a projection over the Operations
 * department's governed measurements. Owner: `operations_pmo` (the producer's owning department for
 * `operations.*` keys; this adapter only shapes the figures).
 *
 * What it reads, one at a time, through `readBusinessMetric` only (via `./issuer-metric.ts`):
 *   a) open Systems Check findings now        → risks[] (blocking/high = act, medium/low = watch)
 *                                               + operations.exceptions_<severity>  (right now)
 *   b) failing checks in the latest full check → operations.unresolved_findings     (right now)
 *   c) automation runs recorded in the period  → operations.workflow_runs_recorded  (in period)
 *                                               + operations.workflow_runs_failed    (in period)
 *
 * a) and b) describe the latest COMPLETED full check, not the period: there is no history of findings
 * to compare, so this domain never carries a change. The producer lists at most the 20 NEWEST findings
 * (not the most severe). When it listed 20 and reports more, the cap may have cut real problems, so the
 * list is said to be incomplete and the per-severity counts are not available rather than undercounted.
 * When it listed fewer than 20, nothing was cut for length: what it left out are checks that were
 * deferred, never recorded or unreadable, so the counts of the listed items stand and a note says how
 * many checks are not in them. An automation run that was never recorded is not a success: an empty
 * period says "none recorded", never "no failures", and a read that could not count every run never
 * says "none" or "0 failed" either.
 */

import type { MetricCaller } from "../../analytics-metrics/read.ts";
import type { DiagnosticEvent } from "../../analytics-metrics/metric-contract.ts";
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
  plainUtcMinute,
  pushIssuerHeadline,
  readIssuerFigure,
  SETTINGS_PRODUCER_DEFINITIONAL_EXCLUSION,
  systemsCheckEvents,
  type IssuerDraftRisk,
  type IssuerMetric,
  type IssuerSnapshotDraft,
} from "./issuer-metric.ts";

export const OPERATIONS_ADAPTER_ID = "operations.issuer_metrics.v1";
/** The producer's owning department for every `operations.*` key (settings producer, owner CASE). */
export const OPERATIONS_OWNER = "operations_pmo";

export const OPERATIONS_METRICS = {
  exceptions: "operations.current_system_exceptions",
  unresolved: "operations.unresolved_findings_current",
  workflowRuns: "operations.recorded_workflow_runs",
} as const;

const SEVERITIES = ["blocking", "high", "medium", "low"] as const;
/** The producer's projection cap for listed findings (20270601000005, `LIMIT 20`). */
const LISTED_CAP = 20;
type Severity = (typeof SEVERITIES)[number];

const SEVERITY_WORDS: Readonly<Record<Severity, string>> = {
  blocking: "blocking",
  high: "high priority",
  medium: "medium priority",
  low: "low priority",
};

/**
 * Systems Check items in the owner's words, keyed by the registry's check id. A closed map: an id not
 * listed here is described generically and the id itself is NEVER shown. `subject` is used when the
 * check could not run; `problem` when it ran and failed.
 */
const CHECK_WORDS: Readonly<Record<string, { readonly subject: string; readonly problem: string }>> = {
  comms_configured: { subject: "email, phone and texting", problem: "email, phone and texting are not fully set up" },
  website_connected: { subject: "your website", problem: "no website is connected" },
  social_accounts_connected: { subject: "your social accounts", problem: "your social accounts are not on record" },
  automation_wired: { subject: "your outside automation tools", problem: "no outside automation tool is connected" },
  company_info_populated: { subject: "your company details", problem: "your company details are incomplete" },
  crm_has_customers: { subject: "your contacts", problem: "there are no customers in your contacts yet" },
  sales_pipeline_configured: { subject: "your pipeline stages", problem: "your pipeline stages are not set up" },
  revenue_tracking_configured: { subject: "your revenue tracking", problem: "revenue tracking is not set up" },
  payment_processor_connected: { subject: "how you take payment", problem: "taking payment is not set up" },
  payment_method_options: {
    subject: "the ways you accept payment",
    problem: "the ways you accept payment are not written down",
  },
};
const GENERIC_CHECK = { subject: "one setup item", problem: "one setup item needs attention" } as const;

const UNRESOLVED = {
  key: "operations.unresolved_findings",
  label: "Open Systems Check findings (failing checks in the latest full check)",
  noun: "open Systems Check findings",
} as const;
const EXCEPTIONS = {
  noun: "the list of open Systems Check items",
  label: (s: Severity) => `Open Systems Check items marked ${SEVERITY_WORDS[s]}`,
  key: (s: Severity) => `operations.exceptions_${s}`,
} as const;
const RUNS = {
  recorded: "operations.workflow_runs_recorded",
  failed: "operations.workflow_runs_failed",
  noun: "automation runs",
} as const;

/** Workflow run statuses the producer may report. Every one is shown only through the counts below. */
const RUN_STATUS_MAP = {
  queued: "pending",
  running: "pending",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export const OPERATIONS_NOTE = {
  // At issue time the producer reports UNAVAILABLE for these keys only when no completed full check is
  // on record (or its completion time is unreadable); a check finishing mid-read is refused, not this.
  noCompletedCheck: "no finished full Systems Check is on record yet, so open setup items could not be listed",
  moreThanShown: (n: number) =>
    `${n === 1 ? "one more Systems Check item was" : `${n} more Systems Check items were`} not listed (beyond the newest 20, deferred, or unreadable), so the list is not complete and counts by priority are not available`,
  notCounted: (n: number) =>
    `${n === 1 ? "one Systems Check item was" : `${n} Systems Check items were`} deferred, not recorded or unreadable, so ${n === 1 ? "it is" : "they are"} not in the counts by priority`,
  noRuns: "no automation runs were recorded in this period, which says nothing about whether automations are working",
  runsUncounted: "some automation runs could not be counted, so a failed run cannot be ruled out",
} as const;

function checkSummary(event: DiagnosticEvent): string {
  const words = (event.check_key !== null && Object.prototype.hasOwnProperty.call(CHECK_WORDS, event.check_key))
    ? CHECK_WORDS[event.check_key]
    : GENERIC_CHECK;
  const severity = SEVERITY_WORDS[event.severity as Severity];
  const when = plainUtcMinute(event.at);
  const tail = `${severity}${when !== null ? `; found ${when}` : ""}`;
  return event.status === "error"
    ? `Systems Check could not check ${words.subject} (${tail}).`
    : `Systems Check: ${words.problem} (${tail}).`;
}

function rank(severity: string | null): number {
  const i = SEVERITIES.indexOf(severity as Severity);
  return i === -1 ? SEVERITIES.length : i;
}

/** "from the Systems Check completed 2026-10-11 09:00 UTC" — the reading's time, not the query's. */
function checkNote(metric: IssuerMetric): string | undefined {
  const when = plainUtcMinute(metric.freshness.source_updated_through);
  return when === null ? undefined : `from the Systems Check completed ${when}`;
}

function failNote(draft: IssuerSnapshotDraft, metric: { readonly failure: string }, noun: string, unavailableNote: string): void {
  draft.notes.push(metric.failure === ISSUER_METRIC_REASON.sourceUnavailable ? unavailableNote : ISSUER_NOTE.failed(noun));
}

/** a) open findings → ranked risks, and per-severity counts when the list is complete. */
function addExceptions(draft: IssuerSnapshotDraft, metric: IssuerMetric, partial: boolean): void {
  const events = systemsCheckEvents(metric)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e.severity) - rank(b.e.severity) || a.i - b.i)
    .map((x) => x.e);
  const excluded = metric.coverage.excluded_count;
  // Only a full projection can have been cut by the newest-20 cap; below it, every eligible finding is
  // listed and the excluded ones are deferred, missing or unreadable checks (counted in the note).
  const capReached = metric.coverage.contributing_count >= LISTED_CAP || events.length >= LISTED_CAP;
  const truncated = excluded > 0 && capReached;
  // A PARTIAL with nothing counted as excluded is unexplained: fail closed, no counts.
  const complete = !truncated && (excluded > 0 || !partial);
  const note = checkNote(metric);
  for (const s of SEVERITIES) {
    pushIssuerHeadline(draft, {
      key: EXCEPTIONS.key(s),
      label: EXCEPTIONS.label(s),
      value: complete ? events.filter((e) => e.severity === s).length : null,
      unit: "count",
      basis: "point_in_time",
      ...(note !== undefined ? { window_note: note } : {}),
    }, EXCEPTIONS.noun);
  }
  if (truncated) draft.notes.push(OPERATIONS_NOTE.moreThanShown(excluded));
  else if (excluded > 0) draft.notes.push(OPERATIONS_NOTE.notCounted(excluded));
  else if (partial) draft.notes.push(ISSUER_NOTE.partial(EXCEPTIONS.noun));
  for (const e of events.slice(0, LISTED_CAP)) {
    const severity = e.severity as Severity;
    const risk: IssuerDraftRisk = {
      kind: `systems_check_${severity}`,
      summary: checkSummary(e),
      severity: severity === "blocking" || severity === "high" ? "act" : "watch",
      figure_key: EXCEPTIONS.key(severity),
    };
    draft.risks.push(risk);
  }
}

/**
 * c) recorded runs → total and failed; an empty period is "none recorded", never "no failures". A read
 * that left runs out (PARTIAL, or statuses Paige does not recognise) may have left out failures, so it
 * never claims "none recorded" or "0 failed": those figures become not available, with a note.
 */
function addRuns(
  draft: IssuerSnapshotDraft,
  metric: IssuerMetric,
  partial: boolean,
  windowNote: string | undefined,
  periodLabel: string,
): void {
  const buckets = closedBuckets(metric, RUN_STATUS_MAP);
  const tag = windowNote !== undefined ? { window_note: windowNote } : {};
  const total = Object.values(buckets.counts).reduce((n, c) => n + c, 0);
  if (buckets.dropped > 0) draft.notes.push(droppedBucketNote(RUNS.noun, buckets.dropped));
  if (partial) draft.notes.push(ISSUER_NOTE.partial(RUNS.noun));
  const uncounted = partial || buckets.dropped > 0;
  if (total === 0 && !uncounted) {
    pushIssuerHeadline(draft, {
      key: RUNS.recorded,
      label: "Automation runs recorded (none recorded; not a sign that automations are working)",
      value: 0,
      unit: "count",
      basis: "in_period",
      ...tag,
    }, RUNS.noun);
    draft.notes.push(OPERATIONS_NOTE.noRuns);
    return;
  }
  const failed = buckets.counts.failed ?? 0;
  pushIssuerHeadline(draft, {
    key: RUNS.recorded,
    label: "Automation runs recorded",
    // Runs exist but none could be counted: not a zero.
    value: total === 0 ? null : total,
    unit: "count",
    basis: "in_period",
    ...tag,
  }, RUNS.noun);
  pushIssuerHeadline(draft, {
    key: RUNS.failed,
    label: "Automation runs that failed",
    // A zero from a read that left runs out would claim "no failures"; a positive count still stands.
    value: failed === 0 && uncounted ? null : failed,
    unit: "count",
    basis: "in_period",
    ...tag,
  }, RUNS.noun);
  if (uncounted && failed === 0) draft.notes.push(OPERATIONS_NOTE.runsUncounted);
  if (failed > 0) {
    draft.risks.push({
      kind: "automation_runs_failed",
      summary: `${failed === 1 ? "One automation run" : `${failed} automation runs`} failed in ${periodLabel}.`,
      severity: "act",
      figure_key: RUNS.failed,
    });
  }
}

/**
 * Act before watch before info; the order within a severity is kept, so trimming drops the least
 * urgent. Within act, a failed automation run leads: it is something actively going wrong, unlike a
 * setup item, so it must never be the risk trimmed when the Systems Check alone fills the list.
 */
function orderRisks(draft: IssuerSnapshotDraft): void {
  const weight = { act: 0, watch: 1, info: 2 } as const;
  const lead = (r: IssuerDraftRisk) => (r.kind === "automation_runs_failed" ? 0 : 1);
  draft.risks = draft.risks
    .map((r, i) => ({ r, i }))
    .sort((a, b) => weight[a.r.severity] - weight[b.r.severity] || lead(a.r) - lead(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * The operations adapter. Same rules as the Sales adapters: `caller` is the authenticated user's own
 * client (every read re-resolves workspace and role on the server), the scope must equal the
 * composer's identity, reads run one after another, and the abort signal is checked before each.
 */
export function createOperationsSnapshotAdapter(
  caller: MetricCaller,
  scope: { readonly tenantId: string | null },
  clock: () => number = Date.now,
): DomainSnapshotAdapter {
  return {
    domain: "operations",
    owner: OPERATIONS_OWNER,
    async read(ctx): Promise<ContextSourceResult<DomainSnapshot>> {
      if (ctx.identity.tenantId !== scope.tenantId) return contextDegraded(ISSUER_METRIC_REASON.scopeMismatch);
      const aborted = () => ctx.signal?.aborted === true;
      const tenantId = scope.tenantId;
      const draft = emptyIssuerDraft();

      // a) open Systems Check findings, as of the latest completed full check
      if (aborted()) return contextDegraded(ISSUER_METRIC_REASON.aborted);
      const exceptions = await readIssuerFigure(caller, tenantId, OPERATIONS_METRICS.exceptions, ctx.period, ctx.now, {
        kind: "diagnostic_events",
        ownerDepartment: OPERATIONS_OWNER,
      }, clock);
      let noCheck = false;
      if ("metric" in exceptions) {
        draft.headlineReads += 1;
        noteIssuerSource(draft, OPERATIONS_ADAPTER_ID, exceptions.metric, OPERATIONS_OWNER);
        addExceptions(draft, exceptions.metric, exceptions.partial);
      } else {
        draft.failures.push({ reason: exceptions.failure, headline: true });
        noCheck = exceptions.failure === ISSUER_METRIC_REASON.sourceUnavailable;
        failNote(draft, exceptions, EXCEPTIONS.noun, OPERATIONS_NOTE.noCompletedCheck);
      }

      // b) failing checks in the latest full check (the uncapped total)
      if (aborted()) return contextDegraded(ISSUER_METRIC_REASON.aborted);
      const unresolved = await readIssuerFigure(caller, tenantId, OPERATIONS_METRICS.unresolved, ctx.period, ctx.now, {
        kind: "count",
        ownerDepartment: OPERATIONS_OWNER,
        definitionalExclusions: [SETTINGS_PRODUCER_DEFINITIONAL_EXCLUSION],
      }, clock);
      if ("metric" in unresolved) {
        const n = countFigure(unresolved.metric);
        if (n === null) {
          draft.failures.push({ reason: ISSUER_METRIC_REASON.shapeUnexpected, headline: true });
          draft.notes.push(ISSUER_NOTE.failed(UNRESOLVED.noun));
        } else {
          draft.headlineReads += 1;
          noteIssuerSource(draft, OPERATIONS_ADAPTER_ID, unresolved.metric, OPERATIONS_OWNER);
          const note = checkNote(unresolved.metric);
          pushIssuerHeadline(draft, {
            key: UNRESOLVED.key,
            label: UNRESOLVED.label,
            value: n,
            unit: "count",
            basis: "point_in_time",
            ...(note !== undefined ? { window_note: note } : {}),
          }, UNRESOLVED.noun);
          if (unresolved.partial) draft.notes.push(ISSUER_NOTE.partial(UNRESOLVED.noun));
        }
      } else {
        draft.failures.push({ reason: unresolved.failure, headline: true });
        // The same missing check explains both reads; say it once.
        if (!(noCheck && unresolved.failure === ISSUER_METRIC_REASON.sourceUnavailable)) {
          failNote(draft, unresolved, UNRESOLVED.noun, OPERATIONS_NOTE.noCompletedCheck);
        }
      }

      // c) automation runs recorded in the period
      if (aborted()) return contextDegraded(ISSUER_METRIC_REASON.aborted);
      const runs = await readIssuerFigure(caller, tenantId, OPERATIONS_METRICS.workflowRuns, ctx.period, ctx.now, {
        kind: "distribution",
        ownerDepartment: OPERATIONS_OWNER,
      }, clock);
      if ("metric" in runs) {
        draft.headlineReads += 1;
        noteIssuerSource(draft, OPERATIONS_ADAPTER_ID, runs.metric, OPERATIONS_OWNER);
        addRuns(draft, runs.metric, runs.partial, runs.window?.window_note, ctx.period.label);
      } else {
        draft.failures.push({ reason: runs.failure, headline: true });
        draft.notes.push(ISSUER_NOTE.failed(RUNS.noun));
      }

      orderRisks(draft);
      return finishIssuerSnapshot(draft, { domain: "operations", owner: OPERATIONS_OWNER, period: ctx.period, now: ctx.now });
    },
  };
}
