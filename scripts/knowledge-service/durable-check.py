import argparse,pathlib,subprocess,uuid,time
p=argparse.ArgumentParser(); p.add_argument('--psql',default='psql'); p.add_argument('--baseline',action='store_true'); a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]; db='knowledge_durable_test_'+uuid.uuid4().hex
base=[a.psql,'-X','-h','127.0.0.1','-p','55439','-U','knowledge_test','-v','ON_ERROR_STOP=1']
def run(args):
 r=subprocess.run(base+args,cwd=root,text=True,capture_output=True); print(r.stdout); print(r.stderr)
 if r.returncode: raise RuntimeError('SQL failed')
run(['-d','postgres','-c','CREATE DATABASE '+db])
try:
 files=['scripts/knowledge-service/fixture.sql','scripts/knowledge-service/delete-fixture.sql','scripts/knowledge-service/review-fixture.sql','scripts/knowledge-service/durable-fixture.sql','supabase/migrations/20270417000000_paige_durable_work_envelope.sql','supabase/migrations/20270418000000_paige_durable_document_work.sql','supabase/migrations/20270530100000_knowledge_canonical_metadata.sql','supabase/migrations/20270530200000_knowledge_canonical_delete.sql','supabase/migrations/20270530400000_knowledge_review_foundation.sql']
 if not a.baseline: files+=['supabase/migrations/20270530600000_knowledge_durable_authority.sql']*2
 files+=['scripts/knowledge-service/durable-behavior.sql']
 for f in files: run(['-d',db,'-f',f])
 # The creator must wait for a profile change and refuse after the switch commits.
 marker='knowledge_authority_race_'+uuid.uuid4().hex
 first=subprocess.Popen(base+['-d',db,'-c',f"SET application_name='{marker}'; BEGIN; UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001'; SELECT pg_sleep(2); COMMIT;"],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 try:
  deadline=time.monotonic()+10
  while time.monotonic()<deadline:
   probe=subprocess.run(base+['-d',db,'-Atc',f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{marker}' AND wait_event='PgSleep'"],text=True,capture_output=True)
   if probe.stdout.strip()=='1': break
   if first.poll() is not None: raise RuntimeError('switch ended before lock barrier')
   time.sleep(0.03)
  else: raise RuntimeError('lock barrier timeout')
  run(['-d',db,'-c',"SET ROLE service_role; SELECT public.test_denied($q$SELECT public.test_create_work('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','knowledge_extract','knowledge.extract')$q$,'DURABLE_WORK_INITIATOR_FORBIDDEN');"])
  out,err=first.communicate(timeout=10)
  if first.returncode: raise RuntimeError(err)
  print('PASS: selected profile switch wins before creation')
 finally:
  if first.poll() is None: first.terminate(); first.communicate(timeout=10)
 print('PASS: narrow durable authority and document regression SQL')
finally: run(['-d','postgres','-c','DROP DATABASE '+db])
