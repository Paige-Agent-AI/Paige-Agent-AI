// Isolated native SQL proof. Never accepts a host, remote URL or credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { OperatorPostgresFixture } from '../proof/operator-postgres-fixture.mjs';

const port = Number(process.env.PLANNING_PROOF_PORT ?? 65443);
if (port === 5432 || port === 65441) throw Error('Use a dedicated disposable Planning port, separate from task-progress');
const db = new OperatorPostgresFixture(port);
const read = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
function definition(sql, name) {
  const start = sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, 'i'));
  if (start < 0) throw Error(`Canonical function missing: ${name}`);
  const tail = sql.slice(start), marker = /\bas\s+(\$[a-z_]*\$)/i.exec(tail);
  if (!marker) throw Error(`Canonical function delimiter missing: ${name}`);
  const end = tail.indexOf(marker[1], marker.index + marker[0].length);
  if (end < 0) throw Error(`Canonical function not closed: ${name}`);
  return tail.slice(0, end + marker[1].length) + ';';
}
const planning = read('20260711340000_paige_planning.sql');
const auditFix = read('20260712010000_planning_audit_fixes.sql');
const record = read('20270107000000_receipt_correlation_and_detail.sql');
await db.exec(`
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth; CREATE SCHEMA realtime;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.tenants(id uuid PRIMARY KEY,account_type text DEFAULT 'standalone',parent_tenant_id uuid);
CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role text,status text,is_owner boolean DEFAULT false);
CREATE TABLE public.user_roles(user_id uuid,role text);
CREATE TABLE public.clients(id uuid PRIMARY KEY,tenant_id uuid);
CREATE TABLE public.internal_bookings(id uuid PRIMARY KEY);
CREATE TABLE public.paige_actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,status text,title text);
CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,action text,entity text,entity_id uuid,data jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE public.paige_subagents(slug text,rail_display_name text,tenant_id uuid);
CREATE TABLE public.paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,actor_id uuid,
 source_kind text,source_id uuid,source_revision bigint,outcome text,actor_agent_slug text,actor_agent_label text,capability_key text,
 job_attempt_id text,llm_trace_id uuid,release_id text,detail jsonb,occurred_at timestamptz DEFAULT now(),
 UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT active_tenant_id FROM public.profiles WHERE user_id=auth.uid() $$;
CREATE FUNCTION public.is_tenant_member(t uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=t AND user_id=auth.uid() AND status='active') $$;
CREATE FUNCTION public.has_any_role(u uuid,r text[]) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND role=ANY(r)) $$;
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.has_any_role(auth.uid(),ARRAY['platform_admin']) $$;
CREATE FUNCTION public.is_tenant_admin(t uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=t AND user_id=auth.uid() AND status='active' AND (role='admin' OR is_owner)) $$;
CREATE FUNCTION public._workspace_event_display(text,text,text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('sentinel','unrelated','capability',$3) $$;
CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.file_action(p_action_kind text,p_title text,p_summary text,p_contact_id uuid,p_payload jsonb,p_priority text,p_due_at timestamptz,p_tenant_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE a uuid; BEGIN INSERT INTO public.paige_actions(tenant_id,status,title) VALUES(p_tenant_id,'filed',p_title) RETURNING id INTO a; RETURN jsonb_build_object('action_id',a); END $$;
CREATE FUNCTION public.advance_action(p_action_id uuid,p_to_status text,p_assigned_to_user_id uuid DEFAULT NULL,p_tenant_id uuid DEFAULT NULL,p_decision_rationale text DEFAULT NULL) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.paige_actions SET status=p_to_status WHERE id=p_action_id AND tenant_id=p_tenant_id $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
`);
for (const table of ['plans', 'plan_items']) {
  const at = planning.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  await db.exec(planning.slice(at, planning.indexOf('\n);', at) + 3));
}
await db.exec(`CREATE FUNCTION public.planning_fixture_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER planning_touch BEFORE UPDATE ON public.plan_items FOR EACH ROW EXECUTE FUNCTION public.planning_fixture_touch();
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY; ALTER TABLE public.plan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY planning_read ON public.plans FOR SELECT TO authenticated USING(tenant_id=public.current_user_tenant_id() AND public.is_tenant_member(tenant_id) AND (created_by=auth.uid() OR owner_user_id=auth.uid() OR public.is_tenant_admin(tenant_id)));
CREATE POLICY planning_item_read ON public.plan_items FOR SELECT TO authenticated USING(tenant_id=public.current_user_tenant_id() AND public.is_tenant_member(tenant_id) AND (created_by=auth.uid() OR assigned_to_user_id=auth.uid() OR public.is_tenant_admin(tenant_id)));
GRANT SELECT ON public.plans,public.plan_items TO authenticated;
`);
for (const name of ['plan_create','plan_add_milestone','plan_assign_task','plan_remove_item']) {
  await db.exec(definition(planning, name).replaceAll("ARRAY['admin','super_admin','coach']", "ARRAY['admin','super_admin']"));
}
for (const name of ['plan_set_reminder','plan_update_item']) {
  await db.exec(definition(auditFix, name).replaceAll("ARRAY['admin','super_admin','coach']", "ARRAY['admin','super_admin']"));
}
await db.exec(definition(read('20260712040000_plan_list_contact_and_calendar.sql'), 'plan_list').replaceAll("ARRAY['admin','super_admin','coach']", "ARRAY['admin','super_admin']"));
await db.exec(definition(record, '_record_workspace_rail_event'));
await db.exec(definition(record, 'record_capability_run'));
await db.exec(`REVOKE ALL ON FUNCTION public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb) TO service_role;
`);
for (const [file, names] of [
  ['20271020000020_operations_versioned_work_update.sql',['plan_update_item_scoped','plan_update_item_versioned','plan_list_operations_scoped']],
  ['20271020000110_operations_scoped_task_creation.sql',['plan_assign_task_scoped']],
  ['20271020000210_operations_scoped_project_creation.sql',['plan_create_scoped','plan_add_milestone_scoped']],
  ['20271020000240_operations_priority_and_activity.sql',['plan_update_item_priority_versioned','plan_item_activity_scoped']],
]) for (const name of names) await db.exec(definition(read(file),name));
// Optional owner-supplied function-only readback; never required by CI and never
// copied into source. It checks source-anchor compatibility with actual bodies.
if (process.env.PLANNING_PROOF_BASELINE) {
  const baseline=JSON.parse(readFileSync(process.env.PLANNING_PROOF_BASELINE,'utf8').replace(/^\uFEFF/,''));
  assert.equal(baseline.rows.length,9);
  for(const row of baseline.rows) await db.exec(row.definition);
}
await db.exec(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure AS signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'plan_%' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated,service_role'; EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO authenticated'; IF f.proname IN ('plan_create','plan_add_milestone','plan_assign_task','plan_set_reminder','plan_update_item','plan_remove_item','plan_list') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role'; END IF; END LOOP; END $$;`);

const migration = read('20271108160000_planning_native_receipts_history.sql');
const writerMetadataSQL=`SELECT proname,pg_get_function_identity_arguments(oid) AS args,proowner::regrole::text AS owner,
 prosecdef,proconfig,proacl::text AS acl FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('plan_create','plan_add_milestone','plan_assign_task','plan_set_reminder','plan_update_item','plan_remove_item') ORDER BY proname`;
const priorMetadata=(await db.query(writerMetadataSQL)).rows;
const bodiesSQL="SELECT proname,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('plan_create','plan_add_milestone','plan_assign_task','plan_set_reminder','plan_update_item','plan_remove_item') ORDER BY proname";
const priorBodies=(await db.query(bodiesSQL)).rows;
await db.exec(migration);
await db.exec(migration); // Replay must not add wrappers, signatures or receipts.
assert.deepEqual((await db.query(writerMetadataSQL)).rows,priorMetadata,'writer signatures/owner/definer/settings/ACL must be preserved');
for(const before of priorBodies) {
  const after=(await db.query(bodiesSQL)).rows.find(row=>row.proname===before.proname).definition;
  const originalReturn=/RETURN jsonb_build_object\([^;]+;/.exec(before.definition)?.[0];assert.ok(originalReturn);
  let restored=after.replace('DECLARE _planning_receipt_audit uuid; _planning_receipt_version timestamptz; _planning_receipt_recorded boolean := false; _planning_receipt_status text := \'actor_unavailable\'; ','DECLARE ')
    .replace(' RETURNING id INTO _planning_receipt_audit','');
  const start=restored.indexOf('  -- planning_native_receipt_v1:'),end=restored.indexOf('_planning_receipt_audit ELSE NULL END);',start);
  assert.ok(start>=0&&end>start);restored=restored.slice(0,start)+originalReturn+restored.slice(end+'_planning_receipt_audit ELSE NULL END);'.length);
  assert.equal(restored.replace(/\s+/g,' ').trim(),before.definition.replace(/\s+/g,' ').trim(),before.proname+' retains installed native source outside the bounded receipt insertion');
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1), other=id(2), foreign=id(3), admin=id(4), tenant=id(10), foreignTenant=id(11);
await db.exec(`INSERT INTO auth.users VALUES('${actor}'),('${other}'),('${foreign}'),('${admin}');
INSERT INTO public.tenants(id) VALUES('${tenant}'),('${foreignTenant}');
INSERT INTO public.profiles VALUES('${actor}','${tenant}'),('${other}','${tenant}'),('${foreign}','${foreignTenant}'),('${admin}','${tenant}');
INSERT INTO public.tenant_members VALUES('${tenant}','${actor}','member','active',false),('${tenant}','${other}','member','active',false),('${foreignTenant}','${foreign}','member','active',false),('${tenant}','${admin}','admin','active',true);
INSERT INTO public.user_roles VALUES('${admin}','admin');`);
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS '+label);};
const scalar=async sql=>(await db.query(`SELECT (${sql}) AS value`)).rows[0].value;
const call=async sql=>scalar(sql);
async function observe(sql) {
  const role=db.role; await db.exec('RESET ROLE');
  try { return await scalar(sql); } finally { if(role)await db.exec(`SET ROLE ${role}`); }
}
const setActor=async value=>{await db.query("select set_config('test.actor',$1,false)",[value]);};
async function refuses(sql, code, label) {
  let error;try {await call(sql);} catch(e){error=e;}
  check(error?.code===code,`${label} (${code})`);
}
await setActor(actor);await db.exec('SET ROLE authenticated');
const saved=await call(`public.plan_set_reminder('Private fixture title','2099-01-01T13:00:00Z')`);
check(saved.ok===true&&saved.railRecorded===true&&saved.receipt_status==='recorded','ordinary native reminder has atomic receipt');
const first=saved.item_id;
check(priorMetadata.length===6,'all six native writer signatures/owner/definer/settings/ACL preserved');
const receipt=await observe(`(SELECT to_jsonb(e) FROM public.paige_workspace_events e WHERE source_id='${saved.receipt_run_id}')`);
check(receipt?.tenant_id===tenant&&receipt.actor_id===actor&&receipt.capability_key==='plan_set_reminder','native receipt actor/tenant/capability');
check(receipt?.detail?.record_id===first&&receipt.detail.audit_id===saved.receipt_run_id&&!JSON.stringify(receipt).includes('Private fixture title'),'receipt identifies audit/record without raw title');
const beforeEvents=()=>observe('(SELECT count(*)::integer FROM public.paige_workspace_events)');
const oldVersion=await observe(`(SELECT updated_at::text FROM public.plan_items WHERE id='${first}')`);
const removed=await call(`public.plan_remove_item('${first}')`);
check(removed.ok&&removed.railRecorded&&removed.status==='cancelled','ordinary native cancellation records the same item');
check(await observe(`(SELECT status='cancelled' AND reminded_at IS NULL AND remind_at='2099-01-01T13:00:00Z' FROM public.plan_items WHERE id='${first}')`),'cancellation retains time and unclaimed state');
const freshPlan=await call(`public.plan_create('Private plan','custom','2099-01-01','2099-12-31')`);
check(freshPlan.ok&&freshPlan.railRecorded,'native plan create receipt');
const attached=await call(`public.plan_set_reminder('Attached history','2099-02-01',p_plan_id:='${freshPlan.plan_id}')`);
await call(`public.plan_remove_item('${attached.item_id}')`);
const task=await call(`public.plan_assign_task('Self task','${actor}',p_plan_id:='${freshPlan.plan_id}')`);
check(task.ok&&task.railRecorded&&task.action_id,'native self-task receipt and incumbent linked action');
const updated=await call(`public.plan_update_item('${task.item_id}',p_status:='in_progress')`);
check(updated.ok&&updated.railRecorded,'native item update receipt');
await setActor(admin);
const milestone=await call(`public.plan_add_milestone('${freshPlan.plan_id}','Milestone',p_assigned_to_user_id:='${actor}')`);
check(milestone.ok&&milestone.railRecorded,'native staff milestone receipt');
await setActor(actor);

const flatten=payload=>[...payload.loose_items,...payload.plans.flatMap(p=>p.items)];
const defaultRead=await call('public.plan_list()');
check(!flatten(defaultRead).some(r=>[first,attached.item_id].includes(r.id)),'default old caller still excludes cancelled items');
const oldPositional=await call('public.plan_list(NULL,NULL,NULL,NULL,NULL,NULL,50,NULL,NULL,false)');
check(JSON.stringify(oldPositional)===JSON.stringify(defaultRead),'old ten-argument positional resolution is preserved');
await refuses(`public.plan_list(p_tenant_id:='${foreignTenant}',p_include_cancelled:=true)`,'42501','supplied read tenant must match current caller workspace');
const history=await call('public.plan_list(p_include_cancelled:=true)');
check(flatten(history).some(r=>r.id===first)&&flatten(history).some(r=>r.id===attached.item_id),'explicit history retrieves standalone and attached cancellation');
const onlyCancelled=await call("public.plan_list(p_status:='cancelled',p_include_cancelled:=true)");
check(flatten(onlyCancelled).length===2&&flatten(onlyCancelled).every(r=>r.status==='cancelled'),'cancelled item filter does not discard the active parent plan');
const dateHistory=await call("public.plan_list(p_from:='2099-01-01',p_to:='2099-01-31',p_by_item_date:=true,p_include_cancelled:=true)");
check(flatten(dateHistory).some(r=>r.id===first)&&!flatten(dateHistory).some(r=>r.id===attached.item_id),'existing item-date boolean retains its meaning');
const scoped=await call(`public.plan_list_operations_scoped('${actor}','${tenant}')`);
check(!flatten(scoped).some(r=>[first,attached.item_id].includes(r.id)),'default Operations caller retains its old cancellation exclusion');
const scopedHistory=await call(`public.plan_list_operations_scoped('${actor}','${tenant}',p_include_cancelled:=true)`);
check(flatten(scopedHistory).some(r=>r.id===first)&&flatten(scopedHistory).some(r=>r.id===attached.item_id),'explicit Operations history bundle receives both cancelled item classes');
check(JSON.stringify(await call(`public.plan_list_operations_scoped('${actor}','${tenant}',NULL,NULL,NULL,200,NULL,false,NULL)`))===JSON.stringify(scoped),'old nine-argument Operations positional caller remains compatible');
check(await observe("(SELECT count(*)=1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='plan_list_operations_scoped')"),'one Operations reader signature prevents ambiguous defaulted overloads');
check(await observe("has_function_privilege('authenticated','public.plan_list_operations_scoped(uuid,uuid,date,date,text,integer,uuid,boolean,uuid,boolean)','EXECUTE') AND NOT has_function_privilege('service_role','public.plan_list_operations_scoped(uuid,uuid,date,date,text,integer,uuid,boolean,uuid,boolean)','EXECUTE')"),'Operations history keeps its authenticated-only ACL');
const activity=await call(`public.plan_item_activity_scoped('${first}','${actor}','${tenant}')`);
check(activity.ok&&activity.events.some(e=>e.action==='plan_remove_item'),'existing authorized item activity reads cancellation history');
const eventsBeforeRead=await beforeEvents();await call('public.plan_list(p_include_cancelled:=true)');
check(await beforeEvents()===eventsBeforeRead,'history reading creates no capability receipt');
check(await observe("(SELECT count(*)=1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='plan_list')"),'one public reader signature, no ambiguous overload');
check(await observe("has_function_privilege('authenticated','public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean)','EXECUTE') AND NOT has_function_privilege('anon','public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean)','EXECUTE')"),'new native signature preserves authenticated/anon ACL');
check(await observe("NOT has_function_privilege('authenticated','public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb)','EXECUTE')"),'native receipt integration does not expose the service-only recorder');

await refuses(`public.plan_set_reminder('Other person','2099-01-01',p_target_user_id:='${other}')`,'42501','ordinary member cannot assign another person');
await refuses(`public.plan_set_reminder('Foreign workspace','2099-01-01',p_tenant_id:='${foreignTenant}')`,'42501','caller tenant cannot be replaced');
await refuses(`public.plan_add_milestone('${freshPlan.plan_id}','Unauthorised')`,'42501','ordinary member cannot create a team milestone');
await setActor(other);
check(!flatten(await call('public.plan_list(p_include_cancelled:=true)')).some(r=>r.id===first),'private cancelled history remains invisible to another member');
await refuses(`public.plan_item_activity_scoped('${first}','${other}','${tenant}')`,'42501','known private UUID does not grant activity access');
await setActor(foreign);
check(flatten(await call('public.plan_list(p_include_cancelled:=true)')).length===0,'foreign member cannot read first workspace history');
await refuses(`public.plan_remove_item('${first}')`,'42501','foreign member cannot cancel an item');

await db.exec('RESET ROLE');
const malformed=id(80);
await db.exec(`INSERT INTO public.plan_items(id,tenant_id,plan_id,item_type,title,created_by,assigned_to_user_id,status,remind_at)
VALUES('${malformed}','${foreignTenant}','${freshPlan.plan_id}','reminder','Malformed foreign child','${actor}','${actor}','cancelled','2099-01-01')`);
await setActor(admin);await db.exec('SET ROLE authenticated');
check(!flatten(await call('public.plan_list(p_include_cancelled:=true)')).some(r=>r.id===malformed),'staff history fails closed on malformed cross-tenant child');
await setActor(actor);

// A failed receipt must roll back the item, audit and linked bus transition.
await db.exec('RESET ROLE');
await db.exec("CREATE FUNCTION public.planning_fixture_receipt_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture receipt unavailable' USING ERRCODE='P0001'; END $$; CREATE TRIGGER planning_receipt_refusal BEFORE INSERT ON public.paige_workspace_events FOR EACH ROW EXECUTE FUNCTION public.planning_fixture_receipt_refusal();");
const countsBefore=await observe("jsonb_build_array((SELECT count(*) FROM public.plan_items),(SELECT count(*) FROM public.audit_logs),(SELECT count(*) FROM public.paige_workspace_events))");
await db.exec('SET ROLE authenticated');
await refuses("public.plan_set_reminder('Receipt failure','2099-01-01')",'P0001','receipt refusal rolls back reminder creation');
await refuses(`public.plan_remove_item('${task.item_id}')`,'P0001','receipt refusal rolls back linked cancellation');
const rollbackVersion=await observe(`(SELECT updated_at::text FROM public.plan_items WHERE id='${task.item_id}')`);
await refuses(`public.plan_remove_item_versioned('${task.item_id}','${actor}','${tenant}','${rollbackVersion}')`,'P0001','versioned removal rolls back with its native receipt failure');
check(await observe(`(SELECT status='in_progress' FROM public.plan_items WHERE id='${task.item_id}')`),'failed cancellation leaves source unchanged');
check(await observe(`(SELECT status='assigned' FROM public.paige_actions WHERE id='${task.action_id}')`),'failed cancellation rolls back linked action dismissal');
check(JSON.stringify(await observe("jsonb_build_array((SELECT count(*) FROM public.plan_items),(SELECT count(*) FROM public.audit_logs),(SELECT count(*) FROM public.paige_workspace_events))"))===JSON.stringify(countsBefore),'receipt refusal leaves no audit, receipt or new item');
await db.exec('RESET ROLE');await db.exec('DROP TRIGGER planning_receipt_refusal ON public.paige_workspace_events');
await db.exec('SET ROLE authenticated');
const taskCancelled=await call(`public.plan_remove_item('${task.item_id}')`);
check(taskCancelled.railRecorded&&await observe(`(SELECT status='dismissed' FROM public.paige_actions WHERE id='${task.action_id}')`),'successful cancellation retains linked bus dismissal');

await db.exec('RESET ROLE');await db.exec(`UPDATE public.tenant_members SET status='inactive' WHERE tenant_id='${tenant}' AND user_id='${actor}'`);
await db.exec('SET ROLE authenticated');
await refuses(`public.plan_update_item('${first}',p_status:='open')`,'42501','revoked member cannot mutate a formerly owned item');
await refuses(`public.plan_remove_item('${first}')`,'42501','revoked member cannot append a cancellation');
check(await observe(`(SELECT status='cancelled' FROM public.plan_items WHERE id='${first}')`),'revoked mutations roll back source state');
await db.exec('RESET ROLE');await db.exec(`UPDATE public.tenant_members SET status='active' WHERE tenant_id='${tenant}' AND user_id='${actor}'`);
await db.exec('SET ROLE authenticated');

const version=await observe(`(SELECT updated_at::text FROM public.plan_items WHERE id='${milestone.item_id}')`);
const cas=await call(`public.plan_update_item_versioned('${milestone.item_id}','${actor}','${tenant}','${version}',p_status:='done')`);
check(cas.ok&&cas.item_id===milestone.item_id,'existing versioned wrapper reaches the same receipted writer');
await refuses(`public.plan_update_item_versioned('${milestone.item_id}','${actor}','${tenant}','${version}',p_status:='open')`,'40001','stale Operations source version remains refused');
const raceVersion=await observe(`(SELECT updated_at::text FROM public.plan_items WHERE id='${milestone.item_id}')`);
const raceBefore=await beforeEvents();
const held=await db.holdArchive(`SELECT public.plan_update_item_versioned('${milestone.item_id}','${actor}','${tenant}','${raceVersion}',p_status:='in_progress')`);
await refuses(`public.plan_update_item_versioned('${milestone.item_id}','${actor}','${tenant}','${raceVersion}',p_status:='blocked')`,'40001','concurrent same-version update loses after the existing lock');
await held.completed;
check(await beforeEvents()===raceBefore+1,'one CAS winner commits one native receipt');
const removeTask=await call(`public.plan_assign_task('Versioned remove','${actor}')`);
const removeVersion=await observe(`(SELECT updated_at::text FROM public.plan_items WHERE id='${removeTask.item_id}')`);
await refuses(`public.plan_remove_item_versioned('${removeTask.item_id}','${other}','${tenant}','${removeVersion}')`,'42501','removal refuses a substituted actor');
await refuses(`public.plan_remove_item_versioned('${removeTask.item_id}','${actor}','${foreignTenant}','${removeVersion}')`,'42501','removal refuses a substituted workspace');
await refuses(`public.plan_remove_item_versioned('${removeTask.item_id}','${actor}','${tenant}',NULL)`,'40001','removal requires the exact source version');
await setActor(other);
await refuses(`public.plan_remove_item_versioned('${removeTask.item_id}','${other}','${tenant}','${removeVersion}')`,'42501','another member cannot remove private work by known UUID');
await db.exec('RESET ROLE');await db.exec(`INSERT INTO public.user_roles VALUES('${other}','admin')`);await db.exec('SET ROLE authenticated');
await refuses(`public.plan_remove_item_versioned('${removeTask.item_id}','${other}','${tenant}','${removeVersion}')`,'42501','global role without target-workspace authority cannot remove another person work');
await db.exec('RESET ROLE');await db.exec(`DELETE FROM public.user_roles WHERE user_id='${other}' AND role='admin'`);await db.exec('SET ROLE authenticated');
await setActor(actor);
const removalBefore=await beforeEvents();
const versionedRemoval=await call(`public.plan_remove_item_versioned('${removeTask.item_id}','${actor}','${tenant}','${removeVersion}')`);
check(versionedRemoval.ok&&versionedRemoval.status==='cancelled'&&versionedRemoval.actor_id===actor&&versionedRemoval.tenant_id===tenant&&versionedRemoval.railRecorded,'versioned removal delegates native cancellation and its receipt');
check(await observe(`(SELECT status='dismissed' FROM public.paige_actions WHERE id='${removeTask.action_id}')`),'versioned removal dismisses the same linked native action');
check(await beforeEvents()===removalBefore+1,'versioned removal emits one executor-owned receipt');
await refuses(`public.plan_remove_item_versioned('${removeTask.item_id}','${actor}','${tenant}','${removeVersion}')`,'40001','replayed stale removal cannot append another audit or receipt');
check(await beforeEvents()===removalBefore+1,'stale removal replay creates no second receipt');
check(await observe("has_function_privilege('authenticated','public.plan_remove_item_versioned(uuid,uuid,uuid,timestamptz)','EXECUTE') AND NOT has_function_privilege('service_role','public.plan_remove_item_versioned(uuid,uuid,uuid,timestamptz)','EXECUTE')"),'versioned removal is ordinary-authenticated only');
await db.exec('RESET ROLE');
check(db.run(`WITH claim AS (UPDATE public.plan_items SET reminded_at=now() WHERE id='${first}' AND tenant_id='${tenant}' AND updated_at='${oldVersion}' AND status NOT IN ('done','cancelled') AND reminded_at IS NULL RETURNING id) SELECT count(*)=0 FROM claim`).split('\n').at(-1)==='t','stale worker claim cannot claim a cancelled native reminder');

const replayBefore=await beforeEvents();
await db.exec(`SELECT public.record_capability_run('${tenant}','${actor}','plan_set_reminder','capability_succeeded','${saved.receipt_run_id}',NULL::text,NULL::text,NULL::uuid,NULL::text,NULL::jsonb)`);
check(await beforeEvents()===replayBefore,'the same audit/run receipt replays to one event');
await setActor('');await db.exec('SET ROLE service_role');
const serviceBefore=await beforeEvents();
const service=await call(`public.plan_set_reminder('Legacy service','2099-01-01',p_target_user_id:='${actor}',p_tenant_id:='${tenant}')`);
check(service.ok&&service.railRecorded===false&&service.receipt_run_id===null&&service.receipt_status==='actor_unavailable','actor-less service compatibility reports no invented Rail or actor');
check(await beforeEvents()===serviceBefore,'actor-less service mutation emits no attributed event');
check(await observe(`(SELECT created_by IS NULL FROM public.plan_items WHERE id='${service.item_id}')`),'legacy service created_by stays null');
await db.exec('RESET ROLE');
check((await scalar("public._workspace_event_display('capability_run','capability_succeeded','plan_set_reminder')")).summary.includes('Scheduled does not mean delivered'),'Planning Rail does not promise reminder delivery');
check((await scalar("public._workspace_event_display('capability_run','capability_succeeded','unrelated')")).sentinel==='unrelated','unrelated Rail display delegates unchanged');
check((await scalar("public._workspace_event_display('capability_run','capability_failed','plan_set_reminder')")).sentinel==='unrelated','non-success outcomes delegate unchanged');

const platform=id(5), titleOnly=id(6);
await db.exec(`INSERT INTO auth.users VALUES('${platform}'),('${titleOnly}');
INSERT INTO public.profiles VALUES('${platform}','${foreignTenant}'),('${titleOnly}','${tenant}');
INSERT INTO public.tenant_members VALUES('${tenant}','${titleOnly}','member','active',false);
INSERT INTO public.user_roles VALUES('${platform}','platform_admin'),('${platform}','admin'),('${titleOnly}','coach');`);
await setActor(titleOnly);await db.exec('SET ROLE authenticated');
await refuses(`public.plan_add_milestone('${freshPlan.plan_id}','Retired title')`,'42501','retired title role grants no team-writing authority');
await setActor(platform);
const platformBefore=await beforeEvents();
const platformResult=await call(`public.plan_update_item('${first}',p_priority:='high')`);
check(platformResult.ok&&platformResult.railRecorded===false&&platformResult.receipt_status==='actor_not_workspace_member','incumbent platform-owner exception stays explicit without invented membership');
check(await beforeEvents()===platformBefore,'nonmember platform-owner compatibility fabricates no Rail actor');
await setActor(actor);
const rearmed=await call("public.plan_set_reminder('Rearming fixture','2099-03-01')");
await db.exec('RESET ROLE');
await db.exec(`UPDATE public.plan_items SET status='done',reminded_at=now(),resolved_at=now() WHERE id='${rearmed.item_id}'`);
await db.exec('SET ROLE authenticated');
await call(`public.plan_update_item('${rearmed.item_id}',p_status:='open',p_remind_at:='2099-04-01')`);
check(await observe(`(SELECT status='open' AND reminded_at IS NULL AND resolved_at IS NULL FROM public.plan_items WHERE id='${rearmed.item_id}')`),'native explicit rescheduling keeps existing rearm behavior');

// Execute the actual Chat dispatch over a native committed RPC whose transport
// acknowledgement is then lost. This is a boundary port, not an HTTP/production claim.
const chatSource=readFileSync(new URL('../../supabase/functions/paige-ai-chat/index.ts',import.meta.url),'utf8');
const chatAst=ts.createSourceFile('chat.ts',chatSource,ts.ScriptTarget.Latest,true);let planningBranch;
function findBranch(node) {
  if(ts.isIfStatement(node)&&node.expression.getText(chatAst).includes('tc.function.name === "plan_set_reminder"')&&node.expression.getText(chatAst).includes('tc.function.name === "plan_list"'))planningBranch=node.thenStatement;
  ts.forEachChild(node,findBranch);
}
findBranch(chatAst);assert.ok(planningBranch);
const outcomeSource=readFileSync(new URL('../../supabase/functions/_shared/approval-outcome.ts',import.meta.url),'utf8');
const outcomeAst=ts.createSourceFile('outcome.ts',outcomeSource,ts.ScriptTarget.Latest,true);
const answered=outcomeAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='databaseAnswered');
const note=outcomeAst.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(outcomeAst)==='OUTCOME_UNKNOWN_NOTE'));
assert.ok(answered&&note);
const dispatchCode=`${answered.getText(outcomeAst).replace('export ','')}\n${note.getText(outcomeAst).replace('export ','')}
 async function dispatch(tc,personaCtx,supabaseClient,toolResults,user,requestExecutionState) ${planningBranch.getText(chatAst)}`;
