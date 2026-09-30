#!/usr/bin/env node
/**
 * Door 1 — the gateway `tools` action, driven rather than described.
 *
 * Runs the REAL `_shared/mcp-gateway/tools.ts` (which pulls in the REAL `effect-policy.ts`),
 * loaded straight from source by Node's own type stripping, against a stubbed Supabase client. Nothing in the handler is mocked; only the transport under
 * it is, because what is under test is the decision layer, not Postgres — the SQL half is proven
 * separately against real Postgres in `supabase/tests/mcp_tool_catalog_tenant_scope.sql`.
 *
 * What this pins, and why each one has a specific way of going wrong:
 *
 *   1. THE APPROVAL POLICY IS NOT RE-DERIVED. `resolveEffectApproval` decides, and its SERVER
 *      FLOOR beats a provider's own claim: a `send_*` tool labelled `["read"]` by the provider
 *      still requires approval. A surface that trusted the provider's label — or a SQL port of
 *      this rule that drifted from it — would let a mutation run unapproved.
 *
 *   2. A DECLARED READ IS HONESTLY MARKED AS NEEDING NOTHING. The runner genuinely skips the
 *      consent check for it. Showing "needs your approval" against such a tool is a false
 *      statement, and the copy this list replaces made exactly that mistake in the other
 *      direction ("nothing runs without your approval").
 *
 *   3. THE EXISTENCE ORACLE STAYS CLOSED. The RPC raises ONE refusal for unknown / foreign-tenant
 *      / owner_only-without-standing. If this handler distinguished them, it would hand back the
 *      oracle the RPC pays to suppress.
 *
 *   4. `approved_count` COUNTS CONSENT, NOT ROWS. An expired or pin-drifted approval is a row
 *      that no longer authorises anything. Counting it would tell an owner they are covered when
 *      they are not.
 *
 *   5. PROVIDER-CONTROLLED LABELS ARE BOUNDED, AND A NON-IDENTIFIER TOOL NAME IS DROPPED rather
 *      than cleaned into something that looks legitimate.
 *
 * Run: node scripts/proof/mcp-gateway-tools-action.mjs
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

// NODE BUILT-INS ONLY, and that is a constraint rather than a preference. This runs in the
// `database-contract` job, which checks out, installs the Supabase CLI and runs SQL — it does
// NOT run `npm ci`, so there is no node_modules on that runner. The first version of this file
// imported `esbuild` to bundle the handler and died with ERR_MODULE_NOT_FOUND the moment CI ran
// it, having passed locally where the dependency happened to exist. Its two sibling proofs in the
// same job (`paige-voice-budget-concurrency.mjs`, `mcp-gateway-endpoint-consent-race.mjs`) use
// `node:` built-ins only; this one now matches them.
//
// Node strips TypeScript types natively (22.18+, no flag), and it resolves the `.ts` import
// specifiers this Deno-targeted module uses, so the REAL handler and the REAL effect policy load
// directly from source with nothing compiled, copied or stubbed in between.
const toolsMod = await import(
  pathToFileURL(path.resolve("supabase/functions/_shared/mcp-gateway/tools.ts")).href
);

/** A real uuid, because the handler now refuses anything else before it reads. */
const FIXTURE_ID = "11111111-2222-4333-8444-555555555555";

let passed = 0;
const failures = [];
const check = (label, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  ok  ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
};

/** A caller client whose rpc() answers exactly what the real one would. */
const clientReturning = (rows, { tenant = "tenant-a", rpcError = null } = {}) => ({
  rpc: (fn) => {
    if (fn === "current_user_tenant_id") return Promise.resolve({ data: tenant, error: null });
    if (fn === "get_mcp_connection_tools") {
      return rpcError
        ? Promise.resolve({ data: null, error: { message: rpcError } })
        : Promise.resolve({ data: rows, error: null });
    }
    // An RPC this double does not serve is a bug in the caller or a gap here. A silent
    // null-shaped success would let a renamed RPC look like a working one.
    throw new Error(`unstubbed rpc: ${fn}`);
  },
});

const row = (over = {}) => ({
  tool_name: "list_contacts",
  app: "Gmail",
  action_type: "contact.list",
  effects: ["read"],
  observed_at: "2026-09-20T10:00:00Z",
  approved: false,
  approved_at: null,
  expires_at: null,
  approval_expired: false,
  approval_stale: false,
  approved_by_you: false,
  approval_blocked_reason: null,
  ...over,
});

const call = (rows, opts) =>
  toolsMod.runTools({ userClient: clientReturning(rows, opts) }, { connectionId: FIXTURE_ID, expectedTenantId: null });

