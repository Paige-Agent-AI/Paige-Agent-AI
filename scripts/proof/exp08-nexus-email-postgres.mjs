// Isolated native COMPONENT proof. Real original actor/admission/Save13 bodies;
// neutral abridged tables, no Auth SDK, provider, production or customer proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
import {verifyNexusEmailDeparture} from './exp08-nexus-email-departure.mjs';
const db=new OperatorPostgresFixture(Number(process.argv[2]));
db.prefix=()=>"SET statement_timeout='15s';SET application_name='exp08_nexus_email_component';";
const run=db.run.bind(db);
db.run=(sql,...args)=>{
 const started=Date.now();
 try{return run(sql,...args);}
 finally{if(process.argv.includes('--trace'))console.log(JSON.stringify({elapsedMs:Date.now()-started,statement:sql.slice(0,90)}));}
};
const read=p=>readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const tenant='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const actor='20000000-0000-4000-8000-000000000001',stranger='20000000-0000-4000-8000-000000000002';
const channel='30000000-0000-4000-8000-000000000001',source='40000000-0000-4000-8000-000000000001';
const reply='40000000-0000-4000-8000-000000000002',turn='50000000-0000-4000-8000-000000000001';
const contact='60000000-0000-4000-8000-000000000001',foreignContact='60000000-0000-4000-8000-000000000002';
const connector='70000000-0000-4000-8000-000000000001',operation='80000000-0000-4000-8000-000000000001';
const token='a'.repeat(64);
let checks=0,failed=false;
function scalar(sql){return db.run(sql).split(/\r?\n/).filter(x=>x!=='SET'&&x!=='RESET').at(-1);}
function json(sql){return JSON.parse(scalar(sql));}
function as(role,user,sql){return `SET ROLE ${role};SELECT set_config('test.actor',${quote(user??'')},false);${sql}`;}
function check(value,description){assert(value,description);checks++;}
function definition(sql,name){const start=sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);assert(start>=0);const end=sql.slice(start).match(/\$function\$\s*;/);assert(end);return sql.slice(start,start+end.index+end[0].length);}
function refused(fn,code){assert.throws(fn,error=>!code||error.code===code);checks++;}
const get=(id=reply,recipient=null,expected=tenant,user=actor)=>json(as('authenticated',user,
 `SELECT public.team_hub_email_draft('${expected}','${id}',${recipient?quote(recipient):'NULL'},${recipient?quote(connector):'NULL'});`));
