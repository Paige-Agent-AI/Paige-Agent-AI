import { test } from "node:test";
import assert from "node:assert/strict";
import { createNexusEmailDraftSaver, nexusEmailDraftOperationId, type NexusEmailDraftScope } from "./nexus-email-draft.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const conversation = "33333333-3333-4333-8333-333333333333";
const message = "44444444-4444-4444-8444-444444444444";
const contact = "55555555-5555-4555-8555-555555555555";
const draft = "66666666-6666-4666-8666-666666666666";
const receipt = "77777777-7777-4777-8777-777777777777";
const source = { message_id: draft, updated_at: "2026-11-02T18:32:10.123456+00:00" };
const scope = (over: Partial<NexusEmailDraftScope> = {}): NexusEmailDraftScope => ({
  agent: "nexus", where: "agent_dm", tenantId: tenant, actorId: actor,
  conversationId: conversation, sourceMessageId: message,
  storedTools: ["comms_send_email"], contactIds: [contact], draftSource: source, ...over,
});
const input = () => ({ contact_id: contact, subject: "Project update", body: "The revised outline is ready for review.", save_draft: true, draft_source: { ...source } });
type Call = { name: string; body: Record<string, unknown> };
function setup(options: { current?: () => Promise<boolean>; permit?: () => Promise<boolean>;
  response?: (body: Record<string, unknown>) => unknown | Promise<unknown>; over?: Partial<NexusEmailDraftScope>;
  signal?: AbortSignal; timeoutMs?: number } = {}) {
  const calls: Call[] = [];
  let selections = 0;
  const save = createNexusEmailDraftSaver(scope(options.over), {
    // The host must independently revalidate actor/DM/roster and explicit exact-content handoff.
    isCurrent: options.current ?? (async () => true),
    permitSelection: async () => { selections++; return options.permit ? await options.permit() : true; },
    signal: options.signal, timeoutMs: options.timeoutMs,
    admin: { from: () => { throw Error("Save must never query or borrow an approval"); } },
    invokeAs: async (name, body) => {
      calls.push({ name, body });
      return { error: null, data: options.response ? await options.response(body) : {
        ok: true, outcome: "draft_saved", operation_id: body.operation_id,
        receipt_id: receipt, draft_source: source,
      } };
    },
  });
  return { save, calls, selections: () => selections };
}

test("save delegates to the original email door and retains the exact source/receipt", async () => {
  const h = setup();
  const result = await h.save(input());
  assert.equal(result.status, "saved");
  assert.deepEqual(result.draft_source, source);
  assert.equal(result.receipt_id, receipt);
  assert.equal(result.delivery_confirmed, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, "comms-email-command");
  assert.equal(h.calls[0].body.save_draft, true);
  assert.equal(h.calls[0].body.expected_tenant_id, tenant);
  assert.deepEqual(h.calls[0].body.draft_source, source);
  assert.equal(h.calls[0].body.approved_fingerprint, undefined);
  assert.equal(h.calls[0].body.send_at, undefined);
});

test("one accepted turn cannot save a second draft or retry an unknown save", async () => {
  for (const response of [undefined, () => null]) {
    const h = setup({ response });
    const first = h.save(input());
    const same = h.save(input());
    assert.deepEqual(await first, await same);
    assert.equal(h.calls.length, 1);
    assert.equal((await h.save({ ...input(), body: "Different content" })).status, "refused");
    assert.equal(h.calls.length, 1);
  }
});

test("send, schedule, files, identity and approval controls never reach the original adapter", async () => {
  for (const extra of [{ save_draft: false }, { save_draft: undefined }, { send_at: "2027-01-01T10:00:00Z" },
    { connector_id: draft }, { attachments: [] }, { approved_fingerprint: "a".repeat(64) },
    { expected_tenant_id: draft }, { operation_id: draft }, { confirm: true }, { approval_id: receipt }]) {
    const h = setup();
    assert.equal((await h.save({ ...input(), ...extra })).status, "refused");
    assert.equal(h.calls.length, 0);
    assert.equal(h.selections(), 0);
  }
});

test("only the current NEXUS private DM and independently read original contact/source are eligible", async () => {
  for (const over of [{ agent: "paige" }, { where: "channel" }, { storedTools: [] }, { contactIds: [] },
    { tenantId: "invalid" }, { draftSource: { ...source, updated_at: "2026-11-02T18:32:10.123Z" } }]) {
    const h = setup({ over });
    assert.equal((await h.save(input())).status, "refused");
    assert.equal(h.calls.length, 0);
  }
});

