import assert from "node:assert/strict";
import { setScenario, createClient } from "./knowledge-scope/fake-supabase.mjs";
import { capturedHandler } from "./knowledge-scope/stub-serve.mjs";

// Run the unchanged served CRM handler through the existing Deno/Supabase module-boundary
// harness. Real schema, canonicalization, Gateway, subject and fingerprint code execute.
// Database responses are protected fixtures, not proof of production persistence or SQL ACLs.
globalThis.Deno = { env: { get: key => ({
  SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
})[key] ?? "" } };
globalThis.fetch = async () => { throw new Error("No network is permitted in this proof."); };
await import("../supabase/functions/crm-command/index.ts");
const handler = capturedHandler();
const { confirmFingerprint } = await import("../supabase/functions/_shared/confirm-fingerprint.ts");
const { CRM_ACTION_CAPABILITY, crmApprovalSubject } = await import("../supabase/functions/_shared/crm-command/catalog.ts");

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), tenant = id(2);
let claimReadError=false;
let claimAcknowledgementLost=false;
const queryPrototype=Object.getPrototypeOf(createClient('https://test.supabase.co','test-service').from('paige_pending_confirmations'));
const originalSingle=queryPrototype.maybeSingle;
queryPrototype.maybeSingle=async function(){
 const isClaim=this._table==='paige_pending_confirmations'&&this._filters.some(([op,columns])=>op==='select'&&columns==='args');
 if(isClaim&&(claimReadError||claimAcknowledgementLost)){
  // The latter executes the real handler's claim port before discarding its acknowledgement.
  // This models a committed claim with a lost response, not a real PostgreSQL transaction.
  if(claimAcknowledgementLost)await originalSingle.call(this);else this._record(true);
  return {data:null,error:{message:'fixture claim acknowledgement unavailable'}};
 }
 return originalSingle.call(this);
};
const task = title => ({ action: "task.create", patch: { title, assignee_user_id: actor } });
const deal = title => ({ action: "deal.create", title, pipeline_id: id(4), stage_id: id(5), unlinked_reason: "anonymous_prospect" });
const proposals = rec => rec.inserts.filter(row => row.table === "paige_pending_confirmations" && !row.update);
const executions = rec => rec.rpc.filter(call => call.name === "execute_crm_command");

function matches(row, filters) {
  return filters.every(([op, key, value, last]) => {
    if (op === "eq" || op === "is") return (row[key] ?? null) === value;
    if (op === "neq") return row[key] !== value;
    if (op === "not" && value === "is" && last === null) return row[key] != null;
    if (op === "gt") return row[key] > value;
    return true;
  });
}

function scenario({ workspace = tenant, userId = actor, role = "owner", lane = "confirm", stored, cached = false,
  accountType = "standalone", parentTenantId = null, claimError = false, cachedError = null, competingClaim = false,
  lostClaimAcknowledgement = false } = {}) {
  claimReadError = claimError;
  claimAcknowledgementLost = lostClaimAcknowledgement;
  let rec;
  rec = setScenario({
    authUser: { id: userId },
    tables: {
      tenant_members: filters => matches({ tenant_id: workspace, user_id: userId, status: "active" }, filters)
        ? [{ role, status: "active" }] : [],
      tenants: [{ account_type: accountType, account_number: "101", parent_tenant_id: parentTenantId }],
      paige_pending_confirmations: filters => {
        if (filters.some(([op, columns]) => op === "select" && columns === "args")) {
          // A competing request can redeem after this handler's original-result
          // read returned null, while its domain write has not committed yet.
          if (competingClaim && stored) stored.consumed_at = new Date().toISOString();
          if (!stored || !matches(stored, filters)) return [];
          const args = stored.args;
          stored.consumed_at = new Date().toISOString();
          return [{ args }];
        }
        const inserted = proposals(rec).at(-1)?.row;
        return inserted ? [{ ...inserted, expires_at: new Date(Date.now() + 300_000).toISOString() }] : [];
      },
    },
    rpcs: {
      current_user_tenant_id: { data: workspace, error: null },
      read_crm_command_result: { data: cached ? { ok: true, outcome: "succeeded", readback: { id: id(6) } } : null, error: cachedError },
      resolve_tool_autonomy: { data: lane, error: null },
      execute_crm_command: { data: { ok: true, outcome: "succeeded", readback: { id: id(6) } }, error: null },
    },
  });
  return rec;
}

