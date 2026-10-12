// Layer C end-to-end proof: one governed native vertical, through the PRODUCTION function files.
//
// INT-179 Platform Reach, Gate 1. Every orchestration test before this one drove the engine against
// fakes. This proof runs the two deployed edge functions themselves:
//   supabase/functions/paige-native-event-dispatch/index.ts   (the native-event drainer)
//   supabase/functions/execute-approval/index.ts              (the one approve door)
// unmodified, under Deno, against the CI Supabase stack (every migration replayed, PostgREST and Auth
// running). Nothing is mocked between the HTTP request and Postgres: the claim, the subject-tenant
// check, resolve_automation_autonomy, the Gateway, decideGovernedExecution, the native adapter's
// set_journey_stage write and its correlation readback, the monotonic ledger RPC, the approval mint,
// the receipt and the Rail are all the real code and the real database contracts.
//
// Each scenario is its own synthetic standalone (SOLO) workspace, provisioned through the canonical
// provision_tenant_as, with its owner a real Auth user. A contact is inserted for real, so the
// AFTER INSERT trigger writes the contact.created event. The trigger's best-effort HTTP fire is a
// no-op here (no vault project_url), so the proof POSTs the event to the drainer exactly as the
// recovery sweeper would.
//
//   A  auto lane        → executed; one stage transition stamped with the act's correlation ref; the
//                         contact's stage re-read from clients; one capability receipt; one Rail entry;
//                         the delivery and the event both done.
//   A' replay           → a second POST of the same event is not claimed; nothing new is written.
//   A" re-drive         → the event is put back to pending (a lost acknowledgement): the drainer runs
//                         the whole engine again and still writes no second effect, receipt or Rail.
//   A* duplicate        → eight concurrent POSTs of a fresh event: exactly one claims it; one ledger row,
//                         one effect, one receipt, one Rail entry.
//   B  confirm lane     → approval_pending, one companion approval, no effect. Then:
//        - an owner of ANOTHER workspace approves  → 403, nothing redeemed;
//        - a plain member of this workspace approves → 403, nothing redeemed;
//        - the owner of another workspace, seated here as a plain member, approves → refused by the
//          governed gate (governed_capability_not_for_tier), nothing redeemed;
//        - the owner approves → executed, one transition, the approval stamped approved;
//        - the owner approves again → already approved, no second effect.
//   E  revoked after the hold (§68): the process paused, turned off, or the platform ceiling at 0 →
//                         the owner's approval does not run it and it stays pending; restored, the same
//                         approval runs it once.
//   C  off lane         → held_by_lane, no effect, no approval.
//   D  wrong subject    → an event that claims workspace D but whose subject belongs to workspace A
//                         fails the integrity check: no ledger row, no effect, nothing in A touched.
//
// Disposable databases only: the CI Supabase stack (CI=true, 127.0.0.1:54322), or a local stack named
// with LAYER_C_E2E_DISPOSABLE=1. Fixture rows are committed (the drainer runs in other sessions) and
// every synthetic workspace is retired at the end. The trust-compass setting is platform-wide, so its
// prior value is saved and restored, and the proof's passing canary is deleted. A cleanup failure fails
// the run. The run exits 1 past LAYER_C_E2E_TIMEOUT_MS (180s).
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { retireSyntheticTenantSQL } from "./operator-postgres-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dbUrl = new URL(process.env.LAYER_C_E2E_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
assert.ok(
  (process.env.CI === "true" && dbUrl.hostname === "127.0.0.1" && dbUrl.port === "54322" && dbUrl.pathname === "/postgres")
    || process.env.LAYER_C_E2E_DISPOSABLE === "1",
  "Disposable test database required (the CI Supabase stack, or LAYER_C_E2E_DISPOSABLE=1 for a local throwaway stack)",
);
const API_URL = process.env.LAYER_C_E2E_API_URL ?? "http://127.0.0.1:54321";
assert.ok(new URL(API_URL).hostname === "127.0.0.1", "the API must be the local stack");
const psqlBin = process.env.PSQL_BIN || "psql";
const denoBin = process.env.DENO_BIN || "deno";
const RUN_TIMEOUT_MS = Number(process.env.LAYER_C_E2E_TIMEOUT_MS ?? 180000);

