-- Isolated migrated CI database only. Every mutation below rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_zion(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'ZION_PROOF_FAILED: %',label; END IF;
RAISE NOTICE 'PASS: %',label; END $$;
SELECT pg_temp.check_zion((SELECT count(*)=1 FROM public.paige_subagents WHERE slug='zion' AND tenant_id IS NULL),'one existing global ZION');
SELECT pg_temp.check_zion((SELECT role='VP Operations & Automation' AND domain='operations_automation' FROM public.paige_subagents WHERE slug='zion'),'fresh migrated remit');
CREATE TEMP TABLE zion_protected AS SELECT to_jsonb(s)-ARRAY['domain','role','description','goal','backstory','version','updated_at'] AS fields FROM public.paige_subagents s WHERE slug='zion';
CREATE TEMP TABLE zion_other AS SELECT slug,to_jsonb(s) AS fields FROM public.paige_subagents s WHERE slug<>'zion';
CREATE TEMP TABLE zion_acl AS SELECT relacl,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.paige_subagents'::regclass;
CREATE FUNCTION pg_temp.restore_zion_seed() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.paige_subagents SET domain='strategy_vision',role='VP Strategy & Vision',version=1,
    description='VP Strategy & Vision. Revenue-stage awareness, business-twin scenario modeling, owner analytics with interpretation, strategic Playbook orchestration, long-term positioning. Elevated, directional.',
    goal='The tenant always knows what stage they are in and what the next right move is.',
    backstory='ZION holds the altitude: where the business is on the roadmap, what the numbers mean, and which play fires next. Strategy recommends; it never acts alone.',
    system_prompt=NULL,config='{}',runtime='soft'
  WHERE slug='zion';
END $$;
SELECT pg_temp.restore_zion_seed();
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT role='VP Operations & Automation' AND domain='operations_automation' AND version=2 FROM public.paige_subagents WHERE slug='zion'),'guarded existing seed corrected');
SELECT pg_temp.check_zion((SELECT (to_jsonb(s)-ARRAY['domain','role','description','goal','backstory','version','updated_at'])=p.fields FROM public.paige_subagents s CROSS JOIN zion_protected p WHERE s.slug='zion'),'identity permissions runtime caps and parent unchanged');
SELECT pg_temp.check_zion(NOT EXISTS(SELECT 1 FROM public.paige_subagents s FULL JOIN zion_other o USING(slug) WHERE coalesce(s.slug,o.slug)<>'zion' AND to_jsonb(s) IS DISTINCT FROM o.fields),'other specialists and parents unchanged');
SELECT pg_temp.check_zion((SELECT c.relacl IS NOT DISTINCT FROM a.relacl AND c.relrowsecurity=a.relrowsecurity AND c.relforcerowsecurity=a.relforcerowsecurity FROM pg_class c CROSS JOIN zion_acl a WHERE c.oid='public.paige_subagents'::regclass),'table grants and RLS unchanged');
CREATE TEMP TABLE zion_first AS SELECT to_jsonb(s) AS fields FROM public.paige_subagents s WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT to_jsonb(s)=f.fields FROM public.paige_subagents s CROSS JOIN zion_first f WHERE slug='zion'),'second replay exact no-op including version and timestamp');
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET description='Operator customized description' WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT role='VP Strategy & Vision' AND description='Operator customized description' AND version=1 FROM public.paige_subagents WHERE slug='zion'),'custom description preserved');
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET role='Operator customized role' WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT role='Operator customized role' AND version=1 FROM public.paige_subagents WHERE slug='zion'),'custom role preserved');
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET config='{"test_configuration":true}' WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT role='VP Strategy & Vision' AND config='{"test_configuration":true}'::jsonb AND version=1 FROM public.paige_subagents WHERE slug='zion'),'custom configuration preserved');
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET system_prompt='Operator customized prompt' WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT role='VP Strategy & Vision' AND system_prompt='Operator customized prompt' AND version=1 FROM public.paige_subagents WHERE slug='zion'),'custom prompt preserved');
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET runtime='local' WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT role='VP Strategy & Vision' AND runtime='local' AND version=1 FROM public.paige_subagents WHERE slug='zion'),'custom runtime preserved');
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET version=7 WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT role='VP Strategy & Vision' AND version=7 FROM public.paige_subagents WHERE slug='zion'),'later registry revision preserved');
SELECT pg_temp.restore_zion_seed();
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand)
VALUES('e5050000-0000-4000-8000-00000000aaaa','test-tenant-zion-scope','Test tenant ZION scope','active','standalone','TVR',9383991,'{}','{}');
UPDATE public.paige_subagents SET tenant_id='e5050000-0000-4000-8000-00000000aaaa' WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT role='VP Strategy & Vision' AND version=1 AND tenant_id='e5050000-0000-4000-8000-00000000aaaa' FROM public.paige_subagents WHERE slug='zion'),'tenant-owned identity never rewritten');
UPDATE public.paige_subagents SET tenant_id=NULL WHERE slug='zion';
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET goal='Owner custom goal' WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT goal='Owner custom goal' AND version=1 FROM public.paige_subagents WHERE slug='zion'),'custom goal preserved');
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET backstory='Owner custom backstory' WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT backstory='Owner custom backstory' AND version=1 FROM public.paige_subagents WHERE slug='zion'),'custom backstory preserved');
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET name='Owner custom name' WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT name='Owner custom name' AND version=1 FROM public.paige_subagents WHERE slug='zion'),'custom name preserved');
UPDATE public.paige_subagents SET name='ZION' WHERE slug='zion';
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET rail_display_name='Owner custom label' WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT rail_display_name='Owner custom label' AND version=1 FROM public.paige_subagents WHERE slug='zion'),'custom Rail label preserved');
UPDATE public.paige_subagents SET rail_display_name='ZION' WHERE slug='zion';
SELECT pg_temp.restore_zion_seed();
UPDATE public.paige_subagents SET enabled=false WHERE slug='zion';
\ir ../migrations/20271113080000_exp05_zion_operations_role.sql
SELECT pg_temp.check_zion((SELECT role='VP Operations & Automation' AND NOT enabled AND system_prompt IS NULL FROM public.paige_subagents WHERE slug='zion'),'metadata correction never enables dormant runtime');
ROLLBACK;