async function request(command, { options, key = "test-approval-summary", expectedTenant = tenant, fingerprint } = {}) {
  const rec = scenario(options);
  const response = await handler(new Request("https://test.supabase.co/functions/v1/crm-command", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test-fixture" },
    body: JSON.stringify({ command, expected_tenant_id: expectedTenant, idempotency_key: key,
      ...(fingerprint ? { approved_fingerprint: fingerprint } : {}) }),
  }));
  return { rec, status: response.status, body: await response.json() };
}

let checks = 0;
async function proposed(command, expectedSummary, options = {}) {
  const result = await request(command, options);
  assert.equal(result.status, 202);
  assert.equal(result.body.outcome, "approval_required");
  assert.equal(result.body.summary, expectedSummary);
  assert.equal(executions(result.rec).length, 0, "proposing a summary cannot execute a command");
  const rows = proposals(result.rec);
  assert.equal(rows.length, 1, "one existing server-held proposal");
  const proposal = rows[0].row;
  const capability = CRM_ACTION_CAPABILITY[command.action];
  const expectedArgs = { command, idempotency_key: options.key ?? "test-approval-summary",
    approval_subject: await crmApprovalSubject(command.action, command) };
  assert.deepEqual(proposal.args, expectedArgs, "display formatting cannot rewrite the stored command or key");
  assert.equal(proposal.summary, expectedSummary);
  assert.equal(proposal.tool_name, capability);
  assert.equal(proposal.user_id, options.options?.userId ?? actor);
  assert.equal(proposal.tenant_id, options.expectedTenant ?? tenant);
  assert.equal(proposal.fingerprint, await confirmFingerprint(capability, expectedArgs));
  assert.equal(result.body.fingerprint, proposal.fingerprint);
  assert.ok(proposal.server_issued_at && proposal.issued_in_request, "server-issued approval provenance remains");
  const audit = result.rec.inserts.find(row => row.table === "paige_audit_log").row;
  assert.equal(audit.payload.decision, "propose");
  assert.equal(audit.payload.risk, "ordinary");
  checks++;
  return { ...result, proposal };
}

const first = await proposed(task("Review the fixture plan"), 'Create a task "Review the fixture plan".');
await proposed({ ...task("Canonical task title"), title: "Unexecuted top-level decoy" }, 'Create a task "Canonical task title".');
await proposed(task("  Keep stored spacing  "), 'Create a task "Keep stored spacing".');
await proposed(task("x".repeat(100)), `Create a task "${"x".repeat(80)}".`);
for (const title of ["", "   ", 42, null]) await proposed(task(title), 'Create a task "Untitled".');
await proposed({ action: "task.create", patch: { assignee_user_id: actor } }, 'Create a task "Untitled".');
await proposed({ ...deal("Actual deal title"), patch: { title: "Unexecuted patch decoy" } }, 'Add a deal "Actual deal title" to the pipeline.');
await proposed(deal("y".repeat(100)), `Add a deal "${"y".repeat(80)}" to the pipeline.`);
await proposed({ action: "task.create", patch: { title: "Other eligible workspace", assignee_user_id: id(11) } }, 'Create a task "Other eligible workspace".', {
  expectedTenant: id(12), options: { workspace: id(12), userId: id(11), role: "admin" },
});
const progress={action:"task.update",task_id:id(6),expected_updated_at:"2026-10-10T12:00:00.123456Z",patch:{status:"in_progress"}};
const progressApproval=await proposed(progress,`Move task ${id(6)} to In progress.`);
await proposed({...progress,contact_id:id(8),company_id:id(9)},`Move task ${id(6)} to In progress.`);
await proposed({...progress,patch:{title:"Retained title",status:"in_progress",description:"Retained description"}},`Move task ${id(6)} to In progress. Also update description="Retained description", title="Retained title".`);
await proposed({...progress,patch:{description:"Existing description edit"}},`Update the task ${id(6)}.`);
const progressStored={...progressApproval.proposal,consumed_at:null,expires_at:new Date(Date.now()+300_000).toISOString()};
const progressApproved=await request({...progress,patch:{status:"in_progress",description:"Unapproved substitution"}},{fingerprint:progressStored.fingerprint,options:{stored:progressStored}});
assert.equal(progressApproved.status,200);assert.equal(executions(progressApproved.rec).length,1);
assert.deepEqual(executions(progressApproved.rec)[0].args._command,{...progress,approval_channel:"operator_card"},"progress approval executes only its exact stored status/version, not substituted request fields");
checks++;

