-- RENUMBERED 20270106000000 -> 20270419000000 on 2026-09-24, because it had NEVER APPLIED.
--
-- MEASURED on production before the move, not inferred: `schema_migrations` holds exactly one row at
-- 20270106000000 and it belongs to 20270106000000_durable_job_weekly_summary_claims.sql, whose index
-- `idx_comm_prefs_weekly_summary_due` exists. Of this file's objects, `secure_browser_sessions`,
-- `secure_browser_tenant_limits` and `_secure_browser_safe_text` were all ABSENT. The control plane
-- merged in PR #1046 and its schema never arrived.
--
-- HOW IT HAPPENED, because the shape matters more than this instance. This file was ALREADY renumbered
-- once: the evidence doc records it moving TO 20270106000000 to escape the #1047 collision on 2026-09-07.
-- The durable-job migration then landed on `main` on 2026-09-10 at that same version. Three days apart,
-- and no lint could see it: `lint:migration-versions` resolves its base as `origin/main`, so a branch
-- only ever compares itself to trunk and never to another open branch. Both passed. The second to merge
-- was skipped in silence, with every gate green. Filed as the general case in #1425.
--
-- Renumbering is safe HERE precisely because it never applied. The rule against renumbering a migration
-- protects APPLIED ones, whose version is already recorded; this one has no row to contradict.
--
-- VERIFIED BEFORE THE MOVE, against production, because this makes dormant SQL runnable:
--   * zero destructive statements -- no DROP, TRUNCATE or DELETE anywhere in the file;
--   * all 11 external dependencies present (7 tables, 4 functions);
--   * every object this file creates is ABSENT, so nothing collides;
--   * the one UNIQUE index on a pre-existing table is (tenant_id, id) where id is already unique,
--     so duplicates are impossible;
--   * its eight `record_capability_run` calls pass SIX arguments, and 20270411090000 DROPPED the
--     six-argument signature hours earlier. They still resolve: the surviving ten-argument function
--     has 5 required parameters and 5 defaulted, so a six-argument call binds to it. Checked rather
--     than assumed in either direction, because a plpgsql body resolves its calls at RUN time and a
--     wrong answer here would have shipped functions that fail the moment they file a receipt.

-- Paige Secure Browser MVP: Paige-owned, worker-independent control plane.
-- No worker, secret, credential, cookie, external account, external session, login,
-- crawl, download, live-view grant, or website action is created by this migration.

CREATE FUNCTION public._secure_browser_safe_text(p_value text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT p_value IS NOT NULL
  AND p_value !~* '(password|passwd|passcode|api[-_ ]?key|client[-_ ]?secret|secret|access[-_ ]?token|refresh[-_ ]?token|session[-_ ]?token|token|authorization|cookie|mfa([-_ ]?code)?|otp)[[:space:]]*(is|=|:)[[:space:]]*["''`]?[^[:space:],;]{4,}'
  AND p_value !~* '\mbearer[[:space:]]+[A-Za-z0-9._~+/-]{8,}={0,2}\M'
  AND p_value !~ '\meyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\M'
$$;
REVOKE ALL ON FUNCTION public._secure_browser_safe_text(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._secure_browser_safe_text(text) TO service_role;

CREATE TABLE public.secure_browser_tenant_limits (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  worker_available boolean NOT NULL DEFAULT false,
  paused_at timestamptz, pause_reason text,
  max_active_sessions integer NOT NULL DEFAULT 1 CHECK (max_active_sessions BETWEEN 1 AND 5),
  max_session_seconds integer NOT NULL DEFAULT 900 CHECK (max_session_seconds BETWEEN 60 AND 3600),
  max_daily_session_seconds integer NOT NULL DEFAULT 1800 CHECK (max_daily_session_seconds BETWEEN 60 AND 86400),
  max_monthly_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (max_monthly_cost_microusd >= 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  configured_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((paused_at IS NULL AND pause_reason IS NULL) OR (paused_at IS NOT NULL AND length(btrim(COALESCE(pause_reason,''))) BETWEEN 1 AND 240))
);

CREATE TABLE public.secure_browser_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('owner','admin','authorized_representative','platform_owner')),
  request_thread_id uuid REFERENCES public.paige_chat_threads(id) ON DELETE SET NULL,
  execution_context_key text NOT NULL CHECK (execution_context_key ~ '^thread:[0-9a-f-]{36}$'),
  purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 3 AND 1000 AND public._secure_browser_safe_text(purpose)),
  target_origin text NOT NULL CHECK (length(target_origin) BETWEEN 9 AND 500 AND target_origin ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' AND target_origin !~ '[@?#]'),
  target_display_host text NOT NULL CHECK (length(target_display_host) BETWEEN 1 AND 253 AND target_display_host ~ '^[A-Za-z0-9.-]+$'),
  allowed_scope jsonb NOT NULL CHECK (jsonb_typeof(allowed_scope)='object' AND allowed_scope ?& ARRAY['mode','allowedOrigins','allowedReadKinds','downloads','consequentialActions'] AND allowed_scope->>'mode' IN ('read_only','propose_only') AND allowed_scope->>'downloads' IN ('disabled','quarantine_only') AND allowed_scope->>'consequentialActions'='disabled' AND jsonb_typeof(allowed_scope->'allowedOrigins')='array' AND jsonb_array_length(allowed_scope->'allowedOrigins') BETWEEN 1 AND 10 AND jsonb_typeof(allowed_scope->'allowedReadKinds')='array' AND jsonb_array_length(allowed_scope->'allowedReadKinds') BETWEEN 1 AND 10),
  authority_state text NOT NULL CHECK (authority_state IN ('authorized','not_authorized','unresolved','expired','revoked')),
  state text NOT NULL CHECK (state IN ('requested','unavailable','opening','awaiting_owner','owner_control','ready','observing','paused','closing','closed','expired','revoked','failed','outcome_unknown')),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0), safe_reason text CHECK (safe_reason IS NULL OR length(safe_reason) BETWEEN 1 AND 80),
  idempotency_key uuid NOT NULL, reserved_seconds integer NOT NULL DEFAULT 0 CHECK (reserved_seconds >= 0), reserved_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (reserved_cost_microusd >= 0),
  expires_at timestamptz, paused_at timestamptz, closed_at timestamptz, revoked_at timestamptz,
  reservation_settled_at timestamptz, consumed_seconds integer NOT NULL DEFAULT 0 CHECK(consumed_seconds>=0), consumed_cost_microusd bigint NOT NULL DEFAULT 0 CHECK(consumed_cost_microusd>=0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,requested_by,idempotency_key), UNIQUE(tenant_id,id,requested_by),
  CHECK ((state='closed' AND closed_at IS NOT NULL) OR (state='revoked' AND revoked_at IS NOT NULL) OR state NOT IN ('closed','revoked'))
);
CREATE UNIQUE INDEX secure_browser_one_active_context_idx ON public.secure_browser_sessions(tenant_id,execution_context_key) WHERE state IN ('opening','awaiting_owner','owner_control','ready','observing','paused','closing');
CREATE INDEX secure_browser_sessions_tenant_recent_idx ON public.secure_browser_sessions(tenant_id,created_at DESC);

CREATE TABLE public.secure_browser_usage_windows (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT, window_kind text NOT NULL CHECK (window_kind IN ('day','month')), window_start date NOT NULL,
  reserved_seconds bigint NOT NULL DEFAULT 0 CHECK (reserved_seconds>=0), consumed_seconds bigint NOT NULL DEFAULT 0 CHECK (consumed_seconds>=0),
  reserved_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (reserved_cost_microusd>=0), consumed_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (consumed_cost_microusd>=0),
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,window_kind,window_start)
);

