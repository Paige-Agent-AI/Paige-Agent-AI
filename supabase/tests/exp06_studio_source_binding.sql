-- Rollback-only native proof: execute in an isolated runner with captured
-- original Studio/Hub functions and synthetic auth ports. Not live-user proof.
BEGIN;
CREATE TEMP TABLE studio_binding_assertions(label text);
CREATE FUNCTION pg_temp.studio_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'STUDIO_BINDING_PROOF_FAIL: %',label; END IF;
 INSERT INTO studio_binding_assertions VALUES(label);
END $$;
CREATE FUNCTION pg_temp.studio_refuses(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE code text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE; END;
 PERFORM pg_temp.studio_assert(code=expected,label);
END $$;
GRANT INSERT,SELECT ON studio_binding_assertions TO authenticated;

INSERT INTO auth.users(id) VALUES('f0060000-0000-4000-8000-000000000001'),('f0060000-0000-4000-8000-000000000002');
INSERT INTO public.tenants(id,status,account_type) VALUES
 ('f0060000-0000-4000-8000-000000000010','active','standalone'),('f0060000-0000-4000-8000-000000000020','active','standalone');
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('f0060000-0000-4000-8000-000000000001','f0060000-0000-4000-8000-000000000010'),
 ('f0060000-0000-4000-8000-000000000002','f0060000-0000-4000-8000-000000000020');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,team_hub_access) VALUES
 ('f0060000-0000-4000-8000-000000000010','f0060000-0000-4000-8000-000000000001','owner','active',true),
 ('f0060000-0000-4000-8000-000000000020','f0060000-0000-4000-8000-000000000002','admin','active',true);
INSERT INTO public.paige_subagents(slug,tenant_id,enabled,config) VALUES('nexus',NULL,true,'{"capability_scope":{"mode":"allowlist","access":"card","tools":["growth_list"]}}');

DO $proof$
#variable_conflict use_variable
DECLARE
 t uuid:='f0060000-0000-4000-8000-000000000010'; u uuid:='f0060000-0000-4000-8000-000000000001';
 t2 uuid:='f0060000-0000-4000-8000-000000000020'; u2 uuid:='f0060000-0000-4000-8000-000000000002';
 key uuid:='f0060000-0000-4000-8000-000000000030'; turn_id uuid; channel_id uuid; source_id uuid; message_id uuid;
 paige_channel uuid; paige_source uuid; paige_turn uuid; paige_message uuid; abandoned_turn uuid;
 a jsonb; b jsonb; c jsonb; s uuid; prior int;
 context jsonb:='{"target":{"kind":"workspace"},"values":{"publicName":"Test business","offers":"Consulting"},"template_id":"nexus-editorial-landing-v1"}';
BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 -- Written before the implementation: first red run stops at this absent RPC.
 a:=public.studio_start_project(t,key,'Create a consulting landing page',context);
 s:=(a->>'session_id')::uuid;
 PERFORM pg_temp.studio_assert(a->'ok'='true' AND a->'created'='true' AND a->>'state'='ready','explicit original start proves a new project');
 b:=public.studio_start_project(t,key,'Create a consulting landing page',context);
 PERFORM pg_temp.studio_assert(b->>'session_id'=a->>'session_id' AND b->>'thread_id'=a->>'thread_id' AND b->'created'='false','same request reuses original project and thread');
 PERFORM pg_temp.studio_assert((SELECT count(*)=1 FROM public.studio_sessions WHERE studio_start_request_id=key),'retry has one session');
 PERFORM pg_temp.studio_assert((SELECT count(*)=1 FROM public.paige_chat_threads WHERE studio_session_id=s),'retry has one original thread');
 PERFORM pg_temp.studio_assert((SELECT count(*)=1 FROM public.audit_logs WHERE entity_id=s AND action='create_studio_session'),'original creation audit occurs once');
 b:=public.studio_lookup_project_start(t,key);
 PERFORM pg_temp.studio_assert(b->>'session_id'=a->>'session_id' AND b->'created'='false','lost start response recovers same original ID without reseed');
 SELECT count(*) INTO prior FROM public.studio_sessions;
 b:=public.studio_lookup_project_start(t,gen_random_uuid());
 PERFORM pg_temp.studio_assert(b->>'code'='unknown' AND (SELECT count(*)=prior FROM public.studio_sessions),'unknown lookup creates nothing');
 PERFORM pg_temp.studio_refuses(format('select public.studio_start_project(%L,%L,%L,%L)',t,key,'Different request',context),'40001','consumed request cannot change brief');
 PERFORM pg_temp.studio_refuses(format('select public.studio_start_project(%L,%L,%L,%L)',t,key,'Create a consulting landing page','{}'),'40001','consumed request cannot replace target context');
 UPDATE public.studio_sessions SET studio_session_scratchpad=studio_session_scratchpad||'{"working_memory":"retained"}' WHERE id=s;
 b:=public.studio_set_project_context(t,s,'{"target":{"kind":"custom","reference":"new-brand","label":"Other business"},"values":{"publicName":"Other business"}}',context);
 PERFORM pg_temp.studio_assert(b->'ok'='true' AND b#>>'{context,target,kind}'='custom','explicit project-only target edit persists');
 PERFORM pg_temp.studio_assert((SELECT studio_session_scratchpad->>'working_memory'='retained' FROM public.studio_sessions WHERE id=s),'project edit preserves original working memory');
 PERFORM pg_temp.studio_refuses(format('select public.studio_set_project_context(%L,%L,%L,%L)',t,s,'{"values":{"publicName":"Stale edit"}}',context),'40001','stale project context cannot overwrite a newer correction');
 c:=public.studio_set_project_context(t,s,b->'context','{}');
 PERFORM pg_temp.studio_assert(c->'changed'='false' AND c->'context'=b->'context','lost context save recovers equal current state without rewrite');
 b:=public.studio_start_project(t,key,'Create a consulting landing page',context);
 PERFORM pg_temp.studio_assert(b->'created'='false' AND (public.studio_project_context(t,s)#>>'{context,target,kind}')='custom','retry cannot overwrite a later explicit context correction');
 FOREACH c IN ARRAY ARRAY['{"confirmed":true}'::jsonb,'{"values":{"secret":"private"}}','{"values":{"offers":{"nested":"private"}}}',
  '{"target":{"kind":null}}','{"values":{"offers":"api_key=unsafe-credential-value"}}','{"target":{"kind":"client"}}'] LOOP
  PERFORM pg_temp.studio_refuses(format('select public.studio_set_project_context(%L,%L,%L,%L)',t,s,c,'{}'),'22023','unsafe or unsupported project context refused');
 END LOOP;
 PERFORM pg_temp.studio_refuses(format('select public.studio_start_project(%L,%L,%L)',t2,gen_random_uuid(),'Wrong workspace'),'42501','expected tenant cannot override active workspace');
 PERFORM set_config('request.jwt.claim.sub',u2::text,true);
 PERFORM pg_temp.studio_assert(public.studio_lookup_project_start(t2,key)->>'code'='unknown','other actor cannot discover private request');
 PERFORM pg_temp.studio_assert(public.studio_project_context(t2,s)->>'code'='not_allowed','other workspace cannot read private project context');
 c:=public.studio_start_project(t2,key,'A separate legitimate business page','{}');
 PERFORM pg_temp.studio_assert(c->'created'='true' AND c->>'session_id'<>a->>'session_id','equally eligible admin gets same product contract scoped separately');
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 UPDATE public.tenant_members SET role='member' WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_refuses(format('select public.studio_start_project(%L,%L,%L)',t,gen_random_uuid(),'Member request'),'42501','ordinary member cannot start authoring');
 PERFORM pg_temp.studio_assert(public.studio_lookup_project_start(t,key)->>'code'='scope_changed','revoked author cannot reopen start reference');
 UPDATE public.tenant_members SET role='owner' WHERE tenant_id=t AND user_id=u;
 UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id=u;
 PERFORM pg_temp.studio_assert(public.studio_project_context(t,s)->>'code'='scope_changed','banned identity cannot recover private context');
 UPDATE auth.users SET banned_until=NULL WHERE id=u;

 INSERT INTO public.team_hub_channels(tenant_id,kind,visibility,created_by,agent_key) VALUES(t,'agent_dm','private',u,'nexus') RETURNING id INTO channel_id;
 INSERT INTO public.team_hub_channel_members VALUES(channel_id,u);
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,author_kind) VALUES(t,channel_id,u,'user') RETURNING id INTO source_id;
 INSERT INTO public.team_hub_agent_turns(tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash)
 VALUES(t,channel_id,u,source_id,'nexus','dm',repeat('a',64)) RETURNING id INTO turn_id;
 PERFORM pg_temp.studio_assert(public.team_hub_studio_scope(turn_id,repeat('a',64))->'ok'='true','current accepted private Nexus turn may prepare text');
 PERFORM pg_temp.studio_assert(public.team_hub_studio_scope(turn_id,repeat('b',64))->'ok'='false','wrong accepted token cannot borrow scope');
 SELECT count(*) INTO prior FROM public.studio_sessions;
 PERFORM pg_temp.studio_assert(public.team_hub_stage_studio_brief(turn_id,repeat('a',64),'Build a page for the requested offer')->'ok'='true','service stages bounded private brief');
 PERFORM pg_temp.studio_assert((SELECT count(*)=prior FROM public.studio_sessions),'model preparation never starts a project');
 UPDATE public.team_hub_agent_turns SET accepted_at=clock_timestamp()-interval '6 minutes' WHERE id=turn_id;
 PERFORM pg_temp.studio_assert(public.team_hub_studio_scope(turn_id,repeat('a',64))->'ok'='false','expired accepted turn refuses continuation');
 PERFORM pg_temp.studio_assert(public.team_hub_stage_studio_brief(turn_id,repeat('a',64),'Stale replacement')->'ok'='false','expired turn cannot stage');
 UPDATE public.team_hub_agent_turns SET accepted_at=clock_timestamp() WHERE id=turn_id;
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,author_kind,agent_key) VALUES(t,channel_id,u,'agent','nexus') RETURNING id INTO message_id;
 UPDATE public.team_hub_agent_turns SET consumed_at=clock_timestamp(),posted_message_id=message_id WHERE id=turn_id;
 b:=public.team_hub_studio_reference(t,message_id);
 PERFORM pg_temp.studio_assert(b->>'state'='prepared' AND b->>'brief'='Build a page for the requested offer','original posted message returns protected prepared brief');
 PERFORM pg_temp.studio_assert((SELECT count(*)=prior FROM public.studio_sessions),'reference read and reload create nothing');
 b:=public.team_hub_start_studio(t,message_id,context);
 PERFORM pg_temp.studio_assert(b->'created'='true','explicit same-source handoff starts original project');
 c:=public.team_hub_start_studio(t,message_id,context);
 PERFORM pg_temp.studio_assert(c->>'session_id'=b->>'session_id' AND c->>'thread_id'=b->>'thread_id' AND c->'created'='false','repeat same-source handoff recovers exactly one project/thread');
 c:=public.team_hub_studio_reference(t,message_id);
 PERFORM pg_temp.studio_assert(c->>'state'='ready' AND c->>'session_id'=b->>'session_id' AND NOT(c ? 'brief'),'ready reader exposes original project pointer without private brief replay');
 PERFORM pg_temp.studio_refuses(format('select public.team_hub_start_studio(%L,%L,%L)',t,message_id,'{"target":{"kind":"workspace"}}'),'40001','same Hub binding cannot change confirmed start context');
 PERFORM pg_temp.studio_refuses(format('update public.team_hub_agent_turns set studio_brief=%L where id=%L','{"brief":"Injected","session_id":"forged"}',turn_id),'22023','model-supplied identity/status fields refused natively');
 UPDATE public.tenant_members SET team_hub_access=false WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_assert(public.team_hub_studio_reference(t,message_id)->'ok'='false','revoked Hub access removes stale presentation');
 UPDATE public.tenant_members SET team_hub_access=true WHERE tenant_id=t AND user_id=u;
 DELETE FROM public.team_hub_channel_members WHERE user_id=u AND team_hub_channel_members.channel_id=channel_id;
 PERFORM pg_temp.studio_assert(public.team_hub_studio_reference(t,message_id)->'ok'='false','revoked private membership removes reference');
 INSERT INTO public.team_hub_channel_members VALUES(channel_id,u);
 UPDATE public.team_hub_messages SET deleted_at=clock_timestamp() WHERE id=source_id;
 PERFORM pg_temp.studio_assert(public.team_hub_studio_reference(t,message_id)->'ok'='false','deleted original source cannot authorize recovery');
 UPDATE public.team_hub_messages SET deleted_at=NULL WHERE id=source_id;
 UPDATE public.paige_subagents SET enabled=false WHERE slug='nexus' AND tenant_id IS NULL;
 PERFORM pg_temp.studio_assert(public.team_hub_studio_reference(t,message_id)->'ok'='false','disabled original Nexus withdraws preparation');
 UPDATE public.paige_subagents SET enabled=true WHERE slug='nexus' AND tenant_id IS NULL;
 UPDATE public.team_hub_channels SET visibility='team',kind='channel' WHERE id=channel_id;
 PERFORM pg_temp.studio_assert(public.team_hub_studio_reference(t,message_id)->'ok'='false','shared channel cannot export its transcript into Studio');
 UPDATE public.team_hub_channels SET visibility='private',kind='agent_dm' WHERE id=channel_id;
 -- The original PAIGE root has no fabricated NEXUS roster dependency.
 INSERT INTO public.team_hub_channels(tenant_id,kind,visibility,created_by,agent_key) VALUES(t,'agent_dm','private',u,'paige') RETURNING id INTO paige_channel;
 INSERT INTO public.team_hub_channel_members VALUES(paige_channel,u);
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,author_kind) VALUES(t,paige_channel,u,'user') RETURNING id INTO paige_source;
 INSERT INTO public.team_hub_agent_turns(tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash)
 VALUES(t,paige_channel,u,paige_source,'paige','dm',repeat('c',64)) RETURNING id INTO paige_turn;
 UPDATE public.paige_subagents SET enabled=false WHERE slug='nexus' AND tenant_id IS NULL;
 PERFORM pg_temp.studio_assert(public.team_hub_studio_scope(paige_turn,repeat('c',64))->'ok'='true','original PAIGE private scope does not borrow Nexus roster');
 PERFORM pg_temp.studio_assert(public.team_hub_stage_studio_brief(paige_turn,repeat('c',64),'Requested private Studio project')->'ok'='true','PAIGE prepares through same bounded source contract');
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,author_kind,agent_key) VALUES(t,paige_channel,u,'agent','paige') RETURNING id INTO paige_message;
 UPDATE public.team_hub_agent_turns SET accepted_at=clock_timestamp()-interval '6 minutes' WHERE id=paige_turn;
 PERFORM pg_temp.studio_refuses(format('update public.team_hub_agent_turns set consumed_at=clock_timestamp(),posted_message_id=%L where id=%L',paige_message,paige_turn),'42501','expired staged work cannot publish after provider completion');
 UPDATE public.team_hub_agent_turns SET accepted_at=clock_timestamp() WHERE id=paige_turn;
 UPDATE public.team_hub_agent_turns SET consumed_at=clock_timestamp(),posted_message_id=paige_message WHERE id=paige_turn;
 PERFORM pg_temp.studio_assert(public.team_hub_studio_reference(t,paige_message)->>'state'='prepared','same original PAIGE message exposes prepared reference');
 UPDATE public.paige_subagents SET enabled=true WHERE slug='nexus' AND tenant_id IS NULL;
 -- Automatic private follow-up retains a different source channel and refuses.
 INSERT INTO public.team_hub_agent_turns(tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash)
 VALUES(t,paige_channel,u,source_id,'paige','dm',repeat('d',64)) RETURNING id INTO abandoned_turn;
 PERFORM pg_temp.studio_assert(public.team_hub_studio_scope(abandoned_turn,repeat('d',64))->'ok'='false','private follow-up cannot export a source from another channel');
 DELETE FROM public.team_hub_agent_turns WHERE id=abandoned_turn;
 INSERT INTO public.team_hub_agent_turns(tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash)
 VALUES(t,paige_channel,u,paige_source,'paige','dm',repeat('e',64)) RETURNING id INTO abandoned_turn;
 PERFORM public.team_hub_stage_studio_brief(abandoned_turn,repeat('e',64),'Abandoned private preparation');
 UPDATE public.team_hub_agent_turns SET token_hash=repeat('f',64) WHERE id=abandoned_turn;
 PERFORM pg_temp.studio_assert((SELECT studio_brief IS NULL FROM public.team_hub_agent_turns WHERE id=abandoned_turn),'replaced original token clears unposted preparation');
 PERFORM public.team_hub_stage_studio_brief(abandoned_turn,repeat('f',64),'Aborted private preparation');
 UPDATE public.tenant_members SET team_hub_access=false WHERE tenant_id=t AND user_id=u;
 UPDATE public.team_hub_agent_turns SET consumed_at=clock_timestamp() WHERE id=abandoned_turn;
 PERFORM pg_temp.studio_assert((SELECT studio_brief IS NULL AND posted_message_id IS NULL FROM public.team_hub_agent_turns WHERE id=abandoned_turn),'original abort can retire after revocation without publishing private text');
 UPDATE public.tenant_members SET team_hub_access=true WHERE tenant_id=t AND user_id=u;
 PERFORM set_config('request.jwt.claim.sub',u2::text,true);
 PERFORM pg_temp.studio_assert(public.team_hub_studio_reference(t2,message_id)->'ok'='false','different asker cannot recover private Studio handoff');
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM pg_temp.studio_assert(NOT has_function_privilege('authenticated','public.team_hub_stage_studio_brief(uuid,text,text)','execute'),'browser cannot stage accepted-turn preparation');
 PERFORM pg_temp.studio_assert(NOT has_function_privilege('anon','public.studio_start_project(uuid,uuid,text,jsonb)','execute'),'anonymous cannot start a project');
 PERFORM pg_temp.studio_assert(NOT has_function_privilege('service_role','public.studio_start_project(uuid,uuid,text,jsonb)','execute'),'service cannot impersonate explicit owner start');
 PERFORM pg_temp.studio_assert(NOT has_table_privilege('authenticated','public.team_hub_agent_turns','update'),'accepted-turn storage stays private');
