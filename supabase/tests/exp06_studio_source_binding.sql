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

DO $legacy_conversion$
DECLARE
 t uuid:='f0060000-0000-4000-8000-000000000010'; u uuid:='f0060000-0000-4000-8000-000000000001'; project uuid;
 destination_kind text; suffix text; primary_slug text; additional_slug text; calendar_id uuid;
 page public.growth_pages; previous_version public.studio_artifact_versions; saved_version public.studio_artifact_versions;
 blocks jsonb; chosen jsonb; response jsonb; repeated jsonb; scratchpad jsonb; other_history jsonb; versions_before integer;
 retained_theme jsonb:='{"primary":"#123456","accent":"#fedcba"}'; retained_seo jsonb:='{"description":"Retained legacy metadata"}';
BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 SELECT id INTO project FROM public.studio_sessions WHERE tenant_id=t AND studio_start_request_id='f0060000-0000-4000-8000-000000000031';
 UPDATE public.studio_sessions SET studio_session_scratchpad=studio_session_scratchpad||'{"legacy_replacement_note":"Retain original working memory"}' WHERE id=project;
 SELECT studio_session_scratchpad INTO scratchpad FROM public.studio_sessions WHERE id=project;
 INSERT INTO public.calendars(tenant_id,slug,title,enabled) VALUES(t,'legacy-replacement-calendar','Existing published calendar',true) RETURNING id INTO calendar_id;
 INSERT INTO public.calendar_hosts(calendar_id,user_id) VALUES(calendar_id,u);
 FOREACH destination_kind IN ARRAY ARRAY['external_booking','native_booking'] LOOP
  suffix:=replace(destination_kind,'_','-'); primary_slug:='legacy-primary-'||suffix; additional_slug:='legacy-additional-'||suffix;
  blocks:=jsonb_build_array('{"type":"hero","title":"Retain the original heading"}'::jsonb,
   jsonb_build_object('type','embedded_form','form_slug',primary_slug,'title','Original primary signup'),
   '{"type":"rich_text","html":"<p>Retain the original explanation.</p>"}'::jsonb,
   jsonb_build_object('type','embedded_form','form_slug',additional_slug,'title','Independent additional signup'),
   '{"type":"cta","title":"Retain the original ending","cta_label":"Read more","cta_href":"https://public-business.com/about"}'::jsonb);
  page:=public.growth_page_upsert(NULL,'legacy-replacement-'||suffix,'Original legacy page',blocks,retained_theme,retained_seo,NULL,NULL);
  UPDATE public.studio_sessions SET artifact_refs=artifact_refs||jsonb_build_array(jsonb_build_object('kind','page','id',page.id)) WHERE id=project;
  previous_version:=public.save_artifact_version(project,'page',page.id,NULL);
  SELECT count(*) INTO versions_before FROM public.studio_artifact_versions WHERE session_id=project AND lineage_id=page.id;
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]'::jsonb) INTO other_history FROM public.studio_artifact_versions v WHERE lineage_id<>page.id;
  chosen:=jsonb_build_object('type','conversion','title','Choose the actual next step','destination',CASE destination_kind
   WHEN 'external_booking' THEN '{"kind":"external_booking","mode":"link","url":"https://calendly.com/test-business/intro","provider":"calendly"}'::jsonb
   ELSE '{"kind":"native_booking","slug":"legacy-replacement-calendar"}'::jsonb END);
  response:=public.studio_set_page_conversion(t,project,page.id,page.updated_at,chosen);
  -- Regression first: the predecessor appends a sixth block and keeps publishing
  -- the primary legacy form. This must replace the SAME saved primary choice.
  PERFORM pg_temp.studio_assert(response->'ok'='true' AND response->'changed'='true'
   AND jsonb_array_length(response#>'{page,draft_blocks_json}')=5 AND response#>'{page,draft_blocks_json,1}'=chosen,
   'legacy '||destination_kind||' replaces original primary form instead of appending');
  PERFORM pg_temp.studio_assert(response#>'{page,draft_blocks_json,0}'=blocks->0 AND response#>'{page,draft_blocks_json,2}'=blocks->2
   AND response#>'{page,draft_blocks_json,3}'=blocks->3 AND response#>'{page,draft_blocks_json,4}'=blocks->4,
   'legacy replacement preserves every unrelated block including additional form');
  PERFORM pg_temp.studio_assert(response#>'{page,draft_theme_json}'=retained_theme AND response#>'{page,draft_seo_json}'=retained_seo
   AND response#>>'{page,slug}'=page.slug AND response#>>'{page,title}'=page.title,'legacy replacement preserves theme, metadata, title and address');
  PERFORM pg_temp.studio_assert((SELECT studio_session_scratchpad=scratchpad FROM public.studio_sessions WHERE id=project),
   'legacy replacement preserves original project working memory');
  SELECT * INTO saved_version FROM public.studio_artifact_versions WHERE id=(response->>'version_id')::uuid;
  PERFORM pg_temp.studio_assert(saved_version.is_current AND saved_version.version_no=previous_version.version_no+1
   AND saved_version.snapshot=response->'page' AND (SELECT count(*)=versions_before+1 FROM public.studio_artifact_versions WHERE session_id=project AND lineage_id=page.id),
   'legacy replacement records exactly one original saved version');
  PERFORM pg_temp.studio_assert((SELECT snapshot=previous_version.snapshot AND version_no=previous_version.version_no AND NOT is_current
   FROM public.studio_artifact_versions WHERE id=previous_version.id),'legacy replacement retains original version snapshot and lineage');
  PERFORM pg_temp.studio_assert((SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]'::jsonb)=other_history FROM public.studio_artifact_versions v WHERE lineage_id<>page.id),
   'legacy replacement leaves unrelated version history untouched');
  repeated:=public.studio_set_page_conversion(t,project,page.id,page.updated_at,chosen);
  PERFORM pg_temp.studio_assert(repeated->'changed'='false' AND repeated->>'version_id'=response->>'version_id'
   AND (SELECT count(*)=versions_before+1 FROM public.studio_artifact_versions WHERE session_id=project AND lineage_id=page.id),
   'legacy replacement lost-response retry returns same saved version');
  PERFORM pg_temp.studio_assert(public.studio_page_conversion(t,project,page.id)->'conversion'=chosen,
   'legacy replacement source reader returns the same selected primary destination');
  page:=public._growth_page_go_live(t,page.id);
  PERFORM pg_temp.studio_assert(page.blocks_json->1=chosen AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(page.blocks_json) b
   WHERE b->>'type'='embedded_form' AND b->>'form_slug'=primary_slug),'published replacement has no stale primary form block');
  PERFORM pg_temp.studio_assert((SELECT status='draft' FROM public.growth_forms WHERE tenant_id=t AND slug=primary_slug),
   'replacement does not publish the removed primary form');
  PERFORM pg_temp.studio_assert((SELECT status='active' FROM public.growth_forms WHERE tenant_id=t AND slug=additional_slug),
   'replacement preserves original publication of unrelated additional form');
 END LOOP;
 -- A canonical conversion remains primary even when an additional legacy form
 -- occurs earlier in the page. The fallback must not select that earlier form.
 blocks:=jsonb_build_array(jsonb_build_object('type','embedded_form','form_slug','legacy-before-canonical'),chosen);
 page:=public.growth_page_upsert(NULL,'canonical-primary-before-legacy','Canonical primary page',blocks,retained_theme,retained_seo,NULL,NULL);
 UPDATE public.studio_sessions SET artifact_refs=artifact_refs||jsonb_build_array(jsonb_build_object('kind','page','id',page.id)) WHERE id=project;
 PERFORM public.save_artifact_version(project,'page',page.id,NULL);
 chosen:=jsonb_build_object('type','conversion','destination','{"kind":"external_booking","mode":"link","url":"https://calendly.com/test-business/intro","provider":"calendly"}'::jsonb);
 response:=public.studio_set_page_conversion(t,project,page.id,page.updated_at,chosen);
 PERFORM pg_temp.studio_assert(jsonb_array_length(response#>'{page,draft_blocks_json}')=2 AND response#>'{page,draft_blocks_json,0}'=blocks->0
  AND response#>'{page,draft_blocks_json,1}'=chosen,'canonical primary is replaced before any earlier additional legacy form');
END $legacy_conversion$;

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

DO $source_projection$
DECLARE
 t uuid:='f0060000-0000-4000-8000-000000000010'; u uuid:='f0060000-0000-4000-8000-000000000001';
 t2 uuid:='f0060000-0000-4000-8000-000000000020'; u2 uuid:='f0060000-0000-4000-8000-000000000002';
 c jsonb; other jsonb; response jsonb; repeated jsonb; source uuid; thread uuid; legacy uuid; assistant uuid;
 binding jsonb; before_turns jsonb; before_thread jsonb; before_sessions bigint; before_versions bigint; before_audits bigint;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 c:=pg_temp.chat_source(u,t); other:=pg_temp.chat_source(u,t);
 thread:=(c->>'thread')::uuid; source:=(c->>'source')::uuid;
 response:=public.chat_studio_sources(t,thread,ARRAY[source]);
 PERFORM pg_temp.studio_assert(response='{"ok":true,"source_turn_ids":[]}'::jsonb,'unstaged issued source is not discovered as prepared');
 PERFORM public.chat_stage_studio_brief(thread,u,t,(c->>'intent')::uuid,(c->>'nonce')::uuid,'A committed preparation with lost stage and assistant acknowledgments');
 PERFORM public.chat_stage_studio_brief((other->>'thread')::uuid,u,t,(other->>'intent')::uuid,(other->>'nonce')::uuid,'Prepared in a different original thread');
 INSERT INTO chat_studio_cases VALUES('lost-ack-projection',c);
 response:=public.chat_studio_sources(t,thread,ARRAY[source]);
 PERFORM pg_temp.studio_assert(response=jsonb_build_object('ok',true,'source_turn_ids',jsonb_build_array(source)),
  'lost stage and assistant acknowledgments recover only the actual original source pointer');
 PERFORM pg_temp.studio_assert(NOT EXISTS(SELECT 1 FROM public.paige_chat_turns WHERE thread_id=thread AND role='assistant')
  AND (SELECT bundle_ref='{"original":"kept"}'::jsonb AND studio_session_id IS NULL FROM public.paige_chat_turns WHERE id=source),
  'source recovery needs no fabricated assistant, bundle mutation or ready project');
 legacy:=gen_random_uuid(); assistant:=gen_random_uuid();
 INSERT INTO public.paige_chat_turns(id,thread_id,role,content) VALUES(legacy,thread,'user','An unadmitted loaded user message'),(assistant,thread,'assistant','An ordinary loaded answer');
 response:=public.chat_studio_sources(t,thread,ARRAY[legacy,(other->>'source')::uuid,source,assistant,source,gen_random_uuid()]);
 PERFORM pg_temp.studio_assert(response=jsonb_build_object('ok',true,'source_turn_ids',jsonb_build_array(source)),
  'loaded legacy, assistant, foreign-thread, duplicate and invented pointers cannot widen discovery');
 PERFORM pg_temp.studio_assert((SELECT count(*)=2 FROM jsonb_object_keys(response)) AND NOT(response ?| ARRAY['brief','state','session_id','history','request_nonce']),
  'history projection returns exactly ok and source IDs without content or status');
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,'{}'::uuid[])='{"ok":true,"source_turn_ids":[]}'::jsonb,'empty loaded-user batch returns an honest empty projection');
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,array_fill(source,ARRAY[50]))->'source_turn_ids'=jsonb_build_array(source),'maximum fifty loaded IDs are bounded and deduplicated');
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,array_fill(source,ARRAY[51]))->>'code'='invalid','more than fifty loaded IDs refuse');
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,NULL)->>'code'='invalid','unknown loaded-user batch refuses');
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,ARRAY[source,NULL])->>'code'='invalid','NULL loaded ID refuses rather than widening discovery');
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,ARRAY[ARRAY[source]])->>'code'='invalid','multidimensional loaded ID input refuses');
 SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) INTO before_turns FROM public.paige_chat_turns s;
 SELECT to_jsonb(th) INTO before_thread FROM public.paige_chat_threads th WHERE id=thread;
 SELECT count(*) INTO before_sessions FROM public.studio_sessions;
 SELECT count(*) INTO before_versions FROM public.studio_artifact_versions;
 SELECT count(*) INTO before_audits FROM public.audit_logs;
 repeated:=public.chat_studio_sources(t,thread,ARRAY[source]);
 PERFORM pg_temp.studio_assert(repeated=jsonb_build_object('ok',true,'source_turn_ids',jsonb_build_array(source))
  AND (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)=before_turns FROM public.paige_chat_turns s)
  AND (SELECT to_jsonb(th)=before_thread FROM public.paige_chat_threads th WHERE id=thread)
  AND (SELECT count(*)=before_sessions FROM public.studio_sessions)
  AND (SELECT count(*)=before_versions FROM public.studio_artifact_versions)
  AND (SELECT count(*)=before_audits FROM public.audit_logs),'repeated loaded-source discovery performs zero source, thread, project, version or audit writes');
 UPDATE public.paige_chat_threads SET interactive_latest_intent=gen_random_uuid(),interactive_executor_intent=NULL,interactive_runtime_binding=NULL WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,ARRAY[source])->'source_turn_ids'=jsonb_build_array(source),
  'later native runtime preserves historical issued-source discoverability without replay');
 SELECT interactive_runtime_binding INTO binding FROM public.paige_chat_turns WHERE id=source;
 UPDATE public.paige_chat_turns SET interactive_runtime_binding=jsonb_set(binding,'{function_slug}','"invented-runtime"') WHERE id=source;
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,ARRAY[source])->'source_turn_ids'='[]'::jsonb,'invalid original runtime issuance cannot be recovered as a source');
 UPDATE public.paige_chat_turns SET interactive_runtime_binding=binding WHERE id=source;
 UPDATE public.paige_chat_threads SET is_archived=true WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,ARRAY[source])->>'code'='not_allowed','archived original history refuses source projection');
 UPDATE public.paige_chat_threads SET is_archived=false,audience='customer_private' WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,ARRAY[source])->>'code'='not_allowed','private audience cannot enter workspace source projection');
 UPDATE public.paige_chat_threads SET audience='workspace' WHERE id=thread;
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,gen_random_uuid(),ARRAY[source])->>'code'='not_allowed','loaded ID never authorizes a different thread');
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t2,thread,ARRAY[source])->>'code'='scope_changed','wrong active tenant refuses source projection');
 PERFORM set_config('request.jwt.claim.sub',u2::text,true);
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t2,thread,ARRAY[source])->>'code'='not_allowed','different actual actor cannot project another actors original history');
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 UPDATE public.tenant_members SET role='member' WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,ARRAY[source])->>'code'='scope_changed','revoked Studio authority refuses loaded-source recovery');
 UPDATE public.tenant_members SET role='owner' WHERE tenant_id=t AND user_id=u;
 DELETE FROM public.paige_chat_turns WHERE id=source;
 PERFORM pg_temp.studio_assert(public.chat_studio_sources(t,thread,ARRAY[source])->'source_turn_ids'='[]'::jsonb,'deleted source is not reconstructed from history pointers');
 PERFORM pg_temp.studio_assert(NOT has_function_privilege('service_role','public.chat_studio_sources(uuid,uuid,uuid[])','execute')
  AND NOT has_function_privilege('anon','public.chat_studio_sources(uuid,uuid,uuid[])','execute'),'batch history recovery has no service or anonymous impersonation path');
