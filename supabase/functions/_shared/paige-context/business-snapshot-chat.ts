/**
 * `get_business_snapshot` — the Fabric side of the business review's chat seam (Operating Fabric F2).
 *
 * WHAT THIS MODULE OWNS. The model-facing argument contract (`BUSINESS_SNAPSHOT_INPUT_DEFINITION`, a plain
 * `objectInputSchema` definition), the tool description, a strict argument parser, and the dispatch that
 * turns one tool call into one `composeBusinessReview` run and a bounded, honest tool result. It is the same
 * split the Ads lead funnel uses (`_shared/ads-funnel-chat.ts`): the domain module owns arguments, dispatch
 * and result wording; the Spine lane owns the capability declaration and registration; the Conversational
 * Loop lane owns the push, the dispatch branch and turn admission.
 *
 * WHAT IT DOES NOT OWN, deliberately. No `defineCapability` call and no `SpineCapability` object: the
 * Spine/Platform Reach lane registers `business.operating_snapshot` and builds the input schema with
 * `objectInputSchema(BUSINESS_SNAPSHOT_INPUT_DEFINITION)`. No edit to `paige-ai-chat` or `_shared/paige-turn`.
 * Until both of those land, nothing reaches this module from a turn.
 *
 * IDENTITY COMES FROM THE TURN, NEVER FROM THE MODEL. The tenant, actor, role and account shape are the ones
 * the runtime already resolved; the time zone is the turn request's `userTimezone` (UTC when absent). The
 * argument parser refuses any field the definition does not name — a model-supplied tenant, actor, role or
 * time zone is refused before anything is read, never silently ignored. The issuer still re-resolves the
 * workspace, membership and seat on every read with the caller's own JWT.
 *
 * READ-ONLY. The only write anywhere on this path is the metric issuer's own short-lived evidence bookkeeping
 * (see `business-review.ts`). Nothing here records a receipt: a read is not a business action.
 */

import type { MetricCaller } from "../analytics-metrics/read.ts";
import { composeBusinessReview, type BusinessReviewResult, type BusinessReviewWho } from "./business-review.ts";
import type { AccountShape } from "./mod.ts";
import {
  SNAPSHOT_PERIOD_KEYS,
  SNAPSHOT_REASON,
  type BusinessOperatingSnapshot,
  type SnapshotDomain,
} from "./snapshot.ts";

export const BUSINESS_SNAPSHOT_TOOL_NAME = "get_business_snapshot";
/** The Spine key the Spine/Platform Reach lane registers. Named here so the two cannot drift. */
export const BUSINESS_SNAPSHOT_CAPABILITY_KEY = "business.operating_snapshot";

/** Business areas the review can read today. Anything else in a focus is reported, never read. */
export const BUSINESS_SNAPSHOT_READ_DOMAINS: readonly SnapshotDomain[] = Object.freeze([
  "payments",
  "sales_pipeline",
  "operations",
  "clients",
]);

export const BUSINESS_SNAPSHOT_FOCUS_MAX_ITEMS = 12;
export const BUSINESS_SNAPSHOT_FOCUS_MAX_LENGTH = 40;
export const BUSINESS_SNAPSHOT_BOUND_MAX_LENGTH = 40;
/** The time zone used when the turn request carries none. Never a guess from the model. */
export const BUSINESS_SNAPSHOT_FALLBACK_TIMEZONE = "UTC";
/**
 * Longest client-reported zone name passed on — the `paige-ai-chat` request schema's own bound
 * (`userTimezone: z.string().max(80)`). Anything within it goes to the period resolver, which refuses an
 * unknown zone as `invalid_timezone`; only a value the schema itself would reject falls back to UTC.
 */
const TIMEZONE_MAX_LENGTH = 80;

/**
 * A plain `objectInputSchema` definition (root keys `description`, `properties`, `required` only). The
 * Spine lane passes it to `objectInputSchema`, which adds `additionalProperties: false`.
 */
export const BUSINESS_SNAPSHOT_INPUT_DEFINITION = {
  properties: {
    period: {
      type: "string",
      enum: [...SNAPSHOT_PERIOD_KEYS],
      description:
        "Default last_7_days. today, last_7_days and last_30_days end now; current_quarter is the calendar quarter so far; custom needs custom_start and custom_end.",
    },
    custom_start: {
      type: "string",
      maxLength: BUSINESS_SNAPSHOT_BOUND_MAX_LENGTH,
      description: "Only with period custom. Inclusive: an ISO timestamp with a zone, or a date read as local midnight.",
    },
    custom_end: {
      type: "string",
      maxLength: BUSINESS_SNAPSHOT_BOUND_MAX_LENGTH,
      description:
        "Only with period custom. Exclusive: an ISO timestamp with a zone, or a date read as local midnight. For a range through today, pass the current time, not tomorrow's date.",
    },
    focus: {
      type: "array",
      maxItems: BUSINESS_SNAPSHOT_FOCUS_MAX_ITEMS,
      items: { type: "string", maxLength: BUSINESS_SNAPSHOT_FOCUS_MAX_LENGTH },
      description:
        "Optional business areas to narrow to, in plain words: payments, invoices, collections, sales, pipeline, clients, operations, blockers. Leave it out for the whole review.",
    },
  },
  required: [],
} as const;

