// Two-session proof: an address ADD never drops an address another transaction wrote meanwhile.
//
// public._add_client_contact_methods merges the addresses it is given onto the contact's held
// list and writes the result as a whole list. Before 20270519010000 it read that list BEFORE
// taking the contact's row lock (the lock was taken later, inside _replace_client_contact_methods),
// so an address written by a transaction that held the lock at that moment was missing from the
// list it merged onto — and the whole-list write then deleted it. 20270519010000 locks the
// contact row first, so the read happens after the other writer commits.
//
// Each scenario, against real committed rows in a disposable database:
//   1. session A writes an address (x) to the contact — taking its row lock — and then waits on a
//      gate (an advisory lock held by a third session this runner controls);
//   2. session B calls _add_client_contact_methods with another address (y);
//   3. B is observed WAITING on a lock (pg_stat_activity) before the gate opens and A commits;
//   4. B returns, and the contact holds the original address, x AND y.
// Scenario 1's writer is another add; scenario 2's is the checked whole-list replace that
// upsert_contact, update_contact and the DSR correction use.
// Scenario 3 replaces the old address entirely while erasure waits. Erasure must then remove
// the committed replacement, report its actual count, redact the contact and audit the outcome.
//
// Disposable databases only: the CI Supabase stack (CI=true, 127.0.0.1:54322/postgres), or a local
// throwaway cluster named with CONTACT_METHODS_RACE_DISPOSABLE_DB=1. The rows are committed (a
// second session cannot see another's uncommitted fixture) and removed at the end.
//
// Failure is fast and releases everything. A scenario that fails partway ends its own gate, holder
// and adder sessions by pid before the next scenario starts, so one red scenario neither blocks nor
// hides the other. Every session carries its own lock_timeout/statement_timeout, every psql call
// the runner makes is killed if it overruns, cleanup cannot wait on a lock for more than a few
// seconds, and the whole run exits 1 if it passes CONTACT_METHODS_RACE_TIMEOUT_MS (default 90s).
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const url = new URL(process.env.CONTACT_METHODS_RACE_TEST_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
assert.equal(url.hostname, "127.0.0.1", "Disposable loopback database required");
assert.ok(
  (process.env.CI === "true" && url.port === "54322" && url.pathname === "/postgres")
    || process.env.CONTACT_METHODS_RACE_DISPOSABLE_DB === "1",
  "Disposable test database required (the CI Supabase stack, or CONTACT_METHODS_RACE_DISPOSABLE_DB=1 for a local throwaway cluster)",
);
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", url.toString()];
const psqlBin = process.env.PSQL_BIN || "psql";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The whole run's budget. A healthy run takes about a second.
const RUN_TIMEOUT_MS = Number(process.env.CONTACT_METHODS_RACE_TIMEOUT_MS ?? 90000);
assert.ok(Number.isFinite(RUN_TIMEOUT_MS) && RUN_TIMEOUT_MS > 0, "CONTACT_METHODS_RACE_TIMEOUT_MS must be a positive number");
// How long one observation (a session reaching the expected wait) may take.
const WAIT_MS = 10000;
// Server-side limits on the sessions that wait on locks: they end on their own even if this
// runner dies, so nothing is left holding the contact's row lock or the gate.
const SESSION_LOCK_TIMEOUT = "20s";
const SESSION_STATEMENT_TIMEOUT = "30s";
// The gate sleeps no longer than the run may last.
const GATE_SLEEP_S = Math.ceil(RUN_TIMEOUT_MS / 1000);

// Every synchronous psql call is killed if it overruns, so no call can stall the event loop and
// keep the run timeout from firing.
const run = (sql, timeoutMs = 20000) => execFileSync(psqlBin, args, {
  input: sql, encoding: "utf8", windowsHide: true, timeout: timeoutMs, killSignal: "SIGKILL",
}).trim();

const suffix = randomUUID().slice(0, 8);
const user = randomUUID();
const tenant = randomUUID();
const prefix = "CMR";
const accountNumber = 9700000 + Math.floor(Math.random() * 200000);
const clients = [randomUUID(), randomUUID(), randomUUID()];
const addr = (tag, i) => `${tag}-${i}-${suffix}@race.tests.invalid`;
const appPrefix = `cm_race_${suffix}_`;
const appName = (role, i) => `${appPrefix}${role}_${i}`;

const children = new Set();
const session = (name, sql) => {
  const p = new Promise((resolve, reject) => {
    const child = spawn(psqlBin, args, { windowsHide: true, env: { ...process.env, PGAPPNAME: name } });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", () => { children.delete(child); reject(new Error(`${name}: psql unavailable`)); });
    child.on("close", (code) => {
      children.delete(child);
      if (code === 0) resolve(stdout.trim());
      // The ERROR/FATAL line only: enough to diagnose, and the fixture holds no real data.
      else reject(new Error(`${name} failed: ${stderr.split(/\r?\n/).find((l) => /ERROR|FATAL/.test(l)) ?? `exit ${code}`}`));
    });
    child.stdin.end(sql);
  });
  // Handled here so a session that is ended mid-scenario never becomes an unhandled rejection;
  // whoever awaits `p` still sees the failure.
  p.catch(() => {});
  return p;
};

const waitFor = async (what, sql, timeoutMs = WAIT_MS) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (run(sql) === "t") return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for: ${what}`);
};

// Ends the named sessions by pid and waits (up to 5s each) until they are gone, so their row and
// advisory locks are released when this returns. A session that finished on its own in between
// is not an error (client_min_messages hides that warning).
const endSessions = (names) => {
  const list = names.map((n) => `'${n}'`).join(", ");
  try {
    run(`SET statement_timeout = '15s'; SET client_min_messages = error;
      SELECT count(pg_terminate_backend(pid, 5000)) FROM pg_stat_activity
       WHERE application_name IN (${list}) AND pid <> pg_backend_pid();`, 20000);
  } catch (e) {
    console.error(`WARNING: could not end sessions ${list}: ${e.message.split("\n")[0]}`);
  }
};
const endAllSessions = () => {
  try {
    run(`SET statement_timeout = '15s'; SET client_min_messages = error;
      SELECT count(pg_terminate_backend(pid, 5000)) FROM pg_stat_activity
       WHERE starts_with(application_name, '${appPrefix}') AND pid <> pg_backend_pid();`, 20000);
  } catch (e) {
    console.error(`WARNING: could not end this run's sessions: ${e.message.split("\n")[0]}`);
  }
  for (const child of children) child.kill("SIGKILL");
};

