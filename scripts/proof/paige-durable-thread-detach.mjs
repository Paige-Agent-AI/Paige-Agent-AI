// Disposable loopback PostgreSQL only. Reuses the existing native fixture adapter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OperatorPostgresFixture } from './operator-postgres-fixture.mjs';

const port = Number(process.env.DURABLE_THREAD_PROOF_PORT);
assert.ok(Number.isInteger(port) && port !== 5432 && port >= 1024 && port <= 65535,
  'Set DURABLE_THREAD_PROOF_PORT to an owned disposable loopback PostgreSQL port.');
const baseline = process.argv.includes('--baseline');
const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const fixture = new OperatorPostgresFixture(port);
const roles = ['anon', 'authenticated', 'service_role'];
const nativeRuns = ['paige_workflow_runs', 'paige_skill_runs', 'business_verification_runs',
  'security_canary_runs', 'paige_readiness_scan_runs', 'research_runs', 'paige_eval_run',
  'paige_systems_check_run', 'paige_authority_act_runs', 'paige_media_jobs',
  'paige_social_jobs', 'paige_act_executions'];
const latestCreate = read('supabase/migrations/20271108201000_e09_customer_private_chat.sql');
const createStart = latestCreate.indexOf('CREATE OR REPLACE FUNCTION public.create_paige_durable_work(');
const createEnd = latestCreate.indexOf('$function$;', createStart) + '$function$;'.length;
assert.ok(createStart >= 0 && createEnd > createStart, 'Current E09 creator definition missing');

try {
  // These roles have cluster scope; the cluster itself must be throwaway.
  for (const role of roles) fixture.run(`DO $$ BEGIN IF NOT EXISTS
    (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
  fixture.run(`CREATE ROLE durable_hidden_parent_probe NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, aud text, role text, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,slug text,name text,status text,
      account_type text,account_number_prefix text,features jsonb);
    CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role text,status text,
      is_owner boolean,joined_at timestamptz,PRIMARY KEY(tenant_id,user_id));
    CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
    CREATE TABLE public.paige_chat_threads(id uuid PRIMARY KEY,caller_user_id uuid NOT NULL,
      tenant_id uuid NOT NULL,lens text,title text,audience text NOT NULL DEFAULT 'workspace',
      is_archived boolean NOT NULL DEFAULT false);
    CREATE TABLE public.marketing_content(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.paige_chat_turns(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id uuid NOT NULL REFERENCES public.paige_chat_threads(id) ON DELETE CASCADE);
    CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.knowledge_actor_authorized(uuid,uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT false $$;
    ${nativeRuns.map(name => `CREATE TABLE public.${name}(id uuid PRIMARY KEY DEFAULT gen_random_uuid());`).join('\n')}`);
  fixture.run(read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql'));
  fixture.run(read('supabase/migrations/20270418000000_paige_durable_document_work.sql'));
  // Use the actual current creator, including E09 audience and Knowledge gates; no hand-copy.
  fixture.run(latestCreate.slice(createStart, createEnd));
  fixture.run(`INSERT INTO auth.users(id) VALUES('d7c00000-0000-4000-8000-000000000001');
    INSERT INTO public.tenants(id,status) VALUES('d7c00000-0000-4000-8000-000000000010','active');
    INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES
      ('d7c00000-0000-4000-8000-000000000010','d7c00000-0000-4000-8000-000000000001','owner','active');
    INSERT INTO public.paige_chat_threads(id,tenant_id,caller_user_id) VALUES
      ('d7c00000-0000-4000-8000-000000000020','d7c00000-0000-4000-8000-000000000010','d7c00000-0000-4000-8000-000000000001');
    SELECT work_id FROM public.create_paige_durable_work(
      'd7c00000-0000-4000-8000-000000000010','d7c00000-0000-4000-8000-000000000001',gen_random_uuid(),
      'd7c00000-0000-4000-8000-000000000020','documents.author','document_authoring',
      '{"tenant_id":"d7c00000-0000-4000-8000-000000000010","actor_user_id":"d7c00000-0000-4000-8000-000000000001"}',
      'existing-fixture-scope',300,3);
    UPDATE public.paige_durable_work SET request_payload='{"brief":"Existing neutral input"}';`);
  const existingRows = async () => (await fixture.query(`SELECT to_jsonb(w) AS value FROM public.paige_durable_work w
    WHERE initiating_user_id='d7c00000-0000-4000-8000-000000000001'`)).rows;
  const existingBefore = await existingRows();
  assert.equal(existingBefore.length, 1);
  const snapshot = () => fixture.query(`SELECT p.proowner::regrole::text AS owner,p.proacl::text AS acl,
    p.proargtypes::text AS args,p.prorettype::regtype::text AS result,p.proconfig AS config,
    p.prosecdef AS definer,(SELECT relacl::text FROM pg_class WHERE oid='public.paige_durable_work'::regclass) AS table_acl,
    (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.paige_durable_work'::regclass
      AND tgname='trg_paige_durable_work_identity') AS trigger
    FROM pg_proc p WHERE p.oid='public._paige_durable_work_protect_identity()'::regprocedure`);
  const before = (await snapshot()).rows[0];
  assert.equal(before.definer, false);
  if (!baseline) {
    const migration = read('supabase/migrations/20271110022000_durable_work_thread_detach.sql');
    assert.ok(migration.trim(), 'Successor migration must be populated before green proof');
    fixture.run(migration);
    fixture.run(migration); // CREATE OR REPLACE is safely repeatable; no rows rewritten.
    const after = (await snapshot()).rows[0];
    assert.equal(after.definer, true);
    assert.deepEqual({ ...after, definer: false }, before,
      'Owner, ABI, ACL, search_path, table ACL and trigger binding must remain exact');
    assert.deepEqual(await existingRows(), existingBefore, 'Migration/reapply must not rewrite existing work');
    console.log('PASS: exact owner/ABI/ACL/search_path/table ACL/trigger preserved; internal trigger now SECURITY DEFINER');
    console.log(`function_contract=${JSON.stringify({ before, after })}`);
    console.log('PASS: existing work row unchanged by migration and repeat application');
  }
  // Existing envelope controls are retained, including unknown-outcome reconciliation and terminal readback.
  const incumbent = fixture.run(read('supabase/tests/paige_durable_work_envelope.sql'));
  assert.ok(incumbent !== undefined);
  console.log('PASS: existing rolled-back durable envelope regression completed');
  const result = fixture.run(read('supabase/tests/paige_durable_work_thread_detach.sql'));
  const count = result.match(/DURABLE_THREAD_DETACH_PASS=(\d+)/)?.[1];
  assert.ok(count, 'Native proof did not emit its assertion total');
  assert.deepEqual(await existingRows(), existingBefore, 'Rolled-back proof must not alter pre-existing work');
  if (!baseline) assert.deepEqual({ ...(await snapshot()).rows[0], definer: false }, before);
  console.log(`PASS: ${count} actual SQL assertions; no provider, remote database or production fixtures`);
  console.log(`fixture_database=${fixture.database}; proof=${fileURLToPath(new URL('supabase/tests/paige_durable_work_thread_detach.sql', root))}`);
} finally {
  await fixture.close(); // Outer owned cluster lifecycle handles disposal, never production reset.
}
