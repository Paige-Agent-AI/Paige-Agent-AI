// One private purpose on the ORIGINAL Systems host. Not public admission,
// a scheduler, a drainer, or another execution/authority system.
import { isAuthorizedInternalCaller, json } from "./systems-check-http.ts";
import { consumeManualSystemsCheckWork, isManualSystemsWorkId } from "./systems-check-manual-work.ts";
import { awaitSystemsCheckCapture } from "./systems-check-runner.ts";
import type { RunSystemsCheckOptions } from "./systems-check-runner.ts";

type Ports = {
  admin: RunSystemsCheckOptions["admin"];
  /** Existing platform lifetime; missing/rejected registration never starts work. */
  defer?: (task: Promise<void>) => void;
  /** Native AbortSignal.timeout in production; no timer/executor inside adapter. */
  deadline?: (milliseconds: number) => AbortSignal;
};

async function readRequest(req: Request, deadline: AbortSignal): Promise<string> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("Content-Type") ?? "")) throw new Error("invalid_request");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const aborted = () => req.signal.aborted || deadline.aborted;
  req.signal.addEventListener("abort", cancel, { once: true });
  deadline.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (aborted()) throw new Error("invalid_request");
    while (true) {
      const { done, value } = await reader.read();
      if (aborted()) throw new Error("invalid_request");
      if (done) break;
      if (!(value instanceof Uint8Array) || length + value.byteLength > 4_096 || chunks.length >= 64) throw new Error("invalid_request");
      chunks.push(value); length += value.byteLength;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1
      || !isManualSystemsWorkId(body.work_id)) throw new Error("invalid_request");
    return body.work_id;
  } catch (error) { cancel(); throw error; }
  finally {
    req.signal.removeEventListener("abort", cancel);
    deadline.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function handleManualSystemsWork(req: Request, ports: Ports): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const url = new URL(req.url);
  if (url.searchParams.getAll("manual_work").length !== 1 || url.searchParams.get("manual_work") !== "1"
    || [...url.searchParams.keys()].some(key => key !== "manual_work")) return json(400, { error: "invalid_manual_work_request" });
  const deadline = ports.deadline ?? (milliseconds => AbortSignal.timeout(milliseconds));
  let transport: AbortSignal, workId: string;
  try {
    transport = deadline(5_000);
    if (!(transport instanceof AbortSignal)) throw new Error("invalid_deadline");
    workId = await readRequest(req, transport);
  } catch { return json(400, { error: "invalid_manual_work_request" }); }
  try {
    // Same existing internal gate, bounded with the ORIGINAL capture wait. The
    // formatted Work UUID here supplies no authority: native claim still decides.
    const allowed = await awaitSystemsCheckCapture(() => isAuthorizedInternalCaller(req, ports.admin), transport, workId, "work_claim");
    if (!allowed) return json(401, { error: "unauthorized" });
  } catch { return json(503, { error: "manual_dispatch_unconfirmed" }); }
  if (req.signal.aborted || transport.aborted) return json(400, { error: "invalid_manual_work_request" });
  if (typeof ports.defer !== "function") return json(503, { error: "background_lifetime_unavailable" });
  // Register the existing platform lifetime BEFORE the microtask may claim.
  // A rejected registration cannot leave an untracked operation running.
  let registered = false;
  const task = Promise.resolve().then(async () => {
    if (!registered) return;
    try {
      await consumeManualSystemsCheckWork({ admin: ports.admin, workId,
        captureSignal: deadline(90_000), settlementSignal: () => deadline(5_000) });
    } catch { console.warn("[systems-check] private manual dispatch unconfirmed"); }
  });
  try { ports.defer(task); registered = true; }
  catch { return json(503, { error: "background_lifetime_unavailable" }); }
  // Delivery acknowledgement only, never a claim that Work exists, started,
  // completed, or produced a receipt. Read the original authorized Work/result.
  return json(202, { work_id: workId, dispatch_acknowledged: true, execution_confirmed: false });
}
