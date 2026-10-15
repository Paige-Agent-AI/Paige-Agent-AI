// Additional contract cases in the EXISTING isolated PostgreSQL proof runner.
// No independent QA runtime, network, credential or production connection.
export const interviewCheckpointMigration = '20271107100000_solo_business_interview_checkpoint.sql';
export const interviewRealFunctions = [
  ['20270521000000_operator_authority_in_company_workspaces.sql', 'is_company_workspace'],
  ['20270521000000_operator_authority_in_company_workspaces.sql', 'is_tenant_owner'],
  ['20260803190000_slice_a_multi_owner_is_owner.sql', 'can_manage_tenant_brand'],
  ['20261019000000_solo_setup_business_brief.sql', 'get_solo_business_brief'],
  ['20261020020000_setup_a2p_legal_identity_contract.sql', 'get_solo_setup_identity'],
  ['20261046000000_solo_setup_persistence_repair.sql', 'save_solo_business_brief'],
  ['20261046000000_solo_setup_persistence_repair.sql', 'save_solo_setup_identity'],
  ['20261046000000_solo_setup_persistence_repair.sql', 'get_solo_setup_context'],
  ['20261046000000_solo_setup_persistence_repair.sql', 'save_solo_setup_context'],
  ['20261020100000_chat_turn_append_tenant_scope.sql', 'paige_chat_turn_append'],
  ['20270601000008_int346_server_issued_interactive_receipts.sql', 'paige_chat_turn_authority_guard'],
  ['20270601000008_int346_server_issued_interactive_receipts.sql', 'paige_chat_interactive_evidence'],
  ['20270602000301_int346_conversational_admission.sql', 'paige_chat_interactive_columns_guard'],
  ['20270602000301_int346_conversational_admission.sql', 'paige_chat_interactive_begin_v2'],
  ['20270602000301_int346_conversational_admission.sql', 'paige_chat_interactive_settle'],
];

