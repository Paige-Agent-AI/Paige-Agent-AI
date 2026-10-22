-- Native draft wording history, subordinate to the original agreement.
-- No historical backfill, second agreement/writer, approval, execution or ledger.
-- Original SAVE, native signing events and frozen/sealed document guards unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE IF NOT EXISTS public.paige_agreement_draft_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.paige_agreements(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  revision_no bigint NOT NULL CHECK (revision_no>0),
  source_body_version integer NOT NULL CHECK (source_body_version>0),
  source_updated_at timestamptz NOT NULL,
  contact_id uuid NOT NULL,
  offer_id uuid,
  commercial_terms_id uuid,
  title text NOT NULL,
  body_source text NOT NULL CHECK (body_source IN ('paige_draft','tenant_template','tenant_upload')),
  source_version_id uuid,
  body_markdown text,
  document_path text,
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retained_by uuid,
  UNIQUE(agreement_id,revision_no),
  CHECK ((body_source='tenant_upload' AND document_path IS NOT NULL AND body_markdown IS NULL)
    OR (body_source<>'tenant_upload' AND btrim(coalesce(body_markdown,''))<>'' AND document_path IS NULL))
);
COMMENT ON TABLE public.paige_agreement_draft_revisions IS
  'Immutable wording/source snapshots of ONE native agreement. Not a signature, accepted economics, rendered PDF seal, payment obligation or execution receipt. Earlier missing versions are not reconstructed.';
COMMENT ON COLUMN public.paige_agreement_draft_revisions.document_path IS
  'Private original source reference only; never returned by human history readers and not proof that uploaded bytes remain available.';
COMMENT ON COLUMN public.paige_agreement_draft_revisions.source_body_version IS
  'Original engine content version, not a reconstructed consecutive historical revision number.';

ALTER TABLE public.paige_agreement_draft_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paige_agreement_draft_revisions FROM PUBLIC,anon,authenticated,service_role;

-- Closed private source state. Excludes execution, credentials and signer evidence.
-- This hash is draft-state evidence, never the native signing/document seal.
CREATE OR REPLACE FUNCTION public._paige_agreement_draft_state(_a public.paige_agreements)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'contact_id',_a.contact_id,'offer_id',_a.offer_id,'commercial_terms_id',_a.commercial_terms_id,
    'title',_a.title,'body_source',_a.body_source,'source_version_id',_a.source_version_id,
    'body_markdown',_a.body_markdown,'document_path',_a.document_path,'source_body_version',_a.version)
$function$;
REVOKE ALL ON FUNCTION public._paige_agreement_draft_state(public.paige_agreements)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._guard_paige_agreement_draft_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $function$
DECLARE expected_tenant uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Retained agreement wording is immutable' USING ERRCODE='23514';
  END IF;
  SELECT a.tenant_id INTO expected_tenant FROM public.paige_agreements a WHERE a.id=NEW.agreement_id;
  IF NOT FOUND OR NEW.tenant_id IS DISTINCT FROM expected_tenant THEN
    RAISE EXCEPTION 'Revision must belong to its original agreement business' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._guard_paige_agreement_draft_revision()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_guard_paige_agreement_draft_revision ON public.paige_agreement_draft_revisions;
CREATE TRIGGER trg_guard_paige_agreement_draft_revision
  BEFORE INSERT OR UPDATE OR DELETE ON public.paige_agreement_draft_revisions
  FOR EACH ROW EXECUTE FUNCTION public._guard_paige_agreement_draft_revision();
DROP TRIGGER IF EXISTS trg_no_truncate_paige_agreement_draft_revision ON public.paige_agreement_draft_revisions;
CREATE TRIGGER trg_no_truncate_paige_agreement_draft_revision
  BEFORE TRUNCATE ON public.paige_agreement_draft_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public._guard_paige_agreement_draft_revision();

CREATE OR REPLACE FUNCTION public._retain_paige_agreement_draft_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  sources public.paige_agreements[];
  a public.paige_agreements;
  prior_hash text;
  prior_no bigint;
  fingerprint text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'draft' THEN RETURN NEW; END IF;
    sources:=ARRAY[NEW];
  ELSE
    IF OLD.status<>'draft' THEN RETURN NEW; END IF;
    -- For an existing draft whose earlier wording was never retained, record the
    -- actual known pre-edit state now. Its original source timestamp is explicit;
    -- retention time is NOW, never fabricated historical activity.
    sources:=CASE WHEN NEW.status='draft' THEN ARRAY[OLD,NEW] ELSE ARRAY[OLD] END;
  END IF;

  -- The original parent INSERT/UPDATE already holds its row lock. All callers,
  -- including legacy SAVE and concurrent edits, therefore share this sequence.
  FOREACH a IN ARRAY sources LOOP
    fingerprint:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      public._paige_agreement_draft_state(a)::text,'UTF8')),'hex');
    prior_hash:=NULL; prior_no:=NULL;
    SELECT r.snapshot_sha256,r.revision_no INTO prior_hash,prior_no
      FROM public.paige_agreement_draft_revisions r
      WHERE r.agreement_id=a.id ORDER BY r.revision_no DESC LIMIT 1;
    IF prior_hash IS NOT DISTINCT FROM fingerprint THEN CONTINUE; END IF;
    INSERT INTO public.paige_agreement_draft_revisions
      (agreement_id,tenant_id,revision_no,source_body_version,source_updated_at,contact_id,
       offer_id,commercial_terms_id,title,body_source,source_version_id,body_markdown,
       document_path,snapshot_sha256,retained_by)
    VALUES
      (a.id,a.tenant_id,coalesce(prior_no,0)+1,a.version,a.updated_at,a.contact_id,
       a.offer_id,a.commercial_terms_id,a.title,a.body_source,a.source_version_id,a.body_markdown,
       a.document_path,fingerprint,auth.uid());
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._retain_paige_agreement_draft_revision()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_retain_paige_agreement_draft_revision ON public.paige_agreements;
CREATE TRIGGER trg_retain_paige_agreement_draft_revision AFTER INSERT OR UPDATE ON public.paige_agreements
  FOR EACH ROW EXECUTE FUNCTION public._retain_paige_agreement_draft_revision();

