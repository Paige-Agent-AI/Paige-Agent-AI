#!/usr/bin/env node
// Disposable local PostgreSQL ONLY. No connection string, production dump, provider or secret input.
// Exact MCP migrations + canonical authz/crypto functions, not a full application schema replay.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = process.env.PG_PROOF_BIN || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/16/bin" : "");
const executable = name => join(bin, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key) && !/^(DATABASE_URL|SUPABASE_)/i.test(key)));
const outputRoot = join(root, "outputs/mcp-oauth-database");
mkdirSync(outputRoot, { recursive: true });
const output = mkdtempSync(join(outputRoot, "run-"));
const cluster = join(output, "cluster");
const transcript = [], sources = [], results = [];
let port, started = false, stopped = false, failure;
const children = new Set();
let cleanupPromise;

async function command(name, args, { input = "", allowFailure = false, holdOpen = false, onStart, onOutput } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(executable(name), args, { cwd: root, env, windowsHide: true, stdio: name === "pg_ctl" ? "ignore" : ["pipe", "pipe", "pipe"] });
    children.add(child);
    let stdout = "", stderr = "";
    child.stdout?.on("data", value => { stdout += value; onOutput?.(stdout); });
    child.stderr?.on("data", value => stderr += value);
    const timer = setTimeout(() => child.kill(), 45000);
    child.on("error", error => { clearTimeout(timer); children.delete(child); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      children.delete(child);
      transcript.push({ name, args, input, code, stdout, stderr });
      if (code !== 0 && !allowFailure) reject(Error(`${name} exited ${code}: ${stderr}`));
      else done({ code, stdout, stderr });
    });
    onStart?.(child);
    if (holdOpen) child.stdin?.write(input); else child.stdin?.end(input);
  });
}
const psql = (input, options = {}) => command("psql", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "--no-password", "--set", "ON_ERROR_STOP=1"], { input: `\\set VERBOSITY verbose\nSET statement_timeout='15s';\n${input}`, ...options });
function source(prefix) {
  const found = readdirSync(join(root, "supabase/migrations")).filter(name => name.startsWith(`${prefix}_`));
  assert.equal(found.length, 1, `unambiguous source migration ${prefix}`);
  const file = `supabase/migrations/${found[0]}`, sql = readFileSync(join(root, file), "utf8");
  sources.push({ file, sha256: createHash("sha256").update(sql).digest("hex") });
  return sql;
}
function lines(prefix, first, last) {
  const sql = source(prefix).split(/\r?\n/).slice(first - 1, last).join("\n");
  sources.at(-1).lines = [first, last];
  return sql;
}
const run = async (label, sql) => { await psql(sql); results.push({ label, status: "PASS" }); console.log(`PASS ${label}`); };
async function portOpen() {
  return new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once("connect", () => finish(true)); socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(true)); // timeout is not proof the server stopped
  });
}
async function cleanup() {
  cleanupPromise ??= (async () => {
    if (started) {
      try {
        await command("pg_ctl", ["-D", cluster, "-m", "immediate", "-w", "stop"]);
        assert.equal(await portOpen(), false, "proof PostgreSQL port remains open");
        stopped = true;
      } catch (error) { failure ??= error.message; process.exitCode = 1; }
    }
  })();
  return cleanupPromise;
}
function report() {
  writeFileSync(join(output, "report.json"), JSON.stringify({ status: failure ? "FAIL" : "PASS", failure, port, started, stopped, sources, results,
    scope: "Disposable local PostgreSQL target contract; unrelated dependency shapes are minimal (not full tenant constraints/triggers); no full Supabase replay/authenticated OAuth/production or populated legacy backfill claim" }, null, 2));
  writeFileSync(join(output, "transcript.json"), JSON.stringify(transcript, null, 2));
  console.log(output);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  failure = `Interrupted by ${signal}`;
  for (const child of children) child.kill();
  void cleanup().finally(() => { report(); process.exit(signal === "SIGINT" ? 130 : 143); });
});

