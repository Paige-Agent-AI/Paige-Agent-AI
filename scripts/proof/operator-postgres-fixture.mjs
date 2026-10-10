// Local/CI-only adapter for the existing SQL proof. Never accepts a remote URL or credentials.
import {spawnSync,spawn} from 'node:child_process';
const literal=v=>v===null?'NULL':typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`;
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
