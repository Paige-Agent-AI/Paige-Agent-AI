import argparse,pathlib,subprocess,time,uuid
p=argparse.ArgumentParser(); p.add_argument('--psql',default='psql'); p.add_argument('--port',default='55439'); p.add_argument('--user',default='knowledge_test'); p.add_argument('--expected-data-directory'); p.add_argument('--publication-recovery',action='store_true'); p.add_argument('--recovery-baseline',action='store_true'); p.add_argument('--recovery-migration',default='supabase/migrations/20271110011000_knowledge_publication_recovery.sql'); p.add_argument('--source-quotation-proof',action='store_true'); p.add_argument('--source-quotation-baseline',action='store_true'); p.add_argument('--source-binding-proof',action='store_true'); p.add_argument('--source-binding-baseline',action='store_true'); a=p.parse_args()
if (a.source_quotation_proof or a.source_quotation_baseline or a.source_binding_proof or a.source_binding_baseline) and not a.expected_data_directory: p.error('Source proof requires a verified disposable data directory')
root=pathlib.Path(__file__).resolve().parents[2]; db='knowledge_publish_test_'+uuid.uuid4().hex
base=[a.psql,'-X','-h','127.0.0.1','-p',a.port,'-U',a.user,'-v','ON_ERROR_STOP=1']
def run(args):
 r=subprocess.run(base+args,cwd=root,text=True,capture_output=True,encoding='utf-8'); print(r.stdout); print(r.stderr)
 if r.returncode: raise RuntimeError('SQL failed')
if a.expected_data_directory:
 actual=subprocess.check_output(base+['-d','postgres','-Atc','SHOW data_directory'],text=True).strip()
 if pathlib.Path(actual).resolve()!=pathlib.Path(a.expected_data_directory).resolve(): raise RuntimeError('Refusing an unverified PostgreSQL data directory')