try{
 db.run(`CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;END$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text,account_type text,parent_tenant_id uuid);
 CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE public.tenant_members(user_id uuid,tenant_id uuid,status text,role text,team_hub_access boolean);
 CREATE TABLE public.clients(id uuid PRIMARY KEY,tenant_id uuid);
 CREATE TABLE public.channel_connectors(id uuid PRIMARY KEY,tenant_id uuid,active boolean,status text,channel_type text,provider text,from_address text,mailbox_class text,mailbox_owner_user_id uuid);
 CREATE TABLE public.paige_pending_approvals(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,status text,metadata jsonb,draft_content jsonb);
 CREATE TABLE public.paige_actions(id uuid PRIMARY KEY,approval_id uuid,tenant_id uuid,contact_id uuid,action_kind text,status text,payload jsonb DEFAULT '{}');
 CREATE TABLE public.paige_action_kinds(slug text,executor text);
 CREATE TABLE public.paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,actor_role text,tenant_id uuid,action text,target_type text,target_id uuid,payload jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
 CREATE TABLE public.messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,contact_id uuid,connector_id uuid,thread_key text,channel_type text,direction text,status text,recipients jsonb,sender jsonb,subject text,body_text text,body_html text,meta jsonb DEFAULT '{}',attachments jsonb DEFAULT '[]',provider_message_id text,action_id uuid,scheduled_for timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
 ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
 CREATE POLICY messages_service_all ON public.messages FOR ALL TO service_role USING(true) WITH CHECK(true);
 CREATE TABLE public.team_hub_channels(id uuid PRIMARY KEY,tenant_id uuid,kind text,agent_key text,visibility text,archived_at timestamptz,created_by uuid);
 CREATE TABLE public.team_hub_channel_members(channel_id uuid,user_id uuid);
 CREATE TABLE public.team_hub_messages(id uuid PRIMARY KEY,tenant_id uuid,channel_id uuid,author_user_id uuid,author_kind text,agent_key text,deleted_at timestamptz);
 CREATE TABLE public.team_hub_agent_turns(id uuid PRIMARY KEY,tenant_id uuid,channel_id uuid,asker_user_id uuid,source_message_id uuid,agent_key text,intent text,token_hash text,accepted_at timestamptz,consumed_at timestamptz,posted_message_id uuid);
 CREATE UNIQUE INDEX original_posted_message ON public.team_hub_agent_turns(posted_message_id) WHERE posted_message_id IS NOT NULL;
 ALTER TABLE public.team_hub_agent_turns ENABLE ROW LEVEL SECURITY;
 CREATE TABLE public.paige_subagents(slug text,tenant_id uuid,config jsonb,version integer DEFAULT 1,updated_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT active_tenant_id FROM public.profiles WHERE user_id=auth.uid()$$;
 GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;`);
 db.run(`ALTER TABLE public.paige_audit_log ENABLE ROW LEVEL SECURITY;GRANT INSERT ON public.paige_audit_log TO authenticated;
 CREATE POLICY fixture_own_audit_event ON public.paige_audit_log FOR INSERT TO authenticated
 WITH CHECK(actor_user_id=auth.uid() AND tenant_id=public.current_user_tenant_id());`);
 // Exact original actor body from the existing Communications proof; no copy of
 // its writer implementation or changed producer fixture.
 db.run(definition(read('scripts/proof/fixtures/exp03-email-existing-draft-before.sql'),'_comms_email_actor')+
  'REVOKE ALL ON FUNCTION public._comms_email_actor(uuid,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public._comms_email_actor(uuid,uuid) TO service_role;');
 const visibleSource=read('supabase/migrations/20271113850008_exp08_team_hub_collaboration.sql');
 const visibleStart=visibleSource.indexOf('CREATE OR REPLACE FUNCTION public._team_hub_visible(');
 const visibleEnd=visibleSource.indexOf('CREATE OR REPLACE FUNCTION',visibleStart+10);
 assert(visibleStart>=0&&visibleEnd>visibleStart);
 db.run(visibleSource.slice(visibleStart,visibleEnd));
 // Current original identity/participation bodies, read back November3. The
 // native source hashes below refuse any accidentally altered fixture body.
 db.run(`CREATE OR REPLACE FUNCTION public._team_hub_is_active(p_tenant uuid,p_user uuid)
 RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $function$
 SELECT EXISTS(SELECT 1 FROM public.tenant_members m
  WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active'
   AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now())) /* exp08_current_identity_v1 */)
$function$;
 CREATE OR REPLACE FUNCTION public._team_hub_participates(p_tenant uuid,p_user uuid)
 RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $function$
 SELECT EXISTS(SELECT 1 FROM public.tenant_members m
  WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active' AND m.team_hub_access
   AND public._team_hub_is_active(p_tenant,p_user) /* exp08_current_identity_v1 */)
$function$;
 REVOKE ALL ON FUNCTION public._team_hub_is_active(uuid,uuid),public._team_hub_participates(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;`);
 check(scalar("SELECT md5(pg_get_functiondef('public._team_hub_is_active(uuid,uuid)'::regprocedure))") === '8a17dba7a1a8fd50bcc5c7457e6caa05','current original Auth admission source exact');
 check(scalar("SELECT md5(pg_get_functiondef('public._team_hub_participates(uuid,uuid)'::regprocedure))") === 'c204534d91951e1a6841003f1b9976a7','current original participation source exact');
 // Install the ORIGINAL released Save13 body, not a replacement writer. All
 // real prerequisite guards in the new migration execute without being removed.
 db.run(definition(read('scripts/proof/exp03-fresh-email-save-patch.sql'),'save_comms_email_draft')+
  'REVOKE ALL ON FUNCTION public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid) TO service_role;');
 db.run(`INSERT INTO auth.users(id) VALUES('${actor}'),('${stranger}');
 INSERT INTO public.tenants VALUES('${tenant}','active','standalone',NULL),('${other}','active','standalone',NULL);
 INSERT INTO public.profiles VALUES('${actor}','${tenant}'),('${stranger}','${other}');
 INSERT INTO public.tenant_members VALUES('${actor}','${tenant}','active','owner',true),('${stranger}','${other}','active','owner',true);
 INSERT INTO public.clients VALUES('${contact}','${tenant}'),('${foreignContact}','${other}');
 INSERT INTO public.channel_connectors VALUES('${connector}','${tenant}',true,'active','email','gmail','business@tests.invalid','shared_support',NULL);
 INSERT INTO public.paige_subagents(slug,config) VALUES('nexus','{"personality":{"preserve":"original"},"team_hub_tools":{"preserve":"original"},"capability_scope":{"version":2,"mode":"allowlist","access":"card","tools":["growth_page_publish","integrations_list"]}}');
 INSERT INTO public.team_hub_channels VALUES('${channel}','${tenant}','agent_dm','nexus','private',NULL,'${actor}');
 INSERT INTO public.team_hub_channel_members VALUES('${channel}','${actor}');
 INSERT INTO public.team_hub_messages VALUES('${source}','${tenant}','${channel}','${actor}','user',NULL,NULL),('${reply}','${tenant}','${channel}','${actor}','agent','nexus',NULL);
 INSERT INTO public.team_hub_agent_turns VALUES('${turn}','${tenant}','${channel}','${actor}','${source}','nexus','dm','${token}',now(),NULL,NULL);`);
 check(scalar("SELECT to_regprocedure('public.team_hub_stage_email_draft(uuid,text,text,text)') IS NULL")==='t','baseline has no mounted email preparation');
 const originals=scalar("SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN ('public._comms_email_actor(uuid,uuid)'::regprocedure,'public._team_hub_visible(uuid,uuid,uuid)'::regprocedure,'public._team_hub_is_active(uuid,uuid)'::regprocedure,'public._team_hub_participates(uuid,uuid)'::regprocedure,'public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid)'::regprocedure)");
 db.run('CREATE POLICY fixture_unsafe_message_insert ON public.messages FOR INSERT TO authenticated WITH CHECK(true);');
 refused(()=>db.run(read('supabase/migrations/20271130020008_exp08_nexus_unsent_email_handoff.sql')),'55000');
 check(scalar("SELECT NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.team_hub_agent_turns'::regclass AND attname='email_draft' AND NOT attisdropped)")==='t','unsafe prerequisite policy refuses atomically before any new column');
 db.run('DROP POLICY fixture_unsafe_message_insert ON public.messages;');
 db.run(read('supabase/migrations/20271130020008_exp08_nexus_unsent_email_handoff.sql'));
 check(scalar("SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN ('public._comms_email_actor(uuid,uuid)'::regprocedure,'public._team_hub_visible(uuid,uuid,uuid)'::regprocedure,'public._team_hub_is_active(uuid,uuid)'::regprocedure,'public._team_hub_participates(uuid,uuid)'::regprocedure,'public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid)'::regprocedure)")===originals,'all five original bodies/OIDs/ABIs/ACLs/catalog metadata conserved');
 check(scalar("SELECT config->'personality'='{"+ '"preserve":"original"' +"}'::jsonb AND config->'team_hub_tools'='{"+ '"preserve":"original"' +"}'::jsonb AND config#>'{capability_scope,tools}' @> '[\"growth_page_publish\",\"integrations_list\"]'::jsonb FROM public.paige_subagents WHERE slug='nexus'")==='t','all incoming identity/shared/tools conserved');
 refused(()=>db.run(as('authenticated',actor,`SELECT public.team_hub_stage_email_draft('${turn}','${token}','Project update','Ready for review.');`)),'42501');
 const stage=()=>json(as('service_role',null,`SELECT public.team_hub_stage_email_draft('${turn}','${token}','Project update','Ready for review.');`));
 check(json(as('service_role',null,`SELECT public.team_hub_email_draft_scope('${turn}','${token}');`)).ok===true,'original accepted-token scope admits preparation without domain effects');
 refused(()=>db.run(as('authenticated',actor,`SELECT public.team_hub_email_draft_scope('${turn}','${token}');`)),'42501');
 check(stage().ok===true,'trusted host stages a preparation, not a Messages save');
 check(scalar('SELECT count(*) FROM public.messages')==='0','preparation never saves or sends');
 db.run(`UPDATE public.team_hub_agent_turns SET posted_message_id='${reply}',consumed_at=now() WHERE id='${turn}';`);
 check(json(as('service_role',null,`SELECT public.team_hub_email_draft_scope('${turn}','${token}');`)).ok===false,'consumed turn cannot lend preparation authority');
 check(get().draft.subject==='Project update','original asker can reopen private preparation');
 db.run(`UPDATE public.team_hub_channels SET created_by='${stranger}' WHERE id='${channel}';`);
 check(get().ok===false,'stale membership does not grant another person private-DM preparation');
 db.run(`UPDATE public.team_hub_channels SET created_by='${actor}',visibility='team' WHERE id='${channel}';`);
 check(get().ok===false,'a broadened DM visibility cannot expose prepared private content');
 db.run(`UPDATE public.team_hub_channels SET visibility='private' WHERE id='${channel}';`);
 check(json(as('authenticated',actor,`SELECT public.team_hub_email_drafts('${tenant}',ARRAY['${reply}'::uuid]);`)).drafts.length===1,'batch shows only permitted requested private preparation');
 check(json(as('authenticated',stranger,`SELECT public.team_hub_email_drafts('${other}',ARRAY['${reply}'::uuid]);`)).drafts.length===0,'batch does not disclose another actor preparation');
 check(get(reply,null,tenant,stranger).ok===false,'foreign actor/workspace cannot inspect preparation');
 check(get(reply,foreignContact).ok===false,'cross-tenant recipient refused');
 check(get(reply,contact).draft.contact_id===contact,'person explicitly binds existing own contact');
 check(get(reply,foreignContact).ok===false,'bound recipient cannot be replaced');
 db.run(`UPDATE public.tenant_members SET team_hub_access=false WHERE user_id='${actor}';`);
 check(get().ok===false,'Team conversations revocation blocks source read');
 db.run(`UPDATE public.tenant_members SET team_hub_access=true,role='member' WHERE user_id='${actor}';`);
 check(get().ok===false,'Member cannot borrow Owner preparation');
 db.run(`UPDATE public.tenant_members SET role='owner' WHERE user_id='${actor}';UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${actor}';`);
 check(get().ok===false,'suspended actor refused despite existing token');
 db.run(`UPDATE auth.users SET banned_until=NULL WHERE id='${actor}';`);
 db.run(`UPDATE public.team_hub_messages SET deleted_at=now() WHERE id='${source}';`);
 check(get().ok===false,'deleted asking source cannot authorize continuation');
 db.run(`UPDATE public.team_hub_messages SET deleted_at=NULL WHERE id='${source}';UPDATE public.profiles SET active_tenant_id='${other}' WHERE user_id='${actor}';`);
 check(get().ok===false,'stale active workspace is refused');
 db.run(`UPDATE public.profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';UPDATE public.paige_subagents SET config=jsonb_set(config,'{capability_scope,tools}',(config#>'{capability_scope,tools}')-'comms_send_email') WHERE slug='nexus';`);
 check(get().ok===false,'stored specialist action revocation blocks continuation');
 db.run(`UPDATE public.paige_subagents SET config=jsonb_set(config,'{capability_scope,tools}',(config#>'{capability_scope,tools}')||'["comms_send_email"]'::jsonb) WHERE slug='nexus';UPDATE public.tenant_members SET role='admin' WHERE user_id='${actor}';`);
 check(get().ok===true,'existing permitted Admin uses the same original flow without Owner promotion');
 db.run(`UPDATE public.tenant_members SET role='owner' WHERE user_id='${actor}';`);
 const reconcile=()=>json(as('service_role',null,`SELECT public.team_hub_record_email_draft('${tenant}','${actor}','${reply}','${operation}');`));
 check(reconcile().status==='unknown','missing original receipt remains unknown; no automatic effect');
 const forgedProbe=()=>db.run(`BEGIN;INSERT INTO public.messages(id,tenant_id,contact_id,connector_id,channel_type,direction,status,subject,body_text,updated_at)
 VALUES('a9000000-0000-4000-8000-000000000001','${tenant}','${contact}','${connector}','email','outbound','draft','Project update','Ready for review.','2026-11-03T02:00:00.123456+00:00');
 ${as('authenticated',actor,`INSERT INTO public.paige_audit_log(id,actor_user_id,tenant_id,action,target_type,target_id,payload)
 VALUES('b9000000-0000-4000-8000-000000000001','${actor}','${tenant}','comms.email_draft_saved','message','a9000000-0000-4000-8000-000000000001','{"operation_id":"${operation}","request_digest":"untrusted","saved_version":"2026-11-03T02:00:00.123456+00:00"}');`)}
 RESET ROLE;SET ROLE service_role;SELECT public.team_hub_record_email_draft('${tenant}','${actor}','${reply}','${operation}');ROLLBACK;`);
 const forgedStatus=()=>JSON.parse(forgedProbe().split(/\r?\n/).find(line=>line.startsWith('{'))).status;
 check(forgedStatus()==='unknown','caller-recorded audit plus matching text is NOT trusted execution');
 const originalRecord=JSON.parse(scalar("SELECT to_json(pg_get_functiondef('public.team_hub_record_email_draft(uuid,uuid,uuid,uuid)'::regprocedure))"));
 const trustedMessageGuard=/\n  OR m\.meta#>>'\{comms_draft_save,id\}'[\s\S]*?IS DISTINCT FROM m\.updated_at/;
 check(trustedMessageGuard.test(originalRecord),'mutation targets the actual committed-message/audit binding');
 db.run(originalRecord.replace(trustedMessageGuard,''));
 check(forgedStatus()==='saved','removing trusted-message binding breaks the forged-audit refusal control');
 db.run(originalRecord);
 check(forgedStatus()==='unknown','restoring original consumer guard restores refusal; no fixture result persists');
 const save=()=>json(as('service_role',null,`SELECT public.save_comms_email_draft('${actor}','${tenant}','${operation}',NULL,NULL,'${contact}','${connector}','Project update','Ready for review.','<p>Ready for review.</p>','[]',NULL,NULL);`));
 const saved=save();check(saved.ok===true&&saved.outcome==='draft_saved','ORIGINAL native writer saves unsent');
 const verified=reconcile();check(verified.status==='saved'&&verified.result.message_id===saved.message_id&&verified.result.receipt_id===saved.receipt_id,'Hub reference is actual original message/audit result');
 check(save().message_id===saved.message_id,'same original operation reconciles the original draft');
 check(scalar('SELECT count(*) FROM public.messages')==='1','exactly one original draft exists');
 check(get().draft.result.message_id===saved.message_id,'fresh native read reopens same original reference');
 refused(()=>db.run(as('authenticated',actor,`UPDATE public.team_hub_agent_turns SET email_draft='{"subject":"forged","body":"forged","result":{"status":"done"}}' WHERE id='${turn}';`)),'42501');
 refused(()=>db.run(as('authenticated',actor,`SELECT public.team_hub_record_email_draft('${tenant}','${actor}','${reply}','${operation}');`)),'42501');
 check(scalar("SELECT status='draft' AND provider_message_id IS NULL AND scheduled_for IS NULL FROM public.messages")==='t','nothing sent, scheduled or provider-executed');
 // The original service-token cleanup must remain usable after role revocation.
 const a1=read('supabase/migrations/20271117010008_exp08_team_hub_agents.sql');
 const endStart=a1.indexOf('CREATE OR REPLACE FUNCTION public.team_hub_end_agent_turn(');
 const endEnd=a1.indexOf('-- Posts one agent',endStart);assert(endStart>=0&&endEnd>endStart);
 db.run(a1.slice(endStart,endEnd));
 const pending='50000000-0000-4000-8000-000000000002';
 db.run(`INSERT INTO public.team_hub_agent_turns(id,tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash,accepted_at)
 VALUES('${pending}','${tenant}','${channel}','${actor}','${source}','nexus','dm','${token}',now());`);
 check(json(as('service_role',null,`SELECT public.team_hub_stage_email_draft('${pending}','${token}','Pending','Private preparation.');`)).ok===true,'unposted preparation staged for cleanup control');
 db.run(`UPDATE public.tenant_members SET team_hub_access=false WHERE user_id='${actor}';`);
 check(json(as('service_role',null,`SELECT public.team_hub_end_agent_turn('${pending}','${token}');`)).ok===true,'ORIGINAL end door retires prepared turn after revocation');
 check(scalar(`SELECT consumed_at IS NOT NULL AND posted_message_id IS NULL AND email_draft IS NULL FROM public.team_hub_agent_turns WHERE id='${pending}'`)==='t','retired turn contains no unpublished private preparation or effect');
 db.run(`UPDATE public.tenant_members SET team_hub_access=true WHERE user_id='${actor}';`);
 const departure=await verifyNexusEmailDeparture(db,{actor,tenant,reply,channel});
 console.log(JSON.stringify({passed:checks,departure,evidence:'isolated native component with abridged tables; NOT full-schema/Auth/customer/provider proof'}));
}catch(error){failed=true;console.error('Original component failure:',error);throw error;
}finally{
 try{db.run(`DROP DATABASE ${db.database}`,[],'postgres');console.log('Own disposable component database disposed');}
 catch(error){console.error('Own disposable component cleanup failed:',error);if(!failed)throw error;}
}
