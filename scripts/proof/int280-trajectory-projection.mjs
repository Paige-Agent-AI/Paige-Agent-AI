// Synthetic source metadata and actual canonical completion/projection functions, local only.
import { readFile, writeFile } from 'node:fs/promises';
import { trajectoryFixture } from './int280-trajectory-fixture.mjs';
if(process.argv[2]!=='--postgres')throw new Error('Use --postgres with isolated CI or dedicated loopback fixture port.');
const db=await trajectoryFixture(Number(process.argv[3]??5432));
try {
  await db.exec(await readFile('supabase/tests/int280_trajectory_seed.sql','utf8'));
  await db.exec(`ALTER TABLE public.paige_chat_threads ADD COLUMN message_count integer DEFAULT 0,ADD COLUMN last_message_at timestamptz,ADD COLUMN auto_delete_at timestamptz,ADD COLUMN updated_at timestamptz;
    CREATE TABLE public.marketing_content(id uuid PRIMARY KEY,tenant_id uuid,created_by uuid,kind text,title text,body text,brief text,status text,meta jsonb,updated_at timestamptz);
    CREATE TABLE public.paige_chat_turns(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),thread_id uuid,role text,content text,surfaces_used text[],load_id uuid,model text,tokens_used integer,latency_ms integer,bundle_ref jsonb,tool_calls jsonb,created_at timestamptz DEFAULT now(),interactive_intent_id uuid,interactive_actor_id uuid,interactive_tenant_id uuid,interactive_terminal_state text);
    CREATE TABLE public.audit_logs(user_id uuid,entity text,action text,entity_id uuid,data jsonb);
    CREATE TABLE public.paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT now(),actor_agent_slug text,actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
    CREATE TABLE public.paige_subagents(slug text PRIMARY KEY,tenant_id uuid,rail_display_name text,version integer NOT NULL DEFAULT 1);
    CREATE SCHEMA realtime;
    -- Only notification transport is inert: authoritative receipt persistence remains the real writer.
    CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION public._workspace_event_display(text,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    ALTER TABLE public.research_runs ADD COLUMN tenant_id uuid,ADD COLUMN user_id uuid,ADD COLUMN question text,ADD COLUMN configured boolean,ADD COLUMN stop_reason text,ADD COLUMN coverage jsonb,ADD COLUMN findings jsonb;
    CREATE TABLE public.research_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid,tenant_id uuid,user_id uuid,source_index integer,url text,excluded boolean DEFAULT false);
    ALTER TABLE public.paige_act_executions ADD COLUMN tenant_id uuid,ADD COLUMN event_id uuid,ADD COLUMN act_id uuid,ADD COLUMN capability_key text,ADD COLUMN outcome text,ADD COLUMN effective_lane text,ADD COLUMN decided_at timestamptz,ADD COLUMN dispatched_at timestamptz,ADD COLUMN settled_at timestamptz,ADD COLUMN provider_ref text;
    CREATE TABLE public.paige_pending_approvals(id uuid PRIMARY KEY,tenant_id uuid,status text,metadata jsonb,draft_content jsonb,created_at timestamptz,reviewed_at timestamptz,source text);
    DROP TABLE public.paige_eval_run;`);
  await db.exec(await readFile('supabase/migrations/20260720044049_paige_eval.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/20260719150000_paige_llm_trace.sql','utf8'));
  await db.exec('ALTER TABLE public.paige_llm_trace ADD COLUMN working_context_tenant_id uuid,ADD COLUMN retired_working_context_tenant_id uuid,ADD COLUMN cache_read_input_tokens integer,ADD COLUMN cache_creation_input_tokens integer');
  await db.exec(await readFile('supabase/migrations/20270107000000_receipt_correlation_and_detail.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/20270416000000_the_receipt_seam_lost_its_lock_to_an_overload.sql','utf8'));
  const document=await readFile('supabase/migrations/20270418000000_paige_durable_document_work.sql','utf8');
  const correlation=document.slice(document.indexOf('-- The canonical artifact and transcript gain correlation only.'),document.indexOf('-- Authenticated submission:'));
  await db.exec(correlation);
  const completion=document.match(/create or replace function public\.complete_paige_document_work\([\s\S]*?to service_role;/)?.[0];
  if(!completion)throw new Error('Actual canonical document completion function missing');
  await db.exec(completion);
  await db.exec(await readFile('supabase/migrations/20270602000400_int280_durable_trajectory_history.sql','utf8'));
  const projection=await readFile('supabase/migrations/20270602000401_int280_operator_trajectories.sql','utf8');
  await db.exec(projection);await db.exec(projection);
  const proof=db.run(await readFile('supabase/tests/int280_operator_trajectories.sql','utf8'));
  if(!proof.includes('PASS: trajectory reconstruction, canonical readback, missing/stale/conflicting evidence, scope, roles, cursor, privacy and audit refusal'))throw new Error('Projection completion missing');
  if(process.argv[4]) {
    if(process.argv[4]!=='--evidence-out'||!process.argv[5])throw new Error('Optional export requires --evidence-out path');
    const rows=await db.query('SELECT payload FROM int280_fixture_snapshot');
    await writeFile(process.argv[5],JSON.stringify({ fixture:'CONTROLLED LOCAL SYNTHETIC: actual canonical completion and projection, no production evidence',page:rows.rows[0].payload },null,2)+'\n');
  }
  console.log(proof);
  // AI-2 uses the same actual canonical writers and disposable PostgreSQL scope.
  // Remove only the preceding proof's deliberately refusing LOCAL audit trigger.
  await db.exec('DROP TRIGGER int280_fixture_audit_refusal ON public.paige_audit_log; ALTER TABLE public.paige_eval_run ADD COLUMN work_id uuid REFERENCES public.paige_durable_work(id) ON DELETE RESTRICT');
  await db.exec(await readFile('supabase/migrations/20270602000424_int280_task_evaluations.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/20270602000424_int280_task_evaluations.sql','utf8'));
  const evaluations=db.run(await readFile('supabase/tests/int280_task_evaluations.sql','utf8'));
  if(!evaluations.includes('PASS: deterministic canonical task evaluation'))throw new Error('Task evaluation proof missing');
  console.log(evaluations);
  await db.exec(await readFile('supabase/migrations/20270602000424_int280_task_evaluations.sql','utf8'));
  // Projection is a separate bounded read-only slice; no synthetic records enter production.
  let absent=false;
  try { db.run('SELECT public.operator_intelligence_task_scorecard()'); } catch(error) { absent=error.code==='42883'; }
  if(!absent)throw new Error('Scorecard failing-first absence proof missing');
  const scorecard=await readFile('supabase/migrations/20270602000425_int280_task_scorecard.sql','utf8');
  await db.exec(scorecard);await db.exec(scorecard);
  const scorecardProof=db.run(await readFile('supabase/tests/int280_task_scorecard.sql','utf8'));
  if(!scorecardProof.includes('PASS: protected bounded task scorecard'))throw new Error('Scorecard proof missing');
  console.log(scorecardProof);
} finally {await db.close();}
