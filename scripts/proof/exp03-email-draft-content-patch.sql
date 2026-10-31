-- INERT additive context on the ORIGINAL permission-gated content reader.
-- No new read verb, no envelope-body access, no permission or ordinary-field change.
DO $exp03_draft_content$
DECLARE target regprocedure:=to_regprocedure('public.read_message_content(uuid)');
 original text; baseline text; revised text;
 old_text text:=$e03_old$    'body_truncated', coalesce(length(v_msg.body_text), 0) > 8000,$e03_old$;
 new_text text:=$e03_new$    'body_truncated', coalesce(length(v_msg.body_text), 0) > 8000,
    -- Additive context through this SAME original permission gate. Ordinary
    -- clipped body fields above remain exact. This is a source read, never approval.
    'saved_email_draft', case when v_msg.channel_type='email' and v_msg.direction='outbound'
      and v_msg.status='draft' and v_msg.provider_message_id is null and v_msg.contact_id is not null
      and v_msg.updated_at is not null
      and not (coalesce(v_msg.meta,'{}'::jsonb) ?| array['comms_email_binding','sales_invoice_binding','growth_sequence_binding','email_campaign_binding'])
      and coalesce(length(v_msg.body_text),0)<=10000 and coalesce(length(v_msg.body_html),0)<=100000
      then jsonb_build_object('source',jsonb_build_object('message_id',v_msg.id,'updated_at',v_msg.updated_at),
        'body_text',v_msg.body_text,'body_html',v_msg.body_html) else null end,$e03_new$;
BEGIN
 IF target IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target
  AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='s'
  AND p.proconfig=ARRAY['search_path=public']::text[]
  AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres}')
 THEN RAISE EXCEPTION 'EXP03 draft content original metadata drift';END IF;
 original:=pg_get_functiondef(target);baseline:=replace(original,new_text,old_text);
 IF md5(baseline)<>'3940dd0f8d7a9b5ae668707a2513212a'
  OR (length(baseline)-length(replace(baseline,old_text,'')))/length(old_text)<>1
 THEN RAISE EXCEPTION 'EXP03 draft content original source drift';END IF;
 revised:=replace(baseline,old_text,new_text);
 IF original<>baseline AND original<>revised THEN RAISE EXCEPTION 'EXP03 draft content partial source drift';END IF;
 IF original<>revised THEN EXECUTE revised;END IF;
 IF pg_get_functiondef(target)<>revised THEN RAISE EXCEPTION 'EXP03 draft content final readback drift';END IF;
END $exp03_draft_content$;