-- Metadata only: no credential, external runtime handle or create/connect seam exists.
CREATE TABLE public.secure_browser_connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT, created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 120), target_origin text NOT NULL CHECK(target_origin ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'), target_display_host text NOT NULL CHECK(target_display_host ~ '^[A-Za-z0-9.-]+$'),
  state text NOT NULL CHECK(state IN ('not_connected','active','paused','expired','revoked','deleted')), permitted_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,last_used_at timestamptz,paused_at timestamptz,revoked_at timestamptz,deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((state='revoked' AND revoked_at IS NOT NULL) OR (state='deleted' AND deleted_at IS NOT NULL) OR state NOT IN ('revoked','deleted'))
);
CREATE INDEX secure_browser_connections_tenant_idx ON public.secure_browser_connected_accounts(tenant_id,created_at DESC);

-- Future downloads cannot become accessible without an existing Vault quarantine row.
CREATE UNIQUE INDEX business_vault_quarantine_tenant_id_uidx ON public.business_vault_quarantine_uploads(tenant_id,id);
CREATE TABLE public.secure_browser_download_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,session_id uuid NOT NULL,requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  safe_filename text CHECK(safe_filename IS NULL OR length(safe_filename) BETWEEN 1 AND 180),declared_mime text CHECK(declared_mime IS NULL OR length(declared_mime) BETWEEN 1 AND 120),declared_size bigint CHECK(declared_size IS NULL OR declared_size BETWEEN 1 AND 15728640),
  state text NOT NULL CHECK(state IN ('unavailable','quarantine_reserved','quarantined','inspection_pending','passed','rejected','deleted')),quarantine_id uuid,safe_reason text NOT NULL CHECK(length(safe_reason) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK((state='unavailable' AND quarantine_id IS NULL) OR (state<>'unavailable' AND quarantine_id IS NOT NULL)),
  FOREIGN KEY(tenant_id,session_id,requested_by) REFERENCES public.secure_browser_sessions(tenant_id,id,requested_by) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,quarantine_id) REFERENCES public.business_vault_quarantine_uploads(tenant_id,id) ON DELETE RESTRICT
);

CREATE TABLE public.secure_browser_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,session_id uuid REFERENCES public.secure_browser_sessions(id) ON DELETE RESTRICT,actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  receipt_kind text NOT NULL CHECK(receipt_kind IN ('request','control','observation','action','download')),action_kind text NOT NULL CHECK(action_kind ~ '^[a-z][a-z0-9_.-]{1,79}$'),action_fingerprint text NOT NULL CHECK(length(action_fingerprint) BETWEEN 16 AND 128),
  target_origin text CHECK(target_origin IS NULL OR target_origin ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'),authority_grant_id uuid REFERENCES public.paige_authority_grants(id) ON DELETE RESTRICT,authority_act_run_id uuid REFERENCES public.paige_authority_act_runs(id) ON DELETE RESTRICT,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,request_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,result_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,verified_readback jsonb,
  outcome text NOT NULL CHECK(outcome IN ('succeeded','failed','refused','unreachable','outcome_unknown','completed_unrecorded')),idempotency_key uuid NOT NULL,rail_run_id uuid NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,idempotency_key,action_kind),UNIQUE(rail_run_id),CHECK(jsonb_typeof(policy_snapshot)='object' AND jsonb_typeof(request_evidence)='object' AND jsonb_typeof(result_evidence)='object' AND (verified_readback IS NULL OR jsonb_typeof(verified_readback)='object'))
);
CREATE INDEX secure_browser_receipts_tenant_recent_idx ON public.secure_browser_receipts(tenant_id,occurred_at DESC);

ALTER TABLE public.secure_browser_tenant_limits ENABLE ROW LEVEL SECURITY; ALTER TABLE public.secure_browser_tenant_limits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.secure_browser_sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.secure_browser_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.secure_browser_usage_windows ENABLE ROW LEVEL SECURITY; ALTER TABLE public.secure_browser_usage_windows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.secure_browser_connected_accounts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.secure_browser_connected_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.secure_browser_download_intakes ENABLE ROW LEVEL SECURITY; ALTER TABLE public.secure_browser_download_intakes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.secure_browser_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.secure_browser_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.secure_browser_tenant_limits,public.secure_browser_sessions,public.secure_browser_usage_windows,public.secure_browser_connected_accounts,public.secure_browser_download_intakes,public.secure_browser_receipts FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE public.secure_browser_sessions IS 'Paige-owned lifecycle; raw credentials, cookies, HTML, screenshots, replay/live-view URLs and external runtime handles are prohibited.';
COMMENT ON TABLE public.secure_browser_receipts IS 'Append-only detailed receipts. record_capability_run is a separate Rail summary keyed by rail_run_id.';
COMMENT ON TABLE public.secure_browser_connected_accounts IS 'Safe Paige metadata only; no connect/create seam or credential/runtime-handle storage.';
COMMENT ON TABLE public.secure_browser_download_intakes IS 'Future downloads must link to Business Vault quarantine before access; this release records unavailable intake only.';