console.log("\nDoor 1 — gateway `tools` action\n");

// ── 1. the server floor beats the provider's own claim ──────────────────────
{
  const r = await call([
    // A provider insisting its destructive action is a read. The NAME floor must win.
    row({ tool_name: "send_email", effects: ["read"], action_type: "email.send" }),
    row({ tool_name: "delete_record", effects: ["read"] }),
    row({ tool_name: "list_contacts", effects: ["read"] }),
  ]);
  const by = Object.fromEntries(r.body.tools.map((t) => [t.name, t]));
  check("a send_* tool the provider labels read STILL requires approval",
    by.send_email?.requiresApproval === true && by.send_email?.approvalBasis === "server_name_floor",
    JSON.stringify(by.send_email));
  check("a delete_* tool the provider labels read STILL requires approval",
    by.delete_record?.requiresApproval === true);
  check("a genuine declared read requires NOTHING, and says so",
    by.list_contacts?.requiresApproval === false && by.list_contacts?.approvalBasis === null);
}

// ── 2. a provider may RAISE a non-verb tool; undeclared effects fail closed ──
{
  const r = await call([
    // NOT a mutation verb — `sync` is one (MUTATION_VERB in action-risk.ts), so using it here
    // would trip the NAME floor and prove the wrong branch. `weather_forecast` contains no verb,
    // so the ONLY thing that can raise it is the provider's own declared effect.
    row({ tool_name: "weather_forecast", effects: ["update"] }),
    row({ tool_name: "mystery_thing", effects: [] }),
  ]);
  const by = Object.fromEntries(r.body.tools.map((t) => [t.name, t]));
  check("a provider-declared mutating effect raises a non-verb tool",
    by.weather_forecast?.requiresApproval === true && by.weather_forecast?.approvalBasis === "provider_declared_effect");
  check("an UNDECLARED effect set fails CLOSED, not open",
    by.mystery_thing?.requiresApproval === true && by.mystery_thing?.approvalBasis === "effects_undeclared");
}

// ── 3. one refusal, never three ─────────────────────────────────────────────
// An earlier version of this loop fed the handler the SAME literal three times under three
// different labels, so it asserted one mapping three times while its header claimed to prove the
// existence oracle stays closed. It could not have failed if the RPC raised three different
// messages. That the RPC's own three refusals are identical is proven where it lives, in
// supabase/tests/mcp_tool_catalog_tenant_scope.sql, by capturing and comparing the real SQLERRMs.
// What THIS module owes is that it cannot re-open the oracle downstream — so it now feeds three
// DIFFERENT shapes the 42501 path can genuinely arrive in, and requires one byte-identical answer.
{
  const answers = [];
  for (const [label, msg] of [
    ["unknown id", "MCP_FORBIDDEN: connection not in tenant"],
    ["foreign tenant", "MCP_FORBIDDEN: connection not in tenant\nCONTEXT: PL/pgSQL function get_mcp_connection_tools"],
    ["owner_only without standing", "permission denied: MCP_FORBIDDEN: connection not in tenant (42501)"],
  ]) {
    const r = await call([], { rpcError: msg });
    answers.push(JSON.stringify({ s: r.httpStatus, b: r.body }));
    check(`${label} → a single indistinguishable not_found`,
      r.httpStatus === 404 && r.body.error === "not_found", JSON.stringify(r.body));
  }
  check("the three refusals are BYTE-IDENTICAL, not merely all 404",
    answers.every((a) => a === answers[0]), answers.join(" vs "));
}
{
  const r = await call([], { rpcError: "some unrelated database fault" });
  check("an unrelated fault is NOT laundered into not_found",
    r.httpStatus === 500 && r.body.error === "lookup_failed", JSON.stringify(r.body));
}

