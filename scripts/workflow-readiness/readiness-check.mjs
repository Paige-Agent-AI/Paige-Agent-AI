// PAIGE Workflow Execution Readiness — Phase 0 behavioural checks.
//
// Run from the repo root:
//   node --experimental-strip-types \
//     --import ./scripts/workflow-readiness/register.mjs \
//     scripts/workflow-readiness/readiness-check.mjs
//
// Anti-vacuity: PROVE_AGAINST=<dir containing pre-fix copies of the two index.ts
// files> runs the SAME checks against the pre-fix handlers. They must FAIL there.
//
// These import the REAL handlers. Deno.serve is captured rather than bound, and
// createClient is redirected to an injectable PostgREST-shaped fake, so a check
// asserts on the filters the handler actually applied — the tenant scope and the
// claim compare-and-swap ARE filters, so asserting on them asserts the property.
//
// Standalone by design: vitest's include is `src/**`, so this adds no CI surface
// and package.json is untouched.
import fs from "node:fs";
import path from "node:path";
import { makeFakeSupabase } from "./fake-supabase.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PRE = process.env.PROVE_AGAINST || null;
const MODE = PRE ? `PRE-FIX (${PRE})` : "working tree";

let pass = 0; const fails = [];
async function check(name, fn) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fails.push(name); console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const SERVICE_KEY = "service-role-test-key";
const ENV = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  SUPABASE_ANON_KEY: "anon-test-key",
};

// Load one handler with a given env + fake client. Fresh module each time so the
// module-level env reads (the activation gate) are re-evaluated per scenario.
let loadSeq = 0;
async function loadHandler(fnName, env, fake) {
  let captured = null;
  globalThis.Deno = {
    serve: (h) => { captured = h; },
    env: { get: (k) => ({ ...ENV, ...env })[k] },
  };
  globalThis.__FAKE_SUPABASE__ = fake;
  globalThis.__DISPATCH_CALLS__ = [];
  const dir = PRE ? PRE : path.join(ROOT, "supabase/functions", fnName);
  const file = PRE ? path.join(PRE, `${fnName}.index.ts`) : path.join(dir, "index.ts");
  await import(`${file}?v=${++loadSeq}`);
  assert(captured, `${fnName}: handler was never registered`);
  return captured;
}
const req = (opts = {}) => new Request("https://test.local/fn", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  body: JSON.stringify(opts.body ?? {}),
});

console.log(`\n=== workflow execution readiness · ${MODE} ===\n`);
console.log("--- dispatcher: caller gate + activation gate ---");

await check("R-auth · dispatcher refuses a caller without the service-role token", async () => {
  const h = await loadHandler("dispatch-queued-workflow-runs", { WORKFLOW_EXECUTION_ENABLED: "true" }, makeFakeSupabase());
  const res = await h(req({ headers: { Authorization: "Bearer not-the-key" } }));
  eq(res.status, 401, "status");
});

await check("R9 · dispatcher refuses to run while execution is gated off, and says why", async () => {
  const fake = makeFakeSupabase();
  const h = await loadHandler("dispatch-queued-workflow-runs", {}, fake);
  const res = await h(req({ headers: { Authorization: `Bearer ${SERVICE_KEY}` } }));
  eq(res.status, 503, "status");
  const b = await res.json();
  eq(b.ok, false, "ok");
  eq(b.code, "workflow_execution_disabled", "code");
  assert(Array.isArray(b.missing_contracts) && b.missing_contracts.length >= 2, "missing_contracts reported");
  eq(fake.__queries.length, 0, "no query may run while gated off");
});

console.log("\n--- dispatcher: claiming, eligibility, tenant, honesty ---");

// Shared scenario: one queued run whose registry row is active. The default target is an n8n webhook:
// INT-310's dispatch allowlist ends any non-allowlisted `direct_edge_function` run BEFORE the claim, so a
// direct-target default would make the claim / dispatch checks below vacuous. Pass `direct` to model a
// direct_edge_function row (R14, R16).
function dispatcherWorld({ isActive = true, claimRows = [{ id: "run-1" }], queuedErr = null, tenantId = "tenant-A", direct = null } = {}) {
  return makeFakeSupabase({
    "select:paige_workflow_runs": (q) => {
      const isQueued = q.filters.some(([, c, v]) => c === "status" && v === "queued");
      const isDead = q.filters.some(([op]) => op === "gte");
      if (isDead) return { data: [] };
      if (isQueued) {
        if (queuedErr) return { data: null, error: { message: queuedErr } };
        return { data: [{ id: "run-1", registry_id: "reg-1", status: "queued", payload: {}, retry_count: 0 }] };
      }
      return { data: [] };
    },
    "select:paige_workflow_registry": () => ({
      data: [{
        id: "reg-1", key: "wf.demo", provider: direct ? "direct_edge_function" : "n8n", is_active: isActive,
        tenant_id: tenantId, n8n_webhook_url: direct ? null : "https://n8n.example.invalid/webhook/demo", needs_n8n_link: false,
        langgraph_graph_id: null, direct_function_name: direct,
      }],
    }),
    "update:paige_workflow_runs": () => ({ data: claimRows }),
  });
}

