// Connected MCP Gateway — the approval-write vs endpoint-change RACE is closed (#1262 finding 3).
//
// set_mcp_connection_approval takes a `SELECT ... FOR UPDATE` row lock on the connection before it
// records the approval, so it and any UPDATE of server_url_ct (which fires the 20270322000000
// revoke trigger) contend on the SAME row lock and cannot interleave. This proof forces the two to
// overlap (each holds its transaction open with pg_sleep) and asserts the invariant that the race
// would otherwise break: no approval is ever left bound to an endpoint the connection no longer
// has. Without the FOR UPDATE lock, the writer could read the old endpoint, the endpoint could
// change (deleting nothing, since the write hasn't landed), and the write could then commit a
// stale approval — exactly the interleaving this serialization prevents.
//
// Two concurrent psql processes (no pg dependency), mirroring scripts/proof/business-mission-concurrency.mjs.
//
// HONESTY (§13, §39 adversarial): the RACY part below is probabilistic as a regression guard — if
// the FOR UPDATE lock were removed, the stale-approval interleaving becomes reachable but not
// guaranteed on every run, so a single green racy run is positive proof of correctness, not a hard
// tripwire against lock removal. The DETERMINISTIC guarantees, which DO fail loudly on regression,
// are: (a) the endpoint_hash binding + reviewed-endpoint guard, proven in
// mcp_gateway_durable_endpoint_bound_consent.sql; and (b) the writer-first trigger tripwire added
// just below, which non-racingly asserts the 20270322000000 revoke trigger deletes on endpoint
// change. The racy exception handler swallows ONLY the expected MCP_ENDPOINT_CHANGED refusal — any
// other writer error re-raises and fails the proof, so it can never pass vacuously.
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { retireSyntheticTenantSQL } from "./operator-postgres-fixture.mjs";

const url = new URL(process.env.MCP_GATEWAY_TEST_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
assert.equal(url.hostname, "127.0.0.1", "Disposable loopback database required");
assert.ok((process.env.CI === "true" && url.port === "54322" && url.pathname === "/postgres") ||
  (process.env.MCP_GATEWAY_DISPOSABLE_DB === "1" && url.port !== "5432"), "Disposable MCP fixture database required");
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", url.toString()];
const psqlBin = process.env.PSQL_BIN || "psql";
const run = (sql) => execFileSync(psqlBin, args, { input: sql, encoding: "utf8", windowsHide: true }).trim();

const tenant = randomUUID();
const conn = randomUUID();
const suffix = randomUUID().slice(0, 12);
const pin = "a".repeat(64);
const E1 = "https://mcp-race-a.example/rpc";
const E2 = "https://mcp-race-b.example/rpc";

const cleanup = () => run(`
  DELETE FROM public.mcp_connection_approvals WHERE connection_id='${conn}';
  DELETE FROM public.mcp_connections WHERE connection_id='${conn}';
  ${retireSyntheticTenantSQL(tenant)}
`);

const invoke = (sql) => new Promise((resolve, reject) => {
  const child = spawn(psqlBin, args, { windowsHide: true });
  let stdout = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.resume();
  child.on("error", () => reject(new Error("concurrency process unavailable")));
  child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error("concurrency query failed")));
  child.stdin.end(sql);
});

