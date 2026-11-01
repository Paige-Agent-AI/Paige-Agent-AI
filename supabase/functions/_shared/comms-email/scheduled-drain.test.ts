// "Approve now, send later" — which path a row the scheduled drainer leased takes.
// The pure router is tested directly, and the REAL comms-scheduled-drain handler is transpiled and
// run with only its edges substituted: a governed row goes to releaseScheduledCommsEmail and is never
// re-posted as a generic draft; every other queued row keeps the generic re-post exactly as before.
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, it, expect } from "vitest";
import { scheduledDrainRoute, releaseScheduledCommsEmail, type ScheduledReleaseDependencies } from "./adapter.ts";
import { commsEmailBodyHtml, commsEmailContentDigest } from "./contract.ts";

describe("scheduledDrainRoute", () => {
  it("any row whose meta carries the governed binding key is a governed email", () => {
    expect(scheduledDrainRoute({ meta: { comms_email_binding: { operation_id: "x" } } })).toBe("comms_email");
    // `meta ? 'comms_email_binding'` is true for a null value too: never let it fall through to generic.
    expect(scheduledDrainRoute({ meta: { comms_email_binding: null } })).toBe("comms_email");
  });
  it("everything else is the generic release", () => {
    for (const row of [{ meta: {} }, { meta: { scheduled_binding: { contact_id: "c" } } }, { meta: null }, {}, null, "row"]) {
      expect(scheduledDrainRoute(row), JSON.stringify(row)).toBe("generic");
    }
  });
});

const raw = readFileSync("supabase/functions/comms-scheduled-drain/index.ts", "utf8").replace(/^import[\s\S]*?;\r?\n/gm, "");
const compiled = transpileModule(raw, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;

function drain(rows: Record<string, unknown>[], opts: { stepMs?: number; failFetch?: boolean; startMs?: number; orphans?: unknown; orphanError?: boolean } = {}) {
  const removed: string[][] = [];
  const releases: { binding: unknown; id: string }[] = [];
  const posts: Record<string, unknown>[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  // A clock the handler reads; each governed release "takes" stepMs.
  const clock = { t: opts.startMs ?? 1_000_000 };
  let handler: (req: Request) => Promise<Response>;
  const admin = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcs.push({ name, args });
      if (name === "claim_due_scheduled_messages") return { data: rows, error: null };
      if (name === "close_missed_scheduled_comms_emails") return { data: 2, error: null };
      if (name === "unlease_scheduled_messages") return { data: (args._ids as unknown[]).length, error: null };
      if (name === "list_governed_comms_attachment_orphans") return opts.orphanError ? { data: null, error: { message: "down" } } : { data: opts.orphans ?? [], error: null };
      return { data: null, error: null };
    },
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => { removed.push([bucket, ...paths]); return { data: paths.map((name) => ({ name })), error: null }; } }) },
  };
  const scope = {
    Deno: { env: { get: (k: string) => k === "SUPABASE_SERVICE_ROLE_KEY" ? "svc" : k === "SUPABASE_URL" ? "https://proj.example.test" : undefined }, serve: (fn: typeof handler) => { handler = fn; } },
    Date: { now: () => clock.t },
    createClient: () => admin,
    scheduledDrainRoute,
    releaseScheduledCommsEmail: async (binding: unknown, id: string) => { releases.push({ binding, id }); clock.t += opts.stepMs ?? 0; return { result: "released" }; },
    resolveCommsEmailParties: async () => { throw new Error("not reached"); },
    readCommsEmailReadiness: async () => { throw new Error("not reached"); },
    emailProvidersFor: () => [],
    commsProviderExecutionAllowed: async () => true,
    runPreSend: async () => ({ proceed: true, outcome: "proceed" }),
    fetch: async (_url: string, init: { body: string }) => { posts.push(JSON.parse(init.body)); if (opts.failFetch) throw new DOMException("aborted", "AbortError"); return new Response(JSON.stringify({ outcome: "sent" }), { status: 200 }); },
    console: { warn: () => {}, error: () => {}, log: () => {} },
  };
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const run = async () => {
    const res = await handler!(new Request("https://example.test/comms-scheduled-drain", { method: "POST", headers: { Authorization: "Bearer svc" } }));
    return await res.json() as Record<string, unknown>;
  };
  return { run, releases, posts, rpcs, removed };
}