// Round-trip the exact server-issued proposal, while the request tries to substitute a title.
// The fixture answers only the SQL boundary; this proves stored-command routing, not a real task.
const freshStored = () => ({ ...first.proposal, consumed_at: null, expires_at: new Date(Date.now() + 300_000).toISOString() });
const stored = freshStored();
const approved = await request(task("Substituted request title"), { fingerprint: stored.fingerprint, options: { stored } });
assert.equal(approved.status, 200);
assert.equal(executions(approved.rec).length, 1);
assert.deepEqual(executions(approved.rec)[0].args._command, {
  ...first.proposal.args.command, approval_channel: "operator_card",
}, "only the existing server-owned approval channel is added to the stored command");
assert.equal(executions(approved.rec)[0].args._idempotency_key, first.proposal.args.idempotency_key);
assert.equal(executions(approved.rec)[0].args._tenant_id, tenant);
assert.equal(executions(approved.rec)[0].args._actor_id, actor);
assert.ok(stored.consumed_at, "the existing atomic-claim path consumes the stored proposal");
assert.equal(proposals(approved.rec).length, 0);
const taskLocator = {
  surface: "operations", tab: "work", record_id: id(6),
  surface_url: "https://paigeagent.ai/solo/101/operations/work",
  deep_link: null, deep_link_status: "surface_only",
};
assert.deepEqual(approved.body.record_locator, taskLocator, "fresh task result opens its existing native work owner without a made-up task query");
checks++;

const replay = await request(first.proposal.args.command, { options: { cached: true } });
assert.equal(replay.status, 200);
assert.deepEqual(replay.body.record_locator, taskLocator, "cached success must retain the same native task locator");
assert.equal(executions(replay.rec).length, 0, "completed result replay is readback, not another task");
assert.equal(proposals(replay.rec).length, 0, "completed result does not propose another approval");
assert.equal(replay.rec.rpc.filter(call => call.name === "resolve_tool_autonomy").length, 0);
checks++;

for (const [options, tree] of [
  [{ accountType: "agency" }, "agency"],
  [{ parentTenantId: id(8) }, "business"],
]) {
  const otherTier = await request(first.proposal.args.command, { options: { ...options, lane: "auto" } });
  assert.equal(otherTier.status, 200);
  assert.equal(executions(otherTier.rec).length, 1);
  assert.deepEqual(otherTier.body.record_locator, {
    ...taskLocator, surface: "command-center", tab: "tasks",
    surface_url: `https://paigeagent.ai/${tree}/101/calendar/tasks`,
  }, "non-Solo task locator routing and metadata remain unchanged");
  checks++;
}

// Wrong actor/workspace and reused or forged tokens cannot redeem the original approval.
for (const options of [
  { userId: id(11) }, { workspace: id(12) }, {},
]) {
  const denied = await request(task("Unapproved replacement"), {
    expectedTenant: options.workspace ?? tenant, fingerprint: stored.fingerprint,
    options: { ...options, stored: options.userId || options.workspace ? freshStored() : stored },
  });
  assert.equal(denied.status, 503);
  assert.equal(denied.body.code, "CRM_APPROVAL_UNCONFIRMED");
  assert.equal(proposals(denied.rec).length, 0);
  assert.equal(executions(denied.rec).length, 0);
  checks++;
}
const forged = await request(task("Unapproved replacement"), { fingerprint: "0123456789abcdef", options: { stored: freshStored() } });
assert.equal(forged.status, 503);
assert.equal(forged.body.code, "CRM_APPROVAL_UNCONFIRMED");
assert.equal(proposals(forged.rec).length, 0);
assert.equal(executions(forged.rec).length, 0);
checks++;

