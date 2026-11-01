import argparse,pathlib,subprocess,time,uuid
p=argparse.ArgumentParser(); p.add_argument('--psql',default='psql'); p.add_argument('--port',default='55439'); p.add_argument('--user',default='knowledge_test'); p.add_argument('--expected-data-directory'); p.add_argument('--publication-recovery',action='store_true'); p.add_argument('--recovery-baseline',action='store_true'); p.add_argument('--recovery-migration',default='supabase/migrations/20271110011000_knowledge_publication_recovery.sql'); p.add_argument('--binary-source',action='store_true'); p.add_argument('--binary-baseline',action='store_true'); p.add_argument('--binary-migration',default='supabase/migrations/20271126130013_knowledge_binary_source_evidence.sql'); p.add_argument('--source-quotation-proof',action='store_true'); p.add_argument('--source-quotation-baseline',action='store_true'); p.add_argument('--source-binding-proof',action='store_true'); p.add_argument('--source-binding-baseline',action='store_true'); p.add_argument('--source-evidence-carrier-file'); p.add_argument('--source-evidence-install-guards',action='store_true'); a=p.parse_args()
if a.binary_source and (not a.expected_data_directory or not a.publication_recovery): p.error('binary source proof requires the verified disposable data directory and original publication recovery')
if (a.source_quotation_proof or a.source_quotation_baseline or a.source_binding_proof or a.source_binding_baseline) and not a.expected_data_directory: p.error('Source proof requires a verified disposable data directory')
if a.source_evidence_carrier_file and (not a.source_binding_proof or a.source_binding_baseline or a.source_quotation_baseline): p.error('Source carrier requires native binding proof without absence baselines')
if a.source_evidence_install_guards and not a.source_evidence_carrier_file: p.error('Source install guards require the same guarded carrier')
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
 if a.binary_source and not a.binary_baseline: files+=[a.binary_migration]*2
 files+=['scripts/knowledge-service/extraction-behavior.sql','scripts/knowledge-service/publication-behavior.sql']
 if a.publication_recovery: files+=['scripts/knowledge-service/publication-recovery-behavior.sql']
 if a.binary_source: files+=['scripts/knowledge-service/binary-source-behavior.sql']
 for f in files:
  run(['-d',db,'-f',f])
  if a.binary_source and not a.binary_baseline and f==a.binary_migration:
   # Faults exist only inside this verified disposable database transaction.
   # ON_ERROR_STOP closes the failed connection, rolling every fault back.
   faults=[
    "CREATE OR REPLACE FUNCTION public.complete_knowledge_extraction(_work_id uuid,_server_key text,_attempt integer,_revision integer,_content text,_hash text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT NULL::jsonb $$",
    'GRANT EXECUTE ON FUNCTION public.complete_knowledge_extraction(uuid,text,integer,integer,text,text) TO authenticated',
    'GRANT EXECUTE ON FUNCTION public.complete_knowledge_extraction(uuid,text,integer,integer,text,text,jsonb) TO pg_monitor',
   ]
   for fault in faults:
    rejected=subprocess.run(base+['-d',db,'-c','BEGIN','-c',fault,'-f',a.binary_migration],cwd=root,text=True,capture_output=True,encoding='utf-8')
    if rejected.returncode==0 or 'KNOWLEDGE_BINARY_SOURCE_DRIFT' not in rejected.stderr: raise RuntimeError('source/ACL fault was not refused: '+rejected.stdout+rejected.stderr)
    print('PASS: transactional source/ACL drift refused; fixture fault rolled back')
 if a.source_quotation_proof or a.source_quotation_baseline or a.source_binding_proof or a.source_binding_baseline:
  if a.source_evidence_carrier_file:
   run(['-d',db,'-f',a.source_evidence_carrier_file]); run(['-d',db,'-f',a.source_evidence_carrier_file])
  elif not a.source_quotation_baseline: run(['-d',db,'-f','scripts/knowledge-service/native-source-quotation.sql'])
  run(['-d',db,'-f','scripts/knowledge-service/native-source-quotation-behavior.sql'])
 if a.source_binding_proof or a.source_binding_baseline:
  if not a.source_binding_baseline and not a.source_evidence_carrier_file: run(['-d',db,'-f','scripts/knowledge-service/native-source-binding.sql'])
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
 if a.source_evidence_install_guards:
  # Real DDL faults ONLY in this verified disposable database. Each rejected
  # connection closes its transaction; every original definition/ACL is reread.
  quote='public.knowledge_utf16_excerpt_matches(text,integer,integer,text)'
  binding='public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)'
  reader='public.read_tenant_knowledge(uuid,uuid,integer,integer)'
  authority='public.lock_knowledge_extraction_authority(uuid,uuid)'
  snapshots="SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'owner',p.proowner) ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.oid IN ('"+quote+"'::regprocedure,'"+binding+"'::regprocedure,'"+reader+"'::regprocedure,'"+authority+"'::regprocedure,'public.knowledge_utf16_length(text)'::regprocedure,'public.knowledge_actor_authorized(uuid,uuid)'::regprocedure)"
  before=subprocess.check_output(base+['-d',db,'-Atc',snapshots],text=True,encoding='utf-8').strip()
  original_quote=(root/'scripts/knowledge-service/native-source-quotation.sql').read_text(encoding='utf8')
  default_fault=original_quote[original_quote.index('CREATE FUNCTION '):original_quote.index('REVOKE ALL')].replace('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION ',1).replace('p_quote text','p_quote text DEFAULT NULL',1)
  faults=[
   'ALTER FUNCTION '+quote+' VOLATILE',
   'ALTER FUNCTION '+quote+' SECURITY DEFINER',
   'ALTER FUNCTION '+quote+' STRICT',
   'ALTER FUNCTION '+quote+' PARALLEL UNSAFE',
   'ALTER FUNCTION '+quote+" SET search_path='public'",
   'ALTER FUNCTION '+quote+' OWNER TO pg_monitor',
   default_fault,
   'GRANT EXECUTE ON FUNCTION '+quote+' TO PUBLIC',
   'GRANT EXECUTE ON FUNCTION '+binding+' TO service_role',
   'GRANT EXECUTE ON FUNCTION '+binding+' TO pg_monitor',
   'ALTER FUNCTION '+binding+' SECURITY DEFINER',
   'ALTER FUNCTION '+authority+' SECURITY INVOKER',
   'ALTER FUNCTION public.knowledge_utf16_length(text) STABLE',
   'GRANT EXECUTE ON FUNCTION '+reader+' TO pg_monitor',
   'REVOKE EXECUTE ON FUNCTION '+reader+' FROM authenticated',
   "CREATE OR REPLACE FUNCTION public.lock_knowledge_source_evidence(p_actor uuid,p_tenant uuid,p_reference jsonb,p_excerpts jsonb) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$ SELECT '{}'::jsonb $$",
  ]
  for index,fault in enumerate(faults):
   rejected=subprocess.run(base+['-d',db,'-c','BEGIN','-c',fault,'-f',a.source_evidence_carrier_file],cwd=root,text=True,capture_output=True,encoding='utf-8')
   if rejected.returncode==0 or 'KNOWLEDGE_SOURCE_INSTALL_DRIFT' not in rejected.stderr:
    raise RuntimeError('Source installation fault was not refused: '+str(index)+' '+rejected.stdout+rejected.stderr)
   after=subprocess.check_output(base+['-d',db,'-Atc',snapshots],text=True,encoding='utf-8').strip()
   if after!=before: raise RuntimeError('Source installation refusal changed original definitions or ACLs: '+str(index))
   print('PASS: private source install fault '+str(index)+' refused; all six definitions/ACLs/owners restored')
 print('PASS: native Knowledge publication SQL')
finally: run(['-d','postgres','-c','DROP DATABASE '+db])
