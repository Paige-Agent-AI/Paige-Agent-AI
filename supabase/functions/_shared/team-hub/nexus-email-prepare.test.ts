import { test } from "node:test";
import assert from "node:assert/strict";
import { createNexusEmailPreparation, nexusEmailPreparationFromAnswer, NEXUS_EMAIL_PREPARATION_PROMPT } from "./nexus-email-prepare.ts";
const turn = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64);
const prepared = { subject: "Project update", body: "Ready for review." };
const scope = () => ({ agent: "nexus", where: "agent_dm", turnId: turn, tokenHash: hash, storedTools: ["comms_send_email"] });

test("the model's extra field is preparation only, not an execution result", () => {
  assert.deepEqual(nexusEmailPreparationFromAnswer(JSON.stringify({ reply: "Review this draft.", email_draft: prepared })), prepared);
  assert.equal(nexusEmailPreparationFromAnswer(JSON.stringify({ reply: "Ordinary answer" })), null);
  assert.equal(nexusEmailPreparationFromAnswer(JSON.stringify({ email_draft: { ...prepared, status: "saved" } })), "invalid");
  assert.equal(nexusEmailPreparationFromAnswer(JSON.stringify({ email_draft: { ...prepared, receipt_id: turn } })), "invalid");
  assert.equal(nexusEmailPreparationFromAnswer("ordinary text"), null);
  assert.match(NEXUS_EMAIL_PREPARATION_PROMPT, /have NOT saved/);
  assert.match(NEXUS_EMAIL_PREPARATION_PROMPT, /original email writer and receipt/);
});
test("only a stored-allowed NEXUS private turn even asks native permission", async () => {
  for (const change of [{ agent: "paige" }, { where: "channel" }, { storedTools: [] }, { tokenHash: "bad" }]) {
    let calls = 0;
    const p = createNexusEmailPreparation({ ...scope(), ...change }, { service: { rpc: async () => { calls++; return { data: { ok: true }, error: null }; } } });
    assert.equal(await p.current(), false); assert.equal(await p.stage(prepared), false); assert.equal(calls, 0);
  }
});
test("offer and stage reuse native actor/turn checks and never invoke an email writer", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const p = createNexusEmailPreparation(scope(), { service: { rpc: async (name, args) => {
    calls.push({ name, args }); return { data: { ok: true }, error: null };
  } } });
  assert.equal(await p.current(), true); assert.equal(await p.stage(prepared), true);
  assert.deepEqual(calls.map(c => c.name), ["team_hub_email_draft_scope", "team_hub_email_draft_scope", "team_hub_stage_email_draft"]);
  assert.deepEqual(calls.at(-1)?.args, { p_turn_id: turn, p_token_hash: hash, p_subject: prepared.subject, p_body: prepared.body });
});
test("native refusal/transport error retires the offer, even if a later result would succeed", async () => {
  for (const data of [null, { ok: false }, { ok: "true" }]) {
    let calls = 0;
    const p = createNexusEmailPreparation(scope(), { service: { rpc: async () => {
      calls++; return { data: calls > 1 ? { ok: true } : data, error: null };
    } } });
    assert.equal(await p.current(), false); assert.equal(await p.current(), false); assert.equal(await p.stage(prepared), false);
    assert.equal(calls, 1);
  }
});
test("a late scope result cannot resume staging after the original deadline", async () => {
  let finish!: (value: { data: unknown; error: unknown }) => void;
  const calls: string[] = [];
  const p = createNexusEmailPreparation(scope(), { timeoutMs: 5, service: { rpc: async name => {
    calls.push(name); return await new Promise(resolve => { finish = resolve; });
  } } });
  assert.equal(await p.current(), false);
  finish({ data: { ok: true }, error: null });
  assert.equal(await p.stage(prepared), false);
  assert.deepEqual(calls, ["team_hub_email_draft_scope"]);
});
test("Stop and malformed preparation cannot reach native staging", async () => {
  const controller = new AbortController(), calls: string[] = [];
  const p = createNexusEmailPreparation(scope(), { signal: controller.signal, service: { rpc: async name => {
    calls.push(name); controller.abort(); return { data: { ok: true }, error: null };
  } } });
  assert.equal(await p.stage(prepared), false);
  assert.deepEqual(calls, ["team_hub_email_draft_scope"]);
  const malformed = createNexusEmailPreparation(scope(), { service: { rpc: async () => { throw Error("must not read"); } } });
  assert.equal(await malformed.stage({ subject: "Bad\nsubject", body: "Body" }), false);
});
