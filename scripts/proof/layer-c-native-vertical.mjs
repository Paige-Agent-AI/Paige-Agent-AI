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
//   F  dispatch claim   → a held act redeemed to accepted_for_execution, then eight separate database sessions
//                         race paige_claim_act_dispatch at once: exactly one gets the claim, the outcome is
//                         unchanged and nothing is dispatched by the claim itself.
//   G  automatic crash  → the state a dispatcher leaves when it dies after claiming: accepted_for_execution, a
//                         claim, nothing landed, the event out of attempts. While the claim is live a re-drive fires
//                         nothing; once it is stale the reconciler re-opens the event and the real drainer re-takes
//                         the claim and runs it exactly once; further passes and drains write nothing more.
//   H  approval crash   → the executor died after redeeming and claiming: the approval row stays locked, so the
//                         owner's retry is answered "in progress" and nothing runs. The reconciler releases the
//                         stale lock; the owner's approval then runs it exactly once, and again does nothing.
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
import { stripVTControlCharacters } from "node:util";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { retireSyntheticTenantSQL } from "./operator-postgres-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (process.argv.includes("--owner-task-native") || process.argv.includes("--owner-task-human-control")) {
  await ownerTaskNativeProof();
  process.exit(0);
}

// A second mode of the incumbent native proof, not a second runtime/test engine.
// Real recorder/mint/approve/claim/bridge/CRM/readback/reconciler functions run
// against disposable PostgreSQL. Auth, display/realtime and unrelated weekly work
// are explicit fixture ports; this is NOT a full Supabase schema replay.
async function ownerTaskNativeProof() {
  const humanControl = process.argv.includes("--owner-task-human-control");
  const ci = process.argv.includes("--postgres");
  assert.ok(!ci || process.env.CI === "true", "--postgres requires the disposable CI service");
  assert.ok(!ci || !process.env.PGHOST || ["localhost", "127.0.0.1"].includes(process.env.PGHOST), "loopback only");
  const directory = resolve(root, "work/owner-task-native-proof"); mkdirSync(directory, { recursive: true });
  const scratch = mkdtempSync(resolve(directory, "run-"));
  const bin = process.env.OWNER_TASK_PG_BIN ?? (process.platform === "win32" ? "C:/Program Files/PostgreSQL/16/bin" : "");
  const exe = name => bin ? resolve(bin, name + (process.platform === "win32" ? ".exe" : "")) : name;
  const port = ci ? 5432 : Number(process.env.OWNER_TASK_PG_PORT ?? 65455);
  const database = `int336_test_owner_task_${process.pid}`;
  const data = resolve(scratch, "data"); assert.ok(data.startsWith(scratch + (process.platform === "win32" ? "\\" : "/")));
  const args = db => ["-X", "-q", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", db, "-A", "-t", "-v", "ON_ERROR_STOP=1"];
  const call = (name, argv, options = {}) => execFileSync(exe(name), argv, { encoding: "utf8", windowsHide: true, timeout: 30000, ...options });
  const sql = (text, db = database) => call("psql", args(db), { input: text }).trim();
  const text = file => readFileSync(resolve(root, file), "utf8");
  const migration = text("supabase/migrations/20271108241000_owner_task_native_bridge.sql");
  const fn = (file, name, acl = false) => {
    const source = text("supabase/migrations/" + file);
    const match = source.match(new RegExp("create(?: or replace)? function public\\." + name + "\\s*\\([\\s\\S]*?\\bas\\s+(\\$[a-z_0-9]*\\$)[\\s\\S]*?\\1;", "i"));
    assert.ok(match, "actual native function " + name);
    return match[0] + (acl ? [...source.matchAll(new RegExp("(?:revoke|grant)[^;]*on function public\\." + name + "\\([^;]*;", "gi"))].map(m => m[0]).join("\n") : "");
  };
  const table = (file, name) => {
    const match = text("supabase/migrations/" + file).match(new RegExp("create table if not exists public\\." + name + " \\([\\s\\S]*?\\n\\);", "i"));
    assert.ok(match, "actual native table " + name); return match[0];
  };
  const literal = value => value === null ? "NULL" : "'" + String(value).replaceAll("'", "''") + "'";
  const json = value => literal(JSON.stringify(value)) + "::jsonb";
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const actor = id(1), tenant = id(2), other = id(9);
  const service = "set role service_role;set request.jwt.claims='{\"role\":\"service_role\"}';";
  const native = (name, values) => JSON.parse(sql(service + "select to_jsonb(public." + name + "(" + values.join(",") + "))::text;"));
  const cases = [];
  const check = (name, callback) => { callback(); cases.push(name); console.log("PASS " + name); };
  const refuses = (statement, code) => assert.throws(() => sql(statement), new RegExp(code));
  let started = false;
  try {
    if (!ci) {
      const probe = createServer(); await new Promise((yes, no) => { probe.once("error", no); probe.listen(port, "127.0.0.1", yes); });
      await new Promise(yes => probe.close(yes));
      call("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "--no-locale", "--encoding=UTF8", "--no-sync"]);
      call("pg_ctl", ["-D", data, "-l", resolve(scratch, "server.log"), "-o", `-h 127.0.0.1 -p ${port} -F`, "-w", "-t", "30", "start"], { stdio: "ignore" });
      started = true;
      // Reproduce a shared CI cluster where an earlier proof created this role
      // without Supabase's BYPASSRLS attribute. Only our fresh local cluster is seeded.
      sql("create role service_role nobypassrls;", "postgres");
    }
    sql("create database " + database, "postgres");
    sql(`do $$begin
      if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;
      if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;
      if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;
      -- Earlier proofs share CI's disposable cluster and can create this role
      -- without Supabase's attributes. Normalize the fixture, never production.
      alter role service_role nosuperuser inherit bypassrls;
      create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
      create function auth.jwt()returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.uid()returns uuid language sql as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
      create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
      create function is_platform_owner()returns boolean language sql as $$select false$$;
      create function current_user_tenant_id()returns uuid language sql as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
      create function trust_effective_rung()returns int language sql as $$select 3$$;
      create function resolve_tool_autonomy(uuid,text)returns text language sql as $$select 'confirm'::text$$;
      create function is_tenant_member(uuid)returns boolean language sql as $$select false$$;
      create table tenants(id uuid primary key,status text,archived_at timestamptz,lifecycle_execution_paused boolean default false);
      create table profiles(user_id uuid primary key,active_tenant_id uuid);
      create table tenant_members(tenant_id uuid,user_id uuid,role text,status text,joined_at timestamptz default clock_timestamp());
      create table audit_logs(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),action text not null,entity text not null,entity_id uuid,data jsonb,created_at timestamptz default now());
      create table tenant_tool_autonomy(tenant_id uuid,tool_key text,mode text);
      create table clients(id uuid primary key,tenant_id uuid,linked_user_id uuid,assigned_coach_user_id uuid,primary_business_id uuid,
        account_number text,first_name text,last_name text,lifecycle_stage text,source text,status text default 'active',updated_at timestamptz default clock_timestamp());
      create table businesses(id uuid,tenant_id uuid,owner_user_id uuid);create table client_notes(id uuid);create table deals(id uuid,tenant_id uuid);
      create table tasks(id uuid primary key default gen_random_uuid(),tenant_id uuid,user_id uuid not null,title text,description text,status text,
        created_at timestamptz default clock_timestamp(),updated_at timestamptz,biz_id uuid,deal_id uuid,due_date timestamptz,track text,metadata jsonb);
      create table crm_command_results(tenant_id uuid,idempotency_key text,command_hash text,actor_user_id uuid,action text,result jsonb,unique(tenant_id,actor_user_id,idempotency_key));
      create table crm_command_previews(tenant_id uuid,actor_user_id uuid,preview_key text,command_hash text,result jsonb);
      create table paige_workspace_events(id uuid default gen_random_uuid(),occurred_at timestamptz default clock_timestamp(),tenant_id uuid,actor_id uuid,
        source_kind text,source_id uuid,source_revision bigint,outcome text,actor_agent_slug text,actor_agent_label text,capability_key text,
        job_attempt_id text,llm_trace_id uuid,release_id text,detail jsonb,unique(tenant_id,source_kind,source_id,source_revision,outcome));
      create function _workspace_event_display(text,text,text)returns jsonb language sql as $$select '{}'::jsonb$$;
      create schema realtime;create function realtime.send(jsonb,text,text,boolean)returns void language sql as $$select$$;
      create table paige_pending_approvals(id uuid primary key default gen_random_uuid(),type text,draft_content jsonb,summary text,category text,
        contact_id uuid,conversation_id uuid,tenant_id uuid,source text,status text,risk_level text,submitted_by_user_id uuid,metadata jsonb,
        claimed_at timestamptz,reviewed_at timestamptz);
      create unique index approval_occurrence on paige_pending_approvals((metadata->>'event_id'),(metadata->>'act_id'))where source='paige_orchestration';
      create table paige_journey_stage_transitions(id uuid,contact_id uuid,source_event text);
      create table paige_departments(slug text primary key);insert into paige_departments values('owner_ops');
      create table paige_subagents(slug text primary key);
      create function paige_fire_event_processor(uuid,uuid)returns void language sql as $$select$$;
      create function paige_reconcile_weekly_commitment_acts()returns int language sql as $$select 0$$;
      set check_function_bodies=off;` +
      table("20260711140000_action_bus.sql", "paige_action_kinds") +
      table("20261022000000_automations_the_process_record.sql", "paige_automation_triggers") +
      table("20261022000000_automations_the_process_record.sql", "paige_automations") +
      table("20261022000000_automations_the_process_record.sql", "paige_automation_acts") +
      table("20270119000000_contact_created_native_event.sql", "paige_native_events"));
    check("disposable service role matches authoritative Supabase RLS attributes even when created by an earlier proof",()=>{
      assert.deepEqual(JSON.parse(sql("select json_build_object('superuser',rolsuper,'bypassrls',rolbypassrls,'inherit',rolinherit)from pg_roles where rolname='service_role';")),
        {superuser:false,bypassrls:true,inherit:true});
    });
    sql(text("supabase/migrations/20270126000000_paige_act_execution_ledger.sql") +
      text("supabase/migrations/20271023000000_paige_act_dispatch_claim.sql") +
      fn("20271025000100_paige_dispatch_crash_recovery.sql", "paige_claim_act_dispatch", true) +
      fn("20270202000000_paige_approve_act_execution.sql", "paige_approve_act_execution", true) +
      fn("20270306000000_paige_orchestration_companion_minting_hardening.sql", "paige_orchestration_approval_content") +
      fn("20270306000000_paige_orchestration_companion_minting_hardening.sql", "paige_mint_orchestration_approval") +
      fn("20270317000000_paige_orchestration_guard_insert.sql", "paige_guard_orchestration_direct_approve") +
      fn("20270119000000_contact_created_native_event.sql", "trg_clients_emit_contact_created") +
      fn("20261022000000_automations_the_process_record.sql", "paige_automation_acts_fingerprint") +
      fn("20261022000000_automations_the_process_record.sql", "paige_automation_acts_changed") +
      fn("20261024000000_resolve_automation_autonomy.sql", "autonomy_lane_rank") +
      fn("20261024000000_resolve_automation_autonomy.sql", "autonomy_lane_of_rank") +
      fn("20261024000000_resolve_automation_autonomy.sql", "resolve_automation_autonomy") +
      fn("20271028000000_experience05_weekly_commitment_check.sql", "paige_reconcile_orchestration_acts", true) +
      `create trigger mint after insert or update on paige_act_executions for each row when(new.outcome='approval_pending')execute function paige_mint_orchestration_approval();
       create trigger approval_guard before insert or update on paige_pending_approvals for each row execute function paige_guard_orchestration_direct_approve();
       create trigger contact_source after insert on clients for each row execute function trg_clients_emit_contact_created();
       create trigger act_fingerprint after insert or update or delete on paige_automation_acts for each row execute function paige_automation_acts_changed();`);
    sql("set check_function_bodies=off;" +
      fn("20270516000000_crm_commands_speak_contact_methods.sql", "execute_crm_command_reversible") +
      fn("20270516000000_crm_commands_speak_contact_methods.sql", "execute_crm_command") +
      fn("20270204000000_governed_crm_contact_company_commands.sql", "read_crm_command_result") +
      fn("20270204000000_governed_crm_contact_company_commands.sql", "crm_actor_can_access_record") +
      fn("20270204000000_governed_crm_contact_company_commands.sql", "crm_tags_are_valid") +
      fn("20270107000000_receipt_correlation_and_detail.sql", "_record_workspace_rail_event") +
      fn("20270107000000_receipt_correlation_and_detail.sql", "record_capability_run") +
      text("supabase/migrations/20270523000000_crm_contact_name_idempotency.sql") +
      text("supabase/migrations/20271108121000_task_progress_contract.sql"));
    sql(`revoke all on function read_crm_command_result(uuid,uuid,jsonb,text)from public,anon,authenticated;grant execute on function read_crm_command_result(uuid,uuid,jsonb,text)to service_role;
      grant usage on schema public,auth to service_role,authenticated,anon;grant all on all tables in schema public to service_role;
      insert into tenants(id,status)values('${tenant}','active');insert into profiles values('${actor}','${tenant}'),('${other}','${tenant}');
      insert into tenant_members(tenant_id,user_id,role,status)values('${tenant}','${actor}','owner','active'),('${tenant}','${other}','admin','active');
      insert into auth.users(id)values('${actor}'),('${other}');
      insert into paige_action_kinds(slug,label,description,default_from_department,default_to_department,executor,requires_approval,default_autonomy_lane)
      values('owner.task','Internal task','Internal task for the owner team','owner_ops','owner_ops','record_only',false,'auto');
      insert into paige_automation_triggers(key,label,category,description,is_live)values('contact.created','Contact','records','Real native insert',true);`);
    const metadata = () => JSON.parse(sql("select json_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'body',prosrc)from pg_proc where oid='public.read_crm_command_result(uuid,uuid,jsonb,text)'::regprocedure;"));
    const original = metadata();
    const fixtures = [];
    const controlReview = process => JSON.parse(sql(`select jsonb_build_object('updated_at',p.updated_at,'process',public._owner_task_process_review(p),'acts',
      (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'position',a.position,'action_kind',a.action_kind,'tool_key',a.tool_key,'config',a.config)order by a.position,a.id),'[]')from paige_automation_acts a where a.automation_id=p.id))
      from paige_automations p where p.id='${process}';`));
    const human = who => `set role authenticated;set request.jwt.claims='{"role":"authenticated","sub":"${who}"}';`;
    const controlStatement = (process, action, review = controlReview(process), who = actor) => human(who)+
      `select control_owner_task_automation('${process}',${literal(action)},${literal(review.updated_at)}::timestamptz,${json(review.process)},${json(review.acts)})::text;`;
    const control = (process, action, review, who) => JSON.parse(sql(controlStatement(process, action, review, who)));
    let controlInstalled = false;
    function held(number) {
      const process = id(number), act = id(number + 1), contact = id(number + 2);
      sql(`insert into paige_automations(id,tenant_id,name,trigger_key,created_by,granted_lane,state)values('${process}','${tenant}','Native task ${number}','contact.created','${actor}','confirm','${controlInstalled ? "draft" : "live"}');
        insert into paige_automation_acts(id,automation_id,position,action_kind,config)values('${act}','${process}',1,'owner.task','{"title":"Native internal task"}');`);
      if (controlInstalled) control(process, "arm");
      sql(`insert into clients(id,tenant_id,first_name,last_name,account_number,source)values('${contact}','${tenant}','Synthetic','Contact','fixture-${number}','test');`);
      const event = sql(`select id from paige_native_events where subject_id='${contact}';`), correlation = id(number + 3);
      const row = native("paige_record_act_execution", [literal(event), literal(process), literal(act), "1", literal(tenant), "'native'", "'owner.task'", "'confirm'", "'approval_pending'", "null", literal(correlation), literal(correlation), "null", json({ snapshot_args: { title: "Native internal task" } }), "null", "null", "null"]);
      const f = { process, act, contact, event, correlation, row }; fixtures.push(f); return f;
    }
    const legacy = held(800); // Actual native recorder/companion before the new capture trigger exists.
    sql(migration); const after = metadata();
    let preControlLanded=null,preControlPending=null,preControlResult=null;
    if (humanControl) {
      // Genuine incumbent holds/results BEFORE220000, not reconstructed legacy
      // JSON. The forward migration must not hide a landed canonical result or
      // fabricate activation evidence for an old pending occurrence.
      preControlLanded=held(820);preControlPending=held(840);
      native("paige_approve_act_execution",[literal(preControlLanded.event),literal(preControlLanded.act),literal(actor)]);
      native("paige_claim_act_dispatch",[literal(preControlLanded.event),literal(preControlLanded.act),literal(randomUUID()),"interval '10 minutes'","true"]);
      preControlResult=native("execute_owner_task_act",[literal(preControlLanded.event),literal(preControlLanded.act),literal(preControlLanded.correlation)]);
      assert.equal(preControlResult.state,"found");
      // The production resolver body is installed unchanged; only unrelated
      // agency/operator helper ports are explicit fixture inputs. RPC authority
      // must still require the ordinary active owner/admin seat independently.
      sql(`create function agency_can_manage_child(uuid,uuid)returns boolean language sql as $$select coalesce(current_setting('test.agency',true),'')='true'$$;
        create function agency_team_role(uuid,uuid)returns text language sql as $$select null::text$$;
        create function is_platform_admin(uuid)returns boolean language sql as $$select coalesce(current_setting('test.operator',true),'')='true'$$;
        create function is_tenant_admin(uuid)returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.tenant_members where tenant_id=$1 and user_id=auth.uid()and status='active'and role in('owner','admin'))$$;`+
        fn("20260714144656_tier_rail_phaseB_agency_standing.sql", "current_user_tenant_id", true));
      const base = text("supabase/migrations/20261022000000_automations_the_process_record.sql");
      sql(base.slice(base.indexOf("ALTER TABLE public.paige_automations      ENABLE ROW LEVEL SECURITY;"), base.indexOf("-- ── 5."))+
        [...base.matchAll(/GRANT [^;]* ON public\.paige_(?:automations|automation_acts) TO authenticated;/g)].map(m=>m[0]).join("\n"));
      sql(text("supabase/migrations/20271108242000_owner_task_human_control.sql"));
      controlInstalled = true;
      check("human control exists as an authenticated-only exact five-argument domain writer", () => {
        const abi = "public.control_owner_task_automation(uuid,text,timestamptz,jsonb,jsonb)";
        assert.equal(sql(`select has_function_privilege('authenticated','${abi}','EXECUTE');`), "t");
        for (const role of ["anon", "service_role"]) assert.equal(sql(`select has_function_privilege('${role}','${abi}','EXECUTE');`), "f");
        assert.equal(sql(`select count(*)from paige_automations where owner_task_armed_at is not null;`), "0");
      });
    }
    check("public reader ABI/owner/ACL/config/definer preserved", () => { for (const key of ["oid", "owner", "acl", "config", "definer"]) assert.deepEqual(after[key], original[key], key); });
    check("private reader retains the installed authorization/hash body", () => {
      const body = JSON.parse(sql("select to_jsonb(prosrc)::text from pg_proc where oid='public._read_crm_command_result_scoped(uuid,uuid,jsonb,text)'::regprocedure;"));
      assert.equal(body, original.body.replace("if coalesce(auth.jwt()->>'role','')<>'service_role' or auth.uid() is not null", "if auth.uid() is not null"));
      assert.match(after.body, /auth\.jwt\(\)->>'role'/);
      assert.equal(sql("select has_function_privilege('service_role','public._read_crm_command_result_scoped(uuid,uuid,jsonb,text)','EXECUTE');"), "f");
    });
    check("reapplying the extraction fails closed instead of replacing the shared reader with recursion", () => {
      refuses(migration, "OWNER_TASK_READER_SOURCE_DRIFT");
      assert.deepEqual(metadata(), after);
    });
    const approve = (f, who = actor) => native("paige_approve_act_execution", [literal(f.event), literal(f.act), literal(who)]);
    const claim = f => native("paige_claim_act_dispatch", [literal(f.event), literal(f.act), literal(randomUUID()), "interval '10 minutes'", "true"]);
    const bridge = (f, read = false) => native(read ? "read_owner_task_act" : "execute_owner_task_act", [literal(f.event), literal(f.act), literal(f.correlation)]);
    const resultCount = f => sql(`select count(*)from crm_command_results where idempotency_key='${f.correlation}';`);
    const age = f => sql(`alter table paige_act_executions disable trigger trg_paige_act_executions_touch;
      update paige_act_executions set updated_at=now()-interval '3 days',dispatched_at=now()-interval '3 days'where id='${f.row.id}';
      alter table paige_act_executions enable trigger trg_paige_act_executions_touch;`);
    check("legacy held rows without DB-authored source evidence refuse and cannot be backfilled", () => {
      assert.equal(legacy.row.detail.owner_task_source, undefined); approve(legacy); claim(legacy);
      assert.equal(bridge(legacy).outcome, "failed"); assert.equal(bridge(legacy, true).state, "unknown");
      refuses(`update paige_act_executions set detail=jsonb_set(detail,'{owner_task_source}','{}')where id='${legacy.row.id}';`, "OWNER_TASK_LEGACY_CONTEXT_UNAVAILABLE");
      assert.equal(resultCount(legacy), "0");
    });
    const f = held(100);
    check("real native hold captures minimized context and mints one bound companion", () => {
      assert.equal(f.row.detail.owner_task_source.acts.length, 1); assert.equal(f.row.detail.owner_task_source.contact.id, f.contact);
      assert.equal(sql(`select count(*)from paige_pending_approvals where metadata->>'act_execution_id'='${f.row.id}';`), "1");
      assert.ok(!JSON.stringify(f.row.detail.owner_task_source.contact).includes("Synthetic"));
      assert.deepEqual(JSON.parse(sql(`select _owner_task_approval_projection(a)::text from paige_pending_approvals a where metadata->>'act_execution_id'='${f.row.id}';`)), f.row.detail.owner_task_approval);
      assert.equal(f.row.detail.owner_task_approval.draft_content.args.title, "Native internal task");
      assert.match(f.row.detail.owner_task_approval.summary, /Native internal task/);
    });
    check("native held evidence and args cannot be replaced", () => {
      refuses(`update paige_act_executions set detail=jsonb_set(detail,'{owner_task_source}','{}')where id='${f.row.id}';`, "OWNER_TASK_HELD_CONTEXT_IMMUTABLE");
      refuses(`update paige_act_executions set detail=jsonb_set(detail,'{snapshot_args}','{}')where id='${f.row.id}';`, "OWNER_TASK_HELD_CONTEXT_IMMUTABLE");
      refuses(`update paige_act_executions set detail=jsonb_set(detail,'{owner_task_approval}','{}')where id='${f.row.id}';`, "OWNER_TASK_HELD_CONTEXT_IMMUTABLE");
      refuses(`update paige_act_executions set adapter_kind='n8n'where id='${f.row.id}';`, "OWNER_TASK_HELD_CONTEXT_IMMUTABLE");
      refuses(`update paige_act_executions set act_position=2 where id='${f.row.id}';`, "OWNER_TASK_HELD_CONTEXT_IMMUTABLE");
    });
    for (const [label, assignment] of [
      ["visible summary", "summary='Different task shown for review'"],
      ["whole draft content", "draft_content='\"Different display\"'::jsonb"],
      ["subject", "draft_content=jsonb_set(draft_content,'{subject}','\"Different subject\"')"],
      ["preview", "draft_content=jsonb_set(draft_content,'{preview}','\"Different preview\"')"],
      ["body", "draft_content=jsonb_set(draft_content,'{body}','\"Different body\"')"],
      ["draft capability", "draft_content=jsonb_set(draft_content,'{capability}','\"other.action\"')"],
      ["draft title args", "draft_content=jsonb_set(draft_content,'{args,title}','\"Different task title\"')"],
      ["draft extra args", "draft_content=jsonb_set(draft_content,'{args,description}','\"Different description\"')"],
      ["category", "category='other.action'"],
      ["risk", "risk_level='low'"],
      ["tenant", `tenant_id='${other}'`],
      ["contact visibility", `contact_id='${f.contact}'`],
      ["conversation", `conversation_id='${other}'`],
      ["submitted actor", `submitted_by_user_id='${other}'`],
      ["metadata args", "metadata=jsonb_set(metadata,'{snapshot_args,title}','\"Different metadata title\"')"],
      ["metadata process", `metadata=jsonb_set(metadata,'{automation_id}',${json(other)})`],
      ["metadata capability", "metadata=jsonb_set(metadata,'{capability_id}','\"other.action\"')"],
      ["metadata source", "metadata=jsonb_set(metadata,'{source}','\"other.source\"')"],
    ]) check(`DB-minted owner.task ${label} cannot change before review`, () => {
      refuses(`update paige_pending_approvals set ${assignment} where metadata->>'act_execution_id'='${f.row.id}';`, "OWNER_TASK_APPROVAL_CONTEXT_IMMUTABLE");
      assert.equal(resultCount(f), "0");
    });
    check("a forged owner.task companion INSERT cannot substitute a different review description", () => {
      refuses(`insert into paige_pending_approvals(type,draft_content,summary,category,contact_id,conversation_id,tenant_id,source,status,risk_level,submitted_by_user_id,metadata)
        select type,draft_content,'Different inserted approval',category,contact_id,conversation_id,tenant_id,source,status,risk_level,submitted_by_user_id,metadata
        from paige_pending_approvals where metadata->>'act_execution_id'='${f.row.id}' on conflict do nothing;`, "OWNER_TASK_APPROVAL_CONTEXT_IMMUTABLE");
      assert.equal(sql(`select count(*)from paige_pending_approvals where metadata->>'act_execution_id'='${f.row.id}';`), "1");
    });
    check("JWT caller cannot rewrite displayed task while the incumbent source/coordinate/approve guards remain intact", () => {
      refuses(`set request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';update paige_pending_approvals set summary='Rewritten by reviewer' where metadata->>'act_execution_id'='${f.row.id}';`, "OWNER_TASK_APPROVAL_CONTEXT_IMMUTABLE");
      refuses(`update paige_pending_approvals set source='other' where metadata->>'act_execution_id'='${f.row.id}';`, "ORCH_APPROVAL_SOURCE_IMMUTABLE");
      refuses(`update paige_pending_approvals set metadata=jsonb_set(metadata,'{act_id}',${json(other)}) where metadata->>'act_execution_id'='${f.row.id}';`, "ORCH_APPROVAL_COORDS_IMMUTABLE");
      refuses(`set request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';update paige_pending_approvals set status='approved' where metadata->>'act_execution_id'='${f.row.id}';`, "ORCH_APPROVAL_MUST_EXECUTE");
    });
    check("native operational claim/recovery metadata remains editable without changing the held approval", () => {
      sql(`update paige_pending_approvals set claimed_at=now(),metadata=metadata||'{"execute_note":"pending review","act_outcome":"approval_pending"}' where metadata->>'act_execution_id'='${f.row.id}';
        update paige_pending_approvals set claimed_at=null where metadata->>'act_execution_id'='${f.row.id}';`);
      assert.deepEqual(JSON.parse(sql(`select _owner_task_approval_projection(a)::text from paige_pending_approvals a where metadata->>'act_execution_id'='${f.row.id}';`)), f.row.detail.owner_task_approval);
    });
    check("other approval types and other orchestration capabilities retain legitimate description/argument editing", () => {
      const editable = id(1900), otherAct = id(1901), otherEvent = id(1902);
      sql(`insert into paige_pending_approvals(id,type,source,status,tenant_id,summary,draft_content,metadata)values('${editable}','comms_draft','paige_mcp','pending','${tenant}','Original draft','{"args":{"title":"Original"}}','{}');
        update paige_pending_approvals set summary='Edited draft',draft_content='{"args":{"title":"Edited"}}',metadata='{"note":"editable"}' where id='${editable}';
        insert into paige_pending_approvals(id,type,source,status,tenant_id,summary,draft_content,metadata)values('${otherAct}','other','paige_orchestration','pending','${tenant}','Other capability','{}','{"event_id":"${otherEvent}","act_id":"${otherAct}","act_execution_id":"${otherAct}","capability_id":"owner.other"}');
        update paige_pending_approvals set summary='Edited other capability',draft_content='{"args":{"title":"Edited"}}' where id='${otherAct}';`);
      assert.equal(sql(`select summary from paige_pending_approvals where id='${editable}';`), "Edited draft");
      assert.equal(sql(`select summary from paige_pending_approvals where id='${otherAct}';`), "Edited other capability");
    });
    const corruptDisplay = held(1920); approve(corruptDisplay); claim(corruptDisplay);
    check("privileged corruption of displayed summary/args independently refuses pre-effect in the native bridge", () => {
      const before = sql("select count(*)from tasks;");
      // Fixture-only superuser corruption, explicitly bypassing JUST the new
      // trigger; the incumbent coordinate/status guard and real bridge still run.
      sql(`alter table paige_pending_approvals disable trigger paige_owner_task_approval_context;
        update paige_pending_approvals set summary='Different task the owner saw',draft_content=jsonb_set(draft_content,'{args,title}','"Different task the owner saw"') where metadata->>'act_execution_id'='${corruptDisplay.row.id}';
        alter table paige_pending_approvals enable trigger paige_owner_task_approval_context;`);
      const result = bridge(corruptDisplay); assert.equal(result.outcome, "failed"); assert.equal(result.reason, "reviewed_approval_changed");
      assert.equal(resultCount(corruptDisplay), "0"); assert.equal(sql("select count(*)from tasks;"), before);
      // The unchanged operational claim can still be released; it cannot bless
      // the corrupted semantic content or authorize an effect.
      sql(`update paige_pending_approvals set claimed_at=null where metadata->>'act_execution_id'='${corruptDisplay.row.id}';`);
    });
    const legacyDisplay = held(1940); approve(legacyDisplay); claim(legacyDisplay);
    check("legacy/corrupt native source without original approval binding refuses without reconstructing it", () => {
      sql(`alter table paige_act_executions disable trigger paige_owner_task_hold_context;
        update paige_act_executions set detail=detail-'owner_task_approval' where id='${legacyDisplay.row.id}';
        alter table paige_act_executions enable trigger paige_owner_task_hold_context;`);
      const result = bridge(legacyDisplay); assert.equal(result.outcome, "failed"); assert.equal(result.reason, "reviewed_approval_changed");
      assert.equal(resultCount(legacyDisplay), "0");
      refuses(`update paige_act_executions set detail=detail||${json({owner_task_approval: legacyDisplay.row.detail.owner_task_approval})} where id='${legacyDisplay.row.id}';`, "OWNER_TASK_HELD_CONTEXT_IMMUTABLE");
      refuses(`update paige_pending_approvals set summary='Reconstructed display' where metadata->>'act_execution_id'='${legacyDisplay.row.id}';`, "OWNER_TASK_LEGACY_APPROVAL_UNAVAILABLE");
    });
    check("approval is redeemed once; later reviewer cannot replace original native actor", () => {
      assert.equal(approve(f).detail.approved_by, actor); assert.equal(approve(f, other).detail.approved_by, actor); assert.ok(claim(f).id);
      refuses(`update paige_act_executions set detail=jsonb_set(detail,'{approved_by}',${json(other)})where id='${f.row.id}';`, "OWNER_TASK_HELD_CONTEXT_IMMUTABLE");
    });
    check("canonical task/result/receipt written once and native replay is zero effect", () => {
      const r = bridge(f); assert.equal(r.state, "found"); assert.equal(r.result.readback.assignee_user_id, actor); assert.equal(r.result.receipt_recorded, true);
      assert.equal(bridge(f).result.readback.id, r.result.readback.id);
      assert.equal(sql(`select count(*)from crm_command_results where idempotency_key='${f.correlation}';`), "1");
      assert.equal(sql(`select count(*)from tasks where id='${r.result.readback.id}';`), "1");
    });
    check("public JWT guard and private-core/bridge ACL remain closed", () => {
      refuses(`select read_crm_command_result('${tenant}','${actor}','{}','x');`, "CRM_INTERNAL_EXECUTOR_REQUIRED");
      for (const name of ["read_owner_task_act", "execute_owner_task_act"]) {
        assert.equal(sql(`select has_function_privilege('authenticated','public.${name}(uuid,uuid,text)','EXECUTE');`), "f");
        refuses(`set role service_role;select ${name}('${f.event}','${f.act}','${f.correlation}');`, "OWNER_TASK_INTERNAL_ONLY");
        refuses(`set role service_role;set request.jwt.claims='{"role":"service_role","sub":"${actor}"}';select ${name}('${f.event}','${f.act}','${f.correlation}');`, "OWNER_TASK_INTERNAL_ONLY");
      }
      for(const name of ["_owner_task_source_snapshot(uuid,uuid)","_read_owner_task_act(uuid,uuid,text)","_read_crm_command_result_scoped(uuid,uuid,jsonb,text)",
        "_owner_task_approval_projection(public.paige_pending_approvals)","paige_owner_task_approval_context()"])
        for(const role of ["anon","authenticated","service_role"])
          assert.equal(sql(`select has_function_privilege('${role}','public.${name}','EXECUTE');`), "f");
    });
    check("lost ack is adopted by existing JWT-less cron without a journey transition", () => {
      sql(`update paige_act_executions set updated_at=now()-interval '2 days',dispatched_at=now()-interval '2 days'where id='${f.row.id}';
        alter table paige_act_executions disable trigger trg_paige_act_executions_touch;
        update paige_act_executions set updated_at=now()-interval '2 days'where id='${f.row.id}';
        alter table paige_act_executions enable trigger trg_paige_act_executions_touch;
        select paige_reconcile_orchestration_acts();`);
      assert.equal(sql(`select outcome from paige_act_executions where id='${f.row.id}';`), "executed");
      assert.equal(sql(`select status from paige_pending_approvals where metadata->>'act_execution_id'='${f.row.id}';`), "approved");
    });
    const landedDisplay = held(1960); approve(landedDisplay); claim(landedDisplay);
    check("later privileged display corruption cannot hide a landed receipt or block truthful operational recovery", () => {
      const landed = bridge(landedDisplay); assert.equal(landed.state, "found");
      sql(`alter table paige_pending_approvals disable trigger paige_owner_task_approval_context;
        update paige_pending_approvals set summary='Privileged corruption after execution' where metadata->>'act_execution_id'='${landedDisplay.row.id}';
        alter table paige_pending_approvals enable trigger paige_owner_task_approval_context;`);
      assert.equal(bridge(landedDisplay, true).result.readback.id, landed.result.readback.id);
      assert.equal(bridge(landedDisplay).result.readback.id, landed.result.readback.id);
      age(landedDisplay); sql("select paige_reconcile_orchestration_acts();");
      assert.equal(sql(`select outcome from paige_act_executions where id='${landedDisplay.row.id}';`), "executed");
      assert.equal(sql(`select status from paige_pending_approvals where metadata->>'act_execution_id'='${landedDisplay.row.id}';`), "approved");
      assert.equal(resultCount(landedDisplay), "1");
    });
    const g = held(200); approve(g); claim(g);
    check("semantic edits with unchanged timestamp are refused", () => {
      sql(`update paige_automations set conditions='[{"field":"source","op":"eq","value":"different"}]'where id='${g.process}';`);
      assert.equal(bridge(g).outcome, "failed"); assert.equal(sql(`select count(*)from crm_command_results where idempotency_key='${g.correlation}';`), "0");
    });
    const h = held(300); approve(h); claim(h);
    check("revoked original authority is unknown to recovery, never substituted or aged to absence", () => {
      sql(`update tenant_members set status='suspended'where user_id='${actor}';`);
      assert.equal(bridge(h, true).state, "unknown"); assert.equal(bridge(h).state, "unknown");
      sql(`alter table paige_act_executions disable trigger trg_paige_act_executions_touch;update paige_act_executions set updated_at=now()-interval '3 days',dispatched_at=now()-interval '3 days'where id='${h.row.id}';alter table paige_act_executions enable trigger trg_paige_act_executions_touch;select paige_reconcile_orchestration_acts();`);
      assert.equal(sql(`select outcome from paige_act_executions where id='${h.row.id}';`), "accepted_for_execution");
      sql(`update tenant_members set status='active'where user_id='${actor}';`);
    });
    let fixtureNumber=1000;
    for(const [label, mutation] of [
      ["sibling added to the reviewed act set", x=>`insert into paige_automation_acts(id,automation_id,position,action_kind,config)values('${id(fixtureNumber+8)}','${x.process}',2,'owner.task','{"title":"Unreviewed sibling"}');`],
      ["live act config changed", x=>`update paige_automation_acts set config='{"title":"Unreviewed title"}'where id='${x.act}';`],
      ["act substituted with historical bare tool", x=>`update paige_automation_acts set action_kind=null,tool_key='crm_create_task'where id='${x.act}';`],
      ["process trigger parameters changed", x=>`update paige_automations set trigger_config='{"scope":"different"}'where id='${x.process}';`],
      ["contact revision changed", x=>`update clients set updated_at=updated_at+interval '1 microsecond'where id='${x.contact}';`],
      ["event contact identity changed", x=>`update paige_native_events set payload='{"contact_id":"${other}"}'where id='${x.event}';`],
      ["companion no longer pending", x=>`update paige_pending_approvals set status='rejected'where metadata->>'act_execution_id'='${x.row.id}';`],
    ]) {
      const x=held(fixtureNumber);approve(x);claim(x);sql(mutation(x));
      check(label+" refuses without task or canonical result",()=>{assert.equal(bridge(x).outcome,"failed");assert.equal(resultCount(x),"0");});
      fixtureNumber+=20;
    }
    const switched=held(1200);approve(switched);claim(switched);
    check("original actor workspace switch never substitutes the retrying reviewer",()=>{
      sql(`update profiles set active_tenant_id='${other}'where user_id='${actor}';`);
      assert.equal(bridge(switched,true).state,"unknown");assert.equal(bridge(switched).state,"unknown");assert.equal(resultCount(switched),"0");
      sql(`update profiles set active_tenant_id='${tenant}'where user_id='${actor}';`);
    });
    const absent=held(1300);approve(absent);claim(absent);
    check("aged ambiguous task with unrelated journey evidence remains unresolved and never auto-executes",()=>{
      sql(`update paige_act_executions set outcome='ambiguous'where id='${absent.row.id}';
        insert into paige_journey_stage_transitions values(gen_random_uuid(),'${absent.contact}','${absent.correlation}');`);
      age(absent);sql("select paige_reconcile_orchestration_acts();");
      assert.equal(bridge(absent,true).state,"absent");assert.equal(resultCount(absent),"0");
      assert.equal(sql(`select outcome||':'||(detail->>'owner_task_readback')from paige_act_executions where id='${absent.row.id}';`),"ambiguous:absent");
    });
    const receiptFault=held(1400);approve(receiptFault);claim(receiptFault);
    check("native receipt failure rolls task and canonical result back atomically",()=>{
      const before=sql("select count(*)from tasks;");
      sql(`create function owner_task_fixture_receipt_refusal()returns trigger language plpgsql as $$begin raise exception 'fixture receipt refused' using errcode='23514';end$$;
        create trigger owner_task_fixture_receipt_refusal before insert on paige_workspace_events for each row execute function owner_task_fixture_receipt_refusal();`);
      try{assert.equal(bridge(receiptFault).state,"unknown");assert.equal(resultCount(receiptFault),"0");assert.equal(sql("select count(*)from tasks;"),before);}
      finally{sql("drop trigger owner_task_fixture_receipt_refusal on paige_workspace_events;drop function owner_task_fixture_receipt_refusal();");}
    });
    const malformed=held(1500);approve(malformed);claim(malformed);const malformedResult=bridge(malformed);
    check("malformed or unreceipted cached task result remains unknown after the recovery age bound",()=>{
      assert.equal(malformedResult.state,"found");
      sql(`update crm_command_results set result=jsonb_set(result,'{receipt_recorded}','false')where idempotency_key='${malformed.correlation}';`);
      assert.equal(bridge(malformed,true).state,"unknown");age(malformed);sql("select paige_reconcile_orchestration_acts();");
      assert.equal(sql(`select outcome||':'||(detail->>'owner_task_readback')from paige_act_executions where id='${malformed.row.id}';`),"accepted_for_execution:unknown");
      assert.equal(resultCount(malformed),"1");
    });
    const lock = held(400); approve(lock); claim(lock);
    const session = spawn(exe("psql"), args(database), { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let ready = "", errors = ""; session.stdout.on("data", d => { ready += d; }); session.stderr.on("data", d => { errors += d; });
    session.stdin.write(`begin;update paige_automations set state='paused'where id='${lock.process}';select 'LOCKED';\n`);
    for (let i = 0; !ready.includes("LOCKED") && i < 100; i++) await new Promise(yes => setTimeout(yes, 20));
    assert.ok(ready.includes("LOCKED"), errors);
    check("two sessions: pause lock yields proved pre-effect accepted retry, zero task", () => {
      const result = bridge(lock); assert.equal(result.outcome, "accepted_for_execution"); assert.equal(result.proven_no_effect, true);
      assert.equal(sql(`select count(*)from crm_command_results where idempotency_key='${lock.correlation}';`), "0");
    });
    session.stdin.end("commit;\n"); await new Promise((yes, no) => { session.on("error", no); session.on("exit", code => code === 0 ? yes() : no(Error(errors))); });
    check("committed pause is refused; no timestamp/version invention", () => assert.equal(bridge(lock).outcome, "failed"));
    let lockNumber=1600;
    for(const [label, statement]of [
      ["tenant",x=>`select 1 from tenants where id='${tenant}'for update;`],
      ["original actor profile",x=>`select 1 from profiles where user_id='${actor}'for update;`],
      ["original actor membership",x=>`select 1 from tenant_members where tenant_id='${tenant}'and user_id='${actor}'for update;`],
      ["approval companion",x=>`select 1 from paige_pending_approvals where metadata->>'act_execution_id'='${x.row.id}'for update;`],
      ["held ledger",x=>`select 1 from paige_act_executions where id='${x.row.id}'for update;`],
      ["reviewed act",x=>`select 1 from paige_automation_acts where id='${x.act}'for update;`],
      ["contact source",x=>`select 1 from clients where id='${x.contact}'for update;`],
    ]) {
      const x=held(lockNumber);approve(x);claim(x);lockNumber+=20;
      const peer=spawn(exe("psql"),args(database),{windowsHide:true,stdio:["pipe","pipe","pipe"]});
      let heldOutput="",heldError="";peer.stdout.on("data",d=>{heldOutput+=d;});peer.stderr.on("data",d=>{heldError+=d;});
      const closed=new Promise((yes,no)=>{peer.on("error",no);peer.on("exit",code=>code===0?yes():no(Error(heldError)));});
      try {
        peer.stdin.write(`begin;${statement(x)}select 'LOCKED';\n`);
        for(let i=0;!heldOutput.includes("LOCKED")&&i<150;i++)await new Promise(yes=>setTimeout(yes,20));
        assert.ok(heldOutput.includes("LOCKED"),heldError);
        check(`two sessions: ${label} NOWAIT contention is accepted/proven-no-effect, not terminal or uncertain`,()=>{
          const r=bridge(x);assert.equal(r.outcome,"accepted_for_execution");assert.equal(r.proven_no_effect,true);
          assert.equal(r.reason,"context_locked");assert.equal(resultCount(x),"0");
        });
      } finally {peer.stdin.end("rollback;\n");await closed;}
      check(`released ${label} contention permits only the original canonical task`,()=>{
        assert.equal(bridge(x).state,"found");assert.equal(bridge(x).state,"found");assert.equal(resultCount(x),"1");
      });
    }
    const competing=held(1800);approve(competing);
    const claims=await Promise.all(Array.from({length:8},()=>new Promise((yes,no)=>{
      const p=spawn(exe("psql"),[...args(database),"-c",service+`select to_jsonb(paige_claim_act_dispatch('${competing.event}','${competing.act}','${randomUUID()}','10 minutes',true))::text;`],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
      let out="",err="";const timer=setTimeout(()=>p.kill(),30000);
      p.stdout.on("data",d=>{out+=d;});p.stderr.on("data",d=>{err+=d;});p.on("error",no);
      p.on("exit",code=>{clearTimeout(timer);if(code!==0)no(Error(err));else yes(JSON.parse(out.trim()||"null"));});
    })));
    check("eight native database claim sessions yield one dispatch owner and no claim-time task effect",()=>{
      assert.equal(claims.filter(x=>x?.id).length,1);assert.equal(resultCount(competing),"0");
      assert.equal(sql(`select outcome from paige_act_executions where id='${competing.row.id}';`),"accepted_for_execution");
      assert.equal(bridge(competing).state,"found");assert.equal(bridge(competing).state,"found");assert.equal(resultCount(competing),"1");
    });
    if (humanControl) {
      const controlCasesStart=cases.length;
      let nextControl=3000;
      function draft(config={title:"Review the new contact"}, fixtureTenant=tenant, fixtureActor=actor) {
        const process=id(nextControl++),act=id(nextControl++);
        sql(`insert into paige_automations(id,tenant_id,name,trigger_key,created_by)values('${process}','${fixtureTenant}','Human task ${process}','contact.created','${fixtureActor}');
          insert into paige_automation_acts(id,automation_id,position,action_kind,config)values('${act}','${process}',1,'owner.task',${json(config)});`);
        return {process,act};
      }
      const auditCount=p=>sql(`select count(*)from audit_logs where entity_id='${p}';`);
      const armed=draft(), initial=controlReview(armed.process);
      check("ordinary owner arms only the exact reviewed stored process with confirm; canonical audit is configuration, not a task receipt",()=>{
        const before=sql("select count(*)from tasks;"), rails=sql("select count(*)from paige_workspace_events;");
        const r=control(armed.process,"arm",initial);
        assert.equal(r.state,"live");assert.equal(r.granted_lane,"confirm");assert.equal(r.execution_started,false);
        assert.equal(r.future_events_only,true);assert.equal(r.changed,true);assert.ok(r.armed_at);
        assert.equal(sql("select count(*)from tasks;"),before);assert.equal(sql("select count(*)from paige_workspace_events;"),rails);
        assert.equal(auditCount(armed.process),"1");
        const audit=JSON.parse(sql(`select to_jsonb(a)from audit_logs a where entity_id='${armed.process}';`));
        assert.equal(audit.user_id,actor);assert.equal(audit.action,"owner_task_automation.arm");
        assert.equal(audit.data.tenant_id,tenant);assert.equal(audit.data.execution_started,false);
      });
      check("an exact current arm replay is a truthful no-op; a stale pre-arm review cannot authorize again",()=>{
        assert.equal(control(armed.process,"arm").changed,false);assert.equal(auditCount(armed.process),"1");
        refuses(controlStatement(armed.process,"arm",initial),"OWNER_TASK_CONTROL_STALE");
      });
      check("complete process and ordered act snapshots plus exact native timestamp are independently required",()=>{
        const r=controlReview(armed.process);
        for(const review of [
          {...r,updated_at:"1900-01-01T00:00:00.000001Z"},
          {...r,updated_at:sql(`select to_jsonb(updated_at+interval '1 microsecond')from paige_automations where id='${armed.process}';`).replaceAll('"','')},
          {...r,process:{...r.process,category:"different"}},
          {...r,process:{...r.process,unreviewed:true}},
          {...r,acts:r.acts.map(a=>({...a,config:{title:"A different reviewed task"}}))},
          {...r,acts:[]},
        ])refuses(controlStatement(armed.process,"pause",review),"OWNER_TASK_CONTROL_STALE");
        assert.equal(auditCount(armed.process),"1");
      });
      check("direct authenticated/service writes cannot mint or rewrite activation, including fabricated timestamp plus JSON cutoff",()=>{
        const x=draft();
        for(const prefix of [human(actor),service]) {
          refuses(prefix+`update paige_automations set state='live'where id='${x.process}';`,"OWNER_TASK_HUMAN_CONTROL_REQUIRED");
          refuses(prefix+`update paige_automations set owner_task_armed_at='1900-01-01',trigger_config='{"armed_at":"1900-01-01"}'where id='${x.process}';`,"OWNER_TASK_HUMAN_CONTROL_REQUIRED");
          refuses(prefix+`update paige_automations set owner_task_armed_at='1900-01-01'where id='${armed.process}';`,"OWNER_TASK_HUMAN_CONTROL_REQUIRED");
        }
        assert.equal(sql(`select state||':'||(owner_task_armed_at is null)::text from paige_automations where id='${x.process}';`),"draft:true");
      });
      check("a directly inserted live shell cannot acquire an owner.task step and bypass human arming",()=>{
        const process=id(nextControl++),act=id(nextControl++);
        sql(human(actor)+`insert into paige_automations(id,tenant_id,name,trigger_key,created_by,state)values('${process}','${tenant}','Direct live shell','contact.created','${actor}','live');
          insert into paige_automation_acts(id,automation_id,position,action_kind,config)values('${act}','${process}',1,'owner.task','{"title":"Direct step"}');`);
        assert.equal(controlReview(process).process.state,"paused");assert.equal(controlReview(process).process.owner_task_armed_at,null);
        assert.equal(auditCount(process),"0");
      });
      check("service JWT, service JWT with forged subject, missing subject and anonymous callers cannot use human control",()=>{
        const x=draft(),r=controlReview(x.process),values=`'${x.process}','arm',${literal(r.updated_at)}::timestamptz,${json(r.process)},${json(r.acts)}`;
        for(const prefix of [service,service+`set request.jwt.claims='{"role":"service_role","sub":"${actor}"}';`,"set role anon;"])
          refuses(prefix+`select control_owner_task_automation(${values});`,"permission denied");
        refuses(`set role authenticated;set request.jwt.claims='{"role":"authenticated"}';select control_owner_task_automation(${values});`,"OWNER_TASK_CONTROL_FORBIDDEN");
        refuses(`set request.jwt.claims='{"role":"service_role","sub":"${actor}"}';select control_owner_task_automation(${values});`,"OWNER_TASK_CONTROL_FORBIDDEN");
      });
      for(const [label,mutation,restore,settings] of [
        ["ordinary member",`update tenant_members set role='member'where user_id='${actor}'`, `update tenant_members set role='owner'where user_id='${actor}'`,""],
        ["suspended seat",`update tenant_members set status='suspended'where user_id='${actor}'`, `update tenant_members set status='active'where user_id='${actor}'`,""],
        ["operator privilege without an active seat",`update tenant_members set status='suspended'where user_id='${actor}'`, `update tenant_members set status='active'where user_id='${actor}'`,"set test.operator='true';"],
        ["agency privilege without an active seat",`update tenant_members set status='suspended'where user_id='${actor}'`, `update tenant_members set status='active'where user_id='${actor}'`,"set test.agency='true';"],
        ["switched profile despite resolver fallback",`update profiles set active_tenant_id='${other}'where user_id='${actor}'`, `update profiles set active_tenant_id='${tenant}'where user_id='${actor}'`,""],
        ["deleted Auth identity",`update auth.users set deleted_at=now()where id='${actor}'`, `update auth.users set deleted_at=null where id='${actor}'`,""],
        ["banned Auth identity",`update auth.users set banned_until=now()+interval '1 day'where id='${actor}'`, `update auth.users set banned_until=null where id='${actor}'`,""],
      ]) check(label+" cannot mint human activation or audit success",()=>{
        const x=draft();sql(mutation+";");
        try {refuses(settings+controlStatement(x.process,"arm"),"OWNER_TASK_CONTROL_FORBIDDEN");assert.equal(auditCount(x.process),"0");}
        finally{sql(restore+";");}
      });
      check("active ordinary admin controls the same tenant process without impersonating its author",()=>{
        const x=draft();assert.equal(control(x.process,"arm",undefined,other).state,"live");
        assert.equal(sql(`select user_id from audit_logs where entity_id='${x.process}';`),other);
        assert.equal(control(x.process,"pause",undefined,other).state,"paused");
        assert.equal(control(x.process,"pause",undefined,other).changed,false);assert.equal(auditCount(x.process),"2");
      });
      for(const [label,mutation,restore]of[
        ["archived tenant",`update tenants set archived_at=now()where id='${tenant}'`,`update tenants set archived_at=null where id='${tenant}'`],
        ["lifecycle execution pause",`update tenants set lifecycle_execution_paused=true where id='${tenant}'`,`update tenants set lifecycle_execution_paused=false where id='${tenant}'`],
        ["ineligible tenant status",`update tenants set status='suspended'where id='${tenant}'`,`update tenants set status='active'where id='${tenant}'`],
      ])check(label+" cannot arm but the active owner can still brake the exact process",()=>{
        const x=draft();sql(mutation+";");
        try{refuses(controlStatement(x.process,"arm"),"OWNER_TASK_CONTROL_UNSUPPORTED");assert.equal(control(x.process,"pause").state,"paused");}
        finally{sql(restore+";");}
      });
      for(const [label,config] of [
        ["assignment",{title:"Review",assignee_user_id:actor}],
        ["external recipient",{title:"Review",to:"outside@example.invalid"}],
        ["dynamic title",{title:"Review {{payload.contact_id}}"}],
        ["dynamic description",{title:"Review",description:"Review ${payload.contact_id}"}],
        ["empty title",{title:" "}],
        ["non-string title",{title:{path:"payload.contact_id"}}],
        ["malformed description",{title:"Review",description:[]}],
        ["array configuration",[]],
        ["null title",{title:null}],
        ["string configuration","Review"],
      ])check("unsupported "+label+" refuses arm yet remains safely pausable",()=>{
        const x=draft(config);refuses(controlStatement(x.process,"arm"),"OWNER_TASK_CONTROL_UNSUPPORTED");
        assert.equal(control(x.process,"pause").state,"paused");assert.equal(auditCount(x.process),"1");
      });
      for(const [label,mutation] of [
        ["multi-step",x=>`insert into paige_automation_acts(id,automation_id,position,action_kind,config)values('${id(nextControl++)}','${x.process}',2,'owner.task','{"title":"Second"}');`],
        ["nonempty trigger configuration",x=>`update paige_automations set trigger_config='{"delay":1}'where id='${x.process}';`],
        ["conditions",x=>`update paige_automations set conditions='[{"field":"source","op":"eq","value":"test"}]'where id='${x.process}';`],
      ])check(label+" cannot arm; owner can pause the exact unsupported process",()=>{
        const x=draft();sql(mutation(x));refuses(controlStatement(x.process,"arm"),"OWNER_TASK_CONTROL_UNSUPPORTED");
        assert.equal(control(x.process,"pause").state,"paused");
      });
      check("bare historical tool-key drafts cannot be armed or misclassified as supported native actions",()=>{
        const x=draft();sql(`update paige_automation_acts set action_kind=null,tool_key='crm_create_task'where id='${x.act}';`);
        refuses(controlStatement(x.process,"arm"),"OWNER_TASK_CONTROL_UNSUPPORTED");assert.equal(auditCount(x.process),"0");
      });
      check("other process families retain their existing direct configuration/state/act editing contract",()=>{
        const process=id(nextControl++),act=id(nextControl++);
        sql(`insert into paige_action_kinds(slug,label,description,default_from_department,default_to_department,executor,requires_approval,default_autonomy_lane)
          values('owner.proof_other','Other proof act','Unrelated contract compatibility','owner_ops','owner_ops','record_only',false,'confirm');`);
        sql(human(actor)+`insert into paige_automations(id,tenant_id,name,trigger_key,created_by)values('${process}','${tenant}','Other process family','contact.created','${actor}');
          insert into paige_automation_acts(id,automation_id,position,action_kind,config)values('${act}','${process}',1,'owner.proof_other','{}');
          update paige_automations set state='live',trigger_config='{"existing":"configuration"}'where id='${process}';
          update paige_automation_acts set config='{"existing":"edit"}'where id='${act}';`);
        assert.equal(sql(`select state||':'||(owner_task_armed_at is null)::text from paige_automations where id='${process}';`),"live:true");
        assert.equal(auditCount(process),"0");
      });
      check("legacy live rows are never backfilled; human pause and explicit re-arm supply the first true activation",()=>{
        assert.equal(sql(`select owner_task_armed_at is null from paige_automations where id='${legacy.process}';`),"t");
        refuses(controlStatement(legacy.process,"arm"),"OWNER_TASK_CONTROL_LEGACY_REVIEW_REQUIRED");
        assert.equal(control(legacy.process,"pause").state,"paused");assert.ok(control(legacy.process,"arm").armed_at);
        assert.equal(legacy.row.detail.owner_task_source,undefined);
      });
      check("forward migration preserves a genuine pre220000 landed task/result and does not backfill a prior held source",()=>{
        assert.equal(preControlLanded.row.detail.owner_task_source.process.owner_task_armed_at,undefined);
        assert.equal(bridge(preControlLanded,true).result.readback.id,preControlResult.result.readback.id);
        assert.equal(bridge(preControlLanded).result.readback.id,preControlResult.result.readback.id);
        assert.equal(resultCount(preControlLanded),"1");
        const before=preControlPending.row.detail.owner_task_source;approve(preControlPending);claim(preControlPending);
        assert.equal(bridge(preControlPending).outcome,"failed");assert.equal(resultCount(preControlPending),"0");
        assert.deepEqual(JSON.parse(sql(`select detail->'owner_task_source'from paige_act_executions where id='${preControlPending.row.id}';`)),before);
        assert.equal(sql(`select owner_task_armed_at is null from paige_automations where id='${preControlPending.process}';`),"t");
      });
      check("unrelated bookkeeping and exact no-op act refresh preserve activation; semantic process/act edits invalidate it",()=>{
        const x=draft();control(x.process,"arm");const r=controlReview(x.process);
        sql(`update paige_automation_acts set config=config where id='${x.act}';update paige_automations set updated_at='1900-01-01'where id='${x.process}';`);
        assert.deepEqual(controlReview(x.process),r);
        sql(`update paige_automation_acts set config='{"title":"Changed after arm"}'where id='${x.act}';`);
        assert.equal(controlReview(x.process).process.owner_task_armed_at,null);assert.equal(controlReview(x.process).process.state,"paused");
        control(x.process,"arm");sql(`update paige_automations set name='Changed after review'where id='${x.process}';`);
        assert.equal(controlReview(x.process).process.owner_task_armed_at,null);assert.equal(controlReview(x.process).process.state,"paused");
      });
      check("a direct brake clears activation and a direct live transition cannot restore it",()=>{
        const x=draft();control(x.process,"arm");
        sql(human(actor)+`update paige_automations set state='paused'where id='${x.process}';`);
        assert.equal(controlReview(x.process).process.owner_task_armed_at,null);
        refuses(human(actor)+`update paige_automations set state='live'where id='${x.process}';`,"OWNER_TASK_HUMAN_CONTROL_REQUIRED");
      });
      check("an attempted auto grant revokes this confirm-only activation rather than widening execution",()=>{
        const x=draft();control(x.process,"arm");sql(human(actor)+`update paige_automations set granted_lane='auto'where id='${x.process}';`);
        assert.equal(controlReview(x.process).process.owner_task_armed_at,null);assert.equal(controlReview(x.process).process.state,"paused");
        assert.equal(control(x.process,"arm").granted_lane,"confirm");
      });
      check("events before first arm and before re-arm cannot create an approval; genuine fresh contact can execute once",()=>{
        const x=draft(),contact=id(nextControl++);
        sql(`insert into clients(id,tenant_id,first_name,last_name,account_number,source)values('${contact}','${tenant}','Synthetic','Before arm','fixture-old','test');`);
        const oldEvent=sql(`select id from paige_native_events where subject_id='${contact}';`);
        control(x.process,"arm");
        refuses(service+`select _owner_task_source_snapshot('${oldEvent}','${x.act}');`,"permission denied");
        refuses(`select _owner_task_source_snapshot('${oldEvent}','${x.act}');`,"OWNER_TASK_SOURCE_CHANGED");
        const oldKey=id(nextControl++);
        assert.throws(()=>native("paige_record_act_execution",[literal(oldEvent),literal(x.process),literal(x.act),"1",literal(tenant),"'native'","'owner.task'","'confirm'","'approval_pending'","null",literal(oldKey),literal(oldKey),"null",json({snapshot_args:{title:"Review the new contact"}}),"null","null","null"]),/OWNER_TASK_SOURCE_CHANGED/);
        assert.equal(sql(`select count(*)from paige_act_executions where event_id='${oldEvent}'and act_id='${x.act}';`),"0");
        assert.equal(sql(`select count(*)from paige_pending_approvals where metadata->>'event_id'='${oldEvent}'and metadata->>'act_id'='${x.act}';`),"0");
        const fresh=held(5000);approve(fresh);claim(fresh);assert.equal(bridge(fresh).state,"found");assert.equal(resultCount(fresh),"1");
        assert.equal(bridge(fresh).state,"found");assert.equal(resultCount(fresh),"1");
        const pending=held(5020);approve(pending);claim(pending);const snap=pending.row.detail.owner_task_source;
        control(pending.process,"pause");control(pending.process,"arm");
        assert.equal(bridge(pending).outcome,"failed");assert.equal(resultCount(pending),"0");
        assert.deepEqual(JSON.parse(sql(`select detail->'owner_task_source'from paige_act_executions where id='${pending.row.id}';`)),snap);
        control(fresh.process,"pause");assert.equal(bridge(fresh,true).state,"found");assert.equal(bridge(fresh).state,"found");
      });
      check("audit failure rolls back activation atomically and caller transaction rollback leaves no successful control",()=>{
        const x=draft(),r=controlReview(x.process);
        sql(`create function control_fixture_audit_failure()returns trigger language plpgsql as $$begin raise exception 'fixture control audit refused'using errcode='23514';end$$;
          create trigger control_fixture_audit_failure before insert on audit_logs for each row execute function control_fixture_audit_failure();`);
        try{refuses(controlStatement(x.process,"arm",r),"fixture control audit refused");}finally{sql("drop trigger control_fixture_audit_failure on audit_logs;drop function control_fixture_audit_failure();");}
        assert.deepEqual(controlReview(x.process),r);assert.equal(auditCount(x.process),"0");
        sql("begin;"+controlStatement(x.process,"arm",r)+"rollback;");assert.deepEqual(controlReview(x.process),r);assert.equal(auditCount(x.process),"0");
      });
      check("newly provisioned tenant uses the same writer and foreign workspace process is undisclosed",()=>{
        const newTenant=id(6000),newOwner=id(6001);
        sql(`insert into tenants(id,status)values('${newTenant}','trial');insert into auth.users(id)values('${newOwner}');
          insert into profiles values('${newOwner}','${newTenant}');insert into tenant_members(tenant_id,user_id,role,status)values('${newTenant}','${newOwner}','owner','active');`);
        const x=draft({title:"Future tenant contact review"},newTenant,newOwner),r=controlReview(x.process);
        refuses(controlStatement(x.process,"arm",r,actor),"OWNER_TASK_CONTROL_NOT_FOUND");
        assert.equal(control(x.process,"arm",r,newOwner).state,"live");
        assert.equal(sql(human(actor)+`select count(*)from paige_automations where id='${x.process}';`),"0");
        assert.equal(sql(`select user_id||':'||(data->>'tenant_id')from audit_logs where entity_id='${x.process}';`),newOwner+":"+newTenant);
      });
      for(const [label,statement]of[
        ["tenant",()=>`select 1 from tenants where id='${tenant}'for update;`],
        ["actor profile",()=>`select 1 from profiles where user_id='${actor}'for update;`],
        ["owner/admin seat",()=>`select 1 from tenant_members where tenant_id='${tenant}'and user_id='${actor}'for update;`],
        ["complete reviewed act set",x=>`select 1 from paige_automation_acts where id='${x.act}'for update;`],
        ["process",x=>`select 1 from paige_automations where id='${x.process}'for update;`],
      ]){
        const x=draft(),r=controlReview(x.process),peer=spawn(exe("psql"),args(database),{windowsHide:true,stdio:["pipe","pipe","pipe"]});
        let out="",err="";peer.stdout.on("data",d=>{out+=d;});peer.stderr.on("data",d=>{err+=d;});
        const closed=new Promise((yes,no)=>{peer.on("error",no);peer.on("exit",code=>code===0?yes():no(Error(err)));});
        try{peer.stdin.write(`begin;${statement(x)}select 'CONTROL_LOCKED';\n`);
          for(let i=0;!out.includes("CONTROL_LOCKED")&&i<150;i++)await new Promise(yes=>setTimeout(yes,20));
          assert.ok(out.includes("CONTROL_LOCKED"),err);
          check("two actual sessions: "+label+" contention refuses before arming or audit",()=>{
            refuses(controlStatement(x.process,"arm",r),"could not obtain lock");assert.equal(auditCount(x.process),"0");assert.deepEqual(controlReview(x.process),r);
          });
        }finally{peer.stdin.end("rollback;\n");await closed;}
        check("released "+label+" lock permits the same exact owner review once",()=>{assert.equal(control(x.process,"arm",r).state,"live");assert.equal(auditCount(x.process),"1");});
      }
      const race=draft(),raceReview=controlReview(race.process);
      const controlAttempts=await Promise.all(Array.from({length:8},()=>new Promise((yes,no)=>{
        const peer=spawn(exe("psql"),[...args(database),"-c",controlStatement(race.process,"arm",raceReview)],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
        let out="",err="";const timer=setTimeout(()=>peer.kill(),30000);
        peer.stdout.on("data",d=>{out+=d;});peer.stderr.on("data",d=>{err+=d;});peer.on("error",no);
        peer.on("exit",code=>{clearTimeout(timer);yes({code,out,err});});
      })));
      check("eight actual simultaneous owner controls mint one activation/audit; every loser is stale or NOWAIT refused",()=>{
        const succeeded=controlAttempts.filter(r=>r.code===0);assert.equal(succeeded.length,1);
        assert.equal(JSON.parse(succeeded[0].out).changed,true);
        for(const failure of controlAttempts.filter(r=>r.code!==0))assert.match(failure.err,/OWNER_TASK_CONTROL_STALE|could not obtain lock/);
        assert.equal(auditCount(race.process),"1");assert.equal(control(race.process,"arm").changed,false);
      });
      writeFileSync(resolve(scratch,"human-control-result.json"),JSON.stringify({passed:cases.length-controlCasesStart,cases:cases.slice(controlCasesStart),
        evidence:"actual selected native SQL + canonical resolver body; auth/agency/operator/Realtime ports; synthetic new-tenant fixture, not full provisioning",authenticatedQA:"NOT_RUN",fullSchema:"NOT_RUN"},null,2));
    }
    check("saved draft drives actual engine/C5 and native recorder/claim/CRM SQL, including receipt-backed replay", () => {
      const log = execFileSync(process.execPath, [resolve(root, "node_modules/vitest/vitest.mjs"), "run",
        "src/__tests__/automation-chat-draft-recovery.test.ts", "--testTimeout=30000", "--maxWorkers=2"], {
        cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000,
        env: { ...process.env, OWNER_TASK_NATIVE_DB: `postgresql://postgres@127.0.0.1:${port}/${database}`,
          PSQL_BIN: exe("psql"), TEMP: scratch, TMP: scratch },
      });
      writeFileSync(resolve(scratch, "engine-c5-native.log"), log);
      // CI colors the real Vitest summary even through a pipe. Keep its raw log,
      // then inspect the same report without terminal presentation controls.
      const report = stripVTControlCharacters(log);
      const passed = report.match(/Tests\s+(\d+) passed/);
      assert.ok(passed && Number(passed[1]) >= 43, "all native engine/C5 controls must actually pass");
      assert.doesNotMatch(report, /\d+ (?:failed|skipped)/, "the optional native SQL case must actually execute");
    });
    writeFileSync(resolve(scratch, "result.json"), JSON.stringify({ passed: cases.length, cases, database, port,
      evidence: "isolated-native-postgresql-selected-real-functions", fullSchema: "NOT_RUN", authenticatedQA: "NOT_RUN" }, null, 2));
    console.log(`PASS ${cases.length} native owner.task controls; evidence ${scratch}`);
  } finally {
    if (started) { call("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "30", "stop"]); console.log("PASS stopped only owned disposable PostgreSQL server"); }
  }
}
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
// One psql session per call, run concurrently (used to race separate database sessions against one row).
const sqlAsync = (text) => new Promise((res, rej) => {
  const child = spawn(psqlBin, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", dbUrl.toString(), "-c", text]);
  let out = ""; let err = "";
  const kill = setTimeout(() => child.kill("SIGKILL"), 30000);
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  child.on("close", (code) => { clearTimeout(kill); code === 0 ? res(out.trim()) : rej(new Error(err || `psql exited ${code}`)); });
});

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
function processRecord(tenantId, createdBy, lane, stageSlug, name = "Welcome new contact") {
  const automationId = one(`
    insert into public.paige_automations (tenant_id, name, trigger_key, conditions, created_by, granted_lane, state)
    values (${q(tenantId)}, ${q(name)}, 'contact.created', '[]'::jsonb, ${q(createdBy)}, 'confirm', 'draft')
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

  // ── F: the dispatch claim — of eight concurrent sessions exactly one may fire the act ────────────────
  const F = await workspace("claim-race");
  processRecord(F.tenantId, F.owner.id, "confirm", "paid_tier");
  const f = newContact(F.tenantId, F.owner.id, "Race");
  step("F eight concurrent sessions race the dispatch claim on one redeemed act: exactly one wins", async () => {
    const r = await post(drainer.base, { event_id: f.eventId }, keys.service);
    assert.deepEqual(r.json.act_outcomes, { approval_pending: 1 }, JSON.stringify(r.json));
    const actId = one(`select act_id from public.paige_act_executions where event_id = ${q(f.eventId)};`);
    assert.equal(one(`select (public.paige_approve_act_execution(${q(f.eventId)}, ${q(actId)}, ${q(F.owner.id)})).outcome::text;`), "accepted_for_execution");
    // A barrier, so the race is real lock contention rather than eight staggered sequential calls: one session
    // holds the row lock while the eight claimants queue behind it; when it commits, Postgres re-checks each
    // waiter's WHERE against the winner's committed claim.
    const holder = sqlAsync(`begin; select 1 from public.paige_act_executions where event_id = ${q(f.eventId)} for update; select pg_sleep(10); commit;`);
    const sleeping = `select count(*) from pg_stat_activity where query like '%pg_sleep(10)%' and state = 'active' and pid <> pg_backend_pid();`;
    for (let i = 0; i < 50 && count(sleeping) < 1; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(count(sleeping), 1, "the barrier session must hold the row lock before the claimants start");
    const claims = Promise.all(Array.from({ length: 8 }, () =>
      sqlAsync(`select (public.paige_claim_act_dispatch(${q(f.eventId)}, ${q(actId)}, gen_random_uuid())).id is not null;`)));
    const waiting = `select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%paige_claim_act_dispatch%' and pid <> pg_backend_pid();`;
    let queued = 0;
    for (let i = 0; i < 50 && queued < 8; i++) { await new Promise((r) => setTimeout(r, 50)); queued = count(waiting); }
    assert.equal(queued, 8, "all eight claimants must be queued on the row lock before the barrier commits");
    await holder;
    const results = await claims;
    assert.equal(results.filter((x) => x === "t").length, 1, `exactly one claimant: ${JSON.stringify(results)}`);
    assert.equal(results.filter((x) => x === "f").length, 7, `seven refused: ${JSON.stringify(results)}`);
    assert.equal(ledger(f.eventId).outcome, "accepted_for_execution");
    assert.match(one(`select detail->>'dispatch_claim' from public.paige_act_executions where event_id = ${q(f.eventId)};`), /^[0-9a-f-]{36}$/);
    assert.equal(count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(f.contactId)};`), 0);
  });

  // ── G/H: a dispatcher that dies after claiming (Slice 2b milestone 2) ──────────────────────────────────
  // The crash state is built from the engine's OWN held row (its deterministic idempotency/correlation keys), then
  // aged in replica mode so the touch trigger keeps the timestamps a real crash would leave. `reconcile` runs the
  // cron's function exactly as pg_cron does (service-role context, auth.uid() NULL).
  const reconcile = () => one(`select public.paige_reconcile_orchestration_acts();`);
  const transitions = (contactId) => count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(contactId)};`);

  const G = await workspace("crash-auto");
  const gProcess = processRecord(G.tenantId, G.owner.id, "confirm", "paid_tier");
  const g = newContact(G.tenantId, G.owner.id, "Crash");
  step("G a dispatcher dies after claiming: a live claim blocks any re-fire; stale, the reconciler re-drives it exactly once", async () => {
    const held = await post(drainer.base, { event_id: g.eventId }, keys.service);
    assert.deepEqual(held.json.act_outcomes, { approval_pending: 1 }, JSON.stringify(held.json));
    // The process becomes automatic, and the act is put in exactly the state an engine runner leaves when it dies
    // between taking the claim and dispatching: accepted, a claim, no approver, nothing landed, the event spent.
    sql(`update public.paige_automations set granted_lane = 'auto' where id = ${q(gProcess)};`);
    assert.equal(one(`select public.resolve_automation_autonomy(${q(gProcess)})->>'effective';`), "auto");
    sql(`set session_replication_role = replica;
         update public.paige_pending_approvals set status = 'skipped' where source = 'paige_orchestration' and metadata->>'event_id' = ${q(g.eventId)};
         update public.paige_act_executions
            set outcome = 'accepted_for_execution',
                detail = detail || jsonb_build_object('dispatch_claim', gen_random_uuid()::text, 'dispatch_claimed_at', now() - interval '2 minutes'),
                updated_at = now() - interval '15 minutes'
          where event_id = ${q(g.eventId)};
         update public.paige_native_events set processing_state = 'pending', attempts = 1, claimed_at = null where id = ${q(g.eventId)};
         update public.paige_event_dispatches set status = 'error' where event_id = ${q(g.eventId)};`);

    // While the dead runner's claim is still live, a drain fires nothing.
    const early = await post(drainer.base, { event_id: g.eventId }, keys.service);
    assert.equal(early.status, 200, JSON.stringify(early.json));
    assert.equal(transitions(g.contactId), 0, "a live claim must block a second dispatcher");
    assert.equal(ledger(g.eventId).outcome, "accepted_for_execution");
    reconcile();
    assert.equal(one(`select coalesce(detail->>'dispatch_recoveries', '0') from public.paige_act_executions where event_id = ${q(g.eventId)};`), "0",
      "the reconciler must not treat a live claim as dead");

    // The claim goes stale and the event has run out of attempts: before this milestone nothing re-drove it.
    sql(`set session_replication_role = replica;
         update public.paige_act_executions
            set detail = detail || jsonb_build_object('dispatch_claimed_at', now() - interval '15 minutes'),
                updated_at = now() - interval '15 minutes'
          where event_id = ${q(g.eventId)};
         update public.paige_native_events set processing_state = 'error', attempts = 5 where id = ${q(g.eventId)};`);
    // A second process goes live AFTER the event. The recovery drain is scoped to the stranded automation, so this
    // old event is never delivered to it.
    const late = processRecord(G.tenantId, G.owner.id, "auto", "paid_tier", "Granted after the event");
    assert.ok(Number(reconcile()) >= 1, "the reconciler must act on the stranded act");
    assert.equal(one(`select processing_state || ':' || attempts from public.paige_native_events where id = ${q(g.eventId)};`), "pending:4");
    const redrive = await post(drainer.base, { event_id: g.eventId }, keys.service);
    assert.equal(redrive.status, 200, JSON.stringify(redrive.json));
    assert.equal(redrive.json.terminal, "done", JSON.stringify(redrive.json));
    assert.equal(count(`select count(*) from public.paige_act_executions where event_id = ${q(g.eventId)} and automation_id = ${q(late)};`), 0,
      "a process granted after the event is never delivered it by a recovery drain");
    assert.equal(count(`select count(*) from public.paige_event_dispatches where event_id = ${q(g.eventId)} and automation_id = ${q(late)};`), 0);
    const row = ledger(g.eventId);
    assert.equal(row.outcome, "executed");
    assert.equal(transitions(g.contactId), 1);
    assert.equal(count(`select count(*) from public.paige_journey_stage_transitions where contact_id = ${q(g.contactId)} and source_event = ${q(row.correlation_ref)};`), 1,
      "the one transition carries the act's own correlation reference");
    assert.equal(one(`select detail->>'dispatch_recoveries' from public.paige_act_executions where event_id = ${q(g.eventId)};`), "1");

    // Further passes and deliveries write nothing more.
    sql(`set session_replication_role = replica; update public.paige_act_executions set updated_at = now() - interval '15 minutes' where event_id = ${q(g.eventId)};`);
    reconcile();
    await post(drainer.base, { event_id: g.eventId }, keys.service);
    assert.equal(transitions(g.contactId), 1);
    assert.equal(ledger(g.eventId).outcome, "executed");
  });

  const H = await workspace("crash-approval");
  processRecord(H.tenantId, H.owner.id, "confirm", "paid_tier");
  const h = newContact(H.tenantId, H.owner.id, "Halt");
  step("H the executor dies after the owner approved: the stuck lock is released and the next approval runs it once", async () => {
    const held = await post(drainer.base, { event_id: h.eventId }, keys.service);
    assert.deepEqual(held.json.act_outcomes, { approval_pending: 1 }, JSON.stringify(held.json));
    const aid = one(`select id from public.paige_pending_approvals where source = 'paige_orchestration' and metadata->>'event_id' = ${q(h.eventId)};`);
    const actId = one(`select act_id from public.paige_act_executions where event_id = ${q(h.eventId)};`);
    // What execute-approval leaves behind when it dies between claiming the dispatch and firing it: the approval row
    // locked, the act redeemed under the owner's approval and claimed, nothing landed.
    assert.equal(one(`select (public.paige_approve_act_execution(${q(h.eventId)}, ${q(actId)}, ${q(H.owner.id)})).outcome::text;`), "accepted_for_execution");
    sql(`set session_replication_role = replica;
         update public.paige_pending_approvals set claimed_at = now() - interval '20 minutes', reviewed_by_user_id = ${q(H.owner.id)} where id = ${q(aid)};
         update public.paige_act_executions
            set detail = detail || jsonb_build_object('dispatch_claim', gen_random_uuid()::text, 'dispatch_claimed_at', now() - interval '15 minutes'),
                updated_at = now() - interval '15 minutes'
          where event_id = ${q(h.eventId)};`);

    // The defect this milestone fixes: the owner's retry cannot get past the stuck lock.
    const stuck = await post(approver.base, { approval_id: aid }, H.owner.jwt);
    assert.equal(stuck.json.already, "in_progress", JSON.stringify(stuck.json));
    assert.equal(transitions(h.contactId), 0);

    assert.ok(Number(reconcile()) >= 1, "the reconciler must release the stale approval lock");
    assert.equal(one(`select status || ':' || (claimed_at is null) from public.paige_pending_approvals where id = ${q(aid)};`), "pending:true");
    assert.equal(ledger(h.eventId).outcome, "accepted_for_execution", "the reconciler never fires an approved act itself");
    assert.equal(transitions(h.contactId), 0);

    const ran = await post(approver.base, { approval_id: aid }, H.owner.jwt);
    assert.equal(ran.json.executed, true, JSON.stringify(ran.json));
    assert.equal(ledger(h.eventId).outcome, "executed");
    assert.equal(transitions(h.contactId), 1);
    assert.equal(one(`select status from public.paige_pending_approvals where id = ${q(aid)};`), "approved");
    const again = await post(approver.base, { approval_id: aid }, H.owner.jwt);
    assert.equal(again.json.executed, false, JSON.stringify(again.json));
    assert.equal(transitions(h.contactId), 1);
  });

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
