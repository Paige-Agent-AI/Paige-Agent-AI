#!/usr/bin/env node
/**
 * manage-tenant-domain — does a real change to the sending identity leave evidence?
 *
 * WHY THIS EXISTS. Adding, re-pointing or removing a sending domain changes the
 * identity every outbound message carries, and none of it left a trace: buying a
 * phone number writes `audit_logs`, and `quickbooks-disconnect` writes one for
 * revoking a third-party integration, but this whole seam wrote nothing.
 *
 * `deno check` proves the new writes COMPILE. It cannot prove they fire on the
 * right paths — which is the entire question — so this drives the REAL handler
 * and asserts what actually reached `audit_logs`. Only the Supabase client and
 * the outbound Resend call are substituted; the handler itself is the shipped one.
 *
 * Every assertion here FAILS against the version before this change, because that
 * version wrote no audit row at all. The three that would pass either way are the
 * negative controls: a rejected verb, a foreign row, and the DNS poll that found
 * nothing new must each write NOTHING.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "comms-domain-audit-"));

let calls;
let providerAllowed = true;
const reset = () => { calls = { audits: [], inserts: [], updates: [], deletes: [], providerCalls: [] }; };

/**
 * A fake postgrest builder covering exactly the shapes this handler uses:
 *   .select().eq().eq().maybeSingle()   .select().eq().order()
 *   .insert().select().single()          .update().eq().eq()   .delete().eq().eq()
 * Terminal calls resolve through the scenario; every write is recorded.
 */
fs.writeFileSync(path.join(outDir, "supabase-stub.mjs"), `
export function createClient() {
  const g = globalThis.__smoke;
  const q = (table) => {
    const st = { table, filters: {}, op: "select" };
    const api = {
      select() { return api; },
      eq(c, v) { st.filters[c] = v; return api; },
      order() { return Promise.resolve(g.read(st)); },
      insert(row) { st.op = "insert"; st.row = row; g.record(st); return api; },
      update(row) { st.op = "update"; st.row = row; g.record(st); return api; },
      delete() { st.op = "delete"; g.record(st); return api; },
      maybeSingle() { return Promise.resolve(g.read(st)); },
      single() { return Promise.resolve(g.read(st)); },
      then(res) { return Promise.resolve(g.read(st)).then(res); },
    };
    return api;
  };
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
    rpc: (name) => Promise.resolve(g.rpc(name)),
    from: (t) => q(t),
  };
}
`);

const outFile = path.join(outDir, "mod.mjs");
await build({
  entryPoints: ["supabase/functions/manage-tenant-domain/index.ts"],
  outfile: outFile, bundle: true, format: "esm", platform: "neutral", target: "es2022",
  plugins: [{
    name: "substitute-supabase",
    setup(b) {
      b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ },
        () => ({ path: path.join(outDir, "supabase-stub.mjs") }));
    },
  }],
});

let handler = null;
globalThis.Deno = {
  env: {
    get: (k) => ({
      SUPABASE_URL: "https://x.test",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      RESEND_API_KEY: "re_test",
    }[k]),
  },
  serve: (h) => { handler = h; },
};

/** Every outbound Resend call is answered here; nothing leaves the process. */
let resendStatus = "verified";
globalThis.fetch = async (url) => { calls.providerCalls.push(String(url)); return new Response(JSON.stringify(
  String(url).includes("/domains")
    ? { id: "rsd_1", status: resendStatus, records: [{ type: "TXT", name: "@", value: "v=spf1" }] }
    : {}), { status: 200, headers: { "Content-Type": "application/json" } }); };

let rows;
globalThis.__smoke = {
  rpc(name) {
    if (name === "comms_provider_execution_allowed") return { data: providerAllowed, error: null };
    if (name === "has_role") return { data: true };
    if (name === "is_platform_owner") return { data: false };
    return { data: null };
  },
  record(st) {
    if (st.table === "audit_logs" && st.op === "insert") calls.audits.push(st.row);
    else if (st.op === "insert") calls.inserts.push(st.row);
    else if (st.op === "update") calls.updates.push({ filters: st.filters, row: st.row });
    else if (st.op === "delete") calls.deletes.push(st.filters);
  },
  read(st) {
    if (st.table === "profiles") return { data: { active_tenant_id: "tenant-1" }, error: null };
    if (st.table === "audit_logs") return { data: null, error: null };
    if (st.op === "insert") return { data: { id: "dom-new", ...st.row }, error: null };
    if (st.op === "update" || st.op === "delete") return { data: null, error: null };
    // A default-domain probe asks for is_default=true; a row lookup asks for id.
    if (st.filters.is_default === true) return { data: rows.existingDefault, error: null };
    if (st.filters.id) return { data: rows.byId, error: null };
    return { data: [], error: null };
  },
};