END $proof$;

DO $conversion$
DECLARE
 t uuid:='f0060000-0000-4000-8000-000000000010'; t2 uuid:='f0060000-0000-4000-8000-000000000020';
 u uuid:='f0060000-0000-4000-8000-000000000001'; request uuid:='f0060000-0000-4000-8000-000000000031';
 item jsonb; destination jsonb; original_block jsonb:='{"type":"hero","title":"The original heading"}';
 page public.growth_pages; legacy_page public.growth_pages; source_page public.growth_pages; form_id uuid; foreign_form uuid; calendar_id uuid; collision_calendar uuid; project_id uuid; a jsonb; b jsonb; readback jsonb; revision timestamptz; count_before integer; audit_before integer;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 FOREACH destination IN ARRAY ARRAY[
  '{"kind":"external_form","mode":"embed","url":"https://form.jotform.com/123456789","provider":"jotform"}'::jsonb,
  '{"kind":"external_form","mode":"embed","url":"https://api.leadconnectorhq.com/widget/form/allowed-form","provider":"gohighlevel"}',
  '{"kind":"external_booking","mode":"embed","url":"https://api.leadconnectorhq.com/widget/bookings/allowed-booking","provider":"gohighlevel"}',
  '{"kind":"external_booking","mode":"embed","url":"https://calendly.com/test-business/intro?hide_event_type_details=1","provider":"calendly"}',
  '{"kind":"external_booking","mode":"embed","url":"https://calendly.com/test-business/intro?%68ide_event_type_details=%31&&","provider":"calendly"}',
  '{"kind":"external_booking","mode":"embed","url":"https://cal.com/test-business/intro","provider":"calcom"}',
  '{"kind":"external_form","mode":"link","url":"https://public-business.com/request","provider":"other"}',
  '{"kind":"external_booking","mode":"link","url":"https://api.leadconnectorhq.com/widget/booking/legacy","provider":"gohighlevel"}'
 ] LOOP
  PERFORM pg_temp.studio_assert(public._growth_conversion_destination_valid(destination),'supported canonical conversion accepted');
 END LOOP;
 FOREACH destination IN ARRAY ARRAY[
  '{"kind":"external_form","mode":"embed","url":"https://public-business.com/request","provider":"other"}'::jsonb,
  '{"kind":"external_form","mode":"embed","url":"https://calendly.com/test-business/intro","provider":"calendly"}',
  '{"kind":"external_booking","mode":"embed","url":"https://calendly.com/admin/private","provider":"calendly"}',
  '{"kind":"external_form","mode":"embed","url":"https://form.jotform.com/123456789","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"javascript:alert(1)","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"https://127.0.0.1/request","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"https://0x7f.0.0.1/request","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"https://private.internal/request","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"https://public-business.com:8443/request","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"https://actor:password@public-business.com/request","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"https://public-business.com/request?token=private","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"https://public-business.com/request#private","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"https://public-business.com/#","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"https://public-business.com/%250a","provider":"other"}',
  '{"kind":"external_form","mode":"link","url":"https://public-business.com/%3Cscript%3E","provider":"other"}',
  '{"kind":"external_booking","mode":"embed","url":"https://calendly.com/test-business/intro?hide_event_type_details=1&hide_event_type_details=0","provider":"calendly"}',
  '{"kind":"native_form","formId":"not-an-id"}',
  '{"kind":"native_booking","slug":"../other"}',
  '{"kind":"external_form","mode":"link","url":"https://public-business.com/request","provider":"other","html":"<script>unsafe()</script>"}'
 ] LOOP
  PERFORM pg_temp.studio_assert(public._growth_conversion_destination_valid(destination) IS DISTINCT FROM true,'unsafe or unsupported conversion refused');
 END LOOP;
 -- Every old type still passes its original validator and unknown types refuse.
 FOREACH item IN ARRAY ARRAY[
  '{"type":"hero"}'::jsonb,'{"type":"hero_scene"}','{"type":"phase_cards"}','{"type":"feature_grid"}','{"type":"cta"}',
  '{"type":"rich_text","html":"<p>Real text</p>"}','{"type":"embedded_form","form_slug":"original"}',
  '{"type":"social_proof"}','{"type":"testimonial"}','{"type":"pricing"}','{"type":"faq"}',
  '{"type":"media","provider":"mp4","url":"https://public-business.com/video.mp4"}','{"type":"stats"}',
  '{"type":"countdown","ends_at":"2030-01-01T00:00:00Z"}','{"type":"two_column"}',
  '{"type":"image","url":"https://public-business.com/photo.jpg"}','{"type":"gallery","images":[]}','{"type":"steps"}','{"type":"chatbot"}'
 ] LOOP
  PERFORM public.growth_validate_blocks(jsonb_build_array(item));
  PERFORM pg_temp.studio_assert(true,'original block validator branch preserved');
 END LOOP;
 PERFORM pg_temp.studio_refuses($q$select public.growth_validate_blocks('[{"type":"unknown"}]')$q$,'22023','unknown old block remains refused');

 INSERT INTO public.growth_forms(tenant_id,slug,name,status,draft_schema_json,draft_success_action_json)
  VALUES(t,'selected-native-form','Test form','draft','{"sections":[]}','{"type":"thank_you"}') RETURNING id INTO form_id;
 INSERT INTO public.growth_forms(tenant_id,slug,name,status) VALUES(t2,'foreign-form','Other form','draft') RETURNING id INTO foreign_form;
 INSERT INTO public.calendars(tenant_id,slug,title,enabled) VALUES(t,'selected-native-calendar','Test calendar',true) RETURNING id INTO calendar_id;
 INSERT INTO public.calendar_hosts(calendar_id,user_id) VALUES(calendar_id,u);
 destination:=jsonb_build_object('kind','native_form','formId',form_id);
 item:=jsonb_build_object('type','conversion','destination',destination,'title','Get in touch');
 PERFORM public.growth_validate_blocks(jsonb_build_array(item));
 a:=public.studio_start_project(t,request,'A conversion settings project','{}'); project_id:=(a->>'session_id')::uuid;
 page:=public.growth_page_upsert(NULL,'test-conversion-page','Test page',jsonb_build_array(original_block),'{"primary":"#123456"}','{"description":"Original metadata"}',NULL,NULL);
 UPDATE public.studio_sessions SET artifact_refs=jsonb_build_array(jsonb_build_object('kind','page','id',page.id,'title',page.title)) WHERE id=project_id;
 PERFORM public.save_artifact_version(project_id,'page',page.id,NULL);
 revision:=page.updated_at;
 a:=public.studio_set_page_conversion(t,project_id,page.id,revision,item);
 PERFORM pg_temp.studio_assert(a->'ok'='true' AND a->'changed'='true','conversion save uses original page and version writers');
 PERFORM pg_temp.studio_assert(a#>'{page,draft_blocks_json,0}'=original_block AND a#>>'{page,draft_theme_json,primary}'='#123456'
  AND a#>>'{page,draft_seo_json,description}'='Original metadata','conversion edit preserves original blocks, theme and SEO');
 SELECT count(*) INTO audit_before FROM public.audit_logs;
 SELECT count(*) INTO count_before FROM public.studio_artifact_versions v WHERE v.session_id=project_id AND lineage_id=page.id;
 readback:=public.studio_page_conversion(t,project_id,page.id);
 PERFORM pg_temp.studio_assert(readback->'ok'='true' AND readback->'conversion'=item AND readback->>'page_id'=page.id::text,'refinement reads actual saved canonical conversion from bound page');
 PERFORM pg_temp.studio_assert((readback->>'updated_at')::timestamptz=(a->>'updated_at')::timestamptz
  AND (SELECT count(*)=audit_before FROM public.audit_logs)
  AND (SELECT count(*)=count_before FROM public.studio_artifact_versions v WHERE v.session_id=project_id AND lineage_id=page.id),'conversion source read never touches, versions or audits a write');
 PERFORM pg_temp.studio_assert(public.studio_page_conversion(t,gen_random_uuid(),page.id)->>'code'='not_allowed','page pointer without original session binding is refused');
 PERFORM pg_temp.studio_assert(public.studio_page_conversion(t,project_id,gen_random_uuid())->>'code'='not_allowed','unbound page cannot enter refinement context');
 PERFORM pg_temp.studio_assert(public.studio_page_conversion(t2,project_id,page.id)->>'code'='scope_changed','wrong active workspace cannot read conversion context');
 UPDATE public.tenant_members SET role='member' WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_assert(public.studio_page_conversion(t,project_id,page.id)->>'code'='scope_changed','revoked author cannot read saved conversion through refinement');
 UPDATE public.tenant_members SET role='owner' WHERE tenant_id=t AND user_id=u;
 SELECT count(*) INTO count_before FROM public.studio_artifact_versions v WHERE v.session_id=project_id AND lineage_id=page.id;
 b:=public.studio_set_page_conversion(t,project_id,page.id,revision,item);
 PERFORM pg_temp.studio_assert(b->'changed'='false' AND b->>'version_id'=a->>'version_id','lost conversion save returns same current version');
 PERFORM pg_temp.studio_assert((SELECT count(*)=count_before FROM public.studio_artifact_versions v WHERE v.session_id=project_id AND lineage_id=page.id),'equal retry creates no version');
 source_page:=public.growth_page_upsert(NULL,'conversion-source-precedence','Source precedence',jsonb_build_array(original_block),NULL,NULL,NULL,NULL);
 UPDATE public.studio_sessions SET artifact_refs=artifact_refs||jsonb_build_array(jsonb_build_object('kind','page','id',source_page.id)) WHERE id=project_id;
 UPDATE public.growth_pages SET blocks_json=jsonb_build_array(item),draft_blocks_json='[]'::jsonb WHERE id=source_page.id;
 readback:=public.studio_page_conversion(t,project_id,source_page.id);
 PERFORM pg_temp.studio_assert(readback->'conversion'='null'::jsonb,'empty actual draft never inherits older published conversion');
 UPDATE public.growth_pages SET draft_blocks_json=NULL WHERE id=source_page.id;
 readback:=public.studio_page_conversion(t,project_id,source_page.id);
 PERFORM pg_temp.studio_assert(readback->'conversion'=item,'published conversion is fallback only when no draft array exists');
 PERFORM pg_temp.studio_assert((SELECT status='draft' FROM public.growth_forms WHERE id=form_id),'saving a native form reference does not publish it');
 item:=jsonb_set(item,'{title}','"Changed heading"');
 PERFORM pg_temp.studio_refuses(format('select public.studio_set_page_conversion(%L,%L,%L,%L,%L)',t,project_id,page.id,revision,item),'40001','stale conversion edit cannot overwrite a newer page');
 PERFORM pg_temp.studio_assert(public.studio_set_page_conversion(t,gen_random_uuid(),page.id,(a->>'updated_at')::timestamptz,item)->>'code'='not_allowed','page ID alone is not project authority');
 PERFORM pg_temp.studio_refuses(format('select public.growth_page_upsert(NULL,%L,%L,%L)', 'foreign-form-page','Test',jsonb_build_array(jsonb_build_object('type','conversion','destination',jsonb_build_object('kind','native_form','formId',foreign_form)))),'42501','foreign native form cannot enter an original page writer');
 item:=jsonb_build_object('type','conversion','destination',jsonb_build_object('kind','native_booking','slug','selected-native-calendar'));
 PERFORM public._growth_validate_conversion_resources(t,jsonb_build_array(item));
 PERFORM pg_temp.studio_assert(true,'same-tenant enabled calendar with original host is selectable');
 PERFORM pg_temp.studio_refuses(format('select public._growth_validate_conversion_resources(%L,%L)',t2,jsonb_build_array(item)),'42501','calendar slug format does not grant cross-tenant use');
 UPDATE public.calendars SET enabled=false WHERE id=calendar_id;
 PERFORM pg_temp.studio_refuses(format('select public._growth_validate_conversion_resources(%L,%L)',t,jsonb_build_array(item)),'42501','paused calendar cannot be silently activated or embedded');
 UPDATE public.calendars SET enabled=true WHERE id=calendar_id;
 INSERT INTO public.staff_calendar_settings(tenant_id,user_id,booking_page_slug,booking_page_title,booking_page_enabled)
  VALUES(t,u,'legacy-native-calendar','Legacy calendar',true);
 item:=jsonb_build_object('type','conversion','destination',jsonb_build_object('kind','native_booking','slug','legacy-native-calendar'));
 PERFORM public._growth_validate_conversion_resources(t,jsonb_build_array(item));
 PERFORM pg_temp.studio_assert(true,'original enabled legacy booking page remains selectable');
 INSERT INTO public.calendars(tenant_id,slug,title,enabled) VALUES(t2,'legacy-native-calendar','Other business calendar',true) RETURNING id INTO collision_calendar;
 INSERT INTO public.calendar_hosts(calendar_id,user_id) VALUES(collision_calendar,u);
 PERFORM pg_temp.studio_refuses(format('select public._growth_validate_conversion_resources(%L,%L)',t,jsonb_build_array(item)),'42501','public resolver first-class precedence cannot cross tenants via matching legacy slug');
 UPDATE public.calendars SET enabled=false WHERE id=collision_calendar;
 PERFORM public._growth_validate_conversion_resources(t,jsonb_build_array(item));
 PERFORM pg_temp.studio_assert(true,'disabled first-class page falls back exactly as original public resolver');
 page:=public._growth_page_go_live(t,page.id);
 PERFORM pg_temp.studio_assert(page.status='published' AND (SELECT status='active' FROM public.growth_forms WHERE id=form_id),'original page cascade publishes selected same-tenant native form');
 PERFORM pg_temp.studio_assert((SELECT status='draft' FROM public.growth_forms WHERE id=foreign_form),'original cascade never publishes foreign form');
 legacy_page:=public.growth_page_upsert(NULL,'legacy-signup-page','Legacy page','[{"type":"embedded_form","form_slug":"original-signup"}]',NULL,NULL,NULL,NULL);
 UPDATE public.studio_sessions SET artifact_refs=artifact_refs||jsonb_build_array(jsonb_build_object('kind','page','id',legacy_page.id)) WHERE id=project_id;
 readback:=public.studio_page_conversion(t,project_id,legacy_page.id);
 PERFORM pg_temp.studio_assert(readback#>>'{conversion,type}'='embedded_form' AND readback#>>'{conversion,form_slug}'='original-signup','refinement preserves original embedded-form typed source separately');
 PERFORM pg_temp.studio_assert((SELECT status='draft' FROM public.growth_forms WHERE tenant_id=t AND slug='original-signup'),'original embedded form authoring remains draft');
 PERFORM public._growth_page_go_live(t,legacy_page.id);
 PERFORM pg_temp.studio_assert((SELECT status='active' FROM public.growth_forms WHERE tenant_id=t AND slug='original-signup'),'original embedded-form publication cascade remains working');
 -- Unpublish/archival remains available even when the conversion target was withdrawn.
 UPDATE public.growth_forms SET status='archived' WHERE id=form_id;
 UPDATE public.growth_pages SET status='draft' WHERE id=page.id;
 PERFORM pg_temp.studio_assert((SELECT status='draft' FROM public.growth_pages WHERE id=page.id),'withdrawn destination cannot block page takedown');
 PERFORM pg_temp.studio_assert(NOT has_function_privilege('anon','public.studio_page_conversion(uuid,uuid,uuid)','execute')
  AND NOT has_function_privilege('service_role','public.studio_page_conversion(uuid,uuid,uuid)','execute'),'conversion refinement reader cannot impersonate browser actor');
END $conversion$;

-- Synthetic admission inputs, followed by the ACTUAL captured R2 acquire,
-- executor/state/evidence and immutable-column guards. This port does not
-- claim browser JWT verification or the complete Supabase admission schema.
CREATE FUNCTION pg_temp.chat_source(actor uuid,tenant uuid,recovery boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE thread uuid:=gen_random_uuid(); intent uuid:=gen_random_uuid(); source uuid:=gen_random_uuid();
 nonce uuid:=gen_random_uuid(); execution uuid:=gen_random_uuid(); deployment text:='testproject1_00000000-0000-4000-8000-000000000001_1'; bound jsonb;
BEGIN
 INSERT INTO public.paige_chat_threads(id,caller_user_id,tenant_id,lens,audience,is_archived,interactive_latest_intent,interactive_admitted_intent,interactive_recovery_hold)
  VALUES(thread,actor,tenant,'coach','workspace',false,intent,intent,CASE WHEN recovery THEN gen_random_uuid() ELSE NULL END);
 INSERT INTO public.paige_chat_turns(id,thread_id,role,content,bundle_ref,interactive_intent_id,interactive_actor_id,interactive_tenant_id)
  VALUES(source,thread,'user','Original requested project','{"original":"kept"}',intent,actor,tenant);
 bound:=public.paige_chat_interactive_acquire_bound(thread,actor,tenant,intent,nonce,execution,deployment);
 IF bound->'acquired' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Synthetic R2 acquire failed'; END IF;
 RETURN jsonb_build_object('thread',thread,'source',source,'intent',intent,'nonce',nonce,'execution',execution,'deployment',deployment);
END $$;
CREATE TEMP TABLE chat_studio_cases(label text PRIMARY KEY,value jsonb);
GRANT SELECT ON chat_studio_cases TO authenticated,service_role;
GRANT INSERT,SELECT ON studio_binding_assertions TO service_role;

DO $chat$
DECLARE
 t uuid:='f0060000-0000-4000-8000-000000000010'; u uuid:='f0060000-0000-4000-8000-000000000001';
 t2 uuid:='f0060000-0000-4000-8000-000000000020'; u2 uuid:='f0060000-0000-4000-8000-000000000002';
 c jsonb; n jsonb; original_binding jsonb; corrupt_binding jsonb; response jsonb; started jsonb; thread uuid; source uuid; intent uuid; nonce uuid;
 before_sessions integer; before_versions integer; before_threads integer; legacy_thread uuid; legacy_source uuid; active_context jsonb:='{"target":{"kind":"workspace"},"values":{"offers":"An actual requested offer"}}';
 parent uuid:=gen_random_uuid(); child uuid:=gen_random_uuid(); manager uuid:=gen_random_uuid(); agency_case jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 c:=pg_temp.chat_source(u,t); n:=pg_temp.chat_source(u,t);
 INSERT INTO chat_studio_cases VALUES('primary',c),('negative',n),('service-role',pg_temp.chat_source(u,t));
 thread:=(c->>'thread')::uuid; source:=(c->>'source')::uuid; intent:=(c->>'intent')::uuid; nonce:=(c->>'nonce')::uuid;
 SELECT count(*) INTO before_sessions FROM public.studio_sessions;
 SELECT count(*) INTO before_threads FROM public.paige_chat_threads;
 SELECT count(*) INTO before_versions FROM public.studio_artifact_versions;
 response:=public.chat_studio_scope(thread,u,t,intent,nonce);
 PERFORM pg_temp.studio_assert(response->'ok'='true' AND response->>'source_turn_id'=source::text,'actual original R2 lease and immutable admitted row supply source identity');
 response:=public.chat_stage_studio_brief(thread,u,t,intent,nonce,'Build the requested landing page');
 PERFORM pg_temp.studio_assert(response->>'outcome'='staged' AND response->>'source_turn_id'=source::text,'current original Chat source stages plain brief only');
 response:=public.chat_stage_studio_brief(thread,u,t,intent,nonce,'  Build the requested landing page  ');
 PERFORM pg_temp.studio_assert(response->>'outcome'='existing','identical staged content recovers same source after lost acknowledgment');
 response:=public.chat_stage_studio_brief(thread,u,t,intent,nonce,'Different private project');
 PERFORM pg_temp.studio_assert(response->>'code'='conflict' AND (SELECT studio_brief->>'brief'='Build the requested landing page' FROM public.paige_chat_turns WHERE id=source),'same source CAS refuses different prepared content');
 response:=public.chat_studio_reference(t,source);
 PERFORM pg_temp.studio_assert(response->>'state'='prepared' AND response->>'brief'='Build the requested landing page','authenticated same-source read returns actual preparation');
 PERFORM pg_temp.studio_assert((SELECT count(*)=before_sessions FROM public.studio_sessions)
  AND (SELECT count(*)=before_threads FROM public.paige_chat_threads)
  AND (SELECT count(*)=before_versions FROM public.studio_artifact_versions),'scope, stage and reference never create project/thread/version');
 PERFORM pg_temp.studio_assert((SELECT content='Original requested project' AND bundle_ref='{"original":"kept"}'::jsonb FROM public.paige_chat_turns WHERE id=source),'staging preserves original user content and bundle metadata');
 -- Actual terminal evidence closes staging; the historical prepared source stays useful.
 INSERT INTO public.paige_chat_turns(thread_id,role,content,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state)
  VALUES(thread,'assistant','Historical answer',intent,u,t,'FINAL');
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','terminal original intent cannot prepare again');
 PERFORM pg_temp.studio_assert(public.chat_stage_studio_brief(thread,u,t,intent,nonce,'Late preparation')->'ok'='false','native stage independently rechecks terminal after prior scope');
 PERFORM pg_temp.studio_assert(public.chat_studio_reference(t,source)->>'state'='prepared','terminal history retains same protected preparation');
 started:=public.chat_studio_start(t,source,active_context);
 PERFORM pg_temp.studio_assert(started->'ok'='true' AND started->'created'='true','person explicitly starts original Studio project from historical issued source');
 response:=public.chat_studio_start(t,source,active_context);
 PERFORM pg_temp.studio_assert(response->'created'='false' AND response->>'session_id'=started->>'session_id' AND response->>'thread_id'=started->>'thread_id','same-source retry returns same actual session/thread without generation');
 response:=public.chat_studio_reference(t,source);
 PERFORM pg_temp.studio_assert(response->>'state'='ready' AND response->>'session_id'=started->>'session_id' AND NOT(response ? 'brief'),'reloaded reference returns ready original ID rather than replaying brief');
 PERFORM pg_temp.studio_refuses(format('select public.chat_studio_start(%L,%L,%L)',t,source,'{}'),'40001','source-bound project context cannot be changed by retry');
 UPDATE public.paige_chat_threads SET interactive_latest_intent=gen_random_uuid(),interactive_executor_intent=NULL,interactive_runtime_binding=NULL WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_reference(t,source)->>'session_id'=started->>'session_id','later conversation runtime does not erase historical original project binding');
 PERFORM set_config('request.jwt.claim.sub',u2::text,true);
 PERFORM pg_temp.studio_assert(public.chat_studio_reference(t2,source)->'ok'='false','another actor cannot read a private issued source');
 PERFORM pg_temp.studio_assert(public.chat_studio_start(t2,source,'{}')->'ok'='false','another actor cannot start from a private issued source');
 PERFORM set_config('request.jwt.claim.sub',u::text,true);

 -- Active negative source is still unstaged, allowing exact lease tamper cases.
 thread:=(n->>'thread')::uuid; source:=(n->>'source')::uuid; intent:=(n->>'intent')::uuid; nonce:=(n->>'nonce')::uuid;
 SELECT interactive_runtime_binding INTO original_binding FROM public.paige_chat_turns WHERE id=source;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,gen_random_uuid())->'ok'='false','service role alone cannot replace server request nonce');
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u2,t2,intent,nonce)->'ok'='false','current foreign actor cannot borrow another thread lease');
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t2,intent,nonce)->'ok'='false','service tenant argument cannot override active actor workspace');
 UPDATE public.paige_chat_threads SET interactive_latest_intent=gen_random_uuid() WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','stale latest intent is refused');
 UPDATE public.paige_chat_threads SET interactive_latest_intent=intent,interactive_executor_intent=gen_random_uuid() WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','wrong original executor is refused');
 UPDATE public.paige_chat_threads SET interactive_executor_intent=intent,interactive_recovery_hold=gen_random_uuid() WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','actual original recovery hold is read-only');
 UPDATE public.paige_chat_threads SET interactive_recovery_hold=NULL,is_archived=true WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','archived workspace thread cannot prepare');
 UPDATE public.paige_chat_threads SET is_archived=false,audience='customer_private' WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','non-workspace source cannot prepare');
 UPDATE public.paige_chat_threads SET audience='workspace' WHERE id=thread;
 UPDATE public.paige_chat_turns SET interactive_runtime_binding=jsonb_set(original_binding,'{execution_id}',to_jsonb(gen_random_uuid())) WHERE id=source;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','turn/thread execution binding mismatch is refused');
 corrupt_binding:=jsonb_set(original_binding,'{admission_turn_id}',to_jsonb(gen_random_uuid()));
 UPDATE public.paige_chat_turns SET interactive_runtime_binding=corrupt_binding WHERE id=source;
 UPDATE public.paige_chat_threads SET interactive_runtime_binding=corrupt_binding WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','model-like substituted source identity is refused');
 UPDATE public.paige_chat_turns SET interactive_runtime_binding=jsonb_set(original_binding,'{mode}','"read_only_recovery"') WHERE id=source;
 UPDATE public.paige_chat_threads SET interactive_runtime_binding=jsonb_set(original_binding,'{mode}','"read_only_recovery"') WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','matching read-only runtime bindings do not permit preparation');
 UPDATE public.paige_chat_turns SET interactive_runtime_binding=original_binding WHERE id=source;
 UPDATE public.paige_chat_threads SET interactive_runtime_binding=original_binding WHERE id=thread;
 UPDATE public.tenant_members SET role='member' WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','service cannot lend Studio authority after native role revocation');
 UPDATE public.tenant_members SET role='owner' WHERE tenant_id=t AND user_id=u;
 UPDATE public.profiles SET active_tenant_id=t2 WHERE user_id=u;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','changed active profile invalidates previously verified request');
 UPDATE public.profiles SET active_tenant_id=t WHERE user_id=u;
 UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id=u;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','banned actor cannot use still-live runtime identity');
 UPDATE auth.users SET banned_until=NULL WHERE id=u;
 INSERT INTO public.paige_chat_turns(thread_id,role,content,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_supersedes_id)
  VALUES(thread,'user','Stop',gen_random_uuid(),u,t,intent);
 PERFORM pg_temp.studio_assert(public.chat_studio_scope(thread,u,t,intent,nonce)->'ok'='false','actual incumbent Stop evidence closes preparation');
 PERFORM pg_temp.studio_assert(public.chat_stage_studio_brief(thread,u,t,intent,nonce,'No late work')->'ok'='false','stage cannot evade original Stop after earlier checks');
 n:=pg_temp.chat_source(u,t,true);
 PERFORM pg_temp.studio_assert(public.chat_studio_scope((n->>'thread')::uuid,u,t,(n->>'intent')::uuid,(n->>'nonce')::uuid)->'ok'='false','actual acquire-bound read-only recovery cannot stage');
 legacy_thread:=gen_random_uuid(); legacy_source:=gen_random_uuid();
 INSERT INTO public.paige_chat_threads(id,caller_user_id,tenant_id,lens,audience,is_archived) VALUES(legacy_thread,u,t,'coach','workspace',false);
 INSERT INTO public.paige_chat_turns(id,thread_id,role,content) VALUES(legacy_source,legacy_thread,'user','Legacy unadmitted request');
 PERFORM pg_temp.studio_assert(public.chat_studio_reference(t,legacy_source)->'ok'='false','legacy user row is not trusted preparation evidence');
 PERFORM pg_temp.studio_refuses(format('update public.paige_chat_turns set studio_brief=%L where id=%L','{"brief":"Forged legacy source"}',legacy_source),'23514','new columns cannot prepopulate legacy/unadmitted source');
 PERFORM pg_temp.studio_assert(public.chat_stage_studio_brief(thread,u,t,intent,nonce,repeat('x',10001))->>'code'='invalid','oversized plain preparation refuses before touching source');
 PERFORM pg_temp.studio_assert(public.chat_stage_studio_brief(thread,u,t,intent,nonce,' ')->>'code'='invalid','empty preparation refuses');
 -- Original legitimate agency predicate remains available without forging auth.uid().
 INSERT INTO auth.users(id) VALUES(manager);
 INSERT INTO public.tenants(id,status,account_type,parent_tenant_id) VALUES(parent,'active','agency',NULL),(child,'active','sub_account',parent);
 INSERT INTO public.profiles(user_id,active_tenant_id) VALUES(manager,child);
 INSERT INTO public.agency_team_members(agency_tenant_id,user_id,status,agency_role,scoped_subaccounts) VALUES(parent,manager,'active','agency_specialist',ARRAY[child]);
 agency_case:=pg_temp.chat_source(manager,child);
 PERFORM pg_temp.studio_assert(public.chat_studio_scope((agency_case->>'thread')::uuid,manager,child,(agency_case->>'intent')::uuid,(agency_case->>'nonce')::uuid)->'ok'='true','original scoped agency eligibility is preserved in service preparation');
 UPDATE public.agency_team_members SET scoped_subaccounts='{}' WHERE user_id=manager;
 PERFORM pg_temp.studio_assert(public.chat_studio_scope((agency_case->>'thread')::uuid,manager,child,(agency_case->>'intent')::uuid,(agency_case->>'nonce')::uuid)->'ok'='false','revoked original agency scope closes preparation');
 PERFORM pg_temp.studio_assert(NOT has_function_privilege('authenticated','public.chat_stage_studio_brief(uuid,uuid,uuid,uuid,uuid,text)','execute')
  AND NOT has_function_privilege('authenticated','public.chat_studio_scope(uuid,uuid,uuid,uuid,uuid)','execute'),'browser cannot invoke runtime-scoped staging');
 PERFORM pg_temp.studio_assert(NOT has_function_privilege('service_role','public.chat_studio_reference(uuid,uuid)','execute')
  AND NOT has_function_privilege('service_role','public.chat_studio_start(uuid,uuid,jsonb)','execute'),'service preparation never impersonates explicit owner handoff');
