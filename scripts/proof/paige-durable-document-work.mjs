import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pgBin = process.env.PG_PROOF_BIN
  ?? (process.platform === "win32" ? "C:/Program Files/PostgreSQL/16/bin" : "");
const executable = (name) => join(pgBin, process.platform === "win32" ? `${name}.exe` : name);
const cluster = join(tmpdir(), `paige-durable-document-${randomUUID()}`);
const envelopeMigration = readFileSync(
  join(root, "supabase/migrations/20270417000000_paige_durable_work_envelope.sql"),
  "utf8",
);
const documentMigration = readFileSync(
  join(root, "supabase/migrations/20270418000000_paige_durable_document_work.sql"),
  "utf8",
);
const titleRetirement = readFileSync(join(root, "supabase/migrations/20270504000000_retire_title_role_from_functions.sql"), "utf8");
const metricActor = readFileSync(join(root, "supabase/migrations/20271113360002_exp02_metric_actor_authority.sql"), "utf8");
const reportAuthority = readFileSync(join(root, "supabase/migrations/20271113440002_exp02_native_report_authority.sql"), "utf8");
const reportPrivacy = readFileSync(join(root, "supabase/migrations/20271113430002_exp02_metric_report_artifact_scope.sql"), "utf8");
const reportArtifact = readFileSync(join(root, "supabase/migrations/20271113450002_exp02_native_report_artifact.sql"), "utf8");
const reportCaptureMigration = readFileSync(join(root, "supabase/migrations/20271113330002_exp02_document_metric_capture.sql"), "utf8");
const reportAdmission = readFileSync(join(root, "supabase/migrations/20271113520002_exp02_report_capture_admission.sql"), "utf8");
const reportSourceRequests = readFileSync(join(root, "supabase/migrations/20271113840002_exp02_report_source_requests.sql"), "utf8");

let port;
let started = false;

const command = (exe, args, input = "", allowFailure = false) => new Promise((resolveCommand, reject) => {
  const detachedServerControl = exe.toLowerCase().endsWith(process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
  const child = spawn(exe, args, {
    cwd: root,
    windowsHide: true,
    stdio: detachedServerControl ? "ignore" : ["pipe", "pipe", "pipe"],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("PG") && key !== "DATABASE_URL"),
    ),
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (data) => { stdout += data; });
  child.stderr?.on("data", (data) => { stderr += data; });
  child.on("error", reject);
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error(`Local PostgreSQL command timed out: ${exe}`));
  }, 45_000);
  child.on("close", (code) => {
    clearTimeout(timer);
    if (code !== 0 && !allowFailure) reject(new Error(stderr || `${exe} exited ${code}`));
    else resolveCommand({ code, stdout: stdout.trim(), stderr: stderr.trim() });
  });
  child.stdin?.end(input);
});

const psql = (sql, allowFailure = false) => command(
  executable("psql"),
  [
    "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres",
    "-X", "-q", "-A", "-t", "--no-password", "--set", "ON_ERROR_STOP=1",
  ],
  `\\set VERBOSITY verbose\n${sql}`,
  allowFailure,
);

const fixtureSchema = `
create extension if not exists pgcrypto;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema net;
create table auth.users(id uuid primary key, aud text, role text, email text, banned_until timestamptz, deleted_at timestamptz);
create table public.profiles(user_id uuid primary key, active_tenant_id uuid);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.tenants(id uuid primary key, slug text, name text, status text);
create table public.tenant_members(
  tenant_id uuid not null, user_id uuid not null, role text, status text, is_owner boolean not null default false,
  primary key(tenant_id, user_id)
);
create table public.paige_chat_threads(
  id uuid primary key, caller_user_id uuid not null, tenant_id uuid not null,
  is_archived boolean not null default false, message_count integer not null default 0,
  last_message_at timestamptz, auto_delete_at timestamptz, updated_at timestamptz not null default now()
);
create table public.marketing_content(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  created_by uuid, kind text not null default 'text' check(kind in ('text','image','document')),
  title text not null default 'Untitled', body text, brief text,
  status text not null default 'draft', meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.paige_chat_turns(
  id uuid primary key default gen_random_uuid(), thread_id uuid not null,
  role text not null, content text not null, surfaces_used text[], load_id uuid,
  model text, tokens_used integer, latency_ms integer, bundle_ref jsonb, tool_calls jsonb,
  created_at timestamptz not null default now()
);
create table public.audit_logs(
  id uuid primary key default gen_random_uuid(), user_id uuid, entity text,
  action text, entity_id uuid, data jsonb, created_at timestamptz not null default now()
);
create table public.proof_capability_runs(
  tenant_id uuid, actor_id uuid, capability_key text, outcome text,
  run_id uuid, job_attempt_id text, detail jsonb
);
create table net.proof_wakeups(id bigserial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint
language plpgsql as $$ declare _id bigint; begin
  insert into net.proof_wakeups(url,headers,body) values(url,headers,body) returning id into _id;
  return _id;
end $$;
create function public.cron_token_header() returns text language sql stable as $$ select 'proof-token'::text $$;
create function public.current_user_tenant_id() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.tenant_id', true), '')::uuid
$$;
create function public.has_any_role(_user_id uuid, _roles text[]) returns boolean language sql stable as $$
  select exists(select 1 from public.tenant_members m where m.user_id=_user_id and m.status='active' and m.role=any(_roles))
$$;create function public.has_tenant_role(_user_id uuid, _tenant_id uuid, _role text) returns boolean language sql stable as $$
  select exists(
    select 1 from public.tenant_members m
     where m.user_id=_user_id and m.tenant_id=_tenant_id and m.status='active'
       and (m.role=_role or (_role='owner' and m.is_owner))
  )
$$;
create function public.is_platform_owner() returns boolean language sql stable as $$ select false $$;
create function public.record_capability_run(
  _tenant_id uuid, _actor_id uuid, _capability_key text, _outcome text, _run_id uuid,
  _agent_slug text default null, _job_attempt_id text default null, _llm_trace_id uuid default null,
  _release_id text default null, _detail jsonb default null
) returns void language plpgsql as $$ begin
  insert into public.proof_capability_runs values(
    _tenant_id,_actor_id,_capability_key,_outcome,_run_id,_job_attempt_id,_detail
  );
end $$;
create table public.paige_workflow_runs(id uuid primary key default gen_random_uuid());
create table public.paige_skill_runs(id uuid primary key default gen_random_uuid());
create table public.business_verification_runs(id uuid primary key default gen_random_uuid());
create table public.security_canary_runs(id uuid primary key default gen_random_uuid());
create table public.paige_readiness_scan_runs(id uuid primary key default gen_random_uuid());
create table public.research_runs(id uuid primary key default gen_random_uuid());
create table public.paige_eval_run(id uuid primary key default gen_random_uuid());
create table public.paige_systems_check_run(id uuid primary key default gen_random_uuid());
create table public.paige_authority_act_runs(id uuid primary key default gen_random_uuid());
create table public.paige_media_jobs(id uuid primary key default gen_random_uuid());
create table public.paige_social_jobs(id uuid primary key default gen_random_uuid());
create table public.paige_act_executions(id uuid primary key default gen_random_uuid());
grant usage on schema auth,net to authenticated,service_role;
grant execute on function auth.uid() to authenticated,service_role;
`;

const firstLineContaining = (output, token) => output.split(/\r?\n/).find((line) => line.includes(token));

