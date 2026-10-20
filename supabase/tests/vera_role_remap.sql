-- Isolated migrated CI database only. Every mutation below rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_vera(v boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'VERA_PROOF_FAILED: %',label; END IF;
RAISE NOTICE 'PASS: %',label; END $$;
SELECT pg_temp.check_vera((SELECT count(*)=1 FROM public.paige_subagents WHERE slug='vera' AND tenant_id IS NULL),'one existing global VERA');
SELECT pg_temp.check_vera((SELECT role='VP Intelligence, Finance & Risk' AND domain='intelligence_finance_risk' FROM public.paige_subagents WHERE slug='vera'),'fresh migrated remit');
CREATE TEMP TABLE vera_protected AS SELECT to_jsonb(s)-ARRAY['domain','role','description','goal','backstory','version','updated_at'] AS fields FROM public.paige_subagents s WHERE slug='vera';
CREATE TEMP TABLE vera_other AS SELECT slug,to_jsonb(s) AS fields FROM public.paige_subagents s WHERE slug<>'vera';
CREATE TEMP TABLE vera_acl AS SELECT relacl,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.paige_subagents'::regclass;
CREATE FUNCTION pg_temp.restore_vera_seed() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.paige_subagents SET domain='trust_verification',role='VP Trust & Verification',version=1,
    description='VP Trust & Verification. All verifications: identity (KYC), consent, document extraction accuracy, integrity boundaries, regulatory (A2P/TCR), payment status, OTP/2FA, signature status. Precise by voice.',
    goal='Nothing ships unverified — every trust boundary is checked before work executes.',
    backstory='VERA runs the practice''s trust perimeter: identity, consent, documents, and integrity gates. Tenants meet her first at signup; her word is the difference between a claim and a fact.',
    system_prompt=NULL,config='{}',runtime='soft'
  WHERE slug='vera';
END $$;
SELECT pg_temp.restore_vera_seed();
\ir ../migrations/20271112120000_e2_vera_intelligence_role.sql
SELECT pg_temp.check_vera((SELECT role='VP Intelligence, Finance & Risk' AND domain='intelligence_finance_risk' AND version=2 FROM public.paige_subagents WHERE slug='vera'),'guarded existing seed corrected');
SELECT pg_temp.check_vera((SELECT (to_jsonb(s)-ARRAY['domain','role','description','goal','backstory','version','updated_at'])=p.fields FROM public.paige_subagents s CROSS JOIN vera_protected p WHERE s.slug='vera'),'identity permissions runtime caps and parent unchanged');
SELECT pg_temp.check_vera(NOT EXISTS(SELECT 1 FROM public.paige_subagents s FULL JOIN vera_other o USING(slug) WHERE coalesce(s.slug,o.slug)<>'vera' AND to_jsonb(s) IS DISTINCT FROM o.fields),'other specialists and parents unchanged');
SELECT pg_temp.check_vera((SELECT c.relacl IS NOT DISTINCT FROM a.relacl AND c.relrowsecurity=a.relrowsecurity AND c.relforcerowsecurity=a.relforcerowsecurity FROM pg_class c CROSS JOIN vera_acl a WHERE c.oid='public.paige_subagents'::regclass),'table grants and RLS unchanged');
CREATE TEMP TABLE vera_first AS SELECT to_jsonb(s) AS fields FROM public.paige_subagents s WHERE slug='vera';
\ir ../migrations/20271112120000_e2_vera_intelligence_role.sql
SELECT pg_temp.check_vera((SELECT to_jsonb(s)=f.fields FROM public.paige_subagents s CROSS JOIN vera_first f WHERE slug='vera'),'second replay exact no-op including version and timestamp');
SELECT pg_temp.restore_vera_seed();
UPDATE public.paige_subagents SET description='Operator customized description' WHERE slug='vera';
\ir ../migrations/20271112120000_e2_vera_intelligence_role.sql
SELECT pg_temp.check_vera((SELECT role='VP Trust & Verification' AND description='Operator customized description' AND version=1 FROM public.paige_subagents WHERE slug='vera'),'custom description preserved');
SELECT pg_temp.restore_vera_seed();
UPDATE public.paige_subagents SET role='Operator customized role' WHERE slug='vera';
\ir ../migrations/20271112120000_e2_vera_intelligence_role.sql
SELECT pg_temp.check_vera((SELECT role='Operator customized role' AND version=1 FROM public.paige_subagents WHERE slug='vera'),'custom role preserved');
SELECT pg_temp.restore_vera_seed();
UPDATE public.paige_subagents SET config='{"test_configuration":true}' WHERE slug='vera';
\ir ../migrations/20271112120000_e2_vera_intelligence_role.sql
SELECT pg_temp.check_vera((SELECT role='VP Trust & Verification' AND config='{"test_configuration":true}'::jsonb AND version=1 FROM public.paige_subagents WHERE slug='vera'),'custom configuration preserved');
SELECT pg_temp.restore_vera_seed();
UPDATE public.paige_subagents SET system_prompt='Operator customized prompt' WHERE slug='vera';
\ir ../migrations/20271112120000_e2_vera_intelligence_role.sql
SELECT pg_temp.check_vera((SELECT role='VP Trust & Verification' AND system_prompt='Operator customized prompt' AND version=1 FROM public.paige_subagents WHERE slug='vera'),'custom prompt preserved');
SELECT pg_temp.restore_vera_seed();
UPDATE public.paige_subagents SET runtime='local' WHERE slug='vera';
\ir ../migrations/20271112120000_e2_vera_intelligence_role.sql
SELECT pg_temp.check_vera((SELECT role='VP Trust & Verification' AND runtime='local' AND version=1 FROM public.paige_subagents WHERE slug='vera'),'custom runtime preserved');
SELECT pg_temp.restore_vera_seed();
UPDATE public.paige_subagents SET version=7 WHERE slug='vera';
\ir ../migrations/20271112120000_e2_vera_intelligence_role.sql
SELECT pg_temp.check_vera((SELECT role='VP Trust & Verification' AND version=7 FROM public.paige_subagents WHERE slug='vera'),'later registry revision preserved');
SELECT pg_temp.restore_vera_seed();
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand)
VALUES('e2020000-0000-4000-8000-00000000aaaa','test-tenant-vera-scope','Test tenant VERA scope','active','standalone','TVR',9383991,'{}','{}');
UPDATE public.paige_subagents SET tenant_id='e2020000-0000-4000-8000-00000000aaaa' WHERE slug='vera';
\ir ../migrations/20271112120000_e2_vera_intelligence_role.sql
SELECT pg_temp.check_vera((SELECT role='VP Trust & Verification' AND version=1 AND tenant_id='e2020000-0000-4000-8000-00000000aaaa' FROM public.paige_subagents WHERE slug='vera'),'tenant-owned identity never rewritten');
UPDATE public.paige_subagents SET tenant_id=NULL WHERE slug='vera';
SELECT pg_temp.restore_vera_seed();
UPDATE public.paige_subagents SET enabled=false WHERE slug='vera';
\ir ../migrations/20271112120000_e2_vera_intelligence_role.sql
SELECT pg_temp.check_vera((SELECT role='VP Intelligence, Finance & Risk' AND NOT enabled AND system_prompt IS NULL FROM public.paige_subagents WHERE slug='vera'),'metadata correction never enables dormant runtime');
ROLLBACK;