END $chat$;

DO $receipts$
DECLARE
 t uuid:='f0060000-0000-4000-8000-000000000010'; u uuid:='f0060000-0000-4000-8000-000000000001';
 t2 uuid:='f0060000-0000-4000-8000-000000000020'; project uuid; page uuid; legacy_page uuid;
 ids uuid[]:='{}'; event_id uuid; first_tie uuid:='f0060000-0000-4000-8000-000000000091'; last_tie uuid:='f0060000-0000-4000-8000-000000000092';
 before_events integer; before_versions integer; revision timestamptz; response jsonb; repeated jsonb; item jsonb; private_detail jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 SELECT id INTO project FROM public.studio_sessions WHERE tenant_id=t AND studio_start_request_id='f0060000-0000-4000-8000-000000000031';
 SELECT id,updated_at INTO page,revision FROM public.growth_pages WHERE tenant_id=t AND slug='test-conversion-page';
 SELECT id INTO legacy_page FROM public.growth_pages WHERE tenant_id=t AND slug='legacy-signup-page';
 response:=public.studio_publication_receipts(t,project,legacy_page);
 PERFORM pg_temp.studio_assert(response->'ok'='true' AND response->'receipts'='[]'::jsonb,'published page flag never manufactures a native receipt');
 private_detail:=jsonb_build_object('page_id',page,'door','growth-publish-command','action','publish','status','published',
  'approval_fingerprint','synthetic-private-marker','request_nonce','synthetic-private-marker','raw_content','synthetic-private-marker');
 FOR i IN 1..6 LOOP
  event_id:=gen_random_uuid(); ids:=array_append(ids,event_id);
  INSERT INTO public.paige_workspace_events(id,tenant_id,actor_id,source_kind,source_id,capability_key,outcome,occurred_at,detail,actor_agent_label,job_attempt_id)
   VALUES(event_id,t,u,'capability_run',gen_random_uuid(),CASE WHEN i%2=0 THEN 'growth_page_unpublish' ELSE 'growth_page_publish' END,
    CASE WHEN i=6 THEN 'capability_outcome_unknown' ELSE 'capability_succeeded' END,'2030-01-01T00:00:00Z'::timestamptz+make_interval(secs=>i),private_detail,'synthetic-private-marker','synthetic-private-marker');
 END LOOP;
 INSERT INTO public.paige_workspace_events(id,tenant_id,actor_id,source_kind,source_id,capability_key,outcome,occurred_at,detail)
  VALUES(first_tie,t,u,'capability_run',gen_random_uuid(),'growth_page_publish','capability_succeeded','2030-01-01T00:00:07Z',private_detail),
   (last_tie,t,u,'capability_run',gen_random_uuid(),'growth_page_unpublish','capability_succeeded','2030-01-01T00:00:07Z',private_detail);
 -- Invalid provenance/tenant/door/page candidates are newer, so each would
 -- displace a genuine receipt if any owning predicate were omitted.
 INSERT INTO public.paige_workspace_events(tenant_id,actor_id,source_kind,source_id,capability_key,outcome,occurred_at,detail) VALUES
  (t2,u,'capability_run',gen_random_uuid(),'growth_page_publish','capability_succeeded','2031-01-01',private_detail),
  (t,u,'task',gen_random_uuid(),'growth_page_publish','capability_succeeded','2031-01-01',private_detail),
  (t,u,'capability_run',gen_random_uuid(),'growth_form_publish','capability_succeeded','2031-01-01',private_detail),
  (t,u,'capability_run',gen_random_uuid(),'growth_page_publish','capability_succeeded','2031-01-01',private_detail||'{"door":"other-door"}'),
  (t,u,'capability_run',gen_random_uuid(),'growth_page_publish','capability_succeeded','2031-01-01',private_detail||jsonb_build_object('page_id',gen_random_uuid()));
 SELECT count(*) INTO before_events FROM public.paige_workspace_events;
 SELECT count(*) INTO before_versions FROM public.studio_artifact_versions;
 response:=public.studio_publication_receipts(t,project,page);
 PERFORM pg_temp.studio_assert(response->'ok'='true' AND jsonb_array_length(response->'receipts')=5,'receipt reader returns only latest five original publication events');
 PERFORM pg_temp.studio_assert(response#>>'{receipts,0,id}'=last_tie::text AND response#>>'{receipts,1,id}'=first_tie::text
  AND response#>>'{receipts,2,id}'=ids[6]::text AND response#>>'{receipts,4,id}'=ids[4]::text,'native event identity and timestamp/id ordering are preserved');
 FOR item IN SELECT value FROM jsonb_array_elements(response->'receipts') LOOP
  PERFORM pg_temp.studio_assert((SELECT count(*)=4 FROM jsonb_object_keys(item))
   AND item ?& ARRAY['id','occurred_at','capability_key','outcome'],'receipt projection exposes exactly four safe native fields');
 END LOOP;
 PERFORM pg_temp.studio_assert(response::text NOT LIKE '%synthetic-private-marker%' AND response::text NOT LIKE '%request_nonce%'
  AND response::text NOT LIKE '%approval_fingerprint%' AND response::text NOT LIKE '%actor_id%','private event detail and actor/runtime metadata never leave reader');
 PERFORM pg_temp.studio_assert(response#>>'{receipts,2,outcome}'='capability_outcome_unknown','unknown original event outcome is not promoted to success');
 repeated:=public.studio_publication_receipts(t,project,page);
 PERFORM pg_temp.studio_assert(repeated=response AND (SELECT count(*)=before_events FROM public.paige_workspace_events)
  AND (SELECT count(*)=before_versions FROM public.studio_artifact_versions)
  AND (SELECT updated_at=revision FROM public.growth_pages WHERE id=page),'receipt reload is stable and creates no event/version/page write');
 PERFORM pg_temp.studio_assert(public.studio_publication_receipts(t,gen_random_uuid(),page)->>'code'='not_allowed','receipt page pointer requires original project binding');
 PERFORM pg_temp.studio_assert(public.studio_publication_receipts(t,project,gen_random_uuid())->>'code'='not_allowed','unbound page cannot expose original Rail history');
 PERFORM pg_temp.studio_assert(public.studio_publication_receipts(t2,project,page)->>'code'='scope_changed','wrong current tenant cannot use private receipt projection');
 UPDATE public.tenant_members SET role='member' WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_assert(public.studio_publication_receipts(t,project,page)->>'code'='scope_changed','revoked author cannot recover private publication history');
 UPDATE public.tenant_members SET role='owner' WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_assert(NOT has_table_privilege('authenticated','public.paige_workspace_events','SELECT')
  AND NOT has_any_column_privilege('authenticated','public.paige_workspace_events','SELECT'),'original Rail stays private with no table or column grant');
 PERFORM pg_temp.studio_assert(NOT has_function_privilege('service_role','public.studio_publication_receipts(uuid,uuid,uuid)','execute')
  AND NOT has_function_privilege('anon','public.studio_publication_receipts(uuid,uuid,uuid)','execute'),'publication history requires actual authenticated owner scope');
END $receipts$;

-- Exercise the actual SQL role too; JWT verification remains outside this local port.
SET LOCAL ROLE authenticated;
SELECT pg_temp.studio_assert(public.studio_lookup_project_start('f0060000-0000-4000-8000-000000000010','f0060000-0000-4000-8000-000000000030')->'ok'='true','ordinary authenticated role uses protected recovery RPC');
SELECT pg_temp.studio_refuses($q$update public.studio_sessions set studio_start_request_id=gen_random_uuid(),studio_start_digest=repeat('a',64) where studio_start_request_id='f0060000-0000-4000-8000-000000000030'$q$,'42501','table grant cannot forge original request binding');
SELECT pg_temp.studio_assert(public.chat_studio_reference('f0060000-0000-4000-8000-000000000010',(SELECT(value->>'source')::uuid FROM chat_studio_cases WHERE label='primary'))->>'state'='ready','actual authenticated SQL role reopens historical original project');
SELECT pg_temp.studio_refuses('select id from public.paige_workspace_events limit 1','42501','ordinary actor cannot directly select original private Rail');
SELECT pg_temp.studio_refuses(format('update public.paige_chat_turns set studio_brief=%L where id=%L','{"brief":"Forged prepared text"}',(SELECT value->>'source' FROM chat_studio_cases WHERE label='primary')),'42501','incumbent issued-row guard protects new preparation field');
SELECT pg_temp.studio_refuses(format('update public.paige_chat_turns set studio_session_id=gen_random_uuid() where id=%L',(SELECT value->>'source' FROM chat_studio_cases WHERE label='primary')),'42501','incumbent issued-row guard protects new ready reference');
SELECT pg_temp.studio_refuses(format('update public.paige_chat_turns set interactive_intent_id=NULL,interactive_actor_id=NULL,interactive_tenant_id=NULL,studio_brief=NULL,studio_session_id=NULL where id=%L',(SELECT value->>'source' FROM chat_studio_cases WHERE label='primary')),'42501','clearing authority fields cannot bypass incumbent old-row immutability');
SELECT pg_temp.studio_refuses(format('insert into public.paige_chat_turns(thread_id,role,content,interactive_intent_id,interactive_actor_id,interactive_tenant_id) values(%L,%L,%L,gen_random_uuid(),%L,%L)',(SELECT value->>'thread' FROM chat_studio_cases WHERE label='primary'),'user','Forged issued source','f0060000-0000-4000-8000-000000000001','f0060000-0000-4000-8000-000000000010'),'42501','browser cannot insert its own admitted source');
SELECT pg_temp.studio_refuses(format('insert into public.paige_chat_turns(thread_id,role,content,studio_brief) values(%L,%L,%L,%L)',(SELECT value->>'thread' FROM chat_studio_cases WHERE label='primary'),'user','Unadmitted source','{"brief":"Forged prepopulation"}'),'23514','browser cannot prepopulate legacy row with new preparation fields');
SELECT pg_temp.studio_refuses(format('update public.paige_chat_threads set interactive_executor_intent=gen_random_uuid() where id=%L',(SELECT value->>'thread' FROM chat_studio_cases WHERE label='primary')),'42501','original thread guard protects executor authority');
SELECT pg_temp.studio_refuses(format('update public.paige_chat_threads set interactive_runtime_binding=%L where id=%L','{"mode":"normal"}',(SELECT value->>'thread' FROM chat_studio_cases WHERE label='primary')),'42501','original runtime guard protects binding authority');
RESET ROLE;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL ROLE service_role;
SELECT pg_temp.studio_assert(auth.uid() IS NULL,'service preparation does not forge a signed-in user');
SELECT pg_temp.studio_assert((SELECT public.chat_stage_studio_brief((value->>'thread')::uuid,'f0060000-0000-4000-8000-000000000001','f0060000-0000-4000-8000-000000000010',(value->>'intent')::uuid,(value->>'nonce')::uuid,'Actual service-role preparation')->>'outcome'='staged' FROM chat_studio_cases WHERE label='service-role'),'actual service role stages only with original runtime-issued nonce');
SELECT pg_temp.studio_assert((SELECT public.chat_studio_scope((value->>'thread')::uuid,'f0060000-0000-4000-8000-000000000001','f0060000-0000-4000-8000-000000000010',(value->>'intent')::uuid,gen_random_uuid())->'ok'='false' FROM chat_studio_cases WHERE label='service-role'),'actual service key alone cannot replace issued nonce');
SELECT pg_temp.studio_refuses(format('select public.chat_studio_start(%L,%L,%L)','f0060000-0000-4000-8000-000000000010',(SELECT value->>'source' FROM chat_studio_cases WHERE label='service-role'),'{}'),'42501','service staging cannot execute explicit browser start');
RESET ROLE;
SELECT count(*) AS passed_native_studio_assertions FROM studio_binding_assertions;
ROLLBACK;