try {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));

  await command(executable("initdb"), ["-D", cluster, "-U", "postgres", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  started = true;
  try {
    await command(executable("pg_ctl"), [
      "-D", cluster, "-l", join(cluster, "postgres.log"), "-w", "-t", "30",
      // Every proof connection already uses TCP loopback. Linux's default Unix
      // socket directory need not be writable and is not part of this contract.
      "-o", `-h 127.0.0.1 -p ${port} -c max_connections=20 -c unix_socket_directories=`, "start",
    ]);
  } catch (error) {
    let detail = "Private startup log unavailable.";
    try { detail = readFileSync(join(cluster, "postgres.log"), "utf8").trim().split(/\r?\n/).slice(-8).join("\n"); } catch { /* before any fixture or business data */ }
    throw new Error(`Isolated PostgreSQL startup failed: ${error instanceof Error ? error.message : 'pg_ctl failed'}\n${detail}`);
  }

  assert.equal((await psql("SELECT current_setting('unix_socket_directories')='' AND inet_server_addr()='127.0.0.1'::inet AND current_setting('listen_addresses')='127.0.0.1';")).stdout, 't', 'Original proof stays TCP loopback only');
  await psql(fixtureSchema);
  await psql(envelopeMigration);
  await psql(documentMigration);
  // Apply the ORIGINAL title-role transformer to these original functions. The
  // old April migration alone is not today's production document authority.
  await psql(titleRetirement.slice(0, titleRetirement.indexOf('-- Lists and separate branches'))
    + ["start_paige_document_work_execution(uuid)", "submit_paige_document_work(uuid,uuid,jsonb)", "recover_paige_document_work(integer)"]
      .map(fn => `SELECT pg_temp.retire_role('public.${fn}'::regprocedure);`).join('\n'));
  await psql(metricActor);
  const nativeMetadata = "SELECT jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl::text,p.prosecdef,p.proconfig) ORDER BY p.oid)::text FROM pg_proc p WHERE p.oid IN ('public.start_paige_document_work_execution(uuid)'::regprocedure,'public.complete_paige_document_work(uuid,text,text,text,jsonb,text,text,integer,integer)'::regprocedure);";
  const originalMetadata = (await psql(nativeMetadata)).stdout;
  await psql(reportAuthority);
  await psql(reportAuthority); // exact replay only; no source baseline is renewed
  await psql(reportPrivacy);
  // Deliberately broad assumed legacy library grant: the original report policy
  // must still restrict reports. Actual production RLS is covered by the separate
  // original full-schema proof; this isolated fixture does not replace it.
  await psql(`ALTER TABLE public.marketing_content ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.marketing_content TO authenticated;
    CREATE POLICY native_fixture_legacy_read ON public.marketing_content FOR SELECT TO authenticated USING(true);`);
  await psql(reportArtifact);
  await psql(reportArtifact); // complete producer exact replay, no public admission
  assert.equal((await psql(nativeMetadata)).stdout, originalMetadata);

  const userId = randomUUID();
  const tenantId = randomUUID();
  const threadId = randomUUID();
  const intentId = randomUUID();
  await psql(`
    insert into auth.users(id,aud,role,email) values('${userId}','authenticated','authenticated','durable-doc@tests.invalid');
    insert into public.profiles values('${userId}','${tenantId}');
    insert into public.tenants values('${tenantId}','durable-doc','Durable Document','active');
    insert into public.tenant_members(tenant_id,user_id,role,status,is_owner)
      values('${tenantId}','${userId}','admin','active',true);
    insert into public.paige_chat_threads(id,caller_user_id,tenant_id) values('${threadId}','${userId}','${tenantId}');
  `);
  const brief = JSON.stringify({
    version: "1",
    doc_type: "agreement_draft",
    title: "Services Agreement Draft",
    brief: "Draft a reviewable services agreement artifact. It is not signable.",
    required_facts: { governing_law: "Georgia" },
  }).replaceAll("'", "''");
  const submitSql = (intent, payload = brief) => `
    set request.jwt.claim.sub='${userId}';
    set request.jwt.claim.tenant_id='${tenantId}';
    set role authenticated;
    select work_id::text || '|' || work_status || '|' || resumed_existing::text
      from public.submit_paige_document_work('${intent}','${threadId}','${payload}'::jsonb);
  `;

  const invalidBrief = JSON.stringify({
    version: "1", doc_type: "agreement_draft", title: "Invalid", brief: "Reject raw source bodies.",
    source_refs: ["raw-source-body"],
  }).replaceAll("'", "''");
  const invalidSubmission = await psql(submitSql(randomUUID(), invalidBrief), true);
  assert.match(invalidSubmission.stderr, /DURABLE_DOCUMENT_BRIEF_UNKNOWN_FIELD/);

  const foreignUserId = randomUUID();
  const foreignTenantId = randomUUID();
  await psql(`
    insert into auth.users(id,aud,role,email) values('${foreignUserId}','authenticated','authenticated','foreign-doc@tests.invalid');
    insert into public.profiles values('${foreignUserId}','${foreignTenantId}');
    insert into public.tenants values('${foreignTenantId}','foreign-doc','Foreign Document','active');
    insert into public.tenant_members(tenant_id,user_id,role,status,is_owner)
      values('${foreignTenantId}','${foreignUserId}','admin','active',true);
  `);
  const foreignSubmission = await psql(`
    set request.jwt.claim.sub='${foreignUserId}';
    set request.jwt.claim.tenant_id='${foreignTenantId}';
    set role authenticated;
    select * from public.submit_paige_document_work('${randomUUID()}','${threadId}','${brief}'::jsonb);
  `, true);
  assert.match(foreignSubmission.stderr, /DURABLE_DOCUMENT_THREAD_FORBIDDEN/);

  const first = await psql(submitSql(intentId));
  const firstParts = firstLineContaining(first.stdout, "|claimed|")?.split("|") ?? [];
  assert.equal(firstParts[2], "false", first.stdout);
  const workId = firstParts[0];
  assert.ok(workId, first.stdout);

  const replay = await psql(submitSql(intentId));
  assert.equal(firstLineContaining(replay.stdout, workId), `${workId}|claimed|true`);
  const identityProof = await psql(`
    reset role;
    select count(*)::text || '|' || (select count(*) from net.proof_wakeups)::text
      from public.paige_durable_work where intent_id='${intentId}';
  `);
  assert.equal(identityProof.stdout, "1|2", identityProof.stdout);

  const startedWork = await psql(`
    set role service_role;
    select work_id::text || '|' || work_status || '|' || attempt_count::text
      from public.start_paige_document_work_execution('${workId}');
  `);
  assert.equal(firstLineContaining(startedWork.stdout, workId), `${workId}|claimed|1`);
  const duplicateDispatch = await psql(`
    set role service_role;
    select * from public.start_paige_document_work_execution('${workId}');
  `, true);
  assert.match(duplicateDispatch.stderr, /DURABLE_WORK_ALREADY_DISPATCHED/);

  const keyResult = await psql(`select idempotency_key from public.paige_durable_work where id='${workId}';`);
  const serverKey = keyResult.stdout;
  const blocks = JSON.stringify([
    { type: "heading", level: 1, text: "Services Agreement Draft" },
    { type: "paragraph", text: "Draft for attorney review only." },
  ]).replaceAll("'", "''");
  const completed = await psql(`
    set role service_role;
    select content_id::text || '|' || document_revision::text || '|' || work_status
      from public.complete_paige_document_work(
        '${workId}','${serverKey}','agreement_draft','Services Agreement Draft',
        '${blocks}'::jsonb,'proof-provider','proof-model',120,800
      );
  `);
  assert.equal(firstLineContaining(completed.stdout, workId), `${workId}|1|succeeded`);
  const terminalReplay = await psql(submitSql(intentId));
  assert.equal(firstLineContaining(terminalReplay.stdout, workId), `${workId}|succeeded|true`);
  const terminalWakeProof = await psql(`select count(*)::text from net.proof_wakeups;`);
  assert.equal(terminalWakeProof.stdout, "2", terminalWakeProof.stdout);
  const persisted = await psql(`
    reset role;
    select w.status || '|' || (w.terminal_outcome->>'verified_readback') || '|'
      || m.status || '|' || m.document_revision::text || '|'
      || (t.bundle_ref->'paige_artifact'->0->>'id') || '|'
      || (select count(*) from public.proof_capability_runs r where r.run_id=w.id)::text || '|'
      || (select count(*) from public.audit_logs a where a.data->>'work_id'=w.id::text)::text
    from public.paige_durable_work w
    join public.marketing_content m on m.work_id=w.id
    join public.paige_chat_turns t on t.work_id=w.id
    where w.id='${workId}';
  `);
  assert.equal(persisted.stdout, `succeeded|true|draft|1|${workId}|1|1`, persisted.stdout);

  const revisionIntent = randomUUID();
  const revisionBrief = JSON.stringify({
    version: "1", doc_type: "agreement_draft", title: "Services Agreement Draft v2",
    brief: "Revise the draft while preserving its draft-only agreement boundary.",
    target_content_id: workId, expected_revision: 1,
  }).replaceAll("'", "''");
  const revisionSubmit = await psql(submitSql(revisionIntent, revisionBrief));
  const revisionWorkId = firstLineContaining(revisionSubmit.stdout, "|claimed|")?.split("|")[0];
  assert.ok(revisionWorkId, revisionSubmit.stdout);
  const revisionStart = await psql(`set role service_role; select server_idempotency_key from public.start_paige_document_work_execution('${revisionWorkId}');`);
  const revisionKey = revisionStart.stdout;
  const revisionComplete = await psql(`
    set role service_role;
    select content_id::text || '|' || document_revision::text || '|' || work_status
      from public.complete_paige_document_work(
        '${revisionWorkId}','${revisionKey}','agreement_draft','Services Agreement Draft v2',
        '${blocks}'::jsonb,'proof-provider','proof-model',100,700
      );
  `);
  assert.equal(revisionComplete.stdout, `${workId}|2|succeeded`, revisionComplete.stdout);

  const conflictIntent = randomUUID();
  const conflictSubmit = await psql(submitSql(conflictIntent, revisionBrief));
  const conflictWorkId = firstLineContaining(conflictSubmit.stdout, "|claimed|")?.split("|")[0];
  const conflictStart = await psql(`set role service_role; select server_idempotency_key from public.start_paige_document_work_execution('${conflictWorkId}');`);
  const conflictResult = await psql(`
    set role service_role;
    select coalesce(content_id::text,'none') || '|' || document_revision::text || '|' || work_status
      from public.complete_paige_document_work(
        '${conflictWorkId}','${conflictStart.stdout}','agreement_draft','Conflict',
        '${blocks}'::jsonb,'proof-provider','proof-model',100,700
      );
  `);
  assert.equal(conflictResult.stdout, "none|2|blocked", conflictResult.stdout);
  const blockedState = await psql(`select status || '|' || blocked_reason from public.paige_durable_work where id='${conflictWorkId}';`);
  assert.equal(blockedState.stdout, "blocked|version_conflict", blockedState.stdout);

  const authorityIntent = randomUUID();
  const authoritySubmit = await psql(submitSql(authorityIntent));
  const authorityWorkId = firstLineContaining(authoritySubmit.stdout, "|claimed|")?.split("|")[0];
  await psql(`update public.tenant_members set status='inactive' where tenant_id='${tenantId}' and user_id='${userId}';`);
  const authorityResult = await psql(`
    set role service_role;
    select work_status from public.start_paige_document_work_execution('${authorityWorkId}');
  `);
  assert.equal(authorityResult.stdout, "blocked", authorityResult.stdout);
  const authorityState = await psql(`select status || '|' || blocked_reason from public.paige_durable_work where id='${authorityWorkId}';`);
  assert.equal(authorityState.stdout, "blocked|authority_changed", authorityState.stdout);
  await psql(`update public.tenant_members set status='active' where tenant_id='${tenantId}' and user_id='${userId}';`);

  const missedWakeIntent = randomUUID();
  const missedWakeSubmit = await psql(submitSql(missedWakeIntent));
  const missedWakeWorkId = firstLineContaining(missedWakeSubmit.stdout, "|claimed|")?.split("|")[0];
  await psql(`update public.paige_durable_work set lease_until=now()-interval '1 second' where id='${missedWakeWorkId}';`);
  const recovered = await psql(`set role service_role; select work_id from public.recover_paige_document_work(10);`);
  assert.match(recovered.stdout, new RegExp(missedWakeWorkId));
  const recoveredState = await psql(`select status || '|' || attempt_count::text from public.paige_durable_work where id='${missedWakeWorkId}';`);
  assert.equal(recoveredState.stdout, "claimed|2", recoveredState.stdout);

  const unknownIntent = randomUUID();
  const unknownSubmit = await psql(submitSql(unknownIntent));
  const unknownWorkId = firstLineContaining(unknownSubmit.stdout, "|claimed|")?.split("|")[0];
  await psql(`set role service_role; select work_id from public.start_paige_document_work_execution('${unknownWorkId}');`);
  await psql(`update public.paige_durable_work set lease_until=now()-interval '1 second' where id='${unknownWorkId}';`);
  await psql(`set role service_role; select work_id from public.recover_paige_document_work(10);`);
  const unknownState = await psql(`select status || '|' || error_code from public.paige_durable_work where id='${unknownWorkId}';`);
  assert.equal(unknownState.stdout, "outcome_unknown|provider_outcome_unknown", unknownState.stdout);

  // Future report fixtures are privileged/local only. Public report admission,
  // real report production/rendering and customer acceptance are NOT established.
  let reportCases = 0;
  const futureBrief = JSON.stringify({ version: "1", doc_type: "business_review",
    title: "Historical business review", brief: "Read original authorized business evidence." });
  const wakeupsBeforeReport = (await psql('select count(*) from net.proof_wakeups;')).stdout;
  const notAdmitted = await psql(submitSql(randomUUID(), futureBrief), true);
  assert.match(notAdmitted.stderr, /DURABLE_DOCUMENT_TYPE_INVALID/);
  assert.equal((await psql('select count(*) from net.proof_wakeups;')).stdout, wakeupsBeforeReport);
  reportCases++;
  const futureWork = async (payload = futureBrief) => {
    const id = randomUUID(), key = `isolated-report-${id}`;
    // Keep original server-resolved context from this proof's real legacy submit.
    // This is not a new public submit path or a production authority grant.
    await psql(`INSERT INTO public.paige_durable_work(id,tenant_id,initiating_user_id,intent_id,thread_id,
      capability_key,work_kind,authority_context,scope_epoch,idempotency_key,lease_until,request_payload)
      SELECT '${id}',tenant_id,initiating_user_id,'${randomUUID()}',thread_id,capability_key,work_kind,
        authority_context,scope_epoch,'${key}',now()+interval '5 minutes','${payload.replaceAll("'", "''")}'::jsonb
       FROM public.paige_durable_work WHERE id='${workId}';`);
    return { id, key };
  };
  const changes = [
    [`UPDATE public.profiles SET active_tenant_id='${foreignTenantId}' WHERE user_id='${userId}';`,
      `UPDATE public.profiles SET active_tenant_id='${tenantId}' WHERE user_id='${userId}';`],
    [`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${userId}';`,
      `UPDATE auth.users SET banned_until=NULL WHERE id='${userId}';`],
    [`UPDATE auth.users SET deleted_at=now() WHERE id='${userId}';`,
      `UPDATE auth.users SET deleted_at=NULL WHERE id='${userId}';`],
    [`UPDATE public.tenant_members SET role='member' WHERE user_id='${userId}' AND tenant_id='${tenantId}';`,
      `UPDATE public.tenant_members SET role='admin' WHERE user_id='${userId}' AND tenant_id='${tenantId}';`],
  ];
  for (const [retire, restore] of changes) {
    const work = await futureWork(); await psql(retire);
    const claim = await psql(`SET ROLE service_role; SELECT work_status FROM public.start_paige_document_work_execution('${work.id}');`);
    assert.equal(claim.stdout, 'blocked');
    const state = await psql(`SELECT status||'|'||blocked_reason||'|'||dispatch_started_attempt::text||'|'||
      (SELECT count(*) FROM public.marketing_content WHERE work_id=w.id)::text||'|'||
      (SELECT count(*) FROM public.paige_chat_turns WHERE work_id=w.id)::text
      FROM public.paige_durable_work w WHERE id='${work.id}';`);
    assert.equal(state.stdout, 'blocked|authority_changed|0|0|0');
    await psql(restore); reportCases++;
  }
  for (const [retire, restore] of changes) {
    const work = await futureWork();
    const claim = await psql(`SET ROLE service_role; SELECT work_status FROM public.start_paige_document_work_execution('${work.id}');`);
    assert.equal(claim.stdout, 'claimed'); await psql(retire);
    // An original otherwise-supported output must not slip report work through
    // generic document permission after its Metric actor becomes ineligible.
    const refused = await psql(`SET ROLE service_role; SELECT * FROM public.complete_paige_document_work(
      '${work.id}','${work.key}','guide','Historical business review','${blocks}'::jsonb,NULL,NULL,0,0);`, true);
    assert.match(refused.stderr, /42501:[\s\S]*DURABLE_DOCUMENT_METRIC_AUTHORITY_CHANGED/);
    const state = await psql(`SELECT status||'|'||
      (SELECT count(*) FROM public.marketing_content WHERE work_id=w.id)::text||'|'||
      (SELECT count(*) FROM public.paige_chat_turns WHERE work_id=w.id)::text||'|'||
      (SELECT count(*) FROM public.proof_capability_runs WHERE run_id=w.id)::text
      FROM public.paige_durable_work w WHERE id='${work.id}';`);
    assert.equal(state.stdout, 'claimed|0|0|0');
    await psql(restore); reportCases++;
  }
  await psql(changes[0][0]);
  const historicalReportRequest = await psql(`SET ROLE service_role; SELECT * FROM public.complete_paige_document_work(
    '${workId}','${serverKey}','business_review','Historical business review','${blocks}'::jsonb,NULL,NULL,0,0);`, true);
  assert.match(historicalReportRequest.stderr, /42501:[\s\S]*DURABLE_DOCUMENT_METRIC_AUTHORITY_CHANGED/);
  await psql(changes[0][1]); reportCases++;
  assert.equal((await psql(nativeMetadata)).stdout, originalMetadata);
  console.log(`PASS: ${reportCases} original pre-admission authority scenarios; at this stage public report type is refused, current Metric eligibility gates original claim/completion/historical report-labelled replay, no unauthorized artifact/turn/receipt. Original private ABI/ACL and legacy proof retained; isolated only.`);

  // Native producer/correlation proof only. These are explicit isolated source
  // canaries, not issuer/math/worker/customer evidence. The full-schema proof
  // separately uses the real issuer and original private capture.
  const capturedAt = new Date().toISOString();
  const reportPeriod = {key:'month',start:new Date(Date.now()-30*86400000).toISOString(),end:capturedAt};
  const reportCapture = {version:1,captured_at:capturedAt,measurements:[{
    metric_key:'team.active_members_current',metric_version:'1.0.0',source_revision_ref:'isolated-source-revision',
    evidence_ref:`aneb_v1_${'d'.repeat(64)}`,account_epoch:'isolated-private-canary',source_refs:['public.tenant_members'],
    as_of:capturedAt,range:{...reportPeriod,bounds:'[start,end)',timezone:'UTC',semantics:'current_snapshot'},
    freshness:{queried_at:capturedAt,source_updated_through:null},coverage:{state:'complete',candidate_count:17,contributing_count:17,excluded_count:0},
    exclusions:[],caveats:['Isolated count fixture; no customer business information.'],values:{kind:'count',count:17},
  }]};
  const reportPayload = JSON.stringify({...JSON.parse(futureBrief),report_period:reportPeriod,report_evidence:reportCapture});
  const reportBlocks = JSON.stringify([{type:'stat',value:'17',label:'Isolated source count'}]);
  const finishReport = work => `SET ROLE service_role; SELECT content_id::text||'|'||work_status FROM public.complete_paige_document_work(
    '${work.id}','${work.key}','business_review','Historical business review','${reportBlocks}'::jsonb,NULL,NULL,0,0);`;
  const report = await futureWork(reportPayload);
  await psql(`SET ROLE service_role; SELECT * FROM public.start_paige_document_work_execution('${report.id}');`);
  assert.equal((await psql(finishReport(report))).stdout, `${report.id}|succeeded`);
  const actualReport = JSON.parse((await psql(`SELECT jsonb_build_object('body',m.body::jsonb,'meta',m.meta,'status',w.status,
    'turns',(SELECT count(*) FROM public.paige_chat_turns WHERE work_id=w.id),
    'receipts',(SELECT count(*) FROM public.proof_capability_runs WHERE run_id=w.id),
    'purpose',(SELECT detail->>'document_purpose' FROM public.proof_capability_runs WHERE run_id=w.id))
    FROM public.paige_durable_work w JOIN public.marketing_content m ON m.id=w.id AND m.work_id=w.id WHERE w.id='${report.id}';`)).stdout);
  assert.equal(actualReport.body.docType,'business_review'); assert.equal(actualReport.body.blocks[0].value,'17');
  assert.equal(actualReport.meta.document_purpose,'metric_business_review');
  assert.deepEqual(actualReport.meta.report_period,reportPeriod);
  assert.equal(actualReport.meta.metric_provenance[0].source_revision_ref,'isolated-source-revision');
  assert.doesNotMatch(JSON.stringify(actualReport),/aneb_v1_|isolated-private-canary|account_epoch/);
  assert.equal(actualReport.status,'succeeded'); assert.equal(actualReport.turns,1); assert.equal(actualReport.receipts,1);
  assert.equal(actualReport.purpose,'metric_business_review');
  assert.equal((await psql(finishReport(report))).stdout,`${report.id}|succeeded`);
  const rewrite = await psql(`UPDATE public.marketing_content SET body='Changed captured facts' WHERE id='${report.id}';`,true);
  assert.match(rewrite.stderr,/BUSINESS_REVIEW_ARTIFACT_IMMUTABLE/);
  const visibleReport = () => psql(`SET request.jwt.claim.sub='${userId}'; SET request.jwt.claim.tenant_id='${tenantId}';
    SET ROLE authenticated; SELECT count(*) FROM public.marketing_content WHERE id='${report.id}';`);
  assert.equal((await visibleReport()).stdout,'1'); await psql(changes[0][0]);
  assert.equal((await visibleReport()).stdout,'0');
  assert.match((await psql(finishReport(report),true)).stderr,/DURABLE_DOCUMENT_METRIC_AUTHORITY_CHANGED/);
  await psql(changes[0][1]);
  for(const change of [{report_evidence:{}},{target_content_id:workId,expected_revision:1}]){
    const invalid = await futureWork(JSON.stringify({...JSON.parse(reportPayload),...change}));
    await psql(`SET ROLE service_role; SELECT * FROM public.start_paige_document_work_execution('${invalid.id}');`);
    assert.match((await psql(finishReport(invalid),true)).stderr,/DURABLE_DOCUMENT_REPORT_CAPTURE_INVALID/);
    assert.equal((await psql(`SELECT count(*) FROM public.marketing_content WHERE work_id='${invalid.id}';`)).stdout,'0');
  }
  console.log('PASS: original native report artifact/closed provenance/type/readback/turn/Rail, replay, immutable facts, current-scope read and refusal scenarios; isolated only, no public admission or worker/customer proof.');

  // The actual original producer above supplies this report. Observation must
  // recognize that same artifact without creating, retrying or waking any work.
  const reportObservationIntent = randomUUID();
  await psql(`CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT current_setting('request.jwt.claim.role',true) $$;
    ALTER TABLE public.paige_chat_threads ADD COLUMN interactive_latest_intent uuid;
    ALTER TABLE public.paige_chat_turns ADD COLUMN interactive_intent_id uuid,
      ADD COLUMN interactive_actor_id uuid,ADD COLUMN interactive_tenant_id uuid,
      ADD COLUMN interactive_terminal_state text;
    UPDATE public.paige_chat_threads SET interactive_latest_intent='${reportObservationIntent}' WHERE id='${threadId}';
    INSERT INTO public.paige_chat_turns(thread_id,role,content,interactive_intent_id,
      interactive_actor_id,interactive_tenant_id,interactive_terminal_state,bundle_ref)
    VALUES('${threadId}','assistant','Original report accepted','${reportObservationIntent}',
      '${userId}','${tenantId}','WAIT_WORK','${JSON.stringify({interactive:{effects:[{tool:'document_generate',outcome:'durable_accepted',work_id:report.id}]}})}'::jsonb);`);
  await psql(readFileSync(join(root,'supabase/migrations/20270601000014_int304_durable_observation.sql'),'utf8'));
  const reportObservationMigration=readFileSync(join(root,'supabase/migrations/20271117140002_exp02_report_observation.sql'),'utf8');
  const observationMetadataSql="SELECT jsonb_build_array(p.oid,p.proowner,p.proacl::text,p.prosecdef,p.provolatile,p.proconfig,p.proargnames,p.prorettype)::text FROM pg_proc p WHERE p.oid='public.read_paige_durable_observation(uuid,uuid,uuid)'::regprocedure";
  const observationMetadata=(await psql(observationMetadataSql)).stdout;
  await psql(reportObservationMigration);await psql(reportObservationMigration);
  assert.equal((await psql(observationMetadataSql)).stdout,observationMetadata,'Original observation OID/ABI/ACL/metadata are unchanged');
  const reportObservationQuery=`SET request.jwt.claim.sub='${userId}'; SET request.jwt.claim.tenant_id='${tenantId}'; SET request.jwt.claim.role='authenticated';
    SET ROLE authenticated; SELECT public.read_paige_durable_observation('${threadId}','${reportObservationIntent}','${report.id}')::text;`;
  const observeReport = () => psql(reportObservationQuery);
  const observationText = (await observeReport()).stdout;
  assert.ok(observationText,'Original caller/thread/intent/Work fixture must be readable before artifact verification');
  const originalReportObservation = JSON.parse(observationText);
  assert.equal(originalReportObservation.artifactVerified,true,'The original completed Business Review report must be verified by the SAME native observation');
  assert.equal(originalReportObservation.artifactRef,report.id);
  assert.equal(originalReportObservation.state,'succeeded');
  assert.equal(originalReportObservation.approvalState,'unavailable');
  assert.doesNotMatch(observationText,/aneb_v1_|report_evidence|request_payload|metric_provenance|isolated-private-canary/);
  assert.deepEqual(JSON.parse((await observeReport()).stdout),originalReportObservation,'Repeated observation is stable');
  let observationCases=6;
  for(const [retire,restore] of changes){
    await psql(retire);
    assert.equal((await observeReport()).stdout,'','Current Metric authority must still permit the report read');
    await psql(restore);
    assert.equal(JSON.parse((await observeReport()).stdout).artifactVerified,true,'Restored original authority rereads the same saved report');
    observationCases+=2;
  }
  const probeObservation=async change=>{
    const response=await psql(`BEGIN;${change}\n${reportObservationQuery}ROLLBACK;`);
    return response.stdout ? JSON.parse(response.stdout) : null;
  };
  assert.equal((await probeObservation(`UPDATE public.marketing_content SET status='archived' WHERE id='${report.id}';`)).artifactVerified,true,'Archiving does not invent a new report or discard its immutable source');
  assert.equal((await probeObservation(`UPDATE public.paige_durable_work SET status='outcome_unknown',terminal_outcome=NULL,settled_at=NULL WHERE id='${report.id}';`)).recoveryState,'reconciliation_required');
  for(const change of [
    `UPDATE public.paige_durable_work SET settled_at=now()+interval '1 day' WHERE id='${report.id}';`,
    `UPDATE public.paige_durable_work SET terminal_outcome=jsonb_set(terminal_outcome,'{content_id}','"${randomUUID()}"'::jsonb) WHERE id='${report.id}';`,
    `UPDATE public.paige_chat_turns SET bundle_ref=bundle_ref-'paige_artifact' WHERE work_id='${report.id}';`,
  ]){assert.equal((await probeObservation(change)).artifactVerified,false,'Original source association is required');observationCases++;}
  for(const change of [
    `UPDATE public.paige_chat_threads SET is_archived=true WHERE id='${threadId}';`,
    `UPDATE public.paige_chat_threads SET interactive_latest_intent='${randomUUID()}' WHERE id='${threadId}';`,
    `UPDATE public.paige_chat_turns SET bundle_ref=jsonb_set(bundle_ref,'{interactive,effects}',(bundle_ref->'interactive'->'effects')||(bundle_ref->'interactive'->'effects'->0)) WHERE interactive_intent_id='${reportObservationIntent}';`,
  ]){assert.equal(await probeObservation(change),null,'Missing current original context cannot verify a report');observationCases++;}
  observationCases+=2;
  const observationCounts="SELECT jsonb_build_array((SELECT count(*) FROM net.proof_wakeups),(SELECT count(*) FROM public.proof_capability_runs),(SELECT md5(jsonb_agg(to_jsonb(w) ORDER BY id)::text) FROM public.paige_durable_work w))::text";
  const countsBefore=(await psql(observationCounts)).stdout;
  for(let i=0;i<3;i++)await observeReport();
  assert.equal((await psql(observationCounts)).stdout,countsBefore,'Observation neither wakes work, writes receipts nor mutates original Work');observationCases++;
  const observationBodySql="SELECT md5(prosrc) FROM pg_proc WHERE oid='public.read_paige_durable_observation(uuid,uuid,uuid)'::regprocedure";
  const observationBody=(await psql(observationBodySql)).stdout;
  for(const [change,reason] of [
    ["GRANT EXECUTE ON FUNCTION public.read_paige_durable_observation(uuid,uuid,uuid) TO anon;",/REPORT_OBSERVATION_METADATA_CHANGED/],
    ["DO $$DECLARE d text;BEGIN SELECT pg_get_functiondef('public.read_paige_durable_observation(uuid,uuid,uuid)'::regprocedure) INTO d;EXECUTE replace(d,E'\\nbegin\\n',E'\\nbegin\\n -- unreviewed local source probe\\n');END$$;",/REPORT_OBSERVATION_SOURCE_CHANGED/],
    ["DO $$DECLARE d text;BEGIN SELECT pg_get_functiondef('public._paige_metric_report_readable(uuid)'::regprocedure) INTO d;EXECUTE replace(d,'SELECT auth.uid()','SELECT /* unreviewed local permission probe */ auth.uid()');END$$;",/REPORT_OBSERVATION_PERMISSION_CHANGED/],
  ]){
    // Each deliberate local alteration is rolled back when the migration
    // refuses it. No source guard, privilege or assertion is disabled.
    assert.match((await psql(`BEGIN;${change}\n${reportObservationMigration}`,true)).stderr,reason);
    observationCases++;
  }
  assert.equal((await psql(observationBodySql)).stdout,observationBody,'Rejected guard probes leave the reviewed function unchanged');
  assert.equal((await psql(observationMetadataSql)).stdout,observationMetadata);
  console.log(`PASS: ${observationCases} original produced-report observation controls; actual saved artifact, current Metric authority, immutable association, original context, stable metadata and no replay/write.`);
  // Reuse the ORIGINAL legacy Document/Research proof against this candidate in
  // its own rollback-only database, inside this same owned disposable cluster.
  await psql('CREATE DATABASE int336_test_report_observation;');
  const oldObservationUrl=process.env.INT336_DATABASE_URL,oldPsqlBin=process.env.PSQL_BIN;
  try{
    process.env.INT336_DATABASE_URL=`postgresql://postgres@127.0.0.1:${port}/int336_test_report_observation`;
    process.env.PSQL_BIN=executable('psql');
    const legacy=await command(process.execPath,[join(root,'scripts/int304-durable-observation-check.mjs')]);
    console.log(legacy.stdout);
  }finally{
    if(oldObservationUrl===undefined)delete process.env.INT336_DATABASE_URL;else process.env.INT336_DATABASE_URL=oldObservationUrl;
    if(oldPsqlBin===undefined)delete process.env.PSQL_BIN;else process.env.PSQL_BIN=oldPsqlBin;
  }

  // Original PUBLIC submit/capture-once stage. Resolver IO below is an explicit
  // isolated port; the full-schema suite separately uses the real Metric issuer.
  await psql(`CREATE TABLE public.proof_evidence_references(token text PRIMARY KEY,bundle jsonb,reads integer NOT NULL DEFAULT 0);
    CREATE FUNCTION public.resolve_analytics_evidence_reference(_token text) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE b jsonb; BEGIN
      UPDATE public.proof_evidence_references SET reads=reads+1 WHERE token=_token RETURNING bundle INTO b;
      IF b IS NULL OR (b->>'reference_expires_at')::timestamptz<=clock_timestamp() THEN
        RAISE EXCEPTION 'DOCUMENT_METRIC_EVIDENCE_UNAVAILABLE' USING ERRCODE='42501';
      END IF;
      PERFORM pg_sleep(0.1); RETURN b;
    END $$;`);
  await psql(reportCaptureMigration);
  const submitMetadata = "SELECT jsonb_build_array(p.oid,p.proowner,p.proacl::text,p.prosecdef,p.proconfig)::text FROM pg_proc p WHERE p.oid='public.submit_paige_document_work(uuid,uuid,jsonb)'::regprocedure;";
  const originalSubmitMetadata = (await psql(submitMetadata)).stdout;
  await psql(reportAdmission); await psql(reportAdmission);
  assert.equal((await psql(submitMetadata)).stdout,originalSubmitMetadata);
  const admissionToken = `aneb_v1_${'b'.repeat(64)}`, secondToken = `aneb_v1_${'c'.repeat(64)}`;
  const evidence = {...reportCapture.measurements[0],account_epoch:tenantId,evidence_ref:admissionToken,
    reference_expires_at:new Date(Date.now()+300_000).toISOString()};
  await psql(`INSERT INTO public.proof_evidence_references(token,bundle) VALUES
    ('${admissionToken}','${JSON.stringify(evidence).replaceAll("'","''")}'::jsonb),
    ('${secondToken}','${JSON.stringify({...evidence,evidence_ref:secondToken,account_epoch:foreignTenantId}).replaceAll("'","''")}'::jsonb);`);
  const request = {version:1,doc_type:'business_review',title:'Original source-bound review',
    brief:'Read authorized historical evidence.',report_period:reportPeriod,evidence_refs:[admissionToken]};
  const reportSubmit = (intent,payload=request,failed=false) => psql(submitSql(intent,JSON.stringify(payload).replaceAll("'","''")),failed);
  const counts = async () => (await psql("SELECT (SELECT count(*) FROM public.paige_durable_work)::text||'|'||(SELECT count(*) FROM net.proof_wakeups)::text;")).stdout;
  const beforeRefusals = await counts();
  const admissionChanges=[...changes,
    [`UPDATE public.tenant_members SET status='inactive' WHERE user_id='${userId}' AND tenant_id='${tenantId}';`,
      `UPDATE public.tenant_members SET status='active' WHERE user_id='${userId}' AND tenant_id='${tenantId}';`],
    [`UPDATE public.tenants SET status='inactive' WHERE id='${tenantId}';`,
      `UPDATE public.tenants SET status='active' WHERE id='${tenantId}';`]];
  for (const change of [{version:'1'},{report_evidence:reportCapture},{required_facts:{amount:999}},
    {target_content_id:workId,expected_revision:1},{actor_id:userId},{evidence_refs:[]},
    {evidence_refs:[admissionToken,admissionToken]},{report_period:{...reportPeriod,key:'week'}},
    {report_period:{...reportPeriod,start:'2026-02-31T00:00:00Z'}},
    {report_period:{...reportPeriod,end:reportPeriod.start}}]) {
    assert.match((await reportSubmit(randomUUID(),{...request,...change},true)).stderr,
      /DURABLE_DOCUMENT_(REPORT_(BRIEF|PERIOD)_INVALID|BRIEF_INVALID)/);
  }
  for (const [retire,restore] of admissionChanges) {
    await psql(retire);
    assert.match((await reportSubmit(randomUUID(),request,true)).stderr,/42501/);
    await psql(restore);
  }
  assert.match((await reportSubmit(randomUUID(),{...request,evidence_refs:[secondToken]},true)).stderr,/DOCUMENT_METRIC_EVIDENCE_UNAVAILABLE/);
  assert.match((await reportSubmit(randomUUID(),{...request,report_period:{...reportPeriod,key:'quarter'}},true)).stderr,/DURABLE_DOCUMENT_REPORT_PERIOD_MISMATCH/);
  assert.equal(await counts(),beforeRefusals,'Refused captures leave no work or wake-up');
  const concurrentIntent = randomUUID();
  const parallel = await Promise.all([reportSubmit(concurrentIntent),reportSubmit(concurrentIntent)]);
  const rows = parallel.map(r=>firstLineContaining(r.stdout,'|claimed|').split('|'));
  assert.equal(rows[0][0],rows[1][0]); assert.deepEqual(rows.map(r=>r[2]).sort(),['false','true']);
  const admittedId=rows[0][0];
  const captured = (await psql(`SELECT request_payload::text FROM public.paige_durable_work WHERE id='${admittedId}';`)).stdout;
  const capturedObject=JSON.parse(captured);
  assert.equal(capturedObject.report_evidence.measurements[0].values.count,17);
  assert.equal(capturedObject.report_evidence.measurements[0].evidence_ref,admissionToken);
  assert.doesNotMatch(captured,/"account_epoch"|"evidence_refs"/);
  assert.equal((await psql(`SELECT reads FROM public.proof_evidence_references WHERE token='${admissionToken}';`)).stdout,'1');
  for (const [retire,restore] of admissionChanges) {
    await psql(retire);
    assert.match((await reportSubmit(concurrentIntent,request,true)).stderr,/42501/,'Stored work does not retain Metric authority');
    await psql(restore);
  }
  // Retire authority while the original work lock is actually contended, not
  // merely before starting a request. The same replay must revalidate afterward.
  const blocker = psql(`BEGIN; SELECT id FROM public.paige_durable_work WHERE id='${admittedId}' FOR UPDATE;
    SELECT pg_sleep(4) /* EXP02_REPORT_REPLAY_LOCK */; COMMIT;`);
  const observed = async condition => {
    for(let i=0;i<40;i++) {
      if((await psql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND ${condition});`)).stdout==='t') return;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error('Original report replay contention was not observed');
  };
  await observed("query LIKE '%EXP02_REPORT_REPLAY_LOCK%' AND wait_event='PgSleep'");
  const contendedReplay=reportSubmit(concurrentIntent,request,true);
  await observed("query LIKE '%submit_paige_document_work%' AND wait_event_type='Lock'");
  await psql(changes[1][0]); await blocker;
  const retiredReplay=await contendedReplay;
  await psql(changes[1][1]);
  assert.match(retiredReplay.stderr,/42501:[\s\S]*DURABLE_DOCUMENT_METRIC_AUTHORITY_CHANGED/,'A lock wait cannot preserve retired report authority');
  for(const change of [{brief:'Changed intent'},{evidence_refs:[secondToken]}])
    assert.match((await reportSubmit(concurrentIntent,{...request,...change},true)).stderr,/DURABLE_WORK_INTENT_REPLAY_MISMATCH/);
  await psql(`UPDATE public.proof_evidence_references SET bundle=jsonb_set(bundle,'{reference_expires_at}',to_jsonb((now()-interval '1 second')::text)) WHERE token='${admissionToken}';`);
  assert.equal(firstLineContaining((await reportSubmit(concurrentIntent)).stdout,admittedId),`${admittedId}|claimed|true`);
  assert.equal((await psql(`SELECT request_payload::text FROM public.paige_durable_work WHERE id='${admittedId}';`)).stdout,captured);
  const admittedKey=(await psql(`SET ROLE service_role; SELECT server_idempotency_key FROM public.start_paige_document_work_execution('${admittedId}');`)).stdout;
  await psql(`SET ROLE service_role; SELECT * FROM public.complete_paige_document_work('${admittedId}','${admittedKey}',
    'business_review','Original source-bound review','${reportBlocks}'::jsonb,NULL,NULL,0,0);`);
  const wakesBeforeTerminal=(await psql('SELECT count(*) FROM net.proof_wakeups;')).stdout;
  assert.equal(firstLineContaining((await reportSubmit(concurrentIntent)).stdout,admittedId),`${admittedId}|succeeded|true`);
  assert.equal((await psql('SELECT count(*) FROM net.proof_wakeups;')).stdout,wakesBeforeTerminal);
  assert.equal((await psql(`SELECT reads FROM public.proof_evidence_references WHERE token='${admissionToken}';`)).stdout,'1');
  assert.equal((await psql(`SELECT (SELECT count(*) FROM public.marketing_content WHERE work_id='${admittedId}')::text||'|'||
    (SELECT count(*) FROM public.paige_chat_turns WHERE work_id='${admittedId}')::text||'|'||
    (SELECT count(*) FROM public.proof_capability_runs WHERE run_id='${admittedId}')::text;`)).stdout,'1|1|1');
  assert.equal((await psql(`SELECT NOT has_function_privilege('authenticated','public._paige_document_capture_metric_evidence(jsonb)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.submit_paige_document_work(uuid,uuid,jsonb)','EXECUTE');`)).stdout,'t');
  const safeStatus=(await psql(`SET request.jwt.claim.sub='${userId}'; SET request.jwt.claim.tenant_id='${tenantId}';
    SET ROLE authenticated; SELECT to_jsonb(r)::text FROM public.get_paige_durable_work('${admittedId}') r;`)).stdout;
  assert.match(safeStatus,new RegExp(admittedId)); assert.doesNotMatch(safeStatus,/aneb_v1_|report_evidence|request_payload/);
  const finalDefinition=(await psql("SELECT pg_get_functiondef('public.submit_paige_document_work(uuid,uuid,jsonb)'::regprocedure);")).stdout;
  await psql(finalDefinition.replace('  _scope text;','  _scope text; -- isolated unknown-source canary'));
  assert.match((await psql(reportAdmission,true)).stderr,/DOCUMENT_REPORT_ADMISSION_SOURCE_CHANGED/);
  await psql(finalDefinition); assert.equal((await psql(submitMetadata)).stdout,originalSubmitMetadata);
  console.log('PASS: original public report submit, closed request, current actor, source/period refusals, atomic rollback, competing intent, one capture, expired-reference active/terminal replay and same artifact/turn/Rail; resolver port isolated, no actual issuer/worker/customer claim.');

  // Original public submit with canonical source selectors. Issuer/resolver ports
  // are explicitly isolated here; no invented metric calculation or live proof.
  await psql(`CREATE TABLE public.proof_metric_issues(id bigserial,key text,version text,dimensions jsonb,tenant uuid);
    CREATE FUNCTION public.issue_analytics_evidence_bundle(k text,v text,d jsonb,r text,s timestamptz,e timestamptz,t uuid)
      RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE b jsonb; token text; BEGIN
      IF t IS DISTINCT FROM public.current_user_tenant_id() OR NOT public._analytics_metric_authorized(t) THEN
        RAISE EXCEPTION 'ISSUER_SCOPE_REFUSED' USING ERRCODE='42501'; END IF;
      IF k NOT IN ('business.active_clients_current','sales.cash.recorded_received') OR v<>'1.0.0' OR d<>'{}'::jsonb THEN
        RAISE EXCEPTION 'ISSUER_SOURCE_REFUSED' USING ERRCODE='22023'; END IF;
      token:='aneb_v1_'||encode(public.digest(gen_random_uuid()::text,'sha256'),'hex');
      SELECT bundle INTO b FROM public.proof_evidence_references WHERE proof_evidence_references.token='${admissionToken}';
      b:=b||jsonb_build_object('metric_key',k,'metric_version',v,'evidence_ref',token,'account_epoch',t,
        'reference_expires_at',clock_timestamp()+interval '15 minutes',
        'range',jsonb_build_object('key',r,'start',s,'end',e,'bounds','[start,end)','timezone','UTC','semantics','current_snapshot'));
      INSERT INTO public.proof_evidence_references VALUES(token,b,0);
      INSERT INTO public.proof_metric_issues(key,version,dimensions,tenant) VALUES(k,v,d,t);
      RETURN b; END $$;`);
  await psql(reportSourceRequests); await psql(reportSourceRequests);
  assert.equal((await psql(submitMetadata)).stdout,originalSubmitMetadata);
  const {evidence_refs:_oldRefs,...requestMetadata}=request;
  const plan={...requestMetadata,metric_requests:[{metric_key:'sales.cash.recorded_received',metric_version:'1.0.0'},
    {metric_key:'business.active_clients_current',metric_version:'1.0.0'}]};
  const planIntent=randomUUID(),planResults=await Promise.all([reportSubmit(planIntent,plan),reportSubmit(planIntent,plan)]);
  const planRows=planResults.map(r=>firstLineContaining(r.stdout,'|claimed|').split('|'));
  assert.equal(planRows[0][0],planRows[1][0]);assert.deepEqual(planRows.map(r=>r[2]).sort(),['false','true']);
  const planId=planRows[0][0],plannedCapture=(await psql(`SELECT request_payload::text FROM public.paige_durable_work WHERE id='${planId}';`)).stdout;
  assert.deepEqual(JSON.parse(plannedCapture).report_evidence.measurements.map(m=>m.metric_key),plan.metric_requests.map(m=>m.metric_key));
  assert.equal((await psql("SELECT string_agg(key,',' ORDER BY id) FROM public.proof_metric_issues;")).stdout,
    'business.active_clients_current,sales.cash.recorded_received','Use original issuer in canonical lock order while retaining requested display order');
  const planCounts=await counts(),issues=()=>psql('SELECT count(*) FROM public.proof_metric_issues;');
  for(const metric_requests of [[],null,[null],[{...plan.metric_requests[0],values:{count:999}}],
    [plan.metric_requests[0],plan.metric_requests[0]],[{...plan.metric_requests[0],metric_version:'9.0.0'}],
    [plan.metric_requests[1],{metric_key:'zz.invalid',metric_version:'1.0.0'}]]) {
    assert.match((await reportSubmit(randomUUID(),{...plan,metric_requests},true)).stderr,/22023/);
  }
  assert.match((await reportSubmit(randomUUID(),{...plan,evidence_refs:[admissionToken]},true)).stderr,/22023/);
  assert.equal(await counts(),planCounts);assert.equal((await issues()).stdout,'2','All refused plans roll back work, wakeups and issuer effects');
  for(const [retire,restore] of admissionChanges){await psql(retire);
    assert.match((await reportSubmit(planIntent,plan,true)).stderr,/42501/);await psql(restore);}
  assert.match((await reportSubmit(planIntent,{...plan,metric_requests:[...plan.metric_requests].reverse()},true)).stderr,/DURABLE_WORK_INTENT_REPLAY_MISMATCH/);
  assert.match((await reportSubmit(planIntent,request,true)).stderr,/DURABLE_WORK_INTENT_REPLAY_MISMATCH/);
  await psql("UPDATE public.proof_evidence_references SET bundle=jsonb_set(bundle,'{reference_expires_at}',to_jsonb((now()-interval '1 second')::text));");
  assert.equal(firstLineContaining((await reportSubmit(planIntent,plan)).stdout,planId),`${planId}|claimed|true`);
  assert.equal((await issues()).stdout,'2');
  assert.equal((await psql(`SELECT request_payload::text FROM public.paige_durable_work WHERE id='${planId}';`)).stdout,plannedCapture);
  assert.equal((await psql("SELECT NOT p.prosecdef AND p.proconfig=ARRAY['search_path=\"\"','TimeZone=UTC'] AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0) FROM pg_proc p WHERE p.oid='public._paige_document_capture_metric_requests(jsonb,text,timestamptz,timestamptz)'::regprocedure;")).stdout,'t');
  const plannedDefinition=(await psql("SELECT pg_get_functiondef('public.submit_paige_document_work(uuid,uuid,jsonb)'::regprocedure);")).stdout;
  await psql(plannedDefinition.replace('  _scope text;','  _scope text; -- isolated new-source canary'));
  assert.match((await psql(reportSourceRequests,true)).stderr,/DOCUMENT_REPORT_REQUEST_SOURCE_CHANGED/);
  await psql(plannedDefinition);assert.equal((await psql(submitMetadata)).stdout,originalSubmitMetadata);
  console.log('PASS: original native source-plan admission, ordered capture, same-intent concurrency/replay, current authority and rollback; issuer/resolver ports isolated, actual issuer integration/customer proof owed.');

  const receiptIntent = randomUUID();
  const receiptSubmit = await psql(submitSql(receiptIntent));
  const receiptWorkId = firstLineContaining(receiptSubmit.stdout, "|claimed|")?.split("|")[0];
  const receiptStart = await psql(`set role service_role; select server_idempotency_key from public.start_paige_document_work_execution('${receiptWorkId}');`);
  await psql(`
    create or replace function public.record_capability_run(
      _tenant_id uuid, _actor_id uuid, _capability_key text, _outcome text, _run_id uuid,
      _agent_slug text default null, _job_attempt_id text default null, _llm_trace_id uuid default null,
      _release_id text default null, _detail jsonb default null
    ) returns void language plpgsql as $$ begin raise exception 'PROOF_RECEIPT_DOWN'; end $$;
  `);
  const receiptFailure = await psql(`
    set role service_role;
    select * from public.complete_paige_document_work(
      '${receiptWorkId}','${receiptStart.stdout}','agreement_draft','Receipt rollback',
      '${blocks}'::jsonb,'proof-provider','proof-model',100,700
    );
  `, true);
  assert.match(receiptFailure.stderr, /PROOF_RECEIPT_DOWN/);
  const receiptRollback = await psql(`
    select w.status || '|' ||
      (select count(*) from public.marketing_content m where m.work_id=w.id)::text || '|' ||
      (select count(*) from public.paige_chat_turns t where t.work_id=w.id)::text
    from public.paige_durable_work w where w.id='${receiptWorkId}';
  `);
  assert.equal(receiptRollback.stdout, "claimed|0|0", receiptRollback.stdout);
  const reportRollback = await futureWork(reportPayload);
  await psql(`SET ROLE service_role; SELECT * FROM public.start_paige_document_work_execution('${reportRollback.id}');`);
  assert.match((await psql(finishReport(reportRollback),true)).stderr,/PROOF_RECEIPT_DOWN/);
  assert.equal((await psql(`SELECT status||'|'||(SELECT count(*) FROM public.marketing_content WHERE work_id=w.id)::text||'|'||
    (SELECT count(*) FROM public.paige_chat_turns WHERE work_id=w.id)::text FROM public.paige_durable_work w WHERE id='${reportRollback.id}';`)).stdout,'claimed|0|0');

  console.log(`PASS: Phase 2 migration applied on PostgreSQL ${(await psql('SHOW server_version;')).stdout}; invalid/cross-tenant submissions failed closed, active intent replay safely re-awakened while terminal replay dispatched nothing, duplicate worker dispatch failed closed, verified artifact/readback/turn/receipt committed atomically, receipt failure rolled back, revision conflicts and authority changes stayed blocked, missed wake-up resumed, and post-dispatch expiry became outcome_unknown.`);
} finally {
  if (started) {
    await command(executable("pg_ctl"), ["-D", cluster, "-m", "immediate", "-w", "stop"], "", true);
  }
  const resolvedCluster = resolve(cluster);
  const relativeCluster = relative(resolve(tmpdir()), resolvedCluster);
  assert.ok(
    relativeCluster.length > 0 && !relativeCluster.startsWith("..") && !isAbsolute(relativeCluster),
    "Refusing to remove a non-temporary proof directory",
  );
  rmSync(resolvedCluster, { recursive: true, force: true });
}
