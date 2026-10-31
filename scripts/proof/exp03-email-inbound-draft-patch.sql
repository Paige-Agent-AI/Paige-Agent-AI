-- INERT original inbound EMAIL draft extension; no production apply or migration number.
-- Four original functions only. Exact source inverses preserve every unrelated branch,
-- ACL, owner, search_path and lock order. Original claim is unchanged and consumes read_binding.
DO $inbound$
DECLARE f record; item record; target regprocedure; definition text; baseline text; revised text;
BEGIN
 FOR f IN SELECT DISTINCT signature,before_md5,acl FROM (VALUES
(0,'prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)','41cb53161afde5aa03d17013509f15f5','{postgres=X/postgres,service_role=X/postgres}','_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'')','(_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'') AND NOT coalesce(_act.action_kind=''comms-draft-reply'' AND _draft_source IS NOT NULL
    AND _source_message.id::text=_draft_source->>''message_id'' AND _source_message.action_id=_act.id
    AND _source_message.meta->>''source''=''comms-draft-reply''
    AND coalesce(_act.payload->>''channel_type'',''email'')=''email'',false))'),
(1,'read_comms_email_send_binding(uuid)','f34ab7d3e7328f8699b7e9eab4de3081','{postgres=X/postgres,service_role=X/postgres}','a.action_kind IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'')','(a.action_kind IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'') OR coalesce(a.action_kind=''comms-draft-reply'' AND coalesce(a.payload->>''channel_type'',''email'')=''email''
    AND m.action_id=a.id AND m.channel_type=''email'' AND m.meta->>''source''=''comms-draft-reply''
    AND b#>>''{governance,draft_source,message_id}''=m.id::text,false))'),
(2,'read_comms_email_send_binding(uuid)','f34ab7d3e7328f8699b7e9eab4de3081','{postgres=X/postgres,service_role=X/postgres}',' IF b->>''state'' IS DISTINCT FROM ''prepared'' THEN origin_ok:=true; END IF;',' IF b->>''state''=''prepared'' AND a.action_kind=''comms-draft-reply'' AND NOT coalesce(a.action_kind=''comms-draft-reply'' AND coalesce(a.payload->>''channel_type'',''email'')=''email''
    AND m.action_id=a.id AND m.channel_type=''email'' AND m.meta->>''source''=''comms-draft-reply''
    AND b#>>''{governance,draft_source,message_id}''=m.id::text,false) THEN origin_ok:=false; END IF;
 IF b->>''state'' IS DISTINCT FROM ''prepared'' THEN origin_ok:=true; END IF;'),
(3,'_lead_reply_record_send(uuid,uuid,uuid)','c676f19e07d01760390d022df3c739f8','{postgres=X/postgres}','_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'')','(_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'') AND NOT coalesce(_act.action_kind=''comms-draft-reply'' AND coalesce(_act.payload->>''channel_type'',''email'')=''email''
    AND EXISTS(SELECT 1 FROM public.messages s WHERE s.tenant_id=_ap.tenant_id AND s.contact_id=_act.contact_id
      AND s.action_id=_act.id AND s.channel_type=''email'' AND s.direction=''outbound''
      AND s.meta->>''source''=''comms-draft-reply''
      AND s.meta#>>''{comms_email_binding,operation_id}''=_operation_id::text
      AND s.meta#>>''{comms_email_binding,approval_id}''=_ap.id::text
      AND s.meta#>>''{comms_email_binding,actor_user_id}''=_actor::text
      AND s.meta#>>''{comms_email_binding,governance,draft_source,message_id}''=s.id::text),false))'),
(4,'paige_guard_send_approval_requires_governed_send()','e137d771a63f2fbc6beff88fea2e3d37','{postgres=X/postgres}','ARRAY[''owner.lead_followup'',''client.followup'',''owner.followup_email'']','ARRAY[''owner.lead_followup'',''client.followup'',''owner.followup_email'',''comms-draft-reply'']'),
(5,'paige_guard_send_approval_requires_governed_send()','e137d771a63f2fbc6beff88fea2e3d37','{postgres=X/postgres}','  _tenant := NEW.tenant_id;','  IF _kinds[1]=''comms-draft-reply'' AND NOT coalesce(
    _msg.channel_type=''email'' AND _msg.direction=''outbound'' AND _msg.meta->>''source''=''comms-draft-reply''
    AND _msg.meta#>>''{comms_email_binding,governance,draft_source,message_id}''=_msg.id::text
    AND EXISTS(SELECT 1 FROM public.paige_actions a WHERE a.id=_msg.action_id AND a.approval_id=NEW.id
      AND a.tenant_id=NEW.tenant_id AND a.contact_id=_msg.contact_id AND a.action_kind=''comms-draft-reply''
      AND coalesce(a.payload->>''channel_type'',''email'')=''email''),false) THEN
    RAISE EXCEPTION ''COMMS_EMAIL_ORIGIN_BINDING_CHANGED'' USING ERRCODE=''42501'';
  END IF;
  _tenant := NEW.tenant_id;'),
(6,'paige_guard_send_approval_requires_governed_send()','e137d771a63f2fbc6beff88fea2e3d37','{postgres=X/postgres}','OR _msg.created_at < NEW.created_at','OR (_msg.created_at < NEW.created_at AND _kinds[1]<>''comms-draft-reply'')')
 ) AS patches(n,signature,before_md5,acl,old_text,new_text)
 LOOP
  target:=to_regprocedure('public.'||f.signature);
  IF target IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND p.proacl::text=f.acl)
  THEN RAISE EXCEPTION 'EXP03 inbound original metadata drift: %',f.signature;END IF;
  definition:=pg_get_functiondef(target);baseline:=definition;
  FOR item IN SELECT * FROM (VALUES
(0,'prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)','41cb53161afde5aa03d17013509f15f5','{postgres=X/postgres,service_role=X/postgres}','_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'')','(_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'') AND NOT coalesce(_act.action_kind=''comms-draft-reply'' AND _draft_source IS NOT NULL
    AND _source_message.id::text=_draft_source->>''message_id'' AND _source_message.action_id=_act.id
    AND _source_message.meta->>''source''=''comms-draft-reply''
    AND coalesce(_act.payload->>''channel_type'',''email'')=''email'',false))'),
(1,'read_comms_email_send_binding(uuid)','f34ab7d3e7328f8699b7e9eab4de3081','{postgres=X/postgres,service_role=X/postgres}','a.action_kind IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'')','(a.action_kind IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'') OR coalesce(a.action_kind=''comms-draft-reply'' AND coalesce(a.payload->>''channel_type'',''email'')=''email''
    AND m.action_id=a.id AND m.channel_type=''email'' AND m.meta->>''source''=''comms-draft-reply''
    AND b#>>''{governance,draft_source,message_id}''=m.id::text,false))'),
(2,'read_comms_email_send_binding(uuid)','f34ab7d3e7328f8699b7e9eab4de3081','{postgres=X/postgres,service_role=X/postgres}',' IF b->>''state'' IS DISTINCT FROM ''prepared'' THEN origin_ok:=true; END IF;',' IF b->>''state''=''prepared'' AND a.action_kind=''comms-draft-reply'' AND NOT coalesce(a.action_kind=''comms-draft-reply'' AND coalesce(a.payload->>''channel_type'',''email'')=''email''
    AND m.action_id=a.id AND m.channel_type=''email'' AND m.meta->>''source''=''comms-draft-reply''
    AND b#>>''{governance,draft_source,message_id}''=m.id::text,false) THEN origin_ok:=false; END IF;
 IF b->>''state'' IS DISTINCT FROM ''prepared'' THEN origin_ok:=true; END IF;'),
(3,'_lead_reply_record_send(uuid,uuid,uuid)','c676f19e07d01760390d022df3c739f8','{postgres=X/postgres}','_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'')','(_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'') AND NOT coalesce(_act.action_kind=''comms-draft-reply'' AND coalesce(_act.payload->>''channel_type'',''email'')=''email''
    AND EXISTS(SELECT 1 FROM public.messages s WHERE s.tenant_id=_ap.tenant_id AND s.contact_id=_act.contact_id
      AND s.action_id=_act.id AND s.channel_type=''email'' AND s.direction=''outbound''
      AND s.meta->>''source''=''comms-draft-reply''
      AND s.meta#>>''{comms_email_binding,operation_id}''=_operation_id::text
      AND s.meta#>>''{comms_email_binding,approval_id}''=_ap.id::text
      AND s.meta#>>''{comms_email_binding,actor_user_id}''=_actor::text
      AND s.meta#>>''{comms_email_binding,governance,draft_source,message_id}''=s.id::text),false))'),
(4,'paige_guard_send_approval_requires_governed_send()','e137d771a63f2fbc6beff88fea2e3d37','{postgres=X/postgres}','ARRAY[''owner.lead_followup'',''client.followup'',''owner.followup_email'']','ARRAY[''owner.lead_followup'',''client.followup'',''owner.followup_email'',''comms-draft-reply'']'),
(5,'paige_guard_send_approval_requires_governed_send()','e137d771a63f2fbc6beff88fea2e3d37','{postgres=X/postgres}','  _tenant := NEW.tenant_id;','  IF _kinds[1]=''comms-draft-reply'' AND NOT coalesce(
    _msg.channel_type=''email'' AND _msg.direction=''outbound'' AND _msg.meta->>''source''=''comms-draft-reply''
    AND _msg.meta#>>''{comms_email_binding,governance,draft_source,message_id}''=_msg.id::text
    AND EXISTS(SELECT 1 FROM public.paige_actions a WHERE a.id=_msg.action_id AND a.approval_id=NEW.id
      AND a.tenant_id=NEW.tenant_id AND a.contact_id=_msg.contact_id AND a.action_kind=''comms-draft-reply''
      AND coalesce(a.payload->>''channel_type'',''email'')=''email''),false) THEN
    RAISE EXCEPTION ''COMMS_EMAIL_ORIGIN_BINDING_CHANGED'' USING ERRCODE=''42501'';
  END IF;
  _tenant := NEW.tenant_id;'),
(6,'paige_guard_send_approval_requires_governed_send()','e137d771a63f2fbc6beff88fea2e3d37','{postgres=X/postgres}','OR _msg.created_at < NEW.created_at','OR (_msg.created_at < NEW.created_at AND _kinds[1]<>''comms-draft-reply'')')
   ) AS patches(n,signature,before_md5,acl,old_text,new_text) WHERE signature=f.signature ORDER BY n DESC
  LOOP baseline:=replace(baseline,item.new_text,item.old_text);END LOOP;
  IF md5(baseline)<>f.before_md5 THEN RAISE EXCEPTION 'EXP03 inbound original source drift: %',f.signature;END IF;
  revised:=baseline;
  FOR item IN SELECT * FROM (VALUES
(0,'prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)','41cb53161afde5aa03d17013509f15f5','{postgres=X/postgres,service_role=X/postgres}','_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'')','(_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'') AND NOT coalesce(_act.action_kind=''comms-draft-reply'' AND _draft_source IS NOT NULL
    AND _source_message.id::text=_draft_source->>''message_id'' AND _source_message.action_id=_act.id
    AND _source_message.meta->>''source''=''comms-draft-reply''
    AND coalesce(_act.payload->>''channel_type'',''email'')=''email'',false))'),
(1,'read_comms_email_send_binding(uuid)','f34ab7d3e7328f8699b7e9eab4de3081','{postgres=X/postgres,service_role=X/postgres}','a.action_kind IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'')','(a.action_kind IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'') OR coalesce(a.action_kind=''comms-draft-reply'' AND coalesce(a.payload->>''channel_type'',''email'')=''email''
    AND m.action_id=a.id AND m.channel_type=''email'' AND m.meta->>''source''=''comms-draft-reply''
    AND b#>>''{governance,draft_source,message_id}''=m.id::text,false))'),
(2,'read_comms_email_send_binding(uuid)','f34ab7d3e7328f8699b7e9eab4de3081','{postgres=X/postgres,service_role=X/postgres}',' IF b->>''state'' IS DISTINCT FROM ''prepared'' THEN origin_ok:=true; END IF;',' IF b->>''state''=''prepared'' AND a.action_kind=''comms-draft-reply'' AND NOT coalesce(a.action_kind=''comms-draft-reply'' AND coalesce(a.payload->>''channel_type'',''email'')=''email''
    AND m.action_id=a.id AND m.channel_type=''email'' AND m.meta->>''source''=''comms-draft-reply''
    AND b#>>''{governance,draft_source,message_id}''=m.id::text,false) THEN origin_ok:=false; END IF;
 IF b->>''state'' IS DISTINCT FROM ''prepared'' THEN origin_ok:=true; END IF;'),
(3,'_lead_reply_record_send(uuid,uuid,uuid)','c676f19e07d01760390d022df3c739f8','{postgres=X/postgres}','_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'')','(_act.action_kind NOT IN (''owner.lead_followup'',''client.followup'',''owner.followup_email'') AND NOT coalesce(_act.action_kind=''comms-draft-reply'' AND coalesce(_act.payload->>''channel_type'',''email'')=''email''
    AND EXISTS(SELECT 1 FROM public.messages s WHERE s.tenant_id=_ap.tenant_id AND s.contact_id=_act.contact_id
      AND s.action_id=_act.id AND s.channel_type=''email'' AND s.direction=''outbound''
      AND s.meta->>''source''=''comms-draft-reply''
      AND s.meta#>>''{comms_email_binding,operation_id}''=_operation_id::text
      AND s.meta#>>''{comms_email_binding,approval_id}''=_ap.id::text
      AND s.meta#>>''{comms_email_binding,actor_user_id}''=_actor::text
      AND s.meta#>>''{comms_email_binding,governance,draft_source,message_id}''=s.id::text),false))'),
(4,'paige_guard_send_approval_requires_governed_send()','e137d771a63f2fbc6beff88fea2e3d37','{postgres=X/postgres}','ARRAY[''owner.lead_followup'',''client.followup'',''owner.followup_email'']','ARRAY[''owner.lead_followup'',''client.followup'',''owner.followup_email'',''comms-draft-reply'']'),
(5,'paige_guard_send_approval_requires_governed_send()','e137d771a63f2fbc6beff88fea2e3d37','{postgres=X/postgres}','  _tenant := NEW.tenant_id;','  IF _kinds[1]=''comms-draft-reply'' AND NOT coalesce(
    _msg.channel_type=''email'' AND _msg.direction=''outbound'' AND _msg.meta->>''source''=''comms-draft-reply''
    AND _msg.meta#>>''{comms_email_binding,governance,draft_source,message_id}''=_msg.id::text
    AND EXISTS(SELECT 1 FROM public.paige_actions a WHERE a.id=_msg.action_id AND a.approval_id=NEW.id
      AND a.tenant_id=NEW.tenant_id AND a.contact_id=_msg.contact_id AND a.action_kind=''comms-draft-reply''
      AND coalesce(a.payload->>''channel_type'',''email'')=''email''),false) THEN
    RAISE EXCEPTION ''COMMS_EMAIL_ORIGIN_BINDING_CHANGED'' USING ERRCODE=''42501'';
  END IF;
  _tenant := NEW.tenant_id;'),
(6,'paige_guard_send_approval_requires_governed_send()','e137d771a63f2fbc6beff88fea2e3d37','{postgres=X/postgres}','OR _msg.created_at < NEW.created_at','OR (_msg.created_at < NEW.created_at AND _kinds[1]<>''comms-draft-reply'')')
   ) AS patches(n,signature,before_md5,acl,old_text,new_text) WHERE signature=f.signature ORDER BY n
  LOOP
   IF (length(revised)-length(replace(revised,item.old_text,'')))/length(item.old_text)<>1
   THEN RAISE EXCEPTION 'EXP03 inbound anchor drift: % / %',f.signature,item.n;END IF;
   revised:=replace(revised,item.old_text,item.new_text);
  END LOOP;
  IF definition<>baseline AND definition<>revised THEN RAISE EXCEPTION 'EXP03 inbound partial source drift: %',f.signature;END IF;
  IF definition<>revised THEN EXECUTE revised;END IF;
  IF pg_get_functiondef(target)<>revised THEN RAISE EXCEPTION 'EXP03 inbound source readback failed: %',f.signature;END IF;
 END LOOP;
END $inbound$;

