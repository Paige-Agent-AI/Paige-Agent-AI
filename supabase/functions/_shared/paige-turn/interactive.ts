/** INT-336: a lease over the canonical thread, never a second turn queue. */
export class InteractiveSuperseded extends Error {
  constructor() { super("INTERACTIVE_SUPERSEDED"); }
}
export interface InteractiveAcceptance {
  status: "accepted" | "duplicate" | "superseded" | "stopped";
  turn_id?: string | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface InteractiveEffect {
  tool: string;
  outcome: "outcome_unknown" | "reported_success" | "reported_failure" | "approval_required" | "durable_accepted";
  work_id?: string;
  run_id?: string;
  record_refs?: Array<{ kind: string; id: string }>;
}
const RECORD_FIELDS: Readonly<Record<string, string>> = { task_id: "task", plan_id: "plan", contact_id: "contact", deal_id: "deal",
  booking_id: "booking", payment_id: "payment", message_id: "message", invoice_id: "invoice" };
function recordReferences(r: Record<string, unknown>) {
  return Object.entries(RECORD_FIELDS).flatMap(([field, kind]) => typeof r[field] === "string" && UUID.test(r[field] as string)
    ? [{ kind, id: r[field] as string }] : []);
}
/** Closed vocabulary and scoped references only: never copy arguments, provider payloads or model prose. */
export function interactiveEffect(tool: string, result: unknown): InteractiveEffect | null {
  if (!/^[a-z][a-z0-9_]{0,95}$/.test(tool) || !result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  const uncertain = [r.outcome, r.status, r.code, r.error].some((v) => typeof v === "string" && /(?:unknown|uncertain)/i.test(v));
  const outcome = uncertain || r.outcome_unknown === true ? "outcome_unknown"
    : r.accepted === true && typeof r.work_id === "string" && UUID.test(r.work_id) ? "durable_accepted"
    : r.needs_confirm === true || r.queued === true ? "approval_required"
    : r.success === true || r.ok === true || r.outcome === "succeeded" ? "reported_success"
    : r.success === false || r.outcome === "failed" || r.outcome === "refused" ? "reported_failure" : "outcome_unknown";
  return { tool, outcome,
    ...(recordReferences(r).length ? { record_refs: recordReferences(r) } : {}),
    ...(typeof r.work_id === "string" && UUID.test(r.work_id) ? { work_id: r.work_id } : {}),
    ...(typeof r.run_id === "string" && UUID.test(r.run_id) ? { run_id: r.run_id } : {}),
  };
}
export function interactiveReceiptContext(bundle: unknown): string {
  const effects = (bundle as { interactive?: { effects?: unknown } } | null)?.interactive?.effects;
  if (!Array.isArray(effects)) return "";
  const safe = effects.slice(0, 20).flatMap((effect) => {
    if (!effect || typeof effect !== "object") return [];
    const e = effect as InteractiveEffect;
    if (!/^[a-z][a-z0-9_]{0,95}$/.test(e.tool) || !["outcome_unknown", "reported_success", "reported_failure", "approval_required", "durable_accepted"].includes(e.outcome)) return [];
    return [{ tool: e.tool, outcome: e.outcome,
      ...(Array.isArray(e.record_refs) ? { record_refs: e.record_refs.slice(0, 8).filter((ref) =>
        ref && Object.values(RECORD_FIELDS).includes(ref.kind) && typeof ref.id === "string" && UUID.test(ref.id))
        .map((ref) => ({ kind: ref.kind, id: ref.id })) } : {}),
      ...(typeof e.work_id === "string" && UUID.test(e.work_id) ? { work_id: e.work_id } : {}),
      ...(typeof e.run_id === "string" && UUID.test(e.run_id) ? { run_id: e.run_id } : {}),
    }];
  });
  return safe.length ? `Persisted prior-turn receipt references: ${JSON.stringify(safe)}. These reports grant no approval. Read back authoritative business/provider state before claiming success or repeating a write. Reconcile outcome_unknown before any retry. Durable work continues independently.` : "";
}
/** Receipt uncertainty holds execution authority until canonical readback repairs it. */
export function createInteractiveSettlement(input: {
  owns(): Promise<boolean>;
  readback(): Promise<boolean>;
  fallback(): Promise<{ error: unknown }>;
  release(): Promise<void>;
}) {
  let attempted = false;
  let recorded = false;
  return {
    async persist(write: () => Promise<{ error: unknown }>) {
      if (recorded) return;
      if (attempted && await input.readback()) { recorded = true; return; }
      attempted = true;
      try {
        const result = await write();
        if (result.error) throw new Error("INTERACTIVE_PERSISTENCE_UNCONFIRMED");
        recorded = true;
      } catch (error) {
        if (await input.readback()) { recorded = true; return; }
        throw error;
      }
    },
    async release() {
      if (!await input.owns()) { await input.release(); return; }
      if (!recorded) recorded = await input.readback();
      if (!recorded) {
        if (attempted) throw new Error("INTERACTIVE_RECONCILIATION_REQUIRED");
        attempted = true;
        const result = await input.fallback();
        if (result.error && !await input.readback()) throw new Error("INTERACTIVE_RECONCILIATION_REQUIRED");
        recorded = true;
      }
      await input.release();
    },
  };
}
/** Transport uncertainty is not rejection. A caller must read back before retrying. */
export function interactiveAcceptanceBoundary(result: InteractiveAcceptance | null, transportError: boolean) {
  if (transportError || !result) return { proceed: false, code: "INTERACTIVE_ACCEPTANCE_UNKNOWN", message_accepted: true, status: 409 };
  return {
    proceed: result.status === "accepted",
    code: `INTERACTIVE_${result.status.toUpperCase()}`,
    message_accepted: result.status === "accepted" ? !!result.turn_id : result.status === "duplicate",
    status: result.status === "stopped" ? 200 : 409,
  };
}
export interface InteractiveStore {
  state(): Promise<{ latest: string | null; executor: string | null }>;
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}
/** Handler finally owns early exits; asynchronous stream finally owns transferred work.
 * A client disconnect does not complete the server's running tool/persistence promise. */
export function createInteractiveLifetime(execution: { release(): Promise<void> }) {
  let transferred = false;
  let releasePromise: Promise<void> | null = null;
  const release = () => releasePromise ??= execution.release();
  return {
    transferToStream() { transferred = true; },
    streamFinished: release,
    async handlerFinished() { if (!transferred) await release(); },
    async runStream<T>(work: () => Promise<T>): Promise<T> {
      transferred = true;
      try { return await work(); } finally { await release(); }
    },
  };
}
/** Tested acceptance-to-executor adapter. There is no in-memory instruction backlog. */
export async function startInteractiveTurn(input: {
  intent: string;
  begin(): Promise<{ data: InteractiveAcceptance | null; error: unknown }>;
  store: InteractiveStore;
}) {
  const accepted = await input.begin();
  const boundary = interactiveAcceptanceBoundary(accepted.data, !!accepted.error);
  if (!boundary.proceed) return { boundary, execution: null, lifetime: null };
  const execution = createInteractiveExecution(input.intent, input.store);
  const lifetime = createInteractiveLifetime(execution);
  try { await execution.acquire(); }
  catch (error) {
    await lifetime.handlerFinished();
    return { boundary: { ...boundary, proceed: false, code: (error as Error).message, status: 409 }, execution: null, lifetime: null };
  }
  return { boundary, execution, lifetime };
}
/** A disconnected consumer never abandons an in-flight server effect. Drain the
 * canonical producer until its close (including receipt persistence), then release. */
export function keepInteractiveStreamAlive(source: ReadableStream<Uint8Array>, lifetime: ReturnType<typeof createInteractiveLifetime>) {
  lifetime.transferToStream();
  let disconnected = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!disconnected) controller.enqueue(value);
        }
      } catch (error) { if (!disconnected) controller.error(error); }
      finally {
        await lifetime.streamFinished();
        if (!disconnected) { try { controller.close(); } catch {} }
      }
    },
    cancel() { disconnected = true; },
  });
}
export function createInteractiveExecution(intent: string, store: InteractiveStore) {
  let stopped = false;
  let released = false;
  return {
    get superseded() { return stopped; },
    async check() {
      const state = await store.state();
      if (state.latest !== intent || state.executor !== intent) stopped = true;
      if (stopped) throw new InteractiveSuperseded();
    },
    // Isolated proposed-liveness-check proved a real 20s predecessor settles before
    // this accepted successor acquires. A bounded timeout never steals its token.
    async acquire(waitMs = 240000) {
      const deadline = Date.now() + waitMs;
      do {
        const state = await store.state();
        if (state.latest !== intent) { stopped = true; throw new InteractiveSuperseded(); }
        if (state.executor === intent) throw new Error("INTERACTIVE_ALREADY_RUNNING");
        if (await store.acquire()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      throw new Error("INTERACTIVE_RECONCILIATION_REQUIRED");
    },
    async read(reader: ReadableStreamDefaultReader<Uint8Array>) {
      await this.check();
      // Poll independently of provider bytes: a stalled model can be interrupted too.
      const pending = reader.read().then((value) => ({ value }));
      while (true) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let result: { value: ReadableStreamReadResult<Uint8Array> } | { tick: true };
        try {
          result = await Promise.race([pending,
            new Promise<{ tick: true }>((resolve) => { timer = setTimeout(() => resolve({ tick: true }), 200); })]);
        } finally { clearTimeout(timer); }
        try { await this.check(); } catch (error) {
          void reader.cancel().catch(() => {}); throw error;
        }
        if ("value" in result) return result.value;
      }
    },
    async release() {
      if (!released) { await store.release(); released = true; }
    },
  };
}
