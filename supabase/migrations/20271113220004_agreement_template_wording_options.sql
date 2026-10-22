-- Business-supplied wording and optional review routing, on the ORIGINAL library.
-- No legal clauses, completed review, sender, signature, payment or new ledger.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE OR REPLACE FUNCTION public.valid_agreement_preparation_options(_options jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
  SELECT CASE WHEN _options IS NULL THEN true
    WHEN pg_catalog.jsonb_typeof(_options)<>'object' THEN false ELSE coalesce((
    _options ?& ARRAY['jurisdiction','review_route','reviewer']
    AND (_options-ARRAY['jurisdiction','review_route','reviewer'])='{}'::jsonb
    AND pg_catalog.jsonb_typeof(_options->'review_route')='string'
    AND _options->>'review_route' IN ('unspecified','business','qualified_legal')
    AND (_options->'jurisdiction'='null'::jsonb OR (
      pg_catalog.jsonb_typeof(_options->'jurisdiction')='string'
      AND pg_catalog.length(_options->>'jurisdiction')<=200
      AND pg_catalog.btrim(_options->>'jurisdiction')<>''))
    AND (_options->'reviewer'='null'::jsonb OR (
      pg_catalog.jsonb_typeof(_options->'reviewer')='string'
      AND pg_catalog.length(_options->>'reviewer')<=200
      AND pg_catalog.btrim(_options->>'reviewer')<>''))
    AND (_options->>'review_route'<>'unspecified' OR _options->'reviewer'='null'::jsonb)
  ),false) END;
$function$;
REVOKE ALL ON FUNCTION public.valid_agreement_preparation_options(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.valid_agreement_preparation_options(jsonb) TO authenticated,service_role;

ALTER TABLE public.tenant_agreement_versions
  ADD COLUMN IF NOT EXISTS preparation_options jsonb,
  ADD COLUMN IF NOT EXISTS preparation_purpose text,
  ADD COLUMN IF NOT EXISTS source_template_version_id uuid REFERENCES public.tenant_agreement_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_template_updated_at timestamptz;
DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE
    conrelid='public.tenant_agreement_versions'::regclass AND conname='tav_preparation_options_ck') THEN
    ALTER TABLE public.tenant_agreement_versions ADD CONSTRAINT tav_preparation_options_ck
      CHECK(public.valid_agreement_preparation_options(preparation_options));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE
    conrelid='public.tenant_agreement_versions'::regclass AND conname='tav_preparation_lineage_ck') THEN
    ALTER TABLE public.tenant_agreement_versions ADD CONSTRAINT tav_preparation_lineage_ck CHECK (
      (preparation_purpose IS NOT NULL OR (preparation_options IS NULL
        AND source_template_version_id IS NULL AND source_template_updated_at IS NULL))
      AND
      (preparation_purpose IS NULL OR (preparation_purpose='client_engagement' AND preparation_options IS NOT NULL
        AND source_mode='tenant_fork' AND uploaded_file_path IS NULL AND uploaded_file_mime IS NULL
        AND rendered_sha256 IS NULL AND version>0 AND body_markdown IS NOT NULL
        AND pg_catalog.btrim(body_markdown,E' \t\r\n')<>'' AND pg_catalog.length(body_markdown)<=300000
        AND pg_catalog.btrim(title,E' \t\r\n')<>'' AND pg_catalog.length(title)<=500))
      AND ((source_template_version_id IS NULL AND source_template_updated_at IS NULL)
        OR (source_template_version_id IS NOT NULL AND source_template_version_id<>id AND source_template_updated_at IS NOT NULL)));
  END IF;
END;
$constraint$;
-- Actual pre-edit catalog: zero rows/duplicate groups. A later collision refuses
-- this migration rather than silently renumbering or rewriting original versions.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_agreement_versions_prepared_number_uidx
  ON public.tenant_agreement_versions(tenant_id,template_slug,version)
  WHERE preparation_purpose='client_engagement';