export async function runInterviewCheckpointProof({psql,json,asUser,rejected,test,assert,tid,uid,sqlJson,read,extract,onMigrationApplied}) {
  const source = name => `supabase/migrations/${name}`;
  const thread = n => `50000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const turn = n => `60000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const tableDefinition = (path,name) => {
    const text = read(path);
    const start = text.search(new RegExp(`create table(?: if not exists)? public\\.${name}\\s*\\(`,'i'));
    const end = text.indexOf('\n);',start);
    assert(start>=0&&end>start,`Tracked table definition unavailable: ${name}`);
    return text.slice(start,end+3);
  };
  await psql(read('scripts/solo-setup-db-proof/interview-fixture.sql'));
  const tables = ['tenant_business_owners','tenant_business_representatives','tenant_setup_private_context'];
  await psql(tables.map(name=>tableDefinition(source('20261046000000_solo_setup_persistence_repair.sql'),name)).join('\n'));
  await psql(['paige_chat_threads','paige_chat_turns'].map(name=>tableDefinition(source('20260703150050_cf6dc6ae-b904-4fe3-98b6-3f23ff8567b9.sql'),name)).join('\n'));
  await psql(`alter table public.paige_chat_threads alter column tenant_id drop not null;
    alter table public.paige_chat_threads add column studio_session_id uuid;
    alter table public.paige_chat_threads add column interactive_latest_intent uuid;
    alter table public.paige_chat_threads add column interactive_executor_intent uuid;
    alter table public.paige_chat_threads add column interactive_admission text;
    alter table public.paige_chat_turns add column seq bigserial;
    alter table public.paige_chat_turns add column tool_calls jsonb;
    alter table public.paige_chat_turns add column work_id uuid;
    alter table public.paige_chat_turns add column interactive_intent_id uuid;
    alter table public.paige_chat_turns add column interactive_actor_id uuid;
    alter table public.paige_chat_turns add column interactive_tenant_id uuid;
    alter table public.paige_chat_turns add column interactive_terminal_state text;
    alter table public.paige_chat_turns add column interactive_supersedes_id uuid;
    create index idx_paige_chat_turns_thread_seq on public.paige_chat_turns(thread_id,seq);
    revoke all on public.paige_chat_turns from public,anon,authenticated;
    grant select on public.paige_chat_turns to authenticated;
    alter table public.paige_chat_turns enable row level security;`);
  await psql(tableDefinition(source('20270601000008_int346_server_issued_interactive_receipts.sql'),'paige_chat_interactive_rollout'));
  await psql(`alter table public.paige_chat_interactive_rollout enable row level security;
    revoke all on public.paige_chat_interactive_rollout from public,anon,authenticated,service_role;
    insert into public.paige_chat_interactive_rollout(singleton,active) values(true,false);`);
  await psql('drop function public.save_solo_setup_context(jsonb,jsonb,text,uuid);');
  await psql(interviewRealFunctions.map(([name,fn])=>extract(source(name),fn)).join('\n'));
  await psql(`revoke all on function public.paige_chat_turn_authority_guard(),public.paige_chat_interactive_columns_guard() from public,anon,authenticated,service_role;
    revoke all on function public.paige_chat_interactive_evidence(uuid,uuid,uuid,uuid),public.paige_chat_interactive_settle(uuid,uuid,uuid,uuid,text,text[],text,jsonb,jsonb) from public,anon,authenticated;
    grant execute on function public.paige_chat_interactive_evidence(uuid,uuid,uuid,uuid),public.paige_chat_interactive_settle(uuid,uuid,uuid,uuid,text,text[],text,jsonb,jsonb) to service_role;
    revoke all on function public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean) from public,anon;
    grant execute on function public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean) to authenticated;
    create trigger paige_chat_turn_authority_guard before insert or update on public.paige_chat_turns for each row execute function public.paige_chat_turn_authority_guard();
    create trigger paige_chat_interactive_columns_guard before insert or update on public.paige_chat_threads for each row execute function public.paige_chat_interactive_columns_guard();
    grant all on public.paige_chat_turns to service_role;`);
  await psql(`grant execute on function public.get_solo_business_brief(),public.get_solo_setup_identity(),public.get_solo_setup_context(),public.save_solo_setup_context(jsonb,jsonb,text,uuid) to authenticated;
    revoke all on function public.save_solo_business_brief(jsonb,text,uuid),public.save_solo_setup_identity(jsonb,text,uuid) from public,anon,authenticated;
    insert into public.paige_chat_threads(id,caller_user_id,tenant_id,lens,title)
      select '${thread(1)}','${uid(1)}','${tid(1)}','coach','Test owner interview';
    insert into public.paige_chat_threads(id,caller_user_id,tenant_id,lens,title)
      select ('50000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
        ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
        ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'coach','Test interview'
      from generate_series(2,8)n;
    insert into public.paige_chat_threads(id,caller_user_id,tenant_id,lens) values
      ('${thread(9)}','${uid(9)}','${tid(1)}','coach'),('${thread(10)}','${uid(10)}','${tid(1)}','coach');`);
  const get = (actor,id=1) => json(asUser(actor,`select coalesce(public.get_solo_business_interview_checkpoint('${thread(id)}'),'null'::jsonb);`));
  const saveSql = (id,tenant,position,revision=null) => `select public.save_solo_business_interview_checkpoint('${thread(id)}','${tid(tenant)}',${sqlJson(position)},${revision===null?'null':revision});`;
  const save = (actor,id,tenant,position,revision=null) => json(asUser(actor,saveSql(id,tenant,position,revision)));
  const position = {phase:'active',nextField:'industry'};
  const snapshot = () => json(`select jsonb_build_object('thread',(select to_jsonb(t) from public.paige_chat_threads t where id='${thread(1)}'),
    'turns',(select jsonb_agg(to_jsonb(t) order by seq) from public.paige_chat_turns t where thread_id='${thread(1)}'));`);
  await test('checkpoint baseline: existing source has no checkpoint contract',async()=>{
    await rejected(asUser(1,`select public.get_solo_business_interview_checkpoint('${thread(1)}');`),'42883');
  });
  await test('checkpoint forward migration applies twice to isolated real PostgreSQL',async()=>{
    await psql(read(source(interviewCheckpointMigration)));
    onMigrationApplied(interviewCheckpointMigration);
    await psql(read(source(interviewCheckpointMigration)));
  });
  await test('checkpoint first use returns empty and refuses synthetic turn creation',async()=>{
    assert(await get(1)===null,'First-use checkpoint was fabricated');
    const before=await snapshot();
    await rejected(asUser(1,saveSql(1,1,position)),'55000');
    assert(JSON.stringify(before)===JSON.stringify(await snapshot()),'Empty save created a turn/thread effect');
  });
  await test('checkpoint ACL denies anonymous service and direct private-helper callers',async()=>{
    for(const role of ['anon','service_role']) {
      await rejected(`set role ${role}; select public.get_solo_business_interview_checkpoint('${thread(1)}');`,'42501');
      await rejected(`set role ${role}; ${saveSql(1,1,position)}`,'42501');
    }
    await rejected(`set role authenticated; select public.get_solo_business_interview_checkpoint('${thread(1)}');`,'42501');
    await rejected(asUser(1,`select public.solo_business_interview_assert_thread('${thread(1)}','${tid(1)}');`),'42501');
  });
  const metadata={turn_state:{state:'ASK_USER'},paige_ask:{ask_id:'test-ask',question:'Tell me about your business'},paige_resume:{key:'answer:test-ask'},approval:{id:'test-approval'}};
  const userMetadata={paige_resume:{key:'answer:test-ask'},interactive:{request_intent_id:'70000000-0000-0000-0000-000000000010'},unchanged:'owner-reply'};
  await psql(`insert into public.paige_chat_turns(id,thread_id,role,content,bundle_ref) values
    ('${turn(1)}','${thread(1)}','user','An operational business answer',${sqlJson({unchanged:'first-turn'})}),
    ('${turn(2)}','${thread(1)}','assistant','A question pending the owner reply',${sqlJson(metadata)}),
    ('${turn(3)}','${thread(1)}','user','An answer in the same interview',${sqlJson(userMetadata)});`);
  await test('checkpoint persists only latest genuine user namespace and preserves ask/approval/transcript/thread fields',async()=>{
    const before=await snapshot();
    const saved=await save(1,1,1,position);
    const actual=await get(1); // New connection: committed source read.
    assert(saved.sourceTurnId===turn(3)&&saved.sourceTurnSeq===3,'Checkpoint source not the actual newest genuine user turn');
    assert(actual.phase==='active'&&actual.nextField==='industry'&&actual.tenantId===tid(1),'Checkpoint did not persist');
    const after=await snapshot();
    assert(JSON.stringify(before.thread)===JSON.stringify(after.thread),'Checkpoint changed thread retention/count/timestamps');
    assert(after.turns.length===before.turns.length,'Checkpoint appended a turn');
    for(let n=0;n<before.turns.length;n++) {
      const original={...before.turns[n]};const updated={...after.turns[n]};
      delete original.bundle_ref;delete updated.bundle_ref;
      assert(JSON.stringify(original)===JSON.stringify(updated),'Checkpoint edited transcript/source fields');
    }
    const unrelated={...after.turns[2].bundle_ref};delete unrelated.solo_business_interview;
    assert(Object.keys(unrelated).length===Object.keys(userMetadata).length,'Checkpoint changed unrelated key set');
    for(const key of Object.keys(userMetadata)) assert(JSON.stringify(unrelated[key])===JSON.stringify(userMetadata[key]),`Checkpoint corrupted ${key}`);
    assert(JSON.stringify(before.turns[0])===JSON.stringify(after.turns[0]),'Checkpoint edited earlier turn');
    assert(JSON.stringify(before.turns[1])===JSON.stringify(after.turns[1]),'Checkpoint edited assistant/ask/approval row');
  });
  await test('checkpoint replay and two concurrent identical writes are harmless',async()=>{
    const before=await snapshot();
    const repeated=await Promise.all([save(1,1,1,position),save(1,1,1,position)]);
    assert(repeated[0].checkpointUpdatedAt===repeated[1].checkpointUpdatedAt,'Replay rewrote checkpoint clock');
    assert(JSON.stringify(before)===JSON.stringify(await snapshot()),'Replay mutated other state');
  });
  await test('checkpoint pause resume and complete retain the same private thread',async()=>{
    const paused=await save(1,1,1,{phase:'paused',nextField:'offers'});
    assert(paused.phase==='paused'&&paused.threadId===thread(1),'Pause not persisted');
    const active=await save(1,1,1,{phase:'active',nextField:'offers'});
    assert(active.phase==='active'&&active.threadId===paused.threadId,'Resume forked thread');
    const completed=await save(1,1,1,{phase:'completed',nextField:null});
    assert(completed.phase==='completed'&&completed.nextField===null,'Completion malformed');
  });
  await test('checkpoint input refuses values raw conversation authority foreign fields and invalid types atomically',async()=>{
    const before=await snapshot();
    const inputs=[null,[],{}, {phase:'active'}, {nextField:'industry'},
      {phase:'active',nextField:'industry',approved:true},{phase:'active',nextField:'industry',value:'private business'},
      {phase:'active',nextField:'industry',conversation:'private words'}, {phase:'active',nextField:'legalName'},
      {phase:'active',nextField:{value:'industry'}},{phase:null,nextField:null},{phase:'confirmed',nextField:null},
      {phase:'completed',nextField:'industry'}];
    for(const input of inputs) await rejected(asUser(1,saveSql(1,1,input)),'22023');
    assert(JSON.stringify(before)===JSON.stringify(await snapshot()),'Invalid position left mutation');
  });
  await test('checkpoint accepts only canonical operational pointers and metadata never writes business facts',async()=>{
    const brand=await json(`select brand from public.tenants where id='${tid(1)}';`);
    for(const nextField of ['publicName','industry','offers','deliveryModel','idealCustomer','currentPriority','goals90Day','constraints','operatingPreferences','doNotAssume',null]) {
      const saved=await save(1,1,1,{phase:'active',nextField});
      assert(saved.nextField===nextField,'Canonical pointer did not round-trip');
      assert(Object.keys(saved).sort().join(',')==='checkpointUpdatedAt,contextRevisionAtCheckpoint,nextField,phase,sourceTurnId,sourceTurnSeq,tenantId,threadId','Raw metadata/content or business values escaped');
    }
    assert(JSON.stringify(brand)===JSON.stringify(await json(`select brand from public.tenants where id='${tid(1)}';`)),'Position granted or wrote business truth');
  });
  await test('checkpoint owner role tenant thread and non-Solo isolation refuse without effect',async()=>{
    const before=await snapshot();
    for(const actor of [9,10]) {
      await rejected(asUser(actor,`select public.get_solo_business_interview_checkpoint('${thread(actor)}');`),'42501');
      await rejected(asUser(actor,saveSql(actor,1,position)),'42501');
    }
    for(const actor of [3,4,5,6,7,8]) await rejected(asUser(actor,saveSql(actor,actor,position)),'42501');
    await rejected(asUser(2,`select public.get_solo_business_interview_checkpoint('${thread(1)}');`),'42501');
    await rejected(asUser(2,saveSql(1,2,position)),'42501');
    await rejected(asUser(1,saveSql(1,2,position)),'40001');
    await rejected(asUser(1,`select public.get_solo_business_interview_checkpoint('${thread(999)}');`),'42501');
    assert(JSON.stringify(before)===JSON.stringify(await snapshot()),'Forbidden checkpoint changed data');
  });
  await test('checkpoint refuses archived client Studio platform and inactive tenant shapes',async()=>{
    for(const assignment of ["is_archived=true", "lens='client'", "lens='platform',tenant_id=null", "studio_session_id='70000000-0000-0000-0000-000000000001'"]) {
      await psql(`update public.paige_chat_threads set ${assignment} where id='${thread(1)}';`);
      await rejected(asUser(1,saveSql(1,1,position)),'42501');
      await rejected(asUser(1,`select public.get_solo_business_interview_checkpoint('${thread(1)}');`),'42501');
      await psql(`update public.paige_chat_threads set is_archived=false,lens='coach',tenant_id='${tid(1)}',studio_session_id=null where id='${thread(1)}';`);
    }
    await psql(`insert into public.clients(id) values('70000000-0000-0000-0000-000000000001'); update public.paige_chat_threads set contact_id='70000000-0000-0000-0000-000000000001' where id='${thread(1)}';`);
    await rejected(asUser(1,saveSql(1,1,position)),'42501');
    await psql(`update public.paige_chat_threads set contact_id=null where id='${thread(1)}';`);
    for(const assignment of ["status='suspended'","archived_at=now()","lifecycle_execution_paused=true"]) {
      await psql(`update public.tenants set ${assignment} where id='${tid(1)}';`);
      await rejected(asUser(1,saveSql(1,1,position)),'42501');
      await psql(`update public.tenants set status='active',archived_at=null,lifecycle_execution_paused=false where id='${tid(1)}';`);
    }
  });
  await test('checkpoint ownership revocation blocks despite lingering display owner and role',async()=>{
    await psql(`update public.tenant_members set is_owner=false where tenant_id='${tid(1)}' and user_id='${uid(1)}';`);
    await rejected(asUser(1,saveSql(1,1,position)),'42501');
    await rejected(asUser(1,`select public.get_solo_business_interview_checkpoint('${thread(1)}');`),'42501');
    await psql(`update public.tenant_members set is_owner=true,status='inactive' where tenant_id='${tid(1)}' and user_id='${uid(1)}';`);
    await rejected(asUser(1,saveSql(1,1,position)),'42501');
    await psql(`update public.tenant_members set status='active' where tenant_id='${tid(1)}' and user_id='${uid(1)}';`);
  });
  await test('checkpoint rejects malformed newest forged metadata without exposing raw payload or older fallback',async()=>{
    const valid=(await snapshot()).turns[2].bundle_ref;
    const malformed=[null,[],{...valid.solo_business_interview,approved:true},
      {...valid.solo_business_interview,sourceTurnId:turn(1)}, {...valid.solo_business_interview,nextField:'businessRegistrationNumber'},
      {...valid.solo_business_interview,contextRevisionAtCheckpoint:'confirmed'}, {...valid.solo_business_interview,phase:'granted'}];
    for(const checkpoint of malformed) {
      await psql(`update public.paige_chat_turns set bundle_ref=${sqlJson({...valid,solo_business_interview:checkpoint})} where id='${turn(3)}';`);
      assert(await get(1)===null,'Forged position trusted or old checkpoint revived');
    }
    await psql(`update public.paige_chat_turns set bundle_ref=${sqlJson(valid)} where id='${turn(3)}';`);
  });
  await test('checkpoint context revision is checked against actual sealed Setup meta',async()=>{
    const context=await json(asUser(1,'select public.get_solo_business_context();'));
    const saved=await save(1,1,1,position,context.contextRevision);
    assert(saved.contextRevisionAtCheckpoint===context.contextRevision,'Verified revision observation missing');
    const before=await snapshot();
    await rejected(asUser(1,saveSql(1,1,{phase:'paused',nextField:'offers'},context.contextRevision+1)),'40001');
    await rejected(asUser(1,saveSql(1,1,position,-1)),'22023');
    assert(JSON.stringify(before)===JSON.stringify(await snapshot()),'Unverified revision left mutation');
  });
  await test('checkpoint refuses threads containing only assistant system or protected receipt turns',async()=>{
    await psql(`insert into public.paige_chat_threads(id,caller_user_id,tenant_id,lens) values('${thread(14)}','${uid(1)}','${tid(1)}','coach');
      insert into public.paige_chat_turns(thread_id,role,content,bundle_ref) values('${thread(14)}','assistant','An existing greeting','{}'),('${thread(14)}','system','','{}');
      insert into public.paige_chat_turns(thread_id,role,content,work_id) values('${thread(14)}','user','A protected work source','70000000-0000-0000-0000-000000000014');`);
    assert(await get(1,14)===null,'Protected-only thread invented a resume position');
    const before=await json(`select jsonb_agg(to_jsonb(t) order by seq) from public.paige_chat_turns t where thread_id='${thread(14)}';`);
    await rejected(asUser(1,saveSql(14,1,position)),'55000');
    assert(JSON.stringify(before)===JSON.stringify(await json(`select jsonb_agg(to_jsonb(t) order by seq) from public.paige_chat_turns t where thread_id='${thread(14)}';`)),'No-safe-source refusal edited or appended protected rows');
  });

  await psql(`insert into auth.users values('${uid(11)}');
    insert into public.tenants(id,name,slug,account_type,owner_user_id) values('${tid(11)}','Test business','test-tenant-interview','standalone','${uid(11)}');
    insert into public.profiles values('${uid(11)}','${tid(11)}');
    insert into public.tenant_members(tenant_id,user_id,role,is_owner) values('${tid(11)}','${uid(11)}','owner',true);
    insert into public.paige_chat_threads(id,caller_user_id,tenant_id,lens) values('${thread(11)}','${uid(11)}','${tid(11)}','coach');`);
  const getContext=()=>json(asUser(11,'select public.get_solo_business_context();'));
  const canonicalSave = (brief,revision) => `select public.save_solo_business_context(_expected_tenant_id=>'${tid(11)}',_brief=>${sqlJson(brief)},_business_owners=>'[]'::jsonb,
    _primary_business_email=>null,_knowledge_sources=>'[]'::jsonb,_paige_profile=>'{}'::jsonb,_voice_examples=>'[]'::jsonb,
    _expected_primary_business_email=>null,_primary_business_email_decision=>null,
    _expected_updated_at=>${brief.updatedAt?`'${brief.updatedAt.replaceAll("'","''")}'`:'null'},_expected_context_revision=>${revision});`;
  let current;
  await test('actual canonical Setup owner save commits operational fact and fresh reader matches real brand record',async()=>{
    const initial=await getContext();
    await psql(asUser(11,canonicalSave({...initial.brief,publicName:'Test business',industry:'Professional services',offers:'Design consulting'},initial.contextRevision)));
    current=await getContext();
    assert(current.brief.industry==='Professional services'&&current.brief.offers==='Design consulting','Real canonical fields did not persist/read back');
    assert(current.contextRevision===initial.contextRevision+1,'Real Setup revision did not advance');
    assert(current.brief.provenance.industry.source==='owner_confirmed','Canonical writer did not stamp reviewed provenance');
    const brand=await json(`select brand->'business_brief' from public.tenants where id='${tid(11)}';`);
    assert(brand.industry===current.brief.industry&&brand.offers===current.brief.offers,'Fresh reader disagrees with stored Setup record');
    assert(await json(`select count(*) from public.fixture_base_save_calls where tenant_id='${tid(11)}';`)===0,'Proof still used base save stub');
  });
  await test('actual correction updates canonical value preserves other facts and resumes the same real chat thread',async()=>{
    await psql(asUser(11,`select public.paige_chat_turn_append('${thread(11)}','user','Please correct my business industry',array[]::text[],null,null,null,null,'{}'::jsonb,null);`));
    await save(11,11,11,{phase:'active',nextField:'industry'},current.contextRevision);
    const beforeRevision=current.contextRevision;
    await psql(asUser(11,canonicalSave({...current.brief,industry:'Architecture services'},current.contextRevision)));
    current=await getContext();
    assert(current.brief.industry==='Architecture services'&&current.brief.offers==='Design consulting','Correction lost canonical or unrelated fact');
    assert(current.contextRevision===beforeRevision+1,'Correction revision missing');
    const staleHint=await get(11,11);
    assert(staleHint.contextRevisionAtCheckpoint===beforeRevision,'Checkpoint silently became current fact truth');
    await save(11,11,11,{phase:'paused',nextField:'goals90Day'},current.contextRevision);
    const resumed=await save(11,11,11,{phase:'active',nextField:'goals90Day'},current.contextRevision);
    assert(resumed.threadId===thread(11)&&resumed.contextRevisionAtCheckpoint===current.contextRevision,'Correction/resume lost thread or canonical revision observation');
    const fresh=await getContext();
    assert(fresh.brief.industry===current.brief.industry,'Resume relied on checkpoint rather than real canonical data');
  });
  await test('actual canonical stale correction refuses atomically before facts or checkpoint change',async()=>{
    const before=await getContext();const hint=await get(11,11);
    await rejected(asUser(11,canonicalSave({...before.brief,industry:'A stale correction'},before.contextRevision-1)),'40001');
    assert(JSON.stringify(before)===JSON.stringify(await getContext()),'Stale save altered real Setup');
    assert(JSON.stringify(hint)===JSON.stringify(await get(11,11)),'Stale save changed conversational checkpoint');
    await rejected(asUser(11,saveSql(11,11,position,before.contextRevision-1)),'40001');
  });
  await test('actual connection-sourced industry correction rejects adopt atomically and explicit override confirms fresh canonical truth',async()=>{
    // Fixture seeding simulates already-canonical connection provenance. It
    // does not invoke or establish any real provider connection.
    await psql(`update public.tenants set brand=jsonb_set(brand,'{business_brief,provenance,industry}',
      '{"source":"connection_sourced","confidence":"observed"}'::jsonb) where id='${tid(11)}';`);
    const observed=await getContext();
    assert(observed.brief.provenance.industry.source==='connection_sourced'&&observed.brief.provenance.industry.confidence==='observed','Connection provenance fixture was not canonically read');
    const canonicalSnapshot=()=>json(`select jsonb_build_object(
      'brand',(select brand from public.tenants where id='${tid(11)}'),
      'meta',(select to_jsonb(m) from public.tenant_setup_business_context_meta m where tenant_id='${tid(11)}'),
      'private',(select to_jsonb(p) from public.tenant_setup_private_context p where tenant_id='${tid(11)}'),
      'profile',(select to_jsonb(p) from public.tenant_setup_paige_profiles p where tenant_id='${tid(11)}'),
      'audit',(select jsonb_agg(to_jsonb(a) order by created_at,id) from public.paige_audit_log a where tenant_id='${tid(11)}'));`);
    const before=await canonicalSnapshot();const checkpoint=await get(11,11);
    const correctedIndustry='Engineering services';
    await rejected(asUser(11,canonicalSave({...observed.brief,industry:correctedIndustry,sourceDecisions:{industry:'adopt'}},observed.contextRevision)),'22023');
    assert(JSON.stringify(before)===JSON.stringify(await canonicalSnapshot()),'Changed connection fact with adopt left a partial canonical write');
    assert(JSON.stringify(observed)===JSON.stringify(await getContext()),'Refused adopt changed canonical readback');
    assert(JSON.stringify(checkpoint)===JSON.stringify(await get(11,11)),'Refused adopt changed conversational position');
    await psql(asUser(11,canonicalSave({...observed.brief,industry:correctedIndustry,sourceDecisions:{industry:'override'}},observed.contextRevision)));
    current=await getContext(); // Separate fresh connection after committed save.
    assert(current.brief.industry===correctedIndustry,'Explicit override did not persist corrected industry');
    assert(current.brief.offers===observed.brief.offers,'Industry override lost unrelated offers');
    assert(current.contextRevision===observed.contextRevision+1,'Industry override did not advance canonical revision');
    const provenance=current.brief.provenance.industry;
    assert(provenance.source==='owner_confirmed'&&provenance.confidence==='confirmed'&&typeof provenance.confirmedAt==='string','Explicit override did not stamp canonical Owner confirmation');
    const stored=await json(`select brand->'business_brief' from public.tenants where id='${tid(11)}';`);
    assert(stored.industry===current.brief.industry&&stored.offers===current.brief.offers&&stored.provenance.industry.source==='owner_confirmed','Fresh override readback disagrees with actual stored canonical record');
  });
  await test('current DRAINING typed user admission accepts checkpoint without changing intent columns or retry',async()=>{
    await psql(`insert into public.paige_chat_threads(id,caller_user_id,tenant_id,lens) values('${thread(13)}','${uid(11)}','${tid(11)}','coach');`);
    const intent='70000000-0000-0000-0000-000000000013';
    const beginSql=`select public.paige_chat_interactive_begin_v2('${thread(13)}','${intent}',null,'My operational business answer',false,false,false);`;
    const first=await json(asUser(11,beginSql));
    const before=await json(`select to_jsonb(t) from public.paige_chat_turns t where id='${first.turn_id}';`);
    assert(before.role==='user'&&before.interactive_intent_id===intent&&before.interactive_terminal_state===null,'Current typed user is not eligible');
    const saved=await save(11,13,11,{phase:'active',nextField:'industry'},current.contextRevision);
    assert(saved.sourceTurnId===first.turn_id,'Typed user checkpoint did not bind real source');
    const after=await json(`select to_jsonb(t) from public.paige_chat_turns t where id='${first.turn_id}';`);
    const original={...before};const updated={...after};delete original.bundle_ref;delete updated.bundle_ref;
    assert(JSON.stringify(original)===JSON.stringify(updated),'Checkpoint changed protected user authority/content columns');
    const unrelated={...after.bundle_ref};delete unrelated.solo_business_interview;
    assert(JSON.stringify(unrelated)===JSON.stringify(before.bundle_ref),'Checkpoint changed interactive request namespace');
    const retry=await json(asUser(11,beginSql));
    assert(retry.status==='accepted'&&retry.turn_id===first.turn_id,'Checkpoint broke normal typed user admission retry');
    assert(await json(`select count(*) from public.paige_chat_turns where thread_id='${thread(13)}';`)===1,'Typed retry duplicated user turn');
    await rejected(asUser(11,`select public.paige_chat_interactive_begin_v2('${thread(13)}','70000000-0000-0000-0000-000000000014',null,'A held effectful turn',false,false,true);`),'P0001');
    assert(await json('select to_jsonb(active) from public.paige_chat_interactive_rollout where singleton;')===false,'Checkpoint changed DRAINING admission gate');
  });
  await test('checkpoint leaves issued assistant receipt byte-identical and current settle replay returns same receipt',async()=>{
    const intent='70000000-0000-0000-0000-000000000013';
    const bundle={interactive:{request_intent_id:intent},turn_state:{v:1,state:'ASK_USER',mode:'fast_answer',rounds:1,tools:0},paige_ask:{ask_id:'test-issued-ask',question:'What would you like to improve?'}};
    const settle=`set role service_role; select public.paige_chat_interactive_settle('${thread(13)}','${uid(11)}','${tid(11)}','${intent}','A real stored follow-up question',null,null,${sqlJson(bundle)},null);`;
    const receipt=(await psql(settle)).stdout.trim();
    const before=await json(`select jsonb_build_object('receipt',(select to_jsonb(t) from public.paige_chat_turns t where id='${receipt}'),'thread',(select to_jsonb(t) from public.paige_chat_threads t where id='${thread(13)}'));`);
    const checkpoint=await save(11,13,11,{phase:'paused',nextField:'offers'},current.contextRevision);
    assert(checkpoint.sourceTurnId!==receipt,'Checkpoint selected an issued assistant receipt');
    const replay=(await psql(settle)).stdout.trim();
    assert(replay===receipt,'Current assistant settle replay changed/conflicted');
    const after=await json(`select jsonb_build_object('receipt',(select to_jsonb(t) from public.paige_chat_turns t where id='${receipt}'),'thread',(select to_jsonb(t) from public.paige_chat_threads t where id='${thread(13)}'));`);
    assert(JSON.stringify(before)===JSON.stringify(after),'Checkpoint/settle replay changed receipt or thread fields');
    await rejected(`set role service_role; update public.paige_chat_turns set bundle_ref='{}' where id='${receipt}';`,'42501');
    assert(await json('select to_jsonb(active) from public.paige_chat_interactive_rollout where singleton;')===false,'Receipt proof activated protected rollout');
  });
  await test('co-owner canonical Setup save and checkpoint serialize without meta/tenant deadlock',async()=>{
    await psql(`insert into auth.users values('${uid(12)}'); insert into public.profiles values('${uid(12)}','${tid(11)}');
      insert into public.tenant_members(tenant_id,user_id,role,is_owner) values('${tid(11)}','${uid(12)}','owner',true);`);
    const before=await getContext();
    const writer=psql(`set application_name='interview-coowner-proof'; begin;
      select 1 from public.tenant_setup_business_context_meta where tenant_id='${tid(11)}' for update;
      set role authenticated; set request.jwt.claim.sub='${uid(12)}'; select pg_sleep(2);
      ${canonicalSave({...before.brief,offers:'Concurrent owner correction'},before.contextRevision)} commit;`,true);
    let held=false;
    for(let attempt=0;attempt<20&&!held;attempt++) {
      held=await json("select to_jsonb(exists(select 1 from pg_stat_activity where application_name='interview-coowner-proof' and wait_event='PgSleep'));");
      if(!held) await new Promise(resolveDelay=>setTimeout(resolveDelay,50));
    }
    assert(held,'Could not establish controlled canonical meta-lock precondition');
    const checkpoint=psql(asUser(11,saveSql(11,11,{phase:'active',nextField:'offers'})),true);
    const completed=await Promise.all([writer,checkpoint]);
    assert(completed.every(result=>result.code===0),`Co-owner concurrency failed: ${completed.map(result=>result.stderr).join(' | ')}`);
    current=await getContext();
    assert(current.brief.offers==='Concurrent owner correction'&&current.brief.industry===before.brief.industry,'Concurrent canonical save lost facts');
    assert((await get(11,11)).nextField==='offers','Concurrent checkpoint did not persist');
  });
  await test('workspace switch cannot carry a private interview checkpoint into another legitimate membership',async()=>{
    await psql(`insert into public.tenant_members(tenant_id,user_id,role,is_owner) values('${tid(2)}','${uid(11)}','owner',true); update public.profiles set active_tenant_id='${tid(2)}' where user_id='${uid(11)}';`);
    await rejected(asUser(11,`select public.get_solo_business_interview_checkpoint('${thread(11)}');`),'42501');
    await rejected(asUser(11,saveSql(11,11,position)),'40001');
    await psql(`update public.profiles set active_tenant_id='${tid(11)}' where user_id='${uid(11)}';`);
    assert((await get(11,11)).phase==='active','Legitimate re-entry lost persisted resume position');
  });
}
