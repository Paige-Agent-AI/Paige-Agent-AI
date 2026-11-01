"""Original Knowledge native functions in the existing local dependency fixture.
Not full-schema, authenticated customer, provider or UI proof.
"""
import argparse, pathlib, subprocess, uuid, ast, re, time, json
p=argparse.ArgumentParser()
p.add_argument('--psql',required=True);p.add_argument('--port',default='55461')
p.add_argument('--expected-data-directory',required=True);p.add_argument('--without-candidate',action='store_true')
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
 for fault in faults:
  run=subprocess.run(base+['-d',db],input='BEGIN;'+fault+';'+candidate,cwd=root,text=True,capture_output=True,encoding='utf8')
  if run.returncode==0 or 'CHAT_KNOWLEDGE_' not in run.stderr:raise RuntimeError('Install fault not refused: '+fault+' '+run.stderr[-2000:])
  if sql(db,snapshots)[0]!=before:raise RuntimeError('Refused install changed original eight function definitions/metadata')
 print('PASS:',len(faults),'installation source/config/permission/storage/index faults refused and rolled back')
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
