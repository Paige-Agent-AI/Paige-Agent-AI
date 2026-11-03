import { test } from "node:test";
import assert from "node:assert/strict";
import { runNexusEmailDraft, type NexusEmailDraftHostDeps } from "./nexus-email-act.ts";
const ids = Array.from({ length: 9 }, (_, n) => `${String(n + 1).repeat(8)}-1111-4111-8111-111111111111`);
const [tenant, actor, turn, conversation, source, message, contact, connector, savedMessage] = ids;
const raw = () => ({ ok: true, tenant_id: tenant, actor_id: actor, turn_id: turn, conversation_id: conversation,
  source_message_id: source, message_id: message,
  draft: { subject: "Project update", body: "Ready for review.", contact_id: contact, connector_id: connector } });
const request = (intent = "save") => ({ teamHubEmailDraft: { messageId: message, intent,
  ...(intent === "save" ? { contactId: contact, connectorId: connector } : {}) } });
function setup(options: { prior?: boolean; loseAnswer?: boolean; loseNativeReceipt?: boolean; reconcileUnavailable?: boolean;
  wrongActor?: boolean; wrongTenant?: boolean; revoked?: () => boolean; controlHint?: string; senders?: unknown[];
  unbound?: boolean; missingContact?: boolean } = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  let saved = options.prior === true, operation: string | undefined, bound = !options.unbound;
  const reference = (op: unknown) => ({ message_id: savedMessage, updated_at: "2026-11-03T02:30:00.123456+00:00", receipt_id: turn, operation_id: op });
  const caller = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (options.revoked?.()) return { data: { ok: false }, error: null };
    if (name === "get_paige_persona_context") return { data: { tenant_id: options.wrongTenant ? actor : tenant }, error: null };
    if (name === "team_hub_email_draft") {
      const value = raw();
      if(args.p_contact_id)bound=true;
      if (!bound) value.draft = { subject: value.draft.subject, body: value.draft.body } as typeof value.draft;
      return { data: { ...value, ...(options.wrongActor ? { actor_id: tenant } : {}) }, error: null };
    }
    throw Error("unexpected caller read");
  } };
  const service = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      assert.equal(name, "team_hub_record_email_draft");
      if (options.reconcileUnavailable) return { data: null, error: { code: "unavailable" } };
      if (saved && !options.loseNativeReceipt) return { data: { ok: true, status: "saved", result: reference(args.p_operation_id) }, error: null };
      return { data: { ok: true, status: "unknown" }, error: null };
    },
    from: (name: string) => {
      if (name === "clients") {
        const q: Record<string, unknown> = {};
        q.select = () => q; q.eq = () => q;
        q.maybeSingle = async () => ({ data: options.missingContact ? null : { id: contact, tenant_id: tenant,
          client_contact_methods:[{kind:"email",value:"recipient@tests.invalid",is_primary:true}] }, error: null });
        return q;
      }
      assert.equal(name, "channel_connectors", "Save must never query an approval");
      const query: Record<string, unknown> = {};
      query.select = () => query; query.eq = () => query;
      query.maybeSingle=async()=>({data:{id:connector,tenant_id:tenant,from_address:"business@tests.invalid",status:"active",active:true,mailbox_class:"shared_support"},error:null});
      query.then = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: options.senders ?? [], error: null }).then(resolve);
      return query;
    },
  };
  const deps = { caller, service, userId: actor, controlHint: options.controlHint,
    invokeAs: async (name: string, body: Record<string, unknown>) => {
      calls.push({ name, args: body });
      assert.equal(name, "comms-email-command"); assert.equal(body.save_draft, true);
      operation = body.operation_id as string; saved = true;
      if (options.loseAnswer) return { data: null, error: { code: "transport_lost" } };
      return { data: { ok: true, outcome: "draft_saved", operation_id: operation,
        draft_source: { message_id: savedMessage, updated_at: "2026-11-03T02:30:00.123456+00:00" }, receipt_id: turn }, error: null };
    },
  } as unknown as NexusEmailDraftHostDeps;
  return { deps, calls, operation: () => operation };
}
const writes = (h: ReturnType<typeof setup>) => h.calls.filter(c => c.name === "comms-email-command");

