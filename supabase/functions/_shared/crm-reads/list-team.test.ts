// node --test supabase/functions/_shared/crm-reads/list-team.test.ts   (also: deno test)
// EXP08 A2b (plan S2) — EXTRACTION PARITY for `crm_list_team`.
//
// `chatBranchBefore` is the paige-ai-chat `crm_list_team` branch exactly as it stood at 6d8e5c56a
// (index.ts lines 16960-16964, the body of the branch at 16959), transcribed verbatim with its free variables (supabaseClient,
// personaCtx) made parameters; `chatBranchAfter` is the new call site, verbatim. Both run against the
// SAME recording fake: same rpc request, byte-identical result, or the identical thrown error.
//
// EVIDENCE CLASS: automated unit test of the moved code against an in-memory fake. The definer
// `list_team_members` itself is not exercised here; nothing about it changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listCrmTeam } from "./list-team.ts";
// node:test's describe/it are not in Deno 2.1's node compat; this keeps one file runnable by both
// `node --test` and `deno test` (flat tests named "suite > case").
let suite = "";
const describe = (name: string, body: () => void) => { const prev = suite; suite = name; body(); suite = prev; };
const it = (name: string, fn: () => unknown) => { test(`${suite} > ${name}`, async () => { await fn(); }); };

// deno-lint-ignore no-explicit-any
async function chatBranchBefore(supabaseClient: any, personaCtx: any) {
  // deno-lint-ignore no-explicit-any
  let result: any = { success: false };
              const { data, error } = await supabaseClient.rpc("list_team_members", {
                p_tenant_id: personaCtx?.tenant_id ?? null,
              });
              if (error) throw error;
              // deno-lint-ignore no-explicit-any
              result = { success: true, count: (data as any[])?.length ?? 0, members: data ?? [] };
  return result;
}

// deno-lint-ignore no-explicit-any
async function chatBranchAfter(supabaseClient: any, personaCtx: any) {
  // deno-lint-ignore no-explicit-any
  let result: any = { success: false };
              result = await listCrmTeam(supabaseClient, personaCtx?.tenant_id ?? null);
  return result;
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const MEMBERS = [
  { user_id: "u-sam", name: "Sam Rivera", role: "owner", status: "active" },
  { user_id: "u-priya", name: "Priya Shah", role: "member", status: "active" },
];

function fakeCaller(wire: unknown[], answer: { data: unknown; error: unknown }) {
  return { rpc(name: string, args?: Record<string, unknown>) { wire.push({ rpc: name, args: structuredClone(args) }); return Promise.resolve(answer); } };
}

// deno-lint-ignore no-explicit-any
async function both(personaCtx: any, answer: { data: unknown; error: unknown }) {
  const run = async (fn: typeof chatBranchBefore) => {
    const wire: unknown[] = [];
    try { return { wire, result: JSON.stringify(await fn(fakeCaller(wire, answer), personaCtx)) }; }
    catch (e) { return { wire, threw: e }; }
  };
  return { before: await run(chatBranchBefore), after: await run(chatBranchAfter) };
}

describe("crm_list_team moved to _shared/crm-reads/list-team.ts — byte-identical", () => {
  const cases: Array<[string, unknown, { data: unknown; error: unknown }]> = [
    ["a workspace with two members", { tenant_id: TENANT }, { data: MEMBERS, error: null }],
    ["no workspace resolved → p_tenant_id null", { tenant_id: null }, { data: MEMBERS, error: null }],
    ["persona context missing entirely", undefined, { data: [], error: null }],
    ["the definer answers null", { tenant_id: TENANT }, { data: null, error: null }],
  ];
  for (const [label, persona, answer] of cases) {
    it(label, async () => {
      const { before, after } = await both(persona, answer);
      assert.deepEqual(after.wire, before.wire, "the same rpc and arguments");
      assert.equal(after.result, before.result, "the same result, byte for byte");
      assert.ok(before.result);
    });
  }
  it("an rpc error is thrown as the same object", async () => {
    const err = { code: "P0001", message: "not a member" };
    const { before, after } = await both({ tenant_id: TENANT }, { data: null, error: err });
    assert.deepEqual(after.wire, before.wire);
    assert.equal(before.threw, err);
    assert.equal(after.threw, err);
  });
});
