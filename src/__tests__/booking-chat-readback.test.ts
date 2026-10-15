import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { OUTCOME_UNKNOWN_NOTE, thrownOutcomeUnknown } from "../../supabase/functions/_shared/approval-outcome";
import { classifyCrmRun } from "../../supabase/functions/_shared/crm-capability-outcome";

const source = readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8");
const ast = ts.createSourceFile("chat.ts", source, ts.ScriptTarget.Latest, true);
const branches: ts.Block[] = [];
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'tc.function.name === "calendar_book_meeting"'
    && ts.isBlock(node.thenStatement) && node.thenStatement.getText(ast).includes('rpc("create_internal_booking"')) branches.push(node.thenStatement);
  ts.forEachChild(node, visit);
}
visit(ast);
if (branches.length !== 1) throw new Error("Canonical booking binding missing or ambiguous");
const js = ts.transpileModule(branches[0].statements.map(s => s.getText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const execute = new Function("supabaseClient", "args", "personaCtx", "user", "requestExecutionState", "OUTCOME_UNKNOWN_NOTE", "thrownOutcomeUnknown", "resolveActorTenant",
  `return (async()=>{let result;let crmWriteAttempted=false;let bookingReceiptTenant;${js};return {result,crmWriteAttempted,bookingReceiptTenant};})();`);
const bookingId = "11111111-2222-4333-8444-555555555555";
const tenantId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const actorId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const args = { title: " Fixture appointment ", start_at: "2026-11-10T10:00:00-05:00", end_at: "2026-11-10T10:30:00-05:00", timezone: "America/New_York" };
const row = { id: bookingId, tenant_id: tenantId, host_user_id: actorId, contact_id: null, title: "Fixture appointment", start_at: "2026-11-10T15:00:00+00:00", end_at: "2026-11-10T15:30:00+00:00", timezone: "America/New_York", status: "scheduled", notes: null, location: null, guest_name: null, guest_email: null };

async function drive(data: unknown, saved: unknown = row, options: { rpcError?: unknown; rpcThrow?: Error; readError?: unknown; readThrow?: Error; tenant?: string | null; input?: Record<string, unknown> } = {}) {
  const writes: unknown[][] = [], reads: Array<{ table: string; filters: unknown[][]; columns?: string }> = [];
  const state = { needsReview: false };
  const client = {
    rpc: async (...call: unknown[]) => { writes.push(call); if (options.rpcThrow) throw options.rpcThrow; return { data, error: options.rpcError ?? null }; },
    from: (table: string) => {
      const read = { table, filters: [] as unknown[][], columns: "" }; reads.push(read);
      const q = { select: (columns: string) => { read.columns = columns; return q; }, eq: (key: string, value: unknown) => { read.filters.push(["eq", key, value]); return q; }, is: (key: string, value: unknown) => { read.filters.push(["is", key, value]); return q; }, maybeSingle: async () => { if (options.readThrow) throw options.readThrow; return { data: saved, error: options.readError ?? null }; } }; return q;
    },
  };
  const value = await execute(client, { ...args, ...options.input }, { tenant_id: options.tenant === undefined ? tenantId : options.tenant }, { id: actorId }, state, OUTCOME_UNKNOWN_NOTE, thrownOutcomeUnknown, async () => options.tenant ?? null);
  return { ...value, state, writes, reads };
}

describe("Chat booking native acknowledgement and record proof", () => {
  it.each([null, undefined, "", "not-a-booking-id", {}, [], 1, { id: bookingId }])("does not claim a saved booking for malformed acknowledgement %j", async id => {
    const value = await drive(id);
    expect(value.result.success).toBe(false); expect(value.result.outcome_unknown).toBe(true);
    expect(value.result.booking_id).toBeUndefined(); expect(value.state.needsReview).toBe(true);
    expect(value.writes).toHaveLength(1); expect(value.reads).toHaveLength(0);
  });
  it("reports success only after exact caller-readable native record proof", async () => {
    const value = await drive(bookingId);
    expect(value.result).toMatchObject({ success: true, booking_id: bookingId });
    expect(value.state.needsReview).toBe(false);
    expect(value.writes).toHaveLength(1); expect(value.writes[0][0]).toBe("create_internal_booking");
    expect(value.writes[0][1]).toMatchObject({ _title: args.title, _tenant_id: tenantId, _start_at: args.start_at, _end_at: args.end_at });
    expect(value.reads).toHaveLength(1); expect(value.reads[0].table).toBe("internal_bookings");
    expect(value.reads[0].filters).toContainEqual(["eq", "id", bookingId]);
    expect(value.reads[0].filters).toContainEqual(["eq", "tenant_id", tenantId]);
    expect(value.bookingReceiptTenant).toBe(tenantId);
  });
  it.each([null, [], {}, { ...row, id: "99999999-2222-4333-8444-555555555555" }, { ...row, tenant_id: "cccccccc-dddd-4eee-8fff-000000000000" }, { ...row, host_user_id: "dddddddd-eeee-4fff-8000-111111111111" }, { ...row, contact_id: "eeeeeeee-ffff-4000-8111-222222222222" }, { ...row, title: "Different appointment" }, { ...row, start_at: "2026-11-11T15:00:00Z" }, { ...row, end_at: "2026-11-11T15:30:00Z" }, { ...row, timezone: "UTC" }, { ...row, status: "cancelled" }])("withholds success and unverified record identity for missing or changed readback %j", async saved => {
    const value = await drive(bookingId, saved);
    expect(value.result.success).toBe(false); expect(value.result.outcome_unknown).toBe(true);
    expect(value.result.booking_id).toBeUndefined(); expect(value.state.needsReview).toBe(true);
    expect(value.writes).toHaveLength(1);
  });
  it.each([{ readError: { code: "42501" } }, { readThrow: new TypeError("fetch failed") }])("holds an uncertain write without retry when record verification fails %j", async options => {
    const value = await drive(bookingId, row, options);
    expect(value.result).toMatchObject({ success: false, outcome_unknown: true, note: OUTCOME_UNKNOWN_NOTE });
    expect(value.state.needsReview).toBe(true); expect(value.writes).toHaveLength(1);
  });
  it("keeps an answered native authorization refusal on the incumbent error path", async () => {
    const error = { code: "42501", message: "BOOKING_FORBIDDEN: staff of this tenant required" };
    await expect(drive(null, null, { rpcError: error })).rejects.toEqual(error);
  });
  it("holds successors when native transport loses the write answer", async () => {
    const value = await drive(null, null, { rpcThrow: new TypeError("fetch failed after commit") });
    expect(value.result).toMatchObject({ success: false, outcome_unknown: true });
    expect(value.state.needsReview).toBe(true); expect(value.writes).toHaveLength(1);
  });
  it("preserves native contact identity and documented timezone normalization", async () => {
    const contactId = "eeeeeeee-ffff-4000-8111-222222222222";
    const value = await drive(bookingId, { ...row, contact_id: contactId, timezone: "UTC" }, { input: { contact_id: contactId, timezone: " " } });
    expect(value.result).toMatchObject({ success: true, booking_id: bookingId });
    expect(value.writes[0][1]).toMatchObject({ _contact_id: contactId, _timezone: " " });
  });
  it("accepts PostgreSQL-normalized UUID case without rewriting the approved contact argument", async () => {
    const contactId = "eeeeeeee-ffff-4000-8111-222222222222";
    const value = await drive(bookingId, { ...row, contact_id: contactId }, { input: { contact_id: contactId.toUpperCase() } });
    expect(value.result.success).toBe(true); expect(value.writes[0][1]).toMatchObject({ _contact_id: contactId.toUpperCase() });
  });
  it.each(["start_at", "end_at"])("does not collapse a changed native %s within the same millisecond", async field => {
    const stamp = field === "start_at" ? "2026-11-10T15:00:00" : "2026-11-10T15:30:00";
    const value = await drive(bookingId, { ...row, [field]: `${stamp}.000002+00:00` }, { input: { [field]: `${stamp}.000001Z` } });
    expect(value.result.success).toBe(false); expect(value.result.outcome_unknown).toBe(true); expect(value.state.needsReview).toBe(true);
  });
  it("accepts equivalent native timezone offsets and padded fractional precision", async () => {
    const value = await drive(bookingId, { ...row, start_at: "2026-11-10T15:00:00.1234+00:00" }, { input: { start_at: "2026-11-10T10:00:00.123400-05:00" } });
    expect(value.result.success).toBe(true);
  });
  it.each(["notes", "location", "guest_name", "guest_email"])("verifies the explicit stored %s argument before reporting success", async field => {
    const value = await drive(bookingId, { ...row, [field]: "Different fixture value" }, { input: { [field]: "Approved fixture value" } });
    expect(value.result.success).toBe(false); expect(value.result.booking_id).toBeUndefined(); expect(value.state.needsReview).toBe(true);
  });
  it("accepts matching optional native details while leaving contact-derived guests authoritative", async () => {
    const input = { notes: "Fixture note", location: "Fixture room", guest_name: "Test Guest", guest_email: "guest@example.invalid" };
    expect((await drive(bookingId, { ...row, ...input }, { input })).result.success).toBe(true);
    const contactId = "eeeeeeee-ffff-4000-8111-222222222222";
    expect((await drive(bookingId, { ...row, contact_id: contactId, guest_name: "Contact-derived guest", guest_email: "contact@example.invalid" }, { input: { contact_id: contactId } })).result.success).toBe(true);
  });
  it.each(["\u00a0Fixture appointment\u00a0", "\tFixture appointment\t", "Fixture appointment   \n"])("matches PostgreSQL btrim without rewriting legitimate title whitespace %j", async title => {
    const value = await drive(bookingId, { ...row, title }, { input: { title } });
    expect(value.result).toMatchObject({ success: true, booking_id: bookingId });
    expect(value.writes[0][1]).toMatchObject({ _title: title });
  });
  it("supports an authoritatively null native tenant without treating a missing tenant field as proof", async () => {
    const value = await drive(bookingId, { ...row, tenant_id: null }, { tenant: null });
    expect(value.result.success).toBe(true);
    expect(value.reads[0].filters).toContainEqual(["is", "tenant_id", null]);
    expect(value.bookingReceiptTenant).toBeNull();
    const { tenant_id: _omitted, ...missingTenant } = row;
    void _omitted;
    expect((await drive(bookingId, missingTenant, { tenant: null })).result.success).toBe(false);
  });
});

describe("booking capability receipt native tenant", () => {
  let declaration: ts.VariableDeclaration | undefined;
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "recordCrmRun") {
      if (declaration) throw new Error("Ambiguous canonical CRM recorder");
      declaration = node;
    }
    ts.forEachChild(node, find);
  }
  find(ast);
  if (!declaration?.initializer) throw new Error("Canonical CRM recorder missing");
  const code = ts.transpileModule(`const record = ${declaration.initializer.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const load = new Function("tc", "bookingReceiptTenant", "resolveActorTenant", "classifyCrmRun", "recordCapabilityRun", "supabase", "user", "stableRunId", "payloadThreadId", `${code};return record;`);
  const otherTenant = "cccccccc-dddd-4eee-8fff-000000000000";
  it.each([tenantId, null])("attributes booking to its explicit native workspace %j rather than an unrelated default", async scope => {
    const writes: Array<{ tenantId: string | null }> = [];
    const record = load({ function: { name: "calendar_book_meeting", arguments: "{}" }, id: "test-call" }, scope, async () => otherTenant, classifyCrmRun, async (_db: unknown, value: { tenantId: string | null }) => writes.push(value), {}, { id: actorId }, async () => "test-run", "test-thread");
    await record({ result: { success: true, booking_id: bookingId } });
    expect(writes).toHaveLength(1); expect(writes[0].tenantId).toBe(scope);
  });
  it("retains the existing RPC-resolved tenant for the other CRM capabilities", async () => {
    const writes: Array<{ tenantId: string | null }> = [];
    const record = load({ function: { name: "crm_create_task", arguments: "{}" }, id: "test-call" }, tenantId, async () => otherTenant, classifyCrmRun, async (_db: unknown, value: { tenantId: string | null }) => writes.push(value), {}, { id: actorId }, async () => "test-run", "test-thread");
    await record({ result: { success: true, task_id: bookingId } });
    expect(writes).toHaveLength(1); expect(writes[0].tenantId).toBe(otherTenant);
  });
});
