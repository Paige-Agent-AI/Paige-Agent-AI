// Controlled isolated PostgreSQL only. Reuses the actual durable envelope and transition RPCs.
import { readFile } from 'node:fs/promises';
import { OperatorPostgresFixture } from './operator-postgres-fixture.mjs';
export async function trajectoryFixture(port) {
  const db = new OperatorPostgresFixture(port);
  await db.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
  CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.tenant_id',true),'')::uuid $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
  CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text);
  CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,status text,is_owner boolean DEFAULT false,role text DEFAULT 'member');
  CREATE TABLE public.paige_chat_threads(id uuid PRIMARY KEY,tenant_id uuid,caller_user_id uuid,is_archived boolean DEFAULT false);
  CREATE TYPE public.app_role AS ENUM('super_admin','platform_admin','admin','coach','user');
  CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
  CREATE TABLE public.paige_audit_log(tenant_id uuid,actor_user_id uuid,actor_role text,action text,target_type text,payload jsonb);
  `);
  const governance=await readFile('supabase/migrations/20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','utf8');
  const predicates=governance.match(/-- STEP 4: Canonical governance helpers([\s\S]*?)-- STEP 6:/)?.[1];
  if(!predicates)throw new Error('Canonical governance source missing; refusing replacement authority.');
  await db.exec(predicates);
  const adopters=['paige_workflow_runs','paige_skill_runs','business_verification_runs','security_canary_runs','paige_readiness_scan_runs','research_runs','paige_eval_run','paige_systems_check_run','paige_authority_act_runs','paige_media_jobs','paige_social_jobs','paige_act_executions'];
  for (const table of adopters) await db.exec(`CREATE TABLE public.${table}(id uuid PRIMARY KEY)`);
  await db.exec(await readFile('supabase/migrations/20270417000000_paige_durable_work_envelope.sql','utf8'));
  // Install the actual Document envelope extension, including its dispatch-attempt fence.
  const document=await readFile('supabase/migrations/20270418000000_paige_durable_document_work.sql','utf8');
  const extension=document.split('-- The canonical artifact and transcript gain correlation only.')[0];
  if(!extension.includes('paige_durable_work_dispatch_attempt_ck'))throw new Error('Canonical dispatch extension missing');
  await db.exec(extension);
  return db;
}