const compiled=ts.transpileModule(dispatchCode,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const dispatch=new Function(`${compiled};return dispatch;`)();
let nativeAttempts=0;const outputs=[],executionState={needsReview:false};
const lostBefore=await beforeEvents();
await dispatch({id:'native-lost-ack',function:{name:'plan_set_reminder',arguments:JSON.stringify({title:'Lost native acknowledgement',remind_at:'2099-05-01T13:00:00Z'})}},
  {tenant_id:tenant},{rpc:async name=>{
    if(name==='current_user_tenant_id')return {data:await call('public.current_user_tenant_id()'),error:null};
    assert.equal(name,'plan_set_reminder');nativeAttempts++;
    await call("public.plan_set_reminder('Lost native acknowledgement','2099-05-01T13:00:00Z')");
    throw new TypeError('Fixture acknowledgement lost after native commit');
  },from:()=>{throw Error('Lost acknowledgement cannot invent a record locator');}},outputs,{id:actor},executionState);
const lost=JSON.parse(outputs[0].content);
check(nativeAttempts===1&&lost.success===false&&lost.outcome_unknown===true&&lost.not_applied!==true&&executionState.needsReview,'actual Chat keeps native lost acknowledgement unknown and holds successors');
check(await beforeEvents()===lostBefore+1,'native business commit retains its executor receipt when the Chat acknowledgement is lost');
// Active rescheduling must change the native reminder clock, never a due date.
const schedule=await call("public.plan_set_reminder('Active reschedule fixture','2099-06-01T09:00:00Z')");
await db.exec('RESET ROLE');
await db.exec(`UPDATE public.plan_items SET due_at='2099-08-01',reminded_at=now(),resolved_at=now() WHERE id='${schedule.item_id}'`);
await db.exec('SET ROLE authenticated');
const scheduleRow=()=>observe(`(SELECT to_jsonb(i) FROM public.plan_items i WHERE id='${schedule.item_id}')`);
const scheduleVersion=()=>observe(`(SELECT updated_at::text FROM public.plan_items WHERE id='${schedule.item_id}')`);
const reschedule=(version,time="'2099-06-01T13:00:00+03:00'",who=actor,where=tenant,item=schedule.item_id)=>
  `public.plan_reschedule_reminder_versioned('${item}','${who}','${where}',${version===null?'NULL':`'${version}'`},${time})`;
const scheduleBefore=await scheduleRow(),scheduleOldVersion=await scheduleVersion(),scheduleEvents=await beforeEvents();
const rescheduled=await call(reschedule(scheduleOldVersion));
check(rescheduled.ok&&rescheduled.item_id===schedule.item_id&&rescheduled.actor_id===actor&&rescheduled.tenant_id===tenant&&rescheduled.railRecorded&&rescheduled.receipt_run_id&&rescheduled.receipt_status==='recorded','reschedule preserves native receipt and verified scope');
const scheduleAfter=await scheduleRow();
check(new Date(scheduleAfter.remind_at).toISOString()==='2099-06-01T10:00:00.000Z'&&new Date(rescheduled.remind_at).getTime()===new Date(scheduleAfter.remind_at).getTime(),'offset time is saved and acknowledged as the same native instant');
const unchanged=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['remind_at','reminded_at','resolved_at','updated_at'].includes(key)));
check(JSON.stringify(unchanged(scheduleAfter))===JSON.stringify(unchanged(scheduleBefore)),'reschedule preserves every other native record field');
check(scheduleAfter.reminded_at===null&&scheduleAfter.resolved_at===null&&scheduleAfter.updated_at!==scheduleBefore.updated_at,'native future rearm clears markers and advances source version without reopening');
check(await beforeEvents()===scheduleEvents+1,'one reschedule emits one native executor receipt');
await refuses(reschedule(scheduleOldVersion),'40001','same-version replay cannot reschedule or append another receipt');
check(await beforeEvents()===scheduleEvents+1,'stale replay leaves receipt count unchanged');
await db.exec('RESET ROLE');
check(db.run(`WITH claim AS (UPDATE public.plan_items SET reminded_at=now() WHERE id='${schedule.item_id}' AND tenant_id='${tenant}' AND updated_at='${scheduleOldVersion}' AND reminded_at IS NULL AND status NOT IN ('done','cancelled') AND remind_at<=now() RETURNING id) SELECT count(*)=0 FROM claim`).split('\n').at(-1)==='t','old worker snapshot cannot claim a rescheduled reminder');
await db.exec('SET ROLE authenticated');
for(const [time,code,label] of [["NULL",'22023','null'],["'bad-time'::timestamptz",'22007','invalid'],["'infinity'",'22023','Infinity'],["'-infinity'",'22023','negative Infinity'],["'2000-01-01'",'22023','past']]){
  await refuses(reschedule(await scheduleVersion(),time),code,`${label} reminder time refuses`);
}
await refuses(reschedule(null),'40001','reschedule requires source version');
await refuses(reschedule(await scheduleVersion(),undefined,other),'42501','reschedule refuses a substituted actor');
await refuses(reschedule(await scheduleVersion(),undefined,actor,foreignTenant),'42501','reschedule refuses a substituted tenant');
await setActor(foreign);
await refuses(reschedule(await scheduleVersion(),undefined,foreign,foreignTenant),'42501','foreign workspace cannot reschedule known reminder UUID');
await setActor(other);
await refuses(reschedule(await scheduleVersion(),undefined,other),'42501','ordinary member cannot reschedule private work');
await db.exec('RESET ROLE');await db.exec(`INSERT INTO public.user_roles VALUES('${other}','admin'),('${other}','coach')`);await db.exec('SET ROLE authenticated');
await refuses(reschedule(await scheduleVersion(),undefined,other),'42501','global/retired roles cannot replace target-workspace authority');
await db.exec('RESET ROLE');await db.exec(`DELETE FROM public.user_roles WHERE user_id='${other}'`);await db.exec('SET ROLE authenticated');
await setActor(admin);
await db.exec('RESET ROLE');await db.exec(`DELETE FROM public.user_roles WHERE user_id='${admin}' AND role='admin'`);await db.exec('SET ROLE authenticated');
await refuses(reschedule(await scheduleVersion(),undefined,admin),'42501','tenant admin alone cannot widen incumbent native field authority');
await db.exec('RESET ROLE');await db.exec(`INSERT INTO public.user_roles VALUES('${admin}','coach')`);await db.exec('SET ROLE authenticated');
await refuses(reschedule(await scheduleVersion(),undefined,admin),'42501','target-tenant admin with only a retired coach role still cannot reschedule');
await db.exec('RESET ROLE');await db.exec(`DELETE FROM public.user_roles WHERE user_id='${admin}' AND role='coach'`);await db.exec('SET ROLE authenticated');
await db.exec('RESET ROLE');await db.exec(`INSERT INTO public.user_roles VALUES('${admin}','admin')`);await db.exec('SET ROLE authenticated');
check((await call(reschedule(await scheduleVersion(),"'2099-07-01'",admin))).ok,'native admin with target-workspace authority can reschedule');
const assignedReminder=await call(`public.plan_set_reminder('Assignee status only','2099-06-01',p_target_user_id:='${actor}')`);
await setActor(actor);
const assignedVersion=await observe(`(SELECT updated_at::text FROM public.plan_items WHERE id='${assignedReminder.item_id}')`);
await refuses(reschedule(assignedVersion,undefined,actor,tenant,assignedReminder.item_id),'42501','assignee-only identity cannot reschedule');
check((await call(`public.plan_update_item('${assignedReminder.item_id}',p_status:='blocked')`)).ok,'assignee native status-only control remains available');
await refuses(reschedule(await observe(`(SELECT updated_at::text FROM public.plan_items WHERE id='${task.item_id}')`),undefined,actor,tenant,task.item_id),'22023','task cannot enter reminder-reschedule contract');
for(const status of ['done','cancelled']){
 await db.exec('RESET ROLE');await db.exec(`UPDATE public.plan_items SET status='${status}' WHERE id='${schedule.item_id}'`);await db.exec('SET ROLE authenticated');
 await refuses(reschedule(await scheduleVersion()),'22023',`${status} reminder cannot be reopened by rescheduling`);
}
await db.exec('RESET ROLE');await db.exec(`UPDATE public.plan_items SET status='open' WHERE id='${schedule.item_id}'; UPDATE public.tenant_members SET status='inactive' WHERE user_id='${actor}' AND tenant_id='${tenant}'`);await db.exec('SET ROLE authenticated');
await refuses(reschedule(await scheduleVersion()),'42501','revoked member cannot reschedule previously owned work');
await db.exec('RESET ROLE');await db.exec(`UPDATE public.tenant_members SET status='active' WHERE user_id='${actor}' AND tenant_id='${tenant}'; UPDATE public.tenants SET account_type='agency' WHERE id='${tenant}'`);await db.exec('SET ROLE authenticated');
await refuses(reschedule(await scheduleVersion()),'42501','non-Solo workspace cannot use Operations rescheduling');
await db.exec('RESET ROLE');await db.exec(`UPDATE public.tenants SET account_type='standalone' WHERE id='${tenant}'`);await db.exec('SET ROLE authenticated');
const raceScheduleVersion=await scheduleVersion(),raceScheduleEvents=await beforeEvents();
const scheduleHeld=await db.holdArchive(`SELECT ${reschedule(raceScheduleVersion,"'2099-09-01'")}`);
await refuses(reschedule(raceScheduleVersion,"'2099-10-01'"),'40001','concurrent reminder CAS loser refuses after the native lock');await scheduleHeld.completed;
check(await beforeEvents()===raceScheduleEvents+1,'one concurrent reminder winner creates one receipt');
const rollbackSchedule=await scheduleRow(),rollbackScheduleEvents=await beforeEvents();
const rollbackAudit=await observe('(SELECT count(*) FROM public.audit_logs)');
await db.exec('RESET ROLE');await db.exec('CREATE TRIGGER planning_receipt_refusal BEFORE INSERT ON public.paige_workspace_events FOR EACH ROW EXECUTE FUNCTION public.planning_fixture_receipt_refusal()');await db.exec('SET ROLE authenticated');
await refuses(reschedule(await scheduleVersion(),"'2099-11-01'"),'P0001','receipt refusal rolls back the complete reminder reschedule');
check(JSON.stringify(await scheduleRow())===JSON.stringify(rollbackSchedule)&&await beforeEvents()===rollbackScheduleEvents&&await observe('(SELECT count(*) FROM public.audit_logs)')===rollbackAudit,'receipt rollback retains original time/version/markers, audit and receipt counts');
await db.exec('RESET ROLE');await db.exec('DROP TRIGGER planning_receipt_refusal ON public.paige_workspace_events');
check(await observe("has_function_privilege('authenticated','public.plan_reschedule_reminder_versioned(uuid,uuid,uuid,timestamptz,timestamptz)','EXECUTE') AND NOT has_function_privilege('anon','public.plan_reschedule_reminder_versioned(uuid,uuid,uuid,timestamptz,timestamptz)','EXECUTE') AND NOT has_function_privilege('service_role','public.plan_reschedule_reminder_versioned(uuid,uuid,uuid,timestamptz,timestamptz)','EXECUTE')"),'reminder reschedule has one authenticated-only API signature');
// Actual Operations submission over a native commit, followed by transport loss.
await db.exec('SET ROLE authenticated');
const manualSource=readFileSync(new URL('../../src/solo/operations/operations-work-update.ts',import.meta.url),'utf8');
const manualJs=ts.transpileModule(manualSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const manualExports={};let rescheduleAttempts=0;
const manualClient={auth:{getSession:async()=>({data:{session:{user:{id:actor}}},error:null})},rpc:async(name,args)=>{
 assert.equal(name,'plan_reschedule_reminder_versioned');rescheduleAttempts++;
 assert.deepEqual(Object.keys(args).sort(),['p_item_id','p_expected_actor_id','p_expected_tenant_id','p_expected_updated_at','p_remind_at'].sort());
 await call(reschedule(args.p_expected_updated_at,`'${args.p_remind_at}'`));throw new TypeError('Native reschedule committed; acknowledgement lost');
}};
new Function('require','exports',manualJs)(name=>{assert.equal(name,'@/integrations/supabase/client');return {supabase:manualClient};},manualExports);
const manualEvents=await beforeEvents();
const manualResult=await manualExports.submitOperationsWorkUpdate({actorId:actor,tenantId:tenant,itemId:schedule.item_id,expectedUpdatedAt:await scheduleVersion()},{remindAt:'2099-12-01T13:00:00Z'});
check(manualResult.kind==='uncertain'&&rescheduleAttempts===1,'actual Operations adapter holds lost native reschedule acknowledgement without retry/fallback');
check(await beforeEvents()===manualEvents+1&&new Date((await scheduleRow()).remind_at).toISOString()==='2099-12-01T13:00:00.000Z','lost acknowledgement retains one committed reschedule and native receipt');
const finalScheduleVersion=await scheduleVersion();
await db.exec('RESET ROLE');await db.exec('SET ROLE anon');
await refuses(reschedule(finalScheduleVersion),'42501','anonymous role cannot call reminder reschedule');
await db.exec('RESET ROLE');await setActor('');await db.exec('SET ROLE service_role');
await refuses(reschedule(finalScheduleVersion),'42501','actorless service cannot call ordinary reminder reschedule');
await db.exec('RESET ROLE');await db.exec('SET ROLE authenticated');
await refuses(reschedule(finalScheduleVersion),'42501','authenticated database role without an actor cannot reschedule');
console.log(`PASS ${checks} native Planning receipt/history/reschedule checks; fixture auth/bus/realtime ports are not production acceptance`);
