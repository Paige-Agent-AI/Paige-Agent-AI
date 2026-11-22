begin;
select plan(24);

select ok(not has_function_privilege('anon','public.solo_beta_protected_meet_control(uuid,text,text,text,uuid,text,text,text,uuid,text,text)','execute')
  and not has_function_privilege('authenticated','public.solo_beta_protected_meet_control(uuid,text,text,text,uuid,text,text,text,uuid,text,text)','execute')
  and not has_function_privilege('authenticated','public.solo_beta_protected_meet_relay_current(uuid,uuid)','execute'),
  'only service role can access protected Meet control');

insert into public.legal_documents(slug,version,title,body_md,is_current)
values ('saas-standalone',92212,'Protected Meet test terms','Synthetic terms',false);
insert into auth.users(id,aud,role,email,created_at,raw_app_meta_data)
values ('b2470000-0000-4000-8000-000000000001','authenticated','authenticated','protected-meet-proof@example.invalid',
  now()-interval '1 hour','{"solo_beta_protected_reference":"b2470000-0000-4000-8000-000000000011"}');
insert into public.solo_beta_protected_signup_intake(
  reference_id,resume_secret_hash,primary_email,accepted_documents,accepted_at,renewal_consent_version,
  stripe_product_id,stripe_price_id,provider_livemode,return_origin,created_at,owner_user_id,owner_bound_at)
values ('b2470000-0000-4000-8000-000000000011',repeat('a',64),'protected-meet-proof@example.invalid',
  '{"saas-standalone":92212}',now()-interval '2 hours','solo_beta_v2_email_verified_2026_11',
  'prod_protectedmeetproof','price_protectedmeetproof',false,'http://localhost:5173',
  now()-interval '2 hours','b2470000-0000-4000-8000-000000000001',now()-interval '1 hour');
insert into public.solo_beta_protected_checkout_attempts(
  reference_id,provider_livemode,stripe_customer_id,stripe_checkout_id,stripe_price_id,stripe_product_id,
  create_started_at,stripe_subscription_id,trial_started_at,trial_ends_at,verification_deadline_at)
values ('b2470000-0000-4000-8000-000000000011',false,'cus_protectedmeetproof','cs_test_protectedmeetproof',
  'price_protectedmeetproof','prod_protectedmeetproof',now()-interval '2 hours','sub_protectedmeetproof',
  now()-interval '2 hours',now()+interval '718 hours',now()+interval '70 hours');

-- These fixtures emulate a signed event at the established internal RPC boundary.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
select is(public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','context'),
  null::jsonb,'Stripe alone does not open Meet');
select ok(public.solo_beta_bind_protected_checkout_event('cs_test_protectedmeetproof','sub_protectedmeetproof',false,
  'evt_protectedmeetproof',now()-interval '2 hours',repeat('a',64)),'signed-event proof binds');
select is((select count(*) from public.solo_beta_prepare_protected_workspace(
  'b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173')),1::bigint,
  'the protected receipt provisions its eligible workspace');
select is(public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('b',64),'http://localhost:5173','context'),
  null::jsonb,'different browser grant cannot open a private interview');
select is(public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'https://paigeagent.ai','context'),
  null::jsonb,'different browser origin cannot open a private interview');

create temp table protected_meet_context as select public.solo_beta_protected_meet_control(
  'b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','context') as body;
select ok((select body->>'thread_id' is not null and body->>'acknowledged'='false' from protected_meet_context),
  'opens exactly its own interview with no inherited consent');
select is((public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','context')->>'thread_id'),
  (select body->>'thread_id' from protected_meet_context),'resumes the same thread');
select is((public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','relay',
  _ticket_digest=>'ticket:'||repeat('b',64))->>'code'),'live_audio_not_enabled','audio ticket requires current personal acknowledgment');
