-- CLI-created as 20261016011818; forward-numbered above the observed 07110000 frontier.
-- Read only: incumbent consumer-mint authority and canonical invitation/email records.
-- No sender, acceptance, role, raw-table grant or provider/activation change.
CREATE OR REPLACE FUNCTION public.client_portal_owner_invitations(
  p_expected_actor_id uuid,
  p_expected_tenant_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid;
  _account_type text;
  _invitations jsonb;
BEGIN
  IF _actor IS NULL OR p_expected_actor_id IS DISTINCT FROM _actor THEN
    RAISE EXCEPTION 'invitation history requires the actual expected actor' USING ERRCODE='42501';
  END IF;
  IF p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'invitation history workspace unavailable' USING ERRCODE='42501';
  END IF;
  -- Exactly the incumbent consumer mint's three predicates. NULL never grants.
  IF NOT (COALESCE(public.is_platform_owner(),false)
    OR COALESCE(public.is_tenant_admin(p_expected_tenant_id),false)
    OR COALESCE(public.agency_can_manage_child(p_expected_tenant_id,_actor),false)) THEN
    RAISE EXCEPTION 'invitation history workspace unavailable' USING ERRCODE='42501';
  END IF;
  _tenant := p_expected_tenant_id;
  SELECT t.account_type::text INTO _account_type FROM public.tenants t WHERE t.id=_tenant;
  -- Same pure-agency restriction as the incumbent consumer invitation mint.
  IF NOT FOUND OR _account_type='agency' THEN
    RAISE EXCEPTION 'consumer invitation history unavailable for this workspace' USING ERRCODE='42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',i.id,'contact_id',i.contact_id,'email',NULLIF(lower(btrim(i.email)),''),
    'created_at',i.created_at,'expires_at',i.expires_at,
    'last_used_at',i.last_used_at,'revoked_at',i.revoked_at,
    'delivery',d.delivery) ORDER BY i.created_at DESC,i.id DESC),'[]'::jsonb)
  INTO _invitations
  FROM (
    SELECT ti.id,ti.contact_id,ti.email,ti.created_at,ti.expires_at,ti.last_used_at,ti.revoked_at
    FROM public.tenant_invite_tokens ti
    WHERE ti.tenant_id=_tenant AND ti.kind='consumer'
    ORDER BY ti.created_at DESC,ti.id DESC LIMIT 1001
  ) i
  CROSS JOIN LATERAL (
    -- Read at most 51 scoped events to prove truncation; expose only the newest 50.
    WITH recent AS MATERIALIZED (
      SELECT l.id,l.status,l.created_at,l.message_id,l.metadata->>'reason' AS reason,
        CASE l.status WHEN 'dlq' THEN 10 WHEN 'dropped' THEN 11
          ELSE public.email_delivery_rank(l.status) END AS priority
      FROM public.email_send_log l
      WHERE l.tenant_id=_tenant AND l.template_name='portal_invite'
        AND l.metadata ? 'invite_id' AND l.metadata->>'invite_id'=i.id::text
        -- Receipt appenders retain invite_id but may omit kind. An explicit kind
        -- must identify a consumer; null/malformed/other invitation kinds refuse.
        AND (NOT (l.metadata ? 'kind') OR l.metadata->>'kind'='consumer')
        AND NULLIF(lower(btrim(i.email)),'') IS NOT NULL
        AND lower(btrim(l.recipient_email))=NULLIF(lower(btrim(i.email)),'')
      ORDER BY l.created_at DESC,priority DESC,l.id DESC LIMIT 51
    ), retained AS (
      SELECT * FROM recent ORDER BY created_at DESC,priority DESC,id DESC LIMIT 50
    )
    SELECT jsonb_build_object('history',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',h.id,
        'status',CASE WHEN h.status IN ('pending','sent','delivered','delivery_delayed','opened','clicked',
          'bounced','complained','suppressed','failed','dlq','dropped') THEN h.status ELSE 'unknown' END,
        'at',h.created_at,
        'outcome',CASE
          WHEN h.status='failed' AND h.reason='transport' THEN 'unknown'
          WHEN h.status='sent' THEN CASE WHEN NULLIF(btrim(h.message_id),'') IS NOT NULL THEN 'accepted' ELSE 'unknown' END
          WHEN h.status='delivered' THEN 'delivered'
          WHEN h.status='opened' THEN 'opened'
          WHEN h.status='clicked' THEN 'clicked'
          WHEN h.status='delivery_delayed' THEN 'delayed'
          WHEN h.status IN ('bounced','complained','suppressed','failed','dlq','dropped') THEN 'failed'
          WHEN h.status='pending' THEN 'pending'
          ELSE 'unknown' END
      ) ORDER BY h.created_at,h.priority,h.id) FROM retained h),'[]'::jsonb),
      'truncated',(SELECT count(*)>50 FROM recent)) AS delivery
  ) d;
  RETURN jsonb_build_object('actor_id',_actor,'tenant_id',_tenant,'invitations',_invitations);
END;
$function$;
REVOKE ALL ON FUNCTION public.client_portal_owner_invitations(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.client_portal_owner_invitations(uuid,uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.client_portal_owner_invitations(uuid,uuid) IS
  'Read-only actual-actor/exact-workspace consumer-mint authority invitation history. Nonsecret canonical email evidence, bounded/truncated; no send or acceptance claim.';