const heldList = (client) => run(`
  SELECT string_agg(value, ',' ORDER BY value) FROM public.client_contact_methods
   WHERE client_id = '${client}' AND kind = 'email';`).split(",").filter(Boolean);

const cleanup = () => {
  // The database is disposable: a row left behind is reported, never hidden, and never overturns
  // a verdict the assertions already reached. Every session of this run is ended first, and each
  // DELETE gives up after a short lock wait, so cleanup cannot hang on a lock someone still holds.
  endAllSessions();
  try {
    const out = run(`
      SET lock_timeout = '5s';
      SET statement_timeout = '20s';
      DO $$
      DECLARE _step text;
      BEGIN
        FOREACH _step IN ARRAY ARRAY[
          $s$DELETE FROM public.paige_audit_log WHERE tenant_id = '${tenant}'$s$,
          $s$DELETE FROM public.pii_access_log WHERE accessor_user_id = '${user}'$s$,
          $s$DELETE FROM public.client_contact_methods WHERE tenant_id = '${tenant}'$s$,
          $s$DELETE FROM public.clients WHERE tenant_id = '${tenant}'$s$,
          $s$DELETE FROM public.tenant_members WHERE tenant_id = '${tenant}'$s$,
          $s$DELETE FROM public.tenants WHERE id = '${tenant}'$s$,
          $s$DELETE FROM auth.users WHERE id = '${user}'$s$]
        LOOP
          BEGIN
            EXECUTE _step;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'contact-methods-add-race cleanup left rows (% on: %)', SQLSTATE, _step;
          END;
        END LOOP;
      END $$;`, 30000);
    if (out) console.log(out);
  } catch (e) {
    console.error(`WARNING: contact-methods-add-race cleanup did not finish: ${e.message.split("\n")[0]}`);
  }
};