// A supplied approval is a deliberate claim, not permission to fall back to
// either fresh proposal or standing autonomy when the native claim is unavailable.
for(const lane of ['confirm','auto']){
 for(const state of ['missing','consumed','expired','unissued','unrequested','foreign-actor','foreign-tenant','forged']){
  const pending=freshStored();
  if(state==='consumed')pending.consumed_at=new Date().toISOString();
  if(state==='expired')pending.expires_at=new Date(Date.now()-1000).toISOString();
  if(state==='unissued')pending.server_issued_at=null;
  if(state==='unrequested')pending.issued_in_request=null;
  if(state==='foreign-actor')pending.user_id=id(99);
  if(state==='foreign-tenant')pending.tenant_id=id(99);
  const result=await request(first.proposal.args.command,{fingerprint:state==='forged'?'0123456789abcdef':pending.fingerprint,options:{lane,stored:state==='missing'?null:pending}});
  assert.equal(result.status,503,`failed explicit claim ${state}/${lane}`);
  assert.equal(result.body.code,'CRM_APPROVAL_UNCONFIRMED');
  assert.equal(result.body.outcome,'refused');assert.equal(result.body.outcome_unknown,true);assert.equal(result.body.refused_before_run,false);assert.match(result.body.message,/original|record/i);
  assert.equal(executions(result.rec).length,0);assert.equal(proposals(result.rec).length,0);
  const audit=result.rec.inserts.find(row=>row.table==='paige_audit_log');assert.equal(audit.row.payload.decision,'refuse');
  checks++;
 }
 const uncertain=await request(first.proposal.args.command,{fingerprint:first.proposal.fingerprint,options:{lane,stored:freshStored(),claimError:true}});
 assert.equal(uncertain.status,503);assert.equal(uncertain.body.code,'CRM_APPROVAL_UNCONFIRMED');
 assert.equal(executions(uncertain.rec).length,0);assert.equal(proposals(uncertain.rec).length,0);checks++;
}
const validAuto=await request(first.proposal.args.command,{fingerprint:first.proposal.fingerprint,options:{lane:'auto',stored:freshStored()}});
assert.equal(validAuto.status,200);assert.equal(executions(validAuto.rec).length,1);assert.equal(proposals(validAuto.rec).length,0);checks++;
const deniedRoleApproval=await request(first.proposal.args.command,{fingerprint:first.proposal.fingerprint,options:{role:'staff',stored:freshStored()}});
assert.equal(deniedRoleApproval.status,403);assert.equal(deniedRoleApproval.body.code,'access_denied');assert.equal(executions(deniedRoleApproval.rec).length,0);assert.equal(proposals(deniedRoleApproval.rec).length,0);checks++;
const exactReplay=await request(first.proposal.args.command,{fingerprint:first.proposal.fingerprint,options:{stored,cached:true}});
assert.equal(exactReplay.status,200);assert.equal(executions(exactReplay.rec).length,0);assert.equal(proposals(exactReplay.rec).length,0);
assert.equal(exactReplay.rec.from.some(row=>row.table==='paige_pending_confirmations'),false,'exact original result precedes a second claim');checks++;
const uncertainOriginal=await request(first.proposal.args.command,{fingerprint:first.proposal.fingerprint,options:{stored:freshStored(),cachedError:{message:'fixture original result unavailable'}}});
assert.equal(uncertainOriginal.status,503);assert.equal(executions(uncertainOriginal.rec).length,0);assert.equal(proposals(uncertainOriginal.rec).length,0);
assert.equal(uncertainOriginal.rec.from.some(row=>row.table==='paige_pending_confirmations'),false,'uncertain original readback never consumes or retries');checks++;

