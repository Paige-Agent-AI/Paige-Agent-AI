"""Original Knowledge native functions in the existing local dependency fixture.
Not full-schema, authenticated customer, provider or UI proof.
"""
import argparse, pathlib, subprocess, uuid, ast, re, time, json
p=argparse.ArgumentParser()
p.add_argument('--psql',required=True);p.add_argument('--port',default='55461')
p.add_argument('--expected-data-directory',required=True);p.add_argument('--without-candidate',action='store_true')
p.add_argument('--auth-order-migration',help='Prove forward Auth-first ordering against the original native entry points')
p.add_argument('--auth-lock-migration',help='Prove native Auth/Knowledge lock fairness in this disposable fixture')
p.add_argument('--containment-release-migration',help='Prove exact original save ACL restoration after the lock repair')
a=p.parse_args();root=pathlib.Path(__file__).resolve().parents[2]
base=[a.psql,'-X','-h','127.0.0.1','-p',a.port,'-U','postgres','-v','ON_ERROR_STOP=1']
def sql(db,statement=None,file=None):
 r=subprocess.run(base+['-d',db]+(['-Atc',statement] if statement is not None else ['-f',str(file)]),cwd=root,text=True,capture_output=True,encoding='utf8')
 if r.returncode:raise RuntimeError(r.stdout[-2000:]+r.stderr[-4000:])
 return r.stdout,r.stderr
actual=sql('postgres','SHOW data_directory')[0].strip()
if pathlib.Path(actual).resolve()!=pathlib.Path(a.expected_data_directory).resolve():raise RuntimeError('Unverified local data directory')
# Consume the original producer's actual initial source list, not rewritten SQL.
producer=(root/'scripts/knowledge-service/publication-check.py').read_text(encoding='utf8')
match=re.search(r'^ files=(\[.*\])$',producer,re.M)
files=ast.literal_eval(match.group(1))
for f in ['20270533000000_knowledge_publication.sql','20270533100000_knowledge_publication_worker_adoption.sql','20270533200000_knowledge_submit_activation.sql','20271110011000_knowledge_publication_recovery.sql','20271126130013_knowledge_binary_source_evidence.sql']:
 files+=['supabase/migrations/'+f]*2
