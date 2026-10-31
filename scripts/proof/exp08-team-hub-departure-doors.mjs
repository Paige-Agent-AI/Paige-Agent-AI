// Integration group of the ORIGINAL departure proof; never a linked-project runner.
// Real: original DM door, admission helpers, removal writer and membership triggers.
// Ports: minimal Auth/profile/tenant/role inputs and channel-state changes in the owning fixture.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export async function verifyHubDoorDeparture({repo,sql,connection,ids,database}){
 const results=[];
 const files={core:'20271113850008_exp08_team_hub_collaboration.sql',lifecycle:'20271115040008_exp08_team_lifecycle.sql',agents:'20271117010008_exp08_team_hub_agents.sql',files:'20271114160008_exp08_team_hub_files.sql'};
 const text=name=>readFileSync(join(repo,'supabase/migrations',files[name]),'utf8');
 function table(file,name){const value=text(file);const start=value.indexOf('CREATE TABLE IF NOT EXISTS public.'+name+' (');const end=value.indexOf('\n);',start);assert(start>=0&&end>start,name);return value.slice(start,end+3);}
 function original(file,name,signature,hash,isPublic=false){
  const value=text(file),start=value.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=value.indexOf('$$;',start);
  assert(start>=0&&end>start,name);sql(value.slice(start,end+3));
  const revoke=value.indexOf('REVOKE ALL ON FUNCTION public.'+name+'('+signature+')',end),revokeEnd=value.indexOf(';',revoke);
  assert(revoke>end&&revokeEnd>revoke,name+' original ACL');sql(value.slice(revoke,revokeEnd+1));
  if(isPublic){const grant=value.indexOf('GRANT EXECUTE ON FUNCTION public.'+name+'('+signature+')',revokeEnd),grantEnd=value.indexOf(';',grant);assert(grant>revokeEnd&&grantEnd>grant);sql(value.slice(grant,grantEnd+1));}
  assert.equal(sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.${name}(${signature})'::regprocedure`),hash,name+' must be actual current source');
 }
 sql(`TRUNCATE public.tenant_members,public.profiles,public.audit_logs,public.user_roles,auth.users,public.app_settings_owner;
  ALTER TABLE public.tenants ADD COLUMN account_type text NOT NULL DEFAULT 'standalone',ADD COLUMN parent_tenant_id uuid;
  ALTER TABLE public.tenant_members ADD COLUMN team_hub_access boolean NOT NULL DEFAULT true;
  ALTER TABLE public.profiles ADD COLUMN suspended_by uuid,
   ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
   ADD CONSTRAINT profiles_suspended_by_fkey FOREIGN KEY(suspended_by) REFERENCES auth.users(id);`);
 for(const name of ['team_hub_channels','team_hub_channel_members','team_hub_messages','team_hub_message_mentions'])sql(table('core',name));
 for(const [file,name] of [['files','team_hub_files'],['agents','team_hub_agent_turns']])sql(table(file,name));
 const core=text('core'),indexStart=core.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS team_hub_channels_dm_key');
 assert(indexStart>0);sql(core.slice(indexStart,core.indexOf(';',indexStart)+1));
 for(const name of ['team_hub_channels','team_hub_channel_members','team_hub_messages','team_hub_message_mentions','team_hub_files','team_hub_agent_turns'])sql(`ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.${name} FROM PUBLIC,anon,authenticated,service_role;`);
 original('core','_team_hub_is_active','uuid,uuid','c290399dc80d95d16116a0f88b0abd8c');
 original('lifecycle','_team_hub_participates','uuid,uuid','4f2fb69d09f7b362027edf195a37da83');
 original('lifecycle','_team_hub_hold_seats','uuid,uuid[]','af0dee455ee0413ee5b907505ff89acd');
 original('lifecycle','_team_hub_refusal','uuid','b6ee98245fdbb9e0229547061a9391d2');
 sql(readFileSync(join(repo,'supabase/migrations/20271126100008_exp08_team_hub_actor_lifecycle.sql'),'utf8'));
 sql(readFileSync(join(repo,'scripts/proof/exp08-team-hub-identity-currentness-patch.sql'),'utf8'));
 original('agents','_team_hub_member_scope_guard','','65ddf7cc5991b4a39030abdd814761d6');
 original('agents','_team_hub_seat_ended','','b254183d2125e7f18bd1230641066b09');
 original('lifecycle','_team_hub_seat_started','','f37dd473a288f572f694b63ecb8f1666');
 original('lifecycle','team_hub_open_dm','uuid,uuid','14363512d49614142c3886a17dea11f6',true);
 original('core','_team_hub_visible','uuid,uuid,uuid','28a7e5c90f2a29b19b4481c4850a414f');
 original('lifecycle','team_hub_add_members','uuid,uuid,uuid[]','25bac1def127e3998036368329e4c80d',true);
 original('agents','team_hub_leave_channel','uuid,uuid','4db9d98bdad81856480ef0594ca88c0a',true);
 const memberAddPatch=readFileSync(join(repo,'scripts/proof/exp08-team-hub-member-add-currentness-patch.sql'),'utf8').replace(/\r\n/g,'\n');
 const memberAddMetadata=sql("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='public.team_hub_add_members(uuid,uuid,uuid[])'::regprocedure");
 sql(memberAddPatch);sql(memberAddPatch);
 assert.equal(sql("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='public.team_hub_add_members(uuid,uuid,uuid[])'::regprocedure"),memberAddMetadata,'original member-add OID/ACL/all metadata conserved on patch/replay');
 sql(`CREATE TRIGGER team_hub_member_scope BEFORE INSERT OR UPDATE OF channel_id,tenant_id,user_id ON public.team_hub_channel_members FOR EACH ROW EXECUTE FUNCTION public._team_hub_member_scope_guard();
  CREATE TRIGGER team_hub_seat_ended AFTER DELETE OR UPDATE OF status ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public._team_hub_seat_ended();
  CREATE TRIGGER team_hub_seat_started AFTER INSERT OR UPDATE OF status ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public._team_hub_seat_started();`);
 const reset=()=>sql(`TRUNCATE public.team_hub_channel_members,public.team_hub_message_mentions,public.team_hub_files,public.team_hub_agent_turns,public.team_hub_messages,public.team_hub_channels,public.tenant_members,public.profiles,public.audit_logs,public.user_roles,auth.users,public.tenants,public.app_settings_owner;
  INSERT INTO public.tenants(id) VALUES('${ids.tenant}'),('${ids.other}');
  INSERT INTO auth.users(id,email) VALUES('${ids.actor}','test-actor@tests.invalid'),('${ids.target}','test-target@tests.invalid');
  INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${ids.actor}','${ids.tenant}'),('${ids.target}','${ids.tenant}');
  INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES('${ids.tenant}','${ids.actor}','active',true,'owner'),('${ids.tenant}','${ids.target}','active',false,'member');`);
 const invoke=(actor,target=ids.target)=>`SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;SELECT public.team_hub_open_dm('${ids.tenant}','${target}');`;
 const removal=`SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.remove_solo_team_member('${ids.target}','${ids.tenant}');`;
 const parsed=out=>out.split(/\r?\n/).filter(s=>s.startsWith('{')).map(JSON.parse).at(-1);
 const call=(actor=ids.actor,target=ids.target)=>parsed(sql('BEGIN;'+invoke(actor,target)+'COMMIT;'));
 const shape=()=>JSON.parse(sql("SELECT jsonb_build_object('channels',(SELECT count(*) FROM public.team_hub_channels),'members',(SELECT count(*) FROM public.team_hub_channel_members),'audits',(SELECT count(*) FROM public.audit_logs))"));
 const wait=()=>new Promise(resolve=>setTimeout(resolve,20));
 async function ready(holder){for(let i=0;i<250;i++){if(holder.read().includes('EXP08_HUB_DOOR_READY'))return;if(holder.p.exitCode!==null)throw Error('Original door holder exited before readiness: '+JSON.stringify(await holder.done));await wait();}throw Error('Original door readiness not observed');}
 async function blocked(waiter,holder,waiterName='exp08_hub_door_second',holderName='exp08_hub_door_first'){for(let i=0;i<30;i++){
   const yes=sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.datname='${database}' AND w.application_name='${waiterName}' AND h.application_name='${holderName}' AND w.wait_event_type='Lock')`)==='t';
   if(yes)return true;if(waiter.p.exitCode!==null)return false;await wait();
  }return false;}
 async function race(change,doorFirst,person=ids.target){
  reset();
  const effect=change==='remove'?removal:change==='ban'?`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id='${person}';`:`DELETE FROM auth.users WHERE id='${person}';`;
  const first=connection(`BEGIN;SET application_name='exp08_hub_door_first';SET statement_timeout='20s';${doorFirst?invoke(ids.actor):effect}\n\\echo EXP08_HUB_DOOR_READY`,true);
  let second;
  try{
   await ready(first);
   if(doorFirst)assert.equal(parsed(first.read())?.ok,true,'Original DM must actually have opened before holding its transaction');
   second=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';${doorFirst?effect:invoke(ids.actor)}COMMIT;`);
   assert.equal(await blocked(second,first),true,'Original '+change+'/'+(doorFirst?'DM-first':'effect-first')+' must observe its actual blocking transaction');
   first.p.stdin.end('COMMIT;\n\\q\n');
   const a=await first.done,b=await second.done;
   assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
   if(!doorFirst){const value=parsed(b.out);assert.equal(value?.ok,false,JSON.stringify(value));assert.deepEqual(shape(),{channels:0,members:0,audits:change==='remove'?1:0});}
   if(change==='remove'){
    assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE tenant_id='${ids.tenant}' AND user_id='${ids.target}'`),'0');
    if(doorFirst)assert.deepEqual(shape(),{channels:1,members:1,audits:1},'Original seat-ended trigger removes the departed participant, retaining original history');
   }
   const followup=call();assert.equal(followup.ok,false,'A later original DM call must refuse changed identity or membership');
   results.push({change,order:doorFirst?'DM-first':'effect-first',person:person===ids.actor?'actor':'target',actualBlockingPair:true,followupRefused:true});
  }finally{
   if(first.p.exitCode===null&&!first.p.stdin.writableEnded)first.p.stdin.end('ROLLBACK;\n\\q\n');
   await Promise.allSettled([first.done,...(second?[second.done]:[])]);
  }
 }
 reset();const positive=call();assert.equal(positive.ok,true);assert.deepEqual(shape(),{channels:1,members:2,audits:0});results.push({change:'original DM positive',originalChannel:positive.channel_id});
 for(const change of ['ban','delete'])for(const person of [ids.actor,ids.target])for(const first of [true,false])await race(change,first,person);
 for(const first of [true,false])await race('remove',first);
 reset();
 const first=connection(`BEGIN;SET application_name='exp08_hub_door_first';${invoke(ids.actor)}\n\\echo EXP08_HUB_DOOR_READY`,true);let second;
 try{
  await ready(first);second=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';${invoke(ids.target,ids.actor)}COMMIT;`);
  assert(await blocked(second,first),'Opposing original DM creation must wait for the same unique pair');
  first.p.stdin.end('COMMIT;\n\\q\n');const a=await first.done,b=await second.done;assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
  assert.equal(parsed(a.out)?.channel_id,parsed(b.out)?.channel_id);assert.deepEqual(shape(),{channels:1,members:2,audits:0});results.push({change:'opposing original DMs',actualUniquePairWait:true,oneOriginalChannel:true});
 }finally{if(first.p.exitCode===null&&!first.p.stdin.writableEnded)first.p.stdin.end('ROLLBACK;\n\\q\n');await Promise.allSettled([first.done,...(second?[second.done]:[])]);}
 reset();sql(`INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES('${ids.other}','${ids.actor}','active',false,'member');UPDATE public.profiles SET active_tenant_id='${ids.other}' WHERE user_id='${ids.actor}';`);
 assert.equal(call().code,'scope_changed');assert.deepEqual(shape(),{channels:0,members:0,audits:0});results.push({change:'actual resolver workspace switch',refused:true});
 reset();sql(`UPDATE public.tenant_members SET tenant_id='${ids.other}' WHERE user_id='${ids.target}';`);assert.equal(call().code,'invalid');assert.deepEqual(shape(),{channels:0,members:0,audits:0});results.push({change:'foreign DM target',refused:true});
 const saved=sql("SELECT pg_get_functiondef('public._team_hub_hold_seats(uuid,uuid[])'::regprocedure)").replace(/\r\n/g,'\n');
 for(const [name,replace,change] of [['Auth lock removed','FOR SHARE OF m','ban'],['membership lock removed','FOR SHARE OF u','remove']]){
  try{
   assert.equal(saved.split('FOR SHARE OF m,u').length,2);sql(saved.replace('FOR SHARE OF m,u',replace));
   await assert.rejects(()=>race(change,true),/must observe its actual blocking transaction/,name+' must fail on the actual missing wait');
   results.push({change:'causal mutant: '+name,killed:true});
  }finally{sql(saved);}
 }
 // Recheck the ORIGINAL caller after a real target lock wait; targets alone are not authority.
 reset();
 const channel='e8000000-0000-4000-8000-000000084000';
 sql(`INSERT INTO public.team_hub_channels(id,tenant_id,kind,name,visibility,created_by) VALUES('${channel}','${ids.tenant}','channel','proof-private','private','${ids.actor}');
  INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES('${channel}','${ids.tenant}','${ids.actor}','${ids.actor}');`);
 const targetHolder=connection(`BEGIN;SET application_name='exp08_hub_door_first';SELECT id FROM auth.users WHERE id='${ids.target}' FOR UPDATE;\n\\echo EXP08_HUB_DOOR_READY`,true);let memberAdd;
 try{
  await ready(targetHolder);
  memberAdd=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.team_hub_add_members('${ids.tenant}','${channel}',ARRAY['${ids.target}'::uuid]);COMMIT;`);
  assert(await blocked(memberAdd,targetHolder),'Original member-add must actually wait on its target identity');
  sql(`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id='${ids.actor}';`);
  console.log(JSON.stringify({phase:'original-hub-add-current-actor',targetWaitObserved:true,actorBanCommittedBeforeTargetRelease:true}));
  targetHolder.p.stdin.end('COMMIT;\n\\q\n');const a=await targetHolder.done,b=await memberAdd.done;assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
  const observed=parsed(b.out),targetMemberships=sql(`SELECT count(*) FROM public.team_hub_channel_members WHERE channel_id='${channel}' AND user_id='${ids.target}'`);
  console.log(JSON.stringify({phase:'original-hub-add-current-actor-readback',response:observed,targetMemberships:Number(targetMemberships)}));
  assert.equal(observed?.ok,false,'Actor banned during the original member-add wait must refuse the membership effect');
  assert.equal(targetMemberships,'0','Refused member-add must not publish a private membership');
  results.push({change:'original member-add actor ban after admission',actualTargetWait:true,currentActorRefused:true});
 }finally{if(targetHolder.p.exitCode===null&&!targetHolder.p.stdin.writableEnded)targetHolder.p.stdin.end('ROLLBACK;\n\\q\n');await Promise.allSettled([targetHolder.done,...(memberAdd?[memberAdd.done]:[])]);}
 for(const role of ['member','admin','owner']){
  reset();sql(`UPDATE public.tenant_members SET role='${role}',is_owner=${role==='owner'} WHERE user_id='${ids.actor}';
   INSERT INTO public.team_hub_channels(id,tenant_id,kind,name,visibility,created_by) VALUES('${channel}','${ids.tenant}','channel','proof-private','private','${ids.actor}');
   INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES('${channel}','${ids.tenant}','${ids.actor}','${ids.actor}');`);
  const add=()=>parsed(sql(`BEGIN;SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.team_hub_add_members('${ids.tenant}','${channel}',ARRAY['${ids.target}'::uuid]);COMMIT;`));
  assert.deepEqual(add(),{ok:true,added:1},role+' retains original private-channel permission');
  assert.deepEqual(add(),{ok:true,added:0},'Duplicate original membership is not another effect');
  assert.equal(sql(`SELECT count(*) FROM public.team_hub_channel_members WHERE channel_id='${channel}' AND user_id='${ids.target}'`),'1');
  results.push({change:'original member-add permitted '+role,addedOnce:true,duplicateAddedZero:true});
 }
 async function profileInsertionRace(){
 reset();sql(`DELETE FROM public.profiles WHERE user_id='${ids.actor}';
  INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role,joined_at) VALUES('${ids.other}','${ids.actor}','active',false,'member',now()+interval '1 day');
  INSERT INTO public.team_hub_channels(id,tenant_id,kind,name,visibility,created_by) VALUES('${channel}','${ids.tenant}','channel','proof-private','private','${ids.actor}');
  INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES('${channel}','${ids.tenant}','${ids.actor}','${ids.actor}');`);
 const channelHolder=connection(`BEGIN;SET application_name='exp08_hub_door_first';SELECT id FROM public.team_hub_channels WHERE id='${channel}' FOR UPDATE;\n\\echo EXP08_HUB_DOOR_READY`,true);let missingProfileAdd,insertion;
 try{
  await ready(channelHolder);
  missingProfileAdd=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.team_hub_add_members('${ids.tenant}','${channel}',ARRAY['${ids.target}'::uuid]);COMMIT;`);
  assert(await blocked(missingProfileAdd,channelHolder),'Missing-profile call must reach its actual channel wait under the original resolver fallback');
  insertion=connection(`BEGIN;SET application_name='exp08_hub_profile_insert';SET statement_timeout='20s';INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${ids.actor}','${ids.other}');COMMIT;`);
  const insertWait=await blocked(insertion,missingProfileAdd,'exp08_hub_profile_insert','exp08_hub_door_second');
  channelHolder.p.stdin.end('COMMIT;\n\\q\n');const a=await channelHolder.done,b=await missingProfileAdd.done,c=await insertion.done;assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);assert.equal(c.code,0,c.err);
  console.log(JSON.stringify({phase:'original-member-add-missing-profile',profileInsertWaitObserved:insertWait,response:parsed(b.out),targetMemberships:Number(sql(`SELECT count(*) FROM public.team_hub_channel_members WHERE channel_id='${channel}' AND user_id='${ids.target}'`))}));
  assert.equal(insertWait,true,'Missing actor profile must preserve workspace synchronization through the existing identity FK');
  assert.deepEqual(parsed(b.out),{ok:true,added:1},'Supported membership fallback completes before the later workspace insertion');
  assert.equal(sql(`SELECT active_tenant_id FROM public.profiles WHERE user_id='${ids.actor}'`),ids.other);
  return {change:'missing-profile fallback and later profile insertion',actualChannelWait:true,profileInsertionSerializedAfterEffect:true};
 }finally{if(channelHolder.p.exitCode===null&&!channelHolder.p.stdin.writableEnded)channelHolder.p.stdin.end('ROLLBACK;\n\\q\n');await Promise.allSettled([channelHolder.done,...(missingProfileAdd?[missingProfileAdd.done]:[]),...(insertion?[insertion.done]:[])]);}
 }
 results.push(await profileInsertionRace());
 for(const commit of [true,false]){
  reset();sql(`DELETE FROM public.profiles WHERE user_id='${ids.actor}';
   INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role,joined_at) VALUES('${ids.other}','${ids.actor}','active',false,'member',now()+interval '1 day');
   INSERT INTO public.team_hub_channels(id,tenant_id,kind,name,visibility,created_by) VALUES('${channel}','${ids.tenant}','channel','proof-private','private','${ids.actor}');
   INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES('${channel}','${ids.tenant}','${ids.actor}','${ids.actor}');`);
  const first=connection(`BEGIN;SET application_name='exp08_hub_door_first';INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${ids.actor}','${ids.other}');\n\\echo EXP08_HUB_DOOR_READY`,true);let second;
  try{
   await ready(first);second=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.team_hub_add_members('${ids.tenant}','${channel}',ARRAY['${ids.target}'::uuid]);COMMIT;`);
   assert(await blocked(second,first),'Original member-add must actually wait on the existing profile FK insertion');
   first.p.stdin.end((commit?'COMMIT':'ROLLBACK')+';\n\\q\n');const a=await first.done,b=await second.done;assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
   assert.deepEqual(parsed(b.out),commit?{ok:false,code:'scope_changed'}:{ok:true,added:1});
   assert.equal(sql(`SELECT count(*) FROM public.team_hub_channel_members WHERE channel_id='${channel}' AND user_id='${ids.target}'`),commit?'0':'1');
   results.push({change:'profile insertion first',committed:commit,actualFkWait:true,currentWorkspaceRechecked:true});
  }finally{if(first.p.exitCode===null&&!first.p.stdin.writableEnded)first.p.stdin.end('ROLLBACK;\n\\q\n');await Promise.allSettled([first.done,...(second?[second.done]:[])]);}
 }
 const patchedAdd=sql("SELECT pg_get_functiondef('public.team_hub_add_members(uuid,uuid,uuid[])'::regprocedure)").replace(/\r\n/g,'\n');
 const parentHold='PERFORM u.id FROM auth.users u WHERE u.id=ANY(actor||p_user_ids) ORDER BY u.id FOR UPDATE;';
 try{
  assert.equal(patchedAdd.split(parentHold).length,2);sql(patchedAdd.replace(parentHold,'PERFORM 1;'));
  await assert.rejects(profileInsertionRace,/Missing actor profile must preserve workspace synchronization/,'Identity-parent hold must be causal, not just source text');
  results.push({change:'causal mutant: identity parent hold removed',killed:true});
 }finally{sql(patchedAdd);}
 const fkSnapshot=()=>sql("SELECT jsonb_build_object('writer',(SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid='public.team_hub_add_members(uuid,uuid,uuid[])'::regprocedure),'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c WHERE c.conrelid='public.profiles'::regclass))");
 const beforeFk=fkSnapshot();
 assert.throws(()=>sql('BEGIN;ALTER TABLE public.profiles DROP CONSTRAINT profiles_user_id_fkey;'+memberAddPatch),/original profile identity FK drift/,'Missing synchronization FK must refuse the actual patch');
 assert.equal(fkSnapshot(),beforeFk,'Failed FK admission preserves original writer and exact constraint metadata');
 results.push({change:'missing profile identity FK',refused:true,writerAndConstraintMetadataConserved:true});
 for(const routine of ['RI_FKey_check_ins','RI_FKey_check_upd']){
  const trigger=sql(`SELECT quote_ident(t.tgname) FROM pg_trigger t JOIN pg_constraint c ON c.oid=t.tgconstraint JOIN pg_proc p ON p.oid=t.tgfoid WHERE c.conrelid='public.profiles'::regclass AND c.confrelid='auth.users'::regclass AND t.tgrelid=c.conrelid AND p.proname='${routine}' AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='user_id')]::smallint[]`);
  assert(trigger&&!trigger.includes('\n'),'Exactly one existing profile RI checking trigger required');
  const riSnapshot=()=>sql("SELECT jsonb_build_object('writer',(SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid='public.team_hub_add_members(uuid,uuid,uuid[])'::regprocedure),'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t JOIN pg_constraint c ON c.oid=t.tgconstraint WHERE c.conrelid='public.profiles'::regclass AND c.confrelid='auth.users'::regclass))");
  const before=riSnapshot();
  assert.throws(()=>sql('BEGIN;ALTER TABLE public.profiles DISABLE TRIGGER '+trigger+';'+memberAddPatch),/original profile identity FK drift/,'Inactive '+routine+' must refuse the actual synchronization-dependent patch');
  assert.equal(riSnapshot(),before,'Failed inactive-RI admission preserves every trigger/writer field');
  results.push({change:'inactive profile RI trigger '+routine,refused:true,triggerAndWriterMetadataConserved:true});
 }
 const setupPrivate=(id,actor)=>sql(`INSERT INTO public.team_hub_channels(id,tenant_id,kind,name,visibility,created_by) VALUES('${id}','${ids.tenant}','channel','proof-private','private','${actor}');INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES('${id}','${ids.tenant}','${actor}','${actor}');`);
 const addCall=(actor,ch,target)=>`SELECT set_config('request.jwt.claim.sub','${actor}',true);SET LOCAL ROLE authenticated;SELECT public.team_hub_add_members('${ids.tenant}','${ch}',ARRAY['${target}'::uuid]);`;
 reset();const otherChannel='e8000000-0000-4000-8000-000000084001';setupPrivate(channel,ids.actor);setupPrivate(otherChannel,ids.target);
 const addFirst=connection(`BEGIN;SET application_name='exp08_hub_door_first';${addCall(ids.actor,channel,ids.target)}\n\\echo EXP08_HUB_DOOR_READY`,true);let opposite;
 try{
  await ready(addFirst);opposite=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';${addCall(ids.target,otherChannel,ids.actor)}COMMIT;`);
  assert(await blocked(opposite,addFirst),'Opposing member-add calls must use the same ordered identity parents');
  addFirst.p.stdin.end('COMMIT;\n\\q\n');const a=await addFirst.done,b=await opposite.done;assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);assert.deepEqual(parsed(a.out),{ok:true,added:1});assert.deepEqual(parsed(b.out),{ok:true,added:1});
  assert.deepEqual(shape(),{channels:2,members:4,audits:0});results.push({change:'opposing member-add identities',actualWait:true,ownerAndMemberBothAuthorized:true});
 }finally{if(addFirst.p.exitCode===null&&!addFirst.p.stdin.writableEnded)addFirst.p.stdin.end('ROLLBACK;\n\\q\n');await Promise.allSettled([addFirst.done,...(opposite?[opposite.done]:[])]);}
 for(const addBefore of [true,false]){
  reset();setupPrivate(channel,ids.actor);
  const add=addCall(ids.actor,channel,ids.target);
  const first=connection(`BEGIN;SET application_name='exp08_hub_door_first';${addBefore?add:removal}\n\\echo EXP08_HUB_DOOR_READY`,true);let second;
  try{
   await ready(first);second=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';${addBefore?removal:add}COMMIT;`);
   assert(await blocked(second,first),'Actual member-add/removal transactions must serialize');first.p.stdin.end('COMMIT;\n\\q\n');const a=await first.done,b=await second.done;assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
   assert.equal(parsed(addBefore?a.out:b.out)?.ok,addBefore);assert.deepEqual(shape(),{channels:1,members:1,audits:1});
   assert.equal(sql(`SELECT count(*) FROM public.tenant_members WHERE tenant_id='${ids.tenant}' AND user_id='${ids.target}'`),'0');results.push({change:'member-add and original removal',order:addBefore?'add-first':'removal-first',actualWait:true,departedMembershipAbsent:true});
  }finally{if(first.p.exitCode===null&&!first.p.stdin.writableEnded)first.p.stdin.end('ROLLBACK;\n\\q\n');await Promise.allSettled([first.done,...(second?[second.done]:[])]);}
 }
 assert.equal(results.length,30);
 const third='e8000000-0000-4000-8000-000000080100';
 const leave=`SELECT set_config('request.jwt.claim.sub','${ids.actor}',true);SET LOCAL ROLE authenticated;SELECT public.team_hub_leave_channel('${ids.tenant}','${channel}');`;
 function prepareMemberChange(change){
  reset();setupPrivate(channel,ids.actor);
  if(change==='workspace')sql(`INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role,joined_at) VALUES('${ids.other}','${ids.actor}','active',false,'member',now()+interval '1 day');`);
  if(change==='leave'||change==='remove-actor'){
   sql(`INSERT INTO auth.users(id,email) VALUES('${third}','test-other-owner@tests.invalid');
    INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${third}','${ids.tenant}');
    INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES('${ids.tenant}','${third}','active',true,'owner');`);
   if(change==='leave')sql(`INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES('${channel}','${ids.tenant}','${third}','${third}');`);
  }
  if(change==='access'||change==='remove-actor')sql(`UPDATE public.tenant_members SET role='member',is_owner=false WHERE tenant_id='${ids.tenant}' AND user_id='${ids.actor}';`);
 }
 const memberChanges={
  workspace:`UPDATE public.profiles SET active_tenant_id='${ids.other}' WHERE user_id='${ids.actor}';`,
  leave,lastleave:leave,
  archive:`UPDATE public.team_hub_channels SET archived_at=clock_timestamp() WHERE id='${channel}';`,
  access:`UPDATE public.tenant_members SET team_hub_access=false WHERE tenant_id='${ids.tenant}' AND user_id='${ids.actor}';`,
  'remove-actor':`SELECT set_config('request.jwt.claim.sub','${third}',true);SET LOCAL ROLE authenticated;SELECT public.remove_solo_team_member('${ids.actor}','${ids.tenant}');`,
 };
 const refusalCodes={workspace:'scope_changed',leave:'not_found',lastleave:'not_found',archive:'not_found',access:'conversations_off','remove-actor':'not_member'};
 async function changeDuringTargetWait(change,commit){
  prepareMemberChange(change);
  const holder=connection(`BEGIN;SET application_name='exp08_hub_door_first';SELECT id FROM auth.users WHERE id='${ids.target}' FOR UPDATE;\n\\echo EXP08_HUB_DOOR_READY`,true);let caller;
  try{
   await ready(holder);caller=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';${addCall(ids.actor,channel,ids.target)}COMMIT;`);
   assert(await blocked(caller,holder),'Member-add must actually wait before '+change+' changes');
   const effect=sql('BEGIN;'+memberChanges[change]+(commit?'COMMIT;':'ROLLBACK;'));
   if(change==='leave'||change==='lastleave')assert.equal(parsed(effect)?.ok,true,'The original leave writer must execute');
   holder.p.stdin.end('COMMIT;\n\\q\n');const a=await holder.done,b=await caller.done;assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
   assert.deepEqual(parsed(b.out),commit?{ok:false,code:refusalCodes[change]}:{ok:true,added:1},'Committed '+change+' must refuse; rollback must preserve valid member-add');
   assert.equal(sql(`SELECT count(*) FROM public.team_hub_channel_members WHERE channel_id='${channel}' AND user_id='${ids.target}'`),commit?'0':'1','Membership effect must match the actual committed state');
   return {change:'member-add during '+change,committed:commit,actualTargetWait:true,currentStateControlsEffect:true};
  }finally{if(holder.p.exitCode===null&&!holder.p.stdin.writableEnded)holder.p.stdin.end('ROLLBACK;\n\\q\n');await Promise.allSettled([holder.done,...(caller?[caller.done]:[])]);}
 }
 for(const change of Object.keys(memberChanges))for(const commit of [true,false])results.push(await changeDuringTargetWait(change,commit));
 async function holdAfterAdd(change){
  prepareMemberChange(change);
  const holder=connection(`BEGIN;SET application_name='exp08_hub_door_first';${addCall(ids.actor,channel,ids.target)}\n\\echo EXP08_HUB_DOOR_READY`,true);let updater;
  try{
   await ready(holder);assert.deepEqual(parsed(holder.read()),{ok:true,added:1});
   updater=connection(`BEGIN;SET application_name='exp08_hub_door_second';SET statement_timeout='20s';${memberChanges[change]}COMMIT;`);
   assert(await blocked(updater,holder),'Authorized member-add must hold '+change+' until its original transaction commits');
   holder.p.stdin.end('COMMIT;\n\\q\n');const a=await holder.done,b=await updater.done;assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
   assert.equal(sql(`SELECT count(*) FROM public.team_hub_channel_members WHERE channel_id='${channel}' AND user_id='${ids.target}'`),'1');
   return {change:'member-add first then '+change,actualWait:true,sourceHeldThroughCommit:true};
  }finally{if(holder.p.exitCode===null&&!holder.p.stdin.writableEnded)holder.p.stdin.end('ROLLBACK;\n\\q\n');await Promise.allSettled([holder.done,...(updater?[updater.done]:[])]);}
 }
 for(const change of ['workspace','archive','leave'])results.push(await holdAfterAdd(change));
 const currentAdd=sql("SELECT pg_get_functiondef('public.team_hub_add_members(uuid,uuid,uuid[])'::regprocedure)").replace(/\r\n/g,'\n');
 for(const [name,oldSpan,newSpan,exercise,pattern] of [
  ['profile hold removed','PERFORM 1 FROM public.profiles current_actor_profile WHERE current_actor_profile.user_id=actor FOR SHARE;','PERFORM 1;',()=>holdAfterAdd('workspace'),/must hold workspace/],
  ['channel hold removed',"AND c.visibility='private' AND c.archived_at IS NULL FOR SHARE;", "AND c.visibility='private' AND c.archived_at IS NULL;",()=>holdAfterAdd('archive'),/must hold archive/],
  ['late workspace check removed',"refusal:=public._team_hub_refusal(p_expected_tenant);\n IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;",'PERFORM 1;',()=>changeDuringTargetWait('workspace',true),/Committed workspace must refuse/],
 ]){
  try{assert.equal(currentAdd.split(oldSpan).length,2,name+' exactly one source span');sql(currentAdd.replace(oldSpan,newSpan));await assert.rejects(exercise,pattern,name+' must be causal');results.push({change:'causal mutant: '+name,killed:true});}
  finally{sql(currentAdd);}
 }
 assert.equal(results.length,48);
 const catalogue=JSON.parse(sql("SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'body',md5(p.prosrc),'owner',p.proowner::regrole::text,'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl) FROM pg_proc p WHERE p.oid='public.team_hub_add_members(uuid,uuid,uuid[])'::regprocedure"));
 return {controls:results,catalogue};
}
