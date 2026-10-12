-- INT-280 AI-3B: immutable synthetic regression evidence in existing Evals.
-- No runner, publication RPC, provider action, customer content or task identity is created.
-- migration-lint-ignore: pattern-1
-- The literal publication UUIDs identify Eval datasets/cases/runs/results created here,
-- never auth.users. All tenant/actor/created_by/trace identities are NULL. Independently
-- reviewed schema/proofs show no auth-user FK; other lint patterns remain enabled.
ALTER TABLE public.paige_eval_dataset ADD COLUMN IF NOT EXISTS regression_corpus_version integer;
ALTER TABLE public.paige_eval_case
  ADD COLUMN IF NOT EXISTS regression_key text,
  ADD COLUMN IF NOT EXISTS regression_version text,
  ADD COLUMN IF NOT EXISTS regression_manifest text,
  ADD COLUMN IF NOT EXISTS regression_case_hash text;
ALTER TABLE public.paige_eval_run ADD COLUMN IF NOT EXISTS regression_case_id uuid;
ALTER TABLE public.paige_eval_run DROP CONSTRAINT IF EXISTS paige_eval_run_regression_case_fk;
ALTER TABLE public.paige_eval_run ADD CONSTRAINT paige_eval_run_regression_case_fk
  FOREIGN KEY(regression_case_id) REFERENCES public.paige_eval_case(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS paige_eval_regression_case_version_idx
  ON public.paige_eval_case(regression_key,regression_version) WHERE regression_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS paige_eval_regression_history_idx
  ON public.paige_eval_run(regression_case_id,created_at DESC,id DESC) WHERE regression_case_id IS NOT NULL;
ALTER TABLE public.paige_eval_case DROP CONSTRAINT IF EXISTS paige_eval_case_regression_ck;
ALTER TABLE public.paige_eval_case ADD CONSTRAINT paige_eval_case_regression_ck CHECK (
  (regression_key IS NULL AND regression_version IS NULL AND regression_manifest IS NULL AND regression_case_hash IS NULL)
  OR ((regression_key IS NOT NULL AND regression_version IS NOT NULL AND regression_manifest IS NOT NULL
    AND regression_case_hash=encode(pg_catalog.sha256(convert_to(regression_manifest,'UTF8')),'hex')
    AND regression_manifest::jsonb->>'case_key'=regression_key AND regression_manifest::jsonb->>'version'=regression_version
    AND tenant_id IS NULL AND source_trace_id IS NULL AND metadata='{}'::jsonb AND rubric IS NULL) IS TRUE));
-- Preserve both legacy and AI-2 task branches; the third branch is explicitly offline/unlinked.
ALTER TABLE public.paige_eval_run DROP CONSTRAINT IF EXISTS paige_eval_run_task_evidence_ck;
ALTER TABLE public.paige_eval_run ADD CONSTRAINT paige_eval_run_task_evidence_ck CHECK (
  (regression_case_id IS NULL AND task_subject_ref IS NULL AND evaluator_set_id IS NULL AND evaluator_set_version IS NULL AND evaluator_set_hash IS NULL
    AND evidence_snapshot IS NULL AND evidence_hash IS NULL AND source_observed_at IS NULL AND observation_kind IS NULL)
  OR (regression_case_id IS NULL AND evaluator_set_id IS NOT NULL AND evaluator_set_version IS NOT NULL AND evaluator_set_hash IS NOT NULL
    AND tenant_id IS NULL AND work_id IS NULL AND task_subject_ref IS NOT NULL AND evidence_snapshot IS NOT NULL AND source_observed_at IS NOT NULL
    AND (evidence_snapshot->>'id'=task_subject_ref::text) IS TRUE
    AND observation_kind IS NOT NULL AND observation_kind IN('observation','replay') AND evidence_hash IS NOT NULL
    AND evidence_hash=encode(pg_catalog.sha256(convert_to(evidence_snapshot::text,'UTF8')),'hex'))
  OR ((regression_case_id IS NOT NULL AND tenant_id IS NULL AND work_id IS NULL AND task_subject_ref IS NULL
    AND evaluator_set_id='offline-write-integrity' AND evaluator_set_version='1.0.0'
    AND evaluator_set_hash='9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496'
    AND observation_kind='offline_reproduction' AND evidence_snapshot IS NOT NULL AND source_observed_at IS NOT NULL
    AND evidence_hash=encode(pg_catalog.sha256(convert_to(evidence_snapshot::text,'UTF8')),'hex')) IS TRUE));

CREATE OR REPLACE FUNCTION public._guard_paige_regression_corpus()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE protected boolean:=false; owner_name name; c public.paige_eval_case; r public.paige_eval_run;
  s jsonb; actual_keys text[];
BEGIN
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'regression_corpus_bulk_erasure_refused' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='paige_eval_dataset' THEN
    IF TG_OP<>'INSERT' THEN protected:=OLD.regression_corpus_version IS NOT NULL; END IF;
    IF TG_OP<>'DELETE' THEN protected:=protected OR NEW.regression_corpus_version IS NOT NULL; END IF;
  ELSIF TG_TABLE_NAME='paige_eval_case' THEN
    IF TG_OP<>'INSERT' THEN protected:=OLD.regression_manifest IS NOT NULL OR OLD.regression_key IS NOT NULL
      OR OLD.regression_version IS NOT NULL OR OLD.regression_case_hash IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.paige_eval_dataset WHERE id=OLD.dataset_id AND regression_corpus_version IS NOT NULL); END IF;
    IF TG_OP<>'DELETE' THEN protected:=protected OR NEW.regression_manifest IS NOT NULL OR NEW.regression_key IS NOT NULL
      OR NEW.regression_version IS NOT NULL OR NEW.regression_case_hash IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.paige_eval_dataset WHERE id=NEW.dataset_id AND regression_corpus_version IS NOT NULL); END IF;
  ELSIF TG_TABLE_NAME='paige_eval_run' THEN
    IF TG_OP<>'INSERT' THEN protected:=OLD.regression_case_id IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.paige_eval_dataset WHERE id=OLD.dataset_id AND regression_corpus_version IS NOT NULL); END IF;
    IF TG_OP<>'DELETE' THEN protected:=protected OR NEW.regression_case_id IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.paige_eval_dataset WHERE id=NEW.dataset_id AND regression_corpus_version IS NOT NULL); END IF;
  ELSE
    IF TG_OP<>'INSERT' THEN protected:=EXISTS(SELECT 1 FROM public.paige_eval_run WHERE id=OLD.run_id AND regression_case_id IS NOT NULL)
      OR EXISTS(SELECT 1 FROM public.paige_eval_case WHERE id=OLD.case_id AND regression_manifest IS NOT NULL); END IF;
    IF TG_OP<>'DELETE' THEN protected:=protected OR EXISTS(SELECT 1 FROM public.paige_eval_run WHERE id=NEW.run_id AND regression_case_id IS NOT NULL)
      OR EXISTS(SELECT 1 FROM public.paige_eval_case WHERE id=NEW.case_id AND regression_manifest IS NOT NULL); END IF;
  END IF;
  IF NOT protected THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'regression_corpus_immutable' USING ERRCODE='55000'; END IF;
  SELECT pg_catalog.pg_get_userbyid(proowner) INTO owner_name FROM pg_catalog.pg_proc
    WHERE oid='public.operator_intelligence_evaluate_task(uuid,text,uuid,uuid)'::regprocedure;
  IF current_user IS DISTINCT FROM owner_name THEN RAISE EXCEPTION 'regression_publication_reviewed_migration_only' USING ERRCODE='42501'; END IF;
  -- Bounded first publication. Future cases/versions require their own reviewed migration.
  IF TG_TABLE_NAME='paige_eval_dataset' THEN
    IF (NEW.regression_corpus_version=1 AND NEW.tenant_id IS NULL AND NEW.created_by IS NULL AND NEW.status='archived'
      AND NEW.target_kind='job_kind' AND NEW.target_ref='int280-regression-corpus'
      AND NEW.name='INT-280 offline regression corpus' AND NEW.description='Reviewed synthetic reproductions; no live execution.') IS NOT TRUE THEN
      RAISE EXCEPTION 'invalid_regression_dataset' USING ERRCODE='22023'; END IF;
  ELSIF TG_TABLE_NAME='paige_eval_case' THEN
    IF (NEW.regression_key='credit-sync-audit-reference' AND NEW.regression_version='1.0.0'
      AND NEW.regression_case_hash='b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606'
      AND NEW.regression_case_hash=encode(pg_catalog.sha256(convert_to(NEW.regression_manifest,'UTF8')),'hex')
      AND NEW.tenant_id IS NULL AND NEW.source_trace_id IS NULL AND NEW.metadata='{}'::jsonb AND NEW.rubric IS NULL
      AND NEW.expected='{"audit_recorded":true,"disputes_auto_created":0,"http_status":200}'::jsonb
      AND NEW.input=jsonb_build_object('fixture_ref','scripts/int280-regression/fixtures/credit-sync-audit-reference.v1.json',
        'fixture_hash','ac1f5cdd4dee885af6a982e5412931ac8c48a548f69b4cc17211dd3b96c304aa')
      AND EXISTS(SELECT 1 FROM public.paige_eval_dataset WHERE id=NEW.dataset_id AND regression_corpus_version=1)) IS NOT TRUE THEN
      RAISE EXCEPTION 'invalid_reviewed_regression_case' USING ERRCODE='22023'; END IF;
  ELSIF TG_TABLE_NAME='paige_eval_run' THEN
    SELECT * INTO c FROM public.paige_eval_case WHERE id=NEW.regression_case_id;
    s:=NEW.evidence_snapshot;
    IF jsonb_typeof(s) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'regression_snapshot_required' USING ERRCODE='22023'; END IF;
    SELECT array_agg(k ORDER BY k) INTO actual_keys FROM jsonb_object_keys(s) k;
    IF NOT actual_keys <@ ARRAY['case_key','version','case_hash','fixture_hash','evaluator_hash','source_hash','baseline_source_hash',
      'mode','proof_class','evidence_state','applicability','recorded_at','verdict','score','passed','status','output',
      'representative_score_write_observed','followups_stubbed','production_task_identity','authenticated_acceptance','provider_calls']::text[] THEN
      RAISE EXCEPTION 'regression_metadata_allowlist' USING ERRCODE='22023'; END IF;
    IF (c.regression_case_hash IS NOT NULL AND NEW.dataset_id=c.dataset_id AND NEW.tenant_id IS NULL AND NEW.created_by IS NULL
      AND NEW.target_kind='job_kind' AND NEW.target_ref='credit-sync-audit-reference' AND NEW.target_version='1.0.0'
      AND NEW.work_id IS NULL AND NEW.task_subject_ref IS NULL AND NEW.source_observed_at=(s->>'recorded_at')::timestamptz
      AND NEW.created_at=NEW.source_observed_at AND NEW.completed_at=NEW.source_observed_at
      AND NEW.status='complete' AND NEW.scorer_set=ARRAY['exact_match']::text[] AND NEW.case_count=1
      AND NEW.cost_estimate_usd IS NULL AND NEW.prev_run_id IS NULL
      AND s->>'case_key'=c.regression_key AND s->>'version'=c.regression_version AND s->>'case_hash'=c.regression_case_hash
      AND s->>'fixture_hash'='ac1f5cdd4dee885af6a982e5412931ac8c48a548f69b4cc17211dd3b96c304aa'
      AND s->>'evaluator_hash'='9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496'
      AND s->>'source_hash' ~ '^[0-9a-f]{64}$' AND s->>'baseline_source_hash' ~ '^[0-9a-f]{64}$'
      AND ((s->>'mode'='historical' AND s->>'source_hash'=c.regression_manifest::jsonb->'source'->>'faulty_source_hash' AND s->>'baseline_source_hash'=s->>'source_hash')
        OR (s->>'mode'='current' AND s->>'source_hash'=c.regression_manifest::jsonb->'source'->>'fixed_source_hash' AND s->>'baseline_source_hash'=s->>'source_hash')
        OR (s->>'mode'='reintroduced' AND s->>'source_hash'='20e46eb3691853901054993a873936c869b31d349988f9e8108b776e1d7ae7db'
          AND s->>'baseline_source_hash'=c.regression_manifest::jsonb->'source'->>'fixed_source_hash'))
      AND s->>'mode' IN('historical','current','reintroduced') AND s->>'proof_class'='controlled_offline_real_handler'
      AND s->>'production_task_identity'='unlinked' AND s->>'authenticated_acceptance'='UNVERIFIED' AND s->'provider_calls'='0'::jsonb
      AND s->>'evidence_state' IN('complete','missing','stale','partial','conflicting','unrelated','unavailable')
      AND s->>'applicability' IN('applicable','not_applicable','unknown')
      AND s->>'verdict' IN('pass','fail','indeterminate','not_applicable')
      AND jsonb_typeof(s->'output')='object'
      AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(s->'output') k WHERE k NOT IN('http_status','audit_recorded','disputes_auto_created'))
      AND s->'output' ?& ARRAY['http_status','audit_recorded','disputes_auto_created']
      AND jsonb_typeof(s->'output'->'http_status')='number'
      AND (s->'output'->>'http_status')::integer BETWEEN 100 AND 599
      AND jsonb_typeof(s->'output'->'audit_recorded')='boolean'
      AND (s->'output'->'disputes_auto_created'='null'::jsonb OR (jsonb_typeof(s->'output'->'disputes_auto_created')='number' AND (s->'output'->>'disputes_auto_created')::integer BETWEEN 0 AND 1000000))
      AND jsonb_typeof(s->'representative_score_write_observed')='boolean'
      AND (s->>'followups_stubbed')::integer BETWEEN 0 AND 2) IS NOT TRUE THEN
      RAISE EXCEPTION 'invalid_regression_snapshot' USING ERRCODE='22023'; END IF;
    -- Consistency validation of an existing scorer result, never a second scoring engine.
    IF ((s->>'verdict' IN('pass','fail') AND s->>'evidence_state'='complete' AND s->>'applicability'='applicable'
      AND s->'representative_score_write_observed'='true'::jsonb AND s->>'status'='scored'
      AND ((s->>'verdict'='pass' AND s->'score'='1'::jsonb AND s->'passed'='true'::jsonb AND s->'output'=c.expected)
        OR (s->>'verdict'='fail' AND s->'score'='0'::jsonb AND s->'passed'='false'::jsonb AND s->'output'<>c.expected))
      AND NEW.scored_count=1 AND NEW.degraded_count=0 AND NEW.aggregate_score=(s->>'score')::numeric AND NEW.pass_rate=(s->>'score')::numeric)
      OR (s->>'verdict' IN('indeterminate','not_applicable') AND s->'score'='null'::jsonb AND s->'passed'='null'::jsonb
        AND (s->>'verdict'='indeterminate' OR (s->>'applicability'='not_applicable' AND s->>'evidence_state'='complete'))
        AND s->>'status'='needs_config' AND NEW.scored_count=0 AND NEW.degraded_count=1 AND NEW.aggregate_score IS NULL AND NEW.pass_rate IS NULL)) IS NOT TRUE THEN
      RAISE EXCEPTION 'regression_verdict_evidence_mismatch' USING ERRCODE='22023'; END IF;
  ELSE
    SELECT * INTO r FROM public.paige_eval_run WHERE id=NEW.run_id;
    s:=r.evidence_snapshot;
    IF (r.regression_case_id IS NOT NULL AND NEW.case_id=r.regression_case_id AND NEW.tenant_id IS NULL
      AND NEW.source_trace_id IS NULL AND NEW.scorer='exact_match' AND NEW.scorer_kind='deterministic'
      AND NEW.evaluator_version='1.0.0' AND NEW.task_verdict=s->>'verdict' AND NEW.evidence_state=s->>'evidence_state'
      AND NEW.score IS NOT DISTINCT FROM (s->>'score')::numeric AND NEW.passed IS NOT DISTINCT FROM (s->>'passed')::boolean
      AND NEW.status=s->>'status' AND NEW.judge_model IS NULL AND NEW.cost_estimate_usd IS NULL AND NEW.rationale IS NULL
      AND NEW.created_at=r.source_observed_at AND NOT EXISTS(SELECT 1 FROM public.paige_eval_result WHERE run_id=r.id AND id<>NEW.id)) IS NOT TRUE THEN
      RAISE EXCEPTION 'invalid_regression_result' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._guard_paige_regression_corpus() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['paige_eval_dataset','paige_eval_case','paige_eval_run','paige_eval_result'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_regression_corpus_immutable ON public.%I',t);
    EXECUTE format('CREATE TRIGGER trg_regression_corpus_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._guard_paige_regression_corpus()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['paige_eval_dataset','paige_eval_case'] LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_regression_corpus_bulk_erasure ON public.%I',t);
    EXECUTE format('CREATE TRIGGER trg_regression_corpus_bulk_erasure BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public._guard_paige_regression_corpus()',t);
  END LOOP;
END $$;

-- Reader projection is restricted to frozen synthetic metadata; it never reads tenant inputs.
CREATE OR REPLACE FUNCTION public.operator_intelligence_regression_corpus(
  p_limit integer DEFAULT 25,p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_case_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE lim integer:=greatest(1,least(COALESCE(p_limit,25),25)); observed timestamptz:=clock_timestamp();
  items jsonb:='[]'; cursor jsonb:=NULL; c public.paige_eval_case; n integer:=0; history jsonb; latest jsonb; hist_limited boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL OR public.is_platform_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'operator_required' USING ERRCODE='42501'; END IF;
  IF (p_before_at IS NULL)<>(p_before_id IS NULL) OR (p_case_id IS NOT NULL AND p_before_id IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_regression_selection' USING ERRCODE='22023'; END IF;
  IF p_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.paige_eval_case WHERE id=p_case_id AND regression_manifest IS NOT NULL) THEN
    RAISE EXCEPTION 'regression_case_unavailable' USING ERRCODE='22023'; END IF;
  INSERT INTO public.paige_audit_log(tenant_id,actor_user_id,actor_role,action,target_type,payload)
    VALUES(NULL,auth.uid(),'operator','god_view.fleet_query','intelligence_regression_corpus',jsonb_build_object('limit',lim,'case_selected',p_case_id IS NOT NULL,'observed_at',observed));
  FOR c IN SELECT e.* FROM public.paige_eval_case e JOIN public.paige_eval_dataset d ON d.id=e.dataset_id
    WHERE e.regression_manifest IS NOT NULL AND d.regression_corpus_version=1 AND e.tenant_id IS NULL AND d.tenant_id IS NULL
      AND (p_case_id IS NULL OR e.id=p_case_id) AND (p_before_at IS NULL OR (e.created_at,e.id)<(p_before_at,p_before_id))
    ORDER BY e.created_at DESC,e.id DESC LIMIT lim+1 LOOP
    n:=n+1;
    IF n>lim THEN EXIT; END IF;
    IF c.regression_case_hash IS DISTINCT FROM 'b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606'
      OR c.regression_case_hash IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(c.regression_manifest,'UTF8')),'hex') THEN
      RAISE EXCEPTION 'regression_definition_integrity' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM (SELECT * FROM public.paige_eval_run WHERE regression_case_id=c.id ORDER BY created_at DESC,id DESC LIMIT 25) r WHERE (
      r.tenant_id IS NOT NULL OR r.task_subject_ref IS NOT NULL OR r.work_id IS NOT NULL OR r.dataset_id IS DISTINCT FROM c.dataset_id
      OR r.evaluator_set_hash IS DISTINCT FROM c.regression_manifest::jsonb->'evaluator'->>'definition_hash'
      OR r.evidence_snapshot->>'case_hash' IS DISTINCT FROM c.regression_case_hash
      OR r.evidence_hash IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(r.evidence_snapshot::text,'UTF8')),'hex'))) THEN
      RAISE EXCEPTION 'regression_history_integrity' USING ERRCODE='55000'; END IF;
    SELECT count(*)>25 INTO hist_limited FROM (SELECT 1 FROM public.paige_eval_run WHERE regression_case_id=c.id LIMIT 26) h;
    SELECT COALESCE(jsonb_agg(h.item ORDER BY h.created_at,h.id),'[]') INTO history FROM (
      SELECT r.created_at,r.id,jsonb_build_object('run_ref',r.id,'result_ref',z.id,'mode',r.evidence_snapshot->>'mode',
        'recorded_at',r.source_observed_at,'source_hash',r.evidence_snapshot->>'source_hash','baseline_source_hash',r.evidence_snapshot->>'baseline_source_hash',
        'evidence_hash',r.evidence_hash,'hash_encoding','sha256_postgresql_jsonb_text_utf8','evaluator',jsonb_build_object('id',r.evaluator_set_id,'version',r.evaluator_set_version,'hash',r.evaluator_set_hash),
        'verdict',COALESCE(z.task_verdict,'indeterminate'),'evidence_state',COALESCE(z.evidence_state,'missing'),
        'output',r.evidence_snapshot->'output','proof_class','controlled_offline_real_handler','applicability',r.evidence_snapshot->>'applicability') item
      FROM public.paige_eval_run r LEFT JOIN public.paige_eval_result z ON z.run_id=r.id AND z.case_id=c.id
      WHERE r.regression_case_id=c.id AND r.tenant_id IS NULL AND r.task_subject_ref IS NULL AND r.observation_kind='offline_reproduction'
      ORDER BY r.created_at DESC,r.id DESC LIMIT 25) h;
    SELECT h INTO latest FROM jsonb_array_elements(history) h WHERE h->>'mode'='current' ORDER BY h->>'recorded_at' DESC LIMIT 1;
    items:=items||jsonb_build_array(jsonb_build_object('case_ref',c.id,'case_hash',c.regression_case_hash,'definition',c.regression_manifest::jsonb,
      'published_at',c.created_at,'history',history,'history_limit_reached',hist_limited,'latest_corrected_result',latest,
      'latest_corrected_result_scope','returned_history_at_reproduction',
      'authenticated_acceptance','UNVERIFIED','historical_customer_effect','UNKNOWN','source_basis','offline_reproduction_not_production_execution'));
    cursor:=jsonb_build_object('before_at',c.created_at,'before_id',c.id);
  END LOOP;
  IF n<=lim THEN cursor:=NULL; END IF;
  RETURN jsonb_build_object('contract_version',1,'observed_at',observed,'limit',lim,'items',items,'next_cursor',cursor,
    'collection','reviewed_platform_synthetic','publication','reviewed_migration_only','execution','offline_ci_only');