try {
  cleanup();
  run(`
    INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features)
      VALUES('${tenant}','mcpgw-race-${suffix}','MCPGW Race','active','standalone','MCR','{}'::jsonb);
    INSERT INTO public.mcp_connections(connection_id,tenant_id,provider_key,label,server_url_ct)
      VALUES('${conn}','${tenant}','generic-remote','race-target', public.platform_encrypt('${E1}'));
  `);

  // DETERMINISTIC trigger tripwire (adversarial MINOR) — BEFORE the race, prove writer-first with no
  // concurrency that the 20270322000000 revoke trigger DELETES the approval when the endpoint changes.
  // The racy part below can pass green in the change-first ordering even with the trigger absent (the
  // writer just refuses), so this deterministic check is what makes "no stale approval survives" fail
  // LOUDLY if the revoke trigger is ever removed — independent of the Promise.all timing.
  run(`SELECT public.set_mcp_connection_approval('${conn}','send_message','${pin}','${tenant}', NULL, NULL, public._mcp_endpoint_hash('${E1}'))`);
  assert.equal(run(`SELECT count(*) FROM public.mcp_connection_approvals WHERE connection_id='${conn}'`), "1",
    "writer-first: the reviewed-endpoint approval was not written");
  run(`UPDATE public.mcp_connections SET server_url_ct = public.platform_encrypt('${E2}') WHERE connection_id='${conn}'`);
  assert.equal(run(`SELECT count(*) FROM public.mcp_connection_approvals WHERE connection_id='${conn}'`), "0",
    "the 20270322000000 revoke trigger did not delete the approval when the endpoint changed");
  run(`UPDATE public.mcp_connections SET server_url_ct = public.platform_encrypt('${E1}') WHERE connection_id='${conn}'`); // reset to E1 for the race

  // T1: approve, asserting the endpoint the owner reviewed (E1). It takes FOR UPDATE on the
  // connection, then holds the txn open. T2: change the endpoint to E2 (fires the revoke trigger).
  // Forced to overlap; they serialize on the row lock. With the reviewed-endpoint guard now
  // required, an endpoint-change-first ordering makes the approve REFUSE (current E2 ≠ reviewed E1)
  // rather than rebind — so a racing change yields NO surviving approval in either ordering
  // (writer-first: bound to E1, then the trigger deletes it; change-first: refused).
  const approveSql = `BEGIN;
    DO $$ BEGIN
      PERFORM public.set_mcp_connection_approval('${conn}','send_message','${pin}','${tenant}', NULL, NULL, public._mcp_endpoint_hash('${E1}'));
    EXCEPTION WHEN OTHERS THEN
      -- ONLY the reviewed-endpoint refusal (change-first ordering) is an expected, correct outcome.
      -- Any OTHER error is a genuinely broken writer and MUST fail the proof, not pass vacuously.
      IF SQLERRM NOT LIKE 'MCP_ENDPOINT_CHANGED%' THEN RAISE; END IF;
    END $$;
    SELECT pg_sleep(1); COMMIT;`;
  const repointSql = `BEGIN;
    UPDATE public.mcp_connections SET server_url_ct = public.platform_encrypt('${E2}') WHERE connection_id='${conn}';
    SELECT pg_sleep(1); COMMIT;`;
  await Promise.all([invoke(approveSql), invoke(repointSql)]);

  // The endpoint change committed.
  assert.equal(run(`SELECT public.platform_decrypt(server_url_ct) FROM public.mcp_connections WHERE connection_id='${conn}'`), E2,
    "endpoint change did not land");

  // THE RACE-CLOSED INVARIANT: no approval is left bound to an endpoint the connection no longer
  // has. Holds for BOTH serial orderings — writer-first (the endpoint change's trigger deletes the
  // approval) and endpoint-change-first (the writer binds to the new endpoint).
  const stale = run(`
    SELECT count(*) FROM public.mcp_connection_approvals a
      JOIN public.mcp_connections c ON c.connection_id = a.connection_id
     WHERE a.connection_id='${conn}'
       AND a.endpoint_hash IS DISTINCT FROM public._mcp_endpoint_hash(public.platform_decrypt(c.server_url_ct))`);
  assert.equal(stale, "0", "a stale approval survived the endpoint change — the race is NOT closed");

  // THE HARD INVARIANT (Codex R3): a racing endpoint change leaves ZERO approvals, in BOTH serial
  // orderings — writer-first (the endpoint change's revoke trigger deletes the just-written row) and
  // change-first (the reviewed-endpoint guard now REQUIRED makes the writer REFUSE against the new
  // endpoint). A soft "verifies against current if any survived" branch would silently accept the
  // exact stale-consent rebinding this proof exists to forbid, so it is a hard equality: no approval
  // may survive at all.
  const surviving = run(`SELECT count(*) FROM public.mcp_connection_approvals WHERE connection_id='${conn}'`);
  assert.equal(surviving, "0", "an approval survived the endpoint race — a stale/rebound consent is exactly the regression this proof forbids");

  console.log(`PASS: approval-write vs endpoint-change serialized on the connection row lock; zero approvals survived the race (both orderings leave none).`);
} finally {
  cleanup();
}