await import(pathToFileURL(outFile).href);
assert.ok(handler, "handler was never registered");

const post = (body) => handler(new Request("https://x.test/manage-tenant-domain", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
  body: JSON.stringify(body),
}));

let failed = 0;
const ok = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message.split("\n")[0]}`); }
};
const audit = () => calls.audits[0];

console.log("\nmanage-tenant-domain — evidence on every real change\n");

console.log("— restricted workspace cannot grant provider authority —");
for (const body of [{ verb: "add", domain: "example.com", from_email_local: "hello" }, { verb: "refresh", id: "restricted-domain" }]) {
  reset(); providerAllowed = false;
  rows = { existingDefault: null, byId: { id: "restricted-domain", resend_domain_id: "rsd_1", status: "pending" } };
  const response = await post(body);
  ok("restricted action is refused", () => assert.equal(response.status, 403));
  ok("restricted action makes no provider calls", () => assert.equal(calls.providerCalls.length, 0));
  ok("restricted action creates no domain changes or event", () => assert.equal(calls.inserts.length + calls.updates.length + calls.deletes.length + calls.audits.length, 0));
}
providerAllowed = true;

console.log("— adding a sending domain —");
reset(); rows = { existingDefault: null, byId: null };
await post({ verb: "add", domain: "example.com", from_email_local: "hello", from_name: "Example" });
ok("writes exactly one audit row", () => assert.equal(calls.audits.length, 1));
ok("named as a sending-domain add", () => assert.equal(audit().action, "comms:sending_domain_added"));
ok("attributed to the caller from the verified JWT", () => assert.equal(audit().user_id, "user-1"));
ok("carries the server-derived tenant, never a body value", () => assert.equal(audit().data.tenant_id, "tenant-1"));
ok("names the domain", () => assert.equal(audit().data.domain, "example.com"));
ok("records that it became the default (workspace had none)", () => assert.equal(audit().data.became_default, true));
ok("carries no secret", () => assert.ok(!JSON.stringify(audit()).includes("re_test")));

console.log("\n— re-pointing the default —");
reset(); rows = { existingDefault: { id: "dom-old", domain: "old.example" }, byId: { id: "dom-2", domain: "new.example" } };
await post({ verb: "set_default", id: "dom-2" });
ok("writes one audit row", () => assert.equal(calls.audits.length, 1));
ok("names the domain it changed TO", () => assert.equal(audit().data.domain, "new.example"));
ok("names the domain it replaced", () => assert.equal(audit().data.replaced_domain, "old.example"));

console.log("\n— removing a domain —");
reset(); rows = { existingDefault: null, byId: { id: "dom-3", domain: "gone.example", is_default: true, status: "verified", resend_domain_id: null } };
await post({ verb: "remove", id: "dom-3" });
ok("writes one audit row", () => assert.equal(calls.audits.length, 1));
ok("named as a removal", () => assert.equal(audit().action, "comms:sending_domain_removed"));
ok("preserves the domain the deleted row held", () => assert.equal(audit().data.domain, "gone.example"));
ok("marks that it WAS the default", () => assert.equal(audit().data.was_default, true));

console.log("\n— the DNS poll: only the transition is an event —");
reset(); resendStatus = "verified";
rows = { existingDefault: null, byId: { id: "d", domain: "p.example", status: "pending", resend_domain_id: "rsd_1", dns_records: [] } };
await post({ verb: "refresh", id: "d" });
ok("a status CHANGE is recorded", () => assert.equal(calls.audits.length, 1));
ok("...naming both ends of the transition", () => {
  assert.equal(audit().data.from_status, "pending");
  assert.equal(audit().data.to_status, "verified");
});

reset(); resendStatus = "verified";
rows = { existingDefault: null, byId: { id: "d", domain: "p.example", status: "verified", resend_domain_id: "rsd_1", dns_records: [] } };
await post({ verb: "refresh", id: "d" });
ok("NEGATIVE CONTROL: an unchanged poll writes nothing", () => assert.equal(calls.audits.length, 0));

console.log("\n— nothing happened, so nothing is recorded —");
reset(); rows = { existingDefault: null, byId: null };
await post({ verb: "remove", id: "someone-elses-row" });
ok("NEGATIVE CONTROL: a row outside the tenant writes no audit", () => assert.equal(calls.audits.length, 0));

reset(); rows = { existingDefault: null, byId: null };
await post({ verb: "nonsense" });
ok("NEGATIVE CONTROL: an unknown verb writes no audit", () => assert.equal(calls.audits.length, 0));

reset(); rows = { existingDefault: null, byId: null };
await post({ verb: "list" });
ok("NEGATIVE CONTROL: a read writes no audit", () => assert.equal(calls.audits.length, 0));

console.log(failed === 0 ? "\nall assertions passed." : `\n${failed} FAILED.`);
process.exit(failed === 0 ? 0 : 1);
