"""Run only against a disposable localhost PostgreSQL cluster. No production settings read."""
import argparse, pathlib, subprocess, uuid, time
p=argparse.ArgumentParser()
p.add_argument('--psql',default='psql')
p.add_argument('--port',default='55439')
p.add_argument('--user',default='knowledge_test')
a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
db='knowledge_test_'+uuid.uuid4().hex
base=[a.psql,'-X','-h','127.0.0.1','-p',a.port,'-U',a.user,'-v','ON_ERROR_STOP=1']
def run(args,check=True):
 r=subprocess.run(base+args,cwd=root,text=True,capture_output=True)
 print(r.stdout);print(r.stderr)
 if check and r.returncode: raise RuntimeError('SQL command failed')
 return r
run(['-d','postgres','-c','CREATE DATABASE '+db])
try:
 run(['-d',db,'-f','scripts/knowledge-service/fixture.sql'])
 migration='supabase/migrations/20270525000000_knowledge_canonical_metadata.sql'
 run(['-d',db,'-f',migration]);run(['-d',db,'-f',migration])
 run(['-d',db,'-f','scripts/knowledge-service/behavior.sql'])
 run(['-d',db,'-c',"UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000001'; UPDATE public.test_members SET active=true;"])
 setup="SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false); SELECT set_config('test.owner','false',false); SET ROLE authenticated;"
 update="SELECT public.update_tenant_knowledge_metadata('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',2,'{\"title\":\"concurrent\"}');"
 first=subprocess.Popen(base+['-d',db,'-c',setup+' BEGIN; '+update+' SELECT pg_sleep(2); COMMIT;'],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 time.sleep(0.4)
 second=run(['-d',db,'-c',setup+update],check=False)
 out,err=first.communicate(timeout=15)
 if first.returncode or second.returncode==0 or 'KNOWLEDGE_REVISION_CONFLICT' not in second.stderr: raise RuntimeError('concurrent CAS assertion failed '+err)
 print('PASS: concurrent writers commit once and refuse stale revision')
 run(['-d',db,'-c',"SELECT public.test_assert((SELECT revision=3 FROM public.tenant_knowledge_docs WHERE id='20000000-0000-0000-0000-000000000001'),'concurrent revision readback');"])
 print('PASS: fixture bootstrap, migration replay twice, SQL role and behavior checks, concurrent CAS')
finally:
 run(['-d','postgres','-c','DROP DATABASE '+db],check=False)
