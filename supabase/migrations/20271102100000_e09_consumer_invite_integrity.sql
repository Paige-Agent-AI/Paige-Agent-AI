-- E09: recipient-bound, exact-contact, single-use consumer invitations.
-- Created with Supabase CLI; moved above the verified production/pending frontier.
-- Existing staff/agency/owner branches and the staff workspace guard are preserved.
-- This is a narrow forward repair, not complete portal membership or AI activation.
DO $e09_consumer_invite$
DECLARE
  _def text := pg_catalog.pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure);
  _start integer;
  _end integer;
  _old text;
  _consumer text := $consumer$  IF _tok.kind = 'consumer' THEN
    -- E09_CONSUMER_INVITE_INTEGRITY_V1
    SELECT email, email_confirmed_at INTO _email, _email_confirmed_at
      FROM auth.users WHERE id = _uid;
    IF NULLIF(btrim(_tok.email), '') IS NULL
       OR _email_confirmed_at IS NULL
       OR NULLIF(btrim(_email), '') IS NULL
       OR lower(btrim(_tok.email)) <> lower(btrim(_email)) THEN
      RAISE EXCEPTION 'portal invitation belongs to a different verified recipient' USING ERRCODE = '42501';
    END IF;
    -- Historic consumer invites may have max_uses=NULL. They still grant once.
    IF COALESCE(_tok.uses, 0) <> 0 OR _tok.last_used_at IS NOT NULL THEN
      RAISE EXCEPTION 'portal invitation has already been accepted' USING ERRCODE = '42501';
    END IF;
    IF _tok.contact_id IS NULL THEN
      RAISE EXCEPTION 'portal invitation requires an explicit client relationship' USING ERRCODE = '42501';
    END IF;

    -- Lock the exact canonical contact; never fall back to another contact or
    -- create a duplicate CRM record when the invite binding is stale.
    SELECT c.id INTO _client_id FROM public.clients c
      WHERE c.id = _tok.contact_id AND c.tenant_id = _tok.tenant_id
        AND c.status = 'active' AND c.merged_into_contact_id IS NULL
        AND (c.linked_user_id IS NULL OR c.linked_user_id = _uid)
        AND EXISTS (SELECT 1 FROM public.client_contact_methods cm
          WHERE cm.client_id = c.id AND cm.tenant_id = c.tenant_id AND cm.kind = 'email'
            AND cm.match_key = public.contact_method_match_key('email', _tok.email))
      FOR UPDATE OF c;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal invitation client relationship is no longer available' USING ERRCODE = '42501';
    END IF;
    -- Preserve the current single-tenant restriction until the coordinated
    -- relationship/switch slice removes the global unique constraint safely.
    IF EXISTS (SELECT 1 FROM public.clients c
      WHERE c.linked_user_id = _uid AND c.id <> _client_id) THEN
      RAISE EXCEPTION 'portal identity requires relationship access reconciliation' USING ERRCODE = '42501';
    END IF;

    UPDATE public.clients SET linked_user_id = _uid,
      onboarding_stage = COALESCE(onboarding_stage, 'invited'), updated_at = now()
      WHERE id = _client_id AND tenant_id = _tok.tenant_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'client')
      ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
      VALUES (_uid, 'client_portal', 'consumer_invite_accepted', _tok.id,
        jsonb_build_object('tenant_id', _tok.tenant_id, 'client_id', _client_id,
          'actor_user_id', _uid, 'via', 'accept_tenant_invite'));

$consumer$;
BEGIN
  IF pg_catalog.strpos(_def, 'E09_CONSUMER_INVITE_INTEGRITY_V1') > 0 THEN
    RETURN;
  END IF;
  _start := pg_catalog.strpos(_def, '  IF _tok.kind = ''consumer'' THEN');
  _end := pg_catalog.strpos(_def, '  ELSIF _tok.kind = ''subaccount_owner'' THEN');
  IF _start = 0 OR _end <= _start THEN
    RAISE EXCEPTION 'E09 acceptance source shape changed; reconcile the current consumer contract';
  END IF;
  _old := pg_catalog.substr(_def, _start, _end - _start);
  -- Preserve concurrent Identity work instead of replacing an unfamiliar body.
  -- Hash is the consumer fragment from current main + applied contact-method adaptation.
  IF pg_catalog.md5(_old) <> '186bd8a592cf0e1c02a95c5a185b7d61' THEN
    RAISE EXCEPTION 'E09 acceptance source changed; independent source reconciliation required';
  END IF;
  _def := pg_catalog.replace(_def, _old, _consumer);
  -- Preserve the existing final workspace write/guard. Pure external-client entry
  -- remains blocked until the customer-safe database/MCP/context projection slice.
  EXECUTE _def;
END;
$e09_consumer_invite$;