const sql = (text) => execFileSync(psqlBin, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", dbUrl.toString()], {
  input: text, encoding: "utf8", timeout: 30000, killSignal: "SIGKILL",
}).trim();
const one = (text) => sql(text).split("\n").filter(Boolean).at(-1) ?? "";
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

// The local stack's keys. `supabase status` prints the shared local-development defaults; they never
// leave this machine and are not secrets of any real project.
function stackKeys() {
  if (process.env.LAYER_C_E2E_SERVICE_ROLE_KEY && process.env.LAYER_C_E2E_ANON_KEY) {
    return { service: process.env.LAYER_C_E2E_SERVICE_ROLE_KEY, anon: process.env.LAYER_C_E2E_ANON_KEY };
  }
  const supabaseBin = process.env.SUPABASE_BIN || "supabase";
  const out = execFileSync(supabaseBin, ["status", "-o", "json"], { cwd: root, encoding: "utf8", timeout: 60000 });
  const status = JSON.parse(out.slice(out.indexOf("{")));
  assert.ok(status.SERVICE_ROLE_KEY && status.ANON_KEY, "supabase status did not report the local keys");
  return { service: status.SERVICE_ROLE_KEY, anon: status.ANON_KEY };
}
const keys = stackKeys();

const servers = [];
async function serve(fnDir, port) {
  // Network is limited to loopback: the function may listen on its port and reach the local stack, and
  // any other outbound call is refused by Deno (a caller that swallows its own errors would hide that
  // refusal, but cannot get through it). (Remote module downloads are governed separately by Deno's
  // import permission, so the esm.sh imports still resolve.)
  const child = spawn(denoBin, ["run", "--allow-env", "--allow-net=127.0.0.1", "--allow-read", `supabase/functions/${fnDir}/index.ts`], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    // Only variables that are actually set are passed on: an empty DENO_CERT makes Deno try to open a
    // CA file named "" and fail every TLS fetch, which is how the first CI run of this proof died.
    env: {
      ...Object.fromEntries(
        ["PATH", "HOME", "DENO_DIR", "DENO_CERT", "HTTPS_PROXY", "HTTP_PROXY"]
          .filter((k) => process.env[k])
          .map((k) => [k, process.env[k]]),
      ),
      NO_PROXY: "127.0.0.1,localhost",
      DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`,
      SUPABASE_URL: API_URL, SUPABASE_SERVICE_ROLE_KEY: keys.service, SUPABASE_ANON_KEY: keys.anon,
    },
  });
  let log = "";
  let spawnError = null;
  // Without this listener a missing Deno binary is an unhandled 'error' event that kills the process
  // before cleanup runs.
  child.on("error", (e) => { spawnError = e; log += String(e); });
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  servers.push(child);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    if (spawnError) throw new Error(`${fnDir} could not start: ${spawnError.message}`);
    if (child.exitCode !== null) throw new Error(`${fnDir} exited before listening:\n${log}`);
    if (log.includes("Listening on")) return { base, log: () => log };
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${fnDir} did not start listening:\n${log}`);
}

async function post(base, body, bearer) {
  const res = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function authUser(email) {
  const password = `Pw-${randomUUID()}`;
  const created = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: keys.service, Authorization: `Bearer ${keys.service}` },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await created.json();
  assert.ok(user?.id, `auth user not created: ${JSON.stringify(user)}`);
  const signed = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: keys.anon },
    body: JSON.stringify({ email, password }),
  });
  const session = await signed.json();
  assert.ok(session?.access_token, `sign-in failed: ${JSON.stringify(session)}`);
  return { id: user.id, jwt: session.access_token };
}

const tenants = [];
const users = [];

