// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarAgendaForModel, type readCalendarAgenda } from "../../supabase/functions/_shared/calendar-booking-read";
import { recordCapabilityRun, stableRunId } from "../../supabase/functions/_shared/capability-record";

// Execute ONLY the actual owned dispatch branch with explicit identity, reader
// and RPC ports. This is handler integration, not a database/Auth/customer test.
const source = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
const branches: ts.Block[] = [];
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'tc.function.name === "read_calendar_agenda"'
    && ts.isBlock(node.thenStatement)) branches.push(node.thenStatement);
  ts.forEachChild(node, visit);
}
visit(ast);
if (branches.length !== 1) throw new Error("Exactly one original Calendar agenda handler required");
const js = ts.transpileModule(`async function execute(p) {
  const {user,turnScopeTenantId,calendarBookingRole,calendarBookingAccountShape,scopedClientId,payloadThreadId,
    validatedData,req,tenantKnowledgeScopeRevoked,customerPortal,callerTier,personaCtx,readCalendarAgenda,
    supabaseClient,revalidateTenantKnowledgeScope,recordCapabilityRun,supabase,stableRunId,tc,calendarAgendaForModel}=p;
  const toolResults=[],readRecordLinkSource=new Map();
  ${branches[0].getText(ast)}
  return {model:JSON.parse(toolResults[0].content),links:[...readRecordLinkSource.values()]};
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const execute = new Function(`${js}\nreturn execute;`)() as (p: Record<string, unknown>) => Promise<{
  model: Record<string, unknown>; links: unknown[];
}>;

type Agenda = Awaited<ReturnType<typeof readCalendarAgenda>>;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const available = (empty = false): Agenda => ({ status: "available", view: "mine",
  window: { from: "2026-11-02T00:00:00-05:00", to: "2026-11-09T00:00:00-05:00" },
  bookings: empty ? [] : [{ id: id(3), tenant_id: id(2), calendar_id: id(4), host_user_id: id(1), contact_id: null,
    title: "PRIVATE original commitment", start_at: "2026-11-03T15:00:00Z", end_at: "2026-11-03T15:30:00Z",
    timezone: "America/New_York", status: "confirmed", booking_kind: "single" }],
  shown_count: empty ? 0 : 1, has_more: false, read_at: "2026-11-01T15:00:00Z", message: "Original Calendar observations" });

function harness(result = available(), receipt: "native" | "error" | "throw" = "native") {
  const writes = new Map<string, Record<string, unknown>>();
  // Current native contract da077602 rejects dotted keys. Reproduce only that
  // service response here; the REAL shared recordCapabilityRun handles it.
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    expect(name).toBe("record_capability_run");
    if (receipt === "throw") throw new Error("Receipt transport uncertain");
    if (receipt === "error") return { data: null, error: { message: "Receipt not recorded" } };
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(String(args._capability_key))) {
      return { data: null, error: { message: "CAPABILITY_RUN_KEY_INVALID" } };
    }
    writes.set(String(args._run_id), args); return { data: true, error: null };
  });
  const reader = vi.fn(async () => result);
  const p = { user: { id: id(1) }, turnScopeTenantId: id(2), calendarBookingRole: "owner",
    calendarBookingAccountShape: "solo", scopedClientId: null, payloadThreadId: id(5), validatedData: {},
    req: { signal: new AbortController().signal }, tenantKnowledgeScopeRevoked: false, customerPortal: false,
    callerTier: "tenant", personaCtx: { tenant_id: id(2) }, readCalendarAgenda: reader, supabaseClient: {},
    revalidateTenantKnowledgeScope: async () => true, recordCapabilityRun, supabase: { rpc }, stableRunId,
    tc: { id: "original-calendar-call", function: { name: "read_calendar_agenda", arguments: JSON.stringify(result.status === "available" ? result.window : {}) } },
    calendarAgendaForModel };
  return { run: () => execute(p), p, reader, rpc, writes };
}
afterEach(() => vi.restoreAllMocks());

describe("original Calendar agenda result and canonical receipt", () => {
  it("records the original tool key with exact actor/business before exposing the actual read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness(), answer = await h.run();
    expect(h.rpc).toHaveBeenCalledOnce();
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ _tenant_id: id(2), _actor_id: id(1),
      _capability_key: "read_calendar_agenda", _outcome: "capability_succeeded" });
    expect(h.writes.size).toBe(1); expect(answer.model.status).toBe("available");
    expect(JSON.stringify(answer.model)).toContain("PRIVATE original commitment");
    expect(answer.links).toEqual([[{ destination: "calendar", record_id: null }]]);
  });
  it.each(["error", "throw"] as const)("withholds private rows and navigation on receipt %s", async mode => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness(available(), mode), answer = await h.run();
    expect(answer.model.status).toBe("unavailable");
    expect(JSON.stringify(answer)).not.toContain("PRIVATE original commitment");
    expect(JSON.stringify(answer)).not.toContain(id(3)); expect(answer.links).toEqual([]);
    expect(h.writes.size).toBe(0); expect(h.rpc).toHaveBeenCalledOnce();
  });
  it("records a confirmed empty window without manufacturing a booking link", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness(available(true)), answer = await h.run();
    expect(h.writes.size).toBe(1); expect(answer.model.status).toBe("available");
    expect(answer.model.bookings).toEqual([]); expect(answer.links).toEqual([]);
  });
  it.each(["refused", "unavailable", "needs_input"] as const)("does not receipt or relabel a %s read", async status => {
    const result = { status, message: "Original reader boundary" } as Agenda;
    const h = harness(result), answer = await h.run();
    expect(h.rpc).not.toHaveBeenCalled(); expect(answer.model.status).toBe(status); expect(answer.links).toEqual([]);
  });
  it("keeps the same original receipt identity when the same call is inspected again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness(); await h.run(); await h.run();
    expect(h.rpc).toHaveBeenCalledTimes(2); expect(h.writes.size).toBe(1);
    expect(h.rpc.mock.calls[0][1]._run_id).toBe(h.rpc.mock.calls[1][1]._run_id);
  });
});