CREATE OR REPLACE FUNCTION public.read_paige_agreement_draft_revisions(
  _expected_tenant_id uuid,_signing_id uuid,_limit integer DEFAULT 20,_before_revision_no bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  actor uuid:=auth.uid();
  tenant uuid:=public.current_user_tenant_id();
  a public.paige_agreements;
  entries jsonb;
  more boolean;
  cursor_no bigint;
BEGIN
  IF actor IS NULL OR tenant IS NULL OR tenant IS DISTINCT FROM _expected_tenant_id
    OR NOT public.is_tenant_admin(tenant) THEN
    RAISE EXCEPTION 'Agreement author access required in the original business' USING ERRCODE='42501';
  END IF;
  SELECT * INTO a FROM public.paige_agreements WHERE id=_signing_id AND tenant_id=tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agreement is not available in this business' USING ERRCODE='42501'; END IF;
  IF _limit IS NULL OR _limit<1 OR _limit>50 OR (_before_revision_no IS NOT NULL AND _before_revision_no<1) THEN
    RAISE EXCEPTION 'A bounded revision page is required' USING ERRCODE='22023';
  END IF;
  WITH page AS (
    SELECT r.*,row_number() OVER (ORDER BY r.revision_no DESC) AS position
      FROM public.paige_agreement_draft_revisions r
      WHERE r.agreement_id=a.id AND r.tenant_id=tenant
        AND (_before_revision_no IS NULL OR r.revision_no<_before_revision_no)
      ORDER BY r.revision_no DESC LIMIT _limit+1
  ) SELECT
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',id,'revision_no',revision_no,'source_body_version',source_body_version,
      'source_updated_at',source_updated_at,'title',title,'body_source',body_source,
      'retained_at',retained_at,'retained_by',retained_by,'snapshot_sha256',snapshot_sha256
    ) ORDER BY revision_no DESC) FILTER (WHERE position<=_limit),'[]'::jsonb),
    count(*)>_limit,min(revision_no) FILTER (WHERE position<=_limit)
    INTO entries,more,cursor_no FROM page;
  RETURN pg_catalog.jsonb_build_object(
    'agreement_id',a.id,'current_source_version',a.version,'current_updated_at',a.updated_at,
    'revisions',entries,'truncated',more,'next_before_revision_no',CASE WHEN more THEN cursor_no ELSE NULL END);
END;
$function$;
REVOKE ALL ON FUNCTION public.read_paige_agreement_draft_revisions(uuid,uuid,integer,bigint)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_paige_agreement_draft_revisions(uuid,uuid,integer,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_paige_agreement_draft_revision(
  _expected_tenant_id uuid,_signing_id uuid,_revision_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  actor uuid:=auth.uid();
  tenant uuid:=public.current_user_tenant_id();
  r public.paige_agreement_draft_revisions;
BEGIN
  IF actor IS NULL OR tenant IS NULL OR tenant IS DISTINCT FROM _expected_tenant_id
    OR NOT public.is_tenant_admin(tenant) THEN
    RAISE EXCEPTION 'Agreement author access required in the original business' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.paige_agreements WHERE id=_signing_id AND tenant_id=tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agreement is not available in this business' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.paige_agreement_draft_revisions
    WHERE id=_revision_id AND agreement_id=_signing_id AND tenant_id=tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revision is not available in this agreement' USING ERRCODE='42501'; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'id',r.id,'agreement_id',r.agreement_id,'revision_no',r.revision_no,
    'source_body_version',r.source_body_version,'source_updated_at',r.source_updated_at,
    'contact_id',r.contact_id,'offer_id',r.offer_id,'commercial_terms_id',r.commercial_terms_id,
    'title',r.title,'body_source',r.body_source,'source_version_id',r.source_version_id,
    'body_markdown',r.body_markdown,'has_source_document',r.document_path IS NOT NULL,
    'snapshot_sha256',r.snapshot_sha256,'retained_at',r.retained_at,'retained_by',r.retained_by);
END;
$function$;
REVOKE ALL ON FUNCTION public.read_paige_agreement_draft_revision(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_paige_agreement_draft_revision(uuid,uuid,uuid) TO authenticated;
COMMIT;