export const BUSINESS_SNAPSHOT_TOOL_DESCRIPTION =
  "Read how this business is doing and what needs the owner's attention, for a period (default the last 7 days). " +
  "Use it for questions like \"how is my business doing this week\", \"what needs my attention\" or \"give me a business review\". " +
  "It reads, in one go: recorded cash received and money owed (outstanding and overdue, each currency separately), " +
  "new and open sales opportunities and open pipeline value, open setup problems and failed automation runs, " +
  "and active, paused and past clients with onboarding progress. " +
  "Report only what it returns. An area marked NOT AVAILABLE is unknown, never zero; a listed 0 is a real zero. " +
  "Recorded cash is what the business recorded, not proof that a bank or payment provider settled it. " +
  "There is no ad-account data here — no ad spend, cost per lead or return on ad spend — so never state or estimate those. " +
  "Do not add currencies together. Do not store these figures as memory: they change. " +
  "Do not run it at the same time as read_business_metric. It reads only; it changes nothing.";

export type BusinessSnapshotArgs = {
  readonly period?: string;
  readonly customStart?: string;
  readonly customEnd?: string;
  readonly focus?: readonly string[];
};

export type BusinessSnapshotArgsResult =
  | { readonly ok: true; readonly args: BusinessSnapshotArgs }
  | { readonly ok: false; readonly fix: string };

const ALLOWED_ARG_KEYS = new Set(Object.keys(BUSINESS_SNAPSHOT_INPUT_DEFINITION.properties));
const IDENTITY_ARG = /tenant|workspace|account|actor|user|role|seat|time_?zone|tz|scope/i;

const PLAIN_PERIOD_CHOICES = "Choose today, the last 7 days, the last 30 days, this quarter so far, or a custom range with a start and an end.";

/** A plain object only: not an array, and not a Date, Map or other class instance. */
const isRecord = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const boundText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim() !== "" && v.length <= max;

/**
 * Strict: every key must be one the definition names, every value its declared type and size. A refusal
 * names the fix in plain words; it never echoes the offending value.
 */
export function parseBusinessSnapshotArgs(raw: unknown): BusinessSnapshotArgsResult {
  // Absent arguments are the default review. `null` is what the Chat branch passes for arguments it could
  // not parse, so it is refused rather than read as "no arguments".
  if (raw === undefined) return { ok: true, args: {} };
  if (!isRecord(raw)) return { ok: false, fix: "Send the request as named fields, or with no fields for the whole review." };
  for (const key of Object.keys(raw)) {
    if (ALLOWED_ARG_KEYS.has(key)) continue;
    return IDENTITY_ARG.test(key)
      ? { ok: false, fix: "The business and the person come from the signed-in session, and the time zone from the owner's device; none of them can be supplied. Ask again without them." }
      : { ok: false, fix: "Use only a period, a custom start and end, and the areas to focus on." };
  }

  const out: { period?: string; customStart?: string; customEnd?: string; focus?: string[] } = {};
  if (raw.period !== undefined) {
    if (typeof raw.period !== "string" || !(SNAPSHOT_PERIOD_KEYS as readonly string[]).includes(raw.period)) {
      return { ok: false, fix: PLAIN_PERIOD_CHOICES };
    }
    out.period = raw.period;
  }
  for (const [field, key] of [["custom_start", "customStart"], ["custom_end", "customEnd"]] as const) {
    const value = raw[field];
    if (value === undefined) continue;
    if (!boundText(value, BUSINESS_SNAPSHOT_BOUND_MAX_LENGTH)) {
      return { ok: false, fix: "A custom start or end must be a date or an ISO timestamp with a time zone." };
    }
    out[key] = value.trim();
  }
  if ((out.customStart !== undefined || out.customEnd !== undefined) && out.period !== "custom") {
    return { ok: false, fix: "A custom start and end are only used with the period custom." };
  }
  if (raw.focus !== undefined) {
    const focus = raw.focus;
    if (!Array.isArray(focus) || focus.length > BUSINESS_SNAPSHOT_FOCUS_MAX_ITEMS
        || !focus.every((f) => boundText(f, BUSINESS_SNAPSHOT_FOCUS_MAX_LENGTH))) {
      return { ok: false, fix: `A focus is a short list (at most ${BUSINESS_SNAPSHOT_FOCUS_MAX_ITEMS}) of plain area names, such as payments or clients.` };
    }
    out.focus = focus.map((f: string) => f.trim());
  }
  return { ok: true, args: out };
}