const governed = { id: "60000000-0000-4000-8000-000000000001", channel_type: "email", recipients: [{ address: "dana@x.test" }], body_text: "Hello", body_html: "<p>Hello</p>", subject: "Hi",
  contact_id: "c1", connector_id: "s1", thread_key: "t", attachments: null, meta: { comms_email_binding: { operation_id: "op-1", send_at: "2026-11-02T14:30:00.000Z" }, drain_claimed_at: "now" } };
const ordinary = { ...governed, id: "60000000-0000-4000-8000-000000000002", meta: { scheduled_binding: { contact_id: "c1", connector_id: "s1" } } };

describe("comms-scheduled-drain routing", () => {
  it("a governed row goes to the governed release, never to the generic re-post", async () => {
    const t = drain([governed]);
    const out = await t.run();
    expect(t.releases).toEqual([{ binding: governed.meta.comms_email_binding, id: governed.id }]);
    expect(t.posts).toEqual([]);
    expect(out).toMatchObject({ claimed: 1, released: 0, governed: { released: 1, refused: 0, left: 0 } });
  });
  it("an ordinary queued row keeps the generic re-post (unchanged), side by side with a governed one", async () => {
    const t = drain([ordinary, governed]);
    const out = await t.run();
    expect(t.posts).toEqual([expect.objectContaining({ message_id: ordinary.id, channel: "email", to: "dana@x.test" })]);
    expect(t.posts[0]).not.toHaveProperty("comms_email_scheduled_release");
    expect(t.releases.map((r) => r.id)).toEqual([governed.id]);
    expect(out).toMatchObject({ claimed: 2, released: 1 });
  });
  it("an ordinary release that never answers is counted failed and the run moves on", async () => {
    const t = drain([ordinary, { ...ordinary, id: "60000000-0000-4000-8000-000000000003" }], { failFetch: true });
    const out = await t.run();
    expect(t.posts.map((p) => p.message_id)).toEqual([ordinary.id, "60000000-0000-4000-8000-000000000003"]);
    expect(out).toMatchObject({ claimed: 2, released: 0, failed: 2 });
  });
  it("every run first closes governed emails past their grace (the sweep), then leases", async () => {
    const t = drain([governed]);
    const out = await t.run();
    expect(t.rpcs.map((c) => c.name).slice(0, 2)).toEqual(["close_missed_scheduled_comms_emails", "claim_due_scheduled_messages"]);
    expect(out).toMatchObject({ missed_closed: 2 });
  });
  it("stops taking rows after its run-time budget and hands the unreached leases back", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...governed, id: `60000000-0000-4000-8000-00000000010${i}` }));
    const t = drain(rows, { stepMs: 15_000 });
    const out = await t.run();
    // 0 s, 15 s, 30 s are under the 40 s budget; at 45 s the run stops taking rows.
    expect(t.releases.map((r) => r.id)).toEqual(rows.slice(0, 3).map((r) => r.id));
    expect(t.rpcs.find((c) => c.name === "unlease_scheduled_messages")?.args).toEqual({ _ids: rows.slice(3).map((r) => r.id), _stamp: "now" });
    expect(out).toMatchObject({ claimed: 5, unreached: 2 });
  });
  it("hands back each lease only under the stamp this run's claim wrote, and never a row with no stamp", async () => {
    const stamped = (i: number, stamp?: string) => ({ ...governed, id: `60000000-0000-4000-8000-00000000020${i}`,
      meta: { ...governed.meta, ...(stamp ? { drain_claimed_at: stamp } : { drain_claimed_at: undefined }) } });
    const rows = [stamped(0, "a"), stamped(1, "a"), stamped(2, "b"), stamped(3, "a"), stamped(4)];
    const t = drain(rows, { stepMs: 45_000 });
    await t.run();
    const calls = t.rpcs.filter((c) => c.name === "unlease_scheduled_messages").map((c) => c.args);
    expect(calls).toEqual([{ _ids: [rows[1].id, rows[3].id], _stamp: "a" }, { _ids: [rows[2].id], _stamp: "b" }]);
  });
  it("within budget nothing is handed back", async () => {
    const t = drain([governed, governed]);
    await t.run();
    expect(t.rpcs.map((c) => c.name)).not.toContain("unlease_scheduled_messages");
  });
});