// The run's hard deadline: whatever is still waiting is ended, the fixture is removed, and the
// run exits non-zero. unref() so a run that finishes in time is not kept alive by the timer.
const deadline = setTimeout(() => {
  console.error(`FAIL: the proof did not finish within ${RUN_TIMEOUT_MS} ms; ending its sessions and exiting.`);
  cleanup();
  process.exit(1);
}, RUN_TIMEOUT_MS);
deadline.unref();

// The gate: a session holding an advisory lock. Each writer (session A) makes its write and then
// waits on that lock, so it holds the contact's row lock for exactly as long as this runner says —
// no timing guesses. Cancelling the gate's sleep ends its session, which releases the lock. Each
// scenario has its own key, so a gate a failed scenario left behind cannot block the next one.
const gateKeyBase = 7000000000 + Math.floor(Math.random() * 1000000000);
const openGate = async (i) => {
  const app = appName("gate", i);
  const key = gateKeyBase + i;
  const done = session(app, `SET statement_timeout = '${GATE_SLEEP_S + 5}s';
    SELECT pg_advisory_lock(${key}); SELECT pg_sleep(${GATE_SLEEP_S});`).catch(() => "released");
  await waitFor("the gate holding its lock", `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
     WHERE application_name = '${app}' AND wait_event = 'PgSleep');`);
  return {
    key,
    release: async () => {
      run(`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name = '${app}';`);
      await done;
    },
  };
};

const scenario = async (i, holderName, heldTag, holderCall, erase = false) => {
  const client = clients[i];
  const gateApp = appName("gate", i);
  const holderApp = appName("holder", i);
  const adderApp = appName("adder", i);
  const limits = `SET lock_timeout = '${SESSION_LOCK_TIMEOUT}'; SET statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';`;
  const sessions = [];
  try {
    const gate = await openGate(i);
    const holder = session(holderApp, `${limits}
      BEGIN; SET LOCAL ROLE service_role;
      SELECT 1 FROM (SELECT ${holderCall}) AS w;
      RESET ROLE;
      SELECT pg_advisory_xact_lock_shared(${gate.key});
      COMMIT;`);
    sessions.push(holder);
    // A has written its address (so it holds the contact's row lock) and now waits on the gate.
    await waitFor(`${holderName} holding the contact`, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
       WHERE application_name = '${holderApp}' AND wait_event_type = 'Lock' AND wait_event = 'advisory');`);
    const adder = session(adderApp, `${limits}
      BEGIN; SET LOCAL ROLE service_role;
      SET LOCAL request.jwt.claims = '{"role":"service_role"}';
      SELECT ${erase
        ? `public.handle_data_subject_request('${tenant}', '${client}', 'delete', NULL, 'Disposable race proof', '${user}')`
        : `public._add_client_contact_methods('${tenant}', '${client}', '[{"kind":"email","value":"${addr("added", i)}"}]'::jsonb)`};
      COMMIT;`);
    sessions.push(adder);
    // B must be blocked by A before A commits, or this run says nothing about the race.
    await waitFor("the add waiting on the contact's lock", `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
       WHERE application_name = '${adderApp}' AND wait_event_type = 'Lock' AND wait_event <> 'advisory');`);
    await gate.release();
    await holder;
    const result = await adder;
    if (erase) {
      const receipt = JSON.parse(result);
      assert.equal(receipt.redacted, true);
      assert.equal(receipt.addresses_removed, 1, "erasure must count the newly committed replacement address");
      assert.equal(run(`SELECT count(*) FROM public.client_contact_methods WHERE client_id = '${client}'`), "0",
        "erasure must not leave the replacement address behind");
      assert.equal(run(`SELECT first_name = 'REDACTED' AND last_name = 'REDACTED' AND status = 'archived'
        FROM public.clients WHERE id = '${client}' AND tenant_id = '${tenant}'`), "t");
      assert.equal(run(`SELECT count(*) FROM public.paige_audit_log
        WHERE tenant_id = '${tenant}' AND target_id = '${client}' AND actor_user_id = '${user}' AND action = 'dsr.delete'`), "1");
      console.log("PASS (replacement versus erasure): the erasure waited, removed the committed replacement, and recorded one scoped audit outcome.");
      return;
    }
    const held = heldList(client);
    const expected = [addr("added", i), addr("orig", i), addr(heldTag, i)].sort();
    assert.deepEqual(held, expected,
      `with ${holderName} holding the contact, the concurrent add must keep that writer's address; the contact holds ${JSON.stringify(held)}`);
    console.log(`PASS (${holderName} holding the contact): the add waited on the contact's lock, then kept the other writer's address (3 of 3 held).`);
  } finally {
    // On every path, pass or fail: nothing this scenario started outlives it. Ending the gate
    // releases its advisory key; ending the holder rolls back its write and releases the row lock.
    endSessions([gateApp, holderApp, adderApp]);
    let timer;
    await Promise.race([Promise.allSettled(sessions), new Promise((r) => { timer = setTimeout(r, 5000); })]);
    clearTimeout(timer);
  }
};