await check("R4/R5 · a run is CLAIMED by compare-and-swap before dispatch", async () => {
  const fake = dispatcherWorld();
  const h = await loadHandler("dispatch-queued-workflow-runs", { WORKFLOW_EXECUTION_ENABLED: "true" }, fake);
  await h(req({ headers: { Authorization: `Bearer ${SERVICE_KEY}` } }));
  const claim = fake.__queries.find((q) => q.op === "update" && q.table === "paige_workflow_runs"
    && q.filters.some(([, c, v]) => c === "status" && v === "queued"));
  assert(claim, "no compare-and-swap claim was issued (dispatch happened without claiming)");
  assert(claim.payload?.status === "running", "the claim must move the row out of 'queued'");
  eq(globalThis.__DISPATCH_CALLS__.length, 1, "dispatched exactly once");
});

await check("R5 · a lost claim race does NOT dispatch", async () => {
  const fake = dispatcherWorld({ claimRows: [] }); // another sweep won
  const h = await loadHandler("dispatch-queued-workflow-runs", { WORKFLOW_EXECUTION_ENABLED: "true" }, fake);
  const b = await (await h(req({ headers: { Authorization: `Bearer ${SERVICE_KEY}` } }))).json();
  eq(globalThis.__DISPATCH_CALLS__.length, 0, "must not dispatch a run it did not claim");
  assert(b.results.some((r) => r.status === "not_claimed"), "the lost race is reported");
});

await check("R2/R3 · a DISABLED workflow is never dispatched", async () => {
  const fake = dispatcherWorld({ isActive: false });
  const h = await loadHandler("dispatch-queued-workflow-runs", { WORKFLOW_EXECUTION_ENABLED: "true" }, fake);
  const b = await (await h(req({ headers: { Authorization: `Bearer ${SERVICE_KEY}` } }))).json();
  eq(globalThis.__DISPATCH_CALLS__.length, 0, "an inactive workflow must not dispatch");
  assert(b.results.some((r) => r.error === "workflow_not_active"), "terminated with an honest reason");
});

await check("R1 · the run's registry tenant is passed to the dispatcher (§118 gate not bypassed)", async () => {
  const fake = dispatcherWorld({ tenantId: "tenant-A" });
  const h = await loadHandler("dispatch-queued-workflow-runs", { WORKFLOW_EXECUTION_ENABLED: "true" }, fake);
  await h(req({ headers: { Authorization: `Bearer ${SERVICE_KEY}` } }));
  const call = globalThis.__DISPATCH_CALLS__[0];
  assert(call, "nothing dispatched");
  eq(call.callerTenantId, "tenant-A", "callerTenantId — omitting it bypasses the platform-owner provider gate");
});

await check("R14 · a re-entrant direct target is refused", async () => {
  const fake = dispatcherWorld({ direct: "dispatch-queued-workflow-runs" });
  const h = await loadHandler("dispatch-queued-workflow-runs", { WORKFLOW_EXECUTION_ENABLED: "true" }, fake);
  const b = await (await h(req({ headers: { Authorization: `Bearer ${SERVICE_KEY}` } }))).json();
  eq(globalThis.__DISPATCH_CALLS__.length, 0, "must not dispatch into itself");
  assert(b.results.some((r) => String(r.error ?? "").startsWith("re_entrant_target_refused")), "refusal is recorded");
});

await check("R16 · a direct target that is not on the service-dispatch allowlist ends before the claim (INT-310)", async () => {
  const fake = dispatcherWorld({ direct: "send-message" });
  const h = await loadHandler("dispatch-queued-workflow-runs", { WORKFLOW_EXECUTION_ENABLED: "true" }, fake);
  const b = await (await h(req({ headers: { Authorization: `Bearer ${SERVICE_KEY}` } }))).json();
  eq(globalThis.__DISPATCH_CALLS__.length, 0, "a non-allowlisted direct target must not dispatch");
  const claimed = fake.__queries.some((q) => q.op === "update" && q.table === "paige_workflow_runs"
    && q.payload?.status === "running");
  assert(!claimed, "it must end before the compare-and-swap claim");
  assert(b.results.some((r) => r.error === "direct_function_not_allowlisted"), "terminated with an honest reason");
});