// Governed email files: the drainer removes copies no send will ever need, once an hour (the run at
// minute 7 of the hour), bounded, and only governed paths.
describe("comms-scheduled-drain governed file retention", () => {
  const minute = (m: number) => (3_000 * 60 + m) * 60_000; // hour 3000, minute m
  const T = "10000000-0000-4000-8000-000000000001";
  const orphan = `${T}/governed/20000000-0000-4000-8000-000000000001/1-a.pdf`;
  it("at minute 7 it lists the orphans and removes only governed paths", async () => {
    const t = drain([], { startMs: minute(7), orphans: [orphan, `${T}/90000000-0000-4000-8000-000000000001-a.pdf`, 42] });
    const out = await t.run();
    expect(t.rpcs.find((c) => c.name === "list_governed_comms_attachment_orphans")?.args).toEqual({ _limit: 100 });
    expect(t.removed).toEqual([["comms-attachments", orphan]]);
    expect(out).toMatchObject({ governed_files_removed: 1 });
  });
  it("every other minute it does nothing, and a failed read removes nothing", async () => {
    for (const m of [0, 6, 8, 59]) {
      const t = drain([], { startMs: minute(m), orphans: [orphan] });
      await t.run();
      expect(t.rpcs.map((c) => c.name)).not.toContain("list_governed_comms_attachment_orphans");
      expect(t.removed).toEqual([]);
    }
    const failed = drain([], { startMs: minute(7), orphanError: true });
    expect(await failed.run()).toMatchObject({ governed_files_removed: 0 });
    expect(failed.removed).toEqual([]);
  });
  it("decides 'the hour's sweep run' from when the run STARTED, not when it ended", async () => {
    const row = { ...governed, id: "60000000-0000-4000-8000-000000000401" };
    // Started at 6:50, ended at 7:05: not the sweep run.
    const late = drain([row], { startMs: minute(6) + 50_000, stepMs: 15_000, orphans: [orphan] });
    await late.run();
    expect(late.rpcs.map((c) => c.name)).not.toContain("list_governed_comms_attachment_orphans");
    // Started at 7:50, ended at 8:05: the sweep run (and 25 s of budget is left).
    const early = drain([row], { startMs: minute(7) + 50_000, stepMs: 15_000, orphans: [orphan] });
    await early.run();
    expect(early.removed).toEqual([["comms-attachments", orphan]]);
  });
  it("is skipped when the run has used up its time budget", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ ...governed, id: `60000000-0000-4000-8000-00000000030${i}` }));
    const t = drain(rows, { startMs: minute(7), stepMs: 15_000, orphans: [orphan] });
    await t.run();
    expect(t.rpcs.map((c) => c.name)).not.toContain("list_governed_comms_attachment_orphans");
  });
});