// Each scenario reports its own result, so one red scenario cannot hide the other.
let failed = 0;
let fixtureFailed = false;
const attempt = async (...a) => {
  try {
    await scenario(...a);
  } catch (e) {
    failed += 1;
    console.error(`FAIL (${a[1]} holding the contact): ${e.message.split("\n")[0]}`);
  }
};
try {
  run(`
    BEGIN;
    INSERT INTO auth.users (id, aud, role, email)
      VALUES ('${user}', 'authenticated', 'authenticated', 'cm-race-owner-${suffix}@tests.invalid');
    INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, account_number, features)
      VALUES ('${tenant}', 'cm-add-race-${suffix}', 'Contact Methods Add Race', 'active', 'standalone', '${prefix}', ${accountNumber}, '{}'::jsonb);
    INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number) VALUES
      ('${clients[0]}', '${tenant}', '${user}', 'Race', 'One', '${prefix}-1-${suffix}'),
      ('${clients[1]}', '${tenant}', '${user}', 'Race', 'Two', '${prefix}-2-${suffix}'),
      ('${clients[2]}', '${tenant}', '${user}', 'Race', 'Three', '${prefix}-3-${suffix}');
    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner)
      VALUES ('${tenant}', '${user}', 'owner', 'active', true);
    INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position) VALUES
      ('${tenant}', '${clients[0]}', 'email', '${addr("orig", 0)}', true, 0),
      ('${tenant}', '${clients[1]}', 'email', '${addr("orig", 1)}', true, 0),
      ('${tenant}', '${clients[2]}', 'email', '${addr("orig", 2)}', true, 0);
    COMMIT;
  `);
  await attempt(0, "an add", "held-add",
    `public._add_client_contact_methods('${tenant}', '${clients[0]}', '[{"kind":"email","value":"${addr("held-add", 0)}"}]'::jsonb)`);
  await attempt(1, "a checked whole-list replace", "held-replace",
    `public._replace_client_contact_methods_checked('${tenant}', '${clients[1]}',
       '[{"kind":"email","value":"${addr("orig", 1)}","is_primary":true},{"kind":"email","value":"${addr("held-replace", 1)}"}]'::jsonb,
       '[{"kind":"email","value":"${addr("orig", 1)}","is_primary":true}]'::jsonb)`);
  await attempt(2, "a checked replacement before erasure", "held-replace",
    `public._replace_client_contact_methods_checked('${tenant}', '${clients[2]}',
       '[{"kind":"email","value":"${addr("held-replace", 2)}","is_primary":true}]'::jsonb,
       '[{"kind":"email","value":"${addr("orig", 2)}","is_primary":true}]'::jsonb)`, true);
} catch (e) {
  fixtureFailed = true;
  console.error(`FAIL (fixture): the test rows could not be written: ${e.message.split("\n")[0]}`);
} finally {
  cleanup();
  clearTimeout(deadline);
}
if (fixtureFailed) process.exit(1);
if (failed) {
  console.error(`FAIL: ${failed} of 3 contact-method concurrency scenarios failed.`);
  process.exit(1);
}
console.log("PASS: concurrent additions preserve committed addresses; erasure removes committed replacement addresses.");