// ── 4. approved_count counts CONSENT, not rows ──────────────────────────────
//
// `approved` means only that an approval ROW exists. The function that decides at dispatch,
// verify_mcp_connection_approval, refuses on SEVEN conditions; the RPC models the five a
// catalogue can see and reports them as `approval_blocked_reason`. Counting a blocked row as
// consent tells an owner they are covered when the runner will decline — the exact false-green
// this list was built to end — so the count keys on the reason rather than on expiry and
// staleness alone, which are only two of the five.
{
  const r = await call([
    row({ tool_name: "send_a", effects: ["send"], approved: true }),
    row({ tool_name: "send_b", effects: ["send"], approved: true, approval_expired: true, approval_blocked_reason: "approval_expired" }),
    row({ tool_name: "send_c", effects: ["send"], approved: true, approval_stale: true, approval_blocked_reason: "contract_changed" }),
    // Unexpired, unstale, and still refused at dispatch. Before the reason crossed, this row was
    // indistinguishable from send_a and was counted as live consent.
    row({ tool_name: "send_d", effects: ["send"], approved: true, approval_blocked_reason: "endpoint_changed" }),
    row({ tool_name: "send_e", effects: ["send"], approved: true, approval_blocked_reason: "approval_not_endpoint_bound" }),
  ]);
  check("only consent that still AUTHORISES something is counted",
    r.body.approved_count === 1, `approved_count=${r.body.approved_count}`);
  check("an approval bound to a MOVED endpoint is reported, not silently counted",
    r.body.tools.find((t) => t.name === "send_d")?.approvalBlockedReason === "endpoint_changed");
  check("a pre-binding approval is reported as unbound",
    r.body.tools.find((t) => t.name === "send_e")?.approvalBlockedReason === "approval_not_endpoint_bound");
  check("tool_count still counts every tool offered",
    r.body.tool_count === 5, `tool_count=${r.body.tool_count}`);

  // An unapproved action has no approval to block, so its reason is null. If that null were read
  // as "consent is fine", the two states would collapse into one.
  const u = await call([row({ tool_name: "list_x", effects: ["read"] })]);
  check("an UNAPPROVED action carries no blocking reason, and is not counted as consent",
    u.body.tools[0].approvalBlockedReason === null && u.body.approved_count === 0);

  // A reason this build does not recognise means the server knows something newer. Treating it as
  // "no reason" would promote a blocked approval back to fine — the one direction this must never
  // fail in.
  const x = await call([row({ tool_name: "send_f", effects: ["send"], approved: true, approval_blocked_reason: "some_future_reason" })]);
  check("an UNRECOGNISED reason still BLOCKS rather than being dropped",
    x.body.tools[0].approvalBlockedReason !== null && x.body.approved_count === 0,
    JSON.stringify(x.body.tools[0]));
}

// ── 5. hostile input from the provider ──────────────────────────────────────
{
  const r = await call([
    row({ tool_name: "<script>alert(1)</script>" }),
    row({ tool_name: "ok_tool", app: "Gm\nail\u0000<b>", action_type: "x".repeat(200), effects: ["read", "bogus", "read"] }),
  ]);
  check("a tool name that is not an identifier is DROPPED, not sanitized",
    r.body.tools.length === 1 && r.body.tools[0].name === "ok_tool",
    JSON.stringify(r.body.tools.map((t) => t.name)));
  const t = r.body.tools[0];
  check("a provider label cannot smuggle newlines or control bytes",
    !/[\n\u0000<>]/.test(t.app), JSON.stringify(t.app));
  check("a provider label is length-bounded", t.actionType.length <= 80, String(t.actionType.length));
  check("effects are reduced to the closed vocabulary, deduped",
    JSON.stringify(t.effects) === JSON.stringify(["read"]), JSON.stringify(t.effects));
}

// ── 6. the workspace-switch race, and a missing id ──────────────────────────
{
  const r = await toolsMod.runTools(
    { userClient: clientReturning([], { tenant: "tenant-b" }) },
    { connectionId: FIXTURE_ID, expectedTenantId: "tenant-a" },
  );
  check("a workspace switch mid-flight refuses rather than rendering the wrong list",
    r.httpStatus === 409 && r.body.error === "tenant_mismatch", JSON.stringify(r.body));

  const r2 = await toolsMod.runTools({ userClient: clientReturning([]) }, { connectionId: "", expectedTenantId: null });
  check("a missing connection_id is refused before any read",
    r2.httpStatus === 400 && r2.body.error === "bad_connection_id");

  // Same guard, same code, same status as approve/execute/oauth_begin. Without it a malformed id
  // travels to Postgres and returns as an unrecognised error, which this module would report as a
  // 500 — a different refusal shape from every sibling, for an input it can reject itself.
  const r3 = await toolsMod.runTools({ userClient: clientReturning([]) }, { connectionId: "not-a-uuid", expectedTenantId: null });
  check("a MALFORMED connection_id is refused here, not by the database",
    r3.httpStatus === 400 && r3.body.error === "bad_connection_id", JSON.stringify(r3.body));
}

// ── 7. the empty catalogue keeps its one meaning ────────────────────────────
{
  const r = await call([]);
  check("an unprobed connection answers ok with an EMPTY list, never a refusal",
    r.httpStatus === 200 && r.body.ok === true && r.body.tools.length === 0 && r.body.observed_at === null,
    JSON.stringify(r.body));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exitCode = 1; }
