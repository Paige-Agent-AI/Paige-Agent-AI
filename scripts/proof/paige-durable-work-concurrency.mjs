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
const cluster = join(tmpdir(), `paige-durable-work-${randomUUID()}`);
const migration = readFileSync(
  join(root, "supabase/migrations/20270417000000_paige_durable_work_envelope.sql"),
  "utf8",
);
const rollbackProof = readFileSync(
  join(root, "supabase/tests/paige_durable_work_envelope.sql"),
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

const invoke = (sql) => psql(sql);

const fixtureSchema = `
create extension if not exists pgcrypto;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key, aud text, role text, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
create table public.tenants(
  id uuid primary key, slug text, name text, status text, account_type text,
  account_number_prefix text, features jsonb
);
create table public.tenant_members(
  tenant_id uuid not null, user_id uuid not null, role text, status text,
  is_owner boolean default false, joined_at timestamptz, primary key(tenant_id, user_id)
);
create table public.paige_chat_threads(
  id uuid primary key, caller_user_id uuid not null, tenant_id uuid not null,
  lens text, title text, is_archived boolean not null default false
);
create function public.is_platform_owner() returns boolean language sql stable
  security definer set search_path = '' as $$ select false $$;
grant execute on function public.is_platform_owner() to authenticated, service_role;
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
`;

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
  await psql(migration);
  const rollbackResult = await psql(rollbackProof);
  assert.match(rollbackResult.stderr, /PAIGE_DURABLE_WORK_ENVELOPE_PROVEN/);

  const userId = randomUUID();
  const tenantId = randomUUID();
  const threadId = randomUUID();
  const intentId = randomUUID();
  const suffix = randomUUID().slice(0, 12);
  await psql(`
    insert into auth.users(id,aud,role,email)
      values('${userId}','authenticated','authenticated','durable-race-${suffix}@tests.invalid');
    insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,features)
      values('${tenantId}','durable-race-${suffix}','Durable Race','active','standalone','DWR','{}');
    insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
      values('${tenantId}','${userId}','owner','active',true,now());
    insert into public.paige_chat_threads(id,caller_user_id,tenant_id,lens,title)
      values('${threadId}','${userId}','${tenantId}','coach','Durable race');
  `);

  const created = await psql(`
    set role service_role;
    select work_id::text || '|' || server_idempotency_key
      from public.create_paige_durable_work(
        '${tenantId}','${userId}','${intentId}','${threadId}',
        'documents.author','document',
        '{"tenant_id":"${tenantId}","actor_user_id":"${userId}"}'::jsonb,
        'durable-race:${suffix}',300,3
      );
  `);
  const [workId, serverKey] = created.stdout.split(/\r?\n/).find((line) => line.includes("paige-work:"))?.split("|") ?? [];
  assert.ok(workId && serverKey, `create did not return work identity: ${created.stdout}`);

  await psql(`
    set role service_role;
    select work_status from public.transition_paige_durable_work(
      '${workId}','${serverKey}','blocked',null,
      'Waiting for a worker claim','worker_queue'
    );
  `);

  const claim = `
    begin;
    set local role service_role;
    create temp table race_result(value text);
    do $$ begin
      insert into race_result
        select work_status from public.transition_paige_durable_work(
          '${workId}','${serverKey}','claimed',null,'Worker claimed',null,null,300,false
        );
    exception when others then
      insert into race_result values(sqlstate || ':' || sqlerrm);
    end $$;
    select value from race_result;
    select pg_sleep(0.5);
    commit;
  `;
  const raced = await Promise.all([invoke(claim), invoke(claim)]);
  const outcomes = raced.flatMap(({ stdout }) => stdout.split(/\r?\n/))
    .filter((line) => line === "claimed" || line.includes("DURABLE_WORK_TRANSITION_INVALID"));
  assert.equal(outcomes.filter((line) => line === "claimed").length, 1, outcomes.join(" | "));
  assert.equal(
    outcomes.filter((line) => line === "55000:DURABLE_WORK_TRANSITION_INVALID").length,
    1,
    outcomes.join(" | "),
  );

  const finalState = await psql(`
    select status || '|' || attempt_count::text || '|' || count(*) over ()::text
      from public.paige_durable_work where id='${workId}';
  `);
  assert.equal(finalState.stdout, "claimed|2|1");
  console.log("PASS: two concurrent service-role workers raced one work row; exactly one claimed it, the loser failed closed, and one row remained at attempt 2.");
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