// A synthetic SOLO workspace through the canonical provisioning path, its owner a real Auth user.
async function workspace(label) {
  const owner = await authUser(`layer-c-${label}-${randomUUID().slice(0, 8)}@tests.invalid`);
  users.push(owner.id);
  const tenantId = one(`
    set role service_role;
    select (public.provision_tenant_as(${q(owner.id)}::uuid, ${q(`Layer C Proof ${label} ${randomUUID().slice(0, 6)}`)})).id;
  `);
  assert.match(tenantId, /^[0-9a-f-]{36}$/, `provisioning failed for ${label}`);
  tenants.push(tenantId);
  return { tenantId, owner };
}

// A §67 process record: one act, then the grant (an act write drops an auto grant to confirm, so the
// grant is set after the chain exists, the order a person or Paige follows).
function processRecord(tenantId, createdBy, lane, stageSlug) {
  const automationId = one(`
    insert into public.paige_automations (tenant_id, name, trigger_key, conditions, created_by, granted_lane, state)
    values (${q(tenantId)}, 'Welcome new contact', 'contact.created', '[]'::jsonb, ${q(createdBy)}, 'confirm', 'draft')
    returning id;
  `);
  sql(`insert into public.paige_automation_acts (automation_id, position, action_kind, config)
       values (${q(automationId)}, 1, 'crm.advance_journey_stage', jsonb_build_object('stage_slug', ${q(stageSlug)}));`);
  sql(`update public.paige_automations set granted_lane = ${q(lane)}, state = 'live' where id = ${q(automationId)};`);
  assert.equal(one(`select granted_lane || ':' || state from public.paige_automations where id = ${q(automationId)};`), `${lane}:live`);
  return automationId;
}

function newContact(tenantId, createdBy, firstName) {
  const contactId = one(`insert into public.clients (tenant_id, created_by, first_name, last_name, source) values (${q(tenantId)}, ${q(createdBy)}, ${q(firstName)}, 'Proof', 'manual') returning id;`);
  const eventId = one(`select id from public.paige_native_events where dedup_key = ${q(`contact.created:${contactId}`)};`);
  assert.match(eventId, /^[0-9a-f-]{36}$/, "the contact insert did not write a contact.created event");
  return { contactId, eventId };
}

