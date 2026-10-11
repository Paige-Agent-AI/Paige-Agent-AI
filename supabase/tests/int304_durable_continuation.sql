create function pg_temp.check_cont(label text,condition boolean)returns void language plpgsql as $$begin if condition is distinct from true then raise exception 'CONTINUATION_FAIL %',label;end if;raise notice 'CONTINUATION_PROOF %',label;end$$;
insert into auth.users(id)values('00000000-0000-4000-8000-000000000001');
insert into tenants(id,status)values('00000000-0000-4000-8000-000000000002','active');
insert into tenant_members(tenant_id,user_id,status,role)values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','active','owner');
insert into paige_chat_threads(id,caller_user_id,tenant_id,interactive_latest_intent)values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004');
insert into paige_durable_work(id,tenant_id,initiating_user_id,intent_id,thread_id,capability_key,work_kind,authority_context,scope_epoch,idempotency_key,request_payload,lease_until)values('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000003','document_generate','document_authoring','{}','epoch','key','{"brief":"Write the onboarding guide"}',now()+interval '5 minutes');
insert into paige_chat_turns(thread_id,role,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state,bundle_ref) values('00000000-0000-4000-8000-000000000003','assistant','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','WAIT_WORK','{"interactive":{"effects":[{"tool":"document_generate","outcome":"durable_accepted","work_id":"00000000-0000-4000-8000-000000000005"}]}}');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true),set_config('test.tenant','00000000-0000-4000-8000-000000000002',true);
create function pg_temp.cont()returns jsonb language sql as $$select read_paige_durable_continuation('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005')$$;
set local role authenticated;
select pg_temp.check_cont('exact continuation fields with canonical objective',(pg_temp.cont()->>'canonicalObjective')='Write the onboarding guide'
 and (pg_temp.cont()->>'workIntentId')='00000000-0000-4000-8000-000000000006'
 and (pg_temp.cont()->>'scopeEpoch')='epoch' and (pg_temp.cont()->>'capabilityKey')='document_generate'
 and (pg_temp.cont()->>'workKind')='document_authoring' and (pg_temp.cont()->>'status')='claimed'
 and (pg_temp.cont()->'approvalPending')='false' and (pg_temp.cont()->>'settledAt') is null);
