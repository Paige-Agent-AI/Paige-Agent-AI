import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLIENT_ENGAGEMENT_TOOLS, type EngagementCaller } from "../client-engagement/chat.ts";
import {
  CURA_SERVICE_READ_TOOL, CURA_SERVICE_READ_TIMEOUT_MS, curaServiceReadTools, readCuraServiceStanding,
  type CuraServiceScope, type CuraServiceReadDeps, type CuraServiceReadEvidence,
} from "./cura-service-read.ts";

// Reuse the original domain's neutral fixture/composer; no duplicated money model or production proof.
const fixture = JSON.parse(readFileSync(new URL("../../../../src/__tests__/fixtures/exp04-client-status-source.json", import.meta.url), "utf8"));
const tenant = fixture.tenant_id as string, client = fixture.contact_id as string;
const actor = "11111111-1111-4111-8111-111111111111";
const scope = (): CuraServiceScope => ({ agent: "cura", where: "agent_dm", audience: "business_team",
  tenantId: tenant, actorId: actor, workspaceAdmin: true, storedTools: [CURA_SERVICE_READ_TOOL] });

function world() {
  const calls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
  const receipts: CuraServiceReadEvidence[][] = [];
  let current = true, receiptOk = true;
  let source: unknown = structuredClone(fixture), failure: { code: string } | null = null;
  const caller: EngagementCaller = { rpc: async function(name, args) {
    assert.equal(this, caller); calls.push({ name, args });
    return { data: failure ? null : name === "find_clients_for_status"
      ? { matches: [{ id: client, name: "Test Consulting Client", exact: true }], more: false }
      : structuredClone(source), error: failure };
  } };
  const deps: CuraServiceReadDeps = { caller, isCurrent: async () => current,
    recordReads: async reads => { receipts.push([...reads]); return receiptOk; } };
  return { calls, receipts, deps, setCurrent: (v: boolean) => { current = v; },
    setReceipt: (v: boolean) => { receiptOk = v; }, setSource: (v: unknown) => { source = v; },
    setFailure: (v: { code: string } | null) => { failure = v; } };
}

test("same CURA reuses the exact original definition and schema only in its authorized business DM", () => {
  const defs = curaServiceReadTools(scope());
  assert.equal(defs.length, 1);
  assert.equal(defs[0], CLIENT_ENGAGEMENT_TOOLS.find(t => t.function.name === CURA_SERVICE_READ_TOOL));
});

for (const patch of [
  { agent: "paige" }, { agent: "merit" }, { where: "channel" }, { where: "dm" },
  { audience: "customer_private" }, { workspaceAdmin: false }, { storedTools: null }, { storedTools: [] },
  { tenantId: "foreign" }, { actorId: "missing" },
] as const) test("scope refusal does not invoke any reader: " + JSON.stringify(patch), async () => {
  const w = world(), s = { ...scope(), ...patch };
  assert.deepEqual(curaServiceReadTools(s), []);
  const result = await readCuraServiceStanding(s, w.deps, { client_id: client });
  assert.equal(result.model.status, "unavailable"); assert.deepEqual(result.recordLinks, []);
  assert.equal(await result.revalidate(), false); assert.equal(w.calls.length, 0);
});

test("one original caller-JWT read retains business standing and separates presentation references", async () => {
  const w = world(), result = await readCuraServiceStanding(scope(), w.deps, { client_id: client });
  assert.equal(result.model.status, "available");
  assert.deepEqual(w.calls, [{ name: CURA_SERVICE_READ_TOOL, args: { _expected_tenant_id: tenant, _contact_id: client } }]);
  assert.match(result.model.projection!, /provider|verified/i);
  assert.match(result.model.projection!, /test/i); assert.match(result.model.projection!, /manual|recorded/i);
  assert.ok(result.recordLinks.length > 0); assert.ok(!("record_links" in result.model));
  assert.equal(JSON.stringify(result.model).includes("record_links"), false);
  assert.deepEqual(w.receipts, [[{ name: CURA_SERVICE_READ_TOOL, serverRecorded: typeof fixture.receipt_id === "string" }]]);
  assert.equal(await result.revalidate(), true);
  assert.equal(w.calls.length, 2);
});

