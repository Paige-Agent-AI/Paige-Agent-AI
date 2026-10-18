/**
 * Stripe Basil moved subscription periods to subscription items and moved an
 * invoice's subscription reference under invoice.parent. Keep those provider
 * shape decisions in one pure, testable boundary.
 */
export function readSubscriptionItemPeriod(item: {
  current_period_start?: number | null;
  current_period_end?: number | null;
} | null | undefined): { start: string; end: string } | null {
  const start = item?.current_period_start;
  const end = item?.current_period_end;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start! <= 0 || end! <= start!) {
    return null;
  }
  return {
    start: new Date(start! * 1000).toISOString(),
    end: new Date(end! * 1000).toISOString(),
  };
}

export function readInvoiceSubscriptionId(invoice: {
  parent?: {
    type?: string | null;
    subscription_details?: {
      subscription?: string | { id?: string | null } | null;
    } | null;
  } | null;
}): string | null {
  if (invoice.parent?.type !== "subscription_details") return null;
  const subscription = invoice.parent.subscription_details?.subscription;
  if (typeof subscription === "string") return subscription || null;
  return subscription?.id || null;
}

/**
 * Stable non-sensitive error code for persistence (stripe_event_log.last_error_code):
 * a provider/Postgres raise name passes through verbatim; everything else falls back
 * to a caller-named stage code so the recorded code always names where recovery must look.
 * Postgrest errors arrive as plain objects ({ message, ... }), not Error instances,
 * so the message is extracted by shape.
 */
export function safeStageCode(stage: string, cause: unknown): string {
  const raw = cause instanceof Error ? cause.message
    : typeof (cause as { message?: unknown } | null | undefined)?.message === "string"
      ? (cause as { message: string }).message
      : "";
  return /^[a-z0-9_]{1,120}$/i.test(raw) ? raw : stage;
}

/**
 * Stage error whose `.message` is the stable code (what last_error_code persists)
 * while `.cause` carries the RAW underlying message for restricted operator-side
 * diagnostics — constraint text, PGRST bodies and provider noise that the stable
 * code would otherwise collapse away.
 */
export function stageError(stage: string, cause: unknown): Error {
  const raw = cause instanceof Error ? cause.message
    : typeof (cause as { message?: unknown } | null | undefined)?.message === "string"
      ? (cause as { message: string }).message
      : "";
  return new Error(safeStageCode(stage, cause), raw ? { cause: raw } : undefined);
}

/** The raw diagnostic message carried by a stageError, if any. */
export function rawErrorDetail(error: unknown): string | null {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  return typeof cause === "string" && cause.length > 0 ? cause : null;
}
