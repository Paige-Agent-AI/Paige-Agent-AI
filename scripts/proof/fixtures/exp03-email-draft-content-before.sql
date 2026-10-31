-- Exact original gated content reader; production catalogue source only, no customer data.
CREATE OR REPLACE FUNCTION public.read_message_content(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_msg record;
  v_class text;
  v_owner uuid;
  v_status text;
  v_active boolean;
  v_tenant uuid := public.current_user_tenant_id();
begin
  select m.* into v_msg from public.messages m where m.id = p_message_id;
  if not found then return null; end if;
  if v_msg.tenant_id is distinct from v_tenant then return null; end if;

  if v_msg.connector_id is null then
    -- A row with no connector was never a synced mailbox message; tenant
    -- authority (checked below) is the gate.
    v_class := 'shared_support'; v_owner := null; v_status := 'active'; v_active := true;
  else
    select cc.mailbox_class, cc.mailbox_owner_user_id, cc.status, cc.active
      into v_class, v_owner, v_status, v_active
      from public.channel_connectors cc where cc.id = v_msg.connector_id;
    if not found then return null; end if;
  end if;

  -- Revoked or disconnected consent refuses the read, fail-closed.
  if v_status <> 'active' or v_active is not true then
    return jsonb_build_object('ok', false, 'code', 'MAILBOX_INACTIVE');
  end if;

  if v_class = 'personal' then
    if v_owner is null or v_owner <> auth.uid() then
      if not public.is_platform_owner() then
        return jsonb_build_object('ok', false, 'code', 'PERSONAL_MAILBOX_NOT_OWNER');
      end if;
    end if;
  else
    -- ANT-38: TENANT-scoped authority (owner|admin of THIS tenant), not the
    -- global admin role. Platform owner preserved.
    if not public.is_tenant_admin(v_tenant) and not public.is_platform_owner() then
      return jsonb_build_object('ok', false, 'code', 'WORKSPACE_ROLE_REQUIRED');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_msg.id,
    'direction', v_msg.direction,
    'channel', v_msg.channel_type,
    'mailbox_class', v_class,
    'subject', v_msg.subject,
    'status', v_msg.status,
    'contact_id', v_msg.contact_id,
    'thread_key', v_msg.thread_key,
    'sender', v_msg.sender,
    'body_text', left(v_msg.body_text, 8000),
    'body_truncated', coalesce(length(v_msg.body_text), 0) > 8000,
    'labels', coalesce((
      select jsonb_agg(jsonb_build_object('label', l.label, 'source', l.source) order by l.label)
      from public.message_labels l where l.message_id = v_msg.id
    ), '[]'::jsonb),
    'classification', (
      select jsonb_build_object('intent', k.intent, 'confidence', k.confidence,
                                'risk_tier', k.risk_tier, 'summary', k.summary, 'decided_at', k.decided_at)
      from public.message_classifications k where k.message_id = v_msg.id
    ),
    'unsubscribe', v_msg.meta ? 'list_unsubscribe',
    'sent_at', v_msg.sent_at,
    'created_at', v_msg.created_at
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.read_message_content(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_message_content(uuid) TO authenticated;

