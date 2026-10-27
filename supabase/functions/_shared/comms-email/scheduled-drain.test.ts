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

function drain(rows: Record<string, unknown>[]) {
  const releases: { binding: unknown; id: string }[] = [];
  const posts: Record<string, unknown>[] = [];
  let handler: (req: Request) => Promise<Response>;
  const admin = {
    rpc: async (name: string) => name === "claim_due_scheduled_messages" ? { data: rows, error: null } : { data: null, error: null },
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  };
  const scope = {
    Deno: { env: { get: (k: string) => k === "SUPABASE_SERVICE_ROLE_KEY" ? "svc" : k === "SUPABASE_URL" ? "https://proj.example.test" : undefined }, serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => admin,
    scheduledDrainRoute,
    releaseScheduledCommsEmail: async (binding: unknown, id: string) => { releases.push({ binding, id }); return { result: "released" }; },
    resolveCommsEmailParties: async () => { throw new Error("not reached"); },
    readCommsEmailReadiness: async () => { throw new Error("not reached"); },
    emailProvidersFor: () => [],
    commsProviderExecutionAllowed: async () => true,
    runPreSend: async () => ({ proceed: true, outcome: "proceed" }),
    fetch: async (_url: string, init: { body: string }) => { posts.push(JSON.parse(init.body)); return new Response(JSON.stringify({ outcome: "sent" }), { status: 200 }); },
    console: { warn: () => {}, error: () => {}, log: () => {} },
  };
  new Function(...Object.keys(scope), compiled)(...Object.values(scope));
  const run = async () => {
    const res = await handler!(new Request("https://example.test/comms-scheduled-drain", { method: "POST", headers: { Authorization: "Bearer svc" } }));
    return await res.json() as Record<string, unknown>;
  };
  return { run, releases, posts };
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
});
