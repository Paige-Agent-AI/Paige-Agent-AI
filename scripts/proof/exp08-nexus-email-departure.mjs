// Runs ONLY inside the caller's isolated component database. Real original
// removal/currentness and Comms bodies, abridged dependencies as in the existing
// departure fixture. This is concurrency proof, NOT full-schema/customer proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const read=p=>readFileSync(p,'utf8').replace(/\r\n/g,'\n');
function original(file,name){const s=read(file),start=s.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=s.indexOf('$function$;',start);assert(start>=0&&end>start,name);return s.slice(start,end+11);}
export async function verifyNexusEmailDeparture(db,{actor,tenant,reply,channel}){
 const owner='e8d00000-0000-4000-8000-000000000001';
 const sql=s=>db.run(s),connections=[];
 const as=user=>`SELECT set_config('test.actor','${user}',false);SET ROLE authenticated;`;
 const remove=`${as(owner)}SELECT public.remove_solo_team_member('${actor}','${tenant}');`;
 const inspect=`${as(actor)}SELECT public.team_hub_email_draft('${tenant}','${reply}');`;
 function connect(s,interactive=false){const p=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';
  p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);
  const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});p.stdin[interactive?'write':'end'](s+'\n');
  const c={p,done,read:()=>out};connections.push(c);return c;
 }
 async function hold(statement){
  const c=connect(`BEGIN;SET statement_timeout='10s';${statement};SELECT 'email_phase_held';`,true);
  let ready=false;
  for(let i=0;i<100;i++){if(c.read().includes('email_phase_held')){ready=true;break;}if(c.p.exitCode!==null)break;await new Promise(r=>setTimeout(r,20));}
  assert(ready,'controlled native phase must actually acquire its locks');
  return{...c,release:(continuation='')=>c.p.stdin.end(`${continuation}COMMIT;\n`)};
 }
 const restore=()=>sql(`INSERT INTO public.tenant_members(user_id,tenant_id,status,role,team_hub_access,is_owner)
  VALUES('${actor}','${tenant}','active','admin',true,false);
  UPDATE public.profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';`);
 try{
  sql(`CREATE TYPE public.tenant_role AS ENUM('owner','admin','member');
   ALTER TABLE public.tenant_members ALTER COLUMN role TYPE public.tenant_role USING role::public.tenant_role;
   ALTER TABLE public.tenant_members ADD COLUMN id uuid DEFAULT gen_random_uuid(),ADD COLUMN is_owner boolean DEFAULT false,ADD COLUMN joined_at timestamptz DEFAULT now();
   CREATE UNIQUE INDEX departure_member_identity ON public.tenant_members(tenant_id,user_id);
   ALTER TABLE auth.users ADD COLUMN email text;
   CREATE TYPE public.app_role AS ENUM('admin','coach','client','user','guest');
   CREATE TABLE public.user_roles(user_id uuid,role public.app_role,UNIQUE(user_id,role));
   CREATE TABLE public.app_settings_owner(owner_email text);
   INSERT INTO public.app_settings_owner VALUES('protected@tests.invalid');
   CREATE TABLE public.audit_logs(user_id uuid,entity text,action text,entity_id uuid,data jsonb);
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT 'authenticated'::text$$;
   CREATE FUNCTION public.is_company_workspace(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
   CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
   CREATE FUNCTION public.agency_can_manage_child(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
   CREATE FUNCTION public.agency_team_role(uuid,uuid) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$;`);
  sql(original('supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql','is_tenant_owner'));
  sql(original('supabase/migrations/20270509000000_nothing_reads_the_retired_title_role.sql','map_tenant_role_to_app_role'));
  sql(original('supabase/migrations/20271115040008_exp08_team_lifecycle.sql','sync_tenant_member_to_user_roles'));
  const protection=read('supabase/migrations/20251020145501_8b37061e-d124-4d12-9907-7b62f110979b.sql');
  const start=protection.indexOf('create or replace function public.prevent_owner_admin_removal()'),end=protection.indexOf('$$;',start);assert(start>=0&&end>start);sql(protection.slice(start,end+3));
  sql(`REVOKE ALL ON FUNCTION public.sync_tenant_member_to_user_roles(),public.prevent_owner_admin_removal() FROM PUBLIC,anon,authenticated,service_role;
   GRANT EXECUTE ON FUNCTION public.sync_tenant_member_to_user_roles(),public.prevent_owner_admin_removal() TO service_role;
   REVOKE ALL ON FUNCTION public.map_tenant_role_to_app_role(public.tenant_role) FROM PUBLIC,postgres,anon,authenticated,service_role;
   GRANT EXECUTE ON FUNCTION public.map_tenant_role_to_app_role(public.tenant_role) TO postgres,PUBLIC,anon,authenticated,service_role;`);
  sql(original('supabase/migrations/20271115040008_exp08_team_lifecycle.sql','remove_solo_team_member')+
   'REVOKE ALL ON FUNCTION public.remove_solo_team_member(uuid,uuid) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION public.remove_solo_team_member(uuid,uuid) TO authenticated;');
  sql(read('supabase/migrations/20271126140008_exp08_departure_currentness.sql'));
  sql(`INSERT INTO auth.users(id,email) VALUES('${owner}','removal-owner@tests.invalid');INSERT INTO public.profiles VALUES('${owner}','${tenant}');
   INSERT INTO public.tenant_members(user_id,tenant_id,status,role,team_hub_access,is_owner) VALUES('${owner}','${tenant}','active','owner',true,true);
   UPDATE public.tenant_members SET role='admin',is_owner=false WHERE user_id='${actor}' AND tenant_id='${tenant}';`);
  // Email first: real native read holds membership/profile until its transaction
  // settles; real original removal waits, then completes and refuses fresh reads.
  const first=await hold(inspect);
  const removal=connect(`BEGIN;SET statement_timeout='10s';SET application_name='exp08_email_departure_wait';${remove}COMMIT;`);
  let waiting=false;
  for(let i=0;i<50;i++){if(sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='exp08_email_departure_wait' AND wait_event_type='Lock'").split(/\r?\n/).at(-1)==='1'){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}
  assert(waiting,'actual original removal must wait on the active native read');first.release();assert.equal((await first.done).code,0);
  const removed=await removal.done;assert.equal(removed.code,0,removed.err);assert(!removed.err.includes('40P01'));
  assert(sql(inspect).includes('"ok": false'),'after actual removal the same read must refuse');
  restore();
  // Departure first: hold its existing ordered membership phase BEFORE the
  // original writer clears the Admin profile. The email may not hold that
  // profile and wait for membership (the reviewed deadlock cycle).
  const locks=`SELECT 1 FROM auth.users WHERE id='${owner}' FOR SHARE;
   SELECT 1 FROM public.tenant_members WHERE tenant_id='${tenant}' AND user_id IN ('${actor}','${owner}') ORDER BY user_id FOR UPDATE;`;
  const departure=await hold(locks);
  const currentDefinition=JSON.parse(sql("SELECT to_json(pg_get_functiondef('public._team_hub_email_scope(public.team_hub_agent_turns)'::regprocedure))").split(/\r?\n/).find(s=>s.startsWith('"')));
  const guard=/ -- Compose with ORIGINAL departure[\s\S]*?\n PERFORM public\._comms_email_actor/;
  assert(guard.test(currentDefinition),'causal control must target the actual new lock-order composition');
  sql(currentDefinition.replace(guard,' PERFORM public._comms_email_actor'));
  const predecessor=await connect(`\\set VERBOSITY verbose\nBEGIN;SET statement_timeout='500ms';${inspect}COMMIT;`).done;
  sql(currentDefinition);
  assert.notEqual(predecessor.code,0,'without the repair the Admin read must incorrectly wait while holding its profile');
  assert(predecessor.err.includes('57014'),'the controlled predecessor must fail on the actual lock wait, not an unrelated error');
  const refused=await connect(`BEGIN;SET statement_timeout='2s';${inspect}COMMIT;`).done;
  assert.equal(refused.code,0,refused.err);assert(refused.out.includes('"ok": false'),'member wait must refuse without stale private text');
  assert(!refused.out.includes('Ready for review.'),'no private preparation while departure holds membership');
  // The SAME held phase now executes the actual original writer, not a DELETE
  // stand-in. Both locks and original writer remain inside this transaction.
  departure.release(remove);const result=await departure.done;
  assert.equal(result.code,0,result.err);assert(!result.err.includes('40P01'));
  assert(sql(inspect).includes('"ok": false'),'committed departure still refuses original context');
  assert(sql(`SELECT count(*) FROM public.messages WHERE tenant_id='${tenant}' AND (status<>'draft' OR provider_message_id IS NOT NULL)`).split(/\r?\n/).at(-1)==='0','races cause no send/effect');
  return {cases:2,originalRemoval:true,causalPredecessorRejected:true,deadlocks:0,privateAfterRemoval:false,providerEffects:0};
 }finally{for(const c of connections)if(c.p.exitCode===null){c.p.stdin.end();await c.done;} }
}
