import { test } from "node:test";
import assert from "node:assert/strict";
import { createTeamHubStudioPreparation, parseTeamHubStudioPreparation, teamHubStudioPreparationFromAnswer, TEAM_HUB_STUDIO_PREPARATION_PROMPT } from "./studio-prepare.ts";

const turn = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64);
const candidate = { brief: "Build a landing page for the service described in this request." };
const scope = () => ({ agent: "nexus", where: "agent_dm", turnId: turn, tokenHash: hash, privateFollowUp: false });

test("Studio preparation is strict bounded text, never a project or authority reference", () => {
  assert.deepEqual(parseTeamHubStudioPreparation(candidate), candidate);
  for (const extra of ["session_id", "thread_id", "tenant_id", "user_id", "source_id", "url", "status", "approved", "receipt"]) {
    assert.equal(parseTeamHubStudioPreparation({ ...candidate, [extra]: turn }), null);
  }
  for (const value of [null, [], {}, { brief: "" }, { brief: "   " }, { brief: 1 }, { brief: "x".repeat(10001) }]) assert.equal(parseTeamHubStudioPreparation(value), null);
  assert.equal(teamHubStudioPreparationFromAnswer("ordinary text"), null);
  assert.equal(teamHubStudioPreparationFromAnswer('{"reply":"Ordinary answer"}'), null);
  assert.equal(teamHubStudioPreparationFromAnswer(JSON.stringify({ studio_brief: { ...candidate, session_id: turn } })), "invalid");
  assert.deepEqual(teamHubStudioPreparationFromAnswer(JSON.stringify({ reply: "Review this brief.", studio_brief: candidate })), candidate);
  assert.match(TEAM_HUB_STUDIO_PREPARATION_PROMPT, /have NOT created/);
  assert.match(TEAM_HUB_STUDIO_PREPARATION_PROMPT, /chooses the project target/);
});
test("only original NEXUS or PAIGE own private turns ask the native scope door", async () => {
  for (const agent of ["nexus", "paige"]) {
    const calls: string[] = [];
    const preparation = createTeamHubStudioPreparation({ ...scope(), agent }, { service: { rpc: async name => { calls.push(name); return { data: { ok: true }, error: null }; } } });
    assert.equal(await preparation.current(), true);
    assert.deepEqual(calls, ["team_hub_studio_scope"]);
  }
  for (const change of [{ agent: "mentor" }, { where: "channel" }, { where: "dm" }, { privateFollowUp: true }, { turnId: "model-id" }, { tokenHash: "bad" }]) {
    let calls = 0;
    const preparation = createTeamHubStudioPreparation({ ...scope(), ...change }, { service: { rpc: async () => { calls++; return { data: { ok: true }, error: null }; } } });
    assert.equal(await preparation.current(), false);
    assert.equal(await preparation.stage(candidate), false);
    assert.equal(calls, 0);
  }
});
test("scope and staging retain the same original turn/hash, never calling a Studio writer", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const preparation = createTeamHubStudioPreparation(scope(), { service: { rpc: async (name, args) => { calls.push({ name, args }); return { data: { ok: true }, error: null }; } } });
  assert.equal(await preparation.current(), true);
  assert.equal(await preparation.stage(candidate), true);
  assert.deepEqual(calls.map(call => call.name), ["team_hub_studio_scope", "team_hub_studio_scope", "team_hub_stage_studio_brief"]);
  assert.deepEqual(calls.at(-1)?.args, { p_turn_id: turn, p_token_hash: hash, p_brief: candidate.brief });
});
test("native refusal, malformed response and transport failure withdraw the offer permanently", async () => {
  for (const response of [{ data: null, error: null }, { data: { ok: false }, error: null }, { data: { ok: "true" }, error: null }, { data: { ok: true }, error: {} }]) {
    let calls = 0;
    const preparation = createTeamHubStudioPreparation(scope(), { service: { rpc: async () => { calls++; return calls === 1 ? response : { data: { ok: true }, error: null }; } } });
    assert.equal(await preparation.current(), false);
    assert.equal(await preparation.current(), false);
    assert.equal(await preparation.stage(candidate), false);
    assert.equal(calls, 1);
  }
});
test("revocation between offer and stage prevents staging", async () => {
  const calls: string[] = [];
  const preparation = createTeamHubStudioPreparation(scope(), { service: { rpc: async name => { calls.push(name); return { data: { ok: calls.length === 1 }, error: null }; } } });
  assert.equal(await preparation.current(), true);
  assert.equal(await preparation.stage(candidate), false);
  assert.deepEqual(calls, ["team_hub_studio_scope", "team_hub_studio_scope"]);
});
test("stage failure is sticky and malformed preparation never asks a native reader", async () => {
  const calls: string[] = [];
  const preparation = createTeamHubStudioPreparation(scope(), { service: { rpc: async name => { calls.push(name); return { data: { ok: name !== "team_hub_stage_studio_brief" }, error: null }; } } });
  assert.equal(await preparation.stage(candidate), false);
  assert.equal(await preparation.current(), false);
  assert.deepEqual(calls, ["team_hub_studio_scope", "team_hub_stage_studio_brief"]);
  const invalid = createTeamHubStudioPreparation(scope(), { service: { rpc: async () => { throw Error("must not read"); } } });
  assert.equal(await invalid.stage({ ...candidate, session_id: turn } as typeof candidate), false);
});
test("a late native response cannot revive a deadline or aborted invocation", async () => {
  let finish!: (result: { data: unknown; error: unknown }) => void;
  const calls: string[] = [];
  const preparation = createTeamHubStudioPreparation(scope(), { timeoutMs: 5, service: { rpc: async name => { calls.push(name); return new Promise(resolve => { finish = resolve; }); } } });
  assert.equal(await preparation.current(), false);
  finish({ data: { ok: true }, error: null });
  assert.equal(await preparation.stage(candidate), false);
  assert.deepEqual(calls, ["team_hub_studio_scope"]);
  const stop = new AbortController();
  const stopped = createTeamHubStudioPreparation(scope(), { signal: stop.signal, service: { rpc: async () => { stop.abort(); return { data: { ok: true }, error: null }; } } });
  assert.equal(await stopped.stage(candidate), false);
});