test("a named client resolves through the original CRM lookup, never by guessed identity", async () => {
  const w = world(), result = await readCuraServiceStanding(scope(), w.deps, { client: "Test Consulting Client" });
  assert.equal(result.model.status, "available");
  assert.deepEqual(w.calls.map(c => c.name), ["find_clients_for_status", CURA_SERVICE_READ_TOOL]);
  assert.equal(w.calls[1].args?._contact_id, client);
});

for (const input of [{ tenant_id: tenant }, { actor_id: actor }, { client_id: "bad" },
  { client: { id: client } }, { client: "x".repeat(121) }, [], null])
  test("model arguments cannot select tenant, actor or malformed client: " + JSON.stringify(input), async () => {
    const w = world(), result = await readCuraServiceStanding(scope(), w.deps, input);
    assert.equal(result.model.status, "unavailable"); assert.equal(w.calls.length, 0);
  });

test("wrong-business or changed expected client transport cannot enter model context", async () => {
  for (const patch of [{ tenant_id: actor }, { contact_id: actor }]) {
    const w = world(); w.setSource({ ...fixture, ...patch });
    const result = await readCuraServiceStanding(scope(), w.deps, { client_id: client });
    assert.equal(result.model.status, "refused"); assert.equal(result.model.projection, undefined);
    assert.deepEqual(result.recordLinks, []);
  }
});

test("a CRM name resolution cannot be followed by another client's status", async () => {
  const w = world(); w.setSource({ ...fixture, contact_id: actor });
  const result = await readCuraServiceStanding(scope(), w.deps, { client: "Test Consulting Client" });
  assert.equal(result.model.status, "refused"); assert.equal(result.model.projection, undefined);
  assert.deepEqual(result.recordLinks, []); assert.equal(await result.revalidate(), false);
});

test("a changed genuine invoice or delivery fact invalidates the prepared answer", async () => {
  const w = world(), result = await readCuraServiceStanding(scope(), w.deps, { client_id: client });
  const changed = structuredClone(fixture); changed.invoices[0].remaining_minor += 1;
  w.setSource(changed); assert.equal(await result.revalidate(), false);
  const work = structuredClone(fixture); work.work.blocked += 1;
  w.setSource(work); assert.equal(await result.revalidate(), false);
});

test("native permission lost after preparation prevents publication", async () => {
  const w = world(), result = await readCuraServiceStanding(scope(), w.deps, { client_id: client });
  assert.equal(result.model.status, "available");
  w.setFailure({ code: "42501" }); assert.equal(await result.revalidate(), false);
});

test("thrown current-scope checks return no facts and do not fall back to another caller", async () => {
  const w = world();
  const result = await readCuraServiceStanding(scope(), { ...w.deps, isCurrent: async () => { throw new Error("offline"); } }, { client_id: client });
  assert.equal(result.model.status, "unavailable"); assert.equal(result.model.projection, undefined);
  assert.equal(w.calls.length, 0);
});

test("native role/refusal and transport failure are never empty or zero financial success", async () => {
  for (const code of ["42501", "XX000"]) {
    const w = world(); w.setFailure({ code });
    const result = await readCuraServiceStanding(scope(), w.deps, { client_id: client });
    assert.notEqual(result.model.status, "available"); assert.equal(result.model.projection, undefined);
    assert.equal(await result.revalidate(), false);
  }
});

test("missing receipt acknowledgment withholds private facts before the model sees them", async () => {
  const w = world(); w.setReceipt(false);
  const result = await readCuraServiceStanding(scope(), w.deps, { client_id: client });
  assert.equal(result.model.status, "unavailable"); assert.equal(result.model.projection, undefined);
  assert.deepEqual(result.recordLinks, []); assert.equal(await result.revalidate(), false);
});

