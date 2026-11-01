// Actual adapter + original Calendar reader/projector through controlled SDK
// ports. Synthetic authority/stage acknowledgments are NOT native/customer proof.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readZionCalendar, zionCalendarReadTools, type ZionCalendarDeps, type ZionCalendarScope, type ZionCalendarSource } from "./zion-calendar-read.ts";
import type { CalendarBookingReadCaller } from "../calendar-booking-read.ts";
import { CALENDAR_AGENDA_READ_TOOLS } from "../paige-spine/domains/calendar_booking.ts";

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const window = { from: "2026-11-02T00:00:00-05:00", to: "2026-11-09T00:00:00-05:00" };
const scope = (): ZionCalendarScope => ({ actorId: id(1), tenantId: id(2), workspaceId: id(2), role: "owner",
  accountShape: "solo", actAsClientId: null, scopeEpoch: "original-turn-token", agent: "zion", where: "agent_dm",
  storedTools: ["plan_list", "read_calendar_agenda"] });
const booking = (n = 3) => ({ id: id(n), tenant_id: id(2), calendar_id: id(4), host_user_id: id(1), contact_id: null,
  title: "Original saved commitment", start_at: "2026-11-03T15:00:00Z", end_at: "2026-11-03T15:30:00Z",
  timezone: "America/New_York", status: "confirmed", booking_kind: "single" });
