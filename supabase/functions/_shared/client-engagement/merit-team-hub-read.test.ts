import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGREEMENT_TOOLS } from "../paige-spine/domains/agreement.ts";
import { CLIENT_ENGAGEMENT_TOOLS } from "./chat.ts";
import { meritServiceReadTools, readMeritService } from "./merit-team-hub-read.ts";

const fixture = JSON.parse(readFileSync(new URL("../../../../src/__tests__/fixtures/exp04-client-status-source.json", import.meta.url), "utf8"));
const tenant = fixture.tenant_id, client = fixture.contact_id;
const actor = "11111111-1111-4111-8111-111111111111", agreement = "22222222-2222-4222-8222-222222222222";
const keys = ["agreement_list", "agreement_status", "read_client_engagement_status"];
const scope = () => ({ agent: "merit", where: "agent_dm", audience: "business_team", tenantId: tenant,
  actorId: actor, workspaceAdmin: true, storedTools: [...keys] });

function world() {
  const calls: { name: string; args: Record<string, unknown> | undefined }[] = [];
  const markers: unknown[] = [];
  let current = true, acknowledged = true, failure: { code: string } | null = null;
  let rows: unknown = [{ id: agreement, title: "Consulting engagement", status: "partially_signed", contact_id: client,
    contact_name: "Test Client", signers_total: 2, signers_signed: 1, outstanding_names: ["Test Signer"],
    document_sha256: "private-source-digest", sealed_sha256: null, token_hash: "never-forward",
    updated_at: "2026-01-01T00:00:00Z" }];
  let standing = structuredClone(fixture);
  const caller = { rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: failure ? null : name === "paige_agreement_overview" ? structuredClone(rows)
      : name === "find_clients_for_status" ? { matches: [{ id: client, name: "Test Client", exact: true }], more: false }
      : structuredClone(standing), error: failure };
  } };
  const deps = { caller, isCurrent: async () => current, diagnostics: { contactExists: async () => true },
    recordReads: async (evidence: unknown) => { markers.push(evidence); return acknowledged; } };
  return { calls, markers, deps, rows: (v: unknown) => { rows = v; }, standing: (v: unknown) => { standing = v; },
    current: (v: boolean) => { current = v; }, acknowledge: (v: boolean) => { acknowledged = v; },
    fail: (v: { code: string } | null) => { failure = v; } };
}

test("MERIT offers only the exact three original canonical read schemas", () => {
  const defs = meritServiceReadTools(scope());
  assert.deepEqual(defs.map(t => t.function.name), keys);
  for (const d of defs) assert.ok([...AGREEMENT_TOOLS, ...CLIENT_ENGAGEMENT_TOOLS].some(t => t === d));
  assert.equal(meritServiceReadTools({ ...scope(), storedTools: ["find_clients_for_status", "agreement_send"] }).length, 0);
});

for (const patch of [{ agent: "cura" }, { agent: "paige" }, { where: "channel" }, { where: "dm" },
  { audience: "customer_private" }, { workspaceAdmin: false }, { storedTools: [] }, { tenantId: "bad" }, { actorId: "bad" }])
  test("private scope refuses before a domain read: " + JSON.stringify(patch), async () => {
    const w = world(), s = { ...scope(), ...patch };
    assert.deepEqual(meritServiceReadTools(s), []);
    const r = await readMeritService(s, w.deps, "agreement_list", {});
    assert.deepEqual(r.recordLinks, []); assert.equal(await r.revalidate(), false); assert.equal(w.calls.length, 0);
  });

test("agreement status uses the original caller filter, projection and separate reopen references", async () => {
  const w = world(), r = await readMeritService(scope(), w.deps, "agreement_status", { contactId: client });
  assert.equal(r.model.success, true);
  assert.deepEqual(w.calls, [{ name: "paige_agreement_overview", args: { _expected_tenant_id: tenant, _contact_id: client, _status: null } }]);
  assert.equal(r.model.agreements[0].signersSigned, 1);
  assert.deepEqual(r.recordLinks[0], { destination: "sales_agreements", record_id: agreement });
  assert.equal(JSON.stringify(r.model).includes("private-source-digest"), false);
  assert.equal(JSON.stringify(r.model).includes("never-forward"), false);
  assert.equal("record_links" in r.model, false); assert.equal(w.markers.length, 1);
  assert.equal(await r.revalidate(), true);
});

for (const [name, args] of [["agreement_status", {}], ["agreement_status", { contactId: actor, tenant_id: tenant }],
  ["agreement_list", { status: 42 }], ["agreement_list", { status: "invented" }],
  ["agreement_list", { contactId: client }], ["agreement_send", {}], ["find_clients_for_status", {}]])
  test("malformed/unoffered input never broadens the original reader: " + name + JSON.stringify(args), async () => {
    const w = world(), r = await readMeritService(scope(), w.deps, name as string, args);
    assert.equal(await r.revalidate(), false); assert.equal(w.calls.length, 0);
  });

