// Extends the existing disposable Operator PostgreSQL fixture; never accepts provider credentials.
import assert from 'node:assert/strict';
export async function proveProviderIndependentRetirement({db, actor, preview, refuse, owner, ordinary, agency, child, solo}) {
 const admin='00000000-0000-0000-0000-000000000003';
 await actor(owner);
 await db.query("insert into tenant_twilio_subaccounts values(gen_random_uuid(),$1,$2,'active',true,$3,'synthetic-key','synthetic-webhook',null)",[child,'AC'+'b'.repeat(32),'twilio_subaccount_api_key_secret:'+child]);
 await db.query("insert into vault.secrets(name,secret) values($1,'synthetic-secret')",['twilio_subaccount_api_key_secret:'+child]);
 await db.query("insert into vault.secrets(name,secret) values('platform-preserved','synthetic-platform-secret')");
 await db.query("insert into tenant_n8n_connections values($1,'synthetic-url','synthetic-key','1234','connected',null,200,null,now())",[agency]);
 const abandoned='00000000-0000-0000-0000-000000000117',lease='00000000-0000-0000-0000-000000000118';
 await db.query("insert into operator_account_archives(id,root_tenant_id,actor_user_id,root_name,state,scope_ids,prior_tenants,prior_members,resource_mode,resource_plan,resource_claim,resource_started_at) values($1,$2,$3,'Example Agency','resources_unknown',$4::uuid[],'[]','[]','archive',$5::jsonb,$6,clock_timestamp())",[abandoned,agency,admin,'{'+agency+','+child+'}',JSON.stringify([{key:'twilio:'+child,provider:'twilio',tenant_id:child}]),lease]);
 assert.equal((await preview(agency)).execution_available,false,'an active claimed effect cannot race Archive');
 await db.query("update operator_account_archives set resource_started_at=clock_timestamp()-interval '11 minutes' where id=$1",[abandoned]);
 const initial=await preview(agency);
 assert.equal(initial.execution_available,true,'PAIGE Archive must not require external-provider permission');
 assert.ok(initial.warnings.length>0,'external services must remain explicitly unverified');
 assert.ok(!JSON.stringify(initial).includes('synthetic-key'));
 await actor(ordinary);await refuse(()=>preview(agency),'42501');await actor(admin);
 const op='00000000-0000-0000-0000-000000000111';
 await refuse(()=>db.query('select operator_archive_account($1,$2,$3,$4)',[agency,'stale','Example Agency',op]),'40001');
 await db.query('select operator_archive_account($1,$2,$3,$4)',[agency,initial.version,'Example Agency',op]);
 assert.equal((await db.query('select resource_mode from operator_account_archives where id=$1',[abandoned])).rows[0].resource_mode,null,'abandoned provider preparation cannot hold PAIGE hostage');
 await refuse(()=>db.query("select operator_finish_retirement_resource($1,$2,$3,$4,$5,'verified','suspended',null)",[agency,abandoned,admin,lease,'twilio:'+child]),'42501');
 assert.equal((await db.query('select bool_and(lifecycle_execution_paused) v from tenants where id=ANY($1::uuid[])',['{'+agency+','+child+'}'])).rows[0].v,true);
 await db.query('select operator_restore_archived_account($1,$2)',[agency,op]);
 assert.equal((await db.query('select lifecycle_execution_paused v from tenants where id=$1',[agency])).rows[0].v,true);
 const p=await preview(agency),archive='00000000-0000-0000-0000-000000000112';
 await db.query('select operator_archive_account($1,$2,$3,$4)',[agency,p.version,'Example Agency',archive]);
 let deletion=(await db.query('select operator_preview_account_deletion($1) v',[agency])).rows[0].v;
 if(deletion.storage_count>0) {
  const files=(await db.query("select operator_preview_retirement_resources($1,'delete') v",[agency])).rows[0].v;
  assert.equal(files.execution_available,true,JSON.stringify(files.blockers));
  assert.ok(files.resources.every(r=>['tts_cache','generated_media'].includes(r.provider)), 'files cleanup cannot invoke Twilio or n8n');
  const fileOp='00000000-0000-0000-0000-000000000115',claim='00000000-0000-0000-0000-000000000116';
  await db.query("select operator_begin_retirement_resources($1,'delete',$2,'Example Agency',$3,false)",[agency,files.version,fileOp]);
  await actor('');await db.query('select operator_claim_retirement_resources($1,$2,$3,$4,false)',[agency,fileOp,admin,claim]);
  for(const resource of files.resources) {
   const key=resource.provider+':'+resource.tenant_id;
   await refuse(()=>db.query("select operator_finish_retirement_resource($1,$2,$3,$4,$5,'verified','removed',null)",[agency,fileOp,admin,claim,key]),'55000');
   // Fixture metadata disappearance models the existing Storage API; bytes are adapter-tested separately.
   await db.query('delete from storage.objects where bucket_id=$1 and split_part(name,\'/\',1)=$2',[resource.provider==='tts_cache'?'tts-cache':'paige-generated',resource.tenant_id]);
   await db.query("select operator_finish_retirement_resource($1,$2,$3,$4,$5,'verified','removed',null)",[agency,fileOp,admin,claim,key]);
  }
  await db.query('select operator_complete_retirement_resources($1,$2,$3,$4)',[agency,fileOp,admin,claim]);
  await actor(admin);
  const after=(await db.query('select operator_preview_account_deletion($1) v',[agency])).rows[0].v;
  assert.equal(after.data_version,deletion.data_version,'file removal preserves the confirmed business-data fingerprint');deletion=after;
 }
 assert.equal(deletion.execution_available,true,JSON.stringify(deletion.blockers));
 await refuse(()=>db.query('select operator_delete_archived_account($1,$2,$3,$4)',[agency,deletion.version,'Wrong name',archive]),'22023');
 await refuse(()=>db.query('select operator_delete_archived_account($1,$2,$3,$4)',[agency,'stale','Example Agency',archive]),'40001');
 await db.exec(`BEGIN; CREATE TABLE surviving_secret_binding(tenant_id uuid REFERENCES tenants(id),credentials_vault_ref text);
 INSERT INTO surviving_secret_binding VALUES('${solo}','twilio_subaccount_api_key_secret:${child}');
 SELECT operator_delete_archived_account('${agency}','${deletion.version}','Example Agency','${archive}');
 DO $$BEGIN IF (SELECT count(*) FROM vault.secrets)<>2 THEN RAISE EXCEPTION 'shared credential removed'; END IF; END$$; ROLLBACK;`);
 await db.exec("CREATE FUNCTION fixture_refuse_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic audit unavailable' USING ERRCODE='55000';END$$;CREATE TRIGGER fixture_refuse BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_refuse_audit();");
 await refuse(()=>db.query('select operator_delete_archived_account($1,$2,$3,$4)',[agency,deletion.version,'Example Agency',archive]),'55000');
 assert.equal((await db.query('select count(*)::int n from vault.secrets')).rows[0].n,2,'audit failure rolls back credential removal and physical deletion');
 assert.equal((await db.query('select count(*)::int n from tenants where id=$1',[agency])).rows[0].n,1);
 await db.exec('DROP TRIGGER fixture_refuse ON audit_logs');
 const receipt=(await db.query('select operator_delete_archived_account($1,$2,$3,$4) v',[agency,deletion.version,'Example Agency',archive])).rows[0].v;
 assert.equal(receipt.state,'deleted');assert.equal(receipt.external_cleanup_pending,true);
 await db.query('select operator_delete_archived_account($1,$2,$3,$4)',[agency,deletion.version,'Example Agency',archive]);
 for(const rel of ['tenant_twilio_subaccounts','tenant_n8n_connections','tenant_phone_numbers'])assert.equal((await db.query(`select count(*)::int n from ${rel}`)).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from tenants where id=$1',[solo])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,3);
 assert.equal((await db.query('select count(*)::int n from vault.secrets')).rows[0].n,1,'platform credential survives; exclusive tenant credential is removed');
 const privateReceipt=(await db.query('select external_cleanup from operator_account_archives where id=$1',[archive])).rows[0].external_cleanup;
 assert.equal(privateReceipt.length,2);assert.ok(!JSON.stringify(privateReceipt).includes('synthetic-key'));assert.ok(!JSON.stringify(privateReceipt).includes('synthetic-url'));
 await refuse(()=>db.exec('SET ROLE authenticated; SELECT external_cleanup FROM operator_account_archives'),'42501');await db.exec('RESET ROLE');
 const standalone='00000000-0000-0000-0000-000000000113',soloOp='00000000-0000-0000-0000-000000000114';
 await db.query("insert into tenants(id,name,status,account_type) values($1,'Synthetic Independent Solo','canceled','standalone')",[standalone]);
 await db.query("insert into tenant_twilio_subaccounts values(gen_random_uuid(),$1,$2,'active',true,NULL,NULL,NULL,NULL)",[standalone,'AC'+'c'.repeat(32)]);
 const sp=await preview(standalone);await db.query('select operator_archive_account($1,$2,$3,$4)',[standalone,sp.version,'Synthetic Independent Solo',soloOp]);
 const dp=(await db.query('select operator_preview_account_deletion($1) v',[standalone])).rows[0].v;
 await db.query('select operator_delete_archived_account($1,$2,$3,$4)',[standalone,dp.version,'Synthetic Independent Solo',soloOp]);
 assert.equal((await db.query('select count(*)::int n from tenants where id=$1',[standalone])).rows[0].n,0);
 console.log('PASS: real isolated SQL Archive/Restore/Delete for Agency tree and Solo without provider credentials or calls; Admin/refusal, stale/name/idempotency checks, physical absence, shared Auth/survivor/platform preservation, exclusive credential removal and private external-pending receipt.');
}
