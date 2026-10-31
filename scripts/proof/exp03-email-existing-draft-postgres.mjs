// Isolated native writer component. No real account, provider, RLS or Auth SDK proof.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
import {canonicalCommsEmailSendAt} from '../../supabase/functions/_shared/comms-email/contract.ts';
const db=new OperatorPostgresFixture(Number(process.argv[2]));db.prefix=()=>'';
const read=p=>readFileSync(p,'utf8');
const actor='70000000-0000-4000-8000-000000000001',otherActor='70000000-0000-4000-8000-000000000002';
const tenant='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const contact='20000000-0000-4000-8000-000000000001',connector='30000000-0000-4000-8000-000000000001';
const draft='40000000-0000-4000-8000-000000000001',operation='50000000-0000-4000-8000-000000000001';
const version='2026-10-30T16:00:00.123456Z',html='<p><strong>An existing draft.</strong></p>';
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const source={message_id:draft,updated_at:version};
const command={action:'comms.email_send',contact_id:contact,connector_id:connector,subject:'Existing subject',body:'An existing draft.'};
const governance={actor_user_id:actor,tenant_id:tenant,tool:'comms_send_email',action:'comms.email_send',approval_channel:'operator_card',approved_fingerprint:'1'.repeat(16),decision_receipt_recorded:true};
const signature='public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)';
const signature16='public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz,jsonb,jsonb)';
const seedDraft=`INSERT INTO public.messages(id,tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,recipients,sender,subject,body_text,body_html,updated_at,meta)
 VALUES('${draft}','${tenant}','${contact}','${connector}','original-existing-thread','email','outbound','draft','[{"address":"client@tests.invalid","name":"Original client"}]','{"address":"business@tests.invalid","name":"Original business"}',${quote(command.subject)},${quote(command.body)},${quote(html)},'${version}','{"source":"original-manual-draft","keep":7}');`;
let checks=0;
function prepareSQL({source:locator=source,op=operation,legacy=false,governance:gov=governance,connectorId=connector,role='service_role',sendAt=null,attachments=null,command:draftCommand=command,bodyHtml=html}={}){
 const selectedCommand={...draftCommand,connector_id:connectorId};
 const args=[`${quote(actor)}::uuid`,`${quote(tenant)}::uuid`,`${quote(op)}::uuid`,`${quote(contact)}::uuid`,quote('client@tests.invalid'),`${quote(connectorId)}::uuid`,quote('business@tests.invalid'),quote(selectedCommand.subject),quote(selectedCommand.body),quote(bodyHtml),
  quote(createHash('sha256').update('client@tests.invalid\n'+connectorId+'\n'+selectedCommand.subject+'\n'+selectedCommand.body).digest('hex')),`${quote(JSON.stringify(selectedCommand))}::jsonb`,`${quote(JSON.stringify(legacy&&locator!==null?{...gov,draft_source:locator}:gov))}::jsonb`];
 if(!legacy)args.push(sendAt===null?'NULL::timestamptz':`${quote(sendAt)}::timestamptz`,attachments===null?'NULL::jsonb':`${quote(JSON.stringify(attachments))}::jsonb`,`${quote(JSON.stringify(locator))}::jsonb`);
 assert(['service_role','authenticated','anon'].includes(role));
 return `SET ROLE ${role};SELECT public.prepare_comms_email_send(${args.join(',')});`;
}
function prepare(options){
 const lines=db.run(prepareSQL(options)).split(/\r?\n/).filter(line=>line.startsWith('{'));
 assert.equal(lines.length,1,'one original RPC result, separate from psql SET acknowledgement');
 return JSON.parse(lines[0]);
}
const businessState=()=>db.run(`SELECT jsonb_build_object('messages',(SELECT jsonb_agg(m ORDER BY id) FROM public.messages m),'audit',(SELECT jsonb_agg(a ORDER BY id) FROM public.paige_audit_log a),'actions',(SELECT jsonb_agg(a ORDER BY id) FROM public.paige_actions a),'approvals',(SELECT jsonb_agg(a ORDER BY id) FROM public.paige_pending_approvals a),'users',(SELECT jsonb_agg(u ORDER BY id) FROM auth.users u),'seats',(SELECT jsonb_agg(s ORDER BY user_id,tenant_id) FROM public.tenant_members s),'profiles',(SELECT jsonb_agg(p ORDER BY user_id) FROM public.profiles p),'connectors',(SELECT jsonb_agg(c ORDER BY id) FROM public.channel_connectors c))`);
function reset(){db.run(`DELETE FROM public.paige_audit_log;DELETE FROM public.messages;DELETE FROM public.paige_actions;DELETE FROM public.paige_pending_approvals;DELETE FROM public.paige_action_kinds;${seedDraft}
 UPDATE auth.users SET deleted_at=NULL,banned_until=NULL;
 UPDATE public.tenants SET status='active';UPDATE public.profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';
 UPDATE public.tenant_members SET status='active',role='owner' WHERE user_id='${actor}';
 UPDATE public.channel_connectors SET mailbox_class='shared_support',mailbox_owner_user_id=NULL,active=true,status='active',channel_type='email';`);}