run(['-d','postgres','-c','CREATE DATABASE '+db])
try:
 files=['scripts/knowledge-service/fixture.sql','scripts/knowledge-service/delete-fixture.sql','scripts/knowledge-service/review-fixture.sql','scripts/knowledge-service/durable-fixture.sql','supabase/migrations/20270417000000_paige_durable_work_envelope.sql','supabase/migrations/20270418000000_paige_durable_document_work.sql','supabase/migrations/20270531100000_knowledge_canonical_metadata.sql','supabase/migrations/20270531200000_knowledge_canonical_delete.sql','supabase/migrations/20270531400000_knowledge_review_foundation.sql','supabase/migrations/20270531600000_knowledge_durable_authority.sql','supabase/migrations/20270532000000_knowledge_extraction_work.sql','supabase/migrations/20270532010000_knowledge_review_management.sql']
 files+=['supabase/migrations/20270533000000_knowledge_publication.sql']*2
 files+=['supabase/migrations/20270533100000_knowledge_publication_worker_adoption.sql']*2
 files+=['supabase/migrations/20270533200000_knowledge_submit_activation.sql']*2
 if a.publication_recovery and not a.recovery_baseline: files+=[a.recovery_migration]*2
 files+=['scripts/knowledge-service/extraction-behavior.sql','scripts/knowledge-service/publication-behavior.sql']
 if a.publication_recovery: files+=['scripts/knowledge-service/publication-recovery-behavior.sql']
 for f in files: run(['-d',db,'-f',f])
 if a.source_quotation_proof or a.source_quotation_baseline or a.source_binding_proof or a.source_binding_baseline:
  if not a.source_quotation_baseline: run(['-d',db,'-f','scripts/knowledge-service/native-source-quotation.sql'])
  run(['-d',db,'-f','scripts/knowledge-service/native-source-quotation-behavior.sql'])
 if a.source_binding_proof or a.source_binding_baseline:
  if not a.source_binding_baseline: run(['-d',db,'-f','scripts/knowledge-service/native-source-binding.sql'])
  run(['-d',db,'-f','scripts/knowledge-service/native-source-binding-behavior.sql'])
  if not a.source_binding_baseline:
   # Real original authority/document locks, not a mocked readiness response.
   # Fixture-only competing updates never run against customer data.
   actor="10000000-0000-0000-0000-000000000001"; tenant="00000000-0000-0000-0000-000000000001"
   for kind,doc,expected in [('source','20000000-0000-4000-8000-000000000090','KNOWLEDGE_SOURCE_CHANGED'),('membership','20000000-0000-4000-8000-000000000091','KNOWLEDGE_SCOPE_CHANGED')]:
    run(['-d',db,'-c',"INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,record_state) VALUES('"+doc+"','"+tenant+"','Synthetic locked source','A'||chr(128512)||'B','canonical'); UPDATE public.test_source_binding SET ref=(SELECT jsonb_build_object('contractVersion',1,'tenantId',tenant_id,'documentId',id,'revision',revision,'contentSha256',encode(sha256(convert_to(content,'UTF8')),'hex')) FROM public.tenant_knowledge_docs WHERE id='"+doc+"');"])
    first=None; peers=[]; committed=False
    def observe(query):
     deadline=time.monotonic()+10
     while time.monotonic()<deadline:
      if subprocess.check_output(base+['-d',db,'-Atc',query],text=True,encoding='utf-8').strip()=='t': return
      if first.poll() is not None: raise RuntimeError('Native source-lock holder ended before observation')
      time.sleep(0.02)
     raise RuntimeError('Native source/authority lock wait was not observed: '+kind)
    try:
     first=subprocess.Popen(base+['-d',db,'-qAt'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8'); peers.append(first)
     first.stdin.write("SET application_name='exp13_source_holder'; SET test.actor='"+actor+"'; BEGIN; SELECT public.test_source_binding();\n"); first.stdin.flush()
     observe("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='exp13_source_holder' AND state='idle in transaction')")
     mutation="UPDATE public.tenant_knowledge_docs SET content='Changed synthetic source' WHERE id='"+doc+"';" if kind=='source' else "UPDATE public.tenant_members SET status='inactive' WHERE tenant_id='"+tenant+"' AND user_id='"+actor+"';"
     peer=subprocess.Popen(base+['-d',db,'-qAtc',"SET application_name='exp13_source_competitor'; "+mutation],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8'); peers.append(peer)
     observe("SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity s ON s.pid=l.pid WHERE s.datname=current_database() AND s.application_name='exp13_source_competitor' AND NOT l.granted)")
     first.stdin.write('COMMIT;\n'); first.stdin.flush(); first.stdin.close(); first.stdin=None; committed=True
     results=[]
     for process in peers:
      out,err=process.communicate(timeout=20)
      if process.returncode: raise RuntimeError('Native source race session failed: '+out+err)
      results.append(out)
     if 'not_asserted' not in results[0] or doc not in results[0]: raise RuntimeError('Native source holder did not return its exact evidence')
     run(['-d',db,'-c',"SET test.actor='"+actor+"'; SELECT public.test_denied('SELECT public.test_source_binding()','"+expected+"');"])
     if kind=='membership': run(['-d',db,'-c',"UPDATE public.tenant_members SET status='active' WHERE tenant_id='"+tenant+"' AND user_id='"+actor+"';"])
     print('PASS: native '+kind+' update actually waited for original source-evidence transaction, then stale/revoked evidence refused')
    finally:
     if first is not None and first.poll() is None and first.stdin is not None:
      try: first.stdin.write('ROLLBACK;\n'); first.stdin.close(); first.stdin=None
      except OSError: pass
     for process in peers:
      if process.poll() is None:
       try: process.communicate(timeout=3)
       except subprocess.TimeoutExpired: process.kill(); process.communicate()
 print('PASS: native Knowledge publication SQL')
finally: run(['-d','postgres','-c','DROP DATABASE '+db])