test("a current original source with no native receipt uses the existing turn recorder", async () => {
  const w = world(), data = structuredClone(fixture); delete data.receipt_id; w.setSource(data);
  const result = await readCuraServiceStanding(scope(), w.deps, { client_id: client });
  assert.equal(result.model.status, "available");
  assert.deepEqual(w.receipts, [[{ name: CURA_SERVICE_READ_TOOL, serverRecorded: false }]]);
});

test("authority lost during receipt recording withholds all newly read facts", async () => {
  const w = world();
  const result = await readCuraServiceStanding(scope(), { ...w.deps,
    recordReads: async () => { w.setCurrent(false); return true; } }, { client_id: client });
  assert.equal(result.model.status, "unavailable"); assert.equal(result.model.projection, undefined);
  assert.deepEqual(result.recordLinks, []);
});

test("revocation before read touches no original domain record", async () => {
  const w = world(); w.setCurrent(false);
  const result = await readCuraServiceStanding(scope(), w.deps, { client_id: client });
  assert.equal(result.model.status, "unavailable"); assert.equal(w.calls.length, 0);
});

test("publication revalidates original authority and financial facts; earlier authorized history is untouched", async () => {
  const w = world(), result = await readCuraServiceStanding(scope(), w.deps, { client_id: client });
  const history = JSON.stringify(result.model);
  w.setSource({ ...fixture, client_name: "Corrected client name" });
  assert.equal(await result.revalidate(), false);
  w.setSource(fixture); w.setCurrent(false);
  assert.equal(await result.revalidate(), false);
  assert.equal(JSON.stringify(result.model), history);
});

test("new observation time alone preserves source equality; a business date or zone change does not", async () => {
  const w = world(), result = await readCuraServiceStanding(scope(), w.deps, { client_id: client });
  w.setSource({ ...fixture, read_at: "2026-10-28T12:01:00Z" });
  assert.equal(await result.revalidate(), true);
  w.setSource({ ...fixture, as_of_date: "2026-10-29" });
  assert.equal(await result.revalidate(), false);
  w.setSource({ ...fixture, business_time_zone: { state: "missing", zone: null } });
  assert.equal(await result.revalidate(), false);
});

test("input and original scope are captured before an asynchronous suspension", async () => {
  const w = world(), s = scope(), input = { client_id: client };
  const pending = readCuraServiceStanding(s, w.deps, input);
  input.client_id = actor; (s as { tenantId: string }).tenantId = actor;
  const result = await pending;
  assert.equal(result.model.status, "available");
  assert.equal(w.calls[0].args?._expected_tenant_id, tenant);
  assert.equal(w.calls[0].args?._contact_id, client);
});

test("aborted work never invokes the domain reader or publishes a prepared answer", async () => {
  const w = world(), abort = new AbortController(); abort.abort();
  const result = await readCuraServiceStanding(scope(), { ...w.deps, signal: abort.signal }, { client_id: client });
  assert.equal(result.model.status, "unavailable"); assert.equal(w.calls.length, 0);
});

test("a timed-out CRM lookup cannot start a later status read or replay itself", async t => {
  const w = world(); let finish!: (value: Awaited<ReturnType<EngagementCaller["rpc"]>>) => void;
  const calls: string[] = [];
  const caller: EngagementCaller = { rpc: name => {
    calls.push(name); return new Promise(resolve => { finish = resolve; });
  } };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pending = readCuraServiceStanding(scope(), { ...w.deps, caller }, { client: "Test Consulting Client" });
    await Promise.resolve(); await Promise.resolve();
    t.mock.timers.tick(CURA_SERVICE_READ_TIMEOUT_MS);
    const result = await pending; assert.equal(result.model.status, "unavailable");
    finish({ data: { matches: [{ id: client, exact: true }], more: false }, error: null });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(calls, ["find_clients_for_status"]);
    assert.equal(await result.revalidate(), false);
  } finally { t.mock.timers.reset(); }
});