function refuse(run,pattern){const before=businessState();assert.throws(run,pattern);assert.equal(businessState(),before,'refusal preserves every source and business row');checks++;}
const currentSource=()=>JSON.parse(db.run(`SELECT jsonb_build_object('message_id',id,'updated_at',updated_at) FROM public.messages WHERE id='${draft}'`));
const approval='80000000-0000-4000-8000-000000000001',action='90000000-0000-4000-8000-000000000001';
function seedOriginalAction(kind='owner.lead_followup') {
 reset();db.run(`INSERT INTO public.paige_pending_approvals(id,tenant_id,contact_id,status,metadata) VALUES('${approval}','${tenant}','${contact}','pending','{"action_id":"${action}"}');
 INSERT INTO public.paige_actions(id,approval_id,tenant_id,contact_id,action_kind,status) VALUES('${action}','${approval}','${tenant}','${contact}',${quote(kind)},'pending_approval');
 INSERT INTO public.paige_action_kinds VALUES(${quote(kind)},'send_via_approval');
 UPDATE public.messages SET action_id='${action}' WHERE id='${draft}';`);
}
function concurrentPrepare(tag,options){
 const child=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';
 child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
 const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
 completed.catch(()=>{});
 child.stdin.end(`SET application_name=${quote(tag)};SET statement_timeout='10s';${prepareSQL(options)}`);
 return {child,completed};
}
async function observeWait(tags){
 const deadline=Date.now()+8000;
 while(Date.now()<deadline){
  if(Number(db.run(`SELECT count(*) FROM pg_stat_activity WHERE datname=${quote(db.database)} AND application_name IN (${tags.map(quote).join(',')}) AND wait_event_type='Lock'`))===tags.length)return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw new Error('Original native source-row lock wait was not observed');
}
try{
 db.run(`CREATE SCHEMA auth;CREATE SCHEMA private;CREATE SCHEMA storage;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;END$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text);
 CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE public.tenant_members(user_id uuid,tenant_id uuid,status text,role text);
 CREATE TABLE public.clients(id uuid PRIMARY KEY,tenant_id uuid);
 CREATE TABLE public.client_contact_methods(tenant_id uuid,client_id uuid,kind text,value text);
 CREATE TABLE public.channel_connectors(id uuid PRIMARY KEY,tenant_id uuid,active boolean,status text,channel_type text,provider text,from_address text,mailbox_class text,mailbox_owner_user_id uuid);
 CREATE TABLE public.paige_pending_approvals(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,status text,metadata jsonb);
 CREATE TABLE public.paige_actions(id uuid PRIMARY KEY,approval_id uuid,tenant_id uuid,contact_id uuid,action_kind text,status text,payload jsonb DEFAULT '{}');
 CREATE TABLE public.paige_action_kinds(slug text,executor text);
 CREATE TABLE public.paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,actor_role text,tenant_id uuid,action text NOT NULL,target_type text,target_id uuid,payload jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb);
 CREATE TABLE public.tenant_email_domains(tenant_id uuid,domain text,sendgrid_status text,sendgrid_verified_at timestamptz,sendgrid_domain_id text);
 CREATE TABLE public.messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,contact_id uuid,connector_id uuid,thread_key text,channel_type text,direction text,status text,recipients jsonb,sender jsonb,subject text,body_text text,body_html text,meta jsonb DEFAULT '{}',attachments jsonb DEFAULT '[]',provider_message_id text,action_id uuid,scheduled_for timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 CREATE UNIQUE INDEX messages_comms_email_operation ON public.messages((meta#>>'{comms_email_binding,operation_id}')) WHERE meta?'comms_email_binding';
 -- Exact original version-trigger body301a884953d37769916294bb60562e05.
 CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
 CREATE TRIGGER trg_messages_updated_at BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
 -- Unexercised commercial branch fails loudly; this is not commercial evidence.
 CREATE FUNCTION private.e04_agreement_email_origin(uuid,uuid,jsonb,boolean) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'UNEXERCISED_AGREEMENT';END$$;
 INSERT INTO auth.users(id) VALUES('${actor}'),('${otherActor}');
 INSERT INTO public.tenants VALUES('${tenant}','active'),('${other}','active');
 INSERT INTO public.profiles VALUES('${actor}','${tenant}'),('${otherActor}','${other}');
 INSERT INTO public.tenant_members VALUES('${actor}','${tenant}','active','owner'),('${otherActor}','${other}','active','owner');
 INSERT INTO public.clients VALUES('${contact}','${tenant}');
 INSERT INTO public.client_contact_methods VALUES('${tenant}','${contact}','email','client@tests.invalid');
 INSERT INTO public.channel_connectors VALUES('${connector}','${tenant}',true,'active','email','gmail','business@tests.invalid','shared_support',NULL);
 ${seedDraft}`);
 db.run(read('scripts/proof/fixtures/exp03-email-existing-draft-file-helpers.sql'));
 db.run(read('scripts/proof/fixtures/exp03-email-existing-draft-before.sql'));
 assert.equal(db.run(`SELECT md5(pg_get_functiondef('${signature}'::regprocedure))`),'44040e47f20c4a285177b09ea9f5a717');checks++;
 assert.equal(db.run(`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.update_updated_at_column()'::regprocedure`),'301a884953d37769916294bb60562e05');checks++;
 if(process.argv.includes('--baseline')){
  refuse(()=>prepare(),error=>error.code==='42883');
  assert.equal(db.run('SELECT count(*) FROM public.messages'),'1');
  const result=prepare({legacy:true});
  console.log(JSON.stringify({baselineOriginalRow:result.message_id===draft,messageCount:Number(db.run('SELECT count(*) FROM public.messages'))}));
  assert.equal(result.message_id,draft,'the original INSERT-only prepare does not adopt the requested existing draft');
 }else{
  const originalMetadata=db.run(`SELECT jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc') FROM pg_proc p WHERE oid IN (SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('prepare_comms_email_send','_comms_email_actor','_comms_email_governance'))`);
  const candidate=read('scripts/proof/exp03-email-existing-draft-patch.sql');
  const originalCatalogue=()=>db.run(`SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE pronamespace='public'::regnamespace`);
  const refusePatch=(setup,sql,pattern)=>{const before=originalCatalogue(),rows=businessState();assert.throws(()=>db.run('BEGIN;'+setup+';'+sql+';COMMIT;'),pattern);assert.equal(originalCatalogue(),before,'failed composition restores original function source, OIDs and metadata');assert.equal(businessState(),rows);checks++;};
  refusePatch(`ALTER FUNCTION ${signature} SECURITY INVOKER`,candidate,/original metadata drift/);
  refusePatch(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated`,candidate,/original metadata drift/);
  refusePatch(`ALTER FUNCTION ${signature} SET search_path TO public`,candidate,/original metadata drift/);
  refusePatch(`COMMENT ON FUNCTION ${signature} IS 'unchanged source metadata control'`,candidate.replace("41cb53161afde5aa03d17013509f15f5' THEN RAISE EXCEPTION 'EXP03 saved draft readback mismatch'","00000000000000000000000000000000' THEN RAISE EXCEPTION 'EXP03 saved draft readback mismatch'"),/saved draft readback mismatch/);
  const lateAnchor="THEN RAISE EXCEPTION 'EXP03 saved draft overload readback mismatch';END IF;";
  assert.equal(candidate.split(lateAnchor).length,2);
  refusePatch('',candidate.replace(lateAnchor,()=>lateAnchor+" RAISE EXCEPTION 'EXP03 forced late overload failure';"),/forced late overload failure/);
  assert.equal(db.run(`SELECT to_regprocedure('${signature16}') IS NULL`),'t','late rollback removes newly created overload');checks++;
  db.run(candidate);
  const adoptedCatalogue=originalCatalogue();db.run(candidate);assert.equal(originalCatalogue(),adoptedCatalogue,'exact replay preserves all function OIDs and metadata');checks++;
  refusePatch(`ALTER FUNCTION ${signature16} STABLE`,candidate,/overload drift/);

  assert.equal(db.run(`SELECT jsonb_object_agg(oid::regprocedure::text,to_jsonb(p)-'prosrc') FROM pg_proc p WHERE oid IN (SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('prepare_comms_email_send','_comms_email_actor','_comms_email_governance') AND oid<>'${signature16}'::regprocedure)`),originalMetadata);checks++;
  // Durable edits are on the SAME source row, without preparing/approving/sending it.
  const saveCandidate=read('scripts/proof/exp03-email-save-draft.sql');db.run(saveCandidate);db.run(saveCandidate);
  const saveId='b0000000-0000-4000-8000-000000000001';
  const saveSQL=(expected=version,over={})=>{
   const p={actor,tenant,id:saveId,message:draft,version:expected,contact,connector,subject:'Saved subject',text:'Saved unsent words.',html:'<p>Saved unsent words.</p>',files:[],time:null,approval:null,...over};
   return `SET ROLE service_role;SELECT public.save_comms_email_draft(${[p.actor,p.tenant,p.id,p.message,p.version,p.contact,p.connector,p.subject,p.text,p.html,JSON.stringify(p.files),p.time,p.approval].map(v=>v===null?'NULL':quote(v)).join(',')});`;
  };
  const saved=JSON.parse(db.run(saveSQL()).split(/\r?\n/).find(x=>x.startsWith('{')));
  assert.equal(saved.outcome,'draft_saved');assert.equal(saved.message_id,draft);checks++;
  assert.equal(db.run(`SELECT status||':'||subject||':'||(meta?'comms_email_binding')::text||':'||(meta->>'keep') FROM public.messages WHERE id='${draft}'`),'draft:Saved subject:false:7');checks++;
  const replaySaved=JSON.parse(db.run(saveSQL()).split(/\r?\n/).find(x=>x.startsWith('{')));
  assert.equal(replaySaved.replayed,true);assert.equal(replaySaved.updated_at,saved.updated_at);checks++;
  assert.equal(replaySaved.receipt_id,saved.receipt_id);assert.equal(db.run(`SELECT count(*) FROM public.paige_audit_log WHERE action='comms.email_draft_saved'`),'1');checks++;
  refuse(()=>db.run(saveSQL(version,{text:'A different stale edit.'})),/COMMS_EMAIL_DRAFT_SAVE_REPLAY_MISMATCH/);
  reset();db.run(`ALTER TABLE public.paige_audit_log ADD CONSTRAINT proof_save_audit_refusal CHECK (action<>'comms.email_draft_saved')`);
  refuse(()=>db.run(saveSQL()),/proof_save_audit_refusal/);
  db.run('ALTER TABLE public.paige_audit_log DROP CONSTRAINT proof_save_audit_refusal');
  for(const role of ['anon','authenticated']){reset();refuse(()=>db.run(saveSQL().replace('SET ROLE service_role',`SET ROLE ${role}`)),/permission denied for function/);}
  for(const [setup,reason] of [
   [`UPDATE public.tenant_members SET role='member' WHERE user_id='${actor}'`,/COMMS_EMAIL_AUTHORITY_UNAVAILABLE/],
   [`UPDATE public.profiles SET active_tenant_id='${other}' WHERE user_id='${actor}'`,/COMMS_EMAIL_WORKSPACE_CHANGED/],
   [`UPDATE public.messages SET status='queued' WHERE id='${draft}'`,/COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE/],
   [`UPDATE public.channel_connectors SET mailbox_class='personal',mailbox_owner_user_id='${otherActor}' WHERE id='${connector}'`,/COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE/],
   [`UPDATE public.channel_connectors SET active=false WHERE id='${connector}'`,/COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE/],
   [`UPDATE public.messages SET meta=meta||'{"sales_invoice_binding":{}}' WHERE id='${draft}'`,/COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE/],
  ]){reset();db.run(setup);refuse(()=>db.run(saveSQL(currentSource().updated_at)),reason);}
  reset();refuse(()=>db.run(saveSQL(version,{tenant:other})),/COMMS_EMAIL_WORKSPACE_CHANGED|COMMS_EMAIL_AUTHORITY_UNAVAILABLE/);
  reset();refuse(()=>db.run(saveSQL(version,{contact:other})),/COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE/);
  seedOriginalAction();refuse(()=>db.run(saveSQL(currentSource().updated_at)),/COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED/);
  seedOriginalAction();const actionSaved=JSON.parse(db.run(saveSQL(currentSource().updated_at,{approval})).split(/\r?\n/).find(x=>x.startsWith('{')));
  assert.equal(actionSaved.outcome,'draft_saved');assert.equal(db.run(`SELECT status FROM public.paige_pending_approvals WHERE id='${approval}'`),'pending');checks++;
  assert.equal(db.run(`SELECT count(*) FROM public.messages WHERE meta?'comms_email_binding'`),'0');checks++;
  for(const state of ['drafted','pending_approval']){
   seedOriginalAction();db.run(`UPDATE public.paige_actions SET status=${quote(state)} WHERE id='${action}'`);
   const savedAction=JSON.parse(db.run(saveSQL(currentSource().updated_at,{approval})).split(/\r?\n/).find(x=>x.startsWith('{')));
   assert.equal(savedAction.outcome,'draft_saved');assert.equal(db.run(`SELECT status FROM public.paige_actions WHERE id='${action}'`),state);checks++;
  }
  for(const state of ['blocked','executed','cancelled']){
   seedOriginalAction();db.run(`UPDATE public.paige_actions SET status=${quote(state)} WHERE id='${action}'`);
   refuse(()=>db.run(saveSQL(currentSource().updated_at,{approval})),/COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED/);
  }
  reset();
  const result=prepare();assert.equal(result.message_id,draft);checks++;
  assert.equal(db.run('SELECT count(*) FROM public.messages'),'1');checks++;
  assert.equal(db.run(`SELECT body_html FROM public.messages WHERE id='${draft}'`),html);checks++;
  assert.equal(db.run(`SELECT thread_key FROM public.messages WHERE id='${draft}'`),'original-existing-thread');checks++;
  assert.equal(db.run(`SELECT (meta->>'source')||':'||(meta->>'keep')||':'||(sender->>'name')||':'||(recipients->0->>'name') FROM public.messages WHERE id='${draft}'`),'original-manual-draft:7:Original business:Original client');checks++;
  const replay=prepare();assert.equal(replay.replayed,true);assert.equal(replay.message_id,draft);checks++;
  assert.equal(db.run('SELECT count(*) FROM public.messages'),'1');checks++;
  refuse(()=>prepare({op:'50000000-0000-4000-8000-000000000002'}),/COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE/);
  refuse(()=>prepare({source:{...source,updated_at:version.replace('123456','123457')}}),/COMMS_EMAIL_REPLAY_MISMATCH/);
  // These exercise the ORIGINAL action/approval branch, previously unexercised by
  // the ordinary-source fixture. Its real status field and original kind registry
  // are fixture data, never new authority or a production schema modification.
  for(const kind of ['owner.lead_followup','client.followup','owner.followup_email']) {
   seedOriginalAction(kind);
   const owned=prepare({source:currentSource(),governance:{...governance,approval_id:approval}});
   assert.equal(owned.message_id,draft);assert.equal(db.run('SELECT count(*) FROM public.messages'),'1');
   assert.equal(db.run(`SELECT action_id::text||':'||(meta#>>'{comms_email_binding,approval_id}') FROM public.messages WHERE id='${draft}'`),`${action}:${approval}`);checks++;
  }
  seedOriginalAction();refuse(()=>prepare({source:currentSource()}),/COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED/);
  seedOriginalAction();db.run(`UPDATE public.messages SET action_id=NULL WHERE id='${draft}'`);
  refuse(()=>prepare({source:currentSource(),governance:{...governance,approval_id:approval}}),/COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED/);
  seedOriginalAction('agreement.signature_request');
  refuse(()=>prepare({source:currentSource(),governance:{...governance,approval_id:approval}}),/COMMS_EMAIL_APPROVAL_INVALID/);
  for(const role of ['anon','authenticated']){reset();refuse(()=>prepare({role}),/permission denied for function/);}
  for(const locator of [null,[],{}, {...source,tenant_id:other},{...source,message_id:'not-an-id'},{...source,updated_at:'yesterday'}]){reset();refuse(()=>prepare({source:locator}),/COMMS_EMAIL_DRAFT_SOURCE_INVALID/);}
  for(const [change,reason] of [
   [`UPDATE public.messages SET subject='Changed' WHERE id='${draft}'`,'SOURCE_CHANGED'],
   [`UPDATE public.messages SET subject='Away' WHERE id='${draft}';UPDATE public.messages SET subject='Existing subject' WHERE id='${draft}'`,'SOURCE_CHANGED'],
   [`UPDATE public.messages SET tenant_id='${other}' WHERE id='${draft}'`,'SOURCE_UNAVAILABLE'],
   [`UPDATE public.messages SET status='sent',provider_message_id='fictional-receipt' WHERE id='${draft}'`,'SOURCE_UNAVAILABLE'],
   [`UPDATE public.messages SET status='queued' WHERE id='${draft}'`,'SOURCE_UNAVAILABLE'],
   [`UPDATE public.messages SET direction='inbound' WHERE id='${draft}'`,'SOURCE_UNAVAILABLE'],
   [`UPDATE public.messages SET channel_type='sms' WHERE id='${draft}'`,'SOURCE_UNAVAILABLE'],
   [`UPDATE public.messages SET meta='{"sales_invoice_binding":{}}' WHERE id='${draft}'`,'SOURCE_UNAVAILABLE'],
   [`UPDATE public.messages SET meta='{"comms_email_binding":{}}' WHERE id='${draft}'`,'SOURCE_UNAVAILABLE'],
   [`UPDATE public.channel_connectors SET mailbox_class='personal',mailbox_owner_user_id='${otherActor}' WHERE id='${connector}'`,'SOURCE_UNAVAILABLE'],
   [`UPDATE public.profiles SET active_tenant_id='${other}' WHERE user_id='${actor}'`,'WORKSPACE_CHANGED'],
   [`UPDATE public.tenant_members SET role='member' WHERE user_id='${actor}'`,'AUTHORITY_UNAVAILABLE'],
   [`UPDATE public.tenant_members SET status='inactive' WHERE user_id='${actor}'`,'AUTHORITY_UNAVAILABLE'],
   [`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${actor}'`,'ACTOR_UNAVAILABLE'],
   [`UPDATE auth.users SET deleted_at=now() WHERE id='${actor}'`,'ACTOR_UNAVAILABLE'],
  ]){reset();db.run(change);refuse(()=>prepare(),new RegExp('COMMS_EMAIL_'+(reason.startsWith('SOURCE_')?'DRAFT_':'')+reason));}
  reset();refuse(()=>prepare({source:{...source,message_id:operation}}),/COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE/);
  reset();db.run(`UPDATE public.channel_connectors SET mailbox_class='personal',mailbox_owner_user_id='${actor}' WHERE id='${connector}'`);assert.equal(prepare().message_id,draft);checks++;
  reset();const otherConnector='30000000-0000-4000-8000-000000000002';
  db.run(`INSERT INTO public.channel_connectors VALUES('${otherConnector}','${tenant}',true,'active','email','gmail','business@tests.invalid','shared_support',NULL);
   UPDATE public.channel_connectors SET mailbox_class='personal',mailbox_owner_user_id='${actor}' WHERE id='${connector}'`);
  refuse(()=>prepare({connectorId:otherConnector}),/COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED/);
  reset();db.run(`UPDATE public.channel_connectors SET mailbox_class='personal',mailbox_owner_user_id='${otherActor}' WHERE id='${connector}'`);
  refuse(()=>prepare({connectorId:otherConnector}),/COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE/);
  for(const changed of ["active=false","status='revoked'","channel_type='sms'"]){
   reset();db.run(`UPDATE public.channel_connectors SET ${changed} WHERE id='${connector}'`);
   refuse(()=>prepare({connectorId:otherConnector}),/COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE/);
  }
  reset();db.run(`UPDATE public.tenant_members SET role='admin' WHERE user_id='${actor}'`);assert.equal(prepare().message_id,draft);checks++;
  reset();const ordinary=prepare({legacy:true,source:null});assert.notEqual(ordinary.message_id,draft);assert.equal(db.run('SELECT count(*) FROM public.messages'),'2');checks++;
  reset();const beforeReplay=businessState();db.run(read('scripts/proof/exp03-email-existing-draft-patch.sql'));assert.equal(businessState(),beforeReplay);checks++;
  const sendAt=canonicalCommsEmailSendAt(new Date(Date.now()+10*60_000).toISOString());
  seedOriginalAction();
  const ownedScheduledSource=currentSource();
  const ownedScheduled=prepare({source:ownedScheduledSource,sendAt,governance:{...governance,approval_id:approval}});
  assert.equal(ownedScheduled.message_id,draft);assert.equal(ownedScheduled.send_at,sendAt);checks++;
  assert.equal(db.run(`SELECT status||':'||(meta#>>'{comms_email_binding,approval_id}') FROM public.messages WHERE id='${draft}'`),`queued:${approval}`);checks++;
  assert.equal(prepare({source:ownedScheduledSource,sendAt,governance:{...governance,approval_id:approval}}).replayed,true);checks++;
  reset();
  refuse(()=>prepare({sendAt:new Date(Date.parse(sendAt)+1).toISOString()}),/COMMS_EMAIL_SEND_AT_INVALID/);
  const scheduled=prepare({sendAt});assert.equal(scheduled.message_id,draft);assert.equal(scheduled.send_at,sendAt);checks++;
  assert.equal(db.run(`SELECT status||':'||(scheduled_for=${quote(sendAt)}::timestamptz)::text FROM public.messages WHERE id='${draft}'`),'queued:true');checks++;
  assert.equal(prepare({sendAt}).replayed,true);checks++;
  refuse(()=>prepare({sendAt:new Date(Date.parse(sendAt)+60_000).toISOString()}),/COMMS_EMAIL_REPLAY_MISMATCH/);
  reset();db.run(`UPDATE public.channel_connectors SET provider='sendgrid' WHERE id='${connector}';
   INSERT INTO public.tenant_email_domains VALUES('${tenant}','tests.invalid','verified',now(),'synthetic-domain-facts');`);
  const manifest=[{path:tenant+'/governed/'+operation+'/1-evidence.pdf',source_path:tenant+'/60000000-0000-4000-8000-000000000001-evidence.pdf',name:'evidence.pdf',mime:'application/pdf',size:17,sha256:'a'.repeat(64)}];
  db.run(`INSERT INTO storage.objects VALUES('comms-attachments',${quote(manifest[0].path)},'{"size":17}');
   UPDATE public.messages SET attachments='[{"url":"original-source-file","name":"evidence.pdf"}]' WHERE id='${draft}'`);
  const fileSource=currentSource();const withFiles=prepare({source:fileSource,attachments:manifest});assert.equal(withFiles.message_id,draft);assert.equal(withFiles.attachments,1);checks++;
  assert.equal(db.run('SELECT count(*) FROM public.messages'),'1');checks++;
  assert.equal(db.run(`SELECT attachments->0->>'url' FROM public.messages WHERE id='${draft}'`),manifest[0].path);checks++;
  assert.deepEqual(JSON.parse(db.run(`SELECT meta#>'{comms_email_binding,attachments}' FROM public.messages WHERE id='${draft}'`)),manifest);checks++;
  assert.equal(prepare({source:fileSource,attachments:manifest}).replayed,true);checks++;
  refuse(()=>prepare({source:fileSource,attachments:[{...manifest[0],sha256:'b'.repeat(64)}]}),/COMMS_EMAIL_REPLAY_MISMATCH/);
  seedOriginalAction();db.run(`UPDATE public.channel_connectors SET provider='sendgrid' WHERE id='${connector}'`);
  const ownedFileSource=currentSource();
  const ownedFiles=prepare({source:ownedFileSource,attachments:manifest,governance:{...governance,approval_id:approval}});
  assert.equal(ownedFiles.message_id,draft);assert.equal(ownedFiles.attachments,1);checks++;
  assert.equal(db.run(`SELECT action_id::text||':'||(meta#>>'{comms_email_binding,approval_id}') FROM public.messages WHERE id='${draft}'`),`${action}:${approval}`);checks++;
  assert.equal(prepare({source:ownedFileSource,attachments:manifest,governance:{...governance,approval_id:approval}}).replayed,true);checks++;
  seedOriginalAction();refuse(()=>prepare({source:currentSource(),attachments:manifest,governance:{...governance,approval_id:approval,purpose:'agreement_signature_request'}}),/COMMS_EMAIL_ATTACHMENTS_NOT_SUPPORTED/);
  reset();db.run(`UPDATE public.channel_connectors SET provider='gmail' WHERE id='${connector}'`);
  refuse(()=>prepare({attachments:manifest}),/COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED/);
  assert.equal(db.run(`SELECT meta?'comms_email_binding' FROM public.messages WHERE id='${draft}'`),'f');checks++;
  for(const changed of [false,true]){
   reset();const tag=`exp03_source_${process.pid}_${changed?'changed':'same'}`;
   const holder=await db.holdArchive(changed?`UPDATE public.messages SET subject='Changed while approval waits' WHERE id='${draft}'`:`SELECT id FROM public.messages WHERE id='${draft}' FOR UPDATE`,[],{manualRelease:true});
   const waiting=concurrentPrepare(tag);
   try{
    await observeWait([tag]);holder.release();await holder.completed;
    const result=await waiting.completed;
    if(changed){assert.notEqual(result.code,0);assert.match(result.err,/COMMS_EMAIL_DRAFT_SOURCE_CHANGED/);assert.equal(db.run(`SELECT meta?'comms_email_binding' FROM public.messages WHERE id='${draft}'`),'f');}
    else{assert.equal(result.code,0,result.err);assert.equal(db.run(`SELECT meta#>>'{comms_email_binding,operation_id}' FROM public.messages WHERE id='${draft}'`),operation);}
    assert.equal(db.run('SELECT count(*) FROM public.messages'),'1');checks++;
   }finally{holder.release(false);await holder.completed.catch(()=>{});if(waiting.child.exitCode===null)waiting.child.kill();await waiting.completed.catch(()=>{});}
  }
  reset();const holder=await db.holdArchive(`SELECT id FROM public.messages WHERE id='${draft}' FOR UPDATE`,[],{manualRelease:true});
  const tags=[`exp03_source_${process.pid}_first`,`exp03_source_${process.pid}_second`];
  const claimers=[concurrentPrepare(tags[0]),concurrentPrepare(tags[1],{op:'50000000-0000-4000-8000-000000000002'})];
  try{
   await observeWait(tags);holder.release();await holder.completed;
   const results=await Promise.all(claimers.map(x=>x.completed));
   assert.equal(results.filter(x=>x.code===0).length,1,'only one operation adopts the original draft');
   assert.match(results.find(x=>x.code!==0).err,/COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE/);
   assert.equal(db.run('SELECT count(*) FROM public.messages'),'1');checks++;
  }finally{holder.release(false);await holder.completed.catch(()=>{});for(const c of claimers){if(c.child.exitCode===null)c.child.kill();await c.completed.catch(()=>{});}}
  // Real inbound producer kind: same original row predates its queued approval.
  db.run(`ALTER TABLE public.paige_pending_approvals ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN reviewed_by_user_id uuid,ADD COLUMN reviewed_at timestamptz,ADD COLUMN sent_at timestamptz;
   ALTER TABLE public.messages ADD COLUMN sent_at timestamptz,ADD COLUMN error text;
   ALTER TABLE public.clients ADD COLUMN last_contacted_at timestamptz;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
   CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;`);
  db.run(read('scripts/proof/fixtures/exp03-email-inbound-draft-before.sql'));
  db.run(read('scripts/proof/fixtures/exp03-email-inbound-draft-admission.sql'));
  const inboundSeed=()=>{seedOriginalAction('comms-draft-reply');db.run(`UPDATE public.messages SET meta=meta||'{"source":"comms-draft-reply"}',created_at=now()-interval '1 hour' WHERE id='${draft}'`);};
  inboundSeed();
  if(process.argv.includes('--inbound-baseline')){
   refuse(()=>prepare({source:currentSource(),governance:{...governance,approval_id:approval}}),/COMMS_EMAIL_APPROVAL_INVALID/);
   console.log(JSON.stringify({checks,inboundBaseline:'original producer refused by original native guard; no send'}));
  }else{
   const inboundCandidate=read('scripts/proof/exp03-email-inbound-draft-patch.sql');
   refusePatch('GRANT EXECUTE ON FUNCTION public.read_comms_email_send_binding(uuid) TO authenticated',inboundCandidate,/inbound original metadata drift/);
   refusePatch('',inboundCandidate.replace('END $inbound$;',"RAISE EXCEPTION 'EXP03 inbound forced late failure';END $inbound$;"),/forced late failure/);
   db.run(inboundCandidate);const inboundCatalogue=originalCatalogue();db.run(inboundCandidate);
   assert.equal(originalCatalogue(),inboundCatalogue,'inbound composition replay preserves original OIDs and ACLs');checks++;
   for(const setup of [
    `UPDATE public.paige_actions SET payload='{"channel_type":"sms"}' WHERE id='${action}'`,
    `UPDATE public.messages SET meta=meta||'{"source":"another-producer"}' WHERE id='${draft}'`,
    `UPDATE public.paige_actions SET status='blocked' WHERE id='${action}'`,
   ]){
    inboundSeed();db.run(setup);
    refuse(()=>db.run(saveSQL(currentSource().updated_at,{approval})),/COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED/);
    refuse(()=>prepare({source:currentSource(),governance:{...governance,approval_id:approval}}),/COMMS_EMAIL_APPROVAL_INVALID|COMMS_EMAIL_ORIGIN_NOT_SENDABLE/);
   }
   inboundSeed();
   const savedInbound=JSON.parse(db.run(saveSQL(currentSource().updated_at,{approval})).split(/\r?\n/).find(x=>x.startsWith('{')));
   assert.equal(savedInbound.outcome,'draft_saved');assert.equal(db.run(`SELECT status FROM public.paige_pending_approvals WHERE id='${approval}'`),'pending');checks++;
   const reopened=JSON.parse(db.run(`SELECT jsonb_build_object('subject',subject,'body',body_text,'html',body_html) FROM public.messages WHERE id='${draft}'`));
   assert.deepEqual(reopened,{subject:'Saved subject',body:'Saved unsent words.',html:'<p>Saved unsent words.</p>'});checks++;
   const inbound=prepare({source:currentSource(),command:{...command,subject:reopened.subject,body:reopened.body},bodyHtml:reopened.html,governance:{...governance,approval_id:approval}});
   assert.equal(inbound.message_id,draft);checks++;
   const binding=JSON.parse(db.run(`SET ROLE service_role;SELECT public.read_comms_email_send_binding('${draft}')`).split(/\r?\n/).find(x=>x.startsWith('{')));
   assert.equal(binding.origin_eligible,true);assert.equal(binding.eligible,true);checks++;
   const claim=JSON.parse(db.run(`SET ROLE service_role;SELECT public.claim_comms_email_send('${draft}','${operation}')`).split(/\r?\n/).find(x=>x.startsWith('{')));
   assert.equal(claim.admitted,true);assert.equal(claim.attempts,1);checks++;
   // Synthetic provider outcome, not a live send. Original approval trigger and record writer run unchanged except the bounded source-kind extension.
   db.run(`CREATE TRIGGER proof_send_guard BEFORE UPDATE ON public.paige_pending_approvals FOR EACH ROW EXECUTE FUNCTION public.paige_guard_send_approval_requires_governed_send();
    UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,state}','"provider_accepted"') WHERE id='${draft}'`);
   const recorded=JSON.parse(db.run(`SELECT public._lead_reply_record_send('${approval}','${operation}','${actor}')`));
   assert.equal(recorded.ok,true);assert.equal(db.run(`SELECT status FROM public.paige_pending_approvals WHERE id='${approval}'`),'approved');checks++;
   assert.equal(JSON.parse(db.run(`SELECT public._lead_reply_record_send('${approval}','${operation}','${actor}')`)).replayed,true);checks++;
   assert.equal(db.run('SELECT count(*) FROM public.messages'),'1');checks++;
  }
  // ORIGINAL gated reader projection. Actor/scope classification below are
  // explicit fixture input ports, NOT live Auth SDK, role resolver or RLS proof.
  db.run(`CREATE TABLE public.message_labels(message_id uuid,label text,source text);
   CREATE TABLE public.message_classifications(message_id uuid,intent text,confidence numeric,risk_tier text,summary text,decided_at timestamptz);
   CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid$$;
   CREATE OR REPLACE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('exp03.fixture_tenant',true),'')::uuid$$;
   CREATE FUNCTION public.is_tenant_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('exp03.fixture_admin',true),''),'false')::boolean$$;
   CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('exp03.fixture_platform',true),''),'false')::boolean$$;`);
  db.run(read('scripts/proof/fixtures/exp03-email-draft-content-before.sql'));
  assert.equal(db.run(`SELECT md5(pg_get_functiondef('public.read_message_content(uuid)'::regprocedure))`),'3940dd0f8d7a9b5ae668707a2513212a');checks++;
  const contentRead=(over={})=>{const p={tenant,actor,admin:true,platform:false,role:'authenticated',id:draft,...over};assert(['authenticated','anon','service_role'].includes(p.role));
   const output=db.run(`SET request.jwt.claim.sub=${quote(p.actor)};SET exp03.fixture_tenant=${quote(p.tenant)};SET exp03.fixture_admin=${quote(String(p.admin))};SET exp03.fixture_platform=${quote(String(p.platform))};SET ROLE ${p.role};SELECT coalesce(public.read_message_content(${quote(p.id)}),'null'::jsonb);`);
   return JSON.parse(output.split(/\r?\n/).find(x=>x.startsWith('{')||x==='null'));};
  const contentCandidate=read('scripts/proof/exp03-email-draft-content-patch.sql');
  refusePatch('GRANT EXECUTE ON FUNCTION public.read_message_content(uuid) TO service_role',contentCandidate,/original metadata drift/);
  refusePatch('',contentCandidate.replace('END $exp03_draft_content$;',"RAISE EXCEPTION 'EXP03 content forced late failure';END $exp03_draft_content$;"),/content forced late failure/);
  if(!process.argv.includes('--content-before')){db.run(contentCandidate);const contentCatalogue=originalCatalogue();db.run(contentCandidate);assert.equal(originalCatalogue(),contentCatalogue);checks++;}
  inboundSeed();db.run(`UPDATE public.messages SET body_text=repeat('a',9000) WHERE id='${draft}'`);
  const fullDraft=contentRead();assert.equal(fullDraft.body_text.length,8000);assert.equal(fullDraft.body_truncated,true);checks++;
  assert.deepEqual(fullDraft.saved_email_draft.source,currentSource(),'original raw source precision, not a guessed/JS Date version');assert.equal(fullDraft.saved_email_draft.body_text.length,9000);checks++;
  assert.deepEqual(Object.keys(fullDraft.saved_email_draft).sort(),['body_html','body_text','source']);checks++;
  db.run(`UPDATE public.messages SET body_text=NULL,body_html='<p><strong>Native saved words.</strong></p>' WHERE id='${draft}'`);
  assert.equal(contentRead().saved_email_draft.body_html,'<p><strong>Native saved words.</strong></p>');checks++;
  for(const role of ['anon','service_role'])refuse(()=>contentRead({role}),/permission denied for function/);
  assert.equal(contentRead({tenant:other}),null);checks++;
  const refusedRead=contentRead({admin:false});assert.equal(refusedRead.code,'WORKSPACE_ROLE_REQUIRED');assert.equal(refusedRead.saved_email_draft,undefined);checks++;
  db.run(`UPDATE public.channel_connectors SET mailbox_class='personal',mailbox_owner_user_id='${otherActor}' WHERE id='${connector}'`);
  assert.equal(contentRead().code,'PERSONAL_MAILBOX_NOT_OWNER');
  const privilegedOrdinary=contentRead({platform:true});assert.equal(privilegedOrdinary.ok,true);assert.equal(privilegedOrdinary.saved_email_draft,null,'legacy privileged ordinary read does not disclose complete personal draft context');checks++;
  db.run(`INSERT INTO public.tenant_members VALUES('${otherActor}','${tenant}','active','member');UPDATE public.profiles SET active_tenant_id='${tenant}' WHERE user_id='${otherActor}'`);
  assert.equal(contentRead({actor:otherActor}).ok,true);checks++;
  db.run(`UPDATE public.channel_connectors SET active=false WHERE id='${connector}'`);
  assert.equal(contentRead({actor:otherActor}).code,'MAILBOX_INACTIVE');checks++;
  for(const setup of [
   `UPDATE public.messages SET channel_type='sms' WHERE id='${draft}'`,
   `UPDATE public.messages SET direction='inbound' WHERE id='${draft}'`,
   `UPDATE public.messages SET status='sent' WHERE id='${draft}'`,
   `UPDATE public.messages SET provider_message_id='fictional-provider-id' WHERE id='${draft}'`,
   `UPDATE public.messages SET meta=meta||'{"comms_email_binding":{}}' WHERE id='${draft}'`,
   `UPDATE public.messages SET meta=meta||'{"sales_invoice_binding":{}}' WHERE id='${draft}'`,
   `UPDATE public.messages SET body_text=repeat('a',10001) WHERE id='${draft}'`,
   `UPDATE public.messages SET body_html=repeat('a',100001) WHERE id='${draft}'`,
   `UPDATE public.messages SET contact_id=NULL WHERE id='${draft}'`,
   `UPDATE public.messages SET connector_id=NULL WHERE id='${draft}'`,
  ]){inboundSeed();db.run(setup);const before=businessState();assert.equal(contentRead().saved_email_draft,null);assert.equal(businessState(),before,'read writes no message/action/approval/receipt/actor row');checks++;}
  inboundSeed();
  if(process.argv.includes('--whole-carrier')&&!process.argv.includes('--inbound-baseline')){
   // Return ONLY this disposable fixture's function catalogue to the real baseline.
   // Customer/business rows and the original attached approval trigger are conserved.
   db.run(read('scripts/proof/fixtures/exp03-email-existing-draft-before.sql'));
   db.run(read('scripts/proof/fixtures/exp03-email-inbound-draft-before.sql'));
   db.run(read('scripts/proof/fixtures/exp03-email-draft-content-before.sql'));
   db.run(`DROP FUNCTION ${signature16};DROP FUNCTION public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid);`);
   const whole=read('scripts/proof/exp03-email-saved-outcome-carrier.sql'),beforeRows=businessState();
   refusePatch('GRANT EXECUTE ON FUNCTION public.read_comms_email_send_binding(uuid) TO authenticated',whole,/saved outcome original drift/);
   refusePatch('',whole.replace('END $exp03_saved_outcome$;',"RAISE EXCEPTION 'EXP03 whole forced late failure';END $exp03_saved_outcome$;"),/whole forced late failure/);
   assert.equal(db.run(`SELECT to_regprocedure('${signature16}') IS NULL AND to_regprocedure('public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid)') IS NULL`),'t');checks++;
   db.run(whole);assert.equal(businessState(),beforeRows,'whole carrier changes no business/identity/receipt row');checks++;
   const finalCatalogue=originalCatalogue();db.run(whole);assert.equal(originalCatalogue(),finalCatalogue,'whole replay preserves every original OID/source/ACL');assert.equal(businessState(),beforeRows);checks++;
   inboundSeed();
   const beforeSave=contentRead();assert.deepEqual(beforeSave.saved_email_draft.source,currentSource());checks++;
   const wholeSaved=JSON.parse(db.run(saveSQL(beforeSave.saved_email_draft.source.updated_at,{approval})).split(/\r?\n/).find(x=>x.startsWith('{')));
   assert.equal(wholeSaved.outcome,'draft_saved');checks++;
   const wholeReopened=contentRead();assert.equal(wholeReopened.saved_email_draft.source.updated_at,wholeSaved.updated_at);assert.equal(wholeReopened.saved_email_draft.body_text,'Saved unsent words.');checks++;
   const wholePrepared=prepare({source:wholeReopened.saved_email_draft.source,command:{...command,subject:wholeReopened.subject,body:wholeReopened.saved_email_draft.body_text},bodyHtml:wholeReopened.saved_email_draft.body_html,governance:{...governance,approval_id:approval}});
   assert.equal(wholePrepared.message_id,draft);checks++;
   const wholeClaim=JSON.parse(db.run(`SET ROLE service_role;SELECT public.claim_comms_email_send('${draft}','${operation}')`).split(/\r?\n/).find(x=>x.startsWith('{')));
   assert.equal(wholeClaim.admitted,true);assert.equal(wholeClaim.attempts,1);checks++;
   db.run(`UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,state}','"provider_accepted"') WHERE id='${draft}'`);
   assert.equal(JSON.parse(db.run(`SELECT public._lead_reply_record_send('${approval}','${operation}','${actor}')`)).ok,true);checks++;
   assert.equal(JSON.parse(db.run(`SELECT public._lead_reply_record_send('${approval}','${operation}','${actor}')`)).replayed,true);checks++;
   assert.equal(db.run('SELECT count(*) FROM public.messages'),'1');checks++;
   // CURRENT original SQL fixtures must pin precisely the reviewed source generation.
   // These controls validate actual native bodies and active fixture assertions, not
   // execution of the four complete schema-dependent SQL suites (required CI does that).
   const currentBodyPins=[
    [signature,'f7fbbd2a430bf391f43dc6ca7e2692ee'],
    [signature.replace('jsonb,jsonb)','jsonb,jsonb,timestamptz)'),'b814a323a2c319648888fe17bc5a7079'],
    ['public.read_comms_email_send_binding(uuid)','3d1ce2b3524c6342a0c152af1ca482d6'],
    ['public.paige_guard_send_approval_requires_governed_send()','ab1a41535dac3dce7a0790c084e609f1'],
    ['public._lead_reply_record_send(uuid,uuid,uuid)','c008e09cad4a91473ec8a047c84494d5'],
    ['public._comms_email_actor(uuid,uuid)','c9850c30ae7885c23eee1da268c8c0e0'],
    ['public.claim_comms_email_send(uuid,uuid,boolean)','a9dfb75621838268a961152d19de954d'],
   ];
   for(const [sig,hash]of currentBodyPins){assert.equal(db.run(`SELECT md5(prosrc) FROM pg_proc WHERE oid=${quote(sig)}::regprocedure`),hash,'exact reviewed native body: '+sig);checks++;}
   const pinAssertions=(sql,sig,hash)=>sql.includes(`'${sig}'::regprocedure,'${hash}'`)
    ||sql.includes(`md5(prosrc)='${hash}' FROM pg_proc WHERE oid='${sig}'::regprocedure`);
   for(const [file,indexes]of [
    ['exp03_lead_reply_draft.sql',[0,2,3,4]],['paige_email_sendgrid_receipts.sql',[0,2,3,4]],
    ['comms_email_scheduled_send.sql',[0,2]],['comms_email_governed_attachments.sql',[0,1]],
   ]){const sql=read('supabase/tests/'+file);for(const index of indexes){const [sig,hash]=currentBodyPins[index];
    assert(pinAssertions(sql,sig,hash),'original fixture current-source pin: '+file+' '+sig);checks++;
    assert(!pinAssertions(sql.replace(hash,'0'.repeat(32)),sig,hash),'mutated source pin must be refused: '+file);checks++;
   }}
  }
  if(process.argv.includes('--export-candidate')&&!process.argv.includes('--inbound-baseline')){
   const snapshot=db.run(`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'full_md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'settings',p.proconfig,'acl',p.proacl::text) ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('prepare_comms_email_send','save_comms_email_draft','read_comms_email_send_binding','_lead_reply_record_send','paige_guard_send_approval_requires_governed_send','read_message_content')`);
   const candidate=JSON.parse(snapshot);assert.equal(candidate.length,9);
   // Source/ACL only, no customer rows or secrets. Output is outside the checkout.
   writeFileSync('../exp03-saved-email-native-candidate.json',JSON.stringify(candidate,null,2)+'\n','utf8');checks++;
  }
  console.log(JSON.stringify({checks,overloadFullMd5:db.run(`SELECT md5(pg_get_functiondef('${signature16}'::regprocedure))`),scope:'original native prepare/actor/governance/version trigger/schedule/files wrappers; inbound original producer/approval guard/read/claim/record/replay and unsent save; synthetic domain/storage/provider result, not real bytes/provider verification; commercial/Auth SDK/RLS/customer proof unexercised'}));
 }
}finally{
 const r=spawnSync(db.psql,db.args('postgres'),{input:`DROP DATABASE ${db.database} WITH (FORCE);`,encoding:'utf8',timeout:60000});
 if(r.status!==0)throw new Error('Owned disposable draft proof database cleanup failed');
}
