// Disposable loopback PostgreSQL only. Reuses the existing native fixture adapter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OperatorPostgresFixture } from './operator-postgres-fixture.mjs';

const port = Number(process.env.DURABLE_THREAD_PROOF_PORT);
assert.ok(Number.isInteger(port) && (port !== 5432 || process.env.CI === 'true') && port >= 1024 && port <= 65535,
  'Set DURABLE_THREAD_PROOF_PORT to an owned disposable loopback PostgreSQL port; 5432 requires CI=true.');
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
      tenant_id uuid NOT NULL,lens text,title text,audience text NOT NULL DEFAULT 'workspace'
        CHECK (audience IN ('workspace','customer_private')),
      is_archived boolean NOT NULL DEFAULT false,message_count integer NOT NULL DEFAULT 0,
      last_message_at timestamptz,auto_delete_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.marketing_content(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid,created_by uuid,kind text NOT NULL DEFAULT 'document',title text NOT NULL DEFAULT 'Fixture',
      body text,brief text,status text NOT NULL DEFAULT 'draft',meta jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.paige_chat_turns(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id uuid NOT NULL REFERENCES public.paige_chat_threads(id) ON DELETE CASCADE,
      role text NOT NULL,content text NOT NULL,surfaces_used text[],load_id uuid,model text,tokens_used integer,
      latency_ms integer,bundle_ref jsonb,tool_calls jsonb,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,entity text,action text,entity_id uuid,data jsonb);
    -- Existing Document proof's local transactional role/receipt ports. The real start/complete
    -- functions execute unchanged; this is not a provider or complete production Rail proof.
    CREATE FUNCTION public.has_tenant_role(_user_id uuid,_tenant_id uuid,_role text) RETURNS boolean
      LANGUAGE sql STABLE SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_members m
        WHERE m.user_id=_user_id AND m.tenant_id=_tenant_id AND m.status='active'
          AND (m.role=_role OR (_role='owner' AND m.is_owner))) $$;
    CREATE TABLE public.proof_document_receipts(run_id uuid PRIMARY KEY,tenant_id uuid,actor_id uuid,
      capability_key text,outcome text,job_attempt_id text,detail jsonb);
    CREATE FUNCTION public.record_capability_run(_tenant_id uuid,_actor_id uuid,_capability_key text,
      _outcome text,_run_id uuid,_agent_slug text DEFAULT NULL,_job_attempt_id text DEFAULT NULL,
      _llm_trace_id uuid DEFAULT NULL,_release_id text DEFAULT NULL,_detail jsonb DEFAULT NULL)
      RETURNS void LANGUAGE sql SET search_path='' AS $$
        INSERT INTO public.proof_document_receipts VALUES(_run_id,_tenant_id,_actor_id,_capability_key,
          _outcome,_job_attempt_id,_detail) ON CONFLICT (run_id) DO NOTHING $$;
    REVOKE ALL ON FUNCTION public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb)
      FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb) TO service_role;
    CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.knowledge_actor_authorized(uuid,uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT false $$;
    ${nativeRuns.map(name => `CREATE TABLE public.${name}(id uuid PRIMARY KEY DEFAULT gen_random_uuid());`).join('\n')}`);
  fixture.run(read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql'));
  fixture.run(read('supabase/migrations/20270418000000_paige_durable_document_work.sql'));
  const retirement = read('supabase/migrations/20270504000000_retire_title_role_from_functions.sql');
  const helpers = retirement.slice(retirement.indexOf('CREATE FUNCTION pg_temp.reads_retired_role('),
    retirement.indexOf('-- Lists and separate branches'));
  assert.ok(helpers.includes('CREATE FUNCTION pg_temp.retire_role('));
  fixture.run(`${helpers}
    SELECT pg_temp.retire_role('public.submit_paige_document_work(uuid,uuid,jsonb)'::regprocedure);
    SELECT pg_temp.retire_role('public.start_paige_document_work_execution(uuid)'::regprocedure);
    SELECT pg_temp.retire_role('public.recover_paige_document_work(integer)'::regprocedure);`);
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
    WHERE initiating_user_id='d7c00000-0000-4000-8000-000000000001'
      AND scope_epoch='existing-fixture-scope'`)).rows;
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
  // Two real PostgreSQL connections: completion has written artifact/turn/terminal but has
  // not committed when DELETE begins. Reuse the existing held-transaction adapter barrier.
  if (!baseline) {
    const parent = (await fixture.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    fixture.run(`INSERT INTO public.paige_chat_threads(id,tenant_id,caller_user_id) VALUES(
      '${parent}','d7c00000-0000-4000-8000-000000000010','d7c00000-0000-4000-8000-000000000001')`);
    const work = (await fixture.query(`SELECT work_id,server_idempotency_key FROM public.create_paige_durable_work(
      'd7c00000-0000-4000-8000-000000000010','d7c00000-0000-4000-8000-000000000001',gen_random_uuid(),
      '${parent}','documents.author','document_authoring',
      '{"tenant_id":"d7c00000-0000-4000-8000-000000000010","actor_user_id":"d7c00000-0000-4000-8000-000000000001"}',
      'concurrent-fixture-scope',300,3)`)).rows[0];
    fixture.run(`UPDATE public.paige_durable_work SET request_payload='{"brief":"Synthetic concurrent input"}'
      WHERE id='${work.work_id}'; SELECT * FROM public.start_paige_document_work_execution('${work.work_id}')`);
    const completion = `SELECT * FROM public.complete_paige_document_work('${work.work_id}',
      '${work.server_idempotency_key}','guide','Concurrent fixture document',
      '[{"type":"paragraph","text":"Synthetic local output"}]','proof','synthetic',1,1)`;
    const held = await fixture.holdArchive(completion);
    try {
      assert.equal((await fixture.query(`SELECT status FROM public.paige_durable_work WHERE id='${work.work_id}'`)).rows[0].status,
        'claimed', 'Barrier must expose completion still uncommitted, not an already settled sequential control');
      assert.throws(() => fixture.run(`DELETE FROM public.paige_chat_threads WHERE id='${parent}'`),
        error => error.code === '22023' && error.message.includes('DURABLE_WORK_IDENTITY_IMMUTABLE'));
    } finally {
      await held.completed;
    }
    const replay = (await fixture.query(completion)).rows[0];
    assert.equal(replay.content_id, work.work_id);
    const persisted = (await fixture.query(`SELECT w.status,w.thread_id,
      (SELECT count(*)::int FROM public.marketing_content WHERE work_id=w.id) AS artifacts,
      (SELECT count(*)::int FROM public.paige_chat_turns WHERE work_id=w.id) AS turns,
      (SELECT count(*)::int FROM public.proof_document_receipts WHERE run_id=w.id) AS receipts,
      (SELECT count(*)::int FROM public.audit_logs WHERE entity_id=w.id AND action='durable_document_complete') AS audits
      FROM public.paige_durable_work w WHERE w.id='${work.work_id}'`)).rows[0];
    assert.deepEqual(persisted,{status:'succeeded',thread_id:parent,artifacts:1,turns:1,receipts:1,audits:1});
    console.log('PASS: two actual connections retain parent during uncommitted completion and preserve exact native success replay');
  }
  assert.deepEqual(await existingRows(), existingBefore, 'Rolled-back proof must not alter pre-existing work');
  if (!baseline) assert.deepEqual({ ...(await snapshot()).rows[0], definer: false }, before);
  console.log(`PASS: ${count} actual SQL assertions; no provider, remote database or production fixtures`);
  console.log(`fixture_database=${fixture.database}; proof=${fileURLToPath(new URL('supabase/tests/paige_durable_work_thread_detach.sql', root))}`);
} finally {
  await fixture.close(); // Outer owned cluster lifecycle handles disposal, never production reset.
}