test("Save binds exact native content/recipient/sender and reports only original native receipt", async () => {
  const h = setup();
  const result = await runNexusEmailDraft(h.deps, request());
  assert.equal(result.outcome, "saved"); assert.equal(result.result?.message_id, savedMessage);
  assert.equal(result.result?.operation_id, h.operation()); assert.equal(writes(h).length, 1);
  assert.deepEqual(writes(h)[0].args?.command, { action: "comms.email_send", contact_id: contact,
    connector_id: connector, subject: "Project update", body: "Ready for review." });
  assert.equal(writes(h)[0].args?.approved_fingerprint, undefined);
});
test("Check reconciles original receipt and never calls the writer", async () => {
  for (const prior of [false, true]) {
    const h = setup({ prior });
    assert.equal((await runNexusEmailDraft(h.deps, request("check"))).outcome, prior ? "saved" : "unknown");
    assert.equal(writes(h).length, 0);
  }
});
test("the first unbound human Save resolves original parties, binds once, then saves the same exact content", async () => {
  const h=setup({unbound:true});
  assert.equal((await runNexusEmailDraft(h.deps,request())).outcome,"saved");
  assert.equal(h.calls.filter(c=>c.name==="team_hub_email_draft"&&c.args?.p_contact_id).length,1);
  assert.equal(writes(h).length,1);
});
test("reconstructed Save with an original result does not repeat the domain write", async () => {
  const h = setup({ prior: true });
  assert.equal((await runNexusEmailDraft(h.deps, request())).outcome, "saved");
  assert.equal(writes(h).length, 0);
});
test("lost gateway result can be resolved only by the ORIGINAL native receipt", async () => {
  const h = setup({ loseAnswer: true });
  assert.equal((await runNexusEmailDraft(h.deps, request())).outcome, "saved");
  assert.equal(writes(h).length, 1);
  const missing = setup({ loseAnswer: true, loseNativeReceipt: true });
  assert.equal((await runNexusEmailDraft(missing.deps, request())).outcome, "unknown");
  assert.equal(writes(missing).length, 1);
});
test("failed original reconciliation cannot become a fresh Save", async () => {
  const h = setup({ reconcileUnavailable: true });
  assert.equal((await runNexusEmailDraft(h.deps, request())).outcome, "unavailable");
  assert.equal(writes(h).length, 0);
});
test("an unavailable original contact is refused before binding a recipient or invoking Save", async () => {
  const h = setup({ unbound: true, missingContact: true });
  assert.equal((await runNexusEmailDraft(h.deps, request())).outcome, "refused");
  assert.ok(!h.calls.some(c => c.name === "team_hub_email_draft" && c.args?.p_contact_id));
  assert.equal(writes(h).length, 0);
});
test("wrong actor/workspace or a quota control hint is refused before any effect", async () => {
  for (const option of [{ wrongActor: true }, { wrongTenant: true }, { controlHint: "status" }]) {
    const h = setup(option);
    assert.equal((await runNexusEmailDraft(h.deps, request())).outcome, "refused");
    assert.equal(writes(h).length, 0);
  }
});
test("model replacement text and approval/send controls cannot enter this browser route", async () => {
  for (const extra of [{ body: "Different" }, { subject: "Different" }, { approved_fingerprint: "a".repeat(16) }, { intent: "send" }]) {
    const h = setup();
    assert.equal((await runNexusEmailDraft(h.deps, { teamHubEmailDraft: { ...request().teamHubEmailDraft, ...extra } })).outcome, "refused");
    assert.equal(h.calls.length, 0);
  }
});
test("original permitted sender choices stay out of the model and do not invoke a provider", async () => {
  const h = setup({ senders: [
    { id: connector, tenant_id: tenant, provider: "gmail", active: true, status: "active", mailbox_class: "shared_support", from_address: "business@tests.invalid" },
    { id: contact, tenant_id: tenant, provider: "gmail", active: true, status: "active", mailbox_class: "personal", mailbox_owner_user_id: turn, from_address: "private@tests.invalid" },
  ] });
  const result = await runNexusEmailDraft(h.deps, request("inspect"));
  assert.equal(result.outcome, "available");
  assert.deepEqual(result.senders, [{ connector_id: connector, from_address: "business@tests.invalid" }]);
  assert.equal(writes(h).length, 0);
});
