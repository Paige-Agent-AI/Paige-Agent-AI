import argparse,hashlib,json,pathlib,re,subprocess,time,uuid
p=argparse.ArgumentParser(); p.add_argument('--psql',default='psql'); p.add_argument('--port',default='55439'); p.add_argument('--user',default='knowledge_test'); p.add_argument('--expected-data-directory'); p.add_argument('--publication-recovery',action='store_true'); p.add_argument('--recovery-baseline',action='store_true'); p.add_argument('--recovery-migration',default='supabase/migrations/20271110011000_knowledge_publication_recovery.sql'); p.add_argument('--binary-source',action='store_true'); p.add_argument('--binary-baseline',action='store_true'); p.add_argument('--binary-migration',default='supabase/migrations/20271126130013_knowledge_binary_source_evidence.sql'); p.add_argument('--memory-review-baseline',action='store_true'); p.add_argument('--memory-review-candidate',action='store_true'); p.add_argument('--memory-install-guards',action='store_true'); p.add_argument('--memory-review-candidate-file',default='scripts/knowledge-service/reviewed-memory-candidate.sql'); p.add_argument('--memory-review-carrier-file'); p.add_argument('--source-quotation-proof',action='store_true'); p.add_argument('--source-quotation-baseline',action='store_true'); p.add_argument('--source-binding-proof',action='store_true'); p.add_argument('--source-binding-baseline',action='store_true'); p.add_argument('--source-evidence-carrier-file'); p.add_argument('--source-evidence-install-guards',action='store_true'); a=p.parse_args()
if a.binary_source and (not a.expected_data_directory or not a.publication_recovery): p.error('binary source proof requires the verified disposable data directory and original publication recovery')
if a.memory_review_carrier_file and not a.memory_review_candidate: p.error('Memory carrier requires native reviewed candidate controls')
if a.memory_install_guards and not a.memory_review_candidate: p.error('Memory install guards require the native reviewed candidate')
if (a.memory_review_baseline or a.memory_review_candidate) and not a.expected_data_directory: p.error('Memory proof requires a verified disposable data directory')
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
 if a.memory_review_baseline or a.memory_review_candidate:
  run(['-d',db,'-f','scripts/knowledge-service/reviewed-memory-fixture.sql'])
  # Execute the ORIGINAL writers, not a copied or modeled writer implementation.
  memory_sources={}
  for name,path in [('record_paige_memory','20270599000000_s5_owner_memory_backfill.sql'),('get_paige_memory','20261223000000_paige_memory_governed_contract.sql'),('forget_paige_memory','20261223000000_paige_memory_governed_contract.sql')]:
   source=(root/'supabase/migrations'/path).read_text(encoding='utf-8')
   match=re.search(r'CREATE OR REPLACE FUNCTION public\.'+name+r'\([\s\S]+?\$function\$;',source,re.I)
   if not match: raise RuntimeError('Original Memory source missing: '+name)
   memory_sources[name]=match.group(0)
   result=subprocess.run(base+['-d',db,'-c',"SET client_encoding='UTF8'",'-f','-'],input=match.group(0),cwd=root,text=True,capture_output=True,encoding='utf-8')
   print(result.stdout);print(result.stderr)
   if result.returncode: raise RuntimeError('Original Memory source installation failed: '+name)
  run(['-d',db,'-f','scripts/knowledge-service/reviewed-memory-source-check.sql'])
  if a.memory_review_candidate:
   # Add the reviewed-source eligibility predicate to the ORIGINAL old reader,
   # preserving its entire remaining body, signature, stability and ACL.
   original=memory_sources['get_paige_memory']; needle='  ORDER BY m.created_at DESC\n'
   if original.count(needle)!=1: raise RuntimeError('Original Memory context insertion point drifted')
   predicate=(root/'scripts/knowledge-service/reviewed-memory-context-predicate.sql').read_text(encoding='utf-8')
   context_source=original.replace(needle,predicate+needle,1)
   if hashlib.md5(context_source.split('$function$')[1].encode('utf-8')).hexdigest()!='6f815ab77dac205aa2fef761716f8e30': raise RuntimeError('Reviewed Memory context source drifted')
   if a.memory_review_carrier_file:
    run(['-d',db,'-f',a.memory_review_carrier_file])
   else:
    result=subprocess.run(base+['-d',db,'-c',"SET client_encoding='UTF8'",'-f','-'],input=context_source,cwd=root,text=True,capture_output=True,encoding='utf-8')
    print(result.stdout);print(result.stderr)
    if result.returncode: raise RuntimeError('Reviewed Memory context source installation failed')
    run(['-d',db,'-f',a.memory_review_candidate_file])
    run(['-d',db,'-f','scripts/knowledge-service/reviewed-memory-lifecycle-candidate.sql'])
   if a.memory_install_guards:
    carriers=[(a.memory_review_candidate_file,['record_paige_memory(text,text,uuid,jsonb,boolean,text,uuid,uuid,jsonb)']),('scripts/knowledge-service/reviewed-memory-lifecycle-candidate.sql',['get_paige_memory(text[],integer,uuid,uuid,jsonb)','forget_paige_memory(uuid,uuid,uuid,jsonb)'])]
    if a.memory_review_carrier_file:
     carriers=[(a.memory_review_carrier_file,[signature for _,signatures in carriers for signature in signatures]+['record_paige_memory(text,text,uuid,jsonb,boolean,text,uuid,uuid)','get_paige_memory(text[],integer,uuid,uuid)','forget_paige_memory(uuid,uuid,uuid)','knowledge_actor_authorized(uuid,uuid)','read_tenant_knowledge(uuid,uuid,integer,integer)'])]
    for path,signatures in carriers:
     run(['-d',db,'-f',path]) # exact known installation must replay safely
     carrier=(root/path).read_text(encoding='utf-8')
     if carrier.count('COMMIT;')!=1 or 'BEGIN;' not in carrier: raise RuntimeError('Unexpected Memory carrier transaction structure')
     body=carrier.split('BEGIN;',1)[1].rsplit('COMMIT;',1)[0]
     for signature in signatures:
      mutations=['ALTER FUNCTION public.'+signature+' SECURITY INVOKER;', 'ALTER FUNCTION public.'+signature+' STABLE;', 'ALTER FUNCTION public.'+signature+' PARALLEL SAFE;', 'ALTER FUNCTION public.'+signature+' STRICT;', 'ALTER FUNCTION public.'+signature+' OWNER TO authenticated;', 'ALTER FUNCTION public.'+signature+' SET search_path TO public,pg_temp;', 'GRANT EXECUTE ON FUNCTION public.'+signature+' TO anon;', 'GRANT EXECUTE ON FUNCTION public.'+signature+' TO service_role;', 'GRANT EXECUTE ON FUNCTION public.'+signature+' TO authenticated WITH GRANT OPTION;']
      if signature in ['get_paige_memory(text[],integer,uuid,uuid)','knowledge_actor_authorized(uuid,uuid)']: mutations[1]='ALTER FUNCTION public.'+signature+' VOLATILE;'
      if signature in ['record_paige_memory(text,text,uuid,jsonb,boolean,text,uuid,uuid)','get_paige_memory(text[],integer,uuid,uuid)','forget_paige_memory(uuid,uuid,uuid)','knowledge_actor_authorized(uuid,uuid)']:
       mutations[7]='REVOKE EXECUTE ON FUNCTION public.'+signature+' FROM service_role;'
      defaults={'record_paige_memory(text,text,uuid,jsonb,boolean,text,uuid,uuid)':('DEFAULT false','DEFAULT true'),'get_paige_memory(text[],integer,uuid,uuid)':('DEFAULT 50','DEFAULT 51'),'forget_paige_memory(uuid,uuid,uuid)':('DEFAULT NULL::uuid',"DEFAULT '10000000-0000-0000-0000-000000000001'::uuid"),'read_tenant_knowledge(uuid,uuid,integer,integer)':('DEFAULT 50','DEFAULT 51')}
      if signature in defaults:
       before,after=defaults[signature]
       mutations.append("DO $defaults$ DECLARE d text; BEGIN d:=pg_get_functiondef('public."+signature+"'::regprocedure); IF strpos(d,'"+before.replace("'","''")+"')=0 THEN RAISE EXCEPTION 'DEFAULT_CONTROL_SETUP_FAILED'; END IF; EXECUTE replace(d,'"+before.replace("'","''")+"','"+after.replace("'","''")+"'); END $defaults$;")
      mutations.append("DO $mutate$ DECLARE f record; BEGIN SELECT oid,prosrc INTO STRICT f FROM pg_proc WHERE oid='public."+signature+"'::regprocedure; EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,f.prosrc||E'\\n-- unexpected source drift\\n'); END $mutate$;")
      snapshot_sql="SELECT jsonb_build_object('definition',pg_get_functiondef(oid),'acl',proacl::text) FROM pg_proc WHERE oid='public."+signature+"'::regprocedure"
      snapshot=subprocess.check_output(base+['-d',db,'-Atc',snapshot_sql],text=True,encoding='utf-8')
      for mutation in mutations:
       # Mutation and attempted install share one transaction. Any rejection
       # closes/rolls back the session; no drift reaches the following control.
       result=subprocess.run(base+['-d',db,'-f','-'],input='BEGIN;\n'+mutation+'\n'+body+'\nROLLBACK;\n',cwd=root,text=True,capture_output=True,encoding='utf-8')
       if result.returncode==0 or 'PAIGE_MEMORY_SOURCE_DRIFT' not in result.stderr: raise RuntimeError('Memory install did not refuse drift: '+mutation+'\n'+result.stdout+result.stderr)
       if subprocess.check_output(base+['-d',db,'-Atc',snapshot_sql],text=True,encoding='utf-8')!=snapshot: raise RuntimeError('Refused Memory install changed the original function: '+signature)
       print('PASS: native Memory carrier refused '+mutation)
   run(['-d',db,'-f','scripts/knowledge-service/reviewed-memory-behavior.sql'])
   failures=[]
   for case in ['uppercase','preseed','reserved-metadata']:
    result=subprocess.run(base+['-d',db,'-f','scripts/knowledge-service/reviewed-memory-'+case+'.sql'],cwd=root,text=True,capture_output=True,encoding='utf-8')
    print(result.stdout);print(result.stderr)
    if result.returncode: failures.append(case)
   if failures: raise RuntimeError('Reviewed Memory adversarial controls failed: '+','.join(failures))
   run(['-d',db,'-f','scripts/knowledge-service/reviewed-memory-confirmation.sql'])
   run(['-d',db,'-f','scripts/knowledge-service/reviewed-memory-lifecycle.sql'])
   run(['-d',db,'-f','scripts/knowledge-service/reviewed-memory-access.sql'])
   # Real native sessions contend on the SAME save intent; no timing-only race
   # claim. Keep the first transaction open until both peers are observed waiting.
   save="SELECT public.record_paige_memory('preference','Concurrent reviewed preference',NULL,'{}',false,'confirmed',NULL,NULL,jsonb_set(public.test_memory_review('70000000-0000-4000-8000-000000000088'),'{source_quote}','\"synthetic source\"'));"
   inspect="SELECT public.get_paige_memory(NULL,1,NULL,NULL,public.test_memory_lookup(NULL,'70000000-0000-4000-8000-000000000088'));"
   setup="SET test.actor='10000000-0000-0000-0000-000000000001'; BEGIN; SET ROLE authenticated; "
   peers=[]; first=None; released=False
   def observe_lock(tag,granted):
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
     query="SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity s ON s.pid=l.pid WHERE s.datname=current_database() AND s.application_name='"+tag+"' AND l.locktype='advisory' AND l.granted="+('true' if granted else 'false')+")"
     result=subprocess.check_output(base+['-d',db,'-Atc',query],text=True,encoding='utf-8').strip()
     if result=='t': return
     if first.poll() is not None: raise RuntimeError('First native race session ended before lock observation')
     time.sleep(0.02)
    raise RuntimeError('Native advisory lock/wait was not observed: '+tag)
   try:
    first=subprocess.Popen(base+['-d',db,'-qAt'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8'); peers.append(first)
    first.stdin.write("SET application_name='exp13_memory_first'; "+setup+save+'\n'); first.stdin.flush()
    observe_lock('exp13_memory_first',True)
    for tag,statement in [('exp13_memory_second',save),('exp13_memory_inspect',inspect)]:
     peer=subprocess.Popen(base+['-d',db,'-qAtc',"SET application_name='"+tag+"'; "+setup+statement+' COMMIT;'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8'); peers.append(peer)
     observe_lock(tag,False)
    first.stdin.write('COMMIT;\n'); first.stdin.flush(); first.stdin.close(); first.stdin=None; released=True
    results=[]
    for peer in peers:
     out,err=peer.communicate(timeout=20)
     if peer.returncode: raise RuntimeError('Native race session failed: '+out+err)
     results.append(out)
    ids=[re.findall(r'(?m)^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$',out) for out in results[:2]]
    if any(len(found)!=1 for found in ids) or ids[0][0]!=ids[1][0]: raise RuntimeError('Concurrent intent returned different original Memory IDs')
    inspection=json.loads(next(line for line in results[2].splitlines() if line.startswith('{')))
    if inspection.get('status')!='present' or inspection.get('memory',{}).get('id')!=ids[0][0]: raise RuntimeError('Unknown-save inspection missed the committed effect')
    run(['-d',db,'-c',"SELECT public.test_assert((SELECT count(*)=1 FROM public.paige_owner_memory WHERE metadata#>>'{reviewed_save,intent_id}'='70000000-0000-4000-8000-000000000088'),'concurrent native save persists exactly one original Memory row')"])
    print('PASS: both native duplicate-save and unknown-inspection sessions waited on the real held intent lock and read the same committed Memory')
   finally:
    if first is not None and not released and first.stdin is not None:
     try: first.stdin.write('ROLLBACK;\n'); first.stdin.flush(); first.stdin.close(); first.stdin=None
     except (BrokenPipeError,OSError): pass
    for peer in peers:
     if peer.poll() is None:
      try: peer.communicate(timeout=5)
      except subprocess.TimeoutExpired: peer.kill(); peer.communicate()
 if a.memory_review_baseline:
  failures=[]
  for case in ['scope','replay','supersession']:
   result=subprocess.run(base+['-d',db,'-f','scripts/knowledge-service/reviewed-memory-'+case+'-baseline.sql'],cwd=root,text=True,capture_output=True,encoding='utf-8')
   print(result.stdout);print(result.stderr)
   if result.returncode: failures.append(case)
  if failures: raise RuntimeError('Reviewed Memory requirement controls failed: '+','.join(failures))
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
