import argparse,pathlib,subprocess,uuid,time
p=argparse.ArgumentParser(); p.add_argument('--psql',default='psql'); p.add_argument('--baseline',action='store_true'); a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]; db='knowledge_extract_test_'+uuid.uuid4().hex
base=[a.psql,'-X','-h','127.0.0.1','-p','55439','-U','knowledge_test','-v','ON_ERROR_STOP=1']
def run(args):
 r=subprocess.run(base+args,cwd=root,text=True,capture_output=True); print(r.stdout); print(r.stderr)
 if r.returncode: raise RuntimeError('SQL failed')
run(['-d','postgres','-c','CREATE DATABASE '+db])
try:
 files=['scripts/knowledge-service/fixture.sql','scripts/knowledge-service/delete-fixture.sql','scripts/knowledge-service/review-fixture.sql','scripts/knowledge-service/durable-fixture.sql','supabase/migrations/20270417000000_paige_durable_work_envelope.sql','supabase/migrations/20270418000000_paige_durable_document_work.sql','supabase/migrations/20270525000000_knowledge_canonical_metadata.sql','supabase/migrations/20270526000000_knowledge_canonical_delete.sql','supabase/migrations/20270527000000_knowledge_review_foundation.sql']
 files+=['supabase/migrations/20270528000000_knowledge_durable_authority.sql']
 if not a.baseline: files+=['supabase/migrations/20270531000000_knowledge_extraction_work.sql']*2
 files+=['scripts/knowledge-service/extraction-behavior.sql']
 for f in files: run(['-d',db,'-f',f])
 # Two actual connections prove completion replay cannot duplicate pending writes or receipts.
 run(['-d',db,'-c',"SET ROLE service_role; INSERT INTO public.extract_test VALUES('race',public.test_extract('70000000-0000-0000-0000-000000000019'),NULL); UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='race';"])
 finish="SELECT public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Neutral extracted text',started->>'input_hash') FROM public.extract_test WHERE name='race';"
 marker='knowledge_complete_'+uuid.uuid4().hex
 first=subprocess.Popen(base+['-d',db,'-c',f"SET application_name='{marker}'; SET ROLE service_role; BEGIN; "+finish+' SELECT pg_sleep(2); COMMIT;'],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 try:
  deadline=time.monotonic()+10
  while time.monotonic()<deadline:
   probe=subprocess.run(base+['-d',db,'-Atc',f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{marker}' AND wait_event='PgSleep'"],text=True,capture_output=True)
   if probe.stdout.strip()=='1': break
   if first.poll() is not None: raise RuntimeError('completion ended before lock barrier')
   time.sleep(0.03)
  else: raise RuntimeError('completion lock barrier timeout')
  run(['-d',db,'-c','SET ROLE service_role; '+finish])
  out,err=first.communicate(timeout=10)
  if first.returncode: raise RuntimeError(err)
  run(['-d',db,'-c',"SELECT public.test_assert((SELECT revision=2 FROM public.tenant_knowledge_docs WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='race')) AND (SELECT count(*)=1 FROM public.test_receipts WHERE run_id=(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='race')),'concurrent completion writes and receipts once');"])
 finally:
  if first.poll() is None: first.terminate(); first.communicate(timeout=10)
 print('PASS: native extraction SQL')
finally: run(['-d','postgres','-c','DROP DATABASE '+db])