const count = (text) => Number(one(text));
const ledger = (eventId) => {
  const row = one(`select row_to_json(x) from (select outcome::text, effective_lane, adapter_kind, capability_key, correlation_ref, refusal_code, id, dispatched_at is not null as dispatched, settled_at is not null as settled from public.paige_act_executions where event_id = ${q(eventId)}) x;`);
  return row ? JSON.parse(row) : null;
};
const evidence = (tenantId, contactId, ledgerId) => ({
  transitions: count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(contactId)};`),
  receipts: count(`select count(*) from public.paige_workspace_events where tenant_id = ${q(tenantId)} and source_kind = 'capability_run' and capability_key = 'crm_advance_journey_stage';`),
  rail: count(`select count(*) from public.paige_client_events where tenant_id = ${q(tenantId)} and event_kind = 'automation.completed'${ledgerId ? ` and ref_id = ${q(ledgerId)}` : ""};`),
});

let savedCompass = null;
let canaryRunId = null;
let servedLogs = () => "";
const results = [];
const step = (name, fn) => results.push({ name, fn });

async function main() {
  // Both functions must be listening BEFORE anything platform-wide is changed, so a start-up failure
  // leaves nothing behind.
  const drainer = await serve("paige-native-event-dispatch", 8791);
  const approver = await serve("execute-approval", 8792);
  servedLogs = () => `── drainer log ──\n${drainer.log().slice(-4000)}\n── execute-approval log ──\n${approver.log().slice(-4000)}`;

  // The trust compass is platform-wide. Rung 2 (auto) needs a fresh attestation and a passing operator
  // cross-tenant canary (§68); a plain replay has neither, so the default effective lane is confirm.
  savedCompass = one(`select coalesce(value::text, '') from public.admin_app_settings where key = 'paige_trust_compass';`);
  // The passing canary is the proof's own and is removed in cleanup: a fabricated passing isolation
  // check must not outlive the run and keep rung 2 satisfied for anything that runs after it.
  canaryRunId = one(`insert into public.paige_systems_check_run (tenant_id, scan_flavor, completed_at) values (null, 'scheduled', now()) returning id;`);
  sql(`
    insert into public.paige_systems_check_finding (run_id, check_id, tenant_id, status)
      values (${q(canaryRunId)}, 'operator_cross_tenant_canary', null, 'pass');
    update public.admin_app_settings set value = value || jsonb_build_object('ceiling', 2, 'attested_at', now()) where key = 'paige_trust_compass';
  `);

  // ── A: auto lane → one executed native effect with evidence ────────────────────────────────────
  const A = await workspace("auto");
  const aProcess = processRecord(A.tenantId, A.owner.id, "auto", "free_community");
  assert.equal(one(`select public.resolve_automation_autonomy(${q(aProcess)})->>'effective';`), "auto", "fixture: A must resolve to auto");
  const a = newContact(A.tenantId, A.owner.id, "Ada");

  step("A auto → executed with transition, canonical re-read, receipt, Rail, delivery and event done", async () => {
    const r = await post(drainer.base, { event_id: a.eventId }, keys.service);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.terminal, "done", JSON.stringify(r.json));
    assert.deepEqual(r.json.act_outcomes, { executed: 1 });
    const row = ledger(a.eventId);
    assert.equal(row.outcome, "executed");
    assert.equal(row.effective_lane, "auto");
    assert.equal(row.adapter_kind, "native");
    assert.equal(row.capability_key, "crm.advance_journey_stage");
    assert.ok(row.dispatched && row.settled, "dispatched_at and settled_at must both be set");
    assert.equal(count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(a.contactId)} and source_event = ${q(row.correlation_ref)} and to_stage_slug = 'free_community';`), 1);
    assert.equal(one(`select journey_stage_slug from public.clients where id = ${q(a.contactId)};`), "free_community", "canonical record re-read");
    assert.deepEqual(evidence(A.tenantId, a.contactId, row.id), { transitions: 1, receipts: 1, rail: 1 });
    assert.equal(one(`select status from public.paige_event_dispatches where event_id = ${q(a.eventId)};`), "done");
    assert.equal(one(`select processing_state from public.paige_native_events where id = ${q(a.eventId)};`), "done");
  });

  step("A' replay of a done event is not claimed and writes nothing", async () => {
    const before = evidence(A.tenantId, a.contactId);
    const r = await post(drainer.base, { event_id: a.eventId }, keys.service);
    assert.equal(r.status, 200);
    assert.equal(r.json.claimed, false);
    assert.deepEqual(evidence(A.tenantId, a.contactId), before);
    assert.equal(count(`select count(*) from public.paige_act_executions where event_id = ${q(a.eventId)};`), 1);
  });

  step("A\" re-drive after a lost acknowledgement re-runs the engine and writes no second effect", async () => {
    sql(`update public.paige_native_events set processing_state = 'pending', claimed_at = null where id = ${q(a.eventId)};`);
    const r = await post(drainer.base, { event_id: a.eventId }, keys.service);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.claimed, true, "the re-drive must actually run the engine");
    assert.equal(r.json.terminal, "done", JSON.stringify(r.json));
    assert.equal(ledger(a.eventId).outcome, "executed");
    assert.equal(count(`select count(*) from public.paige_act_executions where event_id = ${q(a.eventId)};`), 1);
    assert.deepEqual(evidence(A.tenantId, a.contactId), { transitions: 1, receipts: 1, rail: 1 });
  });

  step("A* eight concurrent deliveries of one event: exactly one claims it, one effect, receipt and Rail", async () => {
    const dup = newContact(A.tenantId, A.owner.id, "Grace");
    // Eight at once makes overlap at the claim likely; every outcome below would also hold if they had run
    // one after another, which is the point: duplicate delivery, concurrent or not, writes nothing twice.
    const rs = await Promise.all(Array.from({ length: 8 }, () => post(drainer.base, { event_id: dup.eventId }, keys.service)));
    assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.json)));
    assert.equal(rs.filter((r) => r.json.claimed === true).length, 1, JSON.stringify(rs.map((r) => r.json)));
    assert.equal(count(`select count(*) from public.paige_act_executions where event_id = ${q(dup.eventId)};`), 1);
    const row = ledger(dup.eventId);
    assert.equal(row.outcome, "executed");
    assert.equal(count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(dup.contactId)};`), 1);
    assert.equal(count(`select count(*) from public.paige_workspace_events where source_kind = 'capability_run' and detail->>'event_id' = ${q(dup.eventId)};`), 1);
    assert.equal(count(`select count(*) from public.paige_client_events where event_kind = 'automation.completed' and ref_id = ${q(row.id)};`), 1);
  });

  step("an unauthenticated or wrongly-keyed delivery is refused before any claim", async () => {
    const probe = newContact(A.tenantId, A.owner.id, "Linus");
    for (const bearer of ["", keys.anon, A.owner.jwt]) {
      const r = await post(drainer.base, { event_id: probe.eventId }, bearer);
      assert.equal(r.status, 401, `bearer ${bearer ? "present" : "absent"} must be refused`);
    }
    assert.equal(one(`select processing_state from public.paige_native_events where id = ${q(probe.eventId)};`), "pending");
    assert.equal(ledger(probe.eventId), null);
  });

  // ── B: confirm lane → held, then the approval door ─────────────────────────────────────────────
  const B = await workspace("confirm");
  processRecord(B.tenantId, B.owner.id, "confirm", "paid_tier");
  const member = await authUser(`layer-c-member-${randomUUID().slice(0, 8)}@tests.invalid`);
  users.push(member.id);
  sql(`insert into public.tenant_members (tenant_id, user_id, role, status, joined_at) values (${q(B.tenantId)}, ${q(member.id)}, 'member', 'active', now() - interval '1 day');`);
  const b = newContact(B.tenantId, B.owner.id, "Barbara");
  let approvalId = null;

  step("B confirm → approval_pending, one companion approval, no effect", async () => {
    const r = await post(drainer.base, { event_id: b.eventId }, keys.service);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.act_outcomes, { approval_pending: 1 });
    assert.equal(ledger(b.eventId).outcome, "approval_pending");
    assert.equal(ledger(b.eventId).effective_lane, "confirm");
    approvalId = one(`select id from public.paige_pending_approvals where source = 'paige_orchestration' and metadata->>'event_id' = ${q(b.eventId)} and status = 'pending';`);
    assert.match(approvalId, /^[0-9a-f-]{36}$/, "the held act must mint exactly one pending companion");
    assert.equal(count(`select count(*) from public.paige_pending_approvals where source = 'paige_orchestration' and metadata->>'event_id' = ${q(b.eventId)};`), 1);
    assert.deepEqual(evidence(B.tenantId, b.contactId), { transitions: 0, receipts: 0, rail: 0 });
  });

  step("B an owner of another workspace cannot approve it", async () => {
    const r = await post(approver.base, { approval_id: approvalId }, A.owner.jwt);
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.equal(r.json.error, "cross_tenant_forbidden");
    assert.equal(ledger(b.eventId).outcome, "approval_pending");
    assert.equal(one(`select status || ':' || (claimed_at is null) from public.paige_pending_approvals where id = ${q(approvalId)};`), "pending:true");
  });

  step("B a plain member of the workspace cannot approve it", async () => {
    const r = await post(approver.base, { approval_id: approvalId }, member.jwt);
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.equal(r.json.error, "forbidden");
    assert.equal(ledger(b.eventId).outcome, "approval_pending");
  });

  // The §59 global-role trap: the door's first check is the GLOBAL admin role, which every workspace
  // owner holds. The owner of workspace A, seated in B only as a plain member, passes that check and
  // the membership check; what B's own authority says about a plain member must still refuse.
  step("B the owner of another workspace, seated here as a plain member, cannot approve it", async () => {
    sql(`insert into public.tenant_members (tenant_id, user_id, role, status, joined_at) values (${q(B.tenantId)}, ${q(A.owner.id)}, 'member', 'active', now() - interval '1 day');`);
    try {
      const r = await post(approver.base, { approval_id: approvalId }, A.owner.jwt);
      // The door admits them (global admin + an active seat); the governed gate the executor re-runs for
      // the approver refuses, because a plain member is not owner-ops eligible for this capability.
      assert.equal(r.json.executed, false, JSON.stringify(r.json));
      assert.equal(r.json.reason, "governed_capability_not_for_tier", JSON.stringify(r.json));
      assert.equal(ledger(b.eventId).outcome, "approval_pending", JSON.stringify(r.json));
      assert.equal(count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(b.contactId)};`), 0);
      assert.equal(one(`select status || ':' || (claimed_at is null) from public.paige_pending_approvals where id = ${q(approvalId)};`), "pending:true");
    } finally {
      sql(`delete from public.tenant_members where tenant_id = ${q(B.tenantId)} and user_id = ${q(A.owner.id)};`);
    }
  });

  step("B the owner approves → executed with transition, receipt, Rail; approval stamped", async () => {
    const r = await post(approver.base, { approval_id: approvalId }, B.owner.jwt);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.equal(r.json.executed, true, JSON.stringify(r.json));
    const row = ledger(b.eventId);
    assert.equal(row.outcome, "executed");
    assert.equal(count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(b.contactId)} and source_event = ${q(row.correlation_ref)} and to_stage_slug = 'paid_tier';`), 1);
    assert.equal(one(`select journey_stage_slug from public.clients where id = ${q(b.contactId)};`), "paid_tier");
    assert.deepEqual(evidence(B.tenantId, b.contactId, row.id), { transitions: 1, receipts: 1, rail: 1 });
    // the receipt names the approver and this act, not just any capability run in the workspace
    assert.equal(one(`select actor_id || ':' || outcome || ':' || (detail->>'approved') from public.paige_workspace_events
      where tenant_id = ${q(B.tenantId)} and source_kind = 'capability_run' and detail->>'event_id' = ${q(b.eventId)};`),
      `${B.owner.id}:capability_succeeded:true`);
    assert.equal(one(`select status || ':' || (metadata->>'act_outcome') from public.paige_pending_approvals where id = ${q(approvalId)};`), "approved:executed");
  });

  step("B approving again is a no-op: no second effect", async () => {
    const r = await post(approver.base, { approval_id: approvalId }, B.owner.jwt);
    assert.equal(r.status, 200);
    assert.equal(r.json.executed, false);
    assert.equal(r.json.already, "approved");
    assert.deepEqual(evidence(B.tenantId, b.contactId), { transitions: 1, receipts: 1, rail: 1 });
  });

  // ── E: authority revoked after the hold (§68) → the approval does not run it; restored → it does ──
  const revocations = [
    { mode: "paused", reason: "process_not_live",
      revoke: (pid) => sql(`update public.paige_automations set state = 'paused' where id = ${q(pid)};`),
      restore: (pid) => sql(`update public.paige_automations set state = 'live' where id = ${q(pid)};`) },
    { mode: "off", reason: "process_lane_off",
      revoke: (pid) => sql(`update public.paige_automations set granted_lane = 'off' where id = ${q(pid)};`),
      restore: (pid) => sql(`update public.paige_automations set granted_lane = 'confirm' where id = ${q(pid)};`) },
    { mode: "ceiling 0", reason: "platform_observe_only",
      revoke: () => sql(`update public.admin_app_settings set value = value || jsonb_build_object('ceiling', 0) where key = 'paige_trust_compass';`),
      restore: () => sql(`update public.admin_app_settings set value = value || jsonb_build_object('ceiling', 2) where key = 'paige_trust_compass';`) },
  ];
  for (const rv of revocations) {
    const W = await workspace(`revoke-${rv.mode.replace(" ", "")}`);
    const pid = processRecord(W.tenantId, W.owner.id, "confirm", "paid_tier");
    const w = newContact(W.tenantId, W.owner.id, "Rev");
    step(`E ${rv.mode} after the hold: the approval does not run it; restored, the same approval does`, async () => {
      const r = await post(drainer.base, { event_id: w.eventId }, keys.service);
      assert.deepEqual(r.json.act_outcomes, { approval_pending: 1 }, JSON.stringify(r.json));
      const aid = one(`select id from public.paige_pending_approvals where source = 'paige_orchestration' and metadata->>'event_id' = ${q(w.eventId)};`);
      rv.revoke(pid);
      let refused;
      try {
        refused = await post(approver.base, { approval_id: aid }, W.owner.jwt);
      } finally {
        rv.restore(pid);
      }
      assert.equal(refused.status, 200, JSON.stringify(refused.json));
      assert.equal(refused.json.executed, false, JSON.stringify(refused.json));
      assert.equal(refused.json.reason, rv.reason, JSON.stringify(refused.json));
      // the approval surfaces show `error`: a plain sentence, never a raw code, saying the approval waits
      assert.ok(typeof refused.json.error === "string" && !/_/.test(refused.json.error), JSON.stringify(refused.json));
      assert.match(refused.json.error, /stays here for you to approve/, JSON.stringify(refused.json));
      assert.equal(ledger(w.eventId).outcome, "approval_pending");
      assert.equal(count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(w.contactId)};`), 0);
      assert.equal(one(`select status || ':' || (claimed_at is null) from public.paige_pending_approvals where id = ${q(aid)};`), "pending:true");
      const ran = await post(approver.base, { approval_id: aid }, W.owner.jwt);
      assert.equal(ran.json.executed, true, JSON.stringify(ran.json));
      assert.equal(ledger(w.eventId).outcome, "executed");
      assert.equal(count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(w.contactId)};`), 1);
    });
  }

  // ── C: off lane → held, nothing runs ───────────────────────────────────────────────────────────
  const C = await workspace("off");
  processRecord(C.tenantId, C.owner.id, "off", "paid_tier");
  const c = newContact(C.tenantId, C.owner.id, "Claude");
  step("C off → held_by_lane, no effect, no approval", async () => {
    const r = await post(drainer.base, { event_id: c.eventId }, keys.service);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.act_outcomes, { held_by_lane: 1 });
    assert.equal(ledger(c.eventId).outcome, "held_by_lane");
    assert.equal(count(`select count(*) from public.paige_pending_approvals where metadata->>'event_id' = ${q(c.eventId)};`), 0);
    assert.deepEqual(evidence(C.tenantId, c.contactId), { transitions: 0, receipts: 0, rail: 0 });
  });

  // ── D: an event whose subject belongs to another workspace ─────────────────────────────────────
  const D = await workspace("integrity");
  processRecord(D.tenantId, D.owner.id, "auto", "paid_tier");
  const victim = newContact(A.tenantId, A.owner.id, "Victim");
  // The victim's own event is retired so the only thing that could touch the victim is the forged one.
  sql(`update public.paige_native_events set processing_state = 'done' where id = ${q(victim.eventId)};`);
  const forgedEvent = one(`insert into public.paige_native_events (event_key, tenant_id, subject_table, subject_id, dedup_key, payload)
    values ('contact.created', ${q(D.tenantId)}, 'clients', ${q(victim.contactId)}, ${q(`proof-forged:${randomUUID()}`)}, '{}'::jsonb) returning id;`);
  step("D an event claiming workspace D for a contact in workspace A fails closed", async () => {
    const r = await post(drainer.base, { event_id: forgedEvent }, keys.service);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.terminal, "integrity_failed", JSON.stringify(r.json));
    // The specific refusal, not just any integrity failure: a lookup error would also read
    // integrity_failed and would prove nothing about the cross-workspace subject.
    assert.equal(r.json.event_integrity?.code, "subject_tenant_mismatch", JSON.stringify(r.json));
    assert.equal(r.json.subscriber_count, 0);
    assert.equal(ledger(forgedEvent), null);
    assert.equal(count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(victim.contactId)};`), 0);
    assert.equal(one(`select coalesce(journey_stage_slug, '(none)') from public.clients where id = ${q(victim.contactId)};`), "(none)");
    assert.equal(count(`select count(*) from public.paige_act_executions where tenant_id = ${q(D.tenantId)};`), 0);
  });

  let failed = 0;
  for (const { name, fn } of results) {
    try { await fn(); console.log(`ok   - ${name}`); }
    catch (e) { failed++; console.log(`FAIL - ${name}\n       ${e instanceof Error ? e.message : e}`); }
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) console.log("\n" + servedLogs());
  return failed;
}