/** What the runtime already resolved for this turn. Nothing here comes from the model. */
export type BusinessSnapshotChatContext = {
  readonly actorId: string;
  readonly tenantId: string | null;
  /** Chat has no role string today; null is fine — the issuer re-resolves the seat on every read. */
  readonly role?: string | null;
  /**
   * Use `accountShapeForCallerTier(callerTier)`. Required: a shape outside
   * `BUSINESS_SNAPSHOT_ACCOUNT_SHAPES` (or null) is refused before anything is read.
   */
  readonly accountShape: AccountShape | null;
  /** The turn request's client-reported `userTimezone`, as received. Absent → UTC. */
  readonly userTimezone?: unknown;
  readonly toolName: string;
  readonly args: unknown;
};

export type BusinessSnapshotChatDeps = {
  /** The signed-in person's own client (caller JWT), never the service role. */
  readonly caller: MetricCaller;
  /** Test seam; defaults to the real composition. */
  readonly compose?: typeof composeBusinessReview;
};

/**
 * `succeeded` — at least one area was read. `unavailable` — the review ran but no area could be read
 * (workspace changed, sources unreadable, or only areas that are not connected were asked for).
 * `refused` — every area that was read came back not authorized. `invalid` — nothing was read: the
 * request, the workspace or the period could not be used. `failed` — the review did not complete.
 */
export type BusinessSnapshotOutcome = "succeeded" | "unavailable" | "refused" | "invalid" | "failed";

export type BusinessSnapshotChatResult = {
  readonly outcome: BusinessSnapshotOutcome;
  /** Exactly what goes to the model as the tool result. */
  readonly content: Record<string, unknown>;
  /** The structured snapshot, for the turn trace only. Never sent to the model; absent when nothing ran. */
  readonly snapshot?: BusinessOperatingSnapshot;
};

/**
 * §61: the review is for a business's own operators — Solo, Sub-account and Enterprise. An agency, operator
 * or client lens (or an unknown shape) is not offered it; the domain module holds that rule too, so a Chat
 * gate that drifts cannot widen it.
 */
