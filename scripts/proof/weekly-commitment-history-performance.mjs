// Extension of the existing loopback/disposable weekly proof, never an execution service.
// Seeded synthetic history comes from one real canonical observation; it is not 100,000 real acts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const names=['weekly_commitment_event_recency_idx','weekly_commitment_receipt_lookup_idx'];
const digest=s=>createHash('sha256').update(s).digest('hex');
const median=v=>[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)];
export function historyPerformanceProof({run,json,literal,source,owner,tenant,otherOwner,foreign,member,admin,templateEvent,migration,onMeasurement}){
  const ddl=source(migration);
  const creates=[...ddl.matchAll(/CREATE INDEX IF NOT EXISTS[\s\S]+?;/g)].map(m=>m[0]);
  assert.equal(creates.length,2);
  const beforeGetter=source('supabase/migrations/20271029000000_experience05_weekly_status_readback.sql').match(/CREATE OR REPLACE FUNCTION public\.get_weekly_commitment_checks\(\)[\s\S]+?END \$\$;/)[0];
  const afterGetter=ddl.match(/CREATE OR REPLACE FUNCTION public\.get_weekly_commitment_checks\(\)[\s\S]+?END \$\$;/)[0];
  const getter=afterGetter;
  const match=getter.match(/LEFT JOIN LATERAL\((SELECT e\.id AS event_id,[\s\S]+?LIMIT 1)\) verified ON true;/);
  assert(match,'Explain the actual historical SQL extracted from the unchanged getter');
  const latest=getter.match(/LEFT JOIN LATERAL\((SELECT \* FROM public\.paige_native_events e WHERE[\s\S]+?LIMIT 1)\) ev ON true/);
  assert(latest,'Explain the actual latest-attempt SQL from the same unchanged getter');
  const beforeCounts=json('SELECT jsonb_build_array((SELECT count(*) FROM paige_automations),(SELECT count(*) FROM paige_native_events),(SELECT count(*) FROM paige_act_executions),(SELECT count(*) FROM paige_workspace_events));');
  const scenarios=[];
  for(const depth of [100,1000]){
    const setup=`BEGIN;
SET LOCAL statement_timeout='60s';
DROP INDEX public.${names[0]}; DROP INDEX public.${names[1]};
CREATE TEMP TABLE history_processes(id uuid,act_id uuid,tenant_id uuid,actor_id uuid,n integer);
CREATE TEMP TABLE history_process_templates(id uuid,tenant_id uuid,actor_id uuid);
CREATE TEMP TABLE history_rows(event_id uuid,receipt_id uuid,automation_id uuid,act_id uuid,tenant_id uuid,actor_id uuid,g integer,corr text);
CREATE TEMP TABLE history_originals AS SELECT md5(prosrc) getter_body FROM pg_proc WHERE oid='public.get_weekly_commitment_checks()'::regprocedure;
CREATE TEMP TABLE history_template AS SELECT detail->'weekly_commitment_observation' observation FROM paige_act_executions WHERE event_id=${literal(templateEvent)};
-- Only the disposable test's expected coordinates are readable for role assertions.
GRANT SELECT ON history_processes,history_rows TO authenticated;
UPDATE paige_automation_triggers SET is_live=false,dark_reason='Disposable performance fixture' WHERE key='schedule.weekly_commitment_check';
DO $seed$ DECLARE t uuid; u uuid; result jsonb; aid uuid; BEGIN
 FOR k IN 1..2 LOOP
  t:=CASE WHEN k=1 THEN ${literal(tenant)}::uuid ELSE ${literal(foreign)}::uuid END;
  u:=CASE WHEN k=1 THEN ${literal(owner)}::uuid ELSE ${literal(otherOwner)}::uuid END;
  PERFORM set_config('test.actor',u::text,true); PERFORM set_config('test.tenant',t::text,true);
  result:=public.draft_weekly_commitment_check(gen_random_uuid(),'Synthetic history template '||k,1,'09:00','UTC'); aid:=(result->>'automation_id')::uuid;
  PERFORM public.control_weekly_commitment_check(aid,'authorize',1); PERFORM public.control_weekly_commitment_check(aid,'pause',1);
  INSERT INTO history_process_templates VALUES(aid,t,u);
 END LOOP;
 PERFORM set_config('test.actor',${literal(owner)},true); PERFORM set_config('test.tenant',${literal(tenant)},true);
END $seed$;
-- Synthetic scale setup only: clone the two actually authorized/paused templates.
-- Revalidating the same zone hundreds of times through pg_timezone_names dominates
-- Windows fixture setup. Suppress only that row guard during bulk seeding, then
-- restore/assert it BEFORE every measured read or security assertion. Act/authority
-- guards, FKs, unique intent identity and fingerprint trigger remain in force.
ALTER TABLE public.paige_automations DISABLE TRIGGER weekly_commitment_process_guard;
INSERT INTO history_processes SELECT gen_random_uuid(),gen_random_uuid(),tenant_id,actor_id,n
 FROM history_process_templates CROSS JOIN generate_series(2,50) n;
INSERT INTO history_processes SELECT t.id,a.id,t.tenant_id,t.actor_id,1
 FROM history_process_templates t JOIN public.paige_automation_acts a ON a.automation_id=t.id;
INSERT INTO public.paige_automations
 SELECT (jsonb_populate_record(NULL::public.paige_automations,to_jsonb(a)||jsonb_build_object(
 'id',h.id,'name','Synthetic accumulated history '||h.n,'updated_at',now(),
 'state','draft','granted_lane','confirm','conditions',public.weekly_commitment_conditions(h.id,1),
 'trigger_config',a.trigger_config||jsonb_build_object('request_id',gen_random_uuid())))).*
 FROM history_processes h JOIN history_process_templates t ON t.tenant_id=h.tenant_id
 JOIN public.paige_automations a ON a.id=t.id WHERE h.n>1;
INSERT INTO public.paige_automation_acts
 SELECT (jsonb_populate_record(NULL::public.paige_automation_acts,to_jsonb(a)||jsonb_build_object('id',h.act_id,'automation_id',h.id))).*
 FROM history_processes h JOIN history_process_templates t ON t.tenant_id=h.tenant_id
 JOIN public.paige_automation_acts a ON a.automation_id=t.id WHERE h.n>1;
UPDATE public.paige_automations a SET state=t.state,granted_lane=t.granted_lane
 FROM history_processes h JOIN history_process_templates p ON p.tenant_id=h.tenant_id
 JOIN public.paige_automations t ON t.id=p.id WHERE a.id=h.id AND h.n>1;
ALTER TABLE public.paige_automations ENABLE TRIGGER weekly_commitment_process_guard;
DO $guard$ BEGIN IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.paige_automations'::regclass AND tgname='weekly_commitment_process_guard')<>'O' THEN RAISE EXCEPTION 'fixture guard not restored'; END IF;
 IF EXISTS(SELECT 1 FROM history_processes h JOIN public.paige_automations a ON a.id=h.id WHERE a.conditions<>public.weekly_commitment_conditions(a.id,1) OR a.state<>'paused' OR a.trigger_config->>'authorized_by'<>h.actor_id::text) THEN RAISE EXCEPTION 'synthetic process contract mismatch'; END IF;
END $guard$;
INSERT INTO history_rows SELECT gen_random_uuid(),gen_random_uuid(),p.id,p.act_id,p.tenant_id,p.actor_id,g,'' FROM history_processes p CROSS JOIN generate_series(1,${depth}) g;
UPDATE history_rows SET corr='synthetic-history:'||event_id;
INSERT INTO paige_native_events(id,event_key,tenant_id,subject_table,subject_id,dedup_key,payload,occurred_at,processing_state)
 SELECT event_id,'schedule.weekly_commitment_check',tenant_id,'paige_automations',automation_id,corr,'{}',now()-(${depth}+2-g)*interval '7 days','done' FROM history_rows;
INSERT INTO paige_act_executions(event_id,automation_id,act_id,act_position,tenant_id,adapter_kind,capability_key,effective_lane,outcome,idempotency_key,correlation_ref,detail,settled_at)
 SELECT h.event_id,h.automation_id,h.act_id,1,h.tenant_id,'native','planning.weekly_commitment_check','auto','executed',h.corr,h.corr,
 jsonb_build_object('weekly_commitment_observation',t.observation||jsonb_build_object('tenant_id',h.tenant_id,'authorized_by',h.actor_id,'automation_id',h.automation_id,'event_id',h.event_id,'act_id',h.act_id,'correlation_ref',h.corr,'receipt_id',h.receipt_id)),now()
 FROM history_rows h CROSS JOIN history_template t;
INSERT INTO paige_workspace_events(tenant_id,actor_id,source_kind,source_id,source_revision,outcome,capability_key,detail)
 SELECT tenant_id,actor_id,'capability_run',receipt_id,0,'capability_succeeded','planning_weekly_commitment_check',jsonb_build_object('event_id',event_id,'act_id',act_id) FROM history_rows;
INSERT INTO paige_native_events(id,event_key,tenant_id,subject_table,subject_id,dedup_key,payload,occurred_at,processing_state)
 SELECT gen_random_uuid(),'schedule.weekly_commitment_check',tenant_id,'paige_automations',id,'synthetic-unknown:'||id,'{}',now()-interval '1 minute','error' FROM history_processes;
INSERT INTO paige_act_executions(event_id,automation_id,act_id,act_position,tenant_id,adapter_kind,capability_key,effective_lane,outcome,idempotency_key,correlation_ref)
 SELECT e.id,p.id,p.act_id,1,p.tenant_id,'native','planning.weekly_commitment_check','auto','ambiguous',e.dedup_key,e.dedup_key FROM history_processes p JOIN paige_native_events e ON e.dedup_key='synthetic-unknown:'||p.id;
ANALYZE paige_native_events; ANALYZE paige_act_executions; ANALYZE paige_workspace_events; ANALYZE paige_automations;
`;
    const explain=sql=>`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql};`;
    const before=Array.from({length:3},(_,n)=>`SELECT 'HISTORY_BEFORE_${n}';
SAVEPOINT history_before;
SET LOCAL statement_timeout='5s'; SET LOCAL ROLE authenticated;
\\set ON_ERROR_STOP off
${explain('SELECT public.get_weekly_commitment_checks()')}
\\echo HISTORY_STATE_${n} :SQLSTATE
\\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT history_before; RESET ROLE; SET LOCAL statement_timeout='60s';
`).join('\n');
    const bind=sql=>sql.replaceAll('a.id',`(SELECT id FROM history_processes WHERE tenant_id=${literal(tenant)} AND n=1)`).replaceAll('_tid',`${literal(tenant)}::uuid`).replaceAll('_uid',`${literal(owner)}::uuid`);
    const planQuery=bind(match[1]);
    const after=Array.from({length:3},(_,n)=>`SELECT 'HISTORY_AFTER_${n}'; SET LOCAL ROLE authenticated;
${explain('SELECT public.get_weekly_commitment_checks()')}
RESET ROLE;
`).join('\n');
    const checks=[];
    const verify=(name,sql)=>{checks.push(name);return `SELECT '${name}'; SET LOCAL ROLE authenticated; DO $verify$ ${sql} END $verify$; RESET ROLE;`;};
    const ownChecks=verify('HISTORY_OWNER_SCOPE',`DECLARE d jsonb; BEGIN d:=public.get_weekly_commitment_checks();
 IF jsonb_array_length(d->'checks')<>50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'checks') c WHERE c->>'state'<>'paused' OR c->'next_run_at'<>'null'::jsonb OR c#>>'{last_run,status}'<>'unknown' OR c#>>'{last_verified_run,status}'<>'completed' OR c#>>'{last_verified_run,observation,tenant_id}'<>${literal(tenant)} OR c#>>'{last_verified_run,observation,authorized_by}'<>${literal(owner)}) THEN RAISE EXCEPTION 'history owner/result mismatch'; END IF;`);
    // Compare actual contracts where the baseline completes; the larger baseline
    // is deliberately capped rather than asking a timed-out query to run unbounded.
    const snapshotBefore=depth===100?`SET LOCAL ROLE authenticated; CREATE TEMP TABLE history_baseline_read AS SELECT public.get_weekly_commitment_checks()-'read_at' value; RESET ROLE;`:'';
    const sameBehavior=depth===100?verify('HISTORY_BASELINE_BEHAVIOR_EQUIVALENT',`BEGIN IF (SELECT value FROM history_baseline_read) IS DISTINCT FROM (public.get_weekly_commitment_checks()-'read_at') THEN RAISE EXCEPTION 'forward getter changed read contract'; END IF;`):'';
    const poison=[];
    const row=`event_id=(SELECT event_id FROM history_rows WHERE tenant_id=${literal(tenant)} AND automation_id=(SELECT id FROM history_processes WHERE tenant_id=${literal(tenant)} AND n=1) AND g=${depth})`;
    const receiptRow=`source_id=(SELECT receipt_id FROM history_rows WHERE tenant_id=${literal(tenant)} AND automation_id=(SELECT id FROM history_processes WHERE tenant_id=${literal(tenant)} AND n=1) AND g=${depth})`;
    const fallback=name=>verify(name,`DECLARE d jsonb; got text; wanted text; BEGIN
 SELECT event_id::text INTO wanted FROM history_rows WHERE tenant_id=${literal(tenant)} AND automation_id=(SELECT id FROM history_processes WHERE tenant_id=${literal(tenant)} AND n=1) AND g=${depth-1};
 d:=public.get_weekly_commitment_checks(); SELECT c#>>'{last_verified_run,event_id}' INTO got FROM jsonb_array_elements(d->'checks') c WHERE c->>'automation_id'=(SELECT id::text FROM history_processes WHERE tenant_id=${literal(tenant)} AND n=1);
 IF got IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'history correlation accepted invalid evidence'; END IF;`);
    for(const field of ['tenant_id','authorized_by','automation_id','event_id','act_id','correlation_ref','receipt_id']){
      const name='HISTORY_REJECT_OBSERVATION_'+field;poison.push(`SAVEPOINT history_poison; UPDATE paige_act_executions SET detail=jsonb_set(detail,'{weekly_commitment_observation,${field}}',to_jsonb(gen_random_uuid()::text)) WHERE ${row}; ${fallback(name)} ROLLBACK TO SAVEPOINT history_poison;`);
    }
    for(const [field,value] of [['event_id','wrong-event'],['act_id','wrong-act']]){
      const name='HISTORY_REJECT_RECEIPT_'+field;poison.push(`SAVEPOINT history_poison; UPDATE paige_workspace_events SET detail=jsonb_set(detail,'{${field}}',${literal(JSON.stringify(value))}::jsonb) WHERE ${receiptRow}; ${fallback(name)} ROLLBACK TO SAVEPOINT history_poison;`);
    }
    for(const [field,value] of [['tenant_id',foreign],['capability_key','unrelated_capability'],['outcome','capability_failed']]){
      const name='HISTORY_REJECT_RECEIPT_'+field;poison.push(`SAVEPOINT history_poison; UPDATE paige_workspace_events SET ${field}=${literal(value)} WHERE ${receiptRow}; ${fallback(name)} ROLLBACK TO SAVEPOINT history_poison;`);
    }
    poison.push(`SAVEPOINT history_poison; DELETE FROM paige_workspace_events WHERE ${receiptRow}; ${fallback('HISTORY_REJECT_MISSING_RECEIPT')} ROLLBACK TO SAVEPOINT history_poison;`);
    const roles=[];
    for(const [name,actor,t,role] of [['MEMBER',member,tenant,'authenticated'],['ADMIN',admin,tenant,'authenticated'],['FOREIGN_WORKSPACE',owner,foreign,'authenticated'],['ANON',owner,tenant,'anon'],['SERVICE',owner,tenant,'service_role']]){
      checks.push('HISTORY_REFUSE_'+name);roles.push(`SELECT 'HISTORY_REFUSE_${name}'; SELECT set_config('test.actor',${literal(actor)},true),set_config('test.tenant',${literal(t)},true); SET LOCAL ROLE ${role}; DO $deny$ BEGIN BEGIN PERFORM public.get_weekly_commitment_checks(); RAISE EXCEPTION 'expected authority refusal'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END; END $deny$; RESET ROLE;`);
    }
    const final=`SELECT set_config('test.actor',${literal(otherOwner)},true),set_config('test.tenant',${literal(foreign)},true);
${verify('HISTORY_FOREIGN_OWNER_SCOPE',`DECLARE d jsonb; BEGIN d:=public.get_weekly_commitment_checks(); IF jsonb_array_length(d->'checks')<>50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'checks') c WHERE c#>>'{last_verified_run,observation,tenant_id}'<>${literal(foreign)} OR c#>>'{last_verified_run,observation,authorized_by}'<>${literal(otherOwner)}) THEN RAISE EXCEPTION 'history foreign owner leaked'; END IF;`)}
RESET ROLE;
DO $unchanged$ BEGIN IF (SELECT getter_body FROM history_originals) IS DISTINCT FROM (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_weekly_commitment_checks()'::regprocedure) THEN RAISE EXCEPTION 'getter body changed'; END IF; END $unchanged$;
SELECT 'HISTORY_COMPLETE'; ROLLBACK;`;
    const script=setup+'\n'+beforeGetter+'\n'+before+'\n'+snapshotBefore+'\n'+creates.join('\n')+'\n'+afterGetter+'\n'+after+`\nSELECT 'HISTORY_PLAN';\n${explain(planQuery)}\nSELECT 'HISTORY_LATEST_PLAN';\n${explain(bind(latest[1]))}\n`+ownChecks+'\n'+sameBehavior+'\n'+poison.join('\n')+'\n'+roles.join('\n')+'\n'+final;
    // One transaction contains setup, six bounded plans and independent negative cases.
    // SQL statements retain their own 5s/60s limits; the whole scenario has a finite cap.
    const output=run(script,{actor:owner,tenant,timeout:180000});
    assert(output.includes('HISTORY_COMPLETE'),'all required SQL assertions finished');
    const segments=output.replaceAll('\r','').split(/HISTORY_(BEFORE_\d|AFTER_\d|PLAN|LATEST_PLAN)\n/);
    const metrics={before:[],after:[],plan:null,latest_plan:null};
    for(let i=1;i<segments.length;i+=2){const name=segments[i],text=segments[i+1];const at=text.indexOf('[');if(name.startsWith('BEFORE_')){
      const state=text.match(/HISTORY_STATE_\d (\w+)/)?.[1];assert(['00000','57014'].includes(state),`only measured success or bounded timeout: ${state}`);
      metrics.before.push(state==='57014'?{timeout:true,lower_bound_ms:5000}:JSON.parse(text.slice(at,text.indexOf('\nHISTORY_STATE_')))[0]);
    }else {let end=text.lastIndexOf('\n]')+2;const data=JSON.parse(text.slice(at,end))[0];if(name==='PLAN')metrics.plan=data;else if(name==='LATEST_PLAN')metrics.latest_plan=data;else metrics.after.push(data);}}
    assert.equal(metrics.before.length,3);assert.equal(metrics.after.length,3);
    onMeasurement?.({history_per_process:depth,metrics});
    const times=metrics.after.map(p=>p['Execution Time']);assert(times.every(Number.isFinite));assert(median(times)<1000,'actual 50-process owner RPC below the 2s reader ceiling with margin');
    const planText=JSON.stringify(metrics.plan);
    assert(planText.includes(names[1]),'historical receipt comparison uses its natural indexed access path');
    assert(planText.includes(names[0]),'historical lookup uses the natural event-recency access path');
    assert(JSON.stringify(metrics.latest_plan).includes(names[0]),'actual latest-attempt lookup uses the recency index');
    scenarios.push({history_per_process:depth,owner_processes:50,foreign_processes:50,seeded_history_rows:depth*100,latest_unknown_rows:100,metrics,after_median_ms:median(times),assertions:checks.length,checks,lookup_sql_sha256:digest(match[1])});
    assert.deepEqual(json('SELECT jsonb_build_array((SELECT count(*) FROM paige_automations),(SELECT count(*) FROM paige_native_events),(SELECT count(*) FROM paige_act_executions),(SELECT count(*) FROM paige_workspace_events));'),beforeCounts,'transactional fixture leaves no rows/effects');
    assert.equal(run(`SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN (${names.map(literal).join(',')});`),'2','rollback restores applied indexes');
  }
  return {status:'PASS',migration,migration_sha256:digest(ddl),before_getter_sha256:digest(beforeGetter),after_getter_sha256:digest(afterGetter),scenarios,behavior:'actual original/repaired owner RPCs and exact extracted repaired historical SQL; unchanged authority/state/receipt contract and tenant/role/correlation negatives',boundary:'Seeded synthetic accumulated history in the existing disposable PostgreSQL transaction, rolled back. Bulk process copies use two actually authorized/paused templates; only weekly process row guard is suppressed during setup, restored and asserted before plans/negatives. Same disclosed Auth/context/infrastructure doubles; not production workload, authenticated customer acceptance or real historical execution count.'};
}
