-- CLI-created E09 forward repair. Same canonical response/action/audit/Rail writer;
-- add current relationship, locked action version and closed-state checks before effects.
-- Old three-argument callers receive VERSION_REQUIRED and can reload the new web;
-- they never silently approve an action whose viewed version was not supplied.
BEGIN;
DO $e09_actions$
DECLARE
  _def text := pg_get_functiondef('public.customer_respond_to_action(uuid,text,text)'::regprocedure);
  _existing oid := to_regprocedure('public.customer_respond_to_action(uuid,text,text,timestamp with time zone)');
  _old_header text := 'p_response_text text DEFAULT NULL::text)';
  _old_read text := 'SELECT * INTO v_action FROM public.paige_customer_actions WHERE id = p_action_id;';
  _old_owner text := 'SELECT linked_user_id INTO v_owner FROM public.clients WHERE id = v_action.contact_id;';
BEGIN
  IF _existing IS NOT NULL THEN
    IF strpos(pg_get_functiondef(_existing),'E09_CUSTOMER_ACTION_SCOPE_V1')=0 THEN
      RAISE EXCEPTION 'customer action response overload changed; reconcile before release';
    END IF;
    RETURN;
  END IF;
  -- The recorded production and reconstructed full-schema predecessors differ
  -- only in two STEP 4 comments; both exact definitions were reconciled.
  IF md5(_def) NOT IN ('17868b60f3725f0b863705c59b9f4c07','1be5e25443930bcb013a71b001743b66')
    OR strpos(_def,_old_header)=0 OR strpos(_def,_old_read)=0 OR strpos(_def,_old_owner)=0 THEN
    RAISE EXCEPTION 'customer response predecessor changed; reconcile before release';
  END IF;
  _def:=replace(_def,_old_header,'p_response_text text, p_expected_updated_at timestamp with time zone)');
  _def:=replace(_def,_old_read,
    'SELECT * INTO v_action FROM public.paige_customer_actions WHERE id = p_action_id FOR UPDATE;');
  _def:=replace(_def,_old_owner,$guard$
  -- E09_CUSTOMER_ACTION_SCOPE_V1: locks serialize replies and access suspension.
  SELECT c.linked_user_id INTO v_owner
  FROM public.clients c JOIN public.tenants t ON t.id=c.tenant_id
  WHERE c.id=v_action.contact_id AND c.tenant_id=v_action.tenant_id
    AND c.linked_user_id=v_uid AND c.status='active'
    AND c.merged_into_contact_id IS NULL AND t.status='active'
    AND c.id=public.client_portal_relationship_id(v_action.tenant_id)
  FOR SHARE OF c,t;
  $guard$);
  _def:=replace(_def,
    'IF v_action.status = ''expired'' OR v_action.expires_at < now() THEN',
    $checks$IF p_expected_updated_at IS NULL OR v_action.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok',false,'error','ACTION_VERSION_CONFLICT');
  END IF;
  IF v_action.status NOT IN ('proposed','customer_notified') THEN
    RETURN jsonb_build_object('ok',false,'error','ACTION_CLOSED');
  END IF;
  IF p_response_type='question' AND (NULLIF(btrim(p_response_text),'') IS NULL OR length(p_response_text)>4000) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_RESPONSE_TEXT');
  END IF;
  IF v_action.status = 'expired' OR v_action.expires_at <= now() THEN$checks$);
  _def:=replace(_def,$old$IF p_response_type NOT IN ('accepted','declined','question','completed') THEN$old$,
    $new$IF p_response_type IS NULL OR p_response_type NOT IN ('accepted','declined','question','completed') THEN$new$);
  _def:=replace(_def,'SET search_path TO ''public''','SET search_path TO ''public'', ''pg_temp''');
  IF strpos(_def,'ACTION_VERSION_CONFLICT')=0 OR strpos(_def,'E09_CUSTOMER_ACTION_SCOPE_V1')=0 THEN
    RAISE EXCEPTION 'customer response patch was not fully composed';
  END IF;
  EXECUTE _def;
END;
$e09_actions$;

-- Compatibility refusal has no domain side effects. The sole effectful writer is
-- the versioned overload composed above, with the incumbent notification/audit/Rail body.
CREATE OR REPLACE FUNCTION public.customer_respond_to_action(p_action_id uuid,p_response_type text,p_response_text text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp
AS $$ SELECT jsonb_build_object('ok',false,'error','VERSION_REQUIRED') $$;
REVOKE ALL ON FUNCTION public.customer_respond_to_action(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.customer_respond_to_action(uuid,text,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.customer_respond_to_action(uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.customer_respond_to_action(uuid,text,text,timestamptz) TO authenticated,service_role;
COMMENT ON FUNCTION public.customer_respond_to_action(uuid,text,text,timestamptz) IS
  'Existing customer response writer with active relationship, exact loaded action version and locked open-state checks. Canonical response/audit/notification and incumbent Rail behavior retained.';
COMMIT;
