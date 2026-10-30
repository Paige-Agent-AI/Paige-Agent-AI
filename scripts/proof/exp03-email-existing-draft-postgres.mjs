// Isolated native writer component. No real account, provider, RLS or Auth SDK proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
function prepareSQL({source:locator=source,op=operation,legacy=false,governance:gov=governance,connectorId=connector,role='service_role',sendAt=null,attachments=null}={}){
 const selectedCommand={...command,connector_id:connectorId};
 const args=[`${quote(actor)}::uuid`,`${quote(tenant)}::uuid`,`${quote(op)}::uuid`,`${quote(contact)}::uuid`,quote('client@tests.invalid'),`${quote(connectorId)}::uuid`,quote('business@tests.invalid'),quote(command.subject),quote(command.body),quote(html),
  quote(createHash('sha256').update('client@tests.invalid\n'+connectorId+'\n'+command.subject+'\n'+command.body).digest('hex')),`${quote(JSON.stringify(selectedCommand))}::jsonb`,`${quote(JSON.stringify(legacy&&locator!==null?{...gov,draft_source:locator}:gov))}::jsonb`];
 if(!legacy)args.push(sendAt===null?'NULL::timestamptz':`${quote(sendAt)}::timestamptz`,attachments===null?'NULL::jsonb':`${quote(JSON.stringify(attachments))}::jsonb`,`${quote(JSON.stringify(locator))}::jsonb`);
 assert(['service_role','authenticated','anon'].includes(role));
 return `SET ROLE ${role};SELECT public.prepare_comms_email_send(${args.join(',')});`;
}
function prepare(options){
 const lines=db.run(prepareSQL(options)).split(/\r?\n/).filter(line=>line.startsWith('{'));
 assert.equal(lines.length,1,'one original RPC result, separate from psql SET acknowledgement');
 return JSON.parse(lines[0]);
}
const businessState=()=>db.run(`SELECT jsonb_build_object('messages',(SELECT jsonb_agg(m ORDER BY id) FROM public.messages m),'users',(SELECT jsonb_agg(u ORDER BY id) FROM auth.users u),'seats',(SELECT jsonb_agg(s ORDER BY user_id,tenant_id) FROM public.tenant_members s),'profiles',(SELECT jsonb_agg(p ORDER BY user_id) FROM public.profiles p),'connectors',(SELECT jsonb_agg(c ORDER BY id) FROM public.channel_connectors c))`);
function reset(){db.run(`DELETE FROM public.messages;DELETE FROM public.paige_actions;DELETE FROM public.paige_pending_approvals;DELETE FROM public.paige_action_kinds;${seedDraft}
 UPDATE auth.users SET deleted_at=NULL,banned_until=NULL;
 UPDATE public.tenants SET status='active';UPDATE public.profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';
 UPDATE public.tenant_members SET status='active',role='owner' WHERE user_id='${actor}';
 UPDATE public.channel_connectors SET mailbox_class='shared_support',mailbox_owner_user_id=NULL,active=true,status='active',channel_type='email';`);}
function refuse(run,pattern){const before=businessState();assert.throws(run,pattern);assert.equal(businessState(),before,'refusal preserves every source and business row');checks++;}
const currentSource=()=>JSON.parse(db.run(`SELECT jsonb_build_object('message_id',id,'updated_at',updated_at) FROM public.messages WHERE id='${draft}'`));
const approval='80000000-0000-4000-8000-000000000001',action='90000000-0000-4000-8000-000000000001';
function seedOriginalAction(kind='owner.lead_followup') {
 reset();db.run(`INSERT INTO public.paige_pending_approvals VALUES('${approval}','${tenant}','${contact}','pending','{"action_id":"${action}"}');
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
 CREATE TABLE public.paige_actions(id uuid PRIMARY KEY,approval_id uuid,tenant_id uuid,contact_id uuid,action_kind text,status text);
 CREATE TABLE public.paige_action_kinds(slug text,executor text);
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
  reset();const sendAt=canonicalCommsEmailSendAt(new Date(Date.now()+10*60_000).toISOString());
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
  console.log(JSON.stringify({checks,overloadFullMd5:db.run(`SELECT md5(pg_get_functiondef('${signature16}'::regprocedure))`),scope:'original native prepare/actor/governance/version trigger/schedule/files wrappers; synthetic domain/storage metadata, not real bytes/provider verification; commercial/Auth SDK/RLS/customer proof unexercised'}));
 }
}finally{
 const r=spawnSync(db.psql,db.args('postgres'),{input:`DROP DATABASE ${db.database} WITH (FORCE);`,encoding:'utf8',timeout:60000});
 if(r.status!==0)throw new Error('Owned disposable draft proof database cleanup failed');
}