export const BUSINESS_SNAPSHOT_ACCOUNT_SHAPES: readonly AccountShape[] = Object.freeze(["solo", "sub_account", "enterprise"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTHING_READ = "Nothing was read and nothing was changed.";
const NOTHING_CHANGED = "It read only; nothing was changed.";

const invalid = (error: string, fix: string): BusinessSnapshotChatResult =>
  ({ outcome: "invalid", content: { success: false, error, fix, note: `${NOTHING_READ} Do not mention internal field or tool names to the owner.` } });

const PERIOD_FIX: Readonly<Record<string, string>> = Object.freeze({
  invalid_timezone: "This device's time zone was not recognised, so the period could not be worked out. Ask the owner to check the device's time zone setting.",
  custom_bounds_required: "A custom period needs both a start and an end.",
  custom_bounds_invalid: "A custom start or end could not be read as a date or time.",
  custom_range_inverted: "The custom start must come before the custom end.",
  custom_range_too_long: "A custom period can be at most a year long.",
  custom_range_in_future: "A custom period cannot end in the future. For a period through today, end it now.",
  unknown_period: PLAIN_PERIOD_CHOICES,
});

/**
 * The Chat runtime's actor tier (`_shared/actorTier.ts`) → the snapshot's account shape. Only the two tiers
 * that run a business of their own map; agency, operator and client lenses return null and are not offered
 * this read (§61: Solo and Sub-account YES; Agency RESELL; operator separate).
 */
export function accountShapeForCallerTier(tier: unknown): AccountShape | null {
  return tier === "tenant" ? "solo" : tier === "subaccount" ? "sub_account" : null;
}

/** The time zone the period is computed in: the client-reported one if readable, else UTC. */
export function snapshotTimezone(userTimezone: unknown): string {
  return typeof userTimezone === "string" && userTimezone.trim() !== "" && userTimezone.length <= TIMEZONE_MAX_LENGTH
    ? userTimezone.trim()
    : BUSINESS_SNAPSHOT_FALLBACK_TIMEZONE;
}

/** Classify a composed review by the areas it could actually read. */
export function classifyBusinessSnapshot(snapshot: BusinessOperatingSnapshot): BusinessSnapshotOutcome {
  const read = snapshot.requested.filter((d) => BUSINESS_SNAPSHOT_READ_DOMAINS.includes(d));
  const results = read.map((d) => snapshot.domains[d]);
  if (results.some((r) => r?.status === "available")) return "succeeded";
  if (results.length > 0 && results.every((r) => r?.reason === "metric_read_refused")) return "refused";
  return "unavailable";
}

const allScopeChanged = (s: BusinessOperatingSnapshot): boolean =>
  s.requested.length > 0 && s.requested.every((d) => s.domains[d]?.reason === SNAPSHOT_REASON.scopeChanged);

function fromReview(result: BusinessReviewResult): BusinessSnapshotChatResult {
  // `in` narrows under both strict and the app tsconfig (strict:false).
  if ("reason" in result) {
    return invalid("The review period could not be used.", PERIOD_FIX[result.reason] ?? PERIOD_FIX.unknown_period);
  }
  const { snapshot, projection } = result;
  const outcome = classifyBusinessSnapshot(snapshot);
  if (outcome === "succeeded") {
    return { outcome, snapshot, content: { success: true, period: snapshot.period.label, review: projection, note: NOTHING_CHANGED } };
  }
  if (outcome === "refused") {
    // A revision change between issue and resolve also arrives as a refusal, so this never says "you lack access".
    return { outcome, snapshot, content: {
      success: false,
      code: "review_not_authorized",
      error: "The business review could not be authorized for the active business just now.",
      note: `It is available to the business's owners and admins. Do not retry under another identity or a broader scope. ${NOTHING_CHANGED}`,
    } };
  }
  // The composer voids every area when the workspace check changed, failed or timed out; it cannot tell
  // which, so this never asserts that the owner switched businesses.
  if (allScopeChanged(snapshot)) {
    return { outcome, snapshot, content: {
      success: false,
      code: "active_business_unconfirmed",
      error: "The active business could not be confirmed for this review, so none of it is reported.",
      note: `If the owner switched businesses, ask again there; otherwise try again. ${NOTHING_CHANGED}`,
    } };
  }
  const onlyUnread = snapshot.requested.every((d) => !BUSINESS_SNAPSHOT_READ_DOMAINS.includes(d));
  return { outcome, snapshot, content: {
    success: false,
    code: "review_unavailable",
    error: onlyUnread
      ? "None of the requested business areas can be read in a business review yet."
      : "None of the requested business areas could be read just now.",
    period: snapshot.period.label,
    review: projection,
    note: `Every area listed is unknown, not zero. ${NOTHING_CHANGED}`,
  } };
}

/**
 * One `get_business_snapshot` call. Never throws: a composition that throws is reported as `failed`.
 * The Chat lane must run it on its own — never in parallel with `read_business_metric` — because the issuer
 * revokes a caller's previous reference for the same metric and range, and an overlap reads as a refusal.
 */
export async function dispatchBusinessSnapshotChat(
  ctx: BusinessSnapshotChatContext,
  deps: BusinessSnapshotChatDeps,
  opts?: { readonly now?: Date; readonly timeoutMs?: number; readonly clock?: () => number },
): Promise<BusinessSnapshotChatResult> {
  if (ctx.toolName !== BUSINESS_SNAPSHOT_TOOL_NAME) return invalid("That review is not available.", "Use the business review tool.");
  if (!ctx.tenantId || !UUID.test(ctx.tenantId)) {
    return invalid("The business review needs an active business.", "Open the business first, then ask again.");
  }
  if (typeof ctx.actorId !== "string" || ctx.actorId === "") {
    return invalid("The business review needs a signed-in person.", "Sign in, then ask again.");
  }
  if (ctx.accountShape === null || !BUSINESS_SNAPSHOT_ACCOUNT_SHAPES.includes(ctx.accountShape)) {
    return invalid("The business review is for a business's own workspace.", "Open the business's own workspace, then ask again.");
  }
  const parsed = parseBusinessSnapshotArgs(ctx.args);
  if ("fix" in parsed) return invalid("That review request could not be used.", parsed.fix);

  const who: BusinessReviewWho = { actorId: ctx.actorId, tenantId: ctx.tenantId, role: ctx.role ?? null, accountShape: ctx.accountShape };
  const compose = deps.compose ?? composeBusinessReview;
  try {
    const result = await compose(deps.caller, who, {
      period: parsed.args.period,
      timezone: snapshotTimezone(ctx.userTimezone),
      customStart: parsed.args.customStart,
      customEnd: parsed.args.customEnd,
      focus: parsed.args.focus,
    }, opts);
    return fromReview(result);
  } catch (error) {
    // §32: loud, but the error's name only — never its message or any payload.
    console.error("[business-snapshot] compose failed:", error instanceof Error ? error.name : typeof error);
    return { outcome: "failed", content: {
      success: false,
      error: "The business review did not complete.",
      note: `Nothing it read is reported, so do not state any figure from it. ${NOTHING_CHANGED}`,
    } };
  }
}
