-- Preserve the native reviewed source even when delivery has not advanced Draft.
-- Same trigger, original SAVE, signer engine, records, audit and history. No DML.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE OR REPLACE FUNCTION public.enforce_agreement_seal_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  IF OLD.content_sha256 IS NOT NULL
     AND (NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
          OR NEW.content_storage_key IS DISTINCT FROM OLD.content_storage_key) THEN
    RAISE EXCEPTION 'the document presented to the signer is frozen and cannot be rewritten'
      USING ERRCODE='23514';
  END IF;
  IF OLD.content_storage_key IS NOT NULL
     AND NEW.content_storage_key IS DISTINCT FROM OLD.content_storage_key THEN
    RAISE EXCEPTION 'the retained presented document cannot be replaced'
      USING ERRCODE='23514';
  END IF;
  IF OLD.sealed_sha256 IS NOT NULL
     AND (NEW.sealed_sha256 IS DISTINCT FROM OLD.sealed_sha256
          OR NEW.sealed_storage_key IS DISTINCT FROM OLD.sealed_storage_key) THEN
    RAISE EXCEPTION 'a sealed agreement is a retained record and cannot be rewritten'
      USING ERRCODE='23514';
  END IF;

  IF OLD.sealed_storage_key IS NOT NULL
     AND NEW.sealed_storage_key IS DISTINCT FROM OLD.sealed_storage_key THEN
    RAISE EXCEPTION 'the retained completed document cannot be replaced'
      USING ERRCODE='23514';
  END IF;

  -- A failed or interrupted send can leave frozen bytes on a Draft. Status alone
  -- does not make its source editable. Recheck OLD under the actual UPDATE lock,
  -- including when SAVE read the draft before a concurrent freeze committed.
  IF (OLD.status<>'draft' OR OLD.content_sha256 IS NOT NULL
      OR OLD.content_storage_key IS NOT NULL OR OLD.sealed_sha256 IS NOT NULL
      OR OLD.sealed_storage_key IS NOT NULL)
    AND ROW(NEW.id,NEW.tenant_id,NEW.contact_id,NEW.offer_id,NEW.commercial_terms_id,
      NEW.title,NEW.body_markdown,NEW.version,NEW.body_source,NEW.source_version_id,NEW.document_path)
      IS DISTINCT FROM
      ROW(OLD.id,OLD.tenant_id,OLD.contact_id,OLD.offer_id,OLD.commercial_terms_id,
      OLD.title,OLD.body_markdown,OLD.version,OLD.body_source,OLD.source_version_id,OLD.document_path) THEN
    RAISE EXCEPTION 'this agreement document is retained; its reviewed source cannot be edited'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_agreement_seal_immutable() FROM PUBLIC,anon;
-- CREATE OR REPLACE preserves the existing trigger, ownership and other ACLs.
-- Delivery/signing/expiry/void/sealing metadata still uses its original writers.
COMMIT;
