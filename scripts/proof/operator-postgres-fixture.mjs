// Local/CI-only adapter for the existing SQL proof. Never accepts a remote URL or credentials.
import {spawnSync,spawn} from 'node:child_process';
const literal=v=>v===null?'NULL':typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`;
// Used only after an existing proof's disposable-loopback guard. Retire its random synthetic
// tenant through the installed canonical lifecycle; do not exempt raw DELETE or disable guards.
export function retireSyntheticTenantSQL(tenantId) {
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenantId))throw new Error('Synthetic fixture UUID required');
 return `DO $fixture_retire$
 DECLARE fixture_actor uuid:=gen_random_uuid(); operation uuid:=gen_random_uuid(); p jsonb; account_name text;
 BEGIN
  SELECT name INTO account_name FROM public.tenants WHERE id='${tenantId}';
  IF NOT FOUND THEN RETURN; END IF;
  IF to_regprocedure('public.operator_delete_archived_account(uuid,text,text,uuid)') IS NULL THEN
   DELETE FROM public.tenants WHERE id='${tenantId}'; RETURN;
  END IF;
  INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES(fixture_actor,'operator-fixture-'||fixture_actor::text||'@tests.invalid','{"comms_provider_execution":"disabled"}'::jsonb);
  INSERT INTO public.user_roles(user_id,role) VALUES(fixture_actor,'platform_admin');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',fixture_actor,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',fixture_actor::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  p:=public.operator_preview_account_archive('${tenantId}');
  IF NOT (p->>'execution_available')::boolean THEN RAISE EXCEPTION 'Synthetic archive cleanup blocked: %',p->'blockers'; END IF;
  PERFORM public.operator_archive_account('${tenantId}',p->>'version',account_name,operation);
  p:=public.operator_preview_account_deletion('${tenantId}');
  IF NOT (p->>'execution_available')::boolean THEN RAISE EXCEPTION 'Synthetic deletion cleanup blocked: %',p->'blockers'; END IF;
  PERFORM public.operator_delete_archived_account('${tenantId}',p->>'version',account_name,operation);
  IF EXISTS(SELECT 1 FROM public.tenants WHERE id='${tenantId}') THEN RAISE EXCEPTION 'Synthetic tenant cleanup absence not verified'; END IF;
  DELETE FROM public.user_roles WHERE user_id=fixture_actor;
  DELETE FROM auth.users WHERE id=fixture_actor;
 END $fixture_retire$;`;
}
export class OperatorPostgresFixture {
 constructor(port=5432) {
  if(!Number.isSafeInteger(port)||port<1024||port>65535||(port===5432&&!process.env.CI))throw new Error('Use the isolated CI service or a dedicated local fixture port.');
  this.port=port;this.actor='';this.role='';this.database=`operator_account_lifecycle_proof_${process.pid}`;this.psql=process.env.OPERATOR_PROOF_PSQL??'psql';
  this.run(`CREATE DATABASE ${this.database}`,[], 'postgres');
 }
 args(database=this.database){return ['-X','-h','127.0.0.1','-p',String(this.port),'-U','postgres','-d',database,'-A','-t','-v','ON_ERROR_STOP=1'];}
 sql(text,params=[]){return params.length?text.replace(/\$(\d+)/g,(_m,n)=>literal(params[Number(n)-1])):text;}
 prefix(){return `SELECT set_config('test.actor',${literal(this.actor)},false);${this.role?`SET ROLE ${this.role};`:''}`;}
 run(sql,params=[],database=this.database){
  const result=spawnSync(this.psql,this.args(database),{input:`\\set VERBOSITY verbose\n${database===this.database?this.prefix():''}\n${this.sql(sql,params)};`,encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024});
  if(result.error)throw result.error;
  if(result.status!==0){const error=new Error((result.stderr.match(/ERROR:.*(?:\n|$)/)?.[0]??'Fixture SQL failed').trim());error.code=result.stderr.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];throw error;}
  return result.stdout.trim();
 }
 async exec(sql){this.run(sql);for(const match of sql.matchAll(/\b(RESET ROLE|SET ROLE (authenticated|anon|service_role))\b/g))this.role=match[2]??'';}
 async query(sql,params=[]){
  const rendered=this.sql(sql,params);
  const out=this.run(/^(insert|update|delete)\b/i.test(sql)?`WITH proof AS (${rendered}${/\breturning\b/i.test(sql)?'':' RETURNING 1'}) SELECT coalesce(json_agg(proof),'[]') FROM proof`:`SELECT coalesce(json_agg(proof),'[]') FROM (${rendered}) proof`);
  if(sql.startsWith("select set_config('test.actor'"))this.actor=params[0];
  const start=out.indexOf('[');if(start<0)throw new Error('Fixture JSON readback missing');return {rows:JSON.parse(out.slice(start))};
 }
 // A second actual PostgreSQL connection holds the completed archive transaction open.
 async holdArchive(sql,params=[]){
  const child=spawn(this.psql,this.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let err='';child.stderr.on('data',d=>{err+=d;});
  const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(err)));});
  const held=new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('fixture_archive_held'))resolve();});child.on('error',reject);child.on('close',code=>{if(code)reject(new Error(err));});});
  child.stdin.end(`\\set VERBOSITY verbose\nBEGIN;${this.prefix()}${this.sql(sql,params)};SELECT 'fixture_archive_held';SELECT pg_sleep(1);COMMIT;`);
  await held;return {completed};
 }
 async close(){} // CI container/local fixture cluster owns disposal; no remote reset path.
}
