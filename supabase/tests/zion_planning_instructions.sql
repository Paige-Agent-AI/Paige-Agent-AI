-- Isolated migrated CI database only. No model call or durable customer mutation.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_zion_plan(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'ZION_PLAN_PROOF_FAILED: %',label; END IF;
RAISE NOTICE 'PASS: %',label; END $$;
SELECT pg_temp.check_zion_plan((SELECT count(*)=1 FROM public.paige_subagents WHERE slug='zion' AND tenant_id IS NULL),'one original global identity');
SELECT pg_temp.check_zion_plan((SELECT version=3 AND runtime='soft' AND enabled
  AND domain='operations_automation' AND role='VP Operations & Automation'
  AND length(system_prompt)>0 AND config='{"job_kind":"plan"}'::jsonb
  FROM public.paige_subagents WHERE slug='zion'),'fresh migrated original planning instructions and route');
CREATE TEMP TABLE zion_plan_other AS SELECT slug,to_jsonb(s) AS fields FROM public.paige_subagents s WHERE slug<>'zion';
CREATE TEMP TABLE zion_plan_acl AS SELECT relacl,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.paige_subagents'::regclass;
CREATE TEMP TABLE zion_plan_factory AS SELECT * FROM public.paige_subagents WHERE slug='zion';
UPDATE zion_plan_factory SET system_prompt=NULL,config='{}',version=2;
CREATE FUNCTION pg_temp.restore_zion_plan_factory() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.paige_subagents s SET
    (tenant_id,name,domain,role,department,rail_display_name,description,goal,backstory,
     runtime,enabled,system_prompt,config,version,triggers,requires_role,auto_generated,input_schema,output_schema)
    =(SELECT tenant_id,name,domain,role,department,rail_display_name,description,goal,backstory,
       runtime,enabled,system_prompt,config,version,triggers,requires_role,auto_generated,input_schema,output_schema
       FROM zion_plan_factory)
  WHERE s.slug='zion';
END $$;
SELECT pg_temp.restore_zion_plan_factory();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan((SELECT version=3 AND length(system_prompt)>0 AND config='{"job_kind":"plan"}'::jsonb FROM public.paige_subagents WHERE slug='zion'),'original factory receives planning instructions atomically');
SELECT pg_temp.check_zion_plan((SELECT (to_jsonb(s)-ARRAY['system_prompt','config','version','updated_at'])=(to_jsonb(f)-ARRAY['system_prompt','config','version','updated_at']) FROM public.paige_subagents s CROSS JOIN zion_plan_factory f WHERE s.slug='zion'),'identity permissions triggers runtime and budgets unchanged');
CREATE TEMP TABLE zion_plan_first AS SELECT to_jsonb(s) AS fields FROM public.paige_subagents s WHERE slug='zion';
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan((SELECT to_jsonb(s)=f.fields FROM public.paige_subagents s CROSS JOIN zion_plan_first f WHERE slug='zion'),'replay exact no-op including version and timestamp');
CREATE TEMP TABLE zion_plan_protected(fields jsonb);
CREATE FUNCTION pg_temp.capture_zion_plan_protected() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE zion_plan_protected;
  INSERT INTO zion_plan_protected SELECT to_jsonb(s) FROM public.paige_subagents s WHERE slug='zion';
END $$;
CREATE FUNCTION pg_temp.check_zion_plan_protected(label text) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.check_zion_plan((SELECT to_jsonb(s)=p.fields FROM public.paige_subagents s CROSS JOIN zion_plan_protected p WHERE slug='zion'),label);
$$;
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET system_prompt='Operator custom instructions' WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('custom instructions preserved byte for byte');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET config='{"job_kind":"summarize","custom":true}' WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('custom routing configuration preserved');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET enabled=false WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('disabled registration remains disabled without new instructions');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET version=4 WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('later registry revision preserved');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET runtime='local' WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('custom runtime preserved');
SELECT pg_temp.restore_zion_plan_factory();
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand)
VALUES('e5050000-0000-4000-8000-00000000aaab','test-tenant-zion-plan-scope','Test tenant ZION plan scope','active','standalone','TVR',9383992,'{}','{}');
UPDATE public.paige_subagents SET tenant_id='e5050000-0000-4000-8000-00000000aaab' WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('tenant-owned registration preserved');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET name='Custom identity',rail_display_name='Custom label' WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('custom name and Rail label preserved');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET role='Custom role',domain='custom',department=NULL WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('custom remit and department preserved');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET description='Custom description',goal='Custom goal',backstory='Custom backstory' WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('custom identity instructions preserved');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET triggers=ARRAY['custom-trigger'] WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('event-triggered registration preserved without enabling a schedule');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET requires_role=ARRAY['admin'] WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('custom role restrictions preserved');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET auto_generated=true WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('nonfactory registration preserved');
SELECT pg_temp.restore_zion_plan_factory();
UPDATE public.paige_subagents SET input_schema='{"custom":true}',output_schema='{"custom":true}' WHERE slug='zion';
SELECT pg_temp.capture_zion_plan_protected();
\ir ../migrations/20271113800005_exp05_zion_planning_instructions.sql
SELECT pg_temp.check_zion_plan_protected('custom input and output contracts preserved');
SELECT pg_temp.check_zion_plan(NOT EXISTS(SELECT 1 FROM public.paige_subagents s FULL JOIN zion_plan_other o USING(slug) WHERE coalesce(s.slug,o.slug)<>'zion' AND to_jsonb(s) IS DISTINCT FROM o.fields),'all other specialists and parents unchanged');
SELECT pg_temp.check_zion_plan((SELECT c.relacl IS NOT DISTINCT FROM a.relacl AND c.relrowsecurity=a.relrowsecurity AND c.relforcerowsecurity=a.relforcerowsecurity FROM pg_class c CROSS JOIN zion_plan_acl a WHERE c.oid='public.paige_subagents'::regclass),'table grants and RLS unchanged');
ROLLBACK;
