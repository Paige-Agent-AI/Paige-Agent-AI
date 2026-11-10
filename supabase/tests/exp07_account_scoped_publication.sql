-- Run on a fresh, isolated social_presence_connection_readiness_contract database.
-- Reuse the original auth/tenant fixture and real pre-migration function definitions.
\set ON_ERROR_STOP on
\ir social_presence_connection_readiness.sql

-- The reused fixture predates the 20271133000005 production connection shape.
ALTER TABLE public.paige_social_connections
  DROP CONSTRAINT paige_social_connections_requested_platform_shape,
  ADD CONSTRAINT paige_social_connections_requested_platform_shape CHECK (
    requested_platform IS NULL OR requested_platform IN (
      'tiktok','instagram','facebook','linkedin','youtube','x','threads',
      'pinterest','google_business','snapchat','google','discord','telegram'
    )
  );

CREATE TABLE public.marketing_content (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id)
);
\ir ../migrations/20271113870000_content_publications.sql

-- Match the deployed handles ACL before comparing all four routines.
GRANT EXECUTE ON FUNCTION public.record_social_handles(uuid, jsonb) TO service_role;
CREATE TEMP TABLE original_contract AS
SELECT oid, proowner, prosecdef, proconfig, proacl
FROM pg_proc
WHERE oid IN (
  'public.record_social_handles(uuid,jsonb)'::regprocedure,
  'public.get_social_presence_evidence(uuid)'::regprocedure,
  'public.content_publication_bind(uuid,uuid,uuid,text,uuid,uuid,jsonb)'::regprocedure,
  'public.content_publication_record(uuid,uuid,text,text,text,text,text,jsonb)'::regprocedure
);

\ir ../migrations/20271133000019_exp07_account_scoped_publication.sql
\ir ../migrations/20271133000019_exp07_account_scoped_publication.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT * FROM original_contract
    EXCEPT
    SELECT oid, proowner, prosecdef, proconfig, proacl FROM pg_proc
  ) THEN
    RAISE EXCEPTION 'A routine identity, owner, configuration or ACL changed';
  END IF;
END
$$;

INSERT INTO public.paige_social_connections
  (tenant_id, provider_key, provider_profile_key, requested_platform, label, status, last_verified_at)
VALUES
  ('00000000-0000-4000-8000-00000000d0a1', 'zernio', 'ps_' || repeat('e', 40), 'discord', 'Alpha Discord', 'connected', now()),
  ('00000000-0000-4000-8000-00000000d0a1', 'zernio', 'ps_' || repeat('d', 40), 'telegram', 'Alpha Telegram', 'disconnected', NULL),
  ('00000000-0000-4000-8000-00000000d0b1', 'zernio', 'ps_' || repeat('c', 40), 'telegram', 'Foreign Telegram', 'connected', now());

INSERT INTO public.marketing_content VALUES
  ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000d0a1');

DO $$
DECLARE
  owner_id constant text := '00000000-0000-4000-8000-00000000e001';
  tenant_id constant uuid := '00000000-0000-4000-8000-00000000d0a1';
  piece_id constant uuid := '00000000-0000-4000-8000-00000000f001';
  approval_id constant uuid := '00000000-0000-4000-8000-00000000f002';
  args constant jsonb := '{"content_revision":"v1","account_id":"acct-1","channel_id":"channel-1","caption":"Example"}';
  attempt public.content_publications;
  telegram public.content_publications;
BEGIN
  IF pg_temp.run(owner_id, 'authenticated', 'authenticated',
    $q$SELECT to_jsonb(connection_status) FROM public.get_social_presence_evidence(NULL) WHERE network = 'discord'$q$)
    <> 'ok:"connected"' THEN RAISE EXCEPTION 'Discord did not survive the native read'; END IF;
  IF pg_temp.run(owner_id, 'authenticated', 'authenticated',
    $q$SELECT to_jsonb(connection_status) FROM public.get_social_presence_evidence('00000000-0000-4000-8000-00000000d0b1')
       WHERE network = 'telegram'$q$) <> 'ok:"disconnected"'
    THEN RAISE EXCEPTION 'A revoked destination or foreign Telegram appeared connected'; END IF;
  IF pg_temp.run(owner_id, 'authenticated', 'authenticated',
    $q$SELECT public.record_social_handles('00000000-0000-4000-8000-00000000d0b1','{"discord":"foreign"}')$q$)
    NOT LIKE 'err:42501:%' THEN RAISE EXCEPTION 'Cross-workspace handles write was admitted'; END IF;

  PERFORM set_config('test.uid', owner_id, true);
  PERFORM public.record_social_handles(tenant_id, '{"discord":"Alpha","telegram":"t.me/alpha"}');
  IF (SELECT count(*) FROM public.get_social_presence_evidence(NULL) WHERE network IN ('discord','telegram') AND handle IS NOT NULL) <> 2
    THEN RAISE EXCEPTION 'Discord and Telegram handles did not reopen'; END IF;
  BEGIN
    PERFORM public.content_publication_bind(NULL, tenant_id, piece_id, 'discord', NULL, approval_id, args);
    RAISE EXCEPTION 'A signed-in user wrote the service receipt directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('test.uid', '', true);
  attempt := public.content_publication_bind(NULL, tenant_id, piece_id, 'discord', NULL, approval_id, args);
  IF attempt.status <> 'approved' THEN RAISE EXCEPTION 'Original receipt was not bound'; END IF;
  BEGIN
    PERFORM public.content_publication_bind(NULL, tenant_id, piece_id, 'discord', NULL, gen_random_uuid(), args);
    RAISE EXCEPTION 'A second approval obtained another in-flight attempt';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  PERFORM public.content_publication_record(attempt.id, tenant_id, 'publishing');
  BEGIN
    PERFORM public.content_publication_record(attempt.id, tenant_id, 'refused', p_error_code => 'approval_abandoned');
    RAISE EXCEPTION 'An in-flight attempt was released as abandoned';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  PERFORM public.content_publication_record(attempt.id, tenant_id, 'outcome_unknown');
  BEGIN
    PERFORM public.content_publication_record(attempt.id, tenant_id, 'published', p_provider_request_id => 'post-1');
    RAISE EXCEPTION 'Unknown became published without a reconciled readback';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  attempt := public.content_publication_record(attempt.id, tenant_id, 'published',
    p_provider_post_id => 'native-1', p_provider_post_url => 'https://discord.com/channels/1/2/3',
    p_provider_request_id => 'post-1', p_provider_response => '{"reconciled":true}');
  IF attempt.status <> 'published' OR attempt.provider_post_id <> 'native-1'
    THEN RAISE EXCEPTION 'Reconciliation did not advance the original receipt'; END IF;
  BEGIN
    PERFORM public.content_publication_bind(NULL, tenant_id, piece_id, 'discord', NULL, gen_random_uuid(), args);
    RAISE EXCEPTION 'A second approval bound the same successful revision, destination and caption';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.content_publications WHERE content_id = piece_id AND platform = 'discord') <> 1
    THEN RAISE EXCEPTION 'Duplicate publication row was created'; END IF;
  telegram := public.content_publication_bind(NULL, tenant_id, piece_id, 'telegram', NULL, approval_id, args);
  IF telegram.status <> 'approved' THEN RAISE EXCEPTION 'Telegram receipt was not admitted'; END IF;
  BEGIN
    PERFORM public.content_publication_bind(NULL, tenant_id, piece_id, 'google', NULL, approval_id, args);
    RAISE EXCEPTION 'Google app was admitted as a social target';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'EXP07 account-scoped publication and native presence checks passed';
END
$$;