// The release of a scheduled email WITH files: the request is the bound row exactly as before (files are
// read from the binding by send-message, never sent in the request), and send-message's refusal of a
// changed file is settled from the readback — closed by send-message, never re-closed or retried here.
describe("releaseScheduledCommsEmail with files", () => {
  const T = "10000000-0000-4000-8000-000000000001", A = "40000000-0000-4000-8000-000000000001", OP = "20000000-0000-4000-8000-000000000001";
  const C = "30000000-0000-4000-8000-000000000001", S = "50000000-0000-4000-8000-000000000001", M = "60000000-0000-4000-8000-000000000001";
  const SEND_AT = "2026-11-02T14:30:00.000Z";
  const files = [{ path: `${T}/governed/${OP}/1-a.pdf`, source_path: `${T}/90000000-0000-4000-8000-000000000001-a.pdf`, name: "a.pdf", mime: "application/pdf", size: 9, sha256: "b".repeat(64) }];
  const binding = async () => ({ operation_id: OP, tenant_id: T, actor_user_id: A, contact_id: C, connector_id: S, recipient: "dana@x.test", from_address: "owner@biz.test",
    subject: "Hi", body_text: "Hello there", body_html: commsEmailBodyHtml("Hello there"), state: "prepared", send_at: SEND_AT, attachments: files,
    content_digest: await commsEmailContentDigest({ recipient: "dana@x.test", connectorId: S, subject: "Hi", bodyText: "Hello there" }) });
  const deps = (after: string, code: string | null) => {
    const sends: Record<string, unknown>[] = []; const closes: unknown[] = []; const options: unknown[] = []; let reads = 0;
    const d: ScheduledReleaseDependencies = {
      now: () => Date.parse(SEND_AT) + 30_000,
      providerExecutionAllowed: async () => true,
      resolveParties: async () => ({ kind: "resolved", contactId: C, contactName: "Dana", recipient: "dana@x.test", connectorId: S, fromAddress: "owner@biz.test" }),
      readiness: async () => ({ eligible: true, state: "ready", reason: "READY_FOR_GOVERNED_REVIEW", provider_execution_verified: false }),
      readBinding: async () => ({ operation_id: OP, send_at: SEND_AT, state: ++reads === 1 ? "prepared" : after, eligible: true, attachments: files }),
      send: async (b, o) => { sends.push(b); options.push(o); return { answered: true, code }; },
      closeRefused: async (c) => { closes.push(c); return true; },
      markSupportCase: async () => {},
    };
    return { d, sends, closes, options };
  };
  it("is released through send-message exactly as a release without files", async () => {
    const t = deps("provider_accepted", null);
    expect(await releaseScheduledCommsEmail(await binding(), M, t.d)).toEqual({ result: "released" });
    expect(t.sends).toEqual([{ channel: "email", to: "dana@x.test", contact_id: C, connector_id: S, message_id: M, subject: "Hi", body: commsEmailBodyHtml("Hello there"),
      comms_email_operation_id: OP, idempotency_key: `comms-email:${OP}`, comms_email_scheduled_release: true }]);
    // The release tells the drainer the email carries files, so it waits long enough for send-message to
    // re-read and re-hash them before its claim.
    expect(t.options).toEqual([{ withFiles: true }]);
    const plain = deps("provider_accepted", null);
    const { attachments: _none, ...noFiles } = await binding();
    await releaseScheduledCommsEmail(noFiles, M, plain.d);
    expect(plain.options).toEqual([{ withFiles: false }]);
  });
  it("a file send-message found changed is settled from the readback (refused there), never closed again here", async () => {
    const t = deps("refused", null);
    expect(await releaseScheduledCommsEmail(await binding(), M, t.d)).toEqual({ result: "settled" });
    expect(t.closes).toEqual([]);
  });
  it("a scheduled saved reply records only its original accepted operation, without another transport",async()=>{
    const approval="80000000-0000-4000-8000-000000000001";
    const raw={...await binding(),approval_id:approval,governance:{approval_id:approval,draft_source:{message_id:M,updated_at:"2026-10-30T16:00:00.123456Z"}},
      command:{action:"comms.email_send",contact_id:C,connector_id:S,subject:"Hi",body:"Hello there"}};
    for(const status of ["recorded","pending_record"] as const){
      const t=deps("provider_accepted",null);let reads=0;const records:unknown[]=[];
      t.d.readBinding=async()=>({...raw,state:++reads===1?"prepared":"provider_accepted",eligible:true});
      t.d.recordAccepted=async input=>{records.push(input);return status;};
      expect(await releaseScheduledCommsEmail(raw,M,t.d)).toEqual({result:"released",record_status:status});
      expect(t.sends).toHaveLength(1);expect(records).toEqual([{approvalId:approval,operationId:OP,actorUserId:A}]);
    }
  });
  it("a saved scheduled reply without its recorder cannot dispatch",async()=>{
    const approval="80000000-0000-4000-8000-000000000001",t=deps("provider_accepted",null);
    const raw={...await binding(),approval_id:approval,governance:{approval_id:approval,draft_source:{message_id:M,updated_at:"2026-10-30T16:00:00.123456Z"}},
      command:{action:"comms.email_send",contact_id:C,connector_id:S,subject:"Hi",body:"Hello there"}};
    expect(await releaseScheduledCommsEmail(raw,M,t.d)).toEqual({result:"left",reason:"approval_recorder_unavailable"});
    expect(t.sends).toEqual([]);
  });
});
