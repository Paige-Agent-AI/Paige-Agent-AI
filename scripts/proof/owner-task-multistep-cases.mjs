import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Extends the original disposable native harness. No alternate runner or writer.
export function proveOwnerTaskMultistep({ sql, text, draft, control, controlReview, native, actor, tenant,
  check, refuses, literal, json, approve, claim, bridge, resultCount, multistepMetadataBefore }) {
  const sequence = (sameArguments = false) => {
    const first = draft(), second = randomUUID(), contact = randomUUID();
    const config = sameArguments ? { title: "Review the new contact" }
      : { title: "Review the delivery handoff", description: "Prepare the next internal responsibility." };
    sql(`insert into paige_automation_acts(id,automation_id,position,action_kind,config)
      values('${second}','${first.process}',2,'owner.task',${json(config)});`);
    control(first.process, "arm");
    sql(`insert into clients(id,tenant_id,first_name,last_name,account_number,source)
      values('${contact}','${tenant}','Synthetic','Sequence','${contact}','test');`);
    const event = sql(`select id from paige_native_events where subject_id='${contact}';`);
    const steps = controlReview(first.process).acts.map(act => {
      const correlation = randomUUID();
      const row = native("paige_record_act_execution", [literal(event), literal(first.process), literal(act.id),
        String(act.position), literal(tenant), "'native'", "'owner.task'", "'confirm'", "'approval_pending'",
        "null", literal(correlation), literal(correlation), "null", json({ snapshot_args: act.config }), "null", "null", "null"]);
      return { process: first.process, event, act: act.id, correlation, row, config: act.config };
    });
    return { process: first.process, event, steps };
  };

  let pair;
  check("each original act captures its own bounded hold and companion approval in one two-step event", () => {
    pair = sequence();
    assert.equal(pair.steps.length, 2);
    for (const step of pair.steps) {
      assert.equal(step.row.detail.owner_task_source.acts.length, 2);
      assert.equal(step.row.act_id, step.act);
      assert.equal(sql(`select count(*)from paige_pending_approvals where metadata->>'act_execution_id'='${step.row.id}';`), "1");
      assert.equal(resultCount(step), "0");
    }
    assert.notEqual(pair.steps[0].row.id, pair.steps[1].row.id);
  });
  check("first-step approval cannot approve or execute the second step", () => {
    approve(pair.steps[0]); claim(pair.steps[0]);
    const result = bridge(pair.steps[1]);
    assert.equal(result.outcome, "failed");
    assert.equal(result.reason, "native_approval_required");
    assert.equal(resultCount(pair.steps[1]), "0");
    assert.equal(sql(`select status from paige_pending_approvals where metadata->>'act_execution_id'='${pair.steps[1].row.id}';`), "pending");
  });
  check("each approved and claimed step writes a distinct original Task and Rail receipt", () => {
    approve(pair.steps[1]); claim(pair.steps[1]);
    const results = pair.steps.map(step => bridge(step));
    for (const [index, result] of results.entries()) {
      assert.equal(result.state, "found");
      assert.equal(result.result.readback.title, pair.steps[index].config.title);
      assert.equal(result.result.readback.assignee_user_id, actor);
      assert.equal(result.result.receipt_recorded, true);
      assert.equal(resultCount(pair.steps[index]), "1");
      assert.equal(sql(`select count(*)from tasks where id='${result.result.readback.id}';`), "1");
      assert.equal(sql(`select count(*)from paige_workspace_events where source_id='${result.result.correlation_id}';`), "1");
    }
    assert.notEqual(results[0].result.readback.id, results[1].result.readback.id);
    assert.notEqual(results[0].result.correlation_id, results[1].result.correlation_id);
    pair.results = results;
  });
  check("lost acknowledgments recover each original result without duplicate Tasks or Rails", () => {
    const tasks = sql("select count(*)from tasks;"), rails = sql("select count(*)from paige_workspace_events;");
    for (const [index, step] of pair.steps.entries()) {
      assert.equal(bridge(step, true).result.readback.id, pair.results[index].result.readback.id);
      assert.equal(bridge(step).result.correlation_id, pair.results[index].result.correlation_id);
      assert.equal(resultCount(step), "1");
    }
    assert.equal(sql("select count(*)from tasks;"), tasks);
    assert.equal(sql("select count(*)from paige_workspace_events;"), rails);
  });
  check("identical step arguments still require distinct original step approvals and results", () => {
    const duplicate = sequence(true);
    const results = duplicate.steps.map(step => { approve(step); claim(step); return bridge(step); });
    assert.ok(results.every(result => result.state === "found"));
    assert.notEqual(results[0].result.readback.id, results[1].result.readback.id);
    assert.notEqual(results[0].result.correlation_id, results[1].result.correlation_id);
    assert.ok(duplicate.steps.every(step => resultCount(step) === "1"));
  });
  check("position does not invent a predecessor dependency or authorize an unapproved earlier step", () => {
    const independent = sequence();
    approve(independent.steps[1]); claim(independent.steps[1]);
    assert.equal(bridge(independent.steps[1]).state, "found");
    assert.equal(bridge(independent.steps[0]).reason, "native_approval_required");
    assert.equal(resultCount(independent.steps[0]), "0");
  });
  for (const change of ["pause", "later-step edit"]) check(`${change} refuses the pending step while preserving the landed first receipt`, () => {
    const interrupted = sequence(), [first, second] = interrupted.steps;
    approve(first); claim(first); const result = bridge(first);
    approve(second); claim(second);
    if (change === "pause") control(interrupted.process, "pause");
    else sql(`update paige_automation_acts set config='{"title":"Changed after review"}'where id='${second.act}';`);
    assert.equal(bridge(second).outcome, "failed");
    assert.equal(resultCount(second), "0");
    assert.equal(bridge(first, true).result.readback.id, result.result.readback.id);
    assert.equal(bridge(first).result.correlation_id, result.result.correlation_id);
    assert.equal(resultCount(first), "1");
  });
  check("a correlation from another step cannot confirm or execute this step", () => {
    const [first, second] = pair.steps;
    assert.equal(bridge({ ...second, correlation: first.correlation }, true).state, "unknown");
    assert.equal(bridge({ ...second, correlation: first.correlation }).reason, "native_approval_required");
    assert.equal(resultCount(second), "1");
  });
  check("an original act with the wrong recorded position is refused before a new hold or companion", () => {
    const second = pair.steps[1];
    assert.throws(() => native("paige_record_act_execution", [literal(pair.event), literal(pair.process), literal(second.act),
      "1", literal(tenant), "'native'", "'owner.task'", "'confirm'", "'approval_pending'", "null",
      literal(second.correlation), literal(second.correlation), "null", json({ snapshot_args: second.config }), "null", "null", "null"]),
    /OWNER_TASK_SOURCE_CHANGED/);
    assert.equal(sql(`select count(*)from paige_pending_approvals where metadata->>'act_execution_id'='${second.row.id}';`), "1");
  });
  for (const [label, position, config] of [
    ["position gap", 3, { title: "Next step" }],
    ["dynamic later title", 2, { title: "Review {{contact.name}}" }],
    ["external later argument", 2, { title: "Next step", to: "outside@example.invalid" }],
  ]) check(`${label} makes the complete reviewed chain unsupported`, () => {
    const x = draft();
    sql(`insert into paige_automation_acts(id,automation_id,position,action_kind,config)
      values('${randomUUID()}','${x.process}',${position},'owner.task',${json(config)});`);
    assert.throws(() => control(x.process, "arm"), /OWNER_TASK_CONTROL_UNSUPPORTED/);
    assert.equal(control(x.process, "pause").state, "paused");
  });
  check("twenty literal steps can be reviewed without creating any Task or receipt", () => {
    const x = draft();
    sql(`insert into paige_automation_acts(id,automation_id,position,action_kind,config)
      select gen_random_uuid(),'${x.process}',n,'owner.task',jsonb_build_object('title','Internal responsibility '||n)
      from generate_series(2,20) n;`);
    const tasks = sql("select count(*)from tasks;"), rails = sql("select count(*)from paige_workspace_events;");
    assert.equal(control(x.process, "arm").acts.length, 20);
    assert.equal(sql("select count(*)from tasks;"), tasks);
    assert.equal(sql("select count(*)from paige_workspace_events;"), rails);
  });
  for (const [accountType, parent, system] of [["agency", null, false], ["standalone", randomUUID(), false], ["company", null, false], ["standalone", null, true]]) {
    check(`new multi-step capability refuses ${accountType}/${parent ? "child" : system ? "system-workspace" : "top-level"} while preserving original single-step control`, () => {
      const x = draft();
      sql(`insert into paige_automation_acts(id,automation_id,position,action_kind,config)
        values('${randomUUID()}','${x.process}',2,'owner.task','{"title":"Next internal responsibility"}');
        update tenants set account_type=${literal(accountType)},parent_tenant_id=${literal(parent)},features=${json({ system_workspace: system })} where id='${tenant}';`);
      try {
        assert.throws(() => control(x.process, "arm"), /OWNER_TASK_CONTROL_UNSUPPORTED/);
        assert.equal(control(x.process, "pause").state, "paused");
        assert.equal(control(draft().process, "arm").state, "live");
      } finally { sql(`update tenants set account_type='standalone',parent_tenant_id=null,features='{}'where id='${tenant}';`); }
    });
  }
  for (const system of [false, true]) check(`${system ? "system-workspace" : "account-type"} eligibility change refuses the pending second effect while preserving the landed original receipt`, () => {
    const x = sequence(), [first, second] = x.steps;
    approve(first); claim(first); const result = bridge(first);
    approve(second); claim(second);
    const reclassify = system ? "features=" + json({ system_workspace: true }) : "account_type='company'";
    sql(`update tenants set ${reclassify} where id='${tenant}';`);
    try {
      assert.equal(bridge(second).outcome, "failed"); assert.equal(resultCount(second), "0");
      assert.equal(bridge(first, true).result.correlation_id, result.result.correlation_id);
    } finally { sql(`update tenants set account_type='standalone',features='{}'where id='${tenant}';`); }
    assert.equal(bridge(second).state, "found"); assert.equal(resultCount(second), "1");
  });
  const signatures = ["control_owner_task_automation(uuid,text,timestamptz,jsonb,jsonb)",
    "_owner_task_source_snapshot(uuid,uuid)", "paige_owner_task_hold_context()", "_read_owner_task_act(uuid,uuid,text)"];
  const catalog = () => JSON.parse(sql(`select jsonb_object_agg(p.oid::regprocedure::text,to_jsonb(p))from pg_proc p
    where p.oid in(${signatures.map(signature => literal("public." + signature) + "::regprocedure").join(",")});`));
  const after = catalog();
  check("forward repair preserves every original function identity, signature, default, owner and ACL", () => {
    assert.deepEqual(Object.fromEntries(Object.entries(after).map(([signature, { prosrc: _body, ...metadata }]) => [signature, metadata])), multistepMetadataBefore);
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(sql(`select has_function_privilege('${role}','public._owner_task_literal_chain_supported(jsonb)','EXECUTE');`), "f");
  });
  const forward = text("supabase/migrations/20271126080005_owner_task_multistep_review.sql");
  check("exact forward replay conserves native metadata and repaired source byte for byte", () => {
    sql(forward); assert.deepEqual(catalog(), after);
  });
  check("source and definer drift abort the entire forward transaction without relaxing its guards", () => {
    const body = forward.replace(/^begin;\s*/, "").replace(/\s*commit;\s*$/, "");
    for (const signature of signatures) {
      const definition = sql(`select pg_get_functiondef('public.${signature}'::regprocedure);`);
      assert.ok(definition.includes("AS $function$"));
      refuses("begin;" + definition.replace("AS $function$", "AS $function$-- unexpected source drift\n") + ";\n" + body + "rollback;", "OWNER_TASK_MULTISTEP_SOURCE_DRIFT");
      assert.deepEqual(catalog(), after);
    }
    refuses("begin;alter function public._read_owner_task_act(uuid,uuid,text)security invoker;" + body + "rollback;", "OWNER_TASK_MULTISTEP_SOURCE_DRIFT");
    assert.deepEqual(catalog(), after);
  });
  return { sequence, catalog };
}