for (const [command, options, status, code] of [
  [{ action: "task.create", title: "Top-level title alone" }, {}, 400, "CRM_COMMAND_INVALID"],
  [{ ...deal("Title"), title: undefined, patch: { title: "Patch is not a deal title" } }, {}, 400, "CRM_COMMAND_INVALID"],
  [task("Denied role"), { options: { role: "staff" } }, 403, "access_denied"],
  [task("Wrong workspace"), { expectedTenant: id(12) }, 409, "CRM_ACTIVE_ACCOUNT_CHANGED"],
]) {
  const refused = await request(command, options);
  assert.equal(refused.status, status);
  assert.equal(refused.body.code, code);
  assert.equal(proposals(refused.rec).length, 0);
  assert.equal(executions(refused.rec).length, 0);
  assert.equal(refused.body.record_locator, undefined);
  checks++;
}
for (const lane of ['confirm', 'auto']) {
  const competing = freshStored();
  const losing = await request(first.proposal.args.command, {
    fingerprint: competing.fingerprint, options: { lane, stored: competing, competingClaim: true },
  });
  assert.ok(competing.consumed_at, 'another request consumed after the result read and before this claim');
  assert.equal(losing.status, 503, 'an empty losing claim cannot prove the original action absent');
  assert.equal(losing.body.code, 'CRM_APPROVAL_UNCONFIRMED');
  assert.equal(losing.body.outcome_unknown, true);
  assert.equal(losing.body.refused_before_run, false);
  assert.equal(executions(losing.rec).length, 0);
  assert.equal(proposals(losing.rec).length, 0);
  const completed = await request(first.proposal.args.command, {
    fingerprint: competing.fingerprint, options: { lane, stored: competing, cached: true },
  });
  assert.equal(completed.status, 200, 'a later canonical result resolves the original action');
  assert.equal(executions(completed.rec).length, 0);
  assert.equal(proposals(completed.rec).length, 0);
  checks++;
  const lostStored = freshStored();
  const lostAck = await request(first.proposal.args.command, {
    fingerprint: lostStored.fingerprint, options: { lane, stored: lostStored, lostClaimAcknowledgement: true },
  });
  assert.ok(lostStored.consumed_at, 'the claim port consumed its row before the acknowledgement disappeared');
  assert.equal(lostAck.status, 503);
  assert.equal(lostAck.body.code, 'CRM_APPROVAL_UNCONFIRMED');
  assert.equal(lostAck.body.outcome_unknown, true);
  assert.equal(lostAck.body.refused_before_run, false);
  assert.equal(executions(lostAck.rec).length, 0);
  assert.equal(proposals(lostAck.rec).length, 0);
  const retryLostAck = await request(first.proposal.args.command, {
    fingerprint: lostStored.fingerprint, options: { lane, stored: lostStored },
  });
  assert.equal(retryLostAck.status, 503, 'an already-consumed uncertain claim is not a fresh authorization');
  assert.equal(retryLostAck.body.outcome_unknown, true);
  assert.equal(executions(retryLostAck.rec).length, 0);
  assert.equal(proposals(retryLostAck.rec).length, 0);
  checks++;
}
// A Gateway refusal is authoritative about this request's permission, but an
// empty explicit claim still cannot rule out a competing original execution.
for (const [lane, code] of [['off', 'autonomy_off'], ['unresolved', 'autonomy_lane_unrecognized']]) {
  const competing = freshStored();
  const losing = await request(first.proposal.args.command, {
    fingerprint: competing.fingerprint, options: { lane, stored: competing, competingClaim: true },
  });
  assert.ok(competing.consumed_at);
  assert.equal(losing.status, 403, 'retain the original Gateway refusal status');
  assert.equal(losing.body.code, code, 'retain the original Gateway refusal code');
  assert.equal(losing.body.outcome_unknown, true, 'a Gateway refusal cannot prove the competing original absent');
  assert.equal(losing.body.refused_before_run, false);
  assert.equal(executions(losing.rec).length, 0);
  assert.equal(proposals(losing.rec).length, 0);
  checks++;
  const ordinary = await request(first.proposal.args.command, { options: { lane } });
  assert.equal(ordinary.status, 403);
  assert.equal(ordinary.body.code, code);
  assert.equal(ordinary.body.message, losing.body.message, 'preserve the Gateway explanation');
  assert.equal(ordinary.body.outcome_unknown, undefined, 'an ordinary refusal has no failed explicit claim');
  assert.equal(ordinary.body.refused_before_run, undefined);
  assert.equal(executions(ordinary.rec).length, 0);
  assert.equal(proposals(ordinary.rec).length, 0);
  checks++;
}
queryPrototype.maybeSingle=originalSingle;
console.log(`PASS ${checks} actual CRM approval-summary checks: canonical task/deal titles and task locators, unchanged stored arguments/fingerprints, approval claim and tenant/actor/refusal negatives`);