CREATE OR REPLACE FUNCTION public.preserve_agreement_template_wording()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE _retained boolean; _source public.tenant_agreement_versions%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.preparation_purpose='client_engagement' THEN
      IF auth.uid() IS NULL OR NEW.created_by IS DISTINCT FROM auth.uid()
        OR NEW.tenant_id IS DISTINCT FROM public.current_user_tenant_id()
        OR public.is_tenant_admin(NEW.tenant_id) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'The original authenticated business author is required' USING ERRCODE='42501';
      END IF;
      IF NEW.source_template_version_id IS NOT NULL THEN
        SELECT * INTO _source FROM public.tenant_agreement_versions
          WHERE id=NEW.source_template_version_id AND tenant_id=NEW.tenant_id FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'The original business source is unavailable' USING ERRCODE='42501'; END IF;
        IF _source.updated_at IS DISTINCT FROM NEW.source_template_updated_at THEN
          RAISE EXCEPTION 'The original template source changed' USING ERRCODE='40001';
        END IF;
        IF (_source.preparation_purpose='client_engagement'
            AND (NEW.template_slug IS DISTINCT FROM _source.template_slug OR NEW.version<>_source.version+1))
          OR (_source.preparation_purpose IS DISTINCT FROM 'client_engagement'
            AND (NEW.template_slug IS DISTINCT FROM 'service-'||NEW.id::text OR NEW.version<>1))
          OR NEW.base_template_id IS DISTINCT FROM _source.base_template_id THEN
          RAISE EXCEPTION 'Preserve the exact original template lineage' USING ERRCODE='23514';
        END IF;
      ELSIF NEW.template_slug IS DISTINCT FROM 'service-'||NEW.id::text OR NEW.version<>1 OR NEW.base_template_id IS NOT NULL THEN
        RAISE EXCEPTION 'A new business template requires its original version identity' USING ERRCODE='23514';
      END IF;
      -- Existing direct table writers cannot manufacture another author's
      -- retained creation receipt or supply a backdated prepared-version time.
      NEW.created_at:=pg_catalog.transaction_timestamp(); NEW.updated_at:=NEW.created_at;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.preparation_purpose IS DISTINCT FROM OLD.preparation_purpose THEN
    RAISE EXCEPTION 'Create an original prepared version instead of adopting a legacy row' USING ERRCODE='23514';
  END IF;
  _retained:=OLD.preparation_purpose='client_engagement'
    OR EXISTS(SELECT 1 FROM public.paige_agreements WHERE source_version_id=OLD.id)
    OR EXISTS(SELECT 1 FROM public.tenant_agreement_versions WHERE source_template_version_id=OLD.id);
  IF TG_OP='DELETE' THEN
    IF _retained THEN
      RAISE EXCEPTION 'Retain the original template version used by this agreement' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  -- Do not adopt or change unrelated legacy legal-profile editor semantics.
  -- Once consumed, preserve that exact source as well as new prepared versions.
  IF NOT coalesce(_retained,false) THEN RETURN NEW; END IF;
  IF ROW(NEW.id,NEW.tenant_id,NEW.template_slug,NEW.source_mode,NEW.base_template_id,
      NEW.title,NEW.body_markdown,NEW.uploaded_file_path,NEW.uploaded_file_mime,
      NEW.version,NEW.rendered_sha256,NEW.created_by,NEW.created_at,NEW.preparation_options,
      NEW.preparation_purpose,NEW.source_template_version_id,NEW.source_template_updated_at)
    IS DISTINCT FROM
    ROW(OLD.id,OLD.tenant_id,OLD.template_slug,OLD.source_mode,OLD.base_template_id,
      OLD.title,OLD.body_markdown,OLD.uploaded_file_path,OLD.uploaded_file_mime,
      OLD.version,OLD.rendered_sha256,OLD.created_by,OLD.created_at,OLD.preparation_options,
      OLD.preparation_purpose,OLD.source_template_version_id,OLD.source_template_updated_at) THEN
    RAISE EXCEPTION 'Create a new template version to change wording or preparation options' USING ERRCODE='23514';
  END IF;
  -- Original admin active flags remain supported. Governed versions retain the
  -- original retry identity and history; archive them. An unconfigured legacy
  -- leaf without a consumer retains the original deletion policy.
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.preserve_agreement_template_wording() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_preserve_agreement_template_wording ON public.tenant_agreement_versions;
CREATE TRIGGER trg_preserve_agreement_template_wording BEFORE INSERT OR UPDATE OR DELETE
  ON public.tenant_agreement_versions FOR EACH ROW EXECUTE FUNCTION public.preserve_agreement_template_wording();

