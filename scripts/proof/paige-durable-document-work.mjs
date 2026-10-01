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
create table auth.users(id uuid primary key, aud text, role text, email text);
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
  await command(executable("pg_ctl"), [
    "-D", cluster, "-l", join(cluster, "postgres.log"), "-w", "-t", "30",
    "-o", `-h 127.0.0.1 -p ${port} -c max_connections=20`, "start",
  ]);

  await psql(fixtureSchema);
  await psql(envelopeMigration);
  await psql(documentMigration);

  const userId = randomUUID();
  const tenantId = randomUUID();
  const threadId = randomUUID();
  const intentId = randomUUID();
  await psql(`
    insert into auth.users values('${userId}','authenticated','authenticated','durable-doc@tests.invalid');
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
    insert into auth.users values('${foreignUserId}','authenticated','authenticated','foreign-doc@tests.invalid');
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

  console.log("PASS: Phase 2 migration applied on PostgreSQL 16; invalid/cross-tenant submissions failed closed, active intent replay safely re-awakened while terminal replay dispatched nothing, duplicate worker dispatch failed closed, verified artifact/readback/turn/receipt committed atomically, receipt failure rolled back, revision conflicts and authority changes stayed blocked, missed wake-up resumed, and post-dispatch expiry became outcome_unknown.");
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