select is((public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','greeting')->>'code'),
  'live_audio_not_enabled','the fixed greeting cannot reserve provider audio before personal acknowledgment');
select is((public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','acknowledge')->>'accepted'),
  'true','records explicit acknowledgment for the bound owner');
select is((public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','greeting')->>'ok'),
  'true','the eligible acknowledged owner may reserve a fixed greeting');
select is((public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','greeting_current')->>'ok'),
  'true','the greeting release uses the current canonical admission again');

create temp table protected_meet_session as
select (public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','relay',
  _ticket_digest=>'ticket:'||repeat('c',64))->>'session_id')::uuid as id;
select ok((select id is not null from protected_meet_session),'issues an existing relay ticket with exact session scope');
select ok(public.solo_beta_protected_meet_relay_current((select id from protected_meet_session)),'current provisional relay passes exact workspace readback');
select is(public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','relay',
  _session_id=>'b2470000-0000-4000-8000-000000000099',_ticket_digest=>'ticket:'||repeat('a',64)),
  null::jsonb,'the checkout browser grant cannot renew a different session');

create temp table protected_meet_prior_connection as select l.protected_meet_connection_id as id
from protected_meet_session s join public.paige_live_sessions l on l.id=s.id;
select ok((public.solo_beta_protected_meet_control(
  'b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','relay',
  _session_id=>(select id from protected_meet_session),_ticket_digest=>'ticket:'||repeat('d',64))->>'ok')::boolean,
  'authenticated checkout grant renews the same enrollment session');
update public.paige_live_sessions set state='listening',availability='LIVE',provider_session_ref='runtime:'||repeat('e',64)
where id=(select id from protected_meet_session);
select ok(not public.solo_beta_protected_meet_relay_current(
  (select id from protected_meet_session),(select id from protected_meet_prior_connection)),
  'a renewed connection fences the old socket even after the new socket is listening');
select is(public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','voice_claim',
  _session_id=>(select id from protected_meet_session),_runtime_digest=>'runtime:'||repeat('a',64)),
  null::jsonb,'a different challenge digest cannot claim the signed voice slot');

create temp table protected_meet_claim as select (public.solo_beta_protected_meet_control(
  'b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','typed_claim')->>'claim')::uuid as id;
select is((public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','save_turn',
  _claim=>(select id from protected_meet_claim),_transcript=>'My company sells supplies.',_answer=>'Who do you serve?')->>'ok'),
  'true','persists typed turns to the existing scoped thread');
select is(jsonb_array_length(public.solo_beta_protected_meet_control(
  'b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','context')->'transcript'),
  2,'resumed private context reads the existing saved turns');
select ok(exists (
  select 1 from public.paige_chat_turns t
  join public.solo_beta_protected_signup_intake i on i.meet_thread_id=t.thread_id
  where i.reference_id='b2470000-0000-4000-8000-000000000011' and t.role='user'
    and t.bundle_ref->'solo_business_interview'->>'phase'='active'
    and t.bundle_ref->'solo_business_interview'->>'sourceTurnId'=t.id::text
    and t.bundle_ref->'solo_business_interview'->'sourceTurnSeq'=to_jsonb(t.seq)
    and t.bundle_ref->'solo_business_interview'->'contextRevisionAtCheckpoint'='null'::jsonb
),'the saved owner turn carries a resumable canonical interview position without asserting a Setup revision');
reset role;

update public.paige_live_pilot_subjects set revoked_at=now() where user_id='b2470000-0000-4000-8000-000000000001';
set local role service_role;
select is((public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','greeting_current')->>'code'),
  'live_audio_not_enabled','revocation prevents releasing already reserved provider audio');
reset role;

update auth.users set email_confirmed_at=now() where id='b2470000-0000-4000-8000-000000000001';
set local role service_role;
select ok(not public.solo_beta_protected_meet_relay_current((select id from protected_meet_session))
  and (public.solo_beta_protected_meet_control('b2470000-0000-4000-8000-000000000011',repeat('a',64),'http://localhost:5173','context')->>'code')
  = 'canonical_sign_in_required','verification retires the provisional relay and requires canonical sign-in');
select * from finish();
rollback;
