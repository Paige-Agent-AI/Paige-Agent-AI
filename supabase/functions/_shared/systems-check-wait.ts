// The ORIGINAL Systems wait and ID shape, without the scan/model engine.
// No authority, deadline issuer, timer, scheduler, provider or persisted state.
export const isManualSystemsWorkId = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

export type CaptureReadbackPhase = "context_read" | "catalog_read" | "check_read"
  | "run_insert" | "finding_write" | "finding_readback" | "run_finalize" | "run_readback";

/** A known original run owes reconciliation. This never proves absence or permits replay. */
export class SystemsCheckCaptureUnconfirmed extends Error {
  constructor(readonly runId: string, readonly reason: CaptureReadbackPhase | "work_claim" | "work_settlement") {
    super("SYSTEMS_CHECK_CAPTURE_UNCONFIRMED");
    this.name = "SystemsCheckCaptureUnconfirmed";
  }
}

/** The original capture wait, also used by its private native Work adapter.
 * The host owns the deadline. Aborting awaiting never rolls back issued I/O. */
export async function awaitSystemsCheckCapture<T>(operation: () => PromiseLike<T>,
  signal: AbortSignal, runId: string, phase: SystemsCheckCaptureUnconfirmed["reason"]): Promise<T> {
  return awaitSystemsCheckBoundary(operation, signal, () => new SystemsCheckCaptureUnconfirmed(runId, phase));
}

/** Same original wait before Work identity exists. Never relabel an intent as a run. */
export async function awaitSystemsCheckRequest<T>(operation: () => PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return awaitSystemsCheckBoundary(operation, signal, () => new Error("SYSTEMS_WORK_REQUEST_UNCONFIRMED"));
}

async function awaitSystemsCheckBoundary<T>(operation: () => PromiseLike<T>, signal: AbortSignal, unconfirmed: () => Error): Promise<T> {
  if (signal.aborted) throw unconfirmed();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(unconfirmed()); });
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const pending = Promise.resolve().then(() => {
      if (signal.aborted) throw unconfirmed();
      return operation();
    });
    const result = await Promise.race([pending, aborted]);
    if (signal.aborted) throw unconfirmed();
    return result;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