type Reply = { data: unknown; error: unknown };
class Query implements PromiseLike<Reply> {
  readonly value: () => Reply;
  constructor(value: () => Reply) { this.value = value; }
  select() { return this; } eq() { return this; } neq() { return this; } gt() { return this; }
  order() { return this; } limit() { return this; } abortSignal() { return this; }
  then<A = Reply, B = never>(ok?: ((r: Reply) => A | PromiseLike<A>) | null,
    no?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> { return Promise.resolve(this.value()).then(ok, no); }
}
function ports() {
  const origin = scope(), events: string[] = [], sources: ZionCalendarSource[] = [];
  let live = { ...origin }, roster = [...origin.storedTools], active = true, receipt: boolean | "throw" = true;
  let stage: boolean | "throw" | "context_limit" = true, spent = 0, rows = [booking()], readError: unknown = null;
  let onReceipt = () => {}, onStage = () => {};
  const caller = {
    auth: { getUser: async () => { events.push("auth"); return { data: { user: { id: id(1) } }, error: null }; } },
    from: () => new Query(() => ({ data: [{ id: id(2), account_type: "standalone", parent_tenant_id: null }], error: null })),
    rpc: (name: string) => new Query(() => {
      events.push(name);
      return name === "current_user_tenant_id" ? { data: id(2), error: null }
        : name === "list_team_bookings" ? { data: rows, error: readError } : { data: true, error: null };
    }),
  } as unknown as CalendarBookingReadCaller;
  const deps: ZionCalendarDeps = { caller, currentIdentity: () => live,
    isCurrent: async s => active && JSON.stringify(s.storedTools) === JSON.stringify(roster),
    takeRead: () => { if (spent >= 3) return false; spent++; return true; },
    recordRead: async tool => { events.push(`receipt:${tool}`); onReceipt(); if (receipt === "throw") throw Error("uncertain receipt"); return receipt; },
    stageReadContext: async (_s, source) => { events.push("stage"); sources.push(source); onStage(); if (stage === "throw") throw Error("uncertain stage"); return stage; },
  };
  return { origin, deps, events, sources, get spent() { return spent; },
    run: (input: unknown = window) => readZionCalendar(origin, deps, "read_calendar_agenda", input),
    change: { active: (v: boolean) => active = v, identity: (v: Partial<ZionCalendarScope>) => live = { ...live, ...v },
      roster: (v: string[]) => roster = v, receipt: (v: boolean | "throw") => receipt = v,
      stage: (v: boolean | "throw" | "context_limit") => stage = v, spent: (v: number) => spent = v,
      rows: (v: ReturnType<typeof booking>[]) => rows = v, error: (v: unknown) => readError = v,
      onReceipt: (v: () => void) => onReceipt = v, onStage: (v: () => void) => onStage = v } };
}
describe("unmounted same-ZION Calendar composition", () => {
  it("returns no Calendar facts on the known native no-change capacity refusal", async () => {
    const p = ports(); p.change.stage("context_limit");
    const read = await p.run(); assert.equal(read.model.status, "limited");
    assert.equal(JSON.stringify(read.model).includes("Original saved"), false);
    assert.equal("bookings" in read.model, false); assert.equal(await read.revalidate(), false);
    assert.equal(p.sources.length, 1); assert.equal(p.spent, 1);
  });
  it("binds every original shown ID even when the model preview omits rows", async () => {
    const p = ports();
    p.change.rows(Array.from({ length: 51 }, (_, n) => ({ ...booking(n + 10), title: "💼".repeat(120) })));
    const read = await p.run();
    assert.equal(read.model.status, "available");
    assert.ok(Number(read.model.omitted_from_model) > 0);
    const source = p.sources[0];
    assert.deepEqual((source.source as unknown as { source_ids: string[] }).source_ids,
      Array.from({ length: 50 }, (_, n) => id(n + 10)), "all original returned rows, excluding the undisclosed probe");
  });
  it("does not revalidate a changed original ID hidden by the preview byte limit", async () => {
    const p = ports();
    const rows = Array.from({ length: 51 }, (_, n) => ({ ...booking(n + 10), title: "💼".repeat(120) }));
    p.change.rows(rows);
    const read = await p.run();
    assert.equal(read.model.status, "available");
    assert.ok(Number(read.model.omitted_from_model) > 0);
    p.change.rows(rows.map((r, n) => n === 49 ? { ...r, id: id(90) } : n === 50 ? { ...r, id: id(91) } : r));
    assert.equal(await read.revalidate(), false, "original source references cannot silently change outside the preview");
    assert.equal(p.sources.length, 1, "changed source is refused before restaging");
    assert.equal(p.events.filter(e => e.startsWith("receipt:")).length, 1);
  });
  it("offers ONLY the original definition after actual same-scope checks", async () => {
    const p = ports(); assert.deepEqual(await zionCalendarReadTools(p.origin, p.deps), CALENDAR_AGENDA_READ_TOOLS);
    assert.equal(p.events.length, 0); assert.equal(p.spent, 0);
  });
  it("reads through the original caller, then receipts/stages before returning the unchanged canonical preview", async () => {
    const p = ports(), read = await p.run(); assert.equal(read.model.status, "available");
    assert.deepEqual(read.model.window, { from: "2026-11-02T05:00:00.000Z", to: "2026-11-09T05:00:00.000Z" });
    assert.ok(p.events.indexOf("list_team_bookings") < p.events.indexOf("receipt:read_calendar_agenda"));
    assert.ok(p.events.indexOf("receipt:read_calendar_agenda") < p.events.indexOf("stage"));
    assert.equal(p.sources[0].tool, "read_calendar_agenda"); assert.equal(p.sources[0].version, 1);
    assert.equal("updated_at" in p.sources[0], false); assert.equal("read_at" in p.sources[0].source, false);
    assert.equal(Object.isFrozen(p.sources[0]), true); assert.equal(Object.isFrozen(p.sources[0].source.bookings[0]), true);
  });
  for (const [label, over] of [
    ["member", { role: "member" }], ["foreign workspace", { workspaceId: id(9) }], ["Agency", { accountShape: "agency" }],
    ["client focus", { actAsClientId: id(9) }], ["other specialist", { agent: "mentor" }], ["shared room", { where: "channel" }],
    ["missing allowlist", { storedTools: [] }],
  ] as const) it(`withholds a ${label} scope before any source query`, async () => {
    const p = ports(), invalid = { ...p.origin, ...over } as ZionCalendarScope;
    assert.deepEqual(await zionCalendarReadTools(invalid, p.deps), []);
    assert.equal((await readZionCalendar(invalid, p.deps, "read_calendar_agenda", window)).model.status, "unavailable");
    assert.equal(p.events.length, 0);
  });
  for (const field of ["actorId", "role"] as const) it(`does not coerce a non-data ${field}`, async () => {
    const p = ports(); let coerced = 0;
    const invalid = { ...p.origin, [field]: { toString: () => { coerced++; return p.origin[field]; } } } as unknown as ZionCalendarScope;
    assert.deepEqual(await zionCalendarReadTools(invalid, p.deps), []); assert.equal(coerced, 0);
  });
  it("refuses roster accessors without invoking them", async () => {
    const p = ports(); let accessed = 0; const tools: string[] = [];
    Object.defineProperty(tools, 0, { get: () => { accessed++; return "read_calendar_agenda"; }, configurable: true });
    assert.deepEqual(await zionCalendarReadTools({ ...p.origin, storedTools: tools }, p.deps), []); assert.equal(accessed, 0);
  });
  for (const kind of [false, "throw"] as const) it(`withholds private data when original receipt is ${kind}`, async () => {
    const p = ports(); p.change.receipt(kind); const read = await p.run();
    assert.equal(read.model.status, "unavailable"); assert.equal(JSON.stringify(read.model).includes("Original saved"), false);
    assert.equal(p.events.includes("stage"), false);
  });
  for (const kind of [false, "throw"] as const) it(`withholds private data on native stage ${kind}`, async () => {
    const p = ports(); p.change.stage(kind); const read = await p.run();
    assert.equal(read.model.status, "unavailable"); assert.equal(JSON.stringify(read.model).includes("Original saved"), false);
    assert.equal(p.events.filter(s => s === "stage").length, 1);
  });
  it("preserves original refused/unavailable/needs-input results without a success receipt", async () => {
    for (const [error, input, status] of [[{ code: "42501" }, window, "refused"],
      [{ code: "network" }, window, "unavailable"], [null, { ...window, tenant_id: id(2) }, "needs_input"]] as const) {
      const p = ports(); p.change.error(error); assert.equal((await p.run(input)).model.status, status);
      assert.equal(p.events.some(s => s.startsWith("receipt:")), false); assert.equal(p.sources.length, 0);
    }
  });
  it("shares the original total budget; revalidation spends no new slot or receipt", async () => {
    const p = ports(); p.change.spent(2); const read = await p.run(); assert.equal(read.model.status, "available");
    assert.equal(p.spent, 3); assert.equal(await read.revalidate(), true); assert.equal(p.spent, 3);
    assert.equal(p.events.filter(s => s.startsWith("receipt:")).length, 1);
    assert.equal((await p.run()).model.status, "unavailable"); assert.equal(p.spent, 3);
    assert.equal(p.events.filter(s => s === "list_team_bookings").length, 2);
  });
  it("does not let a new observation time masquerade as changed content", async () => {
    const p = ports(), read = await p.run(); await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(await read.revalidate(), true); assert.deepEqual(p.sources[0], p.sources[1]);
  });
  it("withdraws changed source before restaging; never prepares a replacement read result", async () => {
    const p = ports(), read = await p.run(); p.change.rows([{ ...booking(), status: "cancelled" }]);
    assert.equal(await read.revalidate(), false); assert.equal(p.sources.length, 1);
  });
  it("withdraws a changed tenant/role/epoch or roster even if the host boolean stays true", async () => {
    for (const change of [{ tenantId: id(9) }, { role: "admin" }, { scopeEpoch: "new-original-turn" }]) {
      const p = ports(), read = await p.run(); p.change.identity(change); assert.equal(await read.revalidate(), false);
    }
    const p = ports(), read = await p.run(); p.change.roster(["plan_list"]); assert.equal(await read.revalidate(), false);
  });
  it("rechecks authority after the receipt and after the native stage", async () => {
    const a = ports(); a.change.onReceipt(() => a.change.active(false)); assert.equal((await a.run()).model.status, "unavailable");
    assert.equal(a.sources.length, 0);
    const b = ports(); b.change.onStage(() => b.change.identity({ workspaceId: id(9) }));
    assert.equal((await b.run()).model.status, "unavailable");
  });
  it("keeps full titles private and reports original source/model omissions", async () => {
    const p = ports(); p.change.rows(Array.from({ length: 51 }, (_, i) => ({ ...booking(100 + i), title: "🧭".repeat(240) })));
    const read = await p.run(); assert.equal(read.model.status, "available");
    const s = p.sources[0].source; assert.equal(s.source_shown_count, 50); assert.equal(s.source_has_more, true);
    assert.ok(s.shown_count < 50); assert.equal(s.omitted_from_model, 50 - s.shown_count);
    assert.equal(s.bookings[0].title_truncated, true); assert.equal(Array.from(String(s.bookings[0].title_preview)).length, 120);
    assert.equal(JSON.stringify(s).includes('"title":'), false); assert.equal("updated_at" in s.bookings[0], false);
  });
  it("confirms an actually empty original window without claiming free capacity", async () => {
    const p = ports(); p.change.rows([]); const read = await p.run();
    assert.equal(read.model.status, "available"); assert.deepEqual(read.model.bookings, []);
    assert.equal(p.sources[0].source.shown_count, 0); assert.equal(await read.revalidate(), true);
    assert.equal(p.events.filter(s => s.startsWith("receipt:")).length, 1);
    assert.match(String(read.model.message), /not a complete or conflict-free schedule/);
  });
  it("rejects a foreign original row through the incumbent reader, before receipt/stage", async () => {
    const p = ports(); p.change.rows([{ ...booking(), tenant_id: id(9) }]);
    assert.equal((await p.run()).model.status, "unavailable"); assert.equal(p.sources.length, 0);
    assert.equal(p.events.some(s => s.startsWith("receipt:")), false);
  });
  it("refuses sparse/symbol rosters and input accessors without interpreting them", async () => {
    const p = ports(), sparse = ["read_calendar_agenda"]; sparse.length = 2;
    assert.deepEqual(await zionCalendarReadTools({ ...p.origin, storedTools: sparse }, p.deps), []);
    const symbolic = ["read_calendar_agenda"]; Object.defineProperty(symbolic, Symbol("source"), { value: "ignored" });
    assert.deepEqual(await zionCalendarReadTools({ ...p.origin, storedTools: symbolic }, p.deps), []);
    let read = 0; const input = { ...window };
    Object.defineProperty(input, "view", { get: () => { read++; return "team"; } });
    assert.equal((await p.run(input)).model.status, "unavailable"); assert.equal(read, 0); assert.equal(p.events.length, 0);
  });
  it("cancels before stage after a receipt and retires a returned read without another query", async () => {
    const p = ports(), abort = new AbortController(); p.deps.signal = abort.signal;
    p.change.onReceipt(() => abort.abort()); assert.equal((await p.run()).model.status, "unavailable");
    assert.equal(p.sources.length, 0);
    const q = ports(), later = new AbortController(); q.deps.signal = later.signal;
    const read = await q.run(), before = q.events.length; later.abort();
    assert.equal(await read.revalidate(), false); assert.equal(q.events.length, before);
  });
  it("a late original preflight cannot launch a Calendar query or native stage", async t => {
    const p = ports(); let time = 0;
    const clock = t.mock.method(performance, "now", () => time);
    try {
      p.deps.isCurrent = async () => { time = 5001; return true; };
      assert.equal((await p.run()).model.status, "unavailable"); assert.equal(p.events.length, 0); assert.equal(p.spent, 0);
    } finally { clock.mock.restore(); }
  });
});
