import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function proveCheckedSignerPreparation({sql,read,context,tenant,actor,client,fresh,startSession,observe,quote}){
 let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
 const refused=(statement,code='42501',scope=context)=>{sql(scope+`DO $proof$ BEGIN BEGIN ${statement.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected checked refusal ${code}';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;};
 const path='supabase/migrations/20271113250004_agreement_checked_signer_preparation.sql';
 const legacyMeta=JSON.parse(sql("SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,'defaults',pronargdefaults,'config',proconfig,'returns',prorettype::regtype::text) FROM pg_proc WHERE oid='public.add_agreement_signer(uuid,uuid,text,text,text,integer)'::regprocedure;"));
 sql(read(path));sql(read(path));
 check(JSON.stringify(JSON.parse(sql("SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,'defaults',pronargdefaults,'config',proconfig,'returns',prorettype::regtype::text) FROM pg_proc WHERE oid='public.add_agreement_signer(uuid,uuid,text,text,text,integer)'::regprocedure;")))===JSON.stringify(legacyMeta),'Legacy signature/defaults/owner/ACL/search_path/return unchanged');
 const q=value=>value===null?'NULL':quote(value);
 const command=(source,id,patch={})=>{
  const v={tenant,agreement:source.id,client:source.contact_id,version:source.version,stamp:source.updated_at,id,name:'Prepared Participant',email:'prepared@example.test',role:'counterparty',order:null,...patch};
  return `SELECT prepare_agreement_signer(${q(v.tenant)},${q(v.agreement)},${q(v.client)},${v.version===null?'NULL':v.version},${q(v.stamp)},${q(v.id)},${q(v.name)},${q(v.email)},${q(v.role)},${v.order===null?'NULL':v.order});`;
 };
 const source=fresh(),id=randomUUID();
 const receipt=JSON.parse(sql(context+command(source,id)));
 check(receipt.state==='recorded'&&receipt.signer_id===id&&receipt.agreement_id===source.id&&receipt.client_id===client,'Original opaque signer identity and customer source acknowledged');
 check(receipt.source_version===source.version+1&&receipt.source_updated_at&&receipt.event_id,'Actual source version/time and original event retained');
 check(Object.keys(receipt).sort().join(',')==='agreement_id,client_id,email,event_id,full_name,schema_version,signer_id,signer_role,signing_order,source_updated_at,source_version,state,status','Closed receipt with no token/IP/private object/request digest');
 const repeated=JSON.parse(sql(context+command(source,id)));
 check(repeated.state==='replayed'&&repeated.event_id===receipt.event_id&&repeated.source_version===receipt.source_version,'Same request returns the same native receipt');
 check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE id='${id}'`)==='1','Replay creates no duplicate party');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${id}' AND detail ? 'signer_preparation'`)==='1','One original edited receipt event');
 check(Number(sql(`SELECT version FROM paige_agreements WHERE id='${source.id}'`))===receipt.source_version,'Replay does not advance document again');
 const offset={...source,updated_at:new Date(Date.parse(source.updated_at)).toISOString()};
 // Native timestamps may retain submillisecond precision. Only compare identical
 // instants when the original value has no precision lost by JavaScript.
 if(Date.parse(source.updated_at)===Date.parse(offset.updated_at)&&!/\.\d{4,}/.test(source.updated_at)){
  check(JSON.parse(sql(context+command(offset,id))).event_id===receipt.event_id,'Equivalent native timestamp serialization retains intent');
 }
 for(const patch of [{name:'Different person'},{email:'different@example.test'},{role:'witness'},{order:receipt.signing_order},{version:source.version+1},{stamp:'2026-01-01T00:00:00Z'},{client:'c2222222-0000-4000-8000-000000000002'}])refused(command(source,id,patch),'40001');
 refused(command(source,id),'40001',context+"SET test.uid='22222222-0000-4000-8000-000000000002';");
 refused(command(source,id),'42501',context+"SET test.admin='false';");
 refused(command(source,id),'42501',context+'SET ROLE anon;');
 refused(command(source,id),'42501',context+'SET ROLE service_role;');
 refused(command(source,id),'42501',context+"SET test.uid='';");
 const stale=randomUUID();refused(command(source,stale,{email:'stale@example.test'}),'40001');
 check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE id='${stale}'`)==='0','Stale reviewed source creates no party');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${stale}'`)==='0','Stale reviewed source creates no success event');
 const unchanged=fresh(),invalid=randomUUID();
 for(const patch of [{version:null},{stamp:null},{client:null},{id:null},{name:''},{name:'x'.repeat(201)},{email:'no-address'},{role:null},{role:'unrecognized'},{order:0}])refused(command(unchanged,invalid,patch),'22023');
 check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE id='${invalid}'`)==='0','Invalid preparations have no durable effect');
 const normalizedId=randomUUID();const normalized=JSON.parse(sql(context+command(unchanged,normalizedId,{name:'  Full Native Name  ',email:'  Mixed@EXAMPLE.TEST  '})));
 check(normalized.full_name==='Full Native Name'&&normalized.email==='mixed@example.test','Original native name/email normalization preserved');
 check(JSON.parse(sql(context+command(unchanged,normalizedId,{name:'Full Native Name',email:'mixed@example.test'}))).event_id===normalized.event_id,'Semantically normalized same intent replays');
 refused(command(unchanged,normalizedId,{email:'mixed@example.test',name:'Full Native Name',order:normalized.signing_order}),'40001');
 const legacy=fresh();const legacyResult=JSON.parse(sql(context+`SELECT add_agreement_signer('${tenant}','${legacy.id}','Legacy caller','legacy@example.test');`));
 check(Object.keys(legacyResult).sort().join(',')==='email,full_name,signer_id,signer_role,signing_order,status','Original legacy caller still receives its exact six fields');
 check(Number(sql(`SELECT version FROM paige_agreements WHERE id='${legacy.id}'`))===legacy.version+1,'Legacy still shares actual source advance');
 refused(command(legacy,legacyResult.signer_id,{name:'Legacy caller',email:'legacy@example.test'}),'40001');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${legacyResult.signer_id}' AND detail ? 'signer_preparation'`)==='0','Legacy record is never falsely adopted as a checked request');
 const concurrent=fresh(),concurrentId=randomUUID(),tag='e04_checked_'+randomUUID().replaceAll('-','');
 const one=startSession(tag+'one','BEGIN;'+context+command(concurrent,concurrentId,{email:'concurrent@example.test'})+'SELECT pg_sleep(1.5);COMMIT;');
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(tag+'one')} AND wait_event='PgSleep');`);
 const two=startSession(tag+'two',context+command(concurrent,concurrentId,{email:'concurrent@example.test'}));
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(tag+'two')} AND wait_event_type='Lock');`);checks++;
 const pair=(await Promise.all([one,two])).map(value=>JSON.parse(value));
 check(pair[0].state==='recorded'&&pair[1].state==='replayed','Actually overlapping same request creates and replays');
 check(pair[0].event_id===pair[1].event_id,'Concurrent recovery retains exactly the original event');
 check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE id='${concurrentId}'`)==='1','Concurrent calls create one signer');
 check(Number(sql(`SELECT version FROM paige_agreements WHERE id='${concurrent.id}'`))===concurrent.version+1,'Concurrent retry advances original source once');
 const outside='bbbbbbbb-0000-4000-8000-000000000002',outsideClient='c2222222-0000-4000-8000-000000000002';
 const outsideContext=context+`SET test.tenant='${outside}';SET test.uid='22222222-0000-4000-8000-000000000002';`;
 const outsideSource=JSON.parse(sql(outsideContext+`SELECT save_paige_agreement('${outside}',NULL,'${outsideClient}','Other original document','Other supplied words');`));
 refused(command(outsideSource,id,{tenant:outside,client:outsideClient}),'42501',outsideContext);
 check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE agreement_id='${outsideSource.id}' AND email='prepared@example.test'`)==='0','Foreign creation identity produces no other-business party');
 refused(`UPDATE paige_agreement_events SET detail='{}'::jsonb WHERE id='${receipt.event_id}'`,'42501','');
 const frozen=fresh(),frozenId=randomUUID();sql(`UPDATE paige_agreements SET content_storage_key='${tenant}/${frozen.id}/exact.pdf',content_sha256=repeat('a',64) WHERE id='${frozen.id}';`);
 const frozenNow=JSON.parse(sql(`SELECT to_jsonb(a) FROM paige_agreements a WHERE id='${frozen.id}'`));
 refused(command(frozenNow,frozenId,{email:'frozen@example.test'}),'23514');
 check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE id='${frozenId}'`)==='0','Checked entry preserves frozen-source refusal');
 const competing=fresh(),leftId=randomUUID(),rightId=randomUUID(),competingTag='e04_cas_'+randomUUID().replaceAll('-','');
 const left=startSession(competingTag+'left','BEGIN;'+context+command(competing,leftId,{email:'cas-left@example.test'})+'SELECT pg_sleep(1.5);COMMIT;');
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(competingTag+'left')} AND wait_event='PgSleep');`);
 const rightStatement=command(competing,rightId,{email:'cas-right@example.test'}).replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'');
 const right=startSession(competingTag+'right',context+`DO $proof$ BEGIN BEGIN ${rightStatement};RAISE EXCEPTION 'Expected reviewed-source refusal';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;END $proof$;SELECT 'refused';`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(competingTag+'right')} AND wait_event_type='Lock');`);checks++;
 await left;check(await right==='refused','Different concurrent intent rechecks the original source after wait');
 check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE id='${leftId}'`)==='1'&&sql(`SELECT count(*) FROM paige_agreement_signers WHERE id='${rightId}'`)==='0','Only one reviewed-source intent is applied');
 check(Number(sql(`SELECT version FROM paige_agreements WHERE id='${competing.id}'`))===competing.version+1,'Rejected concurrent intent does not advance source');
 const privateSignature='_write_agreement_signer(uuid,uuid,text,text,text,integer,uuid,text)',privateDefinition=sql(`SELECT pg_get_functiondef('${privateSignature}'::regprocedure);`);
 sql(privateDefinition.replace('BEGIN','BEGIN\n  -- Another owner source change in this isolated fixture.'));
 assert.throws(()=>sql(read(path)),/Canonical signer business body changed; reconcile before applying/);checks++;sql(privateDefinition);
 const legacySignature='add_agreement_signer(uuid,uuid,text,text,text,integer)',legacyDefinition=sql(`SELECT pg_get_functiondef('${legacySignature}'::regprocedure);`);
 sql(legacyDefinition.replace('BEGIN','BEGIN\n  -- Another legacy source change in this isolated fixture.'));
 assert.throws(()=>sql(read(path)),/Original signer writer changed; reconcile before applying/);checks++;sql(legacyDefinition);
 check(sql("SELECT i.indisunique AND i.indisvalid FROM pg_index i WHERE i.indexrelid='public.uq_agreement_signer_preparation_receipt'::regclass;")==='t','Original receipt lookup has a valid unique scoped index');
 refused(`INSERT INTO paige_agreement_events(agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_user_id,detail) SELECT agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_user_id,detail FROM paige_agreement_events WHERE id='${receipt.event_id}'`,'23505','');
 const recovery=(source,id)=>`SELECT recover_agreement_signer_preparation('${tenant}','${source.id}','${id}');`;
 const recovered=JSON.parse(sql(context+recovery(source,id)));
 check(recovered.state==='recovered'&&recovered.event_id===receipt.event_id&&recovered.signer_id===id,'Reload recovery returns the same original event and signer');
 check(JSON.stringify(JSON.parse(sql(context+recovery(source,randomUUID()))))===JSON.stringify({state:'unconfirmed'}),'Absence is unconfirmed, never cancelled or refused');
 refused(recovery(source,id),'42501',context+"SET test.uid='22222222-0000-4000-8000-000000000002';");
 refused(recovery(source,id),'42501',context+'SET ROLE anon;');
 refused(recovery(source,id),'42501',context+'SET ROLE service_role;');
 refused(recovery(source,id),'42501',context+"SET test.admin='false';");
 refused(recovery(legacy,legacyResult.signer_id),'42501');
 const waiting=fresh(),waitingId=randomUUID(),waitingTag='e04_recovery_'+randomUUID().replaceAll('-','');
 const waitingWriter=startSession(waitingTag+'write','BEGIN;'+context+command(waiting,waitingId,{email:'waiting@example.test'})+'SELECT pg_sleep(1.5);COMMIT;');
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(waitingTag+'write')} AND wait_event='PgSleep');`);
 const waitingReader=startSession(waitingTag+'read',context+recovery(waiting,waitingId));
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(waitingTag+'read')} AND wait_event_type='Lock');`);checks++;
 const waitingPair=(await Promise.all([waitingWriter,waitingReader])).map(value=>JSON.parse(value));
 check(waitingPair[1].state==='recovered'&&waitingPair[1].event_id===waitingPair[0].event_id,'Recovery waits and sees a genuinely uncommitted original creation');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${waitingId}' AND detail ? 'signer_preparation'`)==='1','Waiting recovery never writes another event');
 // Fixture-only dynamic authority signal: unlike the session stand-in alone,
 // this can change while an actual request lock is held. No production role
 // or account is touched; the original fixture helper is restored afterward.
 const authorityDefinition=sql("SELECT pg_get_functiondef('public.is_tenant_admin(uuid)'::regprocedure);");
 sql(`CREATE TABLE public.proof_signer_authority(allowed boolean NOT NULL);INSERT INTO proof_signer_authority VALUES(true);GRANT SELECT ON proof_signer_authority TO authenticated;CREATE OR REPLACE FUNCTION public.is_tenant_admin(_t uuid) RETURNS boolean LANGUAGE sql STABLE AS $authority$ SELECT coalesce(current_setting('test.admin',true)::boolean,false) AND (SELECT allowed FROM public.proof_signer_authority LIMIT 1) $authority$;`);
 try{
  const revokeSource=fresh(),revokeId=randomUUID(),revokeTag='e04_revoke_'+randomUUID().replaceAll('-','');
  const revokeWriter=startSession(revokeTag+'write','BEGIN;'+context+command(revokeSource,revokeId,{email:'revocation@example.test'})+'SELECT pg_sleep(1.5);COMMIT;');
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(revokeTag+'write')} AND wait_event='PgSleep');`);
  const readStatement=recovery(revokeSource,revokeId).replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'');
  const revokeReader=startSession(revokeTag+'read',context+`DO $proof$ BEGIN BEGIN ${readStatement};RAISE EXCEPTION 'Expected post-wait authority refusal';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;SELECT 'refused';`);
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(revokeTag+'read')} AND wait_event_type='Lock');`);checks++;
  sql('UPDATE proof_signer_authority SET allowed=false;');
  await revokeWriter;check(await revokeReader==='refused','Recovery revalidates original authority after its wait');
 }finally{sql('UPDATE proof_signer_authority SET allowed=true;');sql(authorityDefinition);}
 const recoveryAcl=JSON.parse(sql("SELECT jsonb_build_object('auth',has_function_privilege('authenticated','recover_agreement_signer_preparation(uuid,uuid,uuid)','EXECUTE'),'anon',has_function_privilege('anon','recover_agreement_signer_preparation(uuid,uuid,uuid)','EXECUTE'),'service',has_function_privilege('service_role','recover_agreement_signer_preparation(uuid,uuid,uuid)','EXECUTE'),'projection_auth',has_function_privilege('authenticated','_read_agreement_signer_preparation(uuid,uuid,uuid,uuid,text,uuid)','EXECUTE'),'projection_service',has_function_privilege('service_role','_read_agreement_signer_preparation(uuid,uuid,uuid,uuid,text,uuid)','EXECUTE'))"));
 check(recoveryAcl.auth&&!recoveryAcl.anon&&!recoveryAcl.service&&!recoveryAcl.projection_auth&&!recoveryAcl.projection_service,'Actor-bound recovery only, no direct raw projection grant');
 const acl=JSON.parse(sql("SELECT jsonb_build_object('public_auth',has_function_privilege('authenticated','prepare_agreement_signer(uuid,uuid,uuid,integer,timestamptz,uuid,text,text,text,integer)','EXECUTE'),'public_anon',has_function_privilege('anon','prepare_agreement_signer(uuid,uuid,uuid,integer,timestamptz,uuid,text,text,text,integer)','EXECUTE'),'public_service',has_function_privilege('service_role','prepare_agreement_signer(uuid,uuid,uuid,integer,timestamptz,uuid,text,text,text,integer)','EXECUTE'),'private_auth',has_function_privilege('authenticated','_write_agreement_signer(uuid,uuid,text,text,text,integer,uuid,text)','EXECUTE'),'private_service',has_function_privilege('service_role','_write_agreement_signer(uuid,uuid,text,text,text,integer,uuid,text)','EXECUTE'))"));
 check(acl.public_auth&&!acl.public_anon&&!acl.public_service&&!acl.private_auth&&!acl.private_service,'One authenticated checked entry and owner-only shared business body');
 check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE agreement_id IN ('${source.id}','${concurrent.id}','${unchanged.id}') AND (token_hash IS NOT NULL OR status IN ('viewed','signed'))`)==='0','No token, view, consent or signing result fabricated');
 check(sql(`SELECT status FROM paige_agreements WHERE id='${source.id}'`)==='draft','Preparation does not issue signatures or effect terms');
 return {checks,migrationReplay:2,concurrentSessions:8,observedLockWaits:4,scope:'Checked native preparation and original receipts only; no customer JWT/provider/signature acceptance'};
}
