import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { incumbentSourcePaths, matchesIncumbentDeclaration, validateIncumbentResourceBindings } from './c0b-incumbent-resource-binding.mjs';

const chat = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
const sources = new Map(incumbentSourcePaths.map(path => [path, readFileSync(path, 'utf8')]));
const controlTransportPath = 'supabase/functions/_shared/paige-turn/control-transport.ts';
const reminderApprovalPath = 'supabase/functions/_shared/planning/approved-reminder.ts';
// Exercise the actual admission consumer. The validator's tools map retains
// diagnostic progress; findings, rather than an empty map, invalidate admission.
const consumerSource = ts.createSourceFile('registry-lint.mjs', readFileSync('scripts/ci/paige-spine-registry-lint.mjs', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const consumer = consumerSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'provenIncumbentSymbol');
assert.ok(consumer, 'the incumbent admission consumer must exist');
const admit = proof => new Function('incumbentProof', 'matchesIncumbentDeclaration', `return (${consumer.getText(consumerSource)});`)(proof, matchesIncumbentDeclaration);
const baseline = validateIncumbentResourceBindings(chat, sources);
const [tool, spec] = baseline.tools.entries().next().value;
const capability = { key: spec.key, action: { ...spec, chatTool: tool }, selfDescribe: spec.selfDescribe,
  readiness: spec.readiness, chatBinding: 'LIVE', mindBinding: 'UNAVAILABLE', maturity: 'PARTIAL' };
const changes = [
  ['Calendar caller authentication', 'supabase/functions/_shared/calendar-booking-read.ts', 'deps.caller.auth.getUser()', 'Promise.resolve({ data: { user: { id: origin.actorId } }, error: null })'],
  ['SOLO classification', 'supabase/functions/_shared/solo-classification.ts', '!c.parent_tenant_id && c.account_type === "standalone"', 'true'],
  ['Calendar read declaration', 'supabase/functions/_shared/paige-spine/domains/calendar_booking.ts', 'effect: "read"', 'effect: "mutation"'],
  ['native Team authority source', 'supabase/functions/_shared/paige-spine/domains/teamAuthorityChatEvidence.ts', 'client.rpc("get_team_authority_readiness", {})', 'client.rpc("counterfeit_team_authority", {})'],
  ['Task fresh authority callback', 'supabase/functions/_shared/operations-task-read.ts', 'deps.revalidateScope(abort.signal)', 'Promise.resolve(true)'],
  ['Task final native authority read', 'supabase/functions/_shared/operations-task-read.ts', 'const final = decode(await read());', 'const final = first;'],
  ['personal mailbox owner policy', 'supabase/functions/_shared/inbox-intelligence/policy.ts', 'query.mailbox.mailbox_owner_user_id !== query.callerUserId', 'false'],
  ['final email sender freshness', 'supabase/functions/send-message/index.ts', 'await assertCurrentEmailSender();', 'void 0;'],
  ['closed-read declaration authority', 'supabase/functions/_shared/paige-turn/interactive.ts', 'action?.classification === "read" && action.riskPolicyKey === "read_only" && action.approvalAuthority === "none"', 'true'],
  ['closed-read effect contradiction refusal', 'supabase/functions/_shared/paige-turn/interactive.ts', '!readHasEffectContradiction(r) && declaresClosedRead(tool, spine)', 'declaresClosedRead(tool, spine)'],
  ['control-body byte-limit refusal', controlTransportPath, 'if (length + value.byteLength > CHAT_CONTROL_MAX_BODY_BYTES)', 'if (false)'],
  ['reminder fresh acknowledgement runtime binding', reminderApprovalPath, "data.status === 'adopted' && (!hasRequestRuntime || data.work_status !== 'claimed')", "data.status === 'adopted' && data.work_status !== 'claimed'"],
  ['reminder exact stored argument identity', reminderApprovalPath, '!returnedArgs || !equalArgs(args, returnedArgs)', '!returnedArgs'],
  ['original reminder succeeded-only history observation', 'supabase/functions/_shared/planning/original-reminder-outcome.ts', "if (resolved.state !== 'succeeded')", 'if (false)'],
  ['original reminder canonical-card tenant binding', 'supabase/functions/_shared/paige-turn/interactive-reminder-history.ts', 'row.tenant_id !== tenantId', 'false'],
];

test('reviewed Calendar, Task, email, reminder and read-receipt context binds all incumbent adapters without replacing their contracts', () => {
  assert.equal(incumbentSourcePaths.length, 114);
  assert.ok(incumbentSourcePaths.includes(controlTransportPath), 'bounded control reader must remain a restrictive ancestry input');
  for (const [, path] of changes) assert.ok(incumbentSourcePaths.includes(path));
  assert.deepEqual(baseline.findings, []);
  assert.equal(baseline.tools.size, 29);
  assert.equal(admit(baseline)(capability, 'executor', spec.executor), true);
});

for (const [label, path, before, after] of changes) {
  test(`refuses changed ${label} before admitting incumbent adapters`, () => {
    const original = sources.get(path);
    assert.equal(original.split(before).length - 1, 1, 'negative must change exactly one actual authority expression');
    const changed = new Map(sources);
    changed.set(path, original.replace(before, after));
    const result = validateIncumbentResourceBindings(chat, changed);
    assert.deepEqual(result.findings, [`incumbent reviewed source changed: ${path}`]);
    assert.equal(admit(result)(capability, 'executor', spec.executor), false);
  });
}