await check("R15 · a queue read failure is reported, not returned as an ok empty sweep", async () => {
  const fake = dispatcherWorld({ queuedErr: "connection reset" });
  const h = await loadHandler("dispatch-queued-workflow-runs", { WORKFLOW_EXECUTION_ENABLED: "true" }, fake);
  const res = await h(req({ headers: { Authorization: `Bearer ${SERVICE_KEY}` } }));
  eq(res.status, 500, "status");
  const b = await res.json();
  eq(b.ok, false, "ok must be false when the queue could not be read");
});

console.log("\n--- trigger-workflow: tenant scope + gate ---");

function triggerWorld({ registryTenant = null, callerTenant = "tenant-A", isOperator = false } = {}) {
  return makeFakeSupabase({
    __user: { id: "user-1" },
    "rpc:has_role": () => ({ data: true }),
    "rpc:current_user_tenant_id": () => ({ data: callerTenant }),
    "rpc:is_platform_operator": () => ({ data: isOperator }),
    "select:paige_workflow_registry": () => ({
      data: { id: "reg-1", key: "wf.demo", provider: "direct_edge_function", is_active: true,
              tenant_id: registryTenant, direct_function_name: "send-welcome-email", label: "Demo" },
    }),
    "insert:paige_workflow_runs": () => ({ data: { id: "run-1" } }),
    "update:paige_workflow_runs": () => ({ data: [{ id: "run-1" }] }),
  });
}

await check("R1/R3 · a tenant admin CANNOT trigger another tenant's workflow", async () => {
  const fake = triggerWorld({ registryTenant: "tenant-B", callerTenant: "tenant-A" });
  const h = await loadHandler("trigger-workflow", { WORKFLOW_EXECUTION_ENABLED: "true" }, fake);
  const res = await h(req({ headers: { Authorization: "Bearer user-jwt" }, body: { registry_key: "wf.demo" } }));
  eq(res.status, 404, "a foreign-tenant workflow must be unreachable");
  const inserted = fake.__queries.some((q) => q.op === "insert");
  eq(inserted, false, "no run row may be created for a foreign tenant");
});

await check("R1 · a caller in the OWNING tenant is allowed", async () => {
  const fake = triggerWorld({ registryTenant: "tenant-A", callerTenant: "tenant-A" });
  const h = await loadHandler("trigger-workflow", { WORKFLOW_EXECUTION_ENABLED: "true" }, fake);
  const res = await h(req({ headers: { Authorization: "Bearer user-jwt" }, body: { registry_key: "wf.demo" } }));
  assert(res.status !== 404 && res.status !== 403, `owning tenant was blocked (status ${res.status})`);
});

await check("R3 · a platform-scoped workflow needs OPERATOR authority, not a tenant app_role", async () => {
  const denied = triggerWorld({ registryTenant: null, callerTenant: "tenant-A", isOperator: false });
  let h = await loadHandler("trigger-workflow", { WORKFLOW_EXECUTION_ENABLED: "true" }, denied);
  eq((await h(req({ headers: { Authorization: "Bearer u" }, body: { registry_key: "wf.demo" } }))).status, 404,
     "a tenant admin must not reach a platform-scoped workflow");
  const allowed = triggerWorld({ registryTenant: null, callerTenant: null, isOperator: true });
  h = await loadHandler("trigger-workflow", { WORKFLOW_EXECUTION_ENABLED: "true" }, allowed);
  const res = await h(req({ headers: { Authorization: "Bearer u" }, body: { registry_key: "wf.demo" } }));
  assert(res.status !== 404, `operator was blocked (status ${res.status})`);
});

await check("R9 · trigger-workflow queues nothing while execution is gated off", async () => {
  const fake = triggerWorld({ registryTenant: "tenant-A", callerTenant: "tenant-A" });
  const h = await loadHandler("trigger-workflow", {}, fake);
  const res = await h(req({ headers: { Authorization: "Bearer u" }, body: { registry_key: "wf.demo" } }));
  eq(res.status, 503, "status");
  eq(fake.__queries.some((q) => q.op === "insert"), false, "no run row while gated off");
});

console.log(`\n${fails.length === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