async function contended(cid, sql) {
  let holder, ready;
  const locked = new Promise(resolve => ready = resolve);
  const holding = psql(`BEGIN; SELECT connection_id FROM public.mcp_connections WHERE connection_id='${cid}' FOR UPDATE;\n\\echo LOCK_HELD\n`, {
    holdOpen: true, onStart: child => holder = child,
    onOutput: output => { if (output.includes("LOCK_HELD")) ready(); },
  });
  const first = [], deadline = Date.now() + 10000;
  try {
    await Promise.race([locked, holding.then(() => { throw Error("lock holder exited before barrier"); })]);
    for (const suffix of ["a", "b"]) first.push(psql(`SET application_name='mcp-oauth-race-${suffix}'; ${sql}`, { allowFailure: true }));
    while (true) {
      const count = await psql("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'mcp-oauth-race-%' AND wait_event_type='Lock';");
      if (Number(count.stdout.trim()) === 2) break;
      assert(Date.now() < deadline, "both callback sessions must reach the lock barrier");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    holder.stdin.end("COMMIT;\n");
    await holding;
    return await Promise.all(first);
  } finally {
    if (!holder.stdin.destroyed) holder.stdin.end("ROLLBACK;\n");
    await Promise.allSettled([holding, ...first]);
  }
}

try {
  const listener = createServer();
  await new Promise((accept, reject) => { listener.on("error", reject); listener.listen(0, "127.0.0.1", accept); });
  port = listener.address().port;
  await new Promise(accept => listener.close(accept));
  await command("initdb", ["-D", cluster, "-U", "postgres", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  started = true;
  await command("pg_ctl", ["-D", cluster, "-l", join(output, "postgres.log"), "-w", "-t", "30", "-o", `-h 127.0.0.1 -p ${port} -c max_connections=20`, "start"]);
  if (process.argv.includes("--inject-failure-after-start")) throw Error("Expected cleanup-proof failure after database start");
  if (process.argv.includes("--inject-signal-after-start")) {
    // Cross-platform handler proof. Windows process.kill force-terminates rather than delivering
    // SIGTERM; this explicitly tests the handler, NOT native OS signal delivery on Windows.
    process.emit("SIGTERM");
    await new Promise(() => {});
  }

  // Minimal unrelated dependency shapes, all empty. No unrestricted authority helpers.
  // auth.uid reproduces the JWT subject decoding used by Supabase; no auth server is claimed.
  await psql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE EXTENSION pgcrypto; CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub',true),''),NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,aud text,role text,email text);
CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
CREATE TYPE public.app_role AS ENUM ('super_admin','platform_admin','admin','user');
CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
CREATE TABLE public.agency_team_members(agency_tenant_id uuid,user_id uuid,agency_role text,status text,scoped_subaccounts uuid[]);
-- Unexercised compatibility tables. NO legacy data/backfill outcome is claimed.
CREATE TABLE public.tenant_mcp_connections(tenant_id uuid);
CREATE TABLE public.tenant_n8n_connections(tenant_id uuid);`);
  await psql(lines("20260629175341", 14, 68));
  await psql(`ALTER TABLE public.tenants ADD COLUMN features jsonb DEFAULT '{}', ADD COLUMN account_number_prefix text,
ADD COLUMN account_type text DEFAULT 'standalone', ADD COLUMN parent_tenant_id uuid;
ALTER TABLE public.tenant_members ADD COLUMN is_owner boolean NOT NULL DEFAULT false;`);
  await psql(lines("20260803120000", 50, 53));
  await psql(lines("20260416215843", 137, 148));
  await psql(`INSERT INTO public._internal_secrets(key,value) VALUES ('platform_column_key',encode(gen_random_bytes(32),'hex'));`);
  await psql(lines("20260702022450", 18, 52));
  await psql(lines("20260702184358", 34, 60));
  await psql(lines("20260714142258", 18, 31));
  await psql(lines("20260714051416", 30, 72));
  await psql(lines("20260714144656", 12, 35));
  await psql(lines("20260629175341", 132, 155));
  await psql(lines("20260714235406", 42, 57));
  await psql(lines("20261005000000", 196, 232));
  await psql(lines("20261005000000", 461, 461));
  await psql(lines("20261005000000", 474, 474));
  await psql(lines("20260628013834", 155, 167));
  await psql(`ALTER TABLE public.paige_audit_log ADD COLUMN tenant_id uuid;`);
  await psql(lines("20261201000200", 3, 20));
  await psql(source("20260916000000"));
  for (const prefix of ["20270319000000", "20270322000000", "20270323000000", "20270330000000", "20270331000000", "20270332000000", "20270333000000", "20270334000000", "20270423081500"]) {
    await psql(source(prefix));
  }
  await run("authored migration applies to real canonical MCP dependency chain", source("20270517000000"));
  for (const file of ["mcp_gateway_oauth_state_and_hardenings.sql", "mcp_oauth_refuses_the_rest_facet.sql", "mcp_gateway_oauth_grant_writer.sql"]) {
    // \i preserves nested \ir resolution, unlike piping SQL as if it were the file.
    await run(file, `\\i '${join(root, "supabase/tests", file).replaceAll("\\", "/")}'`);
  }

  const actor = "10000000-0000-4000-8000-000000000021", tenant = "10000000-0000-4000-8000-000000000022";
  await psql(`INSERT INTO auth.users(id) VALUES('${actor}');
INSERT INTO public.tenants(id,slug,name,status,account_type) VALUES('${tenant}','test-tenant-concurrency','test-tenant-concurrency','active','standalone');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES('${tenant}','${actor}','owner','active',true);`);
  const claims = `SET request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';`;
  const created = await psql(`${claims} SELECT public.create_mcp_connection('generic-remote','test-concurrent-callback','https://provider.example/mcp','none')->>'connection_id';`);
  const cid = created.stdout.trim(); assert.match(cid, /^[0-9a-f-]{36}$/);
  const begin = state => `SET ROLE service_role; SELECT public.begin_mcp_oauth('${cid}','${tenant}','${state}','test-verifier','https://callback.example/oauth','https://iss.example.com','https://resource.example/mcp','client-123',NULL,'${actor}',1,ARRAY['mcp.read']);`;
  await psql(begin("test-state-race"));
  const consume = `SET ROLE service_role; SELECT public.consume_mcp_oauth_state('test-state-race','exchange')->>'found';`;
  const consumed = await contended(cid, consume);
  assert(consumed.every(result => result.code === 0));
  assert.deepEqual(consumed.map(result => result.stdout.trim()).sort(), ["false", "true"]);
  results.push({ label: "two lock-barrier synchronized service-role sessions redeem state exactly once", status: "PASS" });
  const sid = (await psql(`SELECT id FROM public.mcp_connection_oauth_state WHERE state='test-state-race';`)).stdout.trim();
  const complete = `SET ROLE service_role; SELECT public.complete_mcp_oauth_grant('${cid}','${tenant}','test-access-not-a-credential',NULL,'https://iss.example.com','client-123',NULL,ARRAY['mcp.read'],NULL,'${actor}','${sid}')->>'status';`;
  const completed = await contended(cid, complete);
  assert.deepEqual(completed.map(result => result.code).sort(), [0, 3]);
  assert.equal(completed.find(result => result.code === 0).stdout.trim(), "pending_verification");
  assert.match(completed.find(result => result.code !== 0).stderr, /MCP_OAUTH_STALE/);
  results.push({ label: "two lock-barrier synchronized service-role completions write one grant only", status: "PASS" });
  for (const role of ["anon", "authenticated"]) {
    for (const call of ["SELECT public.consume_mcp_oauth_state('test-state-race','exchange');", complete.replace("SET ROLE service_role;", "")]) {
      const denied = await psql(`SET ROLE ${role}; ${call}`, { allowFailure: true });
      assert.equal(denied.code, 3); assert.match(denied.stderr, /permission denied for function/);
    }
    results.push({ label: `${role} cannot consume state or complete a grant`, status: "PASS" });
  }
  console.log(`PASS ${results.length} PostgreSQL proof groups, including four SQL test files and real concurrent role sessions`);
} catch (error) { failure = error.message; process.exitCode = 1; console.error(failure); }
finally {
  await cleanup();
  report();
}