CREATE FUNCTION public._secure_browser_actor_can_manage(p_actor uuid,p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_actor IS NOT NULL AND p_tenant IS NOT NULL AND (public.is_platform_owner(p_actor)
   OR public.is_tenant_admin_as(p_actor,p_tenant) OR public.agency_can_manage_child(p_tenant,p_actor))
$$;
REVOKE ALL ON FUNCTION public._secure_browser_actor_can_manage(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._secure_browser_actor_can_manage(uuid,uuid) TO service_role;

CREATE FUNCTION public._secure_browser_actor_kind(p_actor uuid,p_tenant uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_role text;v_is_owner boolean;
BEGIN
 IF public.is_platform_owner(p_actor) THEN RETURN 'platform_owner';END IF;
 SELECT tm.role::text,COALESCE(tm.is_owner,false) INTO v_role,v_is_owner
 FROM public.tenant_members tm WHERE tm.tenant_id=p_tenant AND tm.user_id=p_actor AND tm.status='active';
 IF v_role='owner' OR v_is_owner THEN RETURN 'owner';END IF;
 IF v_role='admin' AND public.is_tenant_admin_as(p_actor,p_tenant) THEN RETURN 'admin';END IF;
 IF public.agency_can_manage_child(p_tenant,p_actor) THEN RETURN 'authorized_representative';END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._secure_browser_actor_kind(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._secure_browser_actor_kind(uuid,uuid) TO service_role;

CREATE FUNCTION public._secure_browser_current_actor_tenant()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor uuid:=auth.uid();v_tenant uuid;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'SECURE_BROWSER_SESSION_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT p.active_tenant_id INTO v_tenant FROM public.profiles p WHERE p.user_id=v_actor;
 IF v_tenant IS NULL OR NOT public._secure_browser_actor_can_manage(v_actor,v_tenant) THEN
  RAISE EXCEPTION 'SECURE_BROWSER_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
 RETURN v_tenant;
END $$;
REVOKE ALL ON FUNCTION public._secure_browser_current_actor_tenant() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._secure_browser_current_actor_tenant() TO authenticated;

CREATE FUNCTION public._secure_browser_json_node_safe(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_key text;v_child jsonb;
BEGIN
 IF p_value IS NULL THEN RETURN true;END IF;
 CASE jsonb_typeof(p_value)
  WHEN 'object' THEN
   FOR v_key,v_child IN SELECT e.key,e.value FROM pg_catalog.jsonb_each(p_value) AS e LOOP
    IF v_key ~* '(password|passwd|secret|token|cookie|authorization|html|page_source|screenshot|replay|live.?view|mfa|otp|context.?id|provider)' OR
       NOT public._secure_browser_json_node_safe(v_child) THEN RETURN false;END IF;
   END LOOP;
  WHEN 'array' THEN
   FOR v_child IN SELECT a.value FROM pg_catalog.jsonb_array_elements(p_value) AS a LOOP
    IF NOT public._secure_browser_json_node_safe(v_child) THEN RETURN false;END IF;
   END LOOP;
  WHEN 'string' THEN
   RETURN public._secure_browser_safe_text(p_value #>> '{}');
  ELSE NULL;
 END CASE;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._secure_browser_json_node_safe(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._secure_browser_safe_json(p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_value IS NOT NULL AND jsonb_typeof(p_value)='object' AND public._secure_browser_json_node_safe(p_value)
$$;
REVOKE ALL ON FUNCTION public._secure_browser_safe_json(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._secure_browser_safe_json(jsonb) TO service_role;

CREATE FUNCTION public.secure_browser_download_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_inspection_state text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.session_id<>OLD.session_id OR NEW.requested_by<>OLD.requested_by OR NEW.quarantine_id IS DISTINCT FROM OLD.quarantine_id) THEN
  RAISE EXCEPTION 'SECURE_BROWSER_DOWNLOAD_IDENTITY_IMMUTABLE' USING ERRCODE='42501';
 END IF;
 IF NEW.state<>'unavailable' THEN
  SELECT q.inspection_state INTO v_inspection_state FROM public.business_vault_quarantine_uploads q
   WHERE q.tenant_id=NEW.tenant_id AND q.id=NEW.quarantine_id FOR SHARE;
  IF v_inspection_state IS NULL THEN
   RAISE EXCEPTION 'SECURE_BROWSER_QUARANTINE_TENANT_INVALID' USING ERRCODE='23503';
  ELSIF (NEW.state='quarantine_reserved' AND v_inspection_state<>'reserved') OR
     (NEW.state='quarantined' AND v_inspection_state<>'stored') OR
     (NEW.state='inspection_pending' AND v_inspection_state NOT IN('inspecting','stored')) OR
     (NEW.state='passed' AND v_inspection_state<>'passed') OR
     (NEW.state='rejected' AND v_inspection_state NOT IN('cleanup_pending','deleting')) OR
     (NEW.state='deleted' AND v_inspection_state<>'deleted') THEN
   RAISE EXCEPTION 'SECURE_BROWSER_QUARANTINE_STATE_INVALID' USING ERRCODE='23514';
  END IF;
 END IF;
 NEW.updated_at:=now();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.secure_browser_download_guard() FROM PUBLIC;
CREATE TRIGGER secure_browser_download_guard_trg BEFORE INSERT OR UPDATE ON public.secure_browser_download_intakes FOR EACH ROW EXECUTE FUNCTION public.secure_browser_download_guard();

CREATE FUNCTION public.secure_browser_limits_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.tenant_id<>OLD.tenant_id THEN RAISE EXCEPTION 'SECURE_BROWSER_TENANT_IMMUTABLE';END IF;
 NEW.updated_at:=now();IF TG_OP='UPDATE' THEN NEW.revision:=OLD.revision+1;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.secure_browser_limits_guard() FROM PUBLIC;
CREATE TRIGGER secure_browser_limits_guard_trg BEFORE INSERT OR UPDATE ON public.secure_browser_tenant_limits FOR EACH ROW EXECUTE FUNCTION public.secure_browser_limits_guard();

CREATE FUNCTION public.secure_browser_session_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.requested_by<>OLD.requested_by OR NEW.request_thread_id IS DISTINCT FROM OLD.request_thread_id OR NEW.execution_context_key<>OLD.execution_context_key OR NEW.purpose<>OLD.purpose OR NEW.target_origin<>OLD.target_origin OR NEW.allowed_scope<>OLD.allowed_scope OR NEW.idempotency_key<>OLD.idempotency_key) THEN RAISE EXCEPTION 'SECURE_BROWSER_SESSION_IDENTITY_IMMUTABLE';END IF;
 IF NOT public._secure_browser_safe_json(NEW.allowed_scope) THEN RAISE EXCEPTION 'SECURE_BROWSER_SCOPE_UNSAFE' USING ERRCODE='22023';END IF;
 NEW.updated_at:=now();IF TG_OP='UPDATE' THEN NEW.state_version:=OLD.state_version+1;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.secure_browser_session_guard() FROM PUBLIC;
CREATE TRIGGER secure_browser_session_guard_trg BEFORE INSERT OR UPDATE ON public.secure_browser_sessions FOR EACH ROW EXECUTE FUNCTION public.secure_browser_session_guard();

CREATE FUNCTION public._secure_browser_settle_usage(p_tenant uuid,p_session uuid,p_consumed_seconds integer,p_consumed_cost_microusd bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_session public.secure_browser_sessions;
BEGIN
 SELECT * INTO v_session FROM public.secure_browser_sessions s WHERE s.id=p_session AND s.tenant_id=p_tenant FOR UPDATE;
 IF v_session.id IS NULL THEN RAISE EXCEPTION 'SECURE_BROWSER_SESSION_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF v_session.reservation_settled_at IS NOT NULL THEN RETURN false;END IF;
 IF p_consumed_seconds NOT BETWEEN 0 AND v_session.reserved_seconds OR p_consumed_cost_microusd NOT BETWEEN 0 AND v_session.reserved_cost_microusd THEN
  RAISE EXCEPTION 'SECURE_BROWSER_SETTLEMENT_INVALID' USING ERRCODE='22023';
 END IF;
 UPDATE public.secure_browser_usage_windows SET
  reserved_seconds=GREATEST(0,reserved_seconds-v_session.reserved_seconds),
  reserved_cost_microusd=GREATEST(0,reserved_cost_microusd-v_session.reserved_cost_microusd),
  consumed_seconds=consumed_seconds+p_consumed_seconds,
  consumed_cost_microusd=consumed_cost_microusd+p_consumed_cost_microusd,
  updated_at=now()
 WHERE tenant_id=p_tenant AND (
  (window_kind='day' AND window_start=v_session.created_at::date) OR
  (window_kind='month' AND window_start=date_trunc('month',v_session.created_at)::date)
 );
 UPDATE public.secure_browser_sessions SET reservation_settled_at=now(),consumed_seconds=p_consumed_seconds,consumed_cost_microusd=p_consumed_cost_microusd
 WHERE id=v_session.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._secure_browser_settle_usage(uuid,uuid,integer,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.secure_browser_settle_session_usage(p_tenant uuid,p_session uuid,p_consumed_seconds integer,p_consumed_cost_microusd bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_settled boolean;v_session public.secure_browser_sessions;v_receipt uuid:=gen_random_uuid();v_rail boolean:=false;
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'SECURE_BROWSER_SERVICE_REQUIRED' USING ERRCODE='42501';END IF;
 v_settled:=public._secure_browser_settle_usage(p_tenant,p_session,p_consumed_seconds,p_consumed_cost_microusd);
 SELECT * INTO v_session FROM public.secure_browser_sessions s WHERE s.id=p_session AND s.tenant_id=p_tenant;
 IF v_settled THEN
  INSERT INTO public.secure_browser_receipts(id,tenant_id,session_id,actor_id,receipt_kind,action_kind,action_fingerprint,target_origin,request_evidence,result_evidence,verified_readback,outcome,idempotency_key,rail_run_id)
  VALUES(v_receipt,p_tenant,p_session,v_session.requested_by,'control','usage.settle',md5(p_session::text||':settle'),v_session.target_origin,
   jsonb_build_object('reservedSeconds',v_session.reserved_seconds,'reservedCostMicrousd',v_session.reserved_cost_microusd),
   jsonb_build_object('consumedSeconds',v_session.consumed_seconds,'consumedCostMicrousd',v_session.consumed_cost_microusd),
   jsonb_build_object('settledAt',v_session.reservation_settled_at),'succeeded',p_session,v_receipt);
  BEGIN PERFORM public.record_capability_run(p_tenant,v_session.requested_by,'paige_secure_browser','capability_succeeded',v_receipt,NULL);v_rail:=true;EXCEPTION WHEN OTHERS THEN v_rail:=false;END;
 END IF;
 RETURN jsonb_build_object('sessionId',v_session.id,'settled',v_settled,'settledAt',v_session.reservation_settled_at,'consumedSeconds',v_session.consumed_seconds,'consumedCostMicrousd',v_session.consumed_cost_microusd,'receiptId',CASE WHEN v_settled THEN v_receipt ELSE NULL END,'railEvidence',CASE WHEN v_rail THEN 'recorded' ELSE 'not_recorded' END);
END $$;
REVOKE ALL ON FUNCTION public.secure_browser_settle_session_usage(uuid,uuid,integer,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.secure_browser_settle_session_usage(uuid,uuid,integer,bigint) TO service_role;

CREATE FUNCTION public.secure_browser_receipt_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SECURE_BROWSER_RECEIPTS_APPEND_ONLY' USING ERRCODE='42501';END IF;
 IF NOT public._secure_browser_safe_json(NEW.policy_snapshot) OR NOT public._secure_browser_safe_json(NEW.request_evidence) OR NOT public._secure_browser_safe_json(NEW.result_evidence) OR (NEW.verified_readback IS NOT NULL AND NOT public._secure_browser_safe_json(NEW.verified_readback)) THEN RAISE EXCEPTION 'SECURE_BROWSER_RECEIPT_UNSAFE' USING ERRCODE='22023';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.secure_browser_receipt_guard() FROM PUBLIC;
CREATE TRIGGER secure_browser_receipt_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.secure_browser_receipts FOR EACH ROW EXECUTE FUNCTION public.secure_browser_receipt_guard();

CREATE FUNCTION public._secure_browser_expire_if_due(p_tenant uuid,p_session uuid)
RETURNS public.secure_browser_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_session public.secure_browser_sessions;v_receipt uuid:=gen_random_uuid();v_recorded uuid;
BEGIN
 SELECT * INTO v_session FROM public.secure_browser_sessions s WHERE s.id=p_session AND s.tenant_id=p_tenant FOR UPDATE;
 IF v_session.id IS NULL THEN RETURN NULL;END IF;
 IF v_session.expires_at IS NOT NULL AND v_session.expires_at<=now() AND v_session.state IN('opening','awaiting_owner','owner_control','ready','observing','paused','closing') THEN
  PERFORM public._secure_browser_settle_usage(p_tenant,p_session,0,0);
  UPDATE public.secure_browser_sessions SET state='expired',safe_reason='session_expired' WHERE id=p_session RETURNING * INTO v_session;
  INSERT INTO public.secure_browser_receipts(id,tenant_id,session_id,actor_id,receipt_kind,action_kind,action_fingerprint,target_origin,request_evidence,result_evidence,outcome,idempotency_key,rail_run_id)
  VALUES(v_receipt,p_tenant,p_session,v_session.requested_by,'control','session.expire',md5(p_session::text||':expire'),v_session.target_origin,'{}'::jsonb,jsonb_build_object('state','expired'),'succeeded',p_session,v_receipt)
  ON CONFLICT(tenant_id,idempotency_key,action_kind) DO NOTHING RETURNING id INTO v_recorded;
  IF v_recorded IS NOT NULL THEN
   BEGIN PERFORM public.record_capability_run(p_tenant,v_session.requested_by,'paige_secure_browser','capability_succeeded',v_receipt,NULL);EXCEPTION WHEN OTHERS THEN NULL;END;
  END IF;
 END IF;
 RETURN v_session;
END $$;
REVOKE ALL ON FUNCTION public._secure_browser_expire_if_due(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.configure_secure_browser_limits(p_expected_tenant uuid,p_enabled boolean,p_max_active integer,p_max_session_seconds integer,p_max_daily_seconds integer,p_max_monthly_cost_microusd bigint,p_pause_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid:=public._secure_browser_current_actor_tenant();v_actor uuid:=auth.uid();v_row public.secure_browser_tenant_limits;v_receipt uuid:=gen_random_uuid();v_rail boolean:=false;
BEGIN
 IF p_expected_tenant IS DISTINCT FROM v_tenant OR p_max_active NOT BETWEEN 1 AND 5 OR p_max_session_seconds NOT BETWEEN 60 AND 3600 OR p_max_daily_seconds NOT BETWEEN 60 AND 86400 OR p_max_monthly_cost_microusd<0 THEN RAISE EXCEPTION 'SECURE_BROWSER_LIMITS_INVALID' USING ERRCODE='22023';END IF;
 INSERT INTO public.secure_browser_tenant_limits(tenant_id,enabled,paused_at,pause_reason,max_active_sessions,max_session_seconds,max_daily_session_seconds,max_monthly_cost_microusd,configured_by)
 VALUES(v_tenant,p_enabled,CASE WHEN NULLIF(btrim(COALESCE(p_pause_reason,'')),'') IS NULL THEN NULL ELSE now() END,NULLIF(btrim(COALESCE(p_pause_reason,'')),''),p_max_active,p_max_session_seconds,p_max_daily_seconds,p_max_monthly_cost_microusd,v_actor)
 ON CONFLICT(tenant_id) DO UPDATE SET enabled=EXCLUDED.enabled,paused_at=EXCLUDED.paused_at,pause_reason=EXCLUDED.pause_reason,max_active_sessions=EXCLUDED.max_active_sessions,max_session_seconds=EXCLUDED.max_session_seconds,max_daily_session_seconds=EXCLUDED.max_daily_session_seconds,max_monthly_cost_microusd=EXCLUDED.max_monthly_cost_microusd,configured_by=EXCLUDED.configured_by RETURNING * INTO v_row;
 INSERT INTO public.secure_browser_receipts(id,tenant_id,actor_id,receipt_kind,action_kind,action_fingerprint,policy_snapshot,request_evidence,result_evidence,verified_readback,outcome,idempotency_key,rail_run_id)
 VALUES(v_receipt,v_tenant,v_actor,'control','limits.configure',md5(v_tenant::text||':'||v_row.revision::text),
  jsonb_build_object('authority','workspace_admin'),
  jsonb_build_object('enabled',p_enabled,'paused',p_pause_reason IS NOT NULL,'maxActiveSessions',p_max_active,'maxSessionSeconds',p_max_session_seconds,'maxDailySessionSeconds',p_max_daily_seconds,'maxMonthlyCostMicrousd',p_max_monthly_cost_microusd),
  jsonb_build_object('revision',v_row.revision),jsonb_build_object('revision',v_row.revision,'enabled',v_row.enabled,'paused',v_row.paused_at IS NOT NULL),'succeeded',v_receipt,v_receipt);
 BEGIN
  PERFORM public.record_capability_run(v_tenant,v_actor,'paige_secure_browser','capability_succeeded',v_receipt,NULL);
  v_rail:=true;
 EXCEPTION WHEN OTHERS THEN v_rail:=false;
 END;
 RETURN jsonb_build_object('enabled',v_row.enabled,'paused',v_row.paused_at IS NOT NULL,'maxActiveSessions',v_row.max_active_sessions,'maxSessionSeconds',v_row.max_session_seconds,'maxDailySessionSeconds',v_row.max_daily_session_seconds,'maxMonthlyCostMicrousd',v_row.max_monthly_cost_microusd,'revision',v_row.revision,'receiptId',v_receipt,'railEvidence',CASE WHEN v_rail THEN 'recorded' ELSE 'not_recorded' END);
END $$;
REVOKE ALL ON FUNCTION public.configure_secure_browser_limits(uuid,boolean,integer,integer,integer,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_secure_browser_limits(uuid,boolean,integer,integer,integer,bigint,text) TO authenticated;

CREATE FUNCTION public.secure_browser_request_unavailable(p_tenant uuid,p_actor uuid,p_actor_kind text,p_thread uuid,p_purpose text,p_target_origin text,p_target_display_host text,p_scope jsonb,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_session public.secure_browser_sessions;v_limits public.secure_browser_tenant_limits;v_receipt uuid;v_reason text:='worker_under_setup';v_features jsonb;
BEGIN
 IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'SECURE_BROWSER_SERVICE_REQUIRED' USING ERRCODE='42501';END IF;
 IF NOT public._secure_browser_actor_can_manage(p_actor,p_tenant) THEN RAISE EXCEPTION 'SECURE_BROWSER_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
 IF p_actor_kind IS DISTINCT FROM public._secure_browser_actor_kind(p_actor,p_tenant) THEN RAISE EXCEPTION 'SECURE_BROWSER_ACTOR_KIND_INVALID' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paige_chat_threads t WHERE t.id=p_thread AND t.tenant_id=p_tenant AND t.caller_user_id=p_actor AND t.lens='coach' AND t.contact_id IS NULL) THEN RAISE EXCEPTION 'SECURE_BROWSER_THREAD_INVALID' USING ERRCODE='42501';END IF;
 IF length(btrim(COALESCE(p_purpose,''))) NOT BETWEEN 3 AND 1000 OR NOT public._secure_browser_safe_text(p_purpose) OR p_target_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' OR p_target_display_host !~ '^[A-Za-z0-9.-]+$' OR NOT public._secure_browser_safe_json(p_scope) THEN RAISE EXCEPTION 'SECURE_BROWSER_REQUEST_INVALID' USING ERRCODE='22023';END IF;
 SELECT COALESCE(t.features,'{}'::jsonb) INTO v_features FROM public.tenants t WHERE t.id=p_tenant FOR SHARE;
 IF COALESCE((v_features->>'secure_browser')::boolean,false) IS NOT TRUE THEN v_reason:='feature_not_enabled';END IF;
 SELECT * INTO v_limits FROM public.secure_browser_tenant_limits l WHERE l.tenant_id=p_tenant FOR UPDATE;
 IF v_limits.tenant_id IS NULL OR v_limits.enabled IS NOT TRUE THEN v_reason:='limits_not_configured';ELSIF v_limits.paused_at IS NOT NULL THEN v_reason:='workspace_paused';END IF;
 INSERT INTO public.secure_browser_sessions(tenant_id,requested_by,actor_kind,request_thread_id,execution_context_key,purpose,target_origin,target_display_host,allowed_scope,authority_state,state,safe_reason,idempotency_key)
 VALUES(p_tenant,p_actor,p_actor_kind,p_thread,'thread:'||p_thread::text,btrim(p_purpose),p_target_origin,lower(p_target_display_host),p_scope,'authorized','unavailable',v_reason,p_idempotency_key)
 ON CONFLICT(tenant_id,requested_by,idempotency_key) DO NOTHING RETURNING * INTO v_session;
 IF v_session.id IS NULL THEN
  SELECT * INTO v_session FROM public.secure_browser_sessions s WHERE s.tenant_id=p_tenant AND s.requested_by=p_actor AND s.idempotency_key=p_idempotency_key;
 END IF;
 v_receipt:=gen_random_uuid();
 INSERT INTO public.secure_browser_receipts(id,tenant_id,session_id,actor_id,receipt_kind,action_kind,action_fingerprint,target_origin,policy_snapshot,request_evidence,result_evidence,outcome,idempotency_key,rail_run_id)
 VALUES(v_receipt,p_tenant,v_session.id,p_actor,'request','session.request',md5(p_tenant::text||':'||p_actor::text||':'||p_idempotency_key::text),p_target_origin,
  jsonb_build_object('authority','authorized','limitsConfigured',v_limits.tenant_id IS NOT NULL,'limitsEnabled',COALESCE(v_limits.enabled,false),'workspacePaused',v_limits.paused_at IS NOT NULL),
  jsonb_build_object('purpose',v_session.purpose,'targetOrigin',v_session.target_origin,'scope',v_session.allowed_scope,'threadId',v_session.request_thread_id),
  jsonb_build_object('state','unavailable','reason',v_reason),'unreachable',p_idempotency_key,v_receipt)
 ON CONFLICT(tenant_id,idempotency_key,action_kind) DO NOTHING;
 SELECT r.id INTO v_receipt FROM public.secure_browser_receipts r WHERE r.tenant_id=p_tenant AND r.idempotency_key=p_idempotency_key AND r.action_kind='session.request';
 RETURN jsonb_build_object('session',jsonb_build_object('id',v_session.id,'threadId',v_session.request_thread_id,'purpose',v_session.purpose,'targetOrigin',v_session.target_origin,'targetDisplayHost',v_session.target_display_host,'scope',v_session.allowed_scope,'authority',v_session.authority_state,'state',v_session.state,'stateVersion',v_session.state_version,'safeReason',v_session.safe_reason,'expiresAt',v_session.expires_at,'createdAt',v_session.created_at,'updatedAt',v_session.updated_at),'receiptId',v_receipt,'status','unavailable','reason',v_reason);
END $$;
REVOKE ALL ON FUNCTION public.secure_browser_request_unavailable(uuid,uuid,text,uuid,text,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.secure_browser_request_unavailable(uuid,uuid,text,uuid,text,text,text,jsonb,uuid) TO service_role;

CREATE FUNCTION public.secure_browser_reserve_session(
 p_tenant uuid,p_actor uuid,p_actor_kind text,p_thread uuid,p_purpose text,p_target_origin text,
 p_target_display_host text,p_scope jsonb,p_idempotency_key uuid,p_reserved_seconds integer,
 p_reserved_cost_microusd bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_limits public.secure_browser_tenant_limits;v_session public.secure_browser_sessions;
 v_day public.secure_browser_usage_windows;v_month public.secure_browser_usage_windows;v_active integer;
BEGIN
 IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'SECURE_BROWSER_SERVICE_REQUIRED' USING ERRCODE='42501';END IF;
 IF NOT public._secure_browser_actor_can_manage(p_actor,p_tenant) THEN RAISE EXCEPTION 'SECURE_BROWSER_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
 IF p_actor_kind IS DISTINCT FROM public._secure_browser_actor_kind(p_actor,p_tenant) OR
    NOT EXISTS(SELECT 1 FROM public.paige_chat_threads t WHERE t.id=p_thread AND t.tenant_id=p_tenant AND t.caller_user_id=p_actor AND t.lens='coach' AND t.contact_id IS NULL) THEN
  RAISE EXCEPTION 'SECURE_BROWSER_REQUEST_INVALID' USING ERRCODE='42501';
 END IF;
 IF length(btrim(COALESCE(p_purpose,''))) NOT BETWEEN 3 AND 1000 OR NOT public._secure_browser_safe_text(p_purpose) OR
    p_target_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' OR
    p_target_display_host !~ '^[A-Za-z0-9.-]+$' OR NOT public._secure_browser_safe_json(p_scope) THEN
  RAISE EXCEPTION 'SECURE_BROWSER_REQUEST_INVALID' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_session FROM public.secure_browser_sessions s WHERE s.tenant_id=p_tenant AND s.requested_by=p_actor AND s.idempotency_key=p_idempotency_key;
 IF v_session.id IS NOT NULL THEN
  RETURN jsonb_build_object('sessionId',v_session.id,'state',v_session.state,'stateVersion',v_session.state_version,'expiresAt',v_session.expires_at,'idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant AND COALESCE((t.features->>'secure_browser')::boolean,false)) THEN
  RAISE EXCEPTION 'SECURE_BROWSER_FEATURE_DISABLED' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_limits FROM public.secure_browser_tenant_limits l WHERE l.tenant_id=p_tenant FOR UPDATE;
 IF v_limits.tenant_id IS NULL OR NOT v_limits.enabled OR v_limits.paused_at IS NOT NULL OR NOT v_limits.worker_available THEN
  RAISE EXCEPTION 'SECURE_BROWSER_WORKER_UNAVAILABLE' USING ERRCODE='55000';
 END IF;
 IF p_reserved_seconds NOT BETWEEN 60 AND v_limits.max_session_seconds OR p_reserved_cost_microusd<0 THEN
  RAISE EXCEPTION 'SECURE_BROWSER_RESERVATION_INVALID' USING ERRCODE='22023';
 END IF;
 SELECT count(*) INTO v_active FROM public.secure_browser_sessions s WHERE s.tenant_id=p_tenant AND s.state IN ('opening','awaiting_owner','owner_control','ready','observing','paused','closing');
 IF v_active>=v_limits.max_active_sessions THEN RAISE EXCEPTION 'SECURE_BROWSER_CONCURRENCY_EXHAUSTED' USING ERRCODE='55000';END IF;
 INSERT INTO public.secure_browser_usage_windows(tenant_id,window_kind,window_start) VALUES
  (p_tenant,'day',current_date),(p_tenant,'month',date_trunc('month',current_date)::date)
 ON CONFLICT DO NOTHING;
 SELECT * INTO v_day FROM public.secure_browser_usage_windows w WHERE w.tenant_id=p_tenant AND w.window_kind='day' AND w.window_start=current_date FOR UPDATE;
 SELECT * INTO v_month FROM public.secure_browser_usage_windows w WHERE w.tenant_id=p_tenant AND w.window_kind='month' AND w.window_start=date_trunc('month',current_date)::date FOR UPDATE;
 IF v_day.reserved_seconds+v_day.consumed_seconds+p_reserved_seconds>v_limits.max_daily_session_seconds OR
    v_month.reserved_cost_microusd+v_month.consumed_cost_microusd+p_reserved_cost_microusd>v_limits.max_monthly_cost_microusd THEN
  RAISE EXCEPTION 'SECURE_BROWSER_BUDGET_EXHAUSTED' USING ERRCODE='55000';
 END IF;
 INSERT INTO public.secure_browser_sessions(tenant_id,requested_by,actor_kind,request_thread_id,execution_context_key,purpose,target_origin,target_display_host,allowed_scope,authority_state,state,safe_reason,idempotency_key,reserved_seconds,reserved_cost_microusd,expires_at)
 VALUES(p_tenant,p_actor,p_actor_kind,p_thread,'thread:'||p_thread::text,btrim(p_purpose),p_target_origin,lower(p_target_display_host),p_scope,'authorized','opening','capacity_reserved',p_idempotency_key,p_reserved_seconds,p_reserved_cost_microusd,now()+make_interval(secs=>p_reserved_seconds))
 ON CONFLICT(tenant_id,requested_by,idempotency_key) DO NOTHING RETURNING * INTO v_session;
 IF v_session.id IS NULL THEN
  SELECT * INTO v_session FROM public.secure_browser_sessions s WHERE s.tenant_id=p_tenant AND s.requested_by=p_actor AND s.idempotency_key=p_idempotency_key;
  RETURN jsonb_build_object('sessionId',v_session.id,'state',v_session.state,'stateVersion',v_session.state_version,'expiresAt',v_session.expires_at,'idempotent',true);
 END IF;
 UPDATE public.secure_browser_usage_windows SET reserved_seconds=reserved_seconds+p_reserved_seconds,reserved_cost_microusd=reserved_cost_microusd+p_reserved_cost_microusd,updated_at=now()
 WHERE tenant_id=p_tenant AND ((window_kind='day' AND window_start=current_date) OR (window_kind='month' AND window_start=date_trunc('month',current_date)::date));
 RETURN jsonb_build_object('sessionId',v_session.id,'state',v_session.state,'stateVersion',v_session.state_version,'expiresAt',v_session.expires_at,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.secure_browser_reserve_session(uuid,uuid,text,uuid,text,text,text,jsonb,uuid,integer,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.secure_browser_reserve_session(uuid,uuid,text,uuid,text,text,text,jsonb,uuid,integer,bigint) TO service_role;

CREATE FUNCTION public.get_secure_browser_session(p_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid:=public._secure_browser_current_actor_tenant();v_actor uuid:=auth.uid();v_session public.secure_browser_sessions;
BEGIN
 PERFORM public._secure_browser_expire_if_due(v_tenant,p_session);
 SELECT * INTO v_session FROM public.secure_browser_sessions s WHERE s.id=p_session AND s.tenant_id=v_tenant AND (s.requested_by=v_actor OR public.is_tenant_admin_as(v_actor,v_tenant) OR public.is_platform_owner(v_actor));
 IF v_session.id IS NULL THEN RAISE EXCEPTION 'SECURE_BROWSER_SESSION_UNAVAILABLE' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('id',v_session.id,'threadId',v_session.request_thread_id,'purpose',v_session.purpose,'targetOrigin',v_session.target_origin,'targetDisplayHost',v_session.target_display_host,'scope',v_session.allowed_scope,'authority',v_session.authority_state,'state',v_session.state,'stateVersion',v_session.state_version,'safeReason',v_session.safe_reason,'expiresAt',v_session.expires_at,'createdAt',v_session.created_at,'updatedAt',v_session.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.get_secure_browser_session(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_secure_browser_session(uuid) TO authenticated;

CREATE FUNCTION public.control_secure_browser_session(p_session uuid,p_command text,p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid:=public._secure_browser_current_actor_tenant();v_actor uuid:=auth.uid();v_session public.secure_browser_sessions;v_receipt uuid:=gen_random_uuid();v_next text;v_recorded_receipt uuid;v_rail boolean:=false;
BEGIN
 IF p_command NOT IN ('pause','resume','close','revoke') THEN RAISE EXCEPTION 'SECURE_BROWSER_COMMAND_INVALID' USING ERRCODE='22023';END IF;
 PERFORM public._secure_browser_expire_if_due(v_tenant,p_session);
 SELECT * INTO v_session FROM public.secure_browser_sessions s WHERE s.id=p_session AND s.tenant_id=v_tenant FOR UPDATE;
 IF v_session.id IS NULL OR (v_session.requested_by<>v_actor AND NOT public.is_tenant_admin_as(v_actor,v_tenant) AND NOT public.is_platform_owner(v_actor)) THEN RAISE EXCEPTION 'SECURE_BROWSER_SESSION_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF v_session.state_version<>p_expected_version THEN RAISE EXCEPTION 'SECURE_BROWSER_STALE' USING ERRCODE='40001';END IF;
 v_next:=CASE p_command WHEN 'close' THEN 'closed' WHEN 'revoke' THEN 'revoked' WHEN 'pause' THEN 'paused' ELSE 'ready' END;
 IF p_command='close' AND v_session.state IN ('closed','revoked','expired') THEN v_next:=v_session.state;
 ELSIF p_command='revoke' AND v_session.state IN ('revoked','expired') THEN v_next:=v_session.state;
 ELSIF p_command='pause' AND v_session.state NOT IN ('ready','observing') THEN RAISE EXCEPTION 'SECURE_BROWSER_TRANSITION_INVALID' USING ERRCODE='22023';
 ELSIF p_command='resume' AND v_session.state<>'paused' THEN RAISE EXCEPTION 'SECURE_BROWSER_TRANSITION_INVALID' USING ERRCODE='22023';END IF;
 IF v_next IS DISTINCT FROM v_session.state THEN
  IF v_next IN('closed','revoked') THEN PERFORM public._secure_browser_settle_usage(v_tenant,v_session.id,0,0);END IF;
  UPDATE public.secure_browser_sessions SET state=v_next,safe_reason=p_command,paused_at=CASE WHEN v_next='paused' THEN now() WHEN p_command='resume' THEN NULL ELSE paused_at END,closed_at=CASE WHEN v_next='closed' THEN now() ELSE closed_at END,revoked_at=CASE WHEN v_next='revoked' THEN now() ELSE revoked_at END WHERE id=v_session.id RETURNING * INTO v_session;
  INSERT INTO public.secure_browser_receipts(id,tenant_id,session_id,actor_id,receipt_kind,action_kind,action_fingerprint,target_origin,request_evidence,result_evidence,outcome,idempotency_key,rail_run_id)
  VALUES(v_receipt,v_tenant,v_session.id,v_actor,'control','session.'||p_command,md5(v_session.id::text||':'||p_command||':'||v_session.state_version::text),v_session.target_origin,jsonb_build_object('expectedVersion',p_expected_version),jsonb_build_object('state',v_session.state,'usageSettled',v_session.reservation_settled_at IS NOT NULL,'consumedSeconds',v_session.consumed_seconds,'consumedCostMicrousd',v_session.consumed_cost_microusd),'succeeded',v_receipt,v_receipt);
  v_recorded_receipt:=v_receipt;
  BEGIN
   PERFORM public.record_capability_run(v_tenant,v_actor,'paige_secure_browser','capability_succeeded',v_receipt,NULL);
   v_rail:=true;
  EXCEPTION WHEN OTHERS THEN v_rail:=false;
  END;
 END IF;
 RETURN jsonb_build_object('session',public.get_secure_browser_session(v_session.id),'receiptId',v_recorded_receipt,'railEvidence',CASE WHEN v_rail THEN 'recorded' ELSE 'not_recorded' END);
END $$;
REVOKE ALL ON FUNCTION public.control_secure_browser_session(uuid,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.control_secure_browser_session(uuid,text,bigint) TO authenticated;

CREATE FUNCTION public._secure_browser_expire_connected_accounts(p_tenant uuid,p_actor uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_account public.secure_browser_connected_accounts;v_receipt uuid;v_recorded uuid;v_count integer:=0;
BEGIN
 FOR v_account IN
  UPDATE public.secure_browser_connected_accounts SET state='expired',updated_at=now()
  WHERE tenant_id=p_tenant AND state IN('active','paused') AND expires_at IS NOT NULL AND expires_at<=now()
  RETURNING *
 LOOP
  v_receipt:=gen_random_uuid();v_recorded:=NULL;
  INSERT INTO public.secure_browser_receipts(id,tenant_id,actor_id,receipt_kind,action_kind,action_fingerprint,target_origin,policy_snapshot,request_evidence,result_evidence,verified_readback,outcome,idempotency_key,rail_run_id)
  VALUES(v_receipt,p_tenant,p_actor,'control','account.expire',md5(v_account.id::text||':expire:'||v_account.expires_at::text),v_account.target_origin,
   jsonb_build_object('cause','time_bound_expiry'),jsonb_build_object('accountId',v_account.id,'expiresAt',v_account.expires_at),
   jsonb_build_object('state','expired'),jsonb_build_object('accountId',v_account.id,'state','expired'),'succeeded',v_account.id,v_receipt)
  ON CONFLICT(tenant_id,idempotency_key,action_kind) DO NOTHING RETURNING id INTO v_recorded;
  IF v_recorded IS NOT NULL THEN
   v_count:=v_count+1;
   BEGIN
    PERFORM public.record_capability_run(p_tenant,p_actor,'paige_secure_browser','capability_succeeded',v_recorded,NULL);
   EXCEPTION WHEN OTHERS THEN NULL;
   END;
  END IF;
 END LOOP;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public._secure_browser_expire_connected_accounts(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.list_secure_browser_connected_accounts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid:=public._secure_browser_current_actor_tenant();v_actor uuid:=auth.uid();
BEGIN
 PERFORM public._secure_browser_expire_connected_accounts(v_tenant,v_actor);
 RETURN COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
   'id',a.id,'label',a.label,'targetOrigin',a.target_origin,'targetDisplayHost',a.target_display_host,
   'state',a.state,'permittedScope',a.permitted_scope,'expiresAt',a.expires_at,
   'lastUsedAt',a.last_used_at,'createdAt',a.created_at,'updatedAt',a.updated_at
  ) ORDER BY a.created_at DESC)
  FROM public.secure_browser_connected_accounts a
  WHERE a.tenant_id=v_tenant AND a.state<>'deleted'
 ),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_secure_browser_connected_accounts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_secure_browser_connected_accounts() TO authenticated;

CREATE FUNCTION public.control_secure_browser_connected_account(p_account uuid,p_command text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid:=public._secure_browser_current_actor_tenant();v_actor uuid:=auth.uid();v_account public.secure_browser_connected_accounts;v_receipt uuid:=gen_random_uuid();v_rail boolean:=false;
BEGIN
 IF p_command NOT IN ('pause','revoke','delete') THEN RAISE EXCEPTION 'SECURE_BROWSER_ACCOUNT_COMMAND_INVALID' USING ERRCODE='22023';END IF;
 PERFORM public._secure_browser_expire_connected_accounts(v_tenant,v_actor);
 SELECT * INTO v_account FROM public.secure_browser_connected_accounts a WHERE a.id=p_account AND a.tenant_id=v_tenant FOR UPDATE;
 IF v_account.id IS NULL THEN RAISE EXCEPTION 'SECURE_BROWSER_ACCOUNT_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF v_account.state='deleted' THEN RAISE EXCEPTION 'SECURE_BROWSER_ACCOUNT_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF p_command='pause' AND v_account.state='expired' THEN RAISE EXCEPTION 'SECURE_BROWSER_ACCOUNT_EXPIRED' USING ERRCODE='22023';END IF;
 UPDATE public.secure_browser_connected_accounts SET
  state=CASE p_command WHEN 'pause' THEN 'paused' WHEN 'revoke' THEN 'revoked' ELSE 'deleted' END,
  paused_at=CASE WHEN p_command='pause' THEN now() ELSE paused_at END,
  revoked_at=CASE WHEN p_command='revoke' THEN now() ELSE revoked_at END,
  deleted_at=CASE WHEN p_command='delete' THEN now() ELSE deleted_at END,
  updated_at=now()
 WHERE id=v_account.id RETURNING * INTO v_account;
 INSERT INTO public.secure_browser_receipts(id,tenant_id,actor_id,receipt_kind,action_kind,action_fingerprint,target_origin,policy_snapshot,request_evidence,result_evidence,verified_readback,outcome,idempotency_key,rail_run_id)
 VALUES(v_receipt,v_tenant,v_actor,'control','account.'||p_command,md5(v_account.id::text||':'||p_command||':'||v_account.updated_at::text),v_account.target_origin,
  jsonb_build_object('authority','workspace_admin'),jsonb_build_object('accountId',v_account.id,'command',p_command),
  jsonb_build_object('state',v_account.state),jsonb_build_object('accountId',v_account.id,'state',v_account.state),'succeeded',v_receipt,v_receipt);
 BEGIN
  PERFORM public.record_capability_run(v_tenant,v_actor,'paige_secure_browser','capability_succeeded',v_receipt,NULL);
  v_rail:=true;
 EXCEPTION WHEN OTHERS THEN v_rail:=false;
 END;
 RETURN jsonb_build_object('account',jsonb_build_object('id',v_account.id,'label',v_account.label,'targetOrigin',v_account.target_origin,'targetDisplayHost',v_account.target_display_host,'state',v_account.state,'expiresAt',v_account.expires_at,'lastUsedAt',v_account.last_used_at,'updatedAt',v_account.updated_at),'receiptId',v_receipt,'railEvidence',CASE WHEN v_rail THEN 'recorded' ELSE 'not_recorded' END);
END $$;
REVOKE ALL ON FUNCTION public.control_secure_browser_connected_account(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.control_secure_browser_connected_account(uuid,text) TO authenticated;

CREATE FUNCTION public.list_secure_browser_receipts(p_session uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_tenant uuid:=public._secure_browser_current_actor_tenant();
BEGIN
 RETURN COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
   'id',r.id,'sessionId',r.session_id,'kind',r.receipt_kind,'action',r.action_kind,
   'targetOrigin',r.target_origin,'authorityGrantId',r.authority_grant_id,
   'authorityActRunId',r.authority_act_run_id,'policy',r.policy_snapshot,
   'request',r.request_evidence,'result',r.result_evidence,'verifiedReadback',r.verified_readback,
   'outcome',r.outcome,'railRunId',r.rail_run_id,'occurredAt',r.occurred_at
  ) ORDER BY r.occurred_at DESC)
  FROM public.secure_browser_receipts r
  WHERE r.tenant_id=v_tenant AND (p_session IS NULL OR r.session_id=p_session)
 ),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_secure_browser_receipts(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_secure_browser_receipts(uuid) TO authenticated;

CREATE FUNCTION public.secure_browser_refuse_download_intake(
 p_tenant uuid,p_actor uuid,p_session uuid,p_safe_filename text,p_declared_mime text,
 p_declared_size bigint,p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_session public.secure_browser_sessions;v_intake public.secure_browser_download_intakes;v_receipt uuid;v_rail boolean:=false;
BEGIN
 IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'SECURE_BROWSER_SERVICE_REQUIRED' USING ERRCODE='42501';END IF;
 IF NOT public._secure_browser_actor_can_manage(p_actor,p_tenant) THEN RAISE EXCEPTION 'SECURE_BROWSER_NOT_AUTHORIZED' USING ERRCODE='42501';END IF;
 SELECT * INTO v_session FROM public.secure_browser_sessions s WHERE s.id=p_session AND s.tenant_id=p_tenant AND s.requested_by=p_actor;
 IF v_session.id IS NULL THEN RAISE EXCEPTION 'SECURE_BROWSER_SESSION_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF p_safe_filename IS NOT NULL AND (length(btrim(p_safe_filename)) NOT BETWEEN 1 AND 180 OR p_safe_filename ~ '[\\/]') THEN RAISE EXCEPTION 'SECURE_BROWSER_DOWNLOAD_METADATA_INVALID' USING ERRCODE='22023';END IF;
 IF p_declared_mime IS NOT NULL AND length(p_declared_mime) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'SECURE_BROWSER_DOWNLOAD_METADATA_INVALID' USING ERRCODE='22023';END IF;
 IF p_declared_size IS NOT NULL AND p_declared_size NOT BETWEEN 1 AND 15728640 THEN RAISE EXCEPTION 'SECURE_BROWSER_DOWNLOAD_METADATA_INVALID' USING ERRCODE='22023';END IF;
 INSERT INTO public.secure_browser_download_intakes(tenant_id,session_id,requested_by,safe_filename,declared_mime,declared_size,state,safe_reason)
 VALUES(p_tenant,p_session,p_actor,NULLIF(btrim(COALESCE(p_safe_filename,'')),''),p_declared_mime,p_declared_size,'unavailable','quarantine_ingress_not_configured')
 RETURNING * INTO v_intake;
 v_receipt:=gen_random_uuid();
 INSERT INTO public.secure_browser_receipts(id,tenant_id,session_id,actor_id,receipt_kind,action_kind,action_fingerprint,target_origin,policy_snapshot,request_evidence,result_evidence,outcome,idempotency_key,rail_run_id)
 VALUES(v_receipt,p_tenant,p_session,p_actor,'download','download.intake',md5(p_session::text||':'||p_idempotency_key::text),v_session.target_origin,
  jsonb_build_object('downloads','quarantine_only','accessBeforeInspection',false),
  jsonb_build_object('safeFilename',v_intake.safe_filename,'declaredMime',v_intake.declared_mime,'declaredSize',v_intake.declared_size),
  jsonb_build_object('state','unavailable','reason',v_intake.safe_reason),'refused',p_idempotency_key,v_receipt);
 BEGIN
  PERFORM public.record_capability_run(p_tenant,p_actor,'paige_secure_browser','capability_refused',v_receipt,NULL);
  v_rail:=true;
 EXCEPTION WHEN OTHERS THEN v_rail:=false;
 END;
 RETURN jsonb_build_object('intakeId',v_intake.id,'receiptId',v_receipt,'state','unavailable','reason',v_intake.safe_reason,'railEvidence',CASE WHEN v_rail THEN 'recorded' ELSE 'not_recorded' END);
END $$;
REVOKE ALL ON FUNCTION public.secure_browser_refuse_download_intake(uuid,uuid,uuid,text,text,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.secure_browser_refuse_download_intake(uuid,uuid,uuid,text,text,bigint,uuid) TO service_role;