END $$;
REVOKE ALL ON FUNCTION public.operator_intelligence_regression_corpus(integer,timestamptz,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_intelligence_regression_corpus(integer,timestamptz,uuid,uuid) TO authenticated;

-- Reviewed publication only: actual offline reproductions, not historical production executions.
INSERT INTO public.paige_eval_evaluator_set(id,version,definition_hash,manifest) VALUES('offline-write-integrity','1.0.0','9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496','{"authority":"observe_only","contract_version":1,"evaluators":[{"criterion":"Canonical serialized non-sensitive actual handler facts match the frozen expected facts.","id":"exact_match","indeterminate":"Missing, skipped, stale, hash-mismatched or unsupported input cannot pass.","kind":"deterministic","not_applicable":"A proven exclusion remains visible and cannot satisfy a required regression gate.","required_evidence":["reviewed_case_hash","synthetic_fixture_hash","actual_invoked_source_hash","complete_output_facts","applicability"],"version":"1.0.0"}],"id":"offline-write-integrity","source":"supabase/functions/_shared/eval/scorers.ts#DETERMINISTIC_SCORERS.exact_match","source_hash":"56413d8f696efa48e0b5641d3f71e0decd7eb23bb2728449cec15753efb7b0a9","version":"1.0.0"}') ON CONFLICT(id,version) DO NOTHING;
INSERT INTO public.paige_eval_dataset(id,name,description,target_kind,target_ref,status,regression_corpus_version) VALUES('60000000-0000-4000-8000-000000000001','INT-280 offline regression corpus','Reviewed synthetic reproductions; no live execution.','job_kind','int280-regression-corpus','archived',1) ON CONFLICT(id) DO NOTHING;
INSERT INTO public.paige_eval_case(id,dataset_id,input,expected,regression_key,regression_version,regression_manifest,regression_case_hash) VALUES('60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','{"fixture_ref":"scripts/int280-regression/fixtures/credit-sync-audit-reference.v1.json","fixture_hash":"ac1f5cdd4dee885af6a982e5412931ac8c48a548f69b4cc17211dd3b96c304aa"}'::jsonb,'{"audit_recorded":true,"disputes_auto_created":0,"http_status":200}'::jsonb,'credit-sync-audit-reference','1.0.0','{"authority":"observe_only","case_key":"credit-sync-audit-reference","category":"write_integrity","contract_version":1,"evaluator":{"definition_hash":"9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496","id":"exact_match","set_id":"offline-write-integrity","set_version":"1.0.0","version":"1.0.0"},"expected":{"audit_recorded":true,"disputes_auto_created":0,"http_status":200},"fixture":{"hash":"ac1f5cdd4dee885af6a982e5412931ac8c48a548f69b4cc17211dd3b96c304aa","kind":"synthetic_offline","path":"scripts/int280-regression/fixtures/credit-sync-audit-reference.v1.json"},"runner":"scripts/int280-regression/credit-sync.mjs","scope":"platform_synthetic","source":{"faulty_commit":"6c76675dc57d1595ff9160e736a0d3723ac8010e","faulty_source_hash":"2d122eb9966c944aefc4ed790000e6ff43f78adc922c2ceab70c27c583a2adb3","fix_pr":1917,"fixed_commit":"e648864ad9ae277ab24b5f4eb49dd14027aeafea","fixed_source_hash":"30bef5518c9c3ae99628f3b8d544ce79cf9e8259e4e7ac928cf4ca3bb0dba45d","issue":734,"merge_commit":"9512e649ba347bf6335540d38f8bb9d9b0ef0661","repository":"Paige-Agent-AI/Paige-Agent-AI","review_comment":6101464003,"source_path":"supabase/functions/sync-credit-report-data/index.ts"},"trajectory":{"reason":"historical_identity_unavailable","state":"unlinked"},"version":"1.0.0"}','b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606') ON CONFLICT(id) DO NOTHING;
WITH s AS (SELECT '{"case_key":"credit-sync-audit-reference","version":"1.0.0","case_hash":"b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606","fixture_hash":"ac1f5cdd4dee885af6a982e5412931ac8c48a548f69b4cc17211dd3b96c304aa","evaluator_hash":"9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496","source_hash":"2d122eb9966c944aefc4ed790000e6ff43f78adc922c2ceab70c27c583a2adb3","baseline_source_hash":"2d122eb9966c944aefc4ed790000e6ff43f78adc922c2ceab70c27c583a2adb3","mode":"historical","proof_class":"controlled_offline_real_handler","evidence_state":"complete","applicability":"applicable","recorded_at":"2026-10-11T05:57:31.578Z","verdict":"fail","score":0,"passed":false,"status":"scored","output":{"http_status":500,"audit_recorded":false,"disputes_auto_created":null},"representative_score_write_observed":true,"followups_stubbed":0,"production_task_identity":"unlinked","authenticated_acceptance":"UNVERIFIED","provider_calls":0}'::jsonb AS p)
INSERT INTO public.paige_eval_run(id,dataset_id,target_kind,target_ref,target_version,status,scorer_set,case_count,scored_count,degraded_count,aggregate_score,pass_rate,created_at,completed_at,regression_case_id,evaluator_set_id,evaluator_set_version,evaluator_set_hash,evidence_snapshot,evidence_hash,source_observed_at,observation_kind)
SELECT '60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000001','job_kind','credit-sync-audit-reference','1.0.0','complete',ARRAY['exact_match'],1,1,0,0,0,'2026-10-11T05:57:31.578Z'::timestamptz,'2026-10-11T05:57:31.578Z'::timestamptz,'60000000-0000-4000-8000-000000000002','offline-write-integrity','1.0.0','9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496',p,encode(pg_catalog.sha256(convert_to(p::text,'UTF8')),'hex'),'2026-10-11T05:57:31.578Z'::timestamptz,'offline_reproduction' FROM s ON CONFLICT(id) DO NOTHING;
INSERT INTO public.paige_eval_result(id,run_id,case_id,scorer,scorer_kind,score,passed,status,created_at,task_verdict,evaluator_version,evidence_state) VALUES('60000000-0000-4000-8000-000000000020','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000002','exact_match','deterministic',0,false,'scored','2026-10-11T05:57:31.578Z'::timestamptz,'fail','1.0.0','complete') ON CONFLICT(id) DO NOTHING;
WITH s AS (SELECT '{"case_key":"credit-sync-audit-reference","version":"1.0.0","case_hash":"b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606","fixture_hash":"ac1f5cdd4dee885af6a982e5412931ac8c48a548f69b4cc17211dd3b96c304aa","evaluator_hash":"9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496","source_hash":"30bef5518c9c3ae99628f3b8d544ce79cf9e8259e4e7ac928cf4ca3bb0dba45d","baseline_source_hash":"30bef5518c9c3ae99628f3b8d544ce79cf9e8259e4e7ac928cf4ca3bb0dba45d","mode":"current","proof_class":"controlled_offline_real_handler","evidence_state":"complete","applicability":"applicable","recorded_at":"2026-10-11T05:57:32.213Z","verdict":"pass","score":1,"passed":true,"status":"scored","output":{"http_status":200,"audit_recorded":true,"disputes_auto_created":0},"representative_score_write_observed":true,"followups_stubbed":2,"production_task_identity":"unlinked","authenticated_acceptance":"UNVERIFIED","provider_calls":0}'::jsonb AS p)
INSERT INTO public.paige_eval_run(id,dataset_id,target_kind,target_ref,target_version,status,scorer_set,case_count,scored_count,degraded_count,aggregate_score,pass_rate,created_at,completed_at,regression_case_id,evaluator_set_id,evaluator_set_version,evaluator_set_hash,evidence_snapshot,evidence_hash,source_observed_at,observation_kind)
SELECT '60000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000001','job_kind','credit-sync-audit-reference','1.0.0','complete',ARRAY['exact_match'],1,1,0,1,1,'2026-10-11T05:57:32.213Z'::timestamptz,'2026-10-11T05:57:32.213Z'::timestamptz,'60000000-0000-4000-8000-000000000002','offline-write-integrity','1.0.0','9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496',p,encode(pg_catalog.sha256(convert_to(p::text,'UTF8')),'hex'),'2026-10-11T05:57:32.213Z'::timestamptz,'offline_reproduction' FROM s ON CONFLICT(id) DO NOTHING;
INSERT INTO public.paige_eval_result(id,run_id,case_id,scorer,scorer_kind,score,passed,status,created_at,task_verdict,evaluator_version,evidence_state) VALUES('60000000-0000-4000-8000-000000000021','60000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000002','exact_match','deterministic',1,true,'scored','2026-10-11T05:57:32.213Z'::timestamptz,'pass','1.0.0','complete') ON CONFLICT(id) DO NOTHING;
WITH s AS (SELECT '{"case_key":"credit-sync-audit-reference","version":"1.0.0","case_hash":"b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606","fixture_hash":"ac1f5cdd4dee885af6a982e5412931ac8c48a548f69b4cc17211dd3b96c304aa","evaluator_hash":"9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496","source_hash":"20e46eb3691853901054993a873936c869b31d349988f9e8108b776e1d7ae7db","baseline_source_hash":"30bef5518c9c3ae99628f3b8d544ce79cf9e8259e4e7ac928cf4ca3bb0dba45d","mode":"reintroduced","proof_class":"controlled_offline_real_handler","evidence_state":"complete","applicability":"applicable","recorded_at":"2026-10-11T05:57:32.953Z","verdict":"fail","score":0,"passed":false,"status":"scored","output":{"http_status":500,"audit_recorded":false,"disputes_auto_created":null},"representative_score_write_observed":true,"followups_stubbed":0,"production_task_identity":"unlinked","authenticated_acceptance":"UNVERIFIED","provider_calls":0}'::jsonb AS p)
INSERT INTO public.paige_eval_run(id,dataset_id,target_kind,target_ref,target_version,status,scorer_set,case_count,scored_count,degraded_count,aggregate_score,pass_rate,created_at,completed_at,regression_case_id,evaluator_set_id,evaluator_set_version,evaluator_set_hash,evidence_snapshot,evidence_hash,source_observed_at,observation_kind)
SELECT '60000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000001','job_kind','credit-sync-audit-reference','1.0.0','complete',ARRAY['exact_match'],1,1,0,0,0,'2026-10-11T05:57:32.953Z'::timestamptz,'2026-10-11T05:57:32.953Z'::timestamptz,'60000000-0000-4000-8000-000000000002','offline-write-integrity','1.0.0','9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496',p,encode(pg_catalog.sha256(convert_to(p::text,'UTF8')),'hex'),'2026-10-11T05:57:32.953Z'::timestamptz,'offline_reproduction' FROM s ON CONFLICT(id) DO NOTHING;
INSERT INTO public.paige_eval_result(id,run_id,case_id,scorer,scorer_kind,score,passed,status,created_at,task_verdict,evaluator_version,evidence_state) VALUES('60000000-0000-4000-8000-000000000022','60000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000002','exact_match','deterministic',0,false,'scored','2026-10-11T05:57:32.953Z'::timestamptz,'fail','1.0.0','complete') ON CONFLICT(id) DO NOTHING;

-- Idempotent publication cannot hide an existing incompatible row behind ON CONFLICT.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.paige_eval_run r JOIN public.paige_eval_result z ON z.run_id=r.id AND z.id='60000000-0000-4000-8000-000000000020' WHERE r.id='60000000-0000-4000-8000-000000000010' AND r.regression_case_id='60000000-0000-4000-8000-000000000002' AND r.evidence_snapshot='{"case_key":"credit-sync-audit-reference","version":"1.0.0","case_hash":"b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606","fixture_hash":"ac1f5cdd4dee885af6a982e5412931ac8c48a548f69b4cc17211dd3b96c304aa","evaluator_hash":"9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496","source_hash":"2d122eb9966c944aefc4ed790000e6ff43f78adc922c2ceab70c27c583a2adb3","baseline_source_hash":"2d122eb9966c944aefc4ed790000e6ff43f78adc922c2ceab70c27c583a2adb3","mode":"historical","proof_class":"controlled_offline_real_handler","evidence_state":"complete","applicability":"applicable","recorded_at":"2026-10-11T05:57:31.578Z","verdict":"fail","score":0,"passed":false,"status":"scored","output":{"http_status":500,"audit_recorded":false,"disputes_auto_created":null},"representative_score_write_observed":true,"followups_stubbed":0,"production_task_identity":"unlinked","authenticated_acceptance":"UNVERIFIED","provider_calls":0}'::jsonb AND z.case_id=r.regression_case_id AND z.task_verdict='fail' AND z.evidence_state='complete' AND z.scorer='exact_match' AND z.evaluator_version='1.0.0' AND z.score=0 AND z.passed=false) THEN RAISE EXCEPTION 'reviewed_regression_publication_collision' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paige_eval_run r JOIN public.paige_eval_result z ON z.run_id=r.id AND z.id='60000000-0000-4000-8000-000000000021' WHERE r.id='60000000-0000-4000-8000-000000000011' AND r.regression_case_id='60000000-0000-4000-8000-000000000002' AND r.evidence_snapshot='{"case_key":"credit-sync-audit-reference","version":"1.0.0","case_hash":"b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606","fixture_hash":"ac1f5cdd4dee885af6a982e5412931ac8c48a548f69b4cc17211dd3b96c304aa","evaluator_hash":"9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496","source_hash":"30bef5518c9c3ae99628f3b8d544ce79cf9e8259e4e7ac928cf4ca3bb0dba45d","baseline_source_hash":"30bef5518c9c3ae99628f3b8d544ce79cf9e8259e4e7ac928cf4ca3bb0dba45d","mode":"current","proof_class":"controlled_offline_real_handler","evidence_state":"complete","applicability":"applicable","recorded_at":"2026-10-11T05:57:32.213Z","verdict":"pass","score":1,"passed":true,"status":"scored","output":{"http_status":200,"audit_recorded":true,"disputes_auto_created":0},"representative_score_write_observed":true,"followups_stubbed":2,"production_task_identity":"unlinked","authenticated_acceptance":"UNVERIFIED","provider_calls":0}'::jsonb AND z.case_id=r.regression_case_id AND z.task_verdict='pass' AND z.evidence_state='complete' AND z.scorer='exact_match' AND z.evaluator_version='1.0.0' AND z.score=1 AND z.passed=true) THEN RAISE EXCEPTION 'reviewed_regression_publication_collision' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paige_eval_run r JOIN public.paige_eval_result z ON z.run_id=r.id AND z.id='60000000-0000-4000-8000-000000000022' WHERE r.id='60000000-0000-4000-8000-000000000012' AND r.regression_case_id='60000000-0000-4000-8000-000000000002' AND r.evidence_snapshot='{"case_key":"credit-sync-audit-reference","version":"1.0.0","case_hash":"b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606","fixture_hash":"ac1f5cdd4dee885af6a982e5412931ac8c48a548f69b4cc17211dd3b96c304aa","evaluator_hash":"9752339ed600dbb73f80702970fce68e4fc0f78c63ae454652f4ca31d4e25496","source_hash":"20e46eb3691853901054993a873936c869b31d349988f9e8108b776e1d7ae7db","baseline_source_hash":"30bef5518c9c3ae99628f3b8d544ce79cf9e8259e4e7ac928cf4ca3bb0dba45d","mode":"reintroduced","proof_class":"controlled_offline_real_handler","evidence_state":"complete","applicability":"applicable","recorded_at":"2026-10-11T05:57:32.953Z","verdict":"fail","score":0,"passed":false,"status":"scored","output":{"http_status":500,"audit_recorded":false,"disputes_auto_created":null},"representative_score_write_observed":true,"followups_stubbed":0,"production_task_identity":"unlinked","authenticated_acceptance":"UNVERIFIED","provider_calls":0}'::jsonb AND z.case_id=r.regression_case_id AND z.task_verdict='fail' AND z.evidence_state='complete' AND z.scorer='exact_match' AND z.evaluator_version='1.0.0' AND z.score=0 AND z.passed=false) THEN RAISE EXCEPTION 'reviewed_regression_publication_collision' USING ERRCODE='55000'; END IF;
END $$;
