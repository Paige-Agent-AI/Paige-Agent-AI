"""Disposable PostgreSQL catalogue check; existing authorization dependencies are fixtures."""
import argparse, pathlib, subprocess, uuid
p=argparse.ArgumentParser(); p.add_argument('--psql',default='psql'); p.add_argument('--port',default='55439'); p.add_argument('--user',default='knowledge_test'); a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
base=[a.psql,'-X','-h','127.0.0.1','-p',a.port,'-U',a.user,'-v','ON_ERROR_STOP=1']
db='knowledge_catalogue_test_'+uuid.uuid4().hex

def run(args):
 r=subprocess.run(base+args,cwd=root,capture_output=True,text=True)
 if r.returncode: raise RuntimeError(r.stderr)
 print(r.stdout.encode('ascii','replace').decode()); print(r.stderr.encode('ascii','replace').decode())

run(['-d','postgres','-c','CREATE DATABASE '+db])
try:
 run(['-d',db,'-f','scripts/knowledge-service/fixture.sql'])
 run(['-d',db,'-c',"CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT active_tenant_id FROM profiles WHERE user_id=auth.uid() $$; CREATE TABLE tenant_tool_autonomy(tenant_id uuid,tool_key text,mode text,updated_at timestamptz);"])
 run(['-d',db,'-f','supabase/migrations/20270524000000_retire_program_enroll_catalogue.sql'])
 run(['-d',db,'-c',"CREATE TABLE old_catalogue AS SELECT * FROM public.list_tool_autonomy('00000000-0000-0000-0000-000000000001');"])
 for _ in range(2): run(['-d',db,'-f','supabase/migrations/20270531800000_knowledge_tool_catalogue.sql'])
 run(['-d',db,'-c',"""
 SELECT public.test_assert(NOT EXISTS((SELECT * FROM old_catalogue EXCEPT SELECT * FROM list_tool_autonomy('00000000-0000-0000-0000-000000000001'))),'all previous rows preserved');
 SELECT public.test_assert((SELECT count(*)=2 FROM list_tool_autonomy('00000000-0000-0000-0000-000000000001') WHERE tool_key IN ('knowledge_update','knowledge_delete') AND mode='confirm' AND is_default AND category='Knowledge'),'two visible default-confirm Knowledge rows');
 SELECT public.test_assert(NOT has_function_privilege('anon','public.list_tool_autonomy(uuid)','EXECUTE'),'anonymous execute denied');
 SELECT public.test_assert(has_function_privilege('authenticated','public.list_tool_autonomy(uuid)','EXECUTE'),'authenticated grant retained');
 SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false),set_config('test.owner','false',false);
 SET ROLE authenticated;
 SELECT public.test_denied($q$SELECT * FROM public.list_tool_autonomy('00000000-0000-0000-0000-000000000002')$q$,'AUTONOMY_FORBIDDEN');
 RESET ROLE;
 INSERT INTO tenant_tool_autonomy VALUES('00000000-0000-0000-0000-000000000001','knowledge_update','off',now());
 SET ROLE authenticated;
 SELECT public.test_assert((SELECT mode='off' AND NOT is_default FROM public.list_tool_autonomy() WHERE tool_key='knowledge_update'),'existing per-tenant off preference visible');
 """])
finally:
 run(['-d','postgres','-c','DROP DATABASE '+db])
