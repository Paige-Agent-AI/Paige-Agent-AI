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
  const forward = text("supabase/migrations/20271126140005_owner_task_multistep_review.sql");
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
}
