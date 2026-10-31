// Integration of ORIGINAL post/discard/stale-claim writers in the owning local fixture.
// Auth claims and Storage metadata are explicit ports; no uploaded bytes/API/provider effects.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

export async function verifyHubFileCurrentness({sql,connection,ids,prepare,post,file,original,ready,blocked,parsed}){
 const controls=[];
 const roleDefinition=sql("SELECT pg_get_functiondef('auth.role()'::regprocedure)").replace(/\r\n/g,'\n');
 const roleMetadata=sql("SELECT to_jsonb(p)::text FROM pg_proc p WHERE oid='auth.role()'::regprocedure");
 // Preserve the existing fixture's default authenticated claim and explicitly model service claims.
 sql("CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;");
 try{
  assert.equal(sql("SELECT to_regclass('storage.objects') IS NULL"),'t','This integration owns only its new local Storage metadata port');
  sql(`CREATE SCHEMA storage;
   CREATE TABLE storage.objects(bucket_id text NOT NULL,name text NOT NULL,owner_id text,metadata jsonb,PRIMARY KEY(bucket_id,name));
   ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
   REVOKE ALL ON storage.objects FROM PUBLIC,anon,authenticated,service_role;`);
  original('files','team_hub_discard_file','uuid,uuid','702b36cf1a248f80cff0fde4bc084d66',true);
  original('files','team_hub_claim_stale_files','uuid','4e47e1760c1c2b300a47a2878fb48591',true);
  const discardMetadata=sql("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='public.team_hub_discard_file(uuid,uuid)'::regprocedure");
  const discardPatch=readFileSync(new URL('./exp08-team-hub-discard-currentness-patch.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  sql(discardPatch);sql(discardPatch);
  assert.equal(sql("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='public.team_hub_discard_file(uuid,uuid)'::regprocedure"),discardMetadata,'Original discard OID/ACL/all metadata conserved on patch/replay');
  for(const [signature,allowed] of [['public.team_hub_discard_file(uuid,uuid)','authenticated'],['public.team_hub_claim_stale_files(uuid)','service_role']]){
   const scope=JSON.parse(sql(`SELECT jsonb_build_object('owner',p.proowner::regrole::text,'definer',p.prosecdef,'config',p.proconfig,'grantees',(SELECT jsonb_agg(a.grantee::regrole::text ORDER BY a.grantee::regrole::text) FROM aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE')) FROM pg_proc p WHERE oid='${signature}'::regprocedure`));
   assert.deepEqual(scope,{owner:'postgres',definer:true,config:['search_path=""'],grantees:[allowed,'postgres'].sort()},'Original cleanup role separation must remain exact');
  }
  const path=ids.tenant+'/team-hub/'+file;
  const discard=`SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.team_hub_discard_file('${ids.tenant}','${file}');`;
  const sweep=`SELECT set_config('request.jwt.claim.sub','',true);SELECT set_config('request.jwt.claim.role','service_role',true);SET LOCAL ROLE service_role;SELECT public.team_hub_claim_stale_files('${ids.actor}');`;
  prepare();
  const untouched=()=>sql(`SELECT to_jsonb(f)::text FROM public.team_hub_files f WHERE f.id='${file}'`);
  const before=untouched();
  for(const [role,routine,args] of [['anon','team_hub_discard_file',`'${ids.tenant}','${file}'`],['service_role','team_hub_discard_file',`'${ids.tenant}','${file}'`],['anon','team_hub_claim_stale_files',`'${ids.actor}'`],['authenticated','team_hub_claim_stale_files',`'${ids.actor}'`]]){
   assert.throws(()=>sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.${routine}(${args});COMMIT;`),new RegExp('permission denied for function '+routine),'Wrong native role must be denied at the original function ACL');
   assert.equal(untouched(),before);controls.push({change:'original cleanup wrong role',role,routine,actualExecutionDenied:true});
  }
  for(const [actor,tenant,code] of [[ids.actor,ids.other,'scope_changed'],[ids.target,ids.tenant,'not_found']]){
   const response=parsed(sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;SELECT public.team_hub_discard_file('${tenant}','${file}');COMMIT;`));
   assert.deepEqual(response,{ok:false,code},'Original foreign-context/uploader refusal must reveal no path');
   assert.equal(untouched(),before);controls.push({change:'original discard scope/uploader negative',foreignContext:tenant===ids.other,refusedWithoutPath:true});
  }
  for(const kind of ['discard','sweep'])for(const postFirst of [false,true]){
   sql('TRUNCATE storage.objects;');prepare();
   sql(`UPDATE public.team_hub_files SET created_at=clock_timestamp()-interval '2 days' WHERE id='${file}';
    INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('comms-attachments','${path}','${ids.actor}','{"size":1,"mimetype":"text/plain"}');`);
   const cleanup=kind==='discard'?discard:sweep;
   const first=connection(`BEGIN;SET application_name='exp08_hub_door_first';SET statement_timeout='20s';${postFirst?post:cleanup}\n\\echo EXP08_HUB_DOOR_READY`,true);let second;
   try{
    await ready(first);assert.equal(parsed(first.read())?.ok,true,'The first ORIGINAL writer must complete its actual effect');
    second=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';${postFirst?cleanup:post}COMMIT;`);
    assert(await blocked(second,first),'Original '+kind+'/post must observe its actual file-row transaction');
    first.p.stdin.end('COMMIT;\n\\q\n');const a=await first.done,b=await second.done;
    assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
    const postResult=parsed(postFirst?a.out:b.out),cleanupResult=parsed(postFirst?b.out:a.out);
    assert.equal(postResult?.ok,postFirst,'A claimed file cannot subsequently publish a message');
    if(!postFirst)assert.equal(postResult.code,'invalid');
    if(kind==='discard')assert.deepEqual(cleanupResult,postFirst?{ok:false,code:'not_allowed'}:{ok:true,path});
    else assert.deepEqual(cleanupResult,{ok:true,paths:postFirst?[]:[path]});
    const state=JSON.parse(sql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.team_hub_messages),'state',f.state,'posted',f.message_id IS NOT NULL,'postedAt',f.posted_at IS NOT NULL,'storageMetadata',(SELECT count(*) FROM storage.objects)) FROM public.team_hub_files f WHERE f.id='${file}'`));
    assert.deepEqual(state,{messages:postFirst?1:0,state:postFirst?'ready':'discarded',posted:postFirst,postedAt:postFirst,storageMetadata:1},'Only the original winning writer changes message/file state; no Storage effect is simulated as real bytes');
    controls.push({change:'original post and '+kind,order:postFirst?'post-first':'cleanup-first',actualFileWait:true,oneWinningEffect:true,originalRolesAndSources:true,storageMetadataOnly:true});
   }finally{
    if(first.p.exitCode===null&&!first.p.stdin.writableEnded)first.p.stdin.end('ROLLBACK;\n\\q\n');
    await Promise.allSettled([first.done,...(second?[second.done]:[])]);
   }
  }
  assert.equal(controls.length,10);
  sql('TRUNCATE storage.objects;');prepare();
  const channel=sql(`SELECT channel_id FROM public.team_hub_files WHERE id='${file}'`);
  const leave=parsed(sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.team_hub_leave_channel('${ids.tenant}','${channel}');COMMIT;`));
  assert.equal(leave?.ok,true,'Original leave writer must actually end conversation visibility');
  assert.equal(sql(`SELECT archived_at IS NOT NULL FROM public.team_hub_channels WHERE id='${channel}'`),'t');
  assert.deepEqual(parsed(sql('BEGIN;'+discard+'COMMIT;')),{ok:true,path},'Original own-upload cancellation remains allowed after leaving the conversation');
  controls.push({change:'original own upload after actual leave',originalLeaveAndDiscard:true,visibilityNotRequired:true});
  for(const commit of [true,false]){
   sql('TRUNCATE storage.objects;');prepare();
   sql(`INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES('${ids.other}','${ids.actor}','active',false,'member');`);
   const holder=connection(`BEGIN;SET application_name='exp08_hub_door_first';SELECT id FROM public.team_hub_files WHERE id='${file}' FOR UPDATE;\n\\echo EXP08_HUB_DOOR_READY`,true);let caller;
   try{
    await ready(holder);caller=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';${discard}COMMIT;`);
    assert(await blocked(caller,holder),'Original discard must wait on its actual file row');
    sql(`BEGIN;UPDATE public.profiles SET active_tenant_id='${ids.other}' WHERE user_id='${ids.actor}';${commit?'COMMIT':'ROLLBACK'};`);
    holder.p.stdin.end('COMMIT;\n\\q\n');const a=await holder.done,b=await caller.done;
    assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
    const response=parsed(b.out),state=sql(`SELECT state FROM public.team_hub_files WHERE id='${file}'`);
    console.log(JSON.stringify({phase:'original-discard-context-readback',actualFileWait:true,workspaceChangeCommitted:commit,response,state}));
    assert.deepEqual(response,commit?{ok:false,code:'scope_changed'}:{ok:true,path},'Committed context change during file wait must refuse without exposing a path');
    assert.equal(state,commit?'ready':'discarded');
    controls.push({change:'original discard context during file wait',committed:commit,actualFileWait:true,currentContextControlsEffect:true});
   }finally{
    if(holder.p.exitCode===null&&!holder.p.stdin.writableEnded)holder.p.stdin.end('ROLLBACK;\n\\q\n');
    await Promise.allSettled([holder.done,...(caller?[caller.done]:[])]);
   }
  }
  assert.equal(controls.length,13);
  for(const discardFirst of [false,true]){
   sql('TRUNCATE storage.objects;');prepare();
   sql(`UPDATE public.tenant_members SET is_owner=false,role='member' WHERE tenant_id='${ids.tenant}' AND user_id='${ids.actor}';UPDATE public.tenant_members SET is_owner=true,role='owner' WHERE tenant_id='${ids.tenant}' AND user_id='${ids.target}';`);
   const remove=`SELECT set_config('request.jwt.claim.sub','${ids.target}',true);SET LOCAL ROLE authenticated;SELECT public.remove_solo_team_member('${ids.actor}','${ids.tenant}');`;
   const beforeRemove=`SELECT id FROM auth.users WHERE id='${ids.target}' FOR SHARE;SELECT user_id FROM public.tenant_members WHERE tenant_id='${ids.tenant}' AND user_id IN ('${ids.actor}','${ids.target}') ORDER BY user_id FOR UPDATE;`;
   const holder=connection(`BEGIN;SET application_name='exp08_hub_door_first';SET statement_timeout='20s';${discardFirst?discard:beforeRemove}\n\\echo EXP08_HUB_DOOR_READY`,true);let second;
   try{
    await ready(holder);if(discardFirst)assert.deepEqual(parsed(holder.read()),{ok:true,path});
    second=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';${discardFirst?remove:discard}COMMIT;`);
    assert(await blocked(second,holder),'Original discard/removal must observe the first actual transaction');
    holder.p.stdin.end((discardFirst?'':remove)+'COMMIT;\n\\q\n');const a=await holder.done,b=await second.done;
    assert.equal(a.code,0,'Original discard/removal must not deadlock: '+a.err);assert.equal(b.code,0,'Original discard/removal must not deadlock: '+b.err);
    assert.equal(parsed(discardFirst?b.out:a.out)?.removed_user_id,ids.actor,'Actual original removal receipt required');
    if(!discardFirst){const response=parsed(b.out);assert.equal(response?.ok,false);assert.equal('path' in response,false);}
    assert.equal(sql(`SELECT active_tenant_id IS NULL FROM public.profiles WHERE user_id='${ids.actor}'`),'t');
    assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE tenant_id='${ids.tenant}' AND user_id='${ids.actor}'`),'0');
    assert.equal(sql(`SELECT state FROM public.team_hub_files WHERE id='${file}'`),discardFirst?'discarded':'ready');
    assert.equal(sql('SELECT count(*) FROM public.audit_logs'),'1');
    controls.push({change:'original discard and actual removal',order:discardFirst?'discard-first':'removal-first',actualWait:true,noDeadlock:true,originalReceiptAndPointer:true});
   }finally{
    if(holder.p.exitCode===null&&!holder.p.stdin.writableEnded)holder.p.stdin.end('ROLLBACK;\n\\q\n');
    await Promise.allSettled([holder.done,...(second?[second.done]:[])]);
   }
  }
  assert.equal(controls.length,15);
  return controls;
 }finally{
  sql(roleDefinition);
  assert.equal(sql("SELECT to_jsonb(p)::text FROM pg_proc p WHERE oid='auth.role()'::regprocedure"),roleMetadata,'Restore every original Auth role-port field');
 }
}
