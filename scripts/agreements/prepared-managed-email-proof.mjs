import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {confirmFingerprint} from '../../supabase/functions/_shared/confirm-fingerprint.ts';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/preparation-json.ts';
import {commsEmailContentDigest} from '../../supabase/functions/_shared/comms-email/contract.ts';
import {mintSignerToken,sha256Hex} from '../../supabase/functions/_shared/agreements/token.ts';

// Extend the ORIGINAL isolated Agreements chain after ALL incumbent controls.
// Actual resolver/confirmation/Work/Comms/Rail bodies run on synthetic local rows.
// No provider request, real document/signature, hosted account or acceptance.
export async function provePreparedManagedEmail({sql,read,tenant,actor,quote:q,fixture,issue,claim}){
 let checks=0;const check=(v,m)=>{assert(v,m);checks++;};
 const native=s=>'SET ROLE service_role;'+s;
 const json=s=>{const v=sql(s);return v===''?null:JSON.parse(v);};
 const extract=(file,name)=>{
  const m=read(file).match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z_0-9]*\\$)[\\s\\S]*?\\1\\s*;','i'));
  assert(m,'Original native '+name);return m[0];
 };
 // Only missing fixture row types/columns. No replacement identity or permission
 // function: the exact original recorded-identity resolver runs below.
 sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS name text,ADD COLUMN IF NOT EXISTS slug text,ADD COLUMN IF NOT EXISTS brand jsonb;
  ALTER TABLE tenant_email_domains ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
   ADD COLUMN IF NOT EXISTS status text,ADD COLUMN IF NOT EXISTS is_default boolean,
   ADD COLUMN IF NOT EXISTS verified_at timestamptz,ADD COLUMN IF NOT EXISTS from_email_local text,ADD COLUMN IF NOT EXISTS from_name text;
  CREATE UNIQUE INDEX IF NOT EXISTS e04_fixture_domain_id ON tenant_email_domains(id);`);
 const registry=read('supabase/migrations/20260711170000_tenant_email_identity_registry.sql');
 for(const name of ['platform_email_settings','tenant_email_identities']){
  const table=registry.match(new RegExp('CREATE TABLE IF NOT EXISTS public\\.'+name+'\\s*\\([\\s\\S]*?\\n\\);'));
  assert(table,'Original identity row type '+name);sql(table[0]);
 }
 sql(extract('supabase/migrations/20260711170000_tenant_email_identity_registry.sql','sanitize_email_local_part'));
 sql(extract('supabase/migrations/20260712230000_tier1_per_tenant_default_sender.sql','resolve_tenant_sender'));
 sql(`REVOKE ALL ON FUNCTION resolve_tenant_sender(uuid) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION resolve_tenant_sender(uuid) TO service_role;
  INSERT INTO platform_email_settings(id,shared_domain) VALUES(true,'mail.paigeagent.ai');
  INSERT INTO tenant_email_identities(tenant_id,from_name,local_part) VALUES('${tenant}','Controlled Studio','controlled-native');`);
 // The incumbent fenced fixture predates the original SendGrid-only retirement.
 // Use that ORIGINAL reconciliation body, never a test-authored false stub.
 sql(extract('supabase/migrations/20271116200000_exp03_resend_retired.sql','_comms_email_reconcilable'));
 const address='controlled-native@mail.paigeagent.ai';
 check(json(native(`SELECT resolve_tenant_sender('${tenant}');`)).source==='shared','Original recorded shared identity, not platform fallback');
 const census=()=>json(`SELECT coalesce(jsonb_agg(jsonb_build_object('oid',oid,'schema',pronamespace,'name',proname,'body',md5(prosrc),
  'owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef,'volatility',provolatile,'parallel',proparallel,
  'args',proargtypes::text,'names',proargnames,'defaults',pronargdefaults,'result',prorettype) ORDER BY oid),'[]'::jsonb)
  FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'private'::regnamespace);`);
 const before=census(),migration=read('supabase/migrations/20271121131604_e04_managed_email_signing_identity.sql');
 if(!process.argv.includes('--prepared-managed-email-baseline')){sql(migration);sql(migration);}
 const after=census(),changed=['e04_prepared_confirmation_source','e04_agreement_email_binding'];
 assert.deepEqual(after.filter(p=>!changed.includes(p.name)),before.filter(p=>!changed.includes(p.name)));checks++;
 for(const name of changed){
  const old=before.find(p=>p.name===name),now=after.find(p=>p.name===name);
  assert(old&&now);assert.deepEqual({...now,body:old.body},old);checks++;
 }
 const managed=async()=>{
  const v=await fixture();
  sql(`UPDATE channel_connectors SET provider='resend',from_address=${q(address)} WHERE id='${v.connector}';`);
  v.args.request.sender.from_address=address;
  v.args.request_sha256=createHash('sha256').update(canonicalPresentationJson(v.args.request)).digest('hex');
  v.fp=await confirmFingerprint('agreement_send',v.args);return v;
 };
 const refused=(s,code='40001')=>{
  sql(native(`DO $proof$ BEGIN BEGIN ${s.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};
   RAISE EXCEPTION 'Expected managed signing refusal';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`));checks++;
 };
 const approved=async()=>{
  const v=await managed();v.pending=json(native(issue(v)));
  const nonce=randomUUID(),consumed=json(native(claim(v,nonce))),audit=randomUUID();
  const payload={capability:'agreement_send',decision:'execute',risk:'high',lane_effective:'confirm',operation_id:v.operation,request_sha256:v.args.request_sha256};
  sql(`INSERT INTO paige_audit_log(id,actor_user_id,actor_role,tenant_id,action,target_type,target_id,payload)
   VALUES('${audit}','${actor}','sales:owner','${tenant}','sales.agreement_signature_request_governed_decision','agreement','${v.a.id}',${q(JSON.stringify(payload))}::jsonb);`);
  v.work=json(native(`SELECT _register_prepared_agreement_work('${actor}','${tenant}','${consumed.confirmation_id}','${nonce}',${q(v.fp)},'${audit}');`));
  const hashes=await Promise.all(v.args.request.recipients.map(async s=>({signer_id:s.id,token_hash:await sha256Hex(mintSignerToken())})));
  v.credential=json(native(`SELECT _issue_prepared_agreement_credentials('${actor}','${tenant}','${v.operation}',${q(v.args.request_sha256)},${q(JSON.stringify(hashes))}::jsonb);`));
  const g={actor_user_id:actor,tenant_id:tenant,tool:'agreement_send',action:'agreement.send',approval_channel:'chat-canonical',
   decision_receipt_recorded:true,approved_fingerprint:v.fp,purpose:'agreement_signature_request',agreement_work_id:v.work.work_id,
   agreement_operation_id:v.operation,agreement_request_sha256:v.args.request_sha256,signer_id:v.signer.id,operation_id:randomUUID()};
  v.g=g;v.source=json(`SELECT private.e04_agreement_email_origin('${actor}','${tenant}',${q(JSON.stringify(g))}::jsonb,true);`);
  const s=v.source,r=s.message;v.digest=await commsEmailContentDigest({recipient:r.to,connectorId:s.sender.connector_id,subject:r.subject,bodyText:r.body_text});
  v.prepare=`SELECT prepare_comms_email_send('${actor}','${tenant}','${g.operation_id}','${s.client_id}',${q(r.to)},'${v.connector}',${q(address)},${q(r.subject)},${q(r.body_text)},${q(r.body_html)},${q(v.digest)},${q(JSON.stringify(s.command))}::jsonb,${q(JSON.stringify(g))}::jsonb);`;
  return v;
 };
 const v=await approved(),prepared=json(native(v.prepare));v.message=prepared.message_id;
 check(prepared.ok&&prepared.state==='prepared','Managed alias traverses original HIGH confirmation, Work, credentials and canonical prepare');
 check(json(native(v.prepare)).message_id===v.message,'Repeated preparation preserves the same original message');
 const binding=json(native(`SELECT read_comms_email_send_binding('${v.message}');`));
 check(binding.eligible&&binding.provider==='resend'&&binding.agreement_source.sender.provider==='sendgrid','Original connector identity and actual transport stay distinct');
 check(binding.agreement_source.work_id===v.work.work_id&&binding.agreement_source.document_sha256===v.args.request.document.sha256,'Original Work and reviewed document stay exact');
 const dispatch=`SELECT claim_comms_email_send('${v.message}','${v.g.operation_id}',false);`;
 check(json(native(dispatch)).admitted===true&&json(native(dispatch)).admitted===false,'One canonical winning claim, never another provider attempt');
 const result=json(native(`SELECT finalize_comms_email_send('${v.message}','${v.g.operation_id}','unknown',NULL,NULL,1);`));
 check(result.outcome==='unknown','Uncertain outcome remains unknown');
 check(json(native(`SELECT read_comms_email_send_result('${actor}','${tenant}','${v.g.operation_id}');`)).reconcilable===false,'Retired provider label cannot restore replay permission');
 check(json(native(`SELECT claim_comms_email_send('${v.message}','${v.g.operation_id}',true);`)).admitted===false,'Original native claim refuses reconciliation by re-sending');
 for(const [label,change,restore]of [
  ['missing recorded identity',`UPDATE tenant_email_identities SET status='disabled' WHERE tenant_id='${tenant}';`,`UPDATE tenant_email_identities SET status='active' WHERE tenant_id='${tenant}';`],
  ['another recorded address',`UPDATE tenant_email_identities SET local_part='different-native' WHERE tenant_id='${tenant}';`,`UPDATE tenant_email_identities SET local_part='controlled-native' WHERE tenant_id='${tenant}';`],
 ]){
  const f=await managed();sql(change);try{refused(issue(f));}finally{sql(restore);}
  check(sql(`SELECT count(*) FROM paige_pending_confirmations WHERE args->>'operation_id'='${f.operation}';`)==='0',label+' cannot create an approval');
 }
 const f=await approved();f.message=json(native(f.prepare)).message_id;
 sql(`UPDATE tenant_email_identities SET status='disabled' WHERE tenant_id='${tenant}';`);
 try{refused(`SELECT claim_comms_email_send('${f.message}','${f.g.operation_id}',false);`);}finally{sql(`UPDATE tenant_email_identities SET status='active' WHERE tenant_id='${tenant}';`);}
 check(json(native(`SELECT read_comms_email_send_result('${actor}','${tenant}','${f.g.operation_id}');`)).outcome==='prepared','Withdrawal before dispatch preserves unclaimed truthful state');
 check(sql(`SELECT count(*) FROM messages WHERE meta#>>'{comms_email_binding,governance,agreement_work_id}'='${v.work.work_id}';`)==='1','One original message for the approved signer');
 check(sql(`SELECT count(*) FROM paige_workspace_events WHERE source_id='${v.g.operation_id}' AND capability_key='comms_send_email';`)==='1','Original Rail retains one actual local operation receipt');
 for(const role of ['anon','authenticated','service_role'])check(sql(`SELECT has_function_privilege('${role}','private.e04_prepared_confirmation_source(uuid,uuid,jsonb)','EXECUTE') OR has_function_privilege('${role}','private.e04_agreement_email_binding(jsonb,boolean)','EXECUTE');`)==='f','No direct private source grant to '+role);
 return {result:'PASS',checks,migrationReplay:process.argv.includes('--prepared-managed-email-baseline')?0:2,
  migrationSha256:createHash('sha256').update(migration).digest('hex'),
  scope:'Local original native resolver/confirmation/Work/Comms/Rail only. Synthetic identities/provider facts, no external effect, signature or authenticated customer acceptance.'};
}
