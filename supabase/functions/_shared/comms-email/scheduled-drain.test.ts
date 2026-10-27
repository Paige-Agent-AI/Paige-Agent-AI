// "Approve now, send later" — which path a row the scheduled drainer leased takes.
// The pure router is tested directly, and the REAL comms-scheduled-drain handler is transpiled and
// run with only its edges substituted: a governed row goes to releaseScheduledCommsEmail and is never
// re-posted as a generic draft; every other queued row keeps the generic re-post exactly as before.
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { describe, it, expect } from "vitest";
import { scheduledDrainRoute } from "./adapter.ts";

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

function drain(rows: Record<string, unknown>[], opts: { stepMs?: number; failFetch?: boolean } = {}) {
  const releases: { binding: unknown; id: string }[] = [];
  const posts: Record<string, unknown>[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  // A clock the handler reads; each governed release "takes" stepMs.
  const clock = { t: 1_000_000 };
  let handler: (req: Request) => Promise<Response>;
  const admin = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcs.push({ name, args });
      if (name === "claim_due_scheduled_messages") return { data: rows, error: null };
      if (name === "close_missed_scheduled_comms_emails") return { data: 2, error: null };
      if (name === "unlease_scheduled_messages") return { data: (args._ids as unknown[]).length, error: null };
      return { data: null, error: null };
    },
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
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
  return { run, releases, posts, rpcs };
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
