// Experience 04 · E4-S1 source parity: the composer over the REAL database read.
//
// Runs supabase/tests/exp04_client_engagement_status.sql (full schema, rollback-only, synthetic)
// against a disposable database, takes the owner's actual read_client_engagement_status output,
// composes it with the shared composer, and asserts every derived figure against values worked
// out by hand from the fixture ledger. A green run proves database facts and composer arithmetic
// agree end to end; it is not an authenticated browser run.
//
// Usage: node --experimental-strip-types scripts/proof/exp04-client-status-parity.mjs <postgres-url>
//        [--write-fixture]   also refreshes the composer unit-test fixture from this run.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { composeClientEngagementStatus, parseClientEngagementSource } from '../../supabase/functions/_shared/client-engagement/status.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const url = process.argv[2];
if (!url || !/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
  throw new Error('A local disposable PostgreSQL URL is required; this proof never targets a remote project.');
}
const run = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-f', 'supabase/tests/exp04_client_engagement_status.sql'],
  { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
assert.equal(run.status, 0, run.stderr);
const line = run.stdout.split('\n').find(l => l.startsWith('E4_STATUS_JSON:'));
assert(line, 'the SQL proof emitted the owner read');
const raw = JSON.parse(line.slice('E4_STATUS_JSON:'.length));
const status = composeClientEngagementStatus(parseClientEngagementSource(raw));
const m = status.money;

// Hand-worked from the fixture ledger (see the SQL file). The ledger is writer-legal: the invoice bound
// to the terms carries the whole $3,500, so what is past due on it comes from the agreed schedule.
//   billed (issued): E4-0001 contract 350000 + E4-0002 add-on 12000 = 362000; draft 99900 and void 77700 excluded
//   real receipts on E4-0001: 50000 recorded by the owner (deposit) + 5000 recorded and reversed (net 0) + 10000 live verified
//   test environment: 30000 on E4-0001 — never real money, never reduces what is owed
//   outstanding: (350000-60000) + 12000 = 302000 (includes schedule rows not yet due)
//   schedule due before today: deposit 50000 (today-40) + month 1 30000 (today-10) = 80000
//   past due: E4-0001 80000-60000 = 20000; E4-0002 past its due date, 12000 -> 32000
//   due to date 80000 -> behind by 80000 - 60000 = 20000; agreed but not invoiced = 0
// Two independent date computations agree: the database's owner-local date and the composer's own
// (shared IANA helper over read_at). Both use the owner's configured zone, never UTC.
assert.deepEqual(status.time_zone, { state: 'configured', zone: 'America/New_York' });
assert.equal(status.as_of_date, raw.as_of_date, 'composer and database agree on the owner-local date');
assert.equal(m.currency, 'usd');
assert.equal(m.mixed_currency, false);
assert.equal(m.contracted_minor, 350000, 'contracted');
assert.equal(m.invoiced_minor, 362000, 'invoiced (drafts and voids excluded)');
assert.equal(m.invoiced_against_terms_minor, 350000, 'invoiced against the terms');
assert.deepEqual(m.received_against_terms, { verified_minor: 10000, recorded_by_owner_minor: 50000 }, 'received against the terms, by evidence class');
assert.equal(m.not_yet_invoiced_minor, 0, 'the whole agreement is invoiced');
assert.equal(m.received.verified_minor, 10000, 'provider-verified live');
assert.equal(m.received.recorded_by_owner_minor, 50000, 'recorded by the owner, net of reversal');
assert.equal(m.received.test_environment_minor, 30000, 'test money reported apart');
assert.equal(m.outstanding_minor, 302000, 'outstanding ignores test money');
assert.equal(m.overdue_minor, 32000, 'past due comes from the schedule on the contract invoice, not its whole balance');
assert.equal(m.awaiting_confirmation_minor, 20000, 'payment awaiting the client is in flight, not received');
assert.equal(m.outcome_unknown_count, 1, 'unknown provider outcome');
assert.equal(m.failed_request_count, 1, 'failed payment request');
assert.equal(m.due_to_date_minor, 80000, 'due to date from the canonical schedule');
assert.equal(m.behind_schedule_minor, 20000, 'behind schedule against terms-bound receipts');
assert.equal(m.reversal_count, 1);
assert.equal(m.disputes, 'not_recorded');
assert.equal(status.terms?.state, 'current');
assert.equal(status.terms?.schedule.length, 11);
assert.equal(status.agreement.state, 'signed');
assert.equal(status.agreement.bound_to_terms, true);
assert.equal(status.agreement.effective, 'not_recorded');
assert.equal(status.work.state, 'behind');
assert.deepEqual([status.work.total, status.work.done, status.work.open, status.work.overdue], [3, 1, 2, 1]);
const byNumber = Object.fromEntries(status.invoices.map(i => [i.number, i]));
assert.equal(byNumber['E4-0001'].payment_state, 'awaiting_confirmation');
assert.equal(byNumber['E4-0001'].bound_to_terms, true);
assert.equal(byNumber['E4-0001'].outstanding_minor, 290000, 'a test-environment settlement never reduces what is owed');
assert.equal(byNumber['E4-0001'].past_due_minor, 20000);
assert.equal(byNumber['E4-0002'].payment_state, 'outcome_unknown');
assert.equal(byNumber['E4-0002'].bound_to_terms, false);
assert.equal(byNumber['E4-0002'].past_due_minor, 12000);
assert.equal(byNumber['E4-0003'].payment_state, 'draft');
assert.equal(byNumber['E4-0004'].payment_state, 'void');
for (const flag of ['payment_overdue', 'behind_schedule', 'payment_outcome_unknown', 'payment_request_failed', 'work_overdue']) {
  assert(status.attention.includes(flag), `attention: ${flag}`);
}
assert(!status.attention.includes('agreement_not_signed'));
assert(!status.attention.includes('terms_invoiced_more_than_once'));

if (process.argv.includes('--write-fixture')) {
  writeFileSync(root + 'src/__tests__/fixtures/exp04-client-status-source.json', JSON.stringify(raw, null, 2) + '\n');
}
console.log(`✓ exp04 client-status parity: ${Object.keys(m).length} money fields, ${status.invoices.length} invoices, work and agreement agree with the ledger (as of ${status.as_of_date}).`);