-- One version UUID is also its opaque retry identity; no second request store.
CREATE OR REPLACE FUNCTION public.create_agreement_template_version(
  _expected_tenant_id uuid,_version_id uuid,_previous_version_id uuid,
  _title text,_body_markdown text,_preparation_options jsonb,_expected_source_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  _actor uuid:=auth.uid(); _tenant uuid:=public.current_user_tenant_id();
  _row public.tenant_agreement_versions%ROWTYPE;
  _previous public.tenant_agreement_versions%ROWTYPE;
  _latest uuid; _expected_latest uuid; _slug text; _source_slug text; _number integer;
  _title_t text:=pg_catalog.btrim(coalesce(_title,''));
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR _expected_tenant_id IS DISTINCT FROM _tenant
    OR public.is_tenant_admin(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Agreement author access in the original business is required' USING ERRCODE='42501';
  END IF;
  IF _version_id IS NULL OR _title_t='' OR pg_catalog.length(_title_t)>500
    OR _body_markdown IS NULL OR pg_catalog.btrim(_body_markdown)=''
    OR pg_catalog.length(_body_markdown)>300000 OR _preparation_options IS NULL
    OR NOT public.valid_agreement_preparation_options(_preparation_options) THEN
    RAISE EXCEPTION 'Complete supported template wording and options are required' USING ERRCODE='22023';
  END IF;
  -- Recheck even after waiting: a UUID retry can only return this actor's SAME
  -- exact original intent. A later active version is not substituted for it.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agreement-template-id:'||_tenant::text||':'||_version_id::text,0));
  SELECT * INTO _row FROM public.tenant_agreement_versions WHERE id=_version_id AND tenant_id=_tenant;
  IF FOUND THEN
    IF _row.tenant_id IS DISTINCT FROM _tenant OR _row.created_by IS DISTINCT FROM _actor THEN
      RAISE EXCEPTION 'The original template request is unavailable' USING ERRCODE='42501';
    END IF;
    IF _row.preparation_purpose IS DISTINCT FROM 'client_engagement'
      OR ROW(_row.title,_row.body_markdown,_row.preparation_options,_row.source_template_version_id,_row.source_template_updated_at)
       IS DISTINCT FROM ROW(_title_t,_body_markdown,_preparation_options,_previous_version_id,_expected_source_updated_at) THEN
      RAISE EXCEPTION 'This version identity belongs to different wording or options' USING ERRCODE='40001';
    END IF;
  ELSE
    IF _previous_version_id IS NULL THEN
      IF _expected_source_updated_at IS NOT NULL THEN
        RAISE EXCEPTION 'An original source identity is required with its timestamp' USING ERRCODE='22023';
      END IF;
      _slug:='service-'||_version_id::text; _source_slug:=_slug; _number:=1; _expected_latest:=NULL;
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agreement-template-group:'||_tenant::text||':'||_source_slug,0));
    ELSE
      SELECT * INTO _previous FROM public.tenant_agreement_versions WHERE id=_previous_version_id AND tenant_id=_tenant;
      IF NOT FOUND THEN RAISE EXCEPTION 'The selected original template is unavailable' USING ERRCODE='42501'; END IF;
      _source_slug:=_previous.template_slug;
      -- Group BEFORE row lock: two revisions must not hold shared predecessor
      -- locks while waiting for each other's group/active-flag update.
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agreement-template-group:'||_tenant::text||':'||_source_slug,0));
      SELECT * INTO _previous FROM public.tenant_agreement_versions
        WHERE id=_previous_version_id AND tenant_id=_tenant FOR SHARE;
      IF NOT FOUND OR _expected_source_updated_at IS NULL
        OR _previous.updated_at IS DISTINCT FROM _expected_source_updated_at
        OR _previous.template_slug IS DISTINCT FROM _source_slug THEN
        RAISE EXCEPTION 'The original template changed; inspect it before continuing' USING ERRCODE='40001';
      END IF;
      IF _previous.source_mode='tenant_upload' OR _previous.uploaded_file_path IS NOT NULL OR _previous.body_markdown IS NULL THEN
        RAISE EXCEPTION 'An uploaded source cannot be replaced with text here' USING ERRCODE='23514';
      END IF;
      IF _previous.preparation_purpose='client_engagement' THEN
        _slug:=_previous.template_slug; _number:=_previous.version+1; _expected_latest:=_previous.id;
      ELSE
        -- Reuse a legacy text source without adopting its mutable editor or
        -- changing its numbering/active flags. Retain an explicit source link.
        _slug:='service-'||_version_id::text; _number:=1; _expected_latest:=NULL;
      END IF;
    END IF;
    SELECT id INTO _latest FROM public.tenant_agreement_versions WHERE tenant_id=_tenant AND template_slug=_slug
      AND preparation_purpose='client_engagement' ORDER BY version DESC,id DESC LIMIT 1;
    IF _latest IS DISTINCT FROM _expected_latest THEN
      RAISE EXCEPTION 'The template version changed; inspect the current source before correcting it' USING ERRCODE='40001';
    END IF;
    INSERT INTO public.tenant_agreement_versions(id,tenant_id,template_slug,source_mode,base_template_id,
      title,body_markdown,version,is_active,created_by,preparation_options,preparation_purpose,
      source_template_version_id,source_template_updated_at)
    VALUES(_version_id,_tenant,_slug,'tenant_fork',_previous.base_template_id,
      _title_t,_body_markdown,_number,true,_actor,_preparation_options,'client_engagement',
      _previous_version_id,_expected_source_updated_at) RETURNING * INTO _row;
    UPDATE public.tenant_agreement_versions SET is_active=false
      WHERE tenant_id=_tenant AND template_slug=_slug AND preparation_purpose='client_engagement' AND id<>_row.id AND is_active;
  END IF;
  RETURN pg_catalog.jsonb_build_object('id',_row.id,'template_slug',_row.template_slug,'title',_row.title,
    'body_markdown',_row.body_markdown,'version',_row.version,'is_active',_row.is_active,
    'preparation_options',_row.preparation_options,'preparation_purpose',_row.preparation_purpose,
    'source_template_version_id',_row.source_template_version_id,'source_template_updated_at',_row.source_template_updated_at,
    'created_at',_row.created_at,'updated_at',_row.updated_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_agreement_template_version(uuid,uuid,uuid,text,text,jsonb,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_agreement_template_version(uuid,uuid,uuid,text,text,jsonb,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_agreement_template_version(_expected_tenant_id uuid,_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE _tenant uuid:=public.current_user_tenant_id(); _row public.tenant_agreement_versions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL OR _expected_tenant_id IS DISTINCT FROM _tenant
    OR public.is_tenant_admin(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Agreement author access in the original business is required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO _row FROM public.tenant_agreement_versions WHERE id=_version_id AND tenant_id=_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'The original template version is unavailable' USING ERRCODE='42501'; END IF;
  RETURN pg_catalog.jsonb_build_object('id',_row.id,'template_slug',_row.template_slug,'title',_row.title,
    'body_markdown',_row.body_markdown,'version',_row.version,'is_active',_row.is_active,
    'source_mode',_row.source_mode,'preparation_options',_row.preparation_options,'preparation_purpose',_row.preparation_purpose,
    'source_template_version_id',_row.source_template_version_id,'source_template_updated_at',_row.source_template_updated_at,
    'has_uploaded_source',_row.uploaded_file_path IS NOT NULL,'created_at',_row.created_at,'updated_at',_row.updated_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.read_agreement_template_version(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_agreement_template_version(uuid,uuid) TO authenticated;

-- Distinguish a pending original CREATE from conclusive authority refusal.
-- Same immutable version UUID, no additional request/receipt store. VOLATILE
-- obtains a fresh snapshot after waiting for an in-flight creator's ID lock.
CREATE OR REPLACE FUNCTION public.recover_agreement_template_creation(_expected_tenant_id uuid,_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE _tenant uuid:=public.current_user_tenant_id(); _actor uuid:=auth.uid();
  _row public.tenant_agreement_versions%ROWTYPE;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL OR _expected_tenant_id IS DISTINCT FROM _tenant
    OR public.is_tenant_admin(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Agreement author access in the original business is required' USING ERRCODE='42501';
  END IF;
  IF _version_id IS NULL THEN RAISE EXCEPTION 'The original template request is required' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agreement-template-id:'||_tenant::text||':'||_version_id::text,0));
  SELECT * INTO _row FROM public.tenant_agreement_versions
    WHERE id=_version_id AND tenant_id=_tenant AND created_by=_actor AND preparation_purpose='client_engagement';
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('state','unconfirmed'); END IF;
  RETURN pg_catalog.jsonb_build_object('state','recovered','version_record',
    public.read_agreement_template_version(_expected_tenant_id,_row.id));
END;
$function$;
REVOKE ALL ON FUNCTION public.recover_agreement_template_creation(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.recover_agreement_template_creation(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_agreement_template_versions(_expected_tenant_id uuid,
  _before_created_at timestamptz DEFAULT NULL,_before_id uuid DEFAULT NULL,_active_only boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE _tenant uuid:=public.current_user_tenant_id(); _items jsonb; _cursor jsonb; _more boolean;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL OR _expected_tenant_id IS DISTINCT FROM _tenant
    OR public.is_tenant_admin(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Agreement author access in the original business is required' USING ERRCODE='42501';
  END IF;
  IF (_before_created_at IS NULL)<>(_before_id IS NULL) OR _active_only IS NULL THEN
    RAISE EXCEPTION 'A complete original template cursor is required' USING ERRCODE='22023';
  END IF;
  WITH selected AS MATERIALIZED (
    SELECT * FROM public.tenant_agreement_versions WHERE tenant_id=_tenant AND (NOT _active_only OR is_active)
      AND (_before_created_at IS NULL OR (created_at,id)<(_before_created_at,_before_id))
    ORDER BY created_at DESC,id DESC LIMIT 21
  ), page AS (SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT 20)
  SELECT coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',id,'template_slug',template_slug,'title',title,'version',version,'is_active',is_active,
    'source_mode',source_mode,'preparation_options',preparation_options,'preparation_purpose',preparation_purpose,
    'source_template_version_id',source_template_version_id,'source_template_updated_at',source_template_updated_at,
    'has_uploaded_source',uploaded_file_path IS NOT NULL,'created_at',created_at,'updated_at',updated_at)
    ORDER BY created_at DESC,id DESC) FROM page),'[]'::jsonb),
    (SELECT count(*)>20 FROM selected),
    (SELECT pg_catalog.jsonb_build_object('created_at',created_at,'id',id) FROM page ORDER BY created_at,id LIMIT 1)
  INTO _items,_more,_cursor;
  RETURN pg_catalog.jsonb_build_object('items',_items,'next_cursor',CASE WHEN _more THEN _cursor ELSE NULL END);
END;
$function$;
REVOKE ALL ON FUNCTION public.list_agreement_template_versions(uuid,timestamptz,uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_agreement_template_versions(uuid,timestamptz,uuid,boolean) TO authenticated;
COMMIT;
