// Two-session proof: one answer per question, under a real race (C4c, 20270596000000).
//
// The chat handler binds a person's answer to PAIGE's question by appending their turn with
// `bundle_ref.paige_resume.key = answer:<ask_id>`. Two requests can arrive at once (a double tap, two
// tabs, a retry). Both can read the question as still open; only the database can decide which one
// is the answer. `paige_chat_turns_resume_uk` must make exactly one of two CONCURRENT, COMMITTED
// appends win and the other fail with 23505 — not merely a sequential duplicate (the pgTAP proof
// covers that), and not by luck of timing.
//
// Each scenario, against real committed rows in a disposable database:
//   1. session A opens a transaction and inserts the answer turn (not yet committed);
//   2. session B inserts the same answer — and is observed WAITING (pg_stat_activity) on A;
//   3. A commits → B fails with 23505, and exactly one answer row exists.
//   Scenario 2 is the same, but A rolls back → B's insert lands: the one answer is B's.
//   Scenario 3: the same key in another thread does not wait and does not conflict.
//
// Disposable databases only: the CI Supabase stack (CI=true, 127.0.0.1:54322/postgres), or a local
// throwaway cluster named with CHAT_ANSWER_RACE_DISPOSABLE_DB=1. Fixture rows are committed (a second
// session cannot see another's uncommitted rows) and removed at the end. Every session carries its
// own lock_timeout / statement_timeout, and the run exits 1 past CHAT_ANSWER_RACE_TIMEOUT_MS (60s).
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { retireSyntheticTenantSQL } from "./operator-postgres-fixture.mjs";

const url = new URL(process.env.CHAT_ANSWER_RACE_TEST_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
assert.ok(
  (process.env.CI === "true" && url.hostname === "127.0.0.1" && url.port === "54322" && url.pathname === "/postgres")
    || process.env.CHAT_ANSWER_RACE_DISPOSABLE_DB === "1",
  "Disposable test database required (the CI Supabase stack, or CHAT_ANSWER_RACE_DISPOSABLE_DB=1 for a local throwaway cluster)",
);
const conn = process.env.CHAT_ANSWER_RACE_DISPOSABLE_DB === "1" && process.env.CHAT_ANSWER_RACE_PSQL_ARGS
  ? JSON.parse(process.env.CHAT_ANSWER_RACE_PSQL_ARGS)
  : ["-d", url.toString()];
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", ...conn];
const psqlBin = process.env.PSQL_BIN || "psql";
const RUN_TIMEOUT_MS = Number(process.env.CHAT_ANSWER_RACE_TIMEOUT_MS ?? 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (sql) => execFileSync(psqlBin, args, { input: sql, encoding: "utf8", timeout: 20000, killSignal: "SIGKILL" }).trim();

const runTimer = setTimeout(() => { console.error("chat-answer-claim-race: run timed out"); process.exit(1); }, RUN_TIMEOUT_MS);

/** A psql session fed on stdin, so a transaction can stay open while another session acts. */
function session(tag) {
  const child = spawn(psqlBin, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=0", ...conn], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  child.stdin.write(`SET application_name = 'c4c-race-${tag}'; SET lock_timeout = '15s'; SET statement_timeout = '20s';\n`);
  return {
    send: (sql) => child.stdin.write(`${sql}\n`),
    end: async () => { child.stdin.end(); await exited; return { out, err }; },
    kill: () => { try { child.kill("SIGKILL"); } catch { /* gone */ } },
  };
}

async function waitFor(predicate, label) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const userId = randomUUID();
const tenantId = randomUUID();
const threadA = randomUUID();
const threadB = randomUUID();
const prefix = `CQ${userId.slice(0, 4)}`.toUpperCase();
const answerRow = (thread, key) => `INSERT INTO public.paige_chat_turns (thread_id, role, content, bundle_ref) VALUES ('${thread}', 'user', 'Start it November 1.', '{"paige_resume":{"kind":"answer","key":"${key}","from_turn_id":"${randomUUID()}"}}'::jsonb);`;
const countAnswers = (thread, key) => Number(run(`SELECT count(*) FROM public.paige_chat_turns WHERE thread_id = '${thread}' AND role = 'user' AND bundle_ref->'paige_resume'->>'key' = '${key}';`));
const waitingOnLock = (tag) => run(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 'c4c-race-${tag}' AND wait_event_type = 'Lock';`) === "1";

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};

async function scenario(name, { commit }) {
  const key = `answer:${randomUUID()}`;
  const a = session(`${name}-a`);
  const b = session(`${name}-b`);
  try {
    a.send(`BEGIN; ${answerRow(threadA, key)} SELECT 'A-inserted';`);
    await sleep(200);
    b.send(`${answerRow(threadA, key)} SELECT 'B-done';`);
    await waitFor(() => waitingOnLock(`${name}-b`), `${name}: B waiting on A's uncommitted answer`);
    check(`${name}: the second answer WAITS on the first (observed in pg_stat_activity)`, true);
    a.send(commit ? "COMMIT;" : "ROLLBACK;");
    const ra = await a.end();
    const rb = await b.end();
    if (commit) {
      check(`${name}: the first commits; the second fails with 23505`,
        /duplicate key value violates unique constraint "paige_chat_turns_resume_uk"/.test(rb.err),
        JSON.stringify({ a: ra.err.slice(0, 200), b: rb.err.slice(0, 300) }));
    } else {
      check(`${name}: the first rolls back; the second's answer lands`, !/paige_chat_turns_resume_uk/.test(rb.err), rb.err.slice(0, 300));
    }
    check(`${name}: exactly one answer row exists for the question`, countAnswers(threadA, key) === 1, String(countAnswers(threadA, key)));
  } finally {
    a.kill();
    b.kill();
  }
}

try {
  run(`
    INSERT INTO auth.users (id, aud, role, email) VALUES ('${userId}', 'authenticated', 'authenticated', 'c4c-race-${userId.slice(0, 8)}@tests.invalid');
    INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features)
      VALUES ('${tenantId}', 'c4c-race-${tenantId.slice(0, 8)}', 'C4c Race', 'active', 'standalone', '${prefix}', '{}'::jsonb);
    INSERT INTO public.paige_chat_threads (id, caller_user_id, tenant_id, lens, title) VALUES
      ('${threadA}', '${userId}', '${tenantId}', 'coach', 'C4c race A'),
      ('${threadB}', '${userId}', '${tenantId}', 'coach', 'C4c race B');
  `);
  console.log("chat answer claim — two committed sessions, one question");
  await scenario("commit", { commit: true });
  await scenario("rollback", { commit: false });

  // Another thread: the same key is another question — no wait, no conflict.
  const key = `answer:${randomUUID()}`;
  run(answerRow(threadA, key));
  let other = null;
  try { run(answerRow(threadB, key)); } catch (e) { other = String(e?.stderr ?? e); }
  check("another thread: the same key is another question and lands", other === null, other ?? "");
} catch (e) {
  failures += 1;
  console.log(`  FAIL chat-answer-claim-race stopped: ${e?.message ?? e}`);
} finally {
  try {
    run(`DELETE FROM public.paige_chat_turns WHERE thread_id IN ('${threadA}', '${threadB}');
         DELETE FROM public.paige_chat_threads WHERE id IN ('${threadA}', '${threadB}');
         ${retireSyntheticTenantSQL(tenantId)}
         DELETE FROM auth.users WHERE id = '${userId}';`);
  } catch (e) { console.error("chat-answer-claim-race: cleanup failed", e?.message ?? e); failures += 1; }
  clearTimeout(runTimer);
}
if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log("\nall passed");