test("native agreement refusal and malformed responses are unavailable, never an empty success", async () => {
  for (const code of ["42501", "XX000"]) {
    const w = world(); w.fail({ code }); const r = await readMeritService(scope(), w.deps, "agreement_list", {});
    assert.notEqual(r.model.success, true); assert.deepEqual(r.recordLinks, []); assert.equal(await r.revalidate(), false);
  }
  const w = world(); w.rows({ error: "not an array" });
  const r = await readMeritService(scope(), w.deps, "agreement_list", {}); assert.notEqual(r.model.success, true);
});

test("a contact filter cannot return a different client's agreement", async () => {
  const w = world(); w.rows([{ id: agreement, contact_id: actor, status: "draft" }]);
  const r = await readMeritService(scope(), w.deps, "agreement_status", { contactId: client });
  assert.notEqual(r.model.success, true); assert.equal(await r.revalidate(), false);
});

test("changed exact agreement or authority prevents publication", async () => {
  const w = world(), r = await readMeritService(scope(), w.deps, "agreement_list", {});
  w.rows([{ id: agreement, contact_id: client, status: "completed" }]); assert.equal(await r.revalidate(), false);
  w.current(false); assert.equal(await r.revalidate(), false);
});

test("missing original marker acknowledgement withholds facts before model context", async () => {
  const w = world(); w.acknowledge(false); const r = await readMeritService(scope(), w.deps, "agreement_list", {});
  assert.notEqual(r.model.success, true); assert.deepEqual(r.recordLinks, []); assert.equal(await r.revalidate(), false);
});

test("MERIT client standing uses the original resolver/composer and preserves payment distinctions", async () => {
  const w = world(), r = await readMeritService(scope(), w.deps, "read_client_engagement_status", { client: "Test Client" });
  assert.equal(r.model.status, "available"); assert.match(r.model.projection, /provider|verified/i);
  assert.match(r.model.projection, /test/i); assert.match(r.model.projection, /manual|recorded/i);
  assert.deepEqual(w.calls.map(c => c.name), ["find_clients_for_status", "read_client_engagement_status"]);
  assert.equal("record_links" in r.model, false); assert.ok(r.recordLinks.length > 0);
  assert.equal(await r.revalidate(), true);
  const changed = structuredClone(fixture); changed.invoices[0].remaining_minor += 1; w.standing(changed);
  assert.equal(await r.revalidate(), false);
});

test("wrong-client standing and revoked native authority never enter the model", async () => {
  const w = world(); w.standing({ ...fixture, contact_id: actor });
  const r = await readMeritService(scope(), w.deps, "read_client_engagement_status", { client_id: client });
  assert.notEqual(r.model.status, "available"); assert.deepEqual(r.recordLinks, []);
});

test("an already cancelled turn performs no native read", async () => {
  const w = world(), signal = AbortSignal.abort();
  const r = await readMeritService(scope(), { ...w.deps, signal }, "agreement_list", {});
  assert.equal(w.calls.length, 0); assert.equal(await r.revalidate(), false);
});

test("new native observation time alone does not invalidate identical original standing", async () => {
  const w = world(), r = await readMeritService(scope(), w.deps, "read_client_engagement_status", { client_id: client });
  w.standing({ ...fixture, read_at: "2026-10-29T03:30:00.000Z", receipt_id: actor });
  assert.equal(await r.revalidate(), true);
});

test("an unavailable original contact-existence diagnostic cannot become an empty client book", async () => {
  const w = world(); w.rows([]);
  const r = await readMeritService(scope(), { ...w.deps, diagnostics: { contactExists: async () => null } }, "agreement_status", { contactId: client });
  assert.notEqual(r.model.success, true); assert.equal(await r.revalidate(), false);
});

test("cancellation while the original RPC waits never admits late data or a marker", async () => {
  const w = world(), cancel = new AbortController();
  let resolve: (v: { data: unknown; error: null }) => void = () => {};
  const pending = readMeritService(scope(), { ...w.deps, signal: cancel.signal,
    caller: { rpc: () => new Promise(r => { resolve = r; }) } }, "agreement_list", {});
  await Promise.resolve(); await Promise.resolve(); cancel.abort();
  const r = await pending; resolve({ data: [{ id: agreement }], error: null });
  await Promise.resolve(); assert.equal(await r.revalidate(), false); assert.deepEqual(w.markers, []);
});

for (const phase of ["initial", "revalidation"]) test("cancellation during bounded result delivery withholds facts: " + phase, async () => {
  const w = world(), cancel = new AbortController();
  let checks = 0;
  const result = await readMeritService(scope(), { ...w.deps, signal: cancel.signal, isCurrent: async () => {
    if (++checks === (phase === "initial" ? 3 : 6)) queueMicrotask(() => queueMicrotask(() => cancel.abort()));
    return true;
  } }, "agreement_list", {});
  if (phase === "initial") {
    assert.notEqual(result.model.success, true);
    assert.deepEqual(result.recordLinks, []);
  } else {
    assert.equal(result.model.success, true);
    assert.equal(await result.revalidate(), false);
  }
});
