// EXP10 NEXUS connection read (ANT-164, directive 385a54eb): eligibility, the bounded read, and
// the honest envelope. Every gate fails closed; the envelope is the SAME shape PAIGE chat returns.
// Pure module with injected clients, so the whole suite runs with --deny-net.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  NEXUS_CONNECTION_READ_TOOL, nexusConnectionToolDef, nexusConnectionReadTools, offerNexusConnectionRead,
  readNexusConnections, type NexusConnectionScope,
} from "./nexus-connection-read.ts";
import { INTEGRATIONS_READ_TOOLS } from "../paige-spine/domains/integrations_surface.ts";

const tenant = "11111111-1111-4111-8111-111111111111", actor = "22222222-2222-4222-8222-222222222222";
const scope = (over: Partial<NexusConnectionScope> = {}): NexusConnectionScope => ({
  agent: "nexus", where: "agent_dm", tenantId: tenant, actorId: actor,
  workspaceAdmin: true, storedTools: [NEXUS_CONNECTION_READ_TOOL], ...over,
});

type RpcReply = { data: unknown; error: { code?: unknown; message?: string } | null };
function callerWith(script: Array<RpcReply | Error | Promise<never>>, seen: Array<{ name: string; args?: Record<string, unknown> }> = []) {
  let i = 0;
  return {
    rpc: async (name: string, args?: Record<string, unknown>): Promise<RpcReply> => {
      seen.push({ name, args });
      const step = script[i++] ?? { data: [], error: null };
      if (step instanceof Error) throw step;
      return step;
    },
  };
}
function serviceWith(receipts: Array<{ capability: string; detail: Record<string, unknown> }>) {
  return {
    rpc: async (name: string, args?: Record<string, unknown>): Promise<RpcReply> => {
      if (name === "record_capability_run" && args) {
        receipts.push({ capability: String(args._capability_key), detail: (args._detail ?? {}) as Record<string, unknown> });
        return { data: true, error: null };
      }
      return { data: true, error: null };
    },
  };
}

test("the domain's one def is the integrations_list read with no parameters", () => {
  assert.equal(INTEGRATIONS_READ_TOOLS.length, 1);
  assert.equal(INTEGRATIONS_READ_TOOLS[0].function.name, "integrations_list");
  assert.deepEqual(INTEGRATIONS_READ_TOOLS[0].function.parameters, { type: "object", properties: {} });
});

test("eligibility: every gate must hold, and each failure alone withholds the read", () => {
  const offered = nexusConnectionReadTools(scope());
  assert.equal(offered.length, 1);
  assert.equal(offered[0].function.name, NEXUS_CONNECTION_READ_TOOL);
  assert.equal(nexusConnectionReadTools(scope({ agent: "mentor" })).length, 0);
  assert.equal(nexusConnectionReadTools(scope({ where: "shared" })).length, 0);
  assert.equal(nexusConnectionReadTools(scope({ workspaceAdmin: false })).length, 0);
  assert.equal(nexusConnectionReadTools(scope({ storedTools: null })).length, 0);
  assert.equal(nexusConnectionReadTools(scope({ storedTools: ["ask_choices"] })).length, 0);
  assert.equal(nexusConnectionReadTools(scope({ tenantId: "not-a-uuid" })).length, 0);
  assert.equal(nexusConnectionReadTools(scope({ actorId: "not-a-uuid" })).length, 0);
});

test("the def handed out is a fresh copy, never the domain's own object", () => {
  const a = nexusConnectionToolDef() as unknown as { function: { description: string } };
  a.function.description = "mutated";
  assert.notEqual((nexusConnectionToolDef() as unknown as { function: { description: string } }).function.description, "mutated");
});

test("offer gate: the authority is asked ONLY when the stored scope already names the read", async () => {
  const asked: Array<{ client: string; name: string }> = [];
  const caller = {
    rpc: async (name: string) => { asked.push({ client: "caller", name }); return { data: null, error: { code: "PGRST116", message: "no rows" } }; },
  };
  const service = {
    rpc: async (name: string) => { asked.push({ client: "service", name }); return { data: null, error: null }; },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  };
  // Scope does NOT name the read: no authority call of any kind, no offer.
  assert.equal(await offerNexusConnectionRead({ caller, service, userId: actor, tenantId: tenant }, ["ask_choices"]), false);
  assert.equal(asked.length, 0);
  // Scope names the read: the authority resolver IS consulted (here it fails closed) — the TRUE
  // owner/admin semantics are workspace-authority's own tested home, not re-proved here.
  assert.equal(await offerNexusConnectionRead({ caller, service, userId: actor, tenantId: tenant }, [NEXUS_CONNECTION_READ_TOOL]), false);
  assert.ok(asked.length > 0);
  await nextTurn(); // let every in-flight authority answer settle inside the test
});