files+=['scripts/knowledge-service/extraction-behavior.sql','scripts/knowledge-service/publication-behavior.sql','scripts/knowledge-service/binary-source-behavior.sql']
db='exp01_chat_knowledge_'+uuid.uuid4().hex
sql('postgres','CREATE DATABASE '+db)
try:
 for f in files:sql(db,file=root/f)
 if not a.without_candidate:
  for _ in range(2):sql(db,file=root/'scripts/proof/exp01-chat-knowledge-candidate.sql')
  acl_snapshot="SELECT jsonb_agg(jsonb_build_object('id',oid,'definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl) ORDER BY oid) FROM pg_proc WHERE proname IN ('_paige_chat_knowledge_scope','_paige_chat_knowledge_source','_paige_chat_knowledge_intake_source','inspect_paige_chat_knowledge_intake','stage_paige_chat_knowledge_intake','inspect_paige_chat_knowledge_link','save_paige_chat_knowledge_link','list_paige_chat_knowledge_links')"
  acl_before=sql(db,acl_snapshot)[0]
  for _ in range(2):sql(db,file=root/'supabase/migrations/20271127040002_exp01_chat_knowledge_explicit_acl.sql')
  if sql(db,acl_snapshot)[0]!=acl_before:raise RuntimeError('Explicit ACL forward changed original eight function definitions or permissions')
  print('PASS: explicit ACL forward and replay preserve all eight native definitions and permissions')
 # SQL helper bodies resolve at execution; absence control genuinely reaches
 # the missing original host mutation/inspection after real native publication.
 sql(db,file=root/'scripts/proof/exp01-chat-knowledge-fixture.sql')
 factory=(root/'supabase/migrations/20271111010000_e09_customer_portal_access.sql').read_text(encoding='utf8')
 start=factory.index('CREATE OR REPLACE FUNCTION public.paige_chat_thread_create(')
 delimiter=re.search(r'AS (\$(?:\w+)?\$)',factory[start:]);body_start=start+delimiter.end()
 end=factory.index(delimiter.group(1)+';',body_start)+len(delimiter.group(1))+1
 sql(db,factory[start:end])
 if sql(db,"SELECT md5(prosrc) FROM pg_proc WHERE oid='public.paige_chat_thread_create(uuid,text,text,jsonb)'::regprocedure")[0].strip()!='edd8106db720bac790b71daabfb8ad1f':raise RuntimeError('Original native thread factory source drift')
 out,err=sql(db,file=root/'scripts/proof/exp01-chat-knowledge-behavior.sql')
 labels=re.findall(r'PASS: (.*)',err)
 print('\n'.join(labels));print('PASS:',len(labels),'host assertions; original producer source fixtures retained')
 candidate=(root/'scripts/proof/exp01-chat-knowledge-candidate.sql').read_text(encoding='utf8')
 snapshots="SELECT jsonb_agg(jsonb_build_object('id',oid,'definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl) ORDER BY oid) FROM pg_proc WHERE proname IN ('_paige_chat_knowledge_scope','_paige_chat_knowledge_source','_paige_chat_knowledge_intake_source','inspect_paige_chat_knowledge_intake','stage_paige_chat_knowledge_intake','inspect_paige_chat_knowledge_link','save_paige_chat_knowledge_link','list_paige_chat_knowledge_links')"
 before=sql(db,snapshots)[0]
 faults=[
  'ALTER FUNCTION public._paige_chat_knowledge_scope(uuid,uuid,uuid) SECURITY DEFINER',
  'ALTER FUNCTION public._paige_chat_knowledge_source(uuid,uuid,uuid) IMMUTABLE',
  "ALTER FUNCTION public.inspect_paige_chat_knowledge_link(uuid,uuid,uuid,uuid) SET search_path='public'",
  'GRANT EXECUTE ON FUNCTION public._paige_chat_knowledge_source(uuid,uuid,uuid) TO authenticated',
  'GRANT EXECUTE ON FUNCTION public.save_paige_chat_knowledge_link(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer) TO service_role',
  'GRANT UPDATE ON public.paige_durable_work TO authenticated',
  'DROP INDEX public.paige_work_chat_knowledge_source',
  "ALTER TABLE public.paige_durable_work ALTER COLUMN chat_source_link SET DEFAULT '{}'::jsonb",
 ]
 for installer in [candidate,(root/'supabase/migrations/20271127040002_exp01_chat_knowledge_explicit_acl.sql').read_text(encoding='utf8')]:
  for fault in faults:
   run=subprocess.run(base+['-d',db],input='BEGIN;'+fault+';'+installer,cwd=root,text=True,capture_output=True,encoding='utf8')
   if run.returncode==0 or 'CHAT_KNOWLEDGE_' not in run.stderr:raise RuntimeError('Install fault not refused: '+fault+' '+run.stderr[-2000:])
   if sql(db,snapshots)[0]!=before:raise RuntimeError('Refused install changed original eight function definitions/metadata')
 print('PASS:',len(faults)*2,'original and forward installation source/config/permission/storage/index faults refused and rolled back')
 if a.auth_lock_migration:
  # Reuse this original save writer and producer fixture. Only Auth's ordinary
  # session bookkeeping columns are modelled; no provider or live identity use.
  sql(db,'ALTER TABLE auth.users ADD COLUMN recovery_sent_at timestamptz, ADD COLUMN recovery_token text, ADD COLUMN updated_at timestamptz')
  actor_id='10000000-0000-0000-0000-000000000001'
  actor_setup="SELECT set_config('test.actor','"+actor_id+"',false);SET ROLE authenticated;"
  def peer(label,body):
   return subprocess.Popen(base+['-d',db,'-Atc',"SET application_name='auth_fair_"+label+"';"+body],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,encoding='utf8')
  def wait_for(label,predicate):
   end=time.monotonic()+8
   while time.monotonic()<end:
    if sql(db,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='auth_fair_"+label+"' AND "+predicate+")::integer")[0].strip()=='1':return
    time.sleep(.03)
   raise RuntimeError('Expected local concurrency state absent: '+label+' '+predicate)
  def fairness(label,expect_timeout):
   sql(db,'UPDATE public.paige_durable_work SET chat_source_link=NULL WHERE id=public.test_chat_work()')
   peers=[]
   try:
    peers.append(peer(label+'_first',actor_setup+'BEGIN;SELECT public.test_chat_save();SELECT pg_sleep(2);COMMIT;'))
    wait_for(label+'_first',"wait_event='PgSleep'")
    peers.append(peer(label+'_auth',"SET statement_timeout='4s';UPDATE auth.users SET recovery_sent_at=clock_timestamp(),recovery_token='local-fixture-only',updated_at=clock_timestamp() WHERE id='"+actor_id+"';SELECT 'AUTH_COMPLETED';"))
    wait_for(label+'_auth','cardinality(pg_blocking_pids(pid))>0')
    peers.append(peer(label+'_later',actor_setup+'BEGIN;SELECT public.test_chat_save();SELECT pg_sleep(4);COMMIT;'))
    wait_for(label+'_later','cardinality(pg_blocking_pids(pid))>0')
    auth_out,auth_err=peers[1].communicate(timeout=7)
    if expect_timeout:
     if peers[1].returncode==0 or 'statement timeout' not in auth_err:raise RuntimeError('Old shared-lock cohort did not reproduce Auth starvation: '+auth_out+auth_err)
    else:
     if peers[1].returncode or 'AUTH_COMPLETED' not in auth_out:raise RuntimeError('Native Auth update failed behind later Knowledge caller: '+auth_err)
     wait_for(label+'_later',"wait_event='PgSleep'")
    first_out,first_err=peers[0].communicate(timeout=8)
    later_out,later_err=peers[2].communicate(timeout=8)
    if peers[0].returncode or peers[2].returncode:raise RuntimeError(first_err+later_err)
    refs=[json.loads(next(line for line in out.splitlines() if line.startswith('{'))) for out in (first_out,later_out)]
    if refs[0]!=refs[1] or refs[0]['reference']['linkRevision']!=1:raise RuntimeError('Concurrent host references or receipt revisions diverged')
   finally:
    for process in peers:
     if process.poll() is None:process.terminate();process.communicate(timeout=5)
   print('PASS: '+label+' actual save/Auth/later-save ordering and original single reference')
  fairness('old_shared_baseline',True)
  migration=root/a.auth_lock_migration
  release=root/a.containment_release_migration if a.containment_release_migration else None
  save_signature='public.save_paige_chat_knowledge_link(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer)'
  save_acl_query="SELECT proacl::text FROM pg_proc WHERE oid='"+save_signature+"'::regprocedure"
  original_save_acl=sql(db,save_acl_query)[0]
  if release:
   sql(db,'REVOKE EXECUTE ON FUNCTION '+save_signature+' FROM authenticated')
   paused_save_acl=sql(db,save_acl_query)[0]
   try:sql(db,file=release)
   except RuntimeError as error:
    if 'KNOWLEDGE_SAVE_AUTH_REPAIR_REQUIRED' not in str(error):raise
   else:raise RuntimeError('Save permission reopened before Auth repair')
   if sql(db,save_acl_query)[0]!=paused_save_acl:raise RuntimeError('Refused release changed paused ACL')
  before_lock_acl=sql(db,"SELECT proacl::text FROM pg_proc WHERE oid='public.lock_knowledge_extraction_authority(uuid,uuid)'::regprocedure")[0]
  for _ in range(2):sql(db,file=migration)
  if sql(db,"SELECT proacl::text FROM pg_proc WHERE oid='public.lock_knowledge_extraction_authority(uuid,uuid)'::regprocedure")[0]!=before_lock_acl:raise RuntimeError('Auth lock migration changed privileges')
  if release:
   for fault in [
    'ALTER FUNCTION public.lock_knowledge_extraction_authority(uuid,uuid) IMMUTABLE',
    'ALTER FUNCTION public.lock_knowledge_extraction_authority(uuid,uuid) RESET ALL',
    "UPDATE pg_proc SET proacl=NULL WHERE oid='public.lock_knowledge_extraction_authority(uuid,uuid)'::regprocedure",
   ]:
    # Catalog NULL is injected ONLY in the verified throwaway fixture, rolled back.
    run=subprocess.run(base+['-d',db],input='BEGIN;'+fault+';'+release.read_text(encoding='utf8')+'COMMIT;',cwd=root,text=True,capture_output=True,encoding='utf8')
    if run.returncode==0 or 'KNOWLEDGE_SAVE_AUTH_REPAIR_REQUIRED' not in run.stderr:raise RuntimeError('Noncanonical authority helper reopened save permission: '+fault)
   for fault in [
    'GRANT EXECUTE ON FUNCTION '+save_signature+' TO service_role',
    'ALTER FUNCTION '+save_signature+' SECURITY INVOKER',
   ]:
    run=subprocess.run(base+['-d',db],input='BEGIN;'+fault+';'+release.read_text(encoding='utf8')+'COMMIT;',cwd=root,text=True,capture_output=True,encoding='utf8')
    if run.returncode==0 or 'KNOWLEDGE_SAVE_CONTAINMENT_DRIFT' not in run.stderr:raise RuntimeError('Unexpected save source/ACL accepted: '+fault)
    if sql(db,save_acl_query)[0]!=paused_save_acl:raise RuntimeError('Refused drift changed paused ACL')
   for _ in range(2):sql(db,file=release)
   if sql(db,save_acl_query)[0]!=original_save_acl:raise RuntimeError('Containment release did not restore exact original ACL')
   print('PASS: pre-repair release refused; source/ACL drift refused; exact paused ACL restored and replayed')
  if a.auth_order_migration:
   # Original Setup scope and selection lock; only context projection/access ports
   # are modelled here. Full-schema Setup remains the existing CI proof.
   def original_function(path,name):
    source=(root/path).read_text(encoding='utf8')
    start=re.search(r'create or replace function public\.'+name+r'\(',source,re.I).start()
    delimiter=re.search(r'as\s+(\$(?:\w+)?\$)',source[start:],re.I)
    end=source.index(delimiter.group(1)+';',start+delimiter.end())+len(delimiter.group(1))+1
    return source[start:end]
   sql(db,"ALTER TABLE public.tenants ADD COLUMN owner_user_id uuid;CREATE TABLE public.tenant_setup_business_context_meta(tenant_id uuid PRIMARY KEY);INSERT INTO public.tenant_setup_business_context_meta SELECT id FROM public.tenants;CREATE FUNCTION public.solo_setup_assert_canonical_tenant() RETURNS uuid LANGUAGE sql AS $$SELECT public.current_user_tenant_id()$$;CREATE FUNCTION public.get_solo_business_context() RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('tenantId',public.current_user_tenant_id())$$;")
   sql(db,original_function('supabase/migrations/20261103000000_solo_setup_business_context.sql','solo_setup_lock_expected_tenant'))
   sql(db,original_function('supabase/migrations/20261046000000_solo_setup_persistence_repair.sql','solo_setup_access_scope'))
   sql(db,original_function('supabase/migrations/20271129010001_exp01_reviewed_setup_receipt_forward.sql','lock_solo_reviewed_setup_scope'))
   sql(db,'REVOKE ALL ON FUNCTION public.lock_solo_reviewed_setup_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role')
   sql(db,"UPDATE public.tenant_members SET role='admin' WHERE user_id='"+actor_id+"' AND tenant_id='00000000-0000-0000-0000-000000000001'") # disposable delegated Setup actor only
   t="'00000000-0000-0000-0000-000000000001'"
   extraction="(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='chat-pending')"
   publication='public.test_chat_work()'
   original_state=sql(db,"SELECT jsonb_agg(to_jsonb(w)) FROM public.paige_durable_work w WHERE id IN ("+extraction+","+publication+")")[0].strip()
   def reset_work():
    sql(db,"UPDATE public.paige_durable_work w SET status=x.status,terminal_outcome=x.terminal_outcome,settled_at=x.settled_at,dispatch_started_attempt=x.dispatch_started_attempt,attempt_count=x.attempt_count,lease_until=now()+interval '10 minutes',chat_source_link=NULL FROM jsonb_populate_recordset(NULL::public.paige_durable_work,'"+original_state.replace("'","''")+"'::jsonb) x WHERE w.id=x.id")
   cases=[
    ('extract_start',extraction,"UPDATE public.paige_durable_work SET status='claimed',dispatch_started_attempt=0,attempt_count=1 WHERE id="+extraction,"SELECT public.start_knowledge_extraction("+extraction+")",'SELECT public.test_chat_stage()'),
    ('extract_complete',extraction,"UPDATE public.paige_durable_work SET dispatch_started_attempt=attempt_count WHERE id="+extraction,"SELECT public.complete_knowledge_extraction(w.id,w.idempotency_key,w.attempt_count,(w.request_payload->>'revision')::integer,'Pending original source',w.request_payload->>'input_hash',NULL) FROM public.paige_durable_work w WHERE id="+extraction,'SELECT public.test_chat_stage()'),
    ('review',extraction,'',"SELECT public.lock_knowledge_review_target("+t+",d.id,d.extraction_work_id,d.revision) FROM public.tenant_knowledge_docs d WHERE extraction_work_id="+extraction,'SELECT public.test_chat_stage()'),
    ('publish_start',publication,"UPDATE public.paige_durable_work SET status='claimed',terminal_outcome=NULL,settled_at=NULL WHERE id="+publication,"SELECT public.start_knowledge_publication("+publication+")",'SELECT public.test_chat_save()'),
    ('publish_stage',publication,'',"SELECT public.stage_knowledge_publication(w.id,w.idempotency_key,w.attempt_count,(w.request_payload->>'revision')::integer,'[]') FROM public.paige_durable_work w WHERE id="+publication,'SELECT public.test_chat_save()'),
    ('publish_complete',publication,"UPDATE public.paige_durable_work SET status='claimed',terminal_outcome=NULL,settled_at=NULL,dispatch_started_attempt=attempt_count WHERE id="+publication,"SELECT public.complete_knowledge_publication(w.id,w.idempotency_key,w.attempt_count,(w.request_payload->>'revision')::integer) FROM public.paige_durable_work w WHERE id="+publication,'SELECT public.test_chat_save()'),
    ('setup',None,'',"SELECT public.lock_solo_reviewed_setup_scope("+t+",'"+actor_id+"')",'SELECT public.test_chat_save()'),
   ]
   def ordering(label,expect_cycle):
    for name,target,preparation,operation,chat in cases:
     reset_work()
     if preparation:sql(db,preparation)
     peers=[]
     try:
      prefix=label+'_'+name
      peers.append(peer(prefix+'_gate',"BEGIN;SELECT 1 FROM auth.users WHERE id='"+actor_id+"' FOR NO KEY UPDATE;SELECT pg_sleep(3);COMMIT;"))
      wait_for(prefix+'_gate',"wait_event='PgSleep'")
      peers.append(peer(prefix+'_chat',actor_setup+"BEGIN;SET LOCAL statement_timeout='8s';"+chat+';ROLLBACK;'))
      wait_for(prefix+'_chat','cardinality(pg_blocking_pids(pid))>0')
      peers.append(peer(prefix+'_native',"SELECT set_config('test.actor','"+actor_id+"',false);BEGIN;SET LOCAL statement_timeout='8s';"+operation+';ROLLBACK;'))
      try:wait_for(prefix+'_native','cardinality(pg_blocking_pids(pid))>0')
      except RuntimeError:
       if peers[-1].poll() is not None:raise RuntimeError('Native call exited before lock: '+peers[-1].communicate()[1])
       raise
      outputs=[process.communicate(timeout=12) for process in peers]
      errors='\n'.join(err for out,err in outputs)
      cycle='deadlock detected' in errors
      if cycle!=expect_cycle or 'statement timeout' in errors:raise RuntimeError('Unexpected '+prefix+' ordering: '+errors)
      allowed=('CHAT_KNOWLEDGE_SOURCE_UNAVAILABLE','KNOWLEDGE_REVISION_CONFLICT','KNOWLEDGE_PUBLICATION_NOT_READY','KNOWLEDGE_PUBLICATION_WORK_NOT_FOUND','CHAT_KNOWLEDGE_SOURCE_CHANGED','CHAT_KNOWLEDGE_SOURCE_NOT_READY','KNOWLEDGE_REVIEW_NOT_READY','KNOWLEDGE_WORK_NOT_CLAIMABLE')
      for process,(out,err) in zip(peers,outputs):
       if process.returncode and not ('deadlock detected' in err or any(code in err for code in allowed)):raise RuntimeError('Unexpected native refusal '+prefix+': '+err)
      print('PASS: '+prefix+(' original native deadlock reproduced' if cycle else ' native overlap completes or preserves original safe refusal'))
     finally:
      for process in peers:
       if process.poll() is None:process.terminate();process.communicate(timeout=5)
   # Exact native publication replay versus native recovery, which deliberately
   # does not acquire the interactive actor mutex. No provider is called.
   sql(db,"SELECT set_config('test.actor','"+actor_id+"',false);INSERT INTO public.extract_test VALUES('pub-order',public.test_extract('70000000-0000-4000-8000-000000000091',NULL,NULL,'Recovery ordering source'),NULL);UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='pub-order';SELECT public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Recovery ordering source',started->>'input_hash') FROM public.extract_test WHERE name='pub-order';SELECT public.save_tenant_knowledge_review("+t+",(result->>'document_id')::uuid,(result->>'work_id')::uuid,2,'Recovery ordering source','{\"title\":\"Recovery ordering source\",\"summary\":null,\"category\":null,\"tags\":[]}') FROM public.extract_test WHERE name='pub-order';UPDATE public.extract_test SET started=started||jsonb_build_object('publication',public.submit_tenant_knowledge_publication("+t+",(result->>'document_id')::uuid,(result->>'work_id')::uuid,3,'60000000-0000-4000-8000-000000000091',encode(sha256(convert_to('Recovery ordering source','UTF8')),'hex'))) WHERE name='pub-order';")
   pub_order="(SELECT (started#>>'{publication,work_id}')::uuid FROM public.extract_test WHERE name='pub-order')"
   order_doc="(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='pub-order')"
   replay="SELECT public.submit_tenant_knowledge_publication("+t+",(result->>'document_id')::uuid,(result->>'work_id')::uuid,3,'60000000-0000-4000-8000-000000000091',encode(sha256(convert_to('Recovery ordering source','UTF8')),'hex')) FROM public.extract_test WHERE name='pub-order'"
   def publication_recovery(label,expect_cycle):
    sql(db,"UPDATE public.paige_durable_work SET lease_until=now()+interval '10 minutes' WHERE status IN ('claimed','expired');UPDATE public.paige_durable_work SET lease_until=now()-interval '1 minute',dispatch_started_attempt=0 WHERE id="+pub_order)
    count=lambda:int(sql(db,"SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()")[0])
    before=count();peers=[]
    try:
     peers.append(peer(label+'_doc',"BEGIN;SELECT 1 FROM public.tenant_knowledge_docs WHERE id="+order_doc+" FOR UPDATE;SELECT pg_sleep(3);ROLLBACK;"))
     wait_for(label+'_doc',"wait_event='PgSleep'")
     peers.append(peer(label+'_replay',actor_setup+"BEGIN;SET LOCAL statement_timeout='8s';"+replay+';ROLLBACK;'))
     wait_for(label+'_replay','cardinality(pg_blocking_pids(pid))>0')
     peers.append(peer(label+'_recover',"BEGIN;SET LOCAL statement_timeout='8s';SELECT public.recover_knowledge_publication(25);ROLLBACK;"))
     if expect_cycle:wait_for(label+'_recover','cardinality(pg_blocking_pids(pid))>0')
     else:
      skipped_out,skipped_err=peers[-1].communicate(timeout=2)
      if peers[-1].returncode or re.search(r'[0-9a-f]{8}-[0-9a-f-]{27,}',skipped_out):raise RuntimeError('Native recovery did not safely skip replay-locked Work: '+skipped_err)
     results=[process.communicate(timeout=12) for process in peers]
     errors='\n'.join(err for out,err in results)
     if 'statement timeout' in errors:raise RuntimeError('Publication replay/recovery stalled: '+errors)
     # Recovery catches SQL exceptions; native database statistics reveal a
     # deadlock even when the recovery victim intentionally returns safely.
     until=time.monotonic()+3
     while count()==before and time.monotonic()<until:time.sleep(.05)
     cycle=count()>before
     if cycle!=expect_cycle:raise RuntimeError('Wrong publication replay/recovery deadlock result '+label+': '+errors)
     for process,(out,err) in zip(peers,results):
      if process.returncode and 'deadlock detected' not in err:raise RuntimeError('Unexpected replay/recovery refusal: '+err)
    finally:
     for process in peers:
      if process.poll() is None:process.terminate();process.communicate(timeout=5)
    if not expect_cycle:
     recovered=sql(db,"BEGIN;SELECT public.recover_knowledge_publication(25);ROLLBACK;")[0]
     target_id=sql(db,'SELECT '+pub_order)[0].strip()
     if recovered.count(target_id)!=1:raise RuntimeError('Skipped publication Work was not recoverable afterward')
    print('PASS: '+label+(' native replay/recovery deadlock reproduced' if cycle else ' same-intent replay and native recovery both finish without deadlock'))
   publication_recovery('document_first_baseline',True)
   ordering('work_first_baseline',True)
   order_migration=root/a.auth_order_migration
   order_snapshot="SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE proname IN ('submit_tenant_knowledge_publication','start_knowledge_extraction','complete_knowledge_extraction','lock_knowledge_review_target','start_knowledge_publication','stage_knowledge_publication','complete_knowledge_publication','lock_solo_reviewed_setup_scope')"
   before_order=sql(db,order_snapshot)[0]
   for fault in [
    'ALTER FUNCTION public.lock_solo_reviewed_setup_scope(uuid,uuid) RESET ALL',
    'GRANT EXECUTE ON FUNCTION public.lock_solo_reviewed_setup_scope(uuid,uuid) TO authenticated',
    "CREATE OR REPLACE FUNCTION public.lock_solo_reviewed_setup_scope(p_tenant uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN RETURN NULL; END $$",
   ]:
    result=subprocess.run(base+['-d',db],input='BEGIN;'+fault+';'+order_migration.read_text(encoding='utf8')+'COMMIT;',cwd=root,text=True,capture_output=True,encoding='utf8')
    if result.returncode==0 or 'KNOWLEDGE_AUTH_ORDER_' not in result.stderr:raise RuntimeError('Forward ordering drift not refused: '+fault+result.stderr)
    if sql(db,order_snapshot)[0]!=before_order:raise RuntimeError('Forward ordering drift refusal failed to roll back earlier replacements')
   print('PASS: forward ordering source/config/ACL drift refuses atomically before partial release')
   for _ in range(2):sql(db,file=order_migration)
   ordering('auth_first_candidate',False)
   publication_recovery('work_before_document_candidate',False)
   reset_work()
   # Different actors sharing one tenant must not take SHARE then upgrade UPDATE.
   second_actor='10000000-0000-0000-0000-000000000099'
   sql(db,"INSERT INTO auth.users(id) VALUES('"+second_actor+"');INSERT INTO public.profiles VALUES('"+second_actor+"',"+t+");INSERT INTO public.tenant_members VALUES("+t+",'"+second_actor+"','active','admin',false)")
   holders=[]
   try:
    holders.append(peer('setup_actor_one',"SELECT set_config('test.actor','"+actor_id+"',false);BEGIN;SELECT public.lock_solo_reviewed_setup_scope("+t+",'"+actor_id+"');SELECT pg_sleep(2);ROLLBACK;"))
    wait_for('setup_actor_one',"wait_event='PgSleep'")
    holders.append(peer('setup_actor_two',"SELECT set_config('test.actor','"+second_actor+"',false);BEGIN;SET LOCAL statement_timeout='5s';SELECT public.lock_solo_reviewed_setup_scope("+t+",'"+second_actor+"');ROLLBACK;"))
    wait_for('setup_actor_two','cardinality(pg_blocking_pids(pid))>0')
    for process in holders:
     out,err=process.communicate(timeout=8)
     if process.returncode:raise RuntimeError('Different-actor Setup overlap failed: '+err)
   finally:
    for process in holders:
     if process.poll() is None:process.terminate();process.communicate(timeout=5)
   print('PASS: original Setup scope preserves profile/tenant order across two actors in one tenant (context projection ports modelled)')
  fairness('serialized_candidate',False)
  # A committed ban or soft deletion still wins before a later save. The exact
  # original authorization predicate runs after the same actor-row lock.
  for field,value in [('banned_until',"clock_timestamp()+interval '1 hour'"),('deleted_at','clock_timestamp()')]:
   sql(db,'UPDATE auth.users SET banned_until=NULL,deleted_at=NULL')
   holder=peer(field+'_holder',"BEGIN;UPDATE auth.users SET "+field+'='+value+" WHERE id='"+actor_id+"';SELECT pg_sleep(1);COMMIT;")
   waiter=None
   try:
    wait_for(field+'_holder',"wait_event='PgSleep'")
    waiter=peer(field+'_save',actor_setup+'SELECT public.test_chat_save();')
    wait_for(field+'_save','cardinality(pg_blocking_pids(pid))>0')
    holder.communicate(timeout=6);out,err=waiter.communicate(timeout=6)
    if holder.returncode or waiter.returncode==0 or 'CHAT_KNOWLEDGE_SCOPE_CHANGED' not in err:raise RuntimeError('Auth ban/deletion barrier lost: '+field+err)
   finally:
    for process in [holder,waiter]:
     if process and process.poll() is None:process.terminate();process.communicate(timeout=5)
   print('PASS: native save refuses after committed '+field)
  sql(db,'UPDATE auth.users SET banned_until=NULL,deleted_at=NULL')
  holder=peer('other_user_holder',actor_setup+'BEGIN;SELECT public.test_chat_save();SELECT pg_sleep(2);COMMIT;')
  try:
   wait_for('other_user_holder',"wait_event='PgSleep'")
   out,_=sql(db,"SET statement_timeout='500ms';SELECT public.lock_knowledge_extraction_authority('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003')")
   if out.strip().splitlines()[-1]!='t':raise RuntimeError('Unrelated actor lost independent authority')
   # Cancellation rolls back only the local fixture transaction and releases
   # its Auth lock. Never reuse this helper against a customer database.
   sql(db,"SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name='auth_fair_other_user_holder' AND wait_event='PgSleep'")
   holder.communicate(timeout=5)
   sql(db,"SET statement_timeout='500ms';UPDATE auth.users SET updated_at=clock_timestamp() WHERE id='"+actor_id+"'")
  finally:
   if holder.poll() is None:holder.terminate();holder.communicate(timeout=5)
  print('PASS: different actors remain independent; canceled save releases Auth lock')
 actor="SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);"
 def reset():
  sql(db,"UPDATE public.paige_durable_work SET chat_source_link=NULL WHERE id=public.test_chat_work() OR id=(SELECT (result->>'work_id')::uuid FROM public.extract_test WHERE name='chat');UPDATE public.tenant_members SET status='active' WHERE user_id='10000000-0000-0000-0000-000000000001'")
 def observe(predicate):
  until=time.monotonic()+12
  while time.monotonic()<until:
   if sql(db,'SELECT ('+predicate+')::integer')[0].strip()=='1':return
   time.sleep(.04)
  raise RuntimeError('Native lock wait was not observed: '+predicate)
 def race(name,first,second,expected,second_authenticated=True):
  reset();peers=[];threads_before=int(sql(db,'SELECT count(*) FROM public.paige_chat_threads')[0])
  try:
   peers.append(subprocess.Popen(base+['-d',db,'-Atc',"SET application_name='e01_host_"+name+"_a';"+actor+'BEGIN;'+first+';SELECT pg_sleep(3);COMMIT;'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,encoding='utf8'))
   observe("EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='e01_host_"+name+"_a' AND wait_event='PgSleep')")
   peers.append(subprocess.Popen(base+['-d',db,'-Atc',"SET application_name='e01_host_"+name+"_b';"+actor+('SET ROLE authenticated;' if second_authenticated else '')+second],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,encoding='utf8'))
   observe("EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='e01_host_"+name+"_b' AND cardinality(pg_blocking_pids(pid))>0)")
   outputs=[peer.communicate(timeout=15) for peer in peers]
   if peers[0].returncode:raise RuntimeError('First race session failed: '+outputs[0][1])
   if expected is None or expected=='shared_thread':
    if peers[1].returncode:raise RuntimeError('Second race session failed: '+outputs[1][1])
    refs=[json.loads(next(line for line in out.splitlines() if line.startswith('{'))) for out,err in outputs]
    if expected is None:
     if refs[0]!=refs[1] or refs[0]['reference']['linkRevision']!=1:raise RuntimeError('Same-intent race produced different references or duplicate host revisions')
    else:
     if refs[0]['reference']['threadId']!=refs[1]['reference']['threadId']:raise RuntimeError('Intake/publication observers created different conversations')
     if int(sql(db,'SELECT count(*) FROM public.paige_chat_threads')[0])!=threads_before+1:raise RuntimeError('Intake/publication created duplicate conversations')
   elif peers[1].returncode==0 or expected not in outputs[1][1]:raise RuntimeError('Race did not refuse '+expected+': '+str(outputs[1]))
  finally:
   for peer in peers:
    if peer.poll() is None:peer.terminate();peer.communicate(timeout=5)
  print('PASS: observed native blocking pair',name)
 race('same_intent','SET LOCAL ROLE authenticated;SELECT public.test_chat_save()','SELECT public.test_chat_save()',None)
 race('intake_first',"SET LOCAL ROLE authenticated;SELECT public.test_chat_stage('chat',NULL)",'SELECT public.test_chat_save(NULL,0,NULL,NULL)','shared_thread')
 race('publication_first','SET LOCAL ROLE authenticated;SELECT public.test_chat_save(NULL,0,NULL,NULL)',"SELECT public.test_chat_stage('chat',NULL)",'shared_thread')
 race('revoke_first',"UPDATE public.tenant_members SET status='inactive' WHERE user_id='10000000-0000-0000-0000-000000000001'",'SELECT public.test_chat_save()','CHAT_KNOWLEDGE_SCOPE_CHANGED')
 race('source_first',"UPDATE public.tenant_knowledge_docs SET summary='Committed changed revision' WHERE id=(SELECT (result->>'document_id')::uuid FROM public.extract_test WHERE name='chat')",'SELECT public.test_chat_save()','CHAT_KNOWLEDGE_SOURCE_CHANGED')
 print('PASS: 5 actual host concurrency waits; modeled identity/Chat dependency ports, not full-schema/customer proof')
finally:
 sql('postgres','DROP DATABASE '+db)
