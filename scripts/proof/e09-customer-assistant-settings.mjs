// Extends the incumbent disposable native projection proof; not hosted Auth/QA.
import {createHash} from 'node:crypto';
export async function assistantSettingsProof({sql,check,assert,fs,root,path,uid,tenant,foreign,presentation,spawn,exe,port,transcripts,unsafe}){
 const owner='e091a000-0000-4000-8000-000000000001',admin='e091a000-0000-4000-8000-000000000002',
  foreignOwner='e091a000-0000-4000-8000-000000000003',member='e091a000-0000-4000-8000-000000000004',flagOwner='e091a000-0000-4000-8000-000000000005';
 const ownership=fs.readFileSync(path.join(root,'supabase/migrations/20260803190000_slice_a_multi_owner_is_owner.sql'),'utf8');
 const operatorAuthority=fs.readFileSync(path.join(root,'supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql'),'utf8');
 const nativeOwner=operatorAuthority.match(/CREATE OR REPLACE FUNCTION public\.is_tenant_owner\([\s\S]*?\$function\$;/)?.[0];
 const nativeBrand=ownership.match(/CREATE OR REPLACE FUNCTION public\.can_manage_tenant_brand\([\s\S]*?\$function\$;/)?.[0];
 const priorSource=fs.readFileSync(path.join(root,'supabase/migrations/20260713020710_portal_config.sql'),'utf8');
 const prior=priorSource.match(/CREATE OR REPLACE FUNCTION public\.set_tenant_portal_config\([\s\S]*?\$\$;/)?.[0];
 assert(nativeOwner&&nativeBrand&&prior,'Original native authority/writer sources must be present');
 sql(`CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role text,status text,is_owner boolean);
  CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.is_company_workspace(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
  INSERT INTO tenant_members VALUES('${tenant}','${owner}','owner','active',true),('${tenant}','${admin}','admin','active',false),
  ('${foreign}','${foreignOwner}','owner','active',true),('${tenant}','${member}','member','active',false),('${tenant}','${flagOwner}','member','active',true);
  UPDATE tenants SET parent_tenant_id=NULL;
  ${nativeOwner} ${nativeBrand} ${prior}
  REVOKE ALL ON FUNCTION public.set_tenant_portal_config(uuid,jsonb) FROM PUBLIC,anon,service_role;
  GRANT EXECUTE ON FUNCTION public.set_tenant_portal_config(uuid,jsonb) TO authenticated;`);
 const beforeAcl=sql("SELECT proacl::text FROM pg_proc WHERE oid='public.set_tenant_portal_config(uuid,jsonb)'::regprocedure;");
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20271108202000_e09_customer_assistant_settings.sql'),'utf8');
 check('Source fixture uses the observed native ownership and brand permission bodies',()=>{
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.is_tenant_owner(uuid,uuid)'::regprocedure;"),'f392787e7469ed325960850ad091473d');
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.can_manage_tenant_brand(uuid)'::regprocedure;"),'83ab60b34ee249bdad4e73e8aafbdcd8');
 });
 if(!unsafe){
  sql('GRANT EXECUTE ON FUNCTION public.set_tenant_portal_config(uuid,jsonb) TO anon;');
  try{check('Unexpected execute authority is refused before replacing the writer',()=>assert.throws(()=>sql(migration),/source changed/))}
  finally{sql('REVOKE EXECUTE ON FUNCTION public.set_tenant_portal_config(uuid,jsonb) FROM anon;')}
  sql('GRANT EXECUTE ON FUNCTION public.set_tenant_portal_config(uuid,jsonb) TO authenticated WITH GRANT OPTION;');
  try{check('Unexpected delegation authority is refused before replacing the writer',()=>assert.throws(()=>sql(migration),/source changed/))}
  finally{sql('REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.set_tenant_portal_config(uuid,jsonb) FROM authenticated;')}
 }
 if(!unsafe)sql(migration);
 const configure=(actor,target,patch)=>{
  const value=sql(`BEGIN; SELECT set_config('test.actor','${actor??''}',true); SET LOCAL ROLE authenticated;
   SELECT public.set_tenant_portal_config('${target}',$patch$${JSON.stringify(patch)}$patch$::jsonb); COMMIT;`);
  return JSON.parse(value.split('\n').find(line=>line.startsWith('{')));
 };
 const state=()=>sql('SELECT jsonb_agg(jsonb_build_object(\'id\',id,\'features\',features) ORDER BY id) FROM tenants;');
 sql(`UPDATE tenants SET features='{"other_feature":{"keep":true},"portal_config":{"welcome":{"headline":"Saved welcome"},"assistant":{"enabled":false,"display_name":"Saved guide","tone":"Clear","service_scope":"Approved customer services","human_handoff":"Contact the team","future_setting":"keep"}}}' WHERE id='${tenant}';`);
 check('Canonical owner saves bounded customer-facing settings',()=>assert.equal(configure(owner,tenant,{assistant:{display_name:'New guide'}}).assistant.display_name,'New guide'));
 check('Partial assistant edit preserves disabled policy and unrelated saved fields',()=>{
  const c=configure(owner,tenant,{assistant:{tone:'Warm'}});assert.equal(c.assistant.enabled,false);assert.equal(c.assistant.display_name,'New guide');assert.equal(c.assistant.service_scope,'Approved customer services');assert.equal(c.assistant.future_setting,'keep');assert.equal(c.welcome.headline,'Saved welcome');
 });
 check('Welcome update does not overwrite saved assistant policy',()=>assert.equal(configure(owner,tenant,{welcome:{headline:'New welcome'}}).assistant.enabled,false));
 check('Admin retains the existing native brand/configuration authority',()=>assert.equal(configure(admin,tenant,{assistant:{human_handoff:'Contact your coach'}}).assistant.human_handoff,'Contact your coach'));
 check('Native ownership flag remains authoritative without inventing an owner role',()=>assert.equal(configure(flagOwner,tenant,{assistant:{tone:'Professional'}}).assistant.tone,'Professional'));
 for(const [name,actor,target]of[['Customer',uid,tenant],['Ordinary member',member,tenant],['Foreign owner',foreignOwner,tenant],['Owner naming foreign business',owner,foreign]])check(name+' cannot change configuration or another business',()=>{const before=state();assert.throws(()=>configure(actor,target,{assistant:{enabled:true}}));assert.equal(state(),before)});
 check('Malformed top-level patch preserves saved records',()=>{const before=state();assert.throws(()=>configure(owner,tenant,[]));assert.equal(state(),before)});
 check('Malformed module patch preserves saved records',()=>{const before=state();assert.throws(()=>configure(owner,tenant,{modules:{}}));assert.equal(state(),before)});
 check('Canonical customer presentation reloads exactly the authorized saved assistant',()=>{
  const data=presentation(uid);assert.equal(data.config.assistant.display_name,'New guide');assert.equal(data.config.assistant.enabled,false);assert.equal(data.config.assistant.human_handoff,'Contact your coach');assert(!JSON.stringify(data).includes('Foreign portal B'));
 });
 check('Other feature data remains unchanged',()=>assert.equal(sql(`SELECT features->'other_feature'->>'keep' FROM tenants WHERE id='${tenant}';`),'true'));
 check('Canonical writer owner, security mode, search path and ACL are preserved',()=>{
  assert.equal(sql("SELECT pg_get_userbyid(proowner)||'|'||prosecdef||'|'||proconfig::text FROM pg_proc WHERE oid='public.set_tenant_portal_config(uuid,jsonb)'::regprocedure;"),'postgres|true|{search_path=public}');assert.equal(sql("SELECT proacl::text FROM pg_proc WHERE oid='public.set_tenant_portal_config(uuid,jsonb)'::regprocedure;"),beforeAcl);
  assert.equal(sql("SELECT has_function_privilege('anon','public.set_tenant_portal_config(uuid,jsonb)','EXECUTE') OR has_function_privilege('service_role','public.set_tenant_portal_config(uuid,jsonb)','EXECUTE');"),'f');
 });
 sql(`UPDATE tenants SET parent_tenant_id='${foreign}' WHERE id='${tenant}';`);
 check('Existing parent ownership can configure its child through the canonical predicate',()=>assert.equal(configure(foreignOwner,tenant,{assistant:{tone:'Parent managed'}}).assistant.tone,'Parent managed'));
 sql(`UPDATE tenants SET parent_tenant_id=NULL WHERE id='${tenant}';`);
 const background=(label,query)=>new Promise((resolve,reject)=>{
  const child=spawn(exe('psql'),['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',exit=>{transcripts.push({command:label,exitCode:exit,stdout,stderr});resolve(exit)});child.stdin.end(query);
 });
 const barrier=async label=>{for(let i=0;i<30;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${label}' AND wait_event='PgSleep');`)==='t')return;await new Promise(r=>setTimeout(r,20));}throw Error('Native row-lock barrier was not reached')};
 const first=background('assistant-first-writer',`BEGIN; SET LOCAL application_name='assistant-first-writer'; SELECT set_config('test.actor','${owner}',true); SET LOCAL ROLE authenticated; SELECT set_tenant_portal_config('${tenant}','{"assistant":{"display_name":"Concurrent guide"}}'); SELECT pg_sleep(2); COMMIT;`);
 try{await barrier('assistant-first-writer');configure(admin,tenant,{assistant:{tone:'Concurrent tone'}});assert.equal(await first,0);check('Two native concurrent partial assistant saves preserve both updates',()=>{const c=presentation(uid).config.assistant;assert.equal(c.display_name,'Concurrent guide');assert.equal(c.tone,'Concurrent tone');assert.equal(c.enabled,false)})}finally{await first}
 const revoker=background('assistant-permission-revoker',`BEGIN; SET LOCAL application_name='assistant-permission-revoker'; SELECT id FROM tenants WHERE id='${tenant}' FOR UPDATE; UPDATE tenant_members SET status='inactive' WHERE tenant_id='${tenant}' AND user_id='${owner}'; SELECT pg_sleep(2); COMMIT;`);
 try{await barrier('assistant-permission-revoker');let refused=false;try{configure(owner,tenant,{assistant:{enabled:true}})}catch{refused=true}assert.equal(await revoker,0);check('Authority withdrawn while waiting for the tenant row refuses the save',()=>{assert(refused);assert.equal(presentation(uid).config.assistant.enabled,false)})}finally{await revoker;sql(`UPDATE tenant_members SET status='active' WHERE tenant_id='${tenant}' AND user_id='${owner}';`)}
 if(!unsafe)check('A changed protected writer definition is refused by the source lease',()=>assert.throws(()=>sql(migration),/source changed/));
 return {assistantSettingsMigrationSHA256:createHash('sha256').update(migration).digest('hex'),assistantSettingsProof:'synthetic-native-postgresql; platform ownership predicate modeled false; full-schema/hosted Auth remains unverified'};
}
