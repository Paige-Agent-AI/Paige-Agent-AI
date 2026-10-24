import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { createInteractiveExecution, createInteractiveLifetime, createInteractiveSettlement, interactiveEffect,
  interactiveReceiptContext, interactiveAcceptanceBoundary, keepInteractiveStreamAlive, InteractiveSuperseded } from "./interactive.ts";

Deno.test("INT-336 latest generation wins without token theft", async () => {
  let latest = "a", executor: string | null = null;
  const make = (id: string) => createInteractiveExecution(id, {
    state: async () => ({ latest, executor }),
    acquire: async () => { if (executor || latest !== id) return false; executor = id; return true; },
    release: async () => { if (executor === id) executor = null; },
  });
  const a = make("a"); await a.acquire(); latest = "b";
  await assertRejects(a.check, InteractiveSuperseded);
  const b = make("b"); await assertRejects(() => b.acquire(1), Error, "RECONCILIATION_REQUIRED");
  assertEquals(executor, "a"); await a.release(); await b.acquire();
  await a.release(); assertEquals(executor, "b"); await b.release();
});
Deno.test("INT-336 stalled model bytes interrupt; tool settlement remains awaited", async () => {
  let latest = "a";
  const execution = createInteractiveExecution("a", { state: async () => ({ latest, executor: "a" }), acquire: async () => true, release: async () => {} });
  const reader = new ReadableStream<Uint8Array>({ start() {} }).getReader();
  const pending = execution.read(reader); latest = "b";
  await assertRejects(() => pending, InteractiveSuperseded);
  let releaseCount = 0;
  const lifetime = createInteractiveLifetime({ release: async () => { releaseCount++; } });
  let finish!: () => void;
  const work = new Promise<void>((resolve) => { finish = resolve; });
  const stream = keepInteractiveStreamAlive(new ReadableStream<Uint8Array>({ async pull(c) { await work; c.close(); } }), lifetime);
  await stream.cancel(); await lifetime.handlerFinished(); assertEquals(releaseCount, 0);
  finish(); await new Promise((resolve) => setTimeout(resolve, 0)); assertEquals(releaseCount, 1);
});
Deno.test("INT-336 released publication stays distinct from strict execution ownership", async () => {
  let latest: string | null = "a", executor: string | null = null;
  const make = () => createInteractiveExecution("a", {
    state: async () => ({ latest, executor }),
    acquire: async () => { executor = "a"; return true; },
    release: async () => { executor = null; },
    publication: async () => latest === "a" && executor === null,
  });
  const execution = make(); await execution.acquire(); await execution.check();
  await execution.release(); await execution.checkReleasedPublication();
  latest = "b";
  await assertRejects(execution.checkReleasedPublication, InteractiveSuperseded);
  latest = "a";
  const strict = make(); await strict.acquire(); await strict.release();
  await assertRejects(strict.check, InteractiveSuperseded);
});
Deno.test("INT-336 publication refuses pre-release and null latest", async () => {
  for (const released of [false, true]) {
    let latest: string | null = "a", executor: string | null = null;
    const execution = createInteractiveExecution("a", {
      state: async () => ({ latest, executor }),
      acquire: async () => { executor = "a"; return true; },
      release: async () => { executor = null; latest = null; },
      publication: async () => latest === "a" && executor === null,
    });
    await execution.acquire();
    if (released) await execution.release();
    await assertRejects(execution.checkReleasedPublication, InteractiveSuperseded);
  }
});
Deno.test("INT-336 missing native publication proof is not replaced by old executor state", async () => {
  let executor: string | null = null;
  const execution = createInteractiveExecution("a", {
    state: async () => ({ latest: "a", executor }),
    acquire: async () => { executor = "a"; return true; },
    release: async () => { executor = null; },
  });
  await execution.acquire(); await execution.release();
  await assertRejects(execution.checkReleasedPublication, InteractiveSuperseded);
});
Deno.test("INT-336 receipt uncertainty cannot release, canonical repair can", async () => {
  let exists = false, releases = 0, writes = 0;
  const settlement = createInteractiveSettlement({ owns: async () => true, readback: async () => exists,
    fallback: async () => ({ error: null }), release: async () => { releases++; } });
  await assertRejects(() => settlement.persist(async () => { writes++; return { error: new Error("transport unknown") }; }));
  await assertRejects(settlement.release, Error, "RECONCILIATION_REQUIRED"); assertEquals(releases, 0);
  exists = true; await settlement.persist(async () => { writes++; return { error: null }; });
  await settlement.release(); assertEquals(writes, 1); assertEquals(releases, 1);
});
Deno.test("INT-336 closed receipt projection retains write, unknown, durable identities", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const effects = [interactiveEffect("plan_assign_task", { success: true, task_id: id, secret: "never expose" }),
    interactiveEffect("comms_send_email", { success: false, code: "SEND_OUTCOME_UNKNOWN" }),
    interactiveEffect("document_generate", { accepted: true, work_id: id })];
  const context = interactiveReceiptContext({ interactive: { effects } });
  assert(context.includes("outcome_unknown")); assert(context.includes("durable_accepted"));
  assert(context.includes(id)); assert(!context.includes("never expose"));
  assertEquals(interactiveEffect("comms_send_email", {})?.outcome, "outcome_unknown");
  assertEquals(interactiveAcceptanceBoundary(null, true).message_accepted, true);
  assertEquals(interactiveAcceptanceBoundary({ status: "superseded" }, false).message_accepted, false);
});