test("revocation or missing exact-content handoff prevents dispatch", async () => {
  let reads = 0;
  const h = setup({ current: async () => ++reads < 2 });
  assert.equal((await h.save(input())).status, "refused");
  assert.equal(h.calls.length, 0);
  const noHandoff = setup({ permit: async () => false });
  assert.equal((await noHandoff.save(input())).status, "refused");
  assert.equal(noHandoff.calls.length, 0);
});

test("malformed/mismatched native save results are unknown, never saved or sent", async () => {
  for (const change of [{ receipt_id: null }, { operation_id: message }, { draft_source: { ...source, message_id: receipt } },
    { outcome: "provider_accepted" }, { ok: false }, { delivery_confirmed: true }]) {
    const h = setup({ response: body => ({ ok: true, outcome: "draft_saved", operation_id: body.operation_id,
      receipt_id: receipt, draft_source: source, ...change }) });
    assert.equal((await h.save(input())).status, "unknown");
    assert.equal(h.calls.length, 1);
  }
});

test("released original producer creates a fresh unsent draft without a forged source", async () => {
  const h = setup({ over: { draftSource: undefined } });
  const { draft_source: _source, ...fresh } = input();
  assert.equal((await h.save(fresh)).status, "saved");
  assert.equal(h.calls.length, 1);
  assert.equal(Object.hasOwn(h.calls[0].body, "draft_source"), false);
  assert.equal(h.calls[0].body.save_draft, true);
});

test("original operation identity survives a reconstructed Hub request without a second identity", async () => {
  const a = setup(), b = setup();
  await a.save(input()); await b.save(input());
  assert.equal(a.calls[0].body.operation_id, b.calls[0].body.operation_id);
  const other = setup({ over: { sourceMessageId: receipt } });
  await other.save(input());
  assert.notEqual(a.calls[0].body.operation_id, other.calls[0].body.operation_id);
  assert.equal(await nexusEmailDraftOperationId(scope(), input() as Parameters<typeof nexusEmailDraftOperationId>[1]), a.calls[0].body.operation_id);
});

test("explicit server-bound sender choice delegates to the same original adapter and operation", async () => {
  const h = setup({ over: { connectorId: conversation } });
  const selected = { ...input(), connector_id: conversation, save_draft: true as const };
  assert.equal((await h.save({ ...selected, connector_id: receipt })).status, "refused");
  assert.equal((await h.save(selected)).status, "saved");
  assert.equal((h.calls[0].body.command as Record<string, unknown>).connector_id, conversation);
  assert.equal(await nexusEmailDraftOperationId(scope({ connectorId: conversation }), selected), h.calls[0].body.operation_id);
});

test("revocation after dispatch suppresses the result and does not repeat the write", async () => {
  let live = true;
  const h = setup({ current: async () => live, response: body => {
    live = false;
    return { ok: true, outcome: "draft_saved", operation_id: body.operation_id, receipt_id: receipt, draft_source: source };
  } });
  assert.deepEqual(await h.save(input()), { status: "unknown", delivery_confirmed: false });
  await h.save(input());
  assert.equal(h.calls.length, 1);
});

test("deadline before dispatch retires a pending check; a late success cannot start a write", async () => {
  let resume!: (value: boolean) => void;
  const gate = new Promise<boolean>(resolve => { resume = resolve; });
  const h = setup({ current: () => gate, timeoutMs: 10 });
  assert.equal((await h.save(input())).status, "refused");
  resume(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.calls.length, 0);
});

test("deadline/Stop after dispatch stays unknown even when the late native result is saved", async () => {
  for (const abort of [false, true]) {
    const controller = new AbortController();
    let resume!: (value: unknown) => void;
    let request: Record<string, unknown> | undefined;
    const h = setup({ signal: controller.signal, timeoutMs: 20, response: body => {
      request = body;
      if (abort) controller.abort();
      return new Promise(resolve => { resume = resolve; });
    } });
    const saving = h.save(input());
    assert.deepEqual(await saving, { status: "unknown", delivery_confirmed: false });
    resume({ ok: true, outcome: "draft_saved", operation_id: request!.operation_id, receipt_id: receipt, draft_source: source });
    assert.deepEqual(await h.save(input()), { status: "unknown", delivery_confirmed: false });
    assert.equal(h.calls.length, 1);
  }
});
