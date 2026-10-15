-- INT339: minimize new telemetry writes at the shared persistence boundary.
-- Historical rows pass through the same minimizer; no deletion, authority change,
-- external revocation, or new public RPC.
BEGIN;
CREATE SCHEMA IF NOT EXISTS analytics_privacy;
REVOKE ALL ON SCHEMA analytics_privacy FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION analytics_privacy.minimize_text(value text, identity_field boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  result text := value;
  decoded bytea;
  part text;
  run text;
  pass integer;
BEGIN
  IF result IS NULL THEN RETURN NULL; END IF;
  IF identity_field THEN
    IF result ~* '^[0-9a-f]{64}$' THEN RETURN result; END IF;
    RETURN '<redacted>';
  END IF;
  -- Do not truncate a secret into an apparently safe fragment.
  IF length(result) > 512 THEN RETURN '<redacted>'; END IF;
  -- Decode nested percent encodings before parsing. Invalid encodings fail closed.
  FOR pass IN 1..4 LOOP
    EXIT WHEN result !~ '%[0-9A-Fa-f]{2}';
    decoded := ''::bytea;
    WHILE length(result) > 0 LOOP
      IF result ~ '^%[0-9A-Fa-f]{2}' THEN
        decoded := decoded || decode(substr(result,2,2),'hex');
        result := substr(result,4);
      ELSE
        decoded := decoded || convert_to(substr(result,1,1),'UTF8');
        result := substr(result,2);
      END IF;
    END LOOP;
    result := convert_from(decoded,'UTF8');
  END LOOP;
  IF result ~ '%[0-9A-Fa-f]{2}' THEN RETURN '<redacted>'; END IF;
  -- Query / fragment prose is not analytics metadata. Attribution has dedicated columns.
  result := regexp_replace(result, '[?#][^[:space:]]*', '', 'g');
  result := regexp_replace(result, '((https?://|//))[^/[:space:]]*@', '\1<redacted>@', 'gi');
  result := regexp_replace(result, '(/(sign|join|u)/)[^[:space:]]*', '\1<redacted>', 'gi');
  result := regexp_replace(result, '(\m(token|ct|invite_token|access_token|refresh_token|api_key|apikey|password|secret|jwt)\M[[:space:]]*[:=][[:space:]]*)[^[:space:]]+', '\1<redacted>', 'gi');
  -- Inspect individual tokens and every slash-joined suffix. A base64 credential can
  -- be single-case and split into individually harmless short segments.
  FOR part IN SELECT (regexp_matches(result, '[A-Za-z0-9+/_=-]{20,}', 'g'))[1] LOOP
    FOR run IN
      SELECT candidate FROM (
        SELECT part AS candidate UNION
        SELECT substr(part, n+1) FROM generate_series(1,length(part)) n WHERE substr(part,n,1) = '/'
        UNION
        -- A token may be followed by another route segment. Inspect a bounded
        -- mint-width prefix at every slash boundary, rather than only suffixes.
        SELECT substr(part,n,32) FROM generate_series(1,length(part)) n
        WHERE (n = 1 OR substr(part,n-1,1) = '/')
          AND length(substr(part,n,32)) = 32
          AND (n+32 > length(part) OR substr(part,n+32,1) = '/')
      ) suffixes ORDER BY length(candidate)
    LOOP
      IF run ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN CONTINUE; END IF;
      IF (NOT identity_field AND run ~* '^[0-9a-f]{32,}$')
        OR (length(run) = 32 AND run ~ '^[A-Za-z0-9+/_=-]+$' AND NOT identity_field)
        OR (length(run) >= 32 AND run ~ '^[A-Za-z0-9+=]+$')
        OR (length(run) >= 28 AND run ~ '^[A-Za-z0-9+/=]+$' AND run ~ '/' AND run ~ '[a-z]' AND run ~ '[A-Z]')
      THEN result := replace(result,run,'<redacted>'); END IF;
    END LOOP;
  END LOOP;
  -- Form decoding can turn '+' into spaces; inspect the complete mint-width value.
  IF NOT identity_field AND length(result) = 32 AND result ~ '^[A-Za-z0-9+/_= -]+$'
    THEN RETURN '<redacted>'; END IF;
  RETURN result;
EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN RETURN '<redacted>';
END $$;

CREATE OR REPLACE FUNCTION analytics_privacy.minimize_json(value jsonb, depth integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE result jsonb; item record; count_items integer := 0; clean_key text;
BEGIN
  IF depth >= 4 THEN RETURN '"<redacted>"'::jsonb; END IF;
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      result := '{}'::jsonb;
      FOR item IN SELECT key,val FROM jsonb_each(value) AS entry(key,val) LOOP
        count_items := count_items + 1; EXIT WHEN count_items > 64;
        IF item.key ~* '^(query|question|top_titles|token|invite_token|access_token|refresh_token|jwt|secret|api_key|apikey|password)$' THEN CONTINUE; END IF;
        clean_key := analytics_privacy.minimize_text(item.key);
        -- Never retain sensitive data as an object key, or collide redacted keys.
        IF clean_key <> item.key THEN CONTINUE; END IF;
        result := result || jsonb_build_object(clean_key, analytics_privacy.minimize_json(item.val,depth+1));
      END LOOP;
      RETURN result;
    WHEN 'array' THEN
      result := '[]'::jsonb;
      FOR item IN SELECT val FROM jsonb_array_elements(value) AS entry(val) LIMIT 64 LOOP
        result := result || jsonb_build_array(analytics_privacy.minimize_json(item.val,depth+1));
      END LOOP;
      RETURN result;
    WHEN 'string' THEN RETURN to_jsonb(analytics_privacy.minimize_text(value #>> '{}'));
    ELSE RETURN value;
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION analytics_privacy.minimize_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE payload jsonb := to_jsonb(NEW); item record;
BEGIN
  FOR item IN SELECT key,val FROM jsonb_each(payload) AS entry(key,val) LOOP
    IF jsonb_typeof(item.val) = 'string' AND item.key NOT IN ('id','user_id','affiliate_id','created_at','clicked_at') THEN
      payload := jsonb_set(payload,ARRAY[item.key],to_jsonb(analytics_privacy.minimize_text(item.val #>> '{}',item.key = 'ip_hash')));
    ELSIF item.key = 'properties' THEN
      payload := jsonb_set(payload,ARRAY[item.key],analytics_privacy.minimize_json(item.val));
    END IF;
  END LOOP;
  NEW := jsonb_populate_record(NEW,payload);
  RETURN NEW;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics_privacy FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS analytics_events_minimize_storage ON public.analytics_events;
CREATE TRIGGER analytics_events_minimize_storage BEFORE INSERT OR UPDATE ON public.analytics_events
FOR EACH ROW EXECUTE FUNCTION analytics_privacy.minimize_row();
DROP TRIGGER IF EXISTS referral_clicks_minimize_storage ON public.referral_clicks;
CREATE TRIGGER referral_clicks_minimize_storage BEFORE INSERT OR UPDATE ON public.referral_clicks
FOR EACH ROW EXECUTE FUNCTION analytics_privacy.minimize_row();
-- Contain historical telemetry using the canonical trigger invariant. Assigning
-- an existing value fires the trigger without replacing IDs or timestamps.
UPDATE public.analytics_events SET properties = properties;
UPDATE public.referral_clicks SET landing_path = landing_path;
COMMIT;