Deno.test("original specialist invocation survives the existing effect and receipt projection without upgrading uncertainty", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  for (const result of [{ ok: true, runtime: "soft", receipt_recorded: true },
    { ok: false, outcome_unknown: true }, { ok: true, runtime: "langgraph", success: false, outcome_unknown: true }]) {
    const effect = interactiveEffect("delegate_to_subagent", { ...result, invocation_id: id, secret: "private input" })!;
    assertEquals(effect.record_refs, [{ kind: "subagent_invocation", id }]);
    if (result.outcome_unknown) assertEquals(effect.outcome, "outcome_unknown");
    const context = interactiveReceiptContext({ interactive: { effects: [effect] } });
    assert(context.includes(id)); assert(!context.includes("private input"));
  }
});

Deno.test("specialist references are excluded from other tools and malformed original identities", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  for (const tool of ["list_subagents", "crm_create_task"]) {
    assertEquals(interactiveEffect(tool, { ok: true, invocation_id: id })?.record_refs, undefined);
    const context = interactiveReceiptContext({ interactive: { effects: [{ tool, outcome: "reported_success",
      record_refs: [{ kind: "subagent_invocation", id }] }] } });
    assert(!context.includes(id));
  }
  for (const invocation_id of [null, {}, "invalid", ` ${id}`, { id }]) {
    assertEquals(interactiveEffect("delegate_to_subagent", { ok: false, outcome_unknown: true, invocation_id })?.record_refs, undefined);
  }
  assertEquals(interactiveEffect("crm_create_task", { success: true, task_id: id, invocation_id: id })?.record_refs, [{ kind: "task", id }]);
});

Deno.test("a declared closed read cannot borrow a specialist invocation as read-success evidence", () => {
  const declaration = { action: { chatTool: "read_fixture", classification: "read", riskPolicyKey: "read_only", approvalAuthority: "none",
    executor: "edge.fixture", idempotency: "read only" }, outcome: { kinds: ["available", "needs_input", "refused", "unavailable"], projector: "fixture" } } as const;
  const read = { status: "available", message: "Read original record" };
  assertEquals(interactiveEffect("read_fixture", read, [declaration])?.outcome, "reported_success");
  assertEquals(interactiveEffect("read_fixture", { ...read, invocation_id: "00000000-0000-4000-8000-000000000001" }, [declaration])?.outcome, "outcome_unknown");
});
