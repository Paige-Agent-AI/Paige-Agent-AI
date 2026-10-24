-- Reserved report artifacts inherit Metric authority when reopened. Existing
-- content, writers, deletion/erasure and document types retain their contracts.
-- This prerequisite does not admit or produce a business review.
BEGIN;

-- RLS needs a caller-bound boolean, never an actor override or business data.
-- Original private Metric helpers retain their existing ACLs.
CREATE FUNCTION public._paige_metric_report_readable(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce(public._analytics_metric_authorized(_tenant),false)
$$;
REVOKE ALL ON FUNCTION public._paige_metric_report_readable(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._paige_metric_report_readable(uuid) TO authenticated;

CREATE POLICY marketing_content_metric_report_scope ON public.marketing_content
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (CASE WHEN kind='document' AND meta->>'document_purpose'='metric_business_review'
   THEN public._paige_metric_report_readable(tenant_id) ELSE true END);

CREATE FUNCTION public._paige_metric_report_artifact_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_report boolean := false; new_report boolean;
 before_facts jsonb; after_facts jsonb; retired_reference boolean := false;
BEGIN
 IF TG_OP='UPDATE' THEN
  old_report := OLD.kind='document' AND OLD.meta->>'document_purpose'='metric_business_review';
 END IF;
 new_report := NEW.kind='document' AND NEW.meta->>'document_purpose'='metric_business_review';
 IF old_report THEN
  before_facts := to_jsonb(OLD)-'updated_at'-'status';
  after_facts := to_jsonb(NEW)-'updated_at'-'status';
  -- Preserve the original FK erasure contracts, even after the deleted actor or
  -- work can no longer authorize a read. This permits only genuine nulling of a
  -- now-absent reference, never caller-directed replacement or fact/privacy edits.
  IF NEW.work_id IS NULL AND OLD.work_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.paige_durable_work WHERE id=OLD.work_id) THEN
   before_facts := before_facts-'work_id'; after_facts := after_facts-'work_id'; retired_reference := true;
  END IF;
  IF NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id=OLD.created_by) THEN
   before_facts := before_facts-'created_by'; after_facts := after_facts-'created_by'; retired_reference := true;
  END IF;
  IF auth.uid() IS NOT NULL AND public._analytics_metric_authorized(OLD.tenant_id) IS DISTINCT FROM true
    AND NOT (retired_reference AND before_facts=after_facts AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_REVIEW_ARTIFACT_UNAVAILABLE';
  END IF;
  -- Captured facts, privacy, ownership and work identity remain original. Only
  -- existing archival/touch behavior may change; a new review is a new artifact.
  IF after_facts IS DISTINCT FROM before_facts
    OR NEW.status NOT IN ('draft','archived') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_REVIEW_ARTIFACT_IMMUTABLE';
  END IF;
 ELSIF new_report THEN
  -- Ordinary Studio calls cannot manufacture the reserved server-origin class.
  -- The original document writer supplies the original work's identity; this
  -- guard neither claims nor completes that work and grants no table writes.
  IF auth.uid() IS NOT NULL OR NEW.work_id IS NULL OR NEW.id IS DISTINCT FROM NEW.work_id
    OR NEW.status IS DISTINCT FROM 'draft'
    OR NOT EXISTS (
     SELECT 1 FROM public.paige_durable_work w
      WHERE w.id=NEW.work_id AND w.tenant_id=NEW.tenant_id AND w.initiating_user_id=NEW.created_by
       AND w.capability_key='document_generate' AND w.work_kind='document_authoring' AND w.status='claimed'
       AND w.request_payload->>'doc_type'='business_review'
       AND jsonb_typeof(w.request_payload->'report_evidence')='object'
       AND public._analytics_metric_actor_authorized(w.initiating_user_id,w.tenant_id)
    ) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_REVIEW_ARTIFACT_UNAVAILABLE';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._paige_metric_report_artifact_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_metric_report_artifact_guard BEFORE INSERT OR UPDATE ON public.marketing_content
 FOR EACH ROW EXECUTE FUNCTION public._paige_metric_report_artifact_guard();

COMMIT;