/** Same native domain writer and original process/act, never a replacement draft. */
export async function proveOwnerTaskStepRevision({ sql, draft, control, controlReview, check, tenant, actor, other,
  controlStatement, runControlAttempt, text, revisionSql, beforeRevision, sequence, catalog, approve, claim, bridge, resultCount }) {
  const counts = () => sql("select jsonb_build_array((select count(*)from paige_automations),(select count(*)from paige_automation_acts),(select count(*)from tasks),(select count(*)from paige_workspace_events),(select count(*)from paige_pending_approvals),(select count(*)from paige_act_executions),(select count(*)from paige_native_events))::text;");
  const auditCount = process => sql(`select count(*)from audit_logs where entity_id='${process}'and action='owner_task_automation.revise_step';`);
  const capture = process => ({ review: controlReview(process), counts: counts(), audit: auditCount(process) });
  const proposal = (review, act, config) => ({ ...review, acts: {
    reviewed_acts: review.acts, revision: { act_id: act, config },
  } });
  const revise = (original, config, review = controlReview(original.process), who) =>
    control(original.process, "revise_step", proposal(review, original.act, config), who);
  const rejected = (process, call, expected) => {
    const before = capture(process); assert.throws(call, expected); assert.deepEqual(capture(process), before);
  };
  check("one exact draft-step revision preserves original identity and creates no executable work", () => {
    const original = draft(), review = controlReview(original.process);
    const proposed = { title: "Review the revised internal handoff", description: "Keep the original workflow and ask before later work." };
    const before = counts();
    const result = control(original.process, "revise_step", { ...review, acts: {
      reviewed_acts: review.acts, revision: { act_id: original.act, config: proposed },
    } });
    assert.equal(result.automation_id, original.process);
    assert.equal(result.state, "draft"); assert.equal(result.armed_at, null);
    assert.equal(result.changed, true); assert.equal(result.execution_started, false);
    assert.equal(result.future_events_only, true); assert.notEqual(result.updated_at, review.updated_at);
    assert.deepEqual(result.process, review.process);
    assert.deepEqual(result.acts, [{ ...review.acts[0], config: proposed }]);
    const reread = controlReview(original.process);
    assert.equal(reread.updated_at, result.updated_at); assert.deepEqual(reread.acts, result.acts);
    assert.equal(counts(), before);
    assert.equal(sql(`select count(*)from audit_logs where entity_id='${original.process}'and action='owner_task_automation.revise_step';`), "1");
    assert.equal(JSON.parse(sql(`select to_jsonb(id)::text from audit_logs where entity_id='${original.process}'and action='owner_task_automation.revise_step';`)), result.configuration_audit_id);
  });
  check("execution-paused business can correct an inactive draft without permission to arm it", () => {
    const original = draft(), review = controlReview(original.process);
    sql(`update tenants set lifecycle_execution_paused=true where id='${tenant}';`);
    try {
      assert.throws(() => control(original.process, "arm", review), /OWNER_TASK_CONTROL_UNSUPPORTED/);
      const result = control(original.process, "revise_step", { ...review, acts: {
        reviewed_acts: review.acts,
        revision: { act_id: original.act, config: { title: "Correct the inactive internal draft" } },
      } });
      assert.equal(result.state, "draft"); assert.equal(result.armed_at, null);
      assert.equal(result.changed, true); assert.equal(result.execution_started, false);
      assert.throws(() => control(original.process, "arm"), /OWNER_TASK_CONTROL_UNSUPPORTED/);
    } finally { sql(`update tenants set lifecycle_execution_paused=false where id='${tenant}';`); }
  });
  check("lost revision acknowledgment reconciles the same act; stale replay cannot add a second audit", () => {
    const original = draft(), review = controlReview(original.process), config = { title: "Reconcile the original draft" };
    const result = revise(original, config, review), after = capture(original.process);
    rejected(original.process, () => revise(original, config, review), /OWNER_TASK_CONTROL_STALE/);
    const noop = revise(original, config);
    assert.equal(noop.changed, false); assert.equal(noop.configuration_audit_id, null);
    assert.equal(noop.updated_at, result.updated_at); assert.deepEqual(capture(original.process), after);
    assert.equal(auditCount(original.process), "1");
  });
  for (const length of [2, 20]) check(`only the captured last act changes in a paused ${length}-step process`, () => {
    const original = draft();
    sql(`insert into paige_automation_acts(id,automation_id,position,action_kind,config)
      select gen_random_uuid(),'${original.process}',n,'owner.task',jsonb_build_object('title','Original purpose '||n)
      from generate_series(2,${length}) n;`);
    control(original.process, "pause");
    const review = controlReview(original.process), last = review.acts.at(-1), before = counts();
    const config = { title: "Correct the last internal purpose", description: "Keep every other original step." };
    const result = revise({ process: original.process, act: last.id }, config, review);
    assert.equal(result.state, "paused"); assert.equal(result.armed_at, null);
    assert.equal(result.automation_id, original.process); assert.equal(result.execution_started, false);
    assert.deepEqual(result.acts, review.acts.map(act => act.id === last.id ? { ...act, config } : act));
    assert.equal(counts(), before); assert.equal(auditCount(original.process), "1");
  });
  check("owner can correct an invalid saved target purpose before any enablement", () => {
    const original = draft({ title: "{{unresolved.purpose}}" }), review = controlReview(original.process), before = counts();
    assert.throws(() => control(original.process, "arm", review), /OWNER_TASK_CONTROL_UNSUPPORTED/);
    const result = revise(original, { title: "Review the confirmed internal responsibility" }, review);
    assert.equal(result.changed, true); assert.equal(result.state, "draft"); assert.equal(result.armed_at, null);
    assert.equal(result.acts[0].id, original.act); assert.equal(result.execution_started, false);
    assert.equal(counts(), before); assert.equal(auditCount(original.process), "1");
  });
  check("correcting one target never admits another invalid or external step", () => {
    const original = draft();
    sql(`insert into paige_automation_acts(id,automation_id,position,action_kind,config)
      values('${randomUUID()}','${original.process}',2,'owner.task','{"title":"{{still.unresolved}}"}');`);
    rejected(original.process, () => revise(original, { title: "Correct this first purpose" }), /OWNER_TASK_CONTROL_UNSUPPORTED/);
  });
  check("ordinary active admin corrects the original owner draft under the admin's own audit identity", () => {
    const original = draft(), result = revise(original, { title: "Admin-reviewed internal purpose" }, undefined, other);
    assert.equal(result.changed, true); assert.equal(result.state, "draft");
    assert.equal(sql(`select user_id from audit_logs where entity_id='${original.process}'and action='owner_task_automation.revise_step';`), other);
  });
  check("a live process cannot be revised or silently paused by a draft-correction request", () => {
    const original = draft(); control(original.process, "arm");
    rejected(original.process, () => revise(original, { title: "Unauthorized live rewrite" }), /OWNER_TASK_CONTROL_UNSUPPORTED/);
  });
  for (const [label, mutate, restore] of [
    ["member", `update tenant_members set role='member'where user_id='${actor}'`, `update tenant_members set role='owner'where user_id='${actor}'`],
    ["suspended seat", `update tenant_members set status='suspended'where user_id='${actor}'`, `update tenant_members set status='active'where user_id='${actor}'`],
    ["switched business", `update profiles set active_tenant_id='${other}'where user_id='${actor}'`, `update profiles set active_tenant_id='${tenant}'where user_id='${actor}'`],
    ["deleted identity", `update auth.users set deleted_at=now()where id='${actor}'`, `update auth.users set deleted_at=null where id='${actor}'`],
    ["banned identity", `update auth.users set banned_until=now()+interval '1 day'where id='${actor}'`, `update auth.users set banned_until=null where id='${actor}'`],
  ]) check(`${label} cannot revise original work or add a configuration audit`, () => {
    const original = draft(), review = controlReview(original.process); sql(mutate + ";");
    try { rejected(original.process, () => revise(original, { title: "Refused purpose" }, review), /OWNER_TASK_CONTROL_FORBIDDEN/); }
    finally { sql(restore + ";"); }
  });
  check("a genuine foreign business's original draft is not found through this owner's current context", () => {
    const foreign = randomUUID(); sql(`insert into tenants(id,status)values('${foreign}','active');`);
    const original = draft(undefined, foreign), review = controlReview(original.process);
    rejected(original.process, () => revise(original, { title: "Foreign rewrite" }, review), /OWNER_TASK_CONTROL_NOT_FOUND/);
  });
  for (const [label, transform] of [
    ["missing wrapper", review => review.acts],
    ["extra wrapper key", review => ({ ...proposal(review, review.acts[0].id, { title: "Review" }).acts, state: "live" })],
    ["missing reviewed chain", () => ({ revision: { act_id: randomUUID(), config: { title: "Review" } } })],
    ["extra revision key", review => ({ reviewed_acts: review.acts, revision: { act_id: review.acts[0].id, config: { title: "Review" }, position: 2 } })],
    ["invalid act identity", review => ({ reviewed_acts: review.acts, revision: { act_id: "not-an-id", config: { title: "Review" } } })],
    ["unknown original act", review => proposal(review, randomUUID(), { title: "Review" }).acts],
    ["changed captured source", review => proposal({ ...review, acts: [{ ...review.acts[0], config: { title: "Forged source" } }] }, review.acts[0].id, { title: "Review" }).acts],
  ]) check(`revision refuses ${label} without changing any record`, () => {
    const original = draft(), review = controlReview(original.process);
    rejected(original.process, () => control(original.process, "revise_step", { ...review, acts: transform(review) }),
      /OWNER_TASK_CONTROL_INVALID|OWNER_TASK_CONTROL_UNSUPPORTED|OWNER_TASK_CONTROL_STALE/);
  });
  for (const [label, config] of [
    ["empty title", { title: " " }], ["oversized title", { title: "x".repeat(501) }],
    ["dynamic title", { title: "Review {{contact.name}}" }],
    ["dynamic description", { title: "Review", description: "${contact.name}" }],
    ["external recipient", { title: "Review", to: "outside@example.invalid" }],
    ["assignment", { title: "Review", assignee_user_id: actor }],
    ["wrong description type", { title: "Review", description: [] }],
    ["oversized description", { title: "Review", description: "x".repeat(10001) }],
    ["array configuration", []], ["null configuration", null],
  ]) check(`revision refuses ${label} without saving or starting anything`, () => {
    const original = draft();
    rejected(original.process, () => revise(original, config), /OWNER_TASK_CONTROL_INVALID|OWNER_TASK_CONTROL_UNSUPPORTED/);
  });
  check("revision audit refusal rolls back the original act and parent version atomically", () => {
    const original = draft(), review = controlReview(original.process), expected = capture(original.process);
    sql("create function revision_fixture_audit_failure()returns trigger language plpgsql as $$begin raise exception 'fixture revision audit refused'using errcode='23514';end$$;create trigger revision_fixture_audit_failure before insert on audit_logs for each row execute function revision_fixture_audit_failure();");
    try { rejected(original.process, () => revise(original, { title: "Must roll back" }, review), /fixture revision audit refused/); }
    finally { sql("drop trigger revision_fixture_audit_failure on audit_logs;drop function revision_fixture_audit_failure();"); }
    assert.deepEqual(capture(original.process), expected);
    sql("begin;" + controlStatement(original.process, "revise_step", proposal(review, original.act, { title: "Caller rollback" })) + "rollback;");
    assert.deepEqual(capture(original.process), expected);
  });
  check("correcting a paused later step preserves its landed predecessor receipt and cannot revive the old pending effect", () => {
    const original = sequence(), [first, second] = original.steps;
    approve(first); claim(first); const landed = bridge(first);
    approve(second); claim(second); control(original.process, "pause");
    const before = counts();
    revise({ process: original.process, act: second.act }, { title: "The newly reviewed later purpose" });
    assert.equal(counts(), before); assert.equal(bridge(second).outcome, "failed");
    assert.equal(resultCount(second), "0");
    assert.equal(bridge(first, true).result.readback.id, landed.result.readback.id);
    assert.equal(bridge(first).result.correlation_id, landed.result.correlation_id);
    assert.equal(resultCount(first), "1");
  });
  const installed = catalog(), metadata = rows => Object.fromEntries(Object.entries(rows)
    .map(([signature, { prosrc: _source, ...original }]) => [signature, original]));
  check("step revision preserves the original API identity, defaults, owner and ACL and every other native body", () => {
    assert.deepEqual(metadata(installed), metadata(beforeRevision));
    for (const [signature, row] of Object.entries(installed)) {
      if (!signature.startsWith("control_owner_task_automation(")) assert.deepEqual(row, beforeRevision[signature]);
    }
    assert.equal(Object.entries(installed).filter(([signature, row]) => row.prosrc !== beforeRevision[signature].prosrc).length, 1);
  });
  check("exact revision replay changes no native source, metadata, original work or audit", () => {
    const before = counts(), audits = sql("select count(*)from audit_logs;");
    sql(text(revisionSql)); assert.deepEqual(catalog(), installed);
    assert.equal(counts(), before); assert.equal(sql("select count(*)from audit_logs;"), audits);
  });
  check("revision source, helper and grant drift abort without keeping a partial patch", () => {
    const body = text(revisionSql).replace(/^begin;\s*/, "").replace(/\s*commit;\s*$/, "");
    const definition = sql("select pg_get_functiondef('public.control_owner_task_automation(uuid,text,timestamptz,jsonb,jsonb)'::regprocedure);");
    const original = draft(), before = capture(original.process);
    for (const mutation of [
      definition.replace("AS $function$", "AS $function$-- unrelated source drift\n") + ";",
      "alter function public._owner_task_literal_chain_supported(jsonb)security definer;",
      "grant execute on function public.control_owner_task_automation(uuid,text,timestamptz,jsonb,jsonb)to service_role;",
    ]) {
      assert.throws(() => sql("begin;" + mutation + body + "rollback;"), /OWNER_TASK_REVISION_SOURCE_DRIFT/);
      assert.deepEqual(catalog(), installed); assert.deepEqual(capture(original.process), before);
    }
  });
  const race = draft(), reviewed = controlReview(race.process), beforeRace = counts();
  const config = { title: "One concurrent original draft correction" };
  const attempts = await Promise.all(Array.from({ length: 8 }, () => runControlAttempt(
    controlStatement(race.process, "revise_step", proposal(reviewed, race.act, config)))));
  check("eight simultaneous exact revisions save one original change and audit without duplicate work", () => {
    const succeeded = attempts.filter(result => result.code === 0);
    assert.equal(succeeded.length, 1); assert.equal(JSON.parse(succeeded[0].out).changed, true);
    for (const failure of attempts.filter(result => result.code !== 0))
      assert.match(failure.err, /OWNER_TASK_CONTROL_STALE|could not obtain lock/);
    assert.equal(auditCount(race.process), "1"); assert.equal(counts(), beforeRace);
    assert.deepEqual(controlReview(race.process).acts[0].config, config);
  });
}
