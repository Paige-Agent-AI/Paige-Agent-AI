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
let authority;
const reset = () => {
  calls = { audits: [], inserts: [], updates: [], deletes: [], providerCalls: [], listClients: [] };
  authority = { actor: "user-1", activeTenant: "tenant-1", role: "owner", status: "active", globalAdmin: true,
    platformOwner: false, roleError: false, roleValue: undefined, throwRole: false, auditError: false, auditThrow: false,
    clearError: false, clearThrow: false, defaultError: false, defaultThrow: false,
    onFloor: null, onProvider: null, onDomainRead: null, onUpdate: null, onDelete: null, onInsert: null, onRole: null };
};

/**
 * A fake postgrest builder covering exactly the shapes this handler uses:
 *   .select().eq().eq().maybeSingle()   .select().eq().order()
 *   .insert().select().single()          .update().eq().eq()   .delete().eq().eq()
 * Terminal calls resolve through the scenario; every write is recorded.
 */
fs.writeFileSync(path.join(outDir, "supabase-stub.mjs"), `
export function createClient(_url, clientKey) {
  const g = globalThis.__smoke;
  const q = (table) => {
    const st = { table, filters: {}, op: "select", clientKey };
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
    auth: { getUser: () => Promise.resolve(g.user()) },
    rpc: (name, args) => Promise.resolve(g.rpc(name, args, clientKey)),
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
globalThis.fetch = async (url) => { calls.providerCalls.push(String(url)); authority.onProvider?.(String(url)); return new Response(JSON.stringify(
  String(url).includes("/domains")
    ? { id: "rsd_1", status: resendStatus, records: [{ type: "TXT", name: "@", value: "v=spf1" }] }
    : {}), { status: 200, headers: { "Content-Type": "application/json" } }); };

let rows;
globalThis.__smoke = {
  user() { return { data: { user: authority.actor ? { id: authority.actor } : null }, error: null }; },
  rpc(name, args, clientKey) {
    if (name === "comms_provider_execution_allowed") { authority.onFloor?.(); return { data: providerAllowed, error: null }; }
    if (name === "has_role") return { data: authority.globalAdmin };
    if (name === "is_platform_owner") return { data: authority.platformOwner };
    if (name === "current_user_tenant_id") return { data: clientKey === "anon" && authority.status === "active" ? authority.activeTenant : null, error: null };
    if (name === "is_tenant_admin_as") {
      if (authority.throwRole) throw new Error("fixture transport failure");
      const allowed = args?._actor === "user-1" && args?._tenant === authority.activeTenant
        && ["owner", "admin"].includes(authority.role) && authority.status === "active";
      authority.onRole?.();
      return { data: authority.roleValue === undefined ? allowed : authority.roleValue, error: authority.roleError ? { message: "fixture unavailable" } : null };
    }
    return { data: null };
  },
  record(st) {
    if (st.table === "audit_logs" && st.op === "insert") { calls.audits.push(st.row); if (authority.auditThrow) throw new Error("fixture audit transport failed"); }
    else if (st.op === "insert") { calls.inserts.push(st.row); authority.onInsert?.(); }
    else if (st.op === "update") { calls.updates.push({ filters: st.filters, row: st.row }); authority.onUpdate?.(); }
    else if (st.op === "delete") { calls.deletes.push(st.filters); authority.onDelete?.(); }
  },
  read(st) {
    if (st.table === "profiles") return { data: { active_tenant_id: authority.activeTenant }, error: null };
    if (st.table === "audit_logs") return { data: null, error: authority.auditError ? {message:"fixture audit error"} : null };
    if (st.op === "insert") return { data: { id: "dom-new", ...st.row }, error: null };
    if (st.op === "update" && st.row.is_default === false) {
      if (authority.clearThrow) throw new Error("fixture clear transport unavailable");
      if (authority.clearError) return { data: null, error: { message:"fixture clear statement failed" } };
    }
    if (st.op === "update" && st.row.is_default === true) {
      if (authority.defaultThrow) throw new Error("fixture set-default transport unavailable");
      if (authority.defaultError) return { data: null, error: { message:"fixture set-default statement failed" } };
    }
    if (st.op === "update" || st.op === "delete") return { data: null, error: null };
    authority.onDomainRead?.();
    // A default-domain probe asks for is_default=true; a row lookup asks for id.
    if (st.filters.is_default === true) return { data: rows.existingDefault, error: null };
    if (st.filters.id) return { data: rows.byId, error: null };
    calls.listClients.push(st.clientKey); return { data: [], error: null };
  },
};

await import(pathToFileURL(outFile).href);
assert.ok(handler, "handler was never registered");
const errorFile=path.join(outDir,"connect-error.mjs");
await build({entryPoints:["src/lib/integrations/connectError.ts"],outfile:errorFile,bundle:true,format:"esm",platform:"neutral",target:"es2022"});
const {resolveFunctionError}=await import(pathToFileURL(errorFile).href);

const post = (body) => handler(new Request("https://x.test/manage-tenant-domain", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
  body: JSON.stringify(body),
}));

let failed = 0, passed = 0;
const ok = (name, fn) => {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
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

console.log("\n— current actor / current workspace authority —");
const fixtureRow = () => ({ id: "dom-2", domain: "example.invalid", resend_domain_id: "rsd_1", status: "pending" });
const noEffects = () => assert.equal(calls.inserts.length + calls.updates.length + calls.deletes.length + calls.audits.length + calls.providerCalls.length, 0);
for (const [label, configure] of [
  ["member in active workspace despite admin role from another workspace", () => { authority.role = "member"; }],
  ["coach in active workspace", () => { authority.role = "coach"; }],
  ["revoked active-workspace seat despite another workspace admin role", () => { authority.status = "revoked"; }],
  ["inactive active-workspace seat", () => { authority.status = "inactive"; }],
]) {
  for (const body of [{ verb: "list" }, { verb: "add", domain: "new.invalid" }, { verb: "refresh", id: "dom-2" }, { verb: "set_default", id: "dom-2" }, { verb: "remove", id: "dom-2" }]) {
    reset(); rows = { existingDefault: null, byId: fixtureRow() }; configure();
    const response = await post(body);
    const readAllowed = body.verb === "list" && authority.status === "active";
    ok(`${label}: ${body.verb} preserves read visibility without mutation authority`, () => assert.equal(response.status, readAllowed ? 200 : 403));
    if (readAllowed) ok(`${label}: list uses the original JWT native SELECT`, () => assert.deepEqual(calls.listClients, ["anon"]));
    ok(`${label}: ${body.verb} has no effects`, noEffects);
  }
}
for (const role of ["owner", "admin"]) {
  reset(); authority.role = role; authority.globalAdmin = false; rows = { existingDefault: null, byId: fixtureRow() };
  const response = await post({ verb: "set_default", id: "dom-2" });
  ok(`canonical ${role} is sufficient without relying on cached global admin`, () => assert.equal(response.status, 200));
  ok(`canonical ${role} retains existing two writes and audit`, () => { assert.equal(calls.updates.length, 2); assert.equal(calls.audits.length, 1); });
}
for (const [label, configure, expected] of [
  ["no authenticated actor", () => { authority.actor = null; }, 401],
  ["no current workspace", () => { authority.activeTenant = null; }, 400],
  ["body tenant override", () => {}, 403],
  ["authority service error", () => { authority.roleError = true; }, 503],
  ["authority transport error", () => { authority.throwRole = true; }, 503],
]) {
  reset(); rows = { existingDefault: null, byId: fixtureRow() }; configure();
  const response = await post({ verb: "set_default", id: "dom-2", ...(label === "body tenant override" ? { tenant_id: "tenant-2" } : {}) });
  ok(`${label} refuses`, () => assert.equal(response.status, expected)); ok(`${label} has no effects`, noEffects);
}
for (const [label, change] of [
  ["workspace switched", () => { authority.activeTenant = "tenant-2"; }],
  ["seat demoted", () => { authority.role = "member"; }],
  ["seat revoked", () => { authority.status = "revoked"; }],
  ["actor changed", () => { authority.actor = "user-2"; }],
]) {
  reset(); rows = { existingDefault: null, byId: fixtureRow() }; authority.onFloor = change;
  const response = await post({ verb: "set_default", id: "dom-2" });
  ok(`after provider floor: ${label} refused`, () => assert.ok([401,403].includes(response.status)));
  ok(`after provider floor: ${label} no effects`, noEffects);
}
for (const verb of ["add", "refresh", "remove"]) {
  reset(); rows = { existingDefault: null, byId: fixtureRow() }; authority.onProvider = () => { authority.role = "member"; };
  const response = await post(verb === "add" ? { verb, domain: "new.invalid" } : { verb, id: "dom-2" });
  const body = await response.json();
  ok(`${verb}: role change after provider await refuses later registry writes`, () => { assert.equal(response.status, 403); assert.equal(calls.inserts.length + calls.updates.length + calls.deletes.length + calls.audits.length, 0); });
  ok(`${verb}: earlier provider attempt is reported uncertain rather than rolled back`, () => { assert.equal(calls.providerCalls.length, 1); assert.equal(body.operation_outcome, "unconfirmed"); });
  const {message}=await resolveFunctionError({data:null,error:{context:new Response(JSON.stringify(body),{status:response.status})},action:"change your sending domain"});
  ok(`${verb}: actual handler body reaches the incumbent caller's no-repeat/readback copy`,()=>{assert.ok(message.includes("Don’t repeat"));assert.ok(message.includes("current sending-domain state"));assert.ok(!message.includes("try again in a moment"));});
}
reset(); rows = { existingDefault: null, byId: fixtureRow() }; authority.onDomainRead = () => { authority.activeTenant = "tenant-2"; };
const switchedRead = await post({ verb: "set_default", id: "dom-2" });
ok("scope change during a domain read cannot precede a stale write", () => { assert.equal(switchedRead.status, 403); noEffects(); });
reset(); rows = { existingDefault: null, byId: fixtureRow() }; authority.onUpdate = () => { authority.role = "member"; };
const switchedWrite = await post({ verb: "set_default", id: "dom-2" }); const switchedBody = await switchedWrite.json();
ok("role loss after acknowledged first default write stops second write and preserves truthful partial audit", () => { assert.equal(switchedWrite.status, 403); assert.equal(calls.updates.length, 1); assert.equal(calls.audits.length, 1); assert.equal(audit().data.default_clear_acknowledged, true); assert.equal(audit().data.default_cleared, undefined); assert.equal(audit().data.new_default_set, false); assert.equal(audit().data.operation_outcome, "unconfirmed"); assert.equal(switchedBody.error, "domain_operation_unconfirmed"); });
for (const fault of ["clearError","clearThrow"]) for (const changeRole of [false,true]) {
  reset(); rows = { existingDefault: {id:"dom-old",domain:"old.example.invalid"}, byId: fixtureRow() }; authority[fault]=true;
  if(changeRole) authority.onUpdate=()=>{authority.role="member";};
  const response=await post({verb:"set_default",id:"dom-2"});const body=await response.json();
  console.log(JSON.stringify({probe:"default-clear acknowledgement",fault,changeRole,status:response.status,updateAttempts:calls.updates.length,audits:calls.audits.map(a=>a.data),body}));
  ok(`${fault}/role-change-${changeRole}: failed or unknown clear has no success/confirmed-clear audit`,()=>{
    assert.equal(response.status,502);assert.equal(calls.updates.length,1);assert.equal(calls.audits.length,0);assert.equal(body.error,"domain_operation_unconfirmed");assert.equal(body.operation_outcome,"unconfirmed");
  });
  const {message}=await resolveFunctionError({data:null,error:{context:new Response(JSON.stringify(body),{status:response.status})},action:"change your sending domain"});
  ok(`${fault}/role-change-${changeRole}: post-attempt DB error reaches no-repeat/readback copy`,()=>{assert.ok(message.includes("Don’t repeat"));assert.ok(message.includes("current sending-domain state"));assert.ok(!message.includes("try again in a moment"));});
}
for(const fault of ["defaultError","defaultThrow"]) {
  reset(); rows={existingDefault:{id:"dom-old",domain:"old.example.invalid"},byId:fixtureRow()};authority[fault]=true;
  const response=await post({verb:"set_default",id:"dom-2"});const body=await response.json();
  ok(`${fault}: acknowledged clear remains evidenced without claiming second write completed`,()=>{
    assert.equal(response.status,502);assert.equal(calls.updates.length,2);assert.equal(calls.audits.length,1);assert.equal(audit().data.default_clear_acknowledged,true);assert.equal(audit().data.default_cleared,undefined);assert.equal(audit().data.new_default_set,null);assert.equal(audit().data.operation_outcome,"unconfirmed");assert.equal(body.error,"domain_operation_unconfirmed");
  });
}
for (const [verb, effect, complete] of [
  ["remove", "onDelete", "deletes"], ["add", "onInsert", "inserts"], ["refresh", "onUpdate", "updates"],
]) {
  reset(); rows = { existingDefault: null, byId: { ...fixtureRow(), resend_domain_id: verb === "remove" ? null : "rsd_1" } };
  authority[effect] = () => { authority.role = "member"; };
  const response = await post(verb === "add" ? { verb, domain: "new.invalid" } : { verb, id: "dom-2" });
  const body = await response.json();
  ok(`${verb}: completed registry effect retains its original actor/tenant audit after role loss`, () => {
    assert.equal(calls[complete].length, 1); assert.equal(calls.audits.length, 1); assert.equal(audit().user_id, "user-1"); assert.equal(audit().data.tenant_id, "tenant-1");
    assert.equal(response.status, 403); assert.equal(body.error, "domain_operation_unconfirmed");
  });
}
reset(); rows = { existingDefault: null, byId: fixtureRow() };
authority.onUpdate = () => { if (calls.updates.length === 2) authority.role = "member"; };
const finishedDefault = await post({ verb: "set_default", id: "dom-2" });
ok("completed default change retains exactly one ordinary audit before result is withheld", () => {
  assert.equal(finishedDefault.status, 403); assert.equal(calls.updates.length, 2); assert.equal(calls.audits.length, 1); assert.equal(audit().data.new_default_set, undefined);
});
for(const fault of ["auditError","auditThrow"]) {
  reset(); rows = { existingDefault: null, byId: { ...fixtureRow(), resend_domain_id: null } }; authority[fault]=true;
  const originalError=console.error; let logged=0; console.error=(...args)=>{logged++;originalError(...args);};
  let response;try{response=await post({verb:"remove",id:"dom-2"});}finally{console.error=originalError;}
  ok(`existing audit ${fault} is logged without claiming the completed removal failed`,()=>{assert.equal(response.status,200);assert.equal(calls.deletes.length,1);assert.equal(calls.audits.length,1);assert.equal(logged,1);});
}
reset(); rows = { existingDefault: null, byId: fixtureRow() }; authority.onRole = () => { authority.activeTenant = "tenant-2"; };
const switchedRole = await post({ verb: "set_default", id: "dom-2" });
ok("scope is checked after the canonical role RPC resolves", () => { assert.equal(switchedRole.status, 403); noEffects(); });
for (const value of [[true], { allowed: true }, "true", null]) {
  reset(); rows = { existingDefault: null, byId: fixtureRow() }; authority.roleValue = value;
  const response = await post({ verb: "set_default", id: "dom-2" });
  ok(`non-boolean canonical authority result ${JSON.stringify(value)} fails closed`, () => { assert.equal(response.status, 403); noEffects(); });
}
reset(); rows = { existingDefault: null, byId: fixtureRow() };
authority.onProvider = () => { if (calls.providerCalls.length === 2) authority.status = "revoked"; };
const secondWait = await post({ verb: "refresh", id: "dom-2" }); const secondBody = await secondWait.json();
ok("refresh rechecks after its second provider await too", () => { assert.equal(secondWait.status, 403); assert.equal(calls.providerCalls.length, 2); assert.equal(calls.updates.length + calls.audits.length, 0); assert.equal(secondBody.operation_outcome, "unconfirmed"); });
reset(); rows = { existingDefault: null, byId: fixtureRow() }; authority.onDomainRead = () => { authority.activeTenant = "tenant-2"; };
const listScope = await post({ verb: "list" }); const listBody = await listScope.json();
ok("list never returns stale workspace details after scope changes during read", () => { assert.equal(listScope.status, 403); assert.equal(listBody.domains, undefined); noEffects(); });
reset(); rows = { existingDefault: null, byId: fixtureRow() }; authority.onProvider = () => { authority.throwRole = true; };
const transportAfterEffect = await post({ verb: "remove", id: "dom-2" }); const transportBody = await transportAfterEffect.json();
ok("authority transport failure after provider attempt remains explicitly uncertain", () => { assert.equal(transportAfterEffect.status, 503); assert.equal(transportBody.operation_outcome, "unconfirmed"); assert.equal(calls.deletes.length + calls.audits.length, 0); });
reset(); rows = { existingDefault: null, byId: null }; authority.platformOwner = true; authority.role = "member";
const platformList = await post({ verb: "list", tenant_id: "tenant-2" });
ok("existing platform-owner exception remains unchanged", () => assert.equal(platformList.status, 200));

console.log(`\n${passed} PASS / ${failed} FAIL (provider calls are local substitutes; zero network).`);
process.exit(failed === 0 ? 0 : 1);