select pg_temp.check_cont('repeat read stable',pg_temp.cont()=pg_temp.cont());
reset role;update tenant_members set role='admin';set local role authenticated;
select pg_temp.check_cont('current admin permission reads',pg_temp.cont() is not null);
reset role;update tenant_members set role='member';set local role authenticated;
select pg_temp.check_cont('revoked admin permission refuses',pg_temp.cont() is null);
reset role;update tenant_members set role='coach';set local role authenticated;
select pg_temp.check_cont('retired title cannot restore permission',pg_temp.cont() is null);
reset role;update tenant_members set role='owner';set local role authenticated;
select set_config('test.tenant','00000000-0000-4000-8000-000000000009',true);
select pg_temp.check_cont('switched tenant',pg_temp.cont() is null);
select set_config('test.tenant','00000000-0000-4000-8000-000000000002',true),set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000009',true);
select pg_temp.check_cont('foreign actor',pg_temp.cont() is null);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
reset role;update paige_chat_threads set is_archived=true;set local role authenticated;
select pg_temp.check_cont('archived thread',pg_temp.cont() is null);
reset role;update paige_chat_threads set is_archived=false,interactive_latest_intent=gen_random_uuid();set local role authenticated;
select pg_temp.check_cont('superseded conversational intent',pg_temp.cont() is null);
reset role;update paige_chat_threads set interactive_latest_intent='00000000-0000-4000-8000-000000000004';set local role authenticated;
select pg_temp.check_cont('stale conversational intent after restore reads',pg_temp.cont() is not null);
-- Blocked work with an expired approval is the one real approval-pending shape.
reset role;update paige_durable_work set status='blocked',blocked_reason='approval_expired';set local role authenticated;
select pg_temp.check_cont('expired approval reads approval pending',(pg_temp.cont()->'approvalPending')='true');
reset role;update paige_durable_work set status='blocked',blocked_reason='worker_offline';set local role authenticated;
select pg_temp.check_cont('other blocked reason is not approval pending',(pg_temp.cont()->'approvalPending')='false');
-- Failed terminal work carries its error code for the projection's terminal check.
reset role;update paige_durable_work set status='failed',blocked_reason=null,error_code='document_provider_refused',terminal_outcome='{"failed":true}',settled_at=now();set local role authenticated;
select pg_temp.check_cont('failed terminal carries error code',(pg_temp.cont()->>'errorCode')='document_provider_refused');
-- The objective must come from the frozen payload, never be reconstructed.
reset role;update paige_durable_work set request_payload='{"brief":"  "}';set local role authenticated;
select pg_temp.check_cont('blank objective refuses',pg_temp.cont() is null);
reset role;update paige_durable_work set request_payload='{"brief":"Write the onboarding guide"}';set local role authenticated;
select pg_temp.check_cont('restored objective reads',pg_temp.cont() is not null);
-- Lineage: the same work bound twice in protected effects breaks uniqueness.
reset role;update paige_chat_turns set bundle_ref=jsonb_set(bundle_ref,'{interactive,effects}',(bundle_ref->'interactive'->'effects')||(bundle_ref->'interactive'->'effects')::jsonb);set local role authenticated;
select pg_temp.check_cont('ambiguous effect lineage refuses',pg_temp.cont() is null);
reset role;update paige_chat_turns set bundle_ref=jsonb_set(bundle_ref,'{interactive,effects}',(bundle_ref->'interactive'->'effects')-(-1));set local role authenticated;
select pg_temp.check_cont('unique lineage restored',pg_temp.cont() is not null);
-- A capability outside the durable document/research classes is not continuable here.
reset role;insert into paige_durable_work(id,tenant_id,initiating_user_id,intent_id,thread_id,capability_key,work_kind,authority_context,scope_epoch,idempotency_key,request_payload,lease_until)values('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000003','comms_send_email','send','{}','epoch','key2','{"brief":"Send it"}',now()+interval '5 minutes');
update paige_chat_turns set bundle_ref=jsonb_set(bundle_ref,'{interactive,effects}',(bundle_ref->'interactive'->'effects')||'[{"tool":"comms_send_email","outcome":"durable_accepted","work_id":"00000000-0000-4000-8000-000000000012"}]'::jsonb);set local role authenticated;
select pg_temp.check_cont('foreign capability class refuses',read_paige_durable_continuation('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000012') is null);
select pg_temp.check_cont('original work unaffected by the foreign-class row',pg_temp.cont() is not null);
-- Roles: service and anon can never drive the authenticated read.
select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.check_cont('service role not user proof',pg_temp.cont() is null);
select set_config('request.jwt.claim.role','anon',true);
select pg_temp.check_cont('anon not user proof',pg_temp.cont() is null);

-- C4e: research-kind work reads its objective from the frozen question on the same
-- lineage contract. The blocked preparation seam is untouched; no dispatch, worker or
-- provider is introduced or implied.
select set_config('request.jwt.claim.role','authenticated',true);
reset role;
insert into paige_durable_work(id,tenant_id,initiating_user_id,intent_id,thread_id,capability_key,work_kind,authority_context,scope_epoch,idempotency_key,request_payload,status,error_code,terminal_outcome,settled_at)values('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000003','deep_research','research','{}','epoch','research-key','{"question":"Which channel converts best for solo agencies?"}','failed','research_provider_error','{"failed":true}',now());
update paige_chat_turns set bundle_ref=jsonb_set(bundle_ref,'{interactive,effects}',(bundle_ref->'interactive'->'effects')||'[{"tool":"deep_research","outcome":"durable_accepted","work_id":"00000000-0000-4000-8000-000000000014"}]'::jsonb);
create function pg_temp.research_cont()returns jsonb language sql as $$select read_paige_durable_continuation('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000014')$$;
set local role authenticated;
select pg_temp.check_cont('research work reads its frozen question',
 (pg_temp.research_cont()->>'canonicalObjective')='Which channel converts best for solo agencies?'
 and (pg_temp.research_cont()->>'workKind')='research'
 and (pg_temp.research_cont()->>'capabilityKey')='deep_research'
 and (pg_temp.research_cont()->>'errorCode')='research_provider_error'
 and (pg_temp.research_cont()->'approvalPending')='false');
-- The document work on the same thread is unaffected by the research effect beside it.
select pg_temp.check_cont('document work unaffected beside the research effect',pg_temp.cont() is not null);