END $source_projection$;

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


DO $page_save_cas$
DECLARE
 t uuid:='f0060000-0000-4000-8000-000000000010'; u uuid:='f0060000-0000-4000-8000-000000000001';
 t2 uuid:='f0060000-0000-4000-8000-000000000020'; project uuid; empty_project uuid; page_id uuid;
 context jsonb:='{"target":{"kind":"workspace"},"values":{"offers":"Current project offer"}}'; changed_context jsonb;
 source jsonb; before_source jsonb; response jsonb; recovered jsonb; b_source jsonb; c_source jsonb;
 blocks_a jsonb:='[{"type":"hero","title":"Generation A"}]'; blocks_b jsonb:='[{"type":"hero","title":"Generation B"}]';
 conversion jsonb:='{"type":"conversion","destination":{"kind":"external_booking","mode":"link","provider":"other","url":"https://public-business.com/book"}}';
 existing public.growth_pages; legacy public.growth_pages; before_versions bigint; before_audits bigint; before_pages bigint; before_sessions jsonb;
 form_id uuid; history jsonb; snapshot jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 response:=public.studio_start_project(t,gen_random_uuid(),'Atomic Studio save',context); project:=(response->>'session_id')::uuid;
 response:=public.studio_start_project(t,gen_random_uuid(),'Unselected legacy project','{}'); empty_project:=(response->>'session_id')::uuid;
 PERFORM pg_temp.studio_assert(public.studio_page_save_source(t,empty_project,NULL)->>'code'='invalid','generation source refuses unselected context instead of guessing workspace');
 UPDATE public.studio_sessions SET studio_session_scratchpad=studio_session_scratchpad||'{"current_goal":"Retain original memory","tried":["Earlier approach"]}' WHERE id=project;
 SELECT to_jsonb(s) INTO before_sessions FROM public.studio_sessions s WHERE id=project;
 source:=public.studio_page_save_source(t,project,NULL);
 PERFORM pg_temp.studio_assert(source->'ok'='true' AND (SELECT count(*)=8 FROM jsonb_object_keys(source))
  AND source->'artifact_refs'='[]'::jsonb AND source->'project_context'=context AND source->'page_id'='null'::jsonb
  AND source->'updated_at'='null'::jsonb AND source->'conversion'='null'::jsonb,'new-page source contains only actual native project snapshot and explicit absence');
 PERFORM pg_temp.studio_assert((SELECT to_jsonb(s)=before_sessions FROM public.studio_sessions s WHERE id=project),'generation source snapshot performs zero project writes');
 response:=public.studio_page_save_state(t,project,source->'artifact_refs',context,NULL,NULL,NULL,'atomic-studio-page','Atomic title',blocks_a,'{"primary":"#123456"}','{"description":"Original SEO"}',NULL);
 PERFORM pg_temp.studio_assert(response->>'code'='unknown','unknown absent-page lookup never creates a placeholder or claims a save');
 response:=public.studio_save_page(t,project,source->'artifact_refs',context,NULL,NULL,NULL,'atomic-studio-page','Atomic title',blocks_a,'{"primary":"#123456"}','{"description":"Original SEO"}',NULL);
 page_id:=(response#>>'{page,id}')::uuid;
 PERFORM pg_temp.studio_assert(response->'ok'='true' AND response->'changed'='true' AND response->'reconciled'='false' AND page_id IS NOT NULL,'atomic save uses original creator actual ID then original upsert');
 PERFORM pg_temp.studio_assert(response#>>'{page,slug}'='atomic-studio-page' AND response#>'{page,draft_blocks_json}'=blocks_a
  AND response#>'{page,draft_theme_json}'='{"primary":"#123456"}'::jsonb AND response#>'{page,draft_seo_json}'='{"description":"Original SEO"}'::jsonb,'original save retains desired slug, blocks, theme and SEO semantics');
 PERFORM pg_temp.studio_assert((SELECT jsonb_array_length(artifact_refs)=1 AND artifact_refs#>>'{0,id}'=page_id::text
  AND artifact_refs#>>'{0,slug}'='atomic-studio-page' AND artifact_refs#>>'{0,title}'='Atomic title'
  AND studio_session_scratchpad->>'current_goal'='Retain original memory'
  AND studio_session_scratchpad->'tried'='["Earlier approach"]'::jsonb FROM public.studio_sessions WHERE id=project),'actual original manifest reference is refreshed without replacing working memory');
 PERFORM pg_temp.studio_assert((SELECT count(*)=1 AND bool_and(is_current) FROM public.studio_artifact_versions WHERE session_id=project AND kind='page' AND lineage_id=page_id),'native atomic save records one original current page version');
 SELECT count(*) INTO before_versions FROM public.studio_artifact_versions;
 SELECT count(*) INTO before_audits FROM public.audit_logs;
 SELECT count(*) INTO before_pages FROM public.growth_pages;
 SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) INTO history FROM public.studio_artifact_versions v;
 recovered:=public.studio_page_save_state(t,project,source->'artifact_refs',context,NULL,NULL,NULL,'atomic-studio-page','Atomic title',blocks_a,'{"primary":"#123456"}','{"description":"Original SEO"}',NULL);
 PERFORM pg_temp.studio_assert(recovered->'ok'='true' AND recovered->'reconciled'='true' AND recovered->'changed'='false'
  AND recovered#>>'{page,id}'=page_id::text AND recovered->>'version_id'=response->>'version_id','lost new-page ACK recovers same actual original page and version from manifest delta');
 recovered:=public.studio_save_page(t,project,source->'artifact_refs',context,NULL,NULL,NULL,'atomic-studio-page','Atomic title',blocks_a,'{"primary":"#123456"}','{"description":"Original SEO"}',NULL);
 PERFORM pg_temp.studio_assert(recovered->'reconciled'='true' AND recovered#>>'{page,id}'=page_id::text
  AND (SELECT count(*)=before_pages FROM public.growth_pages) AND (SELECT count(*)=before_audits FROM public.audit_logs)
  AND (SELECT count(*)=before_versions FROM public.studio_artifact_versions),'same-source lost-ACK retry performs no page, link, audit or version write');
 PERFORM pg_temp.studio_refuses(format('select public.studio_save_page(%L,%L,%L,%L,NULL,NULL,NULL,%L,%L,%L,NULL,NULL,NULL)',t,project,source->'artifact_refs',context,'atomic-studio-page','Different generation',blocks_b),'40001','two new-page results from same absent manifest cannot create or overwrite twice');
 PERFORM pg_temp.studio_assert((SELECT draft_blocks_json=blocks_a FROM public.growth_pages WHERE id=page_id),'losing new-page result preserves first committed page');
 before_source:=public.studio_page_save_source(t,project,page_id);
 PERFORM pg_temp.studio_assert(before_source->>'page_id'=page_id::text AND before_source->'conversion'='null'::jsonb
  AND before_source->'updated_at'=response#>'{page,updated_at}','existing source returns actual bound page revision and no invented conversion');
 response:=public.studio_save_page(t,project,before_source->'artifact_refs',context,page_id,(before_source->>'updated_at')::timestamptz,NULL,
  'atomic-studio-page','Newer B title',blocks_b,NULL,NULL,NULL);
 PERFORM pg_temp.studio_assert(response->'changed'='true' AND response#>'{page,draft_blocks_json}'=blocks_b,'newer native generation B saves through original page/version writer');
 snapshot:=response->'page';
 PERFORM pg_temp.studio_refuses(format('select public.studio_save_page(%L,%L,%L,%L,%L,%L,NULL,%L,%L,%L,NULL,NULL,NULL)',t,project,before_source->'artifact_refs',context,page_id,before_source->>'updated_at','atomic-studio-page','Late A title',blocks_a),'40001','late generation A cannot overwrite page B after source snapshot');
 PERFORM pg_temp.studio_assert((SELECT to_jsonb(p)=snapshot FROM public.growth_pages p WHERE id=page_id),'failed cross-tab stale save preserves exact B row');
 recovered:=public.studio_page_save_state(t,project,before_source->'artifact_refs',context,page_id,(before_source->>'updated_at')::timestamptz,NULL,
  'atomic-studio-page','Newer B title',blocks_b,NULL,NULL,NULL);
 PERFORM pg_temp.studio_assert(recovered->'ok'='true' AND recovered->>'version_id'=response->>'version_id','existing-page unknown ACK reads same original current version without re-saving');
 b_source:=public.studio_page_save_source(t,project,page_id);
 changed_context:=jsonb_set(context,'{values,offers}','"Changed explicit project offer"');
 PERFORM public.studio_set_project_context(t,project,changed_context,context);
 response:=public.studio_save_page(t,project,b_source->'artifact_refs',context,page_id,(b_source->>'updated_at')::timestamptz,NULL,
  'atomic-studio-page','Stale project context',blocks_a,NULL,NULL,NULL);
 PERFORM pg_temp.studio_assert(response->>'code'='changed' AND (SELECT to_jsonb(p)=snapshot FROM public.growth_pages p WHERE id=page_id),'changed project context refuses late generated result before page effect');
 PERFORM public.studio_set_project_context(t,project,context,changed_context);
 response:=public.studio_set_page_conversion(t,project,page_id,(b_source->>'updated_at')::timestamptz,conversion);
 PERFORM pg_temp.studio_refuses(format('select public.studio_save_page(%L,%L,%L,%L,%L,%L,NULL,%L,%L,%L,NULL,NULL,NULL)',t,project,b_source->'artifact_refs',context,page_id,b_source->>'updated_at','atomic-studio-page','Model removed conversion',blocks_a),'40001','late model result cannot remove newly saved actual conversion');
 c_source:=public.studio_page_save_source(t,project,page_id);
 response:=public.studio_save_page(t,project,c_source->'artifact_refs',context,page_id,(c_source->>'updated_at')::timestamptz,conversion,
  'atomic-studio-page','Model changed conversion',blocks_a,NULL,NULL,NULL);
 PERFORM pg_temp.studio_assert(response->>'code'='changed','desired blocks cannot silently drop conversion even with current revision');
 response:=public.studio_save_page(t,project,c_source->'artifact_refs',context,page_id,(c_source->>'updated_at')::timestamptz,conversion,
  'atomic-studio-page','Conversion retained',blocks_a||jsonb_build_array(conversion),NULL,NULL,NULL);
 PERFORM pg_temp.studio_assert(response->'ok'='true' AND response#>'{page,draft_blocks_json,1}'=conversion,'current native source permits refinement that retains actual selected conversion');
 SELECT count(*) INTO before_audits FROM public.audit_logs;
 UPDATE public.studio_sessions SET artifact_refs=artifact_refs||jsonb_build_array(jsonb_build_object('kind','content','id',gen_random_uuid())) WHERE id=project;
 recovered:=public.studio_page_save_state(t,project,c_source->'artifact_refs',context,page_id,(c_source->>'updated_at')::timestamptz,conversion,
  'atomic-studio-page','Conversion retained',blocks_a||jsonb_build_array(conversion),NULL,NULL,NULL);
 PERFORM pg_temp.studio_assert(recovered->>'code'='unknown' AND (SELECT count(*)=before_audits FROM public.audit_logs),'unrelated later manifest delta leaves unknown save reconciliation read-only');
 response:=public.studio_start_project(t,gen_random_uuid(),'Collision project',context); empty_project:=(response->>'session_id')::uuid;
 source:=public.studio_page_save_source(t,empty_project,NULL);
 existing:=public.growth_page_upsert(NULL,'collision-protected-page','Someone elses native page',blocks_b,NULL,NULL,NULL,NULL);
 SELECT count(*) INTO before_pages FROM public.growth_pages;
 SELECT count(*) INTO before_audits FROM public.audit_logs;
 PERFORM pg_temp.studio_refuses(format('select public.studio_save_page(%L,%L,%L,%L,NULL,NULL,NULL,%L,%L,%L,NULL,NULL,NULL)',t,empty_project,source->'artifact_refs',context,'collision-protected-page','Colliding generated page',blocks_a),'40001','native new-page slug collision rolls back instead of original null-ID overwrite branch');
 PERFORM pg_temp.studio_assert((SELECT to_jsonb(p)=to_jsonb(existing) FROM public.growth_pages p WHERE id=existing.id)
  AND (SELECT count(*)=before_pages FROM public.growth_pages) AND (SELECT count(*)=before_audits FROM public.audit_logs)
  AND (SELECT artifact_refs='[]'::jsonb FROM public.studio_sessions WHERE id=empty_project),'collision leaves competing page and own original manifest/audits unchanged without orphan placeholder');
 legacy:=public.growth_page_upsert(NULL,'atomic-legacy-form-page','Original form page','[{"type":"embedded_form","form_slug":"atomic-original-signup","title":"Keep this form"}]',NULL,NULL,NULL,'{"sections":[]}');
 PERFORM public.link_session_artifact(empty_project,'page',legacy.id,NULL);
 source:=public.studio_page_save_source(t,empty_project,legacy.id);
 response:=public.studio_save_page(t,empty_project,source->'artifact_refs',context,legacy.id,(source->>'updated_at')::timestamptz,source->'conversion',
  legacy.slug,'Refined original form page',blocks_a||legacy.draft_blocks_json,NULL,NULL,'{"sections":[]}');
 SELECT id INTO form_id FROM public.growth_forms WHERE tenant_id=t AND slug='atomic-original-signup';
 PERFORM pg_temp.studio_assert(response->'ok'='true' AND response->'forms'=jsonb_build_array(jsonb_build_object('id',form_id,'slug','atomic-original-signup'))
  AND (SELECT status='draft' FROM public.growth_forms WHERE id=form_id),'atomic Studio save preserves original form-result IDs and draft authoring semantics');
 PERFORM pg_temp.studio_assert((SELECT count(*)=1 FROM public.studio_artifact_versions WHERE session_id=empty_project AND kind='page' AND lineage_id=legacy.id)
  AND (SELECT count(*)=1 FROM public.studio_artifact_versions WHERE session_id=empty_project AND kind='form' AND lineage_id=form_id),'original page and embedded form each link/version once inside native save');
 recovered:=public.studio_page_save_state(t,empty_project,source->'artifact_refs',context,legacy.id,(source->>'updated_at')::timestamptz,source->'conversion',
  legacy.slug,'Refined original form page',blocks_a||legacy.draft_blocks_json,NULL,NULL,'{"sections":[]}');
 PERFORM pg_temp.studio_assert(recovered->'ok'='true' AND recovered->'forms'=response->'forms' AND recovered->>'version_id'=response->>'version_id','lost form-save ACK reconciles original appended form reference and version');
 PERFORM pg_temp.studio_assert(public.studio_page_save_source(t,gen_random_uuid(),page_id)->>'code'='not_allowed'
  AND public.studio_page_save_source(t,empty_project,page_id)->>'code'='not_allowed','page source requires actual same original project manifest');
 PERFORM pg_temp.studio_assert(public.studio_page_save_source(t2,project,page_id)->>'code'='scope_changed','wrong tenant cannot obtain save authority source');
 UPDATE public.tenant_members SET role='member' WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_assert(public.studio_page_save_source(t,empty_project,legacy.id)->>'code'='scope_changed'
  AND public.studio_page_save_state(t,empty_project,source->'artifact_refs',context,legacy.id,(source->>'updated_at')::timestamptz,source->'conversion',
   legacy.slug,'Refined original form page',blocks_a||legacy.draft_blocks_json,NULL,NULL,NULL)->>'code'='scope_changed','role revocation closes source and unknown-save readback');
 response:=public.studio_save_page(t,empty_project,source->'artifact_refs',context,legacy.id,(source->>'updated_at')::timestamptz,source->'conversion',
  legacy.slug,'Revoked actor write',blocks_b||legacy.draft_blocks_json,NULL,NULL,NULL);
 PERFORM pg_temp.studio_assert(response->>'code'='scope_changed' AND (SELECT title='Refined original form page' FROM public.growth_pages WHERE id=legacy.id),
  'role revocation independently refuses final atomic page writer before effect');
 UPDATE public.tenant_members SET role='owner' WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_assert(public.studio_save_page(t2,empty_project,source->'artifact_refs',context,legacy.id,(source->>'updated_at')::timestamptz,source->'conversion',
  legacy.slug,'Foreign tenant write',blocks_b||legacy.draft_blocks_json,NULL,NULL,NULL)->>'code'='scope_changed','final native page writer independently rejects wrong current tenant');
 response:=public.studio_page_save_state(t,empty_project,source->'artifact_refs',context,legacy.id,(source->>'updated_at')::timestamptz,source->'conversion',
  legacy.slug,'Refined original form page',blocks_a||legacy.draft_blocks_json,NULL,NULL,'42');
 PERFORM pg_temp.studio_assert(response->>'code'='invalid','saved-state readback retains original supplied form-schema validation semantics');
 PERFORM pg_temp.studio_assert(NOT has_function_privilege('service_role','public.studio_save_page(uuid,uuid,jsonb,jsonb,uuid,timestamptz,jsonb,text,text,jsonb,jsonb,jsonb,jsonb)','execute')
  AND NOT has_function_privilege('anon','public.studio_save_page(uuid,uuid,jsonb,jsonb,uuid,timestamptz,jsonb,text,text,jsonb,jsonb,jsonb,jsonb)','execute')
  AND NOT has_function_privilege('service_role','public.studio_page_save_source(uuid,uuid,uuid)','execute')
  AND NOT has_function_privilege('service_role','public.studio_page_save_state(uuid,uuid,jsonb,jsonb,uuid,timestamptz,jsonb,text,text,jsonb,jsonb,jsonb,jsonb)','execute'),'native generation/save/reconciliation require actual authenticated Studio authority');
END $page_save_cas$;

DO $form_takedown$
DECLARE
 t uuid:='f0060000-0000-4000-8000-000000000010'; u uuid:='f0060000-0000-4000-8000-000000000001';
 page public.growth_pages; legacy public.growth_pages; draft_only public.growth_pages; form_id uuid; other_form uuid; foreign_form uuid;
 legacy_form uuid; funnel_form uuid; draft_form uuid; funnel uuid; blocks jsonb; response jsonb; before_audits integer;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 INSERT INTO public.growth_forms(tenant_id,slug,name,status,draft_schema_json,draft_success_action_json)
  VALUES(t,'canonical-takedown-dependency','Actual native conversion form','draft','{"sections":[]}','{"type":"thank_you"}') RETURNING id INTO form_id;
 blocks:=jsonb_build_array(jsonb_build_object('type','conversion','destination',jsonb_build_object('kind','native_form','formId',form_id)));
 page:=public.growth_page_upsert(NULL,'canonical-takedown-page','Published canonical native conversion',blocks,NULL,NULL,NULL,NULL);
 page:=public._growth_page_go_live(t,page.id);
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM pg_temp.studio_refuses(format('select public.growth_form_unpublish(%L,%L,%L)',t,form_id,u),'22023',
  'published canonical native-form page prevents original service form takedown');
 PERFORM pg_temp.studio_assert((SELECT status='active' FROM public.growth_forms WHERE id=form_id)
  AND (SELECT status='published' FROM public.growth_pages WHERE id=page.id),'refused canonical form takedown preserves live page and active original form');
 UPDATE public.growth_pages SET draft_blocks_json='[{"type":"hero","title":"Pending removal"}]' WHERE id=page.id;
 PERFORM pg_temp.studio_refuses(format('select public.growth_form_unpublish(%L,%L,%L)',t,form_id,u),'22023',
  'draft removal cannot erase dependency still present in original live page blocks');
 INSERT INTO public.growth_forms(tenant_id,slug,name,status) VALUES(t,'unrelated-takedown-form','Unrelated active form','active') RETURNING id INTO other_form;
 response:=public.growth_form_unpublish(t,other_form,u);
 PERFORM pg_temp.studio_assert(response->>'status'='draft' AND (SELECT status='published' FROM public.growth_pages WHERE id=page.id),
  'published canonical dependency never blocks unrelated original form takedown');
 UPDATE public.growth_pages SET status='draft' WHERE id=page.id;
 SELECT count(*) INTO before_audits FROM public.audit_logs WHERE entity_id=form_id AND action='growth_form_unpublish';
 response:=public.growth_form_unpublish(t,form_id,u);
 PERFORM pg_temp.studio_assert(response=jsonb_build_object('id',form_id,'status','draft')
  AND (SELECT count(*)=before_audits+1 FROM public.audit_logs WHERE entity_id=form_id AND action='growth_form_unpublish'),
  'original form takedown succeeds and audits once after its actual page is taken down');
 response:=public.growth_form_unpublish(t,form_id,u);
 PERFORM pg_temp.studio_assert(response->>'status'='draft'
  AND (SELECT count(*)=before_audits+1 FROM public.audit_logs WHERE entity_id=form_id AND action='growth_form_unpublish'),
  'original nonactive early return preserves takedown idempotency and audit count');
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 legacy:=public.growth_page_upsert(NULL,'retained-legacy-takedown','Original legacy dependency','[{"type":"embedded_form","form_slug":"retained-legacy-takedown-form"}]',NULL,NULL,NULL,NULL);
 legacy:=public._growth_page_go_live(t,legacy.id);
 SELECT id INTO legacy_form FROM public.growth_forms WHERE tenant_id=t AND slug='retained-legacy-takedown-form';
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM pg_temp.studio_refuses(format('select public.growth_form_unpublish(%L,%L,%L)',t,legacy_form,u),'22023',
  'original published embedded-form slug dependency remains protected');
 INSERT INTO public.growth_forms(tenant_id,slug,name,status) VALUES(t,'retained-funnel-takedown-form','Original funnel form','active') RETURNING id INTO funnel_form;
 INSERT INTO public.growth_funnels(tenant_id,slug,name,status) VALUES(t,'retained-funnel-takedown','Original live funnel','active') RETURNING id INTO funnel;
 INSERT INTO public.growth_funnel_steps(tenant_id,funnel_id,form_id) VALUES(t,funnel,funnel_form);
 PERFORM pg_temp.studio_refuses(format('select public.growth_form_unpublish(%L,%L,%L)',t,funnel_form,u),'22023',
  'original live funnel step dependency remains protected');
 INSERT INTO public.growth_forms(tenant_id,slug,name,status,draft_schema_json) VALUES(t,'draft-only-takedown-form','Draft-only page form','active','{"sections":[]}') RETURNING id INTO draft_form;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 blocks:=jsonb_build_array(jsonb_build_object('type','conversion','destination',jsonb_build_object('kind','native_form','formId',draft_form)));
 draft_only:=public.growth_page_upsert(NULL,'draft-only-takedown-page','Only a saved draft',blocks,NULL,NULL,NULL,NULL);
 PERFORM set_config('request.jwt.claim.sub','',true);
 response:=public.growth_form_unpublish(t,draft_form,u);
 PERFORM pg_temp.studio_assert(response->>'status'='draft' AND (SELECT status='draft' FROM public.growth_pages WHERE id=draft_only.id),
  'draft-only canonical page does not create a live dependency or block original takedown');
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 draft_only:=public.growth_page_upsert(NULL,draft_only.slug,draft_only.title,'[{"type":"hero","title":"Actual live content"}]',NULL,NULL,draft_only.id,NULL);
 draft_only:=public._growth_page_go_live(t,draft_only.id);
 UPDATE public.growth_forms SET status='active' WHERE id=draft_form;
 draft_only:=public.growth_page_upsert(NULL,draft_only.slug,draft_only.title,blocks,NULL,NULL,draft_only.id,NULL);
 PERFORM set_config('request.jwt.claim.sub','',true);
 response:=public.growth_form_unpublish(t,draft_form,u);
 PERFORM pg_temp.studio_assert(response->>'status'='draft'
  AND (SELECT status='published' AND blocks_json='[{"type":"hero","title":"Actual live content"}]'::jsonb FROM public.growth_pages WHERE id=draft_only.id),
  'pending new form on a live pages draft does not block takedown when actual live blocks do not collect through it');
 INSERT INTO public.growth_forms(tenant_id,slug,name,status) VALUES('f0060000-0000-4000-8000-000000000020','foreign-takedown-form','Foreign active form','active') RETURNING id INTO foreign_form;
 PERFORM pg_temp.studio_refuses(format('select public.growth_form_unpublish(%L,%L,%L)',t,foreign_form,u),'P0002','foreign native form ID cannot be taken down through authorized current tenant');
 PERFORM pg_temp.studio_assert((SELECT status='active' FROM public.growth_forms WHERE id=foreign_form),'foreign form remains active after refused cross-tenant takedown');
 UPDATE public.growth_forms SET status='active' WHERE id=other_form;
 UPDATE public.tenant_members SET role='member' WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_refuses(format('select public.growth_form_unpublish(%L,%L,%L)',t,other_form,u),'42501','original actor authority revocation independently refuses form takedown');
 PERFORM pg_temp.studio_assert((SELECT status='active' FROM public.growth_forms WHERE id=other_form),'revoked actor cannot modify an unrelated active form');
 UPDATE public.tenant_members SET role='owner' WHERE tenant_id=t AND user_id=u;
 PERFORM pg_temp.studio_refuses(format('select public.growth_form_unpublish(%L,%L,%L)',t,other_form,'f0060000-0000-4000-8000-000000000002'),'42501','service key cannot nominate an unauthorized original actor');
 UPDATE public.growth_forms SET status='archived' WHERE id=other_form;
 SELECT count(*) INTO before_audits FROM public.audit_logs WHERE entity_id=other_form AND action='growth_form_unpublish';
 response:=public.growth_form_unpublish(t,other_form,u);
 PERFORM pg_temp.studio_assert(response->>'status'='archived'
  AND (SELECT count(*)=before_audits FROM public.audit_logs WHERE entity_id=other_form AND action='growth_form_unpublish'),
  'archived original form retains nonactive early return without a new audit');
 PERFORM pg_temp.studio_assert((SELECT proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND pg_get_userbyid(proowner)='postgres'
  FROM pg_proc WHERE oid='public.growth_form_unpublish(uuid,uuid,uuid)'::regprocedure)
  AND NOT has_function_privilege('authenticated','public.growth_form_unpublish(uuid,uuid,uuid)','execute')
  AND NOT has_function_privilege('anon','public.growth_form_unpublish(uuid,uuid,uuid)','execute'),
  'forward form takedown repair retains exact original service-only owner and ACL');
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
END $form_takedown$;

-- Exercise the actual SQL role too; JWT verification remains outside this local port.
SET LOCAL ROLE authenticated;
SELECT pg_temp.studio_assert(public.studio_lookup_project_start('f0060000-0000-4000-8000-000000000010','f0060000-0000-4000-8000-000000000030')->'ok'='true','ordinary authenticated role uses protected recovery RPC');
SELECT pg_temp.studio_refuses($q$update public.studio_sessions set studio_start_request_id=gen_random_uuid(),studio_start_digest=repeat('a',64) where studio_start_request_id='f0060000-0000-4000-8000-000000000030'$q$,'42501','table grant cannot forge original request binding');
SELECT pg_temp.studio_assert(public.chat_studio_reference('f0060000-0000-4000-8000-000000000010',(SELECT(value->>'source')::uuid FROM chat_studio_cases WHERE label='primary'))->>'state'='ready','actual authenticated SQL role reopens historical original project');
SELECT pg_temp.studio_assert((SELECT public.chat_studio_sources('f0060000-0000-4000-8000-000000000010',(value->>'thread')::uuid,ARRAY[(value->>'source')::uuid])->'source_turn_ids'=jsonb_build_array(value->'source') FROM chat_studio_cases WHERE label='primary'),'actual authenticated SQL role discovers only its original historical user pointer');
SELECT pg_temp.studio_assert((SELECT public.studio_page_save_source('f0060000-0000-4000-8000-000000000010',id,NULL)->'ok'='true' FROM public.studio_sessions WHERE title='Atomic Studio save'),'actual authenticated SQL role uses protected original project source');
SELECT pg_temp.studio_refuses('select id from public.paige_workspace_events limit 1','42501','ordinary actor cannot directly select original private Rail');
SELECT pg_temp.studio_refuses('select public.growth_form_unpublish(gen_random_uuid(),gen_random_uuid(),NULL)','42501','actual authenticated SQL role cannot bypass original service-only takedown door');
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
SELECT pg_temp.studio_refuses(format('select public.chat_studio_sources(%L,%L,ARRAY[%L::uuid])','f0060000-0000-4000-8000-000000000010',(SELECT value->>'thread' FROM chat_studio_cases WHERE label='service-role'),(SELECT value->>'source' FROM chat_studio_cases WHERE label='service-role')),'42501','actual service role cannot invoke owner loaded-history projection');
SELECT pg_temp.studio_refuses('select public.studio_page_save_source(gen_random_uuid(),gen_random_uuid(),NULL)','42501','actual service role cannot request server-bound Studio generation source');
RESET ROLE;

-- Private expected-state metadata belongs to the SAME original confirmation.
CREATE TEMP TABLE studio_confirmation_cases(label text PRIMARY KEY,id uuid,thread_id uuid,args jsonb,source jsonb);
GRANT SELECT ON studio_confirmation_cases TO authenticated,service_role;
GRANT INSERT ON studio_confirmation_cases TO service_role;
DO $confirmation_source_fixture$
DECLARE started jsonb; source jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','f0060000-0000-4000-8000-000000000001',true);
 started:=public.studio_start_project('f0060000-0000-4000-8000-000000000010',gen_random_uuid(),'Private approval source',
  '{"target":{"kind":"workspace"},"values":{"offers":"Actual local project source"}}');
 source:=public.studio_page_save_source('f0060000-0000-4000-8000-000000000010',(started->>'session_id')::uuid,NULL);
 INSERT INTO studio_confirmation_cases VALUES('expected',(started->>'session_id')::uuid,(started->>'thread_id')::uuid,
  '{"slug":"local-confirmed-page","title":"Local confirmed page","blocks":[{"type":"hero","title":"Prepared"}]}',source);
END $confirmation_source_fixture$;
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL ROLE service_role;
WITH inserted AS (
 INSERT INTO public.paige_pending_confirmations(user_id,tenant_id,thread_id,scoped_client_id,tool_name,fingerprint,args,summary,issued_in_request,server_issued_at,studio_page_save_source)
 SELECT 'f0060000-0000-4000-8000-000000000001','f0060000-0000-4000-8000-000000000010',thread_id,NULL,
  'growth_page_save','0350000000000001',args,'Local approval','f0350000-0000-4000-8000-000000000101',clock_timestamp(),source
 FROM studio_confirmation_cases WHERE label='expected'
 RETURNING id,thread_id,args,studio_page_save_source
) INSERT INTO studio_confirmation_cases SELECT 'prepared',id,thread_id,args,studio_page_save_source FROM inserted;
SELECT pg_temp.studio_assert(
 (SELECT p.args=e.args AND p.source=e.source AND NOT(p.args ? 'studio_page_save_source')
  FROM studio_confirmation_cases p CROSS JOIN studio_confirmation_cases e WHERE p.label='prepared' AND e.label='expected'),
 'actual service original INSERT atomically retains separate native expected source without changing args');
DO $confirmation_source_guard$
DECLARE selected uuid; assignment text; captured_source jsonb; legacy uuid; response jsonb;
BEGIN
 SELECT id INTO selected FROM studio_confirmation_cases WHERE label='prepared';
 SELECT source INTO captured_source FROM studio_confirmation_cases WHERE label='expected';
 PERFORM pg_temp.studio_refuses(format('update public.paige_pending_confirmations set studio_page_save_source=NULL where id=%L',selected),
  '40001','private source cannot be cleared after original insertion');
 PERFORM pg_temp.studio_refuses(format('update public.paige_pending_confirmations set studio_page_save_source=%L where id=%L','{"changed":true}',selected),
  '40001','private source cannot be rebound to a newer project read');
 FOREACH assignment IN ARRAY ARRAY[
  'id=gen_random_uuid()','user_id=''f0060000-0000-4000-8000-000000000002''::uuid',
  'tenant_id=''f0060000-0000-4000-8000-000000000020''::uuid','thread_id=gen_random_uuid()',
  'scoped_client_id=gen_random_uuid()','tool_name=''other_tool''','fingerprint=''0350000000000009''',
  'args=''{"title":"Changed model args"}''::jsonb','issued_in_request=gen_random_uuid()',
  'server_issued_at=server_issued_at+interval ''1 second'''
 ] LOOP
  PERFORM pg_temp.studio_refuses(format('update public.paige_pending_confirmations set %s where id=%L',assignment,selected),'40001',
   'private source keeps original approval binding: '||split_part(assignment,'=',1));
 END LOOP;
 INSERT INTO public.paige_pending_confirmations(user_id,tenant_id,tool_name,fingerprint,args,summary)
  VALUES('f0060000-0000-4000-8000-000000000001','f0060000-0000-4000-8000-000000000010','growth_page_save','0350000000000002','{}','Legacy NULL source') RETURNING id INTO legacy;
 INSERT INTO studio_confirmation_cases VALUES('legacy',legacy,NULL,'{}',NULL);
 PERFORM pg_temp.studio_refuses(format('update public.paige_pending_confirmations set studio_page_save_source=%L where id=%L',captured_source,legacy),
  '40001','legacy NULL source cannot be blessed by a later update');
 PERFORM pg_temp.studio_refuses($q$insert into public.paige_pending_confirmations(user_id,tool_name,fingerprint,args,summary,studio_page_save_source)
  values('f0060000-0000-4000-8000-000000000001','other_tool','0350000000000010','{}','Wrong tool','{}')$q$,'23514','private Studio source cannot be attached to a different tool');
 PERFORM pg_temp.studio_refuses($q$insert into public.paige_pending_confirmations(user_id,tool_name,fingerprint,args,summary,studio_page_save_source)
  values('f0060000-0000-4000-8000-000000000001','growth_page_save','0350000000000011','{}','Wrong shape','[]')$q$,'23514','private source requires a JSON object');
 UPDATE public.paige_pending_confirmations SET expires_at=expires_at+interval '1 minute',claimed_in_request='f0350000-0000-4000-8000-000000000102'
  WHERE id=selected;
 PERFORM pg_temp.studio_assert((SELECT captured_source=p.studio_page_save_source AND p.expires_at>p.created_at AND p.claimed_in_request IS NOT NULL
  FROM public.paige_pending_confirmations p WHERE p.id=selected),'unchanged source permits incumbent expiry and claim marker updates');
END $confirmation_source_guard$;
-- SAME original generic CAS; private source is a separate returned column.
WITH claimed AS (
 UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp()
 WHERE user_id='f0060000-0000-4000-8000-000000000001' AND tenant_id='f0060000-0000-4000-8000-000000000010'
  AND thread_id=(SELECT thread_id FROM studio_confirmation_cases WHERE label='prepared') AND scoped_client_id IS NULL
  AND tool_name='growth_page_save' AND fingerprint='0350000000000001'
  AND issued_in_request='f0350000-0000-4000-8000-000000000101' AND issued_in_request<>'f0350000-0000-4000-8000-000000000103'
  AND issued_in_request IS NOT NULL AND server_issued_at IS NOT NULL AND consumed_at IS NULL AND expires_at>clock_timestamp()
 RETURNING id,thread_id,args,studio_page_save_source
) INSERT INTO studio_confirmation_cases SELECT 'claimed',id,thread_id,args,studio_page_save_source FROM claimed;
SELECT pg_temp.studio_assert((SELECT p.id=c.id AND p.args=c.args AND p.source=c.source
 FROM studio_confirmation_cases p CROSS JOIN studio_confirmation_cases c WHERE p.label='prepared' AND c.label='claimed'),
 'single actual service claim CAS returns stored args and exact private source separately');
WITH repeated AS (
 UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp()
 WHERE fingerprint='0350000000000001' AND user_id='f0060000-0000-4000-8000-000000000001'
  AND issued_in_request='f0350000-0000-4000-8000-000000000101' AND consumed_at IS NULL RETURNING id
) SELECT pg_temp.studio_assert((SELECT count(*)=0 FROM repeated),'unknown original claim cannot be spent a second time');
SELECT pg_temp.studio_assert((SELECT p.consumed_at IS NOT NULL AND p.studio_page_save_source=c.source AND p.args=c.args
 FROM public.paige_pending_confirmations p JOIN studio_confirmation_cases c ON c.id=p.id WHERE c.label='claimed'),
 'read-only original identity lookup reconciles consumed claim without a second writer');
INSERT INTO public.paige_pending_confirmations(user_id,tenant_id,tool_name,fingerprint,args,summary)
 VALUES('f0060000-0000-4000-8000-000000000002','f0060000-0000-4000-8000-000000000020','other_tool','0350000000000003','{}','Foreign actor row');
UPDATE public.paige_pending_confirmations SET args='{"ordinary":"updated"}',consumed_at=clock_timestamp(),claimed_in_request=gen_random_uuid(),expires_at=clock_timestamp()
 WHERE fingerprint='0350000000000003';
SELECT pg_temp.studio_assert((SELECT args='{"ordinary":"updated"}'::jsonb AND studio_page_save_source IS NULL AND consumed_at IS NOT NULL
 FROM public.paige_pending_confirmations WHERE fingerprint='0350000000000003'),'non-Studio NULL-source args, consume, claim and expiry behavior remains original');
RESET ROLE;
SET LOCAL request.jwt.claim.sub='f0060000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.studio_assert((SELECT count(*)=2 FROM (
 SELECT id,user_id,tenant_id,thread_id,scoped_client_id,tool_name,fingerprint,args,summary,created_at,expires_at,consumed_at,
  issued_in_request,server_issued_at,claimed_in_request FROM public.paige_pending_confirmations
 WHERE fingerprint IN ('0350000000000001','0350000000000002','0350000000000003')) original_columns),
 'actual authenticated SELECT retains all fifteen incumbent columns and own-row RLS');
SELECT pg_temp.studio_assert(NOT EXISTS(SELECT 1 FROM public.paige_pending_confirmations WHERE fingerprint='0350000000000003'),
 'current caller cannot read foreign actor original confirmation rows');
SELECT pg_temp.studio_refuses('select studio_page_save_source from public.paige_pending_confirmations','42501','authenticated explicit private column read is denied');
SELECT pg_temp.studio_refuses('select * from public.paige_pending_confirmations','42501','authenticated SQL star cannot expose private column');
SELECT pg_temp.studio_refuses('select to_jsonb(p) from public.paige_pending_confirmations p','42501','authenticated whole-row serialization cannot expose private column');
SELECT pg_temp.studio_refuses($q$insert into public.paige_pending_confirmations(user_id,tool_name,fingerprint,args,summary) values(auth.uid(),'growth_page_save','0350000000000012','{}','Forged')$q$,
 '42501','authenticated caller cannot insert arbitrary original args or server metadata');
SELECT pg_temp.studio_refuses($q$update public.paige_pending_confirmations set args='{"forged":true}' where fingerprint='0350000000000001'$q$,
 '42501','authenticated caller cannot rewrite original stored args');
SELECT pg_temp.studio_refuses($q$delete from public.paige_pending_confirmations where fingerprint='0350000000000001'$q$,
 '42501','authenticated caller cannot delete original confirmation history');
SELECT pg_temp.studio_refuses($q$update public.paige_pending_confirmations set studio_page_save_source='{}' where fingerprint='0350000000000001'$q$,
 '42501','authenticated caller cannot write private expected metadata');
RESET ROLE;
SET LOCAL request.jwt.claim.sub='f0060000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.studio_assert((SELECT count(*)=1 FROM public.paige_pending_confirmations WHERE fingerprint IN
 ('0350000000000001','0350000000000002','0350000000000003')),'second actual caller sees only its own incumbent fields');
