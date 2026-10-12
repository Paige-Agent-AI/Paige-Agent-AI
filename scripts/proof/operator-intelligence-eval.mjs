// INT-280: isolated actual PostgreSQL proof; never accepts a remote URL or credentials.
import { readFile } from 'node:fs/promises';
import { OperatorPostgresFixture } from './operator-postgres-fixture.mjs';

if (process.argv[2] !== '--postgres') throw new Error('Use --postgres with the CI service or a dedicated local fixture port.');
const db = new OperatorPostgresFixture(Number(process.argv[3] ?? 5432));
try {
  await db.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
  CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.tenant_id',true),'')::uuid $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
  CREATE TABLE public.user_roles (user_id uuid, role text);
  CREATE TABLE public.paige_audit_log (tenant_id uuid, actor_user_id uuid, actor_role text, action text, target_type text, payload jsonb);`);
  const roleSource = await readFile('supabase/migrations/20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql', 'utf8');
  const predicate = roleSource.match(/CREATE OR REPLACE FUNCTION public\.is_platform_admin\(\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.is_platform_admin\(\)[^;]*;/)?.[0];
  if (!predicate) throw new Error('Canonical Operator predicate not found; refusing a replacement authorization model.');
  await db.exec(predicate);
  const schema = await readFile('supabase/migrations/20260720044049_paige_eval.sql', 'utf8');
  await db.exec(schema);
  await db.exec(schema);
  const migration = await readFile('supabase/migrations/20270602000204_operator_intelligence_eval_history.sql', 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const proof = db.run(await readFile('supabase/tests/operator_intelligence_eval_history.sql', 'utf8'));
  if (!proof.includes('PASS: caller guards, ACL, null scores, metadata privacy, bounds, audit and fail-closed audit')) throw new Error('SQL proof did not return its completion readback.');
  console.log(proof);
  console.log('PASS: canonical eval schema and bounded projection replay twice in disposable loopback PostgreSQL.');
} finally {
  await db.close(); // Existing CI container/local fixture cluster owns disposal.
}
