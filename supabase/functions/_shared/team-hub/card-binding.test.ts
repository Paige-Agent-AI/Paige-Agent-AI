// node --test supabase/functions/_shared/team-hub/card-binding.test.ts
// Adapter proof only. Native roles, tenant isolation and ACLs have an owning PostgreSQL suite.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withoutTeamHubCardTokens } from "./card-binding.ts";
const SAM = "22222222-2222-4222-8222-222222222222";
const CARD_FP = "aaaaaaaaaaaaaaaa", CHAT_FP = "bbbbbbbbbbbbbbbb";
const SCOPED = "cccccccccccccccc:dddddddd-dddd-4ddd-8ddd-dddddddddddd";
type Reply = { data: unknown; error: unknown };
function projection(reply: Reply | (() => Reply) = { data: { ok: true, bound: [CARD_FP] }, error: null }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const caller = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return typeof reply === "function" ? reply() : reply;
    },
    from: () => { throw new Error("permission denied for team_hub_message_cards"); },
  };
  return { caller, calls };
}
describe("withoutTeamHubCardTokens", () => {
  it("uses the caller's protected projection when direct private-table reads are denied", async () => {
    const s = projection();
    assert.deepEqual(await withoutTeamHubCardTokens(s.caller, SAM, [SCOPED, CARD_FP, CHAT_FP]),
      { kept: [SCOPED, CHAT_FP], bound: [CARD_FP], failed: false });
    assert.deepEqual(s.calls, [{ name: "team_hub_card_binding", args: {
      p_expected_user_id: SAM, p_fingerprints: [CARD_FP, CHAT_FP],
    } }]);
  });
  it("scoped-only and empty requests read nothing", async () => {
    for (const tokens of [[SCOPED], []]) {
      const s = projection();
      assert.deepEqual(await withoutTeamHubCardTokens(s.caller, SAM, tokens), { kept: tokens, bound: [], failed: false });
      assert.equal(s.calls.length, 0);
    }
  });
  it("unknown/unbound proposals behave as before", async () => {
    const s = projection({ data: { ok: true, bound: [] }, error: null });
    assert.deepEqual(await withoutTeamHubCardTokens(s.caller, SAM, [CHAT_FP]), { kept: [CHAT_FP], bound: [], failed: false });
  });
  it("consumed cards remain bound; no live-only filtering is requested", async () => {
    const s = projection();
    assert.deepEqual(await withoutTeamHubCardTokens(s.caller, SAM, [CARD_FP]), { kept: [], bound: [CARD_FP], failed: false });
    assert.deepEqual(Object.keys(s.calls[0].args).sort(), ["p_expected_user_id", "p_fingerprints"]);
  });
  it("deduplicates the lookup while preserving kept input order and multiplicity", async () => {
    const s = projection();
    assert.deepEqual(await withoutTeamHubCardTokens(s.caller, SAM, [CHAT_FP, CARD_FP, CHAT_FP, SCOPED, CARD_FP]),
      { kept: [CHAT_FP, CHAT_FP, SCOPED], bound: [CARD_FP], failed: false });
    assert.deepEqual(s.calls[0].args.p_fingerprints, [CHAT_FP, CARD_FP]);
  });
  it("unavailable, refused and malformed projections fail closed for every bare token", async () => {
    const broken: Reply[] = [
      { data: null, error: { message: "down" } }, { data: null, error: null },
      ...[[], true, {}, { ok: false, code: "scope_changed" }, { ok: "true", bound: [] },
        { ok: true }, { ok: true, bound: null }, { ok: true, bound: "no" },
        { ok: true, bound: [123] }, { ok: true, bound: ["ffffffffffffffff"] },
        { ok: true, bound: [SCOPED] }, { ok: true, bound: [CARD_FP, CARD_FP] }]
        .map(data => ({ data, error: null })),
    ];
    for (const reply of broken) {
      const s = projection(reply);
      assert.deepEqual(await withoutTeamHubCardTokens(s.caller, SAM, [CHAT_FP, SCOPED, CARD_FP]),
        { kept: [SCOPED], bound: [], failed: true });
    }
  });
  it("RPC throws fail closed without a private-table fallback", async () => {
    const s = projection(() => { throw new Error("socket hang up"); });
    assert.deepEqual(await withoutTeamHubCardTokens(s.caller, SAM, [CHAT_FP, SCOPED, CARD_FP]),
      { kept: [SCOPED], bound: [], failed: true });
    assert.equal(s.calls.length, 1);
  });
  it("invalid actors and oversized payloads are refused before any partial lookup", async () => {
    const oversized = Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(16, "0"));
    for (const [actor, tokens] of [["not-an-id", [CHAT_FP, SCOPED]], [SAM, [...oversized, SCOPED]]] as const) {
      const s = projection();
      assert.deepEqual(await withoutTeamHubCardTokens(s.caller, actor, tokens), { kept: [SCOPED], bound: [], failed: true });
      assert.equal(s.calls.length, 0);
    }
  });
});