// Returns false when anything could not be put back; the run then fails (a leftover synthetic workspace
// or a leftover passing canary is a defect, not a footnote).
let cleanupResult = null;
function cleanup() {
  // A second call (the timeout or an uncaught error racing the normal exit) returns the FIRST result rather
  // than reporting success for a cleanup that failed.
  if (cleanupResult !== null) return cleanupResult;
  cleanupResult = false;
  for (const s of servers) { try { s.kill("SIGKILL"); } catch { /* already gone */ } }
  // Each item is put back on its own, so one failure never skips the rest; any failure fails the run.
  let ok = true;
  const attempt = (label, fn) => {
    try { fn(); } catch (e) { ok = false; console.error(`cleanup failed (${label}): ${e instanceof Error ? e.message : e}`); }
  };
  if (canaryRunId) {
    attempt("canary", () => sql(`delete from public.paige_systems_check_finding where run_id = ${q(canaryRunId)};
         delete from public.paige_systems_check_run where id = ${q(canaryRunId)};`));
  }
  if (savedCompass !== null) {
    attempt("trust compass", () => sql(savedCompass
      ? `update public.admin_app_settings set value = ${q(savedCompass)}::jsonb where key = 'paige_trust_compass';`
      : `delete from public.admin_app_settings where key = 'paige_trust_compass';`));
  }
  for (const t of tenants) {
    attempt(`workspace ${t}`, () => {
      // The proof's own process records are removed while the workspace is still active. Retiring a
      // workspace that still holds a process with acts is blocked today: the deletion plan removes the
      // acts first, their change trigger updates the parent automation, and the archived-workspace
      // guard refuses that update (a latent lifecycle defect, reported separately, not worked around
      // by disabling any guard).
      sql(`delete from public.paige_automations where tenant_id = ${q(t)};`);
      // The deletion plan also refuses a workspace that holds journey-stage transitions (they need a
      // disposition it does not offer), so the proof removes the transitions it created itself.
      sql(`delete from public.paige_journey_stage_transitions where contact_id in (select id from public.clients where tenant_id = ${q(t)});`);
      sql(retireSyntheticTenantSQL(t));
    });
  }
  for (const u of users) attempt(`user ${u}`, () => sql(`delete from auth.users where id = ${q(u)};`));
  cleanupResult = ok;
  return ok;
}

const abort = (why) => {
  console.error(why);
  console.error(servedLogs());
  cleanup();
  process.exit(1);
};
const timer = setTimeout(() => abort(`timed out after ${RUN_TIMEOUT_MS}ms`), RUN_TIMEOUT_MS);
process.on("uncaughtException", (e) => abort(`uncaught: ${e instanceof Error ? e.stack : e}`));
process.on("unhandledRejection", (e) => abort(`unhandled rejection: ${e instanceof Error ? e.stack : e}`));
let exitCode = 1;
try {
  exitCode = (await main()) === 0 ? 0 : 1;
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
} finally {
  clearTimeout(timer);
  if (!cleanup()) exitCode = 1;
}
process.exit(exitCode);
