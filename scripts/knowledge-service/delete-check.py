"""Deletion proof uses a fresh DB on the existing disposable localhost cluster only."""
import argparse, pathlib, subprocess, uuid, time
p=argparse.ArgumentParser()
p.add_argument('--psql',default='psql'); p.add_argument('--port',default='55439'); p.add_argument('--user',default='knowledge_test')
a=p.parse_args(); root=pathlib.Path(__file__).resolve().parents[2]
base=[a.psql,'-X','-h','127.0.0.1','-p',a.port,'-U',a.user,'-v','ON_ERROR_STOP=1']
db='knowledge_delete_test_'+uuid.uuid4().hex

def run(args,check=True):
 r=subprocess.run(base+args,cwd=root,text=True,capture_output=True)
 print(r.stdout); print(r.stderr)
 if check and r.returncode: raise RuntimeError('SQL check failed')
 return r

run(['-d','postgres','-c','CREATE DATABASE '+db])
try:
 for file in ['scripts/knowledge-service/fixture.sql','scripts/knowledge-service/delete-fixture.sql',
              'supabase/migrations/20270531100000_knowledge_canonical_metadata.sql',
              'supabase/migrations/20270531200000_knowledge_canonical_delete.sql',
              'supabase/migrations/20270531200000_knowledge_canonical_delete.sql',
              'scripts/knowledge-service/delete-behavior.sql']:
  run(['-d',db,'-f',file])
 # Separate connections with a database-observed barrier: first reaches pg_sleep
 # only after acquiring the relevant lock. No guessed sleep establishes ordering.
 actor="SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false); SELECT set_config('test.owner','false',false); SET ROLE authenticated;"
 tenant='00000000-0000-0000-0000-000000000001'
 def seed(n):
  doc='20000000-0000-0000-0000-'+str(n).zfill(12)
  run(['-d',db,'-c',f"UPDATE public.profiles SET active_tenant_id='{tenant}'; INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content) VALUES('{doc}','{tenant}','race','race content');"])
  return doc
 def delete(doc):
  return f"SELECT public.delete_tenant_knowledge('{tenant}','{doc}',1);"
 def race(first_sql,second_sql,expected,label):
  marker='knowledge_race_'+uuid.uuid4().hex
  first=subprocess.Popen(base+['-d',db,'-c',f"SET application_name='{marker}'; BEGIN; "+first_sql+' SELECT pg_sleep(2); COMMIT;'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:
   deadline=time.monotonic()+10
   while time.monotonic()<deadline:
    probe=subprocess.run(base+['-d',db,'-Atc',f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{marker}' AND wait_event='PgSleep'"],text=True,capture_output=True)
    if probe.stdout.strip()=='1': break
    if first.poll() is not None: raise RuntimeError('first transaction ended before lock barrier')
    time.sleep(0.03)
   else: raise RuntimeError('lock barrier timed out')
   second=run(['-d',db,'-c',second_sql],check=False)
   out,err=first.communicate(timeout=10)
   if first.returncode or second.returncode==0 or expected not in second.stderr:
    raise RuntimeError('race failed: '+label+' '+err)
   print('PASS: '+label)
  finally:
   if first.poll() is None:
    first.terminate(); first.communicate(timeout=10)
 d=seed(11)
 race(actor+f"SELECT public.update_tenant_knowledge_metadata('{tenant}','{d}',1,'{{\"title\":\"newer\"}}');",actor+delete(d),'KNOWLEDGE_REVISION_CONFLICT','update wins; stale delete refused')
 run(['-d',db,'-c',f"SELECT public.test_assert((SELECT revision=2 AND title='newer' FROM public.tenant_knowledge_docs WHERE id='{d}'),'newer document survives');"])
 d=seed(12)
 race(actor+delete(d),actor+delete(d),'KNOWLEDGE_NOT_FOUND','concurrent deletes commit once')
 run(['-d',db,'-c',f"SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.tenant_knowledge_docs WHERE id='{d}') AND (SELECT count(*)=1 FROM public.test_receipts WHERE detail->>'document_id'='{d}'),'one delete and receipt');"])
 d=seed(13)
 race("UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000002';",actor+delete(d),'KNOWLEDGE_SCOPE_CHANGED','workspace switch before delete refused')
 run(['-d',db,'-c',f"SELECT public.test_assert(EXISTS(SELECT 1 FROM public.tenant_knowledge_docs WHERE id='{d}'),'scope switch preserves document');"])
 d=seed(14)
 race(actor+delete(d),f"INSERT INTO public.tenant_knowledge_chunks VALUES('30000000-0000-0000-0000-000000000014','{tenant}','{d}',0,'late chunk');",'violates foreign key constraint','parent lock prevents late orphan chunk')
 run(['-d',db,'-c',f"SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.tenant_knowledge_chunks WHERE doc_id='{d}'),'late chunk absent');"])
 print('PASS: deletion migration replay twice, 26 role/behavior checks, four real concurrent races')
finally:
 run(['-d','postgres','-c','DROP DATABASE '+db],check=False)