RESET ROLE;
SET LOCAL request.jwt.claim.sub='';
GRANT INSERT,SELECT ON studio_binding_assertions TO anon;
SET LOCAL ROLE anon;
SELECT pg_temp.studio_refuses('select studio_page_save_source from public.paige_pending_confirmations','42501','anon explicit private field read denied');
SELECT pg_temp.studio_refuses('select * from public.paige_pending_confirmations','42501','anon original table star read denied');
SELECT pg_temp.studio_refuses('select args from public.paige_pending_confirmations','42501','anon incumbent column read denied');
RESET ROLE;
-- Actual captured specialized wrapper + original whole-row helper closure.
INSERT INTO public.paige_pending_confirmations(user_id,tenant_id,tool_name,fingerprint,args,summary,issued_in_request,server_issued_at)
 VALUES('f0060000-0000-4000-8000-000000000001','f0060000-0000-4000-8000-000000000010','weekly_commitment_draft','0350000000000004',
  '{"_request_id":"f0350000-0000-4000-8000-000000000104","_name":"Original weekly draft","_weekday":1,"_local_time":"09:00","_timezone":"America/New_York"}',
  'Original specialized proposal','f0350000-0000-4000-8000-000000000105',clock_timestamp());
SET LOCAL request.jwt.claim.sub='f0060000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.studio_assert((SELECT public.read_weekly_commitment_draft(id)->>'phase'='awaiting_approval'
 AND NOT(public.read_weekly_commitment_draft(id) ? 'studio_page_save_source')
 FROM public.paige_pending_confirmations WHERE fingerprint='0350000000000004'),
 'captured original authenticated specialized wrapper reads original projection without private source exposure');
SELECT pg_temp.studio_refuses($q$select public._weekly_draft_proposal((select id from public.paige_pending_confirmations where fingerprint='0350000000000004'))$q$,
 '42501','incumbent whole-row native helper remains postgres-only');
RESET ROLE;
UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp() WHERE fingerprint='0350000000000004';
SET LOCAL ROLE authenticated;
SELECT pg_temp.studio_assert((SELECT public.claim_weekly_commitment_draft(id,'0350000000000004:f0350000-0000-4000-8000-000000000105',gen_random_uuid())->'claimed'='false'
 FROM public.paige_pending_confirmations WHERE fingerprint='0350000000000004'),
 'captured original specialized consumed-claim readback remains compatible with added nullable column');
RESET ROLE;
SELECT count(*) AS passed_native_studio_assertions FROM studio_binding_assertions;
ROLLBACK;
