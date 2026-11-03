// Original publication + original catalog retirement lock, same disposable
// component database. Projection and surrounding tables are abridged; never
// full-schema, authenticated, archive execution or customer evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const read=p=>readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const literal=s=>`'${s.replaceAll("'","''")}'`;
export async function verifyNexusEmailRetirement(db,{actor,tenant,channel}){
 const sql=s=>db.run(s),scalar=s=>sql(s).split(/\r?\n/).filter(x=>x!=='SET'&&x!=='RESET').at(-1);
 const connections=[];
 function connection(text,interactive=false){const p=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);
  const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});p.stdin[interactive?'write':'end'](text+'\n');const c={p,done,read:()=>out,errors:()=>err};connections.push(c);return c;}
 async function hold(text){const c=connection(`BEGIN;SET statement_timeout='10s';${text};SELECT 'retirement_phase_held';`,true);let held=false;
  for(let i=0;i<100;i++){if(c.read().includes('retirement_phase_held')){held=true;break;}if(c.p.exitCode!==null)break;await new Promise(r=>setTimeout(r,20));}
  assert(held,'native phase must actually acquire its locks: '+c.errors());return{...c,release:(continuation='')=>c.p.stdin.end(`${continuation}COMMIT;\n`)};}
 const claim=`SELECT set_config('test.actor','${actor}',false);SET ROLE authenticated;`;
 function prepare(){const source=scalar('SELECT gen_random_uuid()'),turn=scalar('SELECT gen_random_uuid()'),request=scalar('SELECT gen_random_uuid()');
  const token='original-email-publication-'+turn;
  const prepared=scalar(`INSERT INTO public.team_hub_messages(id,tenant_id,channel_id,author_user_id,author_kind,body) VALUES('${source}','${tenant}','${channel}','${actor}','user','Prepare another unsent update.');
   INSERT INTO public.team_hub_agent_turns(id,tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash,accepted_at)
   VALUES('${turn}','${tenant}','${channel}','${actor}','${source}','nexus','dm',encode(sha256(convert_to('${token}','UTF8')),'hex'),clock_timestamp());
   SELECT public.team_hub_stage_email_draft('${turn}',encode(sha256(convert_to('${token}','UTF8')),'hex'),'Project update','Ready for review.');`);
  assert.equal(JSON.parse(prepared).ok,true,'each original accepted turn must actually stage its own preparation');
  return{turn,request,invoke:`${claim}SELECT public.team_hub_post_agent_message('${tenant}','${channel}','nexus','Prepared unsent update.','${request}',NULL,'${source}','dm','${token}');`};}
 try{
  sql(`INSERT INTO public.tenant_members(user_id,tenant_id,status,role,team_hub_access,is_owner) VALUES('${actor}','${tenant}','active','admin',true,false);
   UPDATE public.profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';
   ALTER TABLE public.team_hub_messages ALTER COLUMN id SET DEFAULT gen_random_uuid();
   ALTER TABLE public.team_hub_messages ADD COLUMN body text,ADD COLUMN parent_message_id uuid,ADD COLUMN client_request_id uuid,ADD COLUMN asked_in_message_id uuid,ADD COLUMN created_at timestamptz DEFAULT now();
   ALTER TABLE public.team_hub_agent_turns ADD COLUMN read_context jsonb;
   CREATE TABLE public.paige_pending_confirmations(id uuid);
   CREATE TABLE public.team_hub_message_cards(message_id uuid);
   CREATE FUNCTION public._team_hub_message_json(m public.team_hub_messages) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('id',m.id,'body',m.body)$$;`);
  // The unchanged ORIGINAL admission helpers, not an always-allowed gate.
  for(const [file,name] of [['20271113850008_exp08_team_hub_collaboration.sql','_team_hub_trim'],['20271115040008_exp08_team_lifecycle.sql','_team_hub_refusal']]){
   const s=read('supabase/migrations/'+file),start=s.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=s.indexOf('$$;',start);assert(start>=0&&end>start);sql(s.slice(start,end+3));
  }
  const originals=JSON.parse(read('supabase/tests/fixtures/exp08-nexus-email-original-publication.json'));
  for(const original of originals){sql(original.definition);assert.equal(scalar(`SELECT md5(pg_get_functiondef('public.${original.signature}'::regprocedure))`),original.full_md5,'actual production definition must reproduce exactly');}
  sql('REVOKE ALL ON FUNCTION public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text) TO authenticated;');
  const first=prepare(),publication=await hold(first.invoke);assert(publication.read().includes('"ok": true'),'actual publication succeeds before retirement');
  const retirement=connection("BEGIN;SET application_name='exp08_email_retirement_wait';SET statement_timeout='10s';SELECT public.operator_lock_retirement_scope();COMMIT;");
  let waiting=false;for(let i=0;i<100;i++){if(scalar("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='exp08_email_retirement_wait' AND wait_event_type='Lock'")==='1'){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}
  assert(waiting,'original retirement must wait behind completed publication authority');publication.release();assert.equal((await publication.done).code,0);
  const retired=await retirement.done;assert.equal(retired.code,0,retired.err);assert(!retired.err.includes('40P01'));
  const second=prepare(),phase=await hold('LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE');
  const denied=await connection(`\\set VERBOSITY verbose\nBEGIN;SET statement_timeout='2s';${second.invoke}COMMIT;`).done;
  assert.notEqual(denied.code,0,'publication must refuse while retirement owns its first exclusion');assert(denied.err.includes('42501'),denied.err);
  // Continue the actual ORIGINAL retirement function in the SAME held phase.
  phase.release('SELECT public.operator_lock_retirement_scope();');const finished=await phase.done;assert.equal(finished.code,0,finished.err);assert(!finished.err.includes('40P01'));
  assert.equal(scalar(`SELECT count(*) FROM public.team_hub_messages WHERE client_request_id='${second.request}'`),'0','refused original publication leaves no private message');
  assert.equal(scalar(`SELECT posted_message_id IS NULL AND consumed_at IS NULL FROM public.team_hub_agent_turns WHERE id='${second.turn}'`),'t','refused publication cannot claim settlement');
  const retry=await connection(`BEGIN;SET statement_timeout='5s';${second.invoke}COMMIT;`).done;assert.equal(retry.code,0,retry.err);assert(retry.out.includes('"ok": true'));
  assert.equal(scalar(`SELECT count(*) FROM public.team_hub_messages WHERE client_request_id='${second.request}'`),'1','same original publication retries once after exclusion clears');
  return{cases:2,originalPublication:true,originalRetirementScope:true,deadlocks:0,failedPublicationRows:0,sameRequestRowsAfterRetry:1};
 }finally{for(const c of connections)if(c.p.exitCode===null){c.p.stdin.end();await c.done;}}
}
