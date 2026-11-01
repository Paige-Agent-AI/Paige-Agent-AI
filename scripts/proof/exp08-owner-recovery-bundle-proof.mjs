// Original release bootstrap proof on the already-declared ported native fixture.
// Schema-only clone of OWN disposable database; no managed schema/customer claim.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname,isAbsolute,join} from 'node:path';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
import {buildOwnerRecoveryBundle} from './exp08-owner-recovery-bundle.mjs';
export async function verifyOwnerRecoveryBundle(db,{originalGrantDefinition,originalRevokeDefinition,originalBillingDefinition}){
 assert.equal(process.env.EXP08_DISPOSABLE,'1');assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST));
 assert.match(db.database,/^operator_account_lifecycle_proof_\d+_\d+$/);assert.equal(db.role,'');
 const {sql:bundle,privateSpecifications}=buildOwnerRecoveryBundle(),cases=[];
 async function sqlFile(c,sql){
  const directory=mkdtempSync(join(tmpdir(),'exp08-recovery-bundle-')),file=join(directory,'owned-proof.sql');
  try{
   writeFileSync(file,'\\set VERBOSITY verbose\n'+c.prefix()+'\n'+sql+'\n');
   const r=spawnSync(c.psql,[...c.args(),'--file',file],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,timeout:60000});
   if(r.error){r.error.stderr=r.stderr;throw r.error;}if(r.status!==0)throw new Error(r.stderr);
   return r.stdout;
  }finally{unlinkSync(file);rmdirSync(directory);}
 }
 const dumpExe=process.env.OPERATOR_PROOF_PG_DUMP??(isAbsolute(db.psql)?join(dirname(db.psql),process.platform==='win32'?'pg_dump.exe':'pg_dump'):'pg_dump');
 const dump=spawnSync(dumpExe,['--host=127.0.0.1','--port='+db.port,'--username=postgres','--dbname='+db.database,'--schema-only','--clean','--if-exists'],
  {encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,timeout:60000});
 if(dump.error)throw dump.error;assert.equal(dump.status,0,dump.stderr);assert.ok(dump.stdout.length>1000,'Actual schema dump required');
 // Windows pg_dump emits CRLF even inside function bodies; file input preserves
 // those CRs. Canonical LF transport must be proved against EVERY original body.
 const schema=dump.stdout.replace(/\r\n/g,'\n');
 writeFileSync(new URL('../../../../exp08-recovery-ported-fixture-schema.sql',import.meta.url),schema);
 const scalar=(c,q)=>c.run(q).split('\n').at(-1);
 const metadata=c=>scalar(c,`SELECT jsonb_build_object(
  'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','auth')),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p),
  'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE NOT t.tgisinternal))`);
 const data=c=>scalar(c,`SELECT jsonb_build_object(
  'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.paige_audit_log a),
  'notices',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.notifications a),
  'members',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.tenant_members a),
  'entities',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.tenant_business_owners a),
  'contacts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.platform_billing_contacts a))`);
 const portableFunctions=c=>JSON.parse(scalar(c,`SELECT jsonb_agg(jsonb_build_object(
  'signature',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),
  'language',(SELECT lanname FROM pg_language WHERE oid=p.prolang),'kind',p.prokind,'definer',p.prosecdef,
  'result',p.prorettype::regtype::text,'set',p.proretset,'strict',p.proisstrict,'volatile',p.provolatile,
  'parallel',p.proparallel,'leakproof',p.proleakproof,'cost',p.procost,'rows',p.prorows,
  'arguments',pg_get_function_identity_arguments(p.oid),'names',p.proargnames,'modes',p.proargmodes,
  'defaults',pg_get_expr(p.proargdefaults,0),'config',p.proconfig,
  'acl',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable)
   FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) ORDER BY p.oid::regprocedure::text)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','auth')`));
 const originalPortableFunctions=portableFunctions(db);
 const noticeSignature='public._exp08_read_recovery_notice(uuid,uuid)';
 const noticeDefinition=JSON.parse(scalar(db,`SELECT to_json(pg_get_functiondef('${noticeSignature}'::regprocedure))`));
 const alteredNotice=noticeDefinition.replace('BEGIN','BEGIN\n PERFORM 1;');assert.notEqual(alteredNotice,noticeDefinition);
 const beforeData=data(db),beforeMetadata=metadata(db);
 // Counterfactual component-only composition demonstrates the exact normalization
 // hazard. It is NOT a reported production defect or another installed product.
 const unprotected=bundle.replace(/DO \$exp08_bundle_preflight\$[\s\S]*?END \$exp08_bundle_preflight\$;/,'');
 assert.notEqual(unprotected,bundle);db.run(alteredNotice);await sqlFile(db,unprotected);
 assert.equal(JSON.parse(scalar(db,`SELECT to_json(pg_get_functiondef('${noticeSignature}'::regprocedure))`)),noticeDefinition);
 cases.push({case:'counterfactual component composition demonstrably normalizes changed private source; preflight is required',passed:true});
 db.run(alteredNotice);const alteredMetadata=metadata(db);
 await assert.rejects(()=>sqlFile(db,bundle),/EXP08 recovery bundle preflight drift/);
 assert.equal(metadata(db),alteredMetadata);assert.equal(data(db),beforeData);db.run(noticeDefinition);
 cases.push({case:'whole bundle refuses private source drift before normalization and preserves all prior rows/metadata',passed:true});
 db.run(`ALTER FUNCTION ${noticeSignature} RENAME TO exp08_fixture_hidden_notice`);const partialMetadata=metadata(db);
 await assert.rejects(()=>sqlFile(db,bundle),/EXP08 recovery bundle partial installation/);
 assert.equal(metadata(db),partialMetadata);assert.equal(data(db),beforeData);
 db.run('ALTER FUNCTION public.exp08_fixture_hidden_notice(uuid,uuid) RENAME TO _exp08_read_recovery_notice');
 assert.equal(metadata(db),beforeMetadata);
 for(const signature of ['public._exp08_revoke_co_owner(uuid,uuid,uuid)','public.grant_co_owner(uuid,uuid)']){
  db.run('ALTER FUNCTION '+signature+' STRICT');const strictMetadata=metadata(db);
  await assert.rejects(()=>sqlFile(db,bundle),/EXP08 recovery bundle original\/kernel metadata drift/);
  assert.equal(metadata(db),strictMetadata);assert.equal(data(db),beforeData);
  db.run('ALTER FUNCTION '+signature+' CALLED ON NULL INPUT');
  cases.push({case:'whole bundle refuses original/kernel STRICT metadata drift unchanged: '+signature,passed:true});
 }
 await sqlFile(db,bundle);assert.equal(metadata(db),beforeMetadata);assert.equal(data(db),beforeData);
 cases.push({case:'whole bundle refuses partial installation unchanged and replays complete native state without row or metadata changes',passed:true});
 const fresh=new OperatorPostgresFixture(db.port);
 try{
  await sqlFile(fresh,schema);
  const copiedFunctions=portableFunctions(fresh);assert.equal(copiedFunctions.length,originalPortableFunctions.length);
  for(let i=0;i<copiedFunctions.length;i++)assert.deepEqual(copiedFunctions[i],originalPortableFunctions[i],originalPortableFunctions[i].signature+' clone must conserve body/ABI/privileges');
  cases.push({case:'schema-only clone conserves every original function body and portable ABI/execution/permission metadata before bootstrap testing',passed:true});
  // Schema-only copying creates NO prior audit/customer rows. Restore the actual
  // original public writers, then remove ONLY candidate objects in this new DB.
  fresh.run(`${originalGrantDefinition};${originalRevokeDefinition};${originalBillingDefinition};
   DROP TRIGGER trg_owner_recovery_audit_truncate ON public.paige_audit_log;
   DROP POLICY exp08_owner_recovery_native_rows ON public.paige_audit_log;
   DROP FUNCTION public.guard_owner_recovery_audit_truncate();
   DROP FUNCTION public.platform_owner_recovery(uuid,text,uuid,text,uuid),public.platform_owner_recovery(uuid,text,uuid,text),
    public.platform_owner_recovery_receipt(uuid,uuid),public.get_owner_recovery_notice(uuid,uuid),public.get_my_owner_recovery_notice(uuid),public.get_owner_recovery_delivery_event(uuid,uuid);
   DROP FUNCTION public._exp02_billing_recovery_cleanup(uuid,uuid,uuid),public._exp02_billing_contact_revoke(uuid,uuid,uuid,uuid),public._exp02_billing_revoke_scope(uuid,uuid,uuid);
   DROP FUNCTION public._exp08_grant_co_owner(uuid,uuid,boolean),public._exp08_revoke_co_owner(uuid,uuid,uuid);
   ${privateSpecifications.map(s=>'DROP FUNCTION '+s.signature+';').join('\n')}`);
  assert.equal(scalar(fresh,"SELECT count(*) FROM public.paige_audit_log"),'0');
  assert.equal(scalar(fresh,"SELECT md5(prosrc) FROM pg_proc WHERE oid='public.grant_co_owner(uuid,uuid)'::regprocedure"),'2a75180de63325dd7e328a73e494e6dc');
  assert.equal(scalar(fresh,"SELECT md5(prosrc) FROM pg_proc WHERE oid='public.revoke_co_owner(uuid,uuid)'::regprocedure"),'7d62c3fac37e2af0b6f2a3029d892752');
  assert.equal(scalar(fresh,"SELECT md5(prosrc) FROM pg_proc WHERE oid='public.platform_billing_contact_revoke(uuid)'::regprocedure"),'f8fa3a425f70d301f47b5b5750c57ad3');
  fresh.run(originalBillingDefinition.replace('BEGIN','BEGIN\n PERFORM 1;'));
  const lateFailureMetadata=metadata(fresh);
  await assert.rejects(()=>sqlFile(fresh,bundle),/EXP02 original Billing source or partial kernel drift/);
  assert.equal(metadata(fresh),lateFailureMetadata);
  assert.equal(scalar(fresh,"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '_exp08_%'"),'0');
  cases.push({case:'fresh bundle late original Billing prerequisite failure rolls back ALL newly created recovery functions/policies/triggers',passed:true});
  fresh.run(originalBillingDefinition);await sqlFile(fresh,bundle);
  const installed=metadata(fresh);await sqlFile(fresh,bundle);assert.equal(metadata(fresh),installed);
  cases.push({case:'fresh original baseline installs full bundle atomically and replays twice with exact catalogue metadata',passed:true});
  const actor='e8000000-0000-4000-8000-000000095001',holder='e8000000-0000-4000-8000-000000095002',remaining='e8000000-0000-4000-8000-000000095003';
  const tenant='e8000000-0000-4000-8000-000000095010',entity='e8000000-0000-4000-8000-000000095011',contact='e8000000-0000-4000-8000-000000095012';
  const revokeRequest='e8000000-0000-4000-8000-000000095020',restoreRequest='e8000000-0000-4000-8000-000000095021',reason='Synthetic original bundle recovery proof';
  fresh.actor=actor;
  fresh.run(`INSERT INTO auth.users(id) VALUES('${actor}'),('${holder}'),('${remaining}');INSERT INTO public.user_roles VALUES('${actor}','super_admin');
   INSERT INTO public.tenants(id,account_type) VALUES('${tenant}','standalone');
   INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${actor}','${tenant}'),('${holder}','${tenant}'),('${remaining}','${tenant}');
   INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status,role) VALUES('${tenant}','${holder}',true,'active','owner'),('${tenant}','${remaining}',true,'active','owner');
   INSERT INTO public.tenant_business_owners(id,tenant_id,owner_kind,representative_user_id,legal_name) VALUES('${entity}','${tenant}','entity','${holder}','Synthetic bundle legal owner');
   UPDATE public.tenant_members SET business_owner_id='${entity}' WHERE tenant_id='${tenant}' AND user_id='${holder}';
   INSERT INTO public.platform_billing_contacts(id,tenant_id,user_id,designation) VALUES('${contact}','${tenant}','${holder}','delegate')`);
  fresh.role='authenticated';
  const revokeCall=`SELECT public.platform_owner_recovery('${tenant}','revoke_owner','${holder}','${reason}','${revokeRequest}')`;
  const receipt=JSON.parse(scalar(fresh,revokeCall));assert.equal(receipt.receipt.billing.status,'revoked');
  const restoreCall=`SELECT public.platform_owner_recovery('${tenant}','set_account_holder','${remaining}','${reason}','${restoreRequest}')`;
  const restored=JSON.parse(scalar(fresh,restoreCall));assert.equal(restored.status,'found');
  assert.deepEqual(JSON.parse(scalar(fresh,revokeCall)),receipt);assert.deepEqual(JSON.parse(scalar(fresh,restoreCall)),restored);
  fresh.role='';
  assert.equal(scalar(fresh,`SELECT representative_user_id IS NULL AND owner_seat_vacant_since IS NOT NULL FROM public.tenant_business_owners WHERE id='${entity}'`),'t');
  const settledData=data(fresh),settledMetadata=metadata(fresh);await sqlFile(fresh,bundle);
  assert.equal(data(fresh),settledData);assert.equal(metadata(fresh),settledMetadata);
  cases.push({case:'fresh compiled bundle executes authenticated original revoke/Billing/entity vacancy then R12 restoration, receipt replay and unchanged bundle replay after real native rows',passed:true});
 }finally{
  fresh.role='';fresh.actor='';assert.match(fresh.database,/^operator_account_lifecycle_proof_\d+_\d+$/);
  fresh.run('DROP DATABASE '+fresh.database,[],'postgres');
 }
 return cases;
}
