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
  console.log(`PASS: ${reportCases} future-report authority scenarios; public type remains refused, current Metric eligibility gates original claim/completion/historical report-labelled replay, no unauthorized artifact/turn/receipt. Original private ABI/ACL and legacy proof retained; isolated only.`);

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