test("read: no arguments accepted; anything the model passes is needs_input", async () => {
  const receipts: Array<{ capability: string; detail: Record<string, unknown> }> = [];
  const seen: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const caller = callerWith([{ data: [], error: null }], seen);
  const refused = await readNexusConnections({ caller, service: serviceWith(receipts), userId: actor, tenantId: tenant, turnRef: "t1:h1" }, { limit: 5 });
  assert.equal((refused as { status?: string }).status, "needs_input");
  assert.equal(seen.length, 0); // nothing was read
  const clean = await readNexusConnections({ caller, service: serviceWith(receipts), userId: actor, tenantId: tenant, turnRef: "t1:h2" }, undefined);
  assert.equal((clean as { success?: boolean }).success, true);
  const empty = await readNexusConnections({ caller, service: serviceWith(receipts), userId: actor, tenantId: tenant, turnRef: "t1:h3" }, {});
  assert.equal((empty as { success?: boolean }).success, true);
});

test("read: the success envelope is exactly PAIGE chat's shape, and the receipt is metadata-only", async () => {
  const receipts: Array<{ capability: string; detail: Record<string, unknown> }> = [];
  const rows = [{ channel: "email", provider: "google", status: "active" }, { channel: "mcp", provider: "generic-remote", status: "active" }];
  const caller = callerWith([{ data: rows, error: null }]);
  const out = await readNexusConnections({ caller, service: serviceWith(receipts), userId: actor, tenantId: tenant, turnRef: "t2:h1" }, undefined);
  assert.deepEqual(out, { success: true, count: 2, integrations: rows });
  await nextTurn(); // the receipt is fire-and-forget evidence
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].capability, "integrations_list");
  assert.deepEqual(receipts[0].detail, { channel: "team_hub_agent", tool: "integrations_list", read_only: true });
});

test("read: a database refusal and a non-array answer are honest unavailables, never guesses", async () => {
  const receipts: Array<{ capability: string; detail: Record<string, unknown> }> = [];
  const refused = await readNexusConnections({
    caller: callerWith([{ data: null, error: { code: "42501", message: "permission denied" } }]),
    service: serviceWith(receipts), userId: actor, tenantId: tenant, turnRef: "t3:h1",
  }, undefined);
  assert.equal((refused as { status?: string }).status, "unavailable");
  const nonArray = await readNexusConnections({
    caller: callerWith([{ data: { not: "an array" }, error: null }]),
    service: serviceWith(receipts), userId: actor, tenantId: tenant, turnRef: "t3:h2",
  }, undefined);
  assert.equal((nonArray as { status?: string }).status, "unavailable");
  await nextTurn();
  assert.equal(receipts.length, 0); // nothing succeeded, so nothing was recorded
});

test("read: a transport-lost answer is asked ONCE more; twice lost is unavailable", async () => {
  const lost = { error: { message: "network" } }; // no SQLSTATE, no PGRST: outcome unknown
  const retried = await readNexusConnections({
    caller: callerWith([lost as RpcReply, { data: [{ channel: "email" }], error: null }]),
    service: serviceWith([]), userId: actor, tenantId: tenant, turnRef: "t4:h1",
  }, undefined);
  assert.equal((retried as { success?: boolean }).success, true);
  const twiceLost = await readNexusConnections({
    caller: callerWith([lost as RpcReply, lost as RpcReply]),
    service: serviceWith([]), userId: actor, tenantId: tenant, turnRef: "t4:h2",
  }, undefined);
  assert.equal((twiceLost as { status?: string }).status, "unavailable");
  const thrown = await readNexusConnections({
    caller: callerWith([new Error("socket gone"), new Error("socket gone")]),
    service: serviceWith([]), userId: actor, tenantId: tenant, turnRef: "t4:h3",
  }, undefined);
  assert.equal((thrown as { status?: string }).status, "unavailable");
});

test("read: a hanging provider is bounded by the deadline, and an aborted turn reads nothing", async () => {
  const hang = callerWith([new Promise<never>(() => {})]);
  const bounded = await readNexusConnections({
    caller: hang, service: serviceWith([]), userId: actor, tenantId: tenant, turnRef: "t5:h1", timeoutMs: 25,
  }, undefined);
  assert.equal((bounded as { status?: string }).status, "unavailable");
  const controller = new AbortController();
  controller.abort();
  const aborted = await readNexusConnections({
    caller: callerWith([{ data: [], error: null }]), service: serviceWith([]),
    userId: actor, tenantId: tenant, turnRef: "t5:h2", signal: controller.signal,
  }, undefined);
  assert.equal((aborted as { status?: string }).status, "unavailable");
});
