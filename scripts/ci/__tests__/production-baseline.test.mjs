import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
const parent = path.join(repo, 'scripts/ci');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const vectorRevoke = 'REVOKE ALL ON FUNCTION "public"."vector_probe"("q" "extensions"."vector") FROM PUBLIC;';

function fixture(run) {
  const dir = mkdtempSync(path.join(parent, '.baseline-proof-'));
  const put = (name, text) => { mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); writeFileSync(path.join(dir, name), text, { mode: 0o755 }); };
  try {
    for (const name of ['.github/scripts/prod-readonly-baseline.sh', 'scripts/ci/reproduce-production-grants.sh']) {
      put(name, readFileSync(path.join(repo, name), 'utf8'));
    }
    put('supabase/config.toml', 'project_id = "test-project"\n');
    put('bin/supabase', `#!/usr/bin/env bash
set -euo pipefail
echo "supabase $*" >> calls
case "$1 $2" in
  'migration list')
    n=0; [ ! -f ledger_reads ] || n="$(cat ledger_reads)"; n=$((n+1)); echo "$n" > ledger_reads
    if [ "\${MODE:-}" = unreadable ]; then exit 1; fi
    if [ "\${MODE:-}" = churn ]; then
      printf '202501010000%02d\\n' "$n"
    elif [ "\${MODE:-}" = retry ] && [ "$n" -gt 1 ]; then echo 20250101000001
    else echo 20250101000000; fi
    ;;
  'db dump')
    args="$*"; dest="\${!#}"
    if [[ "$args" == *'--schema public'* ]]; then
      [ "\${MODE:-}" != publicfail ] || exit 17
      printf '%s\\n' '${vectorRevoke}' 'GRANT SELECT ON TABLE "public"."notes" TO "authenticated";' > "$dest"
    elif [[ "$args" == *'--role-only'* ]]; then echo '-- roles fixture' > "$dest"
    else printf '%s\\n' 'GRANT SELECT ON TABLE "public"."notes" TO "authenticated";' 'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" GRANT SELECT ON TABLES TO "authenticated";' > "$dest"; fi
    ;;
esac
`);
    // All transports are shell doubles. No CLI, database, token, or production endpoint is used.
    // Ledger parsing itself remains covered by the existing real parser self-test.
    put('bin/node', `#!/usr/bin/env bash
set -euo pipefail
echo "node $*" >> calls
case "$2" in
  --parse-ledger) cat "$3" ;;
  --reset-version)
    while [ "$#" -gt 0 ]; do if [ "$1" = --aside-list ]; then shift; : > "$1"; break; fi; shift; done
    echo 20250101000000 ;;
esac
`);
    run({ dir, put, read: name => readFileSync(path.join(dir, name), 'utf8'), exec: (script, mode = '') => {
      const result = spawnSync(bash, ['-c', 'export PATH="$PWD/bin:$PATH"; bash "$1" prod', 'baseline-proof', script], {
        cwd: dir, encoding: 'utf8', timeout: 15000, windowsHide: true,
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: 'synthetic-token', SUPABASE_DB_PASSWORD: 'synthetic-password', SUPABASE_PROJECT_ID: 'test-project', MODE: mode },
      });
      assert.ifError(result.error);
      assert.ok(Number.isInteger(result.status) && result.status >= 0 && result.status <= 255, `shell did not execute normally: ${result.stderr}`);
      return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
    } });
  } finally {
    const target = realpathSync(dir);
    assert.equal(path.dirname(target), realpathSync(parent));
    assert.ok(path.basename(target).startsWith('.baseline-proof-'));
    rmSync(target, { recursive: true, force: true });
  }
}

test('both object and full/default dumps remain inside the same stable ledger bracket', () => fixture(f => {
  const result = f.exec('.github/scripts/prod-readonly-baseline.sh');
  assert.equal(result.status, 0, result.output);
  const calls = f.read('calls');
  assert.equal((calls.match(/supabase migration list/g) ?? []).length, 2);
  assert.ok(calls.indexOf('migration list') < calls.indexOf('db dump --linked --schema public'));
  assert.ok(calls.lastIndexOf('migration list') > calls.indexOf('db dump --linked --schema public'));
  assert.ok(f.read('prod/baseline_public_acl.sql').includes(vectorRevoke));
  assert.ok(f.read('prod/baseline_schema.sql').includes('FOR ROLE "postgres" GRANT'));
  assert.ok(!f.read('prod/baseline_public_acl.sql').includes('DEFAULT PRIVILEGES'));
  assert.ok(calls.trim().endsWith('supabase unlink'));
  assert.ok(!/--data-only|db push|migration repair/.test(calls));
}));

test('a changing ledger retries all three dumps and refuses a second inconsistent snapshot', () => fixture(f => {
  const r = f.exec('.github/scripts/prod-readonly-baseline.sh', 'churn');
  assert.notEqual(r.status, 0);
  assert.match(r.output, /changed.*twice/);
  assert.equal((f.read('calls').match(/db dump --linked --schema public/g) ?? []).length, 2);
  assert.ok(f.read('calls').trim().endsWith('supabase unlink'));
}));

test('a failed public-object dump fails closed and unlinks production', () => fixture(f => {
  assert.notEqual(f.exec('.github/scripts/prod-readonly-baseline.sh', 'publicfail').status, 0);
  assert.ok(f.read('calls').trim().endsWith('supabase unlink'));
}));

test('a single ledger change settles only after refreshing every dump', () => fixture(f => {
  assert.equal(f.exec('.github/scripts/prod-readonly-baseline.sh', 'retry').status, 0);
  assert.equal((f.read('calls').match(/db dump --linked/g) ?? []).length, 6);
  assert.equal(f.read('prod/recorded_versions.txt'), '20250101000001\n');
  assert.ok(f.read('calls').trim().endsWith('supabase unlink'));
}));

test('an unreadable ledger never starts a dump and still unlinks', () => fixture(f => {
  assert.notEqual(f.exec('.github/scripts/prod-readonly-baseline.sh', 'unreadable').status, 0);
  assert.ok(!f.read('calls').includes('db dump'));
  assert.ok(f.read('calls').trim().endsWith('supabase unlink'));
}));

test('reconciliation routes object ACLs to the explicit public dump and defaults to the full dump before pending migrations', () => fixture(f => {
  assert.equal(f.exec('.github/scripts/prod-readonly-baseline.sh').status, 0);
  assert.equal(f.exec('scripts/ci/reproduce-production-grants.sh').status, 0);
  const calls = f.read('calls');
  const object = calls.indexOf('node scripts/ci/reproduce-production-grants.mjs --dump prod/baseline_public_acl.sql');
  const defaults = calls.indexOf('node scripts/ci/reproduce-production-grants.mjs --defaults --dump prod/baseline_schema.sql');
  assert.ok(object > calls.indexOf('supabase db reset --version'));
  assert.ok(defaults > object);
  assert.ok(calls.indexOf('supabase migration up --include-all --local') > defaults);
}));

test('a missing public-object dump cannot silently fall back to the filtered full dump', () => fixture(f => {
  f.put('prod/baseline_schema.sql', '-- stale full dump\n');
  assert.notEqual(f.exec('scripts/ci/reproduce-production-grants.sh').status, 0);
  assert.equal(existsSync(path.join(f.dir, 'calls')), false, 'refuse before reset or any CLI use');
}));
