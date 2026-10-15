// Extension of the incumbent disposable native profile proof, not a new runner.
// Actual committed CRM/contact/stage bodies run under synthetic Auth/schema roles.
// Managed-schema, application Auth, UI and production acceptance remain unproven.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

export async function runWelcomeCases(ctx) {
  const {sql,check,ids,lit,root,exe,args,baseline}=ctx;
  const json=value=>lit(JSON.stringify(value))+'::jsonb';
  const row=value=>JSON.parse(value.split(/\r?\n/).find(line=>line.startsWith('{')));
  const scalar=value=>value.split(/\r?\n/).find(line=>/^\d+$/.test(line));
  const migrationFile=path.join(root,'supabase/migrations/20271106140000_e09_client_welcome_atomic.sql');
  const fullPlaybook=intake=>({slug:'test-welcome',name:'Test Welcome',vertical:'General',
    persona:{name:'Assistant',role:'Service assistant',greeting:'Welcome',tone:'Clear',domain:'General'},
    quickActions:[],probingQuestions:[],journey:[],intake,portal:{modules:[]}});
  const contactKeys=['full_name','first_name','last_name','name','email','phone'];
  const fields=[{key:'goal',label:'Goal',type:'text',required:true},
    {key:'notes',label:'Notes',type:'longtext'},
    {key:'plan',label:'Plan',type:'select',options:['first','second'],required:true},
    {key:'count',label:'Count',type:'number'},
    {key:'start',label:'Start',type:'date'},
    {key:'callback',label:'Callback',type:'phone'},
    {key:'address',label:'Address',type:'address'},
    ...contactKeys.map(key=>({key,label:'Native contact '+key,type:'text',required:true}))];
  const config=fullPlaybook(fields);
  const answers={goal:'Synthetic welcome answer',notes:'Synthetic detailed answer',plan:'first',
    count:3,start:'2026-10-15',callback:'+12025550131',address:'4 Test Avenue'};
  const profile={first_name:'Welcome Neutral',last_name:'Customer',phone:'+12025550130',
    street_address:'4 Test Avenue',city:'Test City',state:'TS',zip_code:'10000'};
  const setConfig=value=>sql(`UPDATE public.tenants SET features=jsonb_build_object('playbook_config',${json(value)},'private_fixture','not public') WHERE id=${lit(ids.ta)};`);
  const transaction=(body,actor=ids.a,role='authenticated',end='COMMIT')=>`BEGIN;SELECT set_config('test.actor',${lit(actor)},true);SET LOCAL ROLE ${role};${body};${end};`;
  const rollbackTransaction=(body,actor=ids.a,role='authenticated')=>transaction(body,actor,role,'ROLLBACK');
  const stateText=(actor=ids.a,role='authenticated')=>transaction('SELECT public.client_portal_welcome_state()',actor,role);
  const state=(actor=ids.a,role='authenticated')=>row(sql(stateText(actor,role)));
  const saveText=(token,p=profile,a=answers,actor=ids.a,role='authenticated')=>transaction(
    `SELECT public.client_portal_save_welcome(${lit(token)},${json(p)},${json(a)})`,actor,role);
  const save=(token,p=profile,a=answers,actor=ids.a,role='authenticated')=>row(sql(saveText(token,p,a,actor,role)));
  const snapshot=()=>sql(`SELECT jsonb_build_object(
    'clients',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.clients c),
    'methods',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.client_contact_methods m),
    'intake',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.paige_client_intake_submissions i),
    'profile_audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_logs a),
    'stage_audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.paige_audit_log a));`);
  const nativeDefinitions=()=>sql("SELECT jsonb_object_agg(p.oid::text,pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'");
  const errorIs=(error,code,message)=>error.message.includes(code)&&(!message||error.message.includes(message));
  const unchangedRefusal=(operation,code,message)=>{
    const before=snapshot();
    try{assert.throws(operation,error=>errorIs(error,code,message));}
    finally{assert.equal(snapshot(),before,'refusal must roll back every canonical row/audit');}
  };
  const deny=(name,p,a,code='22023',actor=ids.a,role='authenticated')=>check(name,()=>{
    const loaded=state();unchangedRefusal(()=>save(loaded.expected_token,p,a,actor,role),code);
  });
  const assertReady=value=>{
    assert.equal(value.status,'ready');assert.match(value.expected_token,/^[a-f0-9]{32}$/i);
    assert.equal(value.profile.id,ids.ca);assert.equal(value.profile.tenant_id,ids.ta);
    assert.equal(value.profile.linked_user_id,ids.a);assert(Array.isArray(value.fields));
    assert.equal(typeof value.answers,'object');assert(!Array.isArray(value.answers));
    assert.deepEqual(Object.keys(value).sort(),['status','profile','fields','answers','intake_updated_at','intake_submitted_at','expected_token'].sort());
    assert(!JSON.stringify(value).includes('PRIVATE NOTE'));
    assert(!JSON.stringify(value).includes('not public'));
  };
  const assertFinal=value=>{
    assertReady(value);
    assert.deepEqual(value.profile,row(sql(transaction(`SELECT public.client_portal_self_profile(${lit(ids.ta)}::uuid)`))));
    const intake=row(sql(`SELECT to_jsonb(i) FROM public.paige_client_intake_submissions i WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`));
    assert.equal(value.intake_updated_at,intake.updated_at);
    assert.equal(value.intake_submitted_at,intake.submitted_at);
    for(const [key,answer]of Object.entries(value.answers))assert.deepEqual(intake.payload[key],answer);
    assert.deepEqual(state(),value,'returned envelope must equal canonical post-stage reload');
  };

  // Upgrade the incumbent fixture BEFORE candidate application. Every source is
  // committed: no local production catalog dump or parent work file is required.
  const source=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
  const timestampSource=source('20251009235043_6c594b86-0698-44bb-b6e3-728338243336.sql');
  const updatedAt=timestampSource.match(/CREATE OR REPLACE FUNCTION public\.update_updated_at_column\(\)[\s\S]*?\$\$;/);
  const clientTrigger=source('20260411060930_493f10d7-393a-45f8-ac22-b4497c5e716b.sql')
    .match(/CREATE TRIGGER update_clients_updated_at\s[\s\S]*?;/);
  const intakeTrigger=source('20260629160438_9e340148-8d1d-4954-9d55-de76ef98c7c0.sql')
    .match(/CREATE TRIGGER trg_intake_updated_at\s[\s\S]*?;/);
  assert(updatedAt&&updatedAt[0].includes('NEW.updated_at = now()'),'Committed now() trigger function is required');
  assert(clientTrigger&&intakeTrigger,'Both committed timestamp triggers are required');
  // Minimal neutral table fixture: NOT NULL/FK/unique/version columns from
  // 20260629160438; section allowlist from 20260710020000. Unrelated schema and
  // production data are deliberately not copied into this standalone proof.
  sql(`ALTER TABLE public.tenants ADD COLUMN features jsonb NOT NULL DEFAULT '{}';
    ALTER TABLE public.paige_client_intake_submissions
      ALTER COLUMN client_id SET NOT NULL,ALTER COLUMN section SET NOT NULL,
      ADD COLUMN submitted_at timestamptz,
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
      ADD CONSTRAINT welcome_intake_client_fk FOREIGN KEY(client_id) REFERENCES public.clients(id) ON DELETE CASCADE,
      ADD CONSTRAINT welcome_intake_client_section_unique UNIQUE(client_id,section),
      ADD CONSTRAINT welcome_intake_section_check CHECK(section IN ('about_you','business','current_state','docs_checklist','playbook_intake'));
    CREATE TABLE public.paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,action text,target_type text,target_id uuid,payload jsonb,created_at timestamptz DEFAULT now());
    ALTER TABLE public.paige_audit_log ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.paige_audit_log FROM PUBLIC,anon,authenticated;
    ALTER ROLE service_role BYPASSRLS;
    ${updatedAt[0]}
    ${clientTrigger[0]}
    ${intakeTrigger[0]}
    -- Staff access is an explicit false stand-in; it supplies no customer authority.
    CREATE FUNCTION public.can_access_contact(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,active_tenant_id uuid);
    INSERT INTO public.profiles VALUES(${lit(ids.a)},${lit(ids.tb)});`);
  const original=source('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql');
  const owner=original.match(/CREATE OR REPLACE FUNCTION public\.is_program_client_owner\([\s\S]*?\$\$;/);
  assert(owner,'Committed owner helper must be loaded, never reconstructed from a permissive stub');
  sql(`${owner[0]} REVOKE ALL ON FUNCTION public.is_program_client_owner(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_program_client_owner(uuid) TO authenticated,service_role;`);
  for(const name of ['client_or_staff_read_intake','client_update_own_intake','client_upsert_own_intake']){
    const policy=original.match(new RegExp('CREATE POLICY '+name+' ON public\\.paige_client_intake_submissions\\s[\\s\\S]*?;'));
    assert(policy,'Committed baseline policy is required: '+name);sql(policy[0]);
  }
  sql(fs.readFileSync(path.join(root,'supabase/migrations/20271106120000_e09_client_stage_scope.sql'),'utf8'));
  setConfig(config);
  sql(`UPDATE public.tenants SET features=jsonb_build_object('playbook_config',${json(fullPlaybook([{key:'foreign_secret',label:'Foreign question',type:'text'}]))}) WHERE id=${lit(ids.tb)};
    UPDATE public.paige_client_intake_submissions SET payload=payload||'{"unseen_history":"keep this historical value","email":"historical@tests.invalid"}'::jsonb WHERE client_id=${lit(ids.ca)} AND section='playbook_intake';
    INSERT INTO public.paige_client_intake_submissions(client_id,section,payload) VALUES(${lit(ids.cb)},'playbook_intake','{"foreign_secret":"foreign synthetic answer"}');`);
  const oldFunctions=sql("SELECT coalesce(jsonb_agg(oid),'[]') FROM pg_proc WHERE pronamespace='public'::regnamespace");
  if(!baseline)sql(fs.readFileSync(migrationFile,'utf8'));

  check('Welcome exposes only the frozen subject-bound RPC signatures and ACLs',()=>{
    assert.equal(sql("SELECT to_regprocedure('public.client_portal_welcome_state()') IS NOT NULL AND to_regprocedure('public.client_portal_save_welcome(text,jsonb,jsonb)') IS NOT NULL"),'t');
    for(const signature of ['client_portal_welcome_state()','client_portal_save_welcome(text,jsonb,jsonb)']){
      assert.equal(sql(`SELECT has_function_privilege('authenticated',${lit('public.'+signature)},'EXECUTE')`),'t');
      assert.equal(sql(`SELECT has_function_privilege('anon',${lit('public.'+signature)},'EXECUTE')`),'f');
      assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=${lit('public.'+signature)}::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE')`),'f');
    }
    const exposed=sql(`SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND NOT p.oid IN (SELECT value::oid FROM jsonb_array_elements_text(${lit(oldFunctions)}::jsonb)) AND p.proname NOT IN ('client_portal_welcome_state','client_portal_save_welcome') AND (has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE'))`);
    assert.equal(exposed,'0','new private validator helpers must not become customer APIs');
  });
  check('Welcome read uses sponsoring relationship, filters contact keys and unseen history',()=>{
    const before=snapshot(),loaded=state();assertReady(loaded);assert.equal(snapshot(),before);
    assert.deepEqual(loaded.fields.map(f=>f.key),fields.filter(f=>!contactKeys.includes(f.key)).map(f=>f.key));
    assert(!JSON.stringify(loaded).includes('foreign_secret'));assert(!('unseen_history'in loaded.answers));
    for(const key of contactKeys)assert(!(key in loaded.answers));
  });
  check('Digit-leading question keys authored by the existing editor remain usable',()=>{
    try{setConfig(fullPlaybook([{key:'90_day_goal',label:'90 day goal',type:'text',required:true}]));
      const loaded=state();assertReady(loaded);assert.equal(loaded.fields[0].key,'90_day_goal');
      const before=snapshot(),saved=row(sql(rollbackTransaction(`SELECT public.client_portal_save_welcome(${lit(loaded.expected_token)},${json(profile)},${json({'90_day_goal':'A saved goal'})})`)));
      assert.equal(saved.answers['90_day_goal'],'A saved goal');assert.equal(snapshot(),before);
    }finally{setConfig(config);}
  });
  check('Atomic Welcome persists profile, canonical phone, postal, intake and final stage readback',()=>{
    const loaded=state(),foreign=sql(`SELECT jsonb_build_object('client',to_jsonb(c),'intake',(SELECT jsonb_agg(to_jsonb(i)) FROM public.paige_client_intake_submissions i WHERE i.client_id=c.id)) FROM public.clients c WHERE id=${lit(ids.cb)}`);
    const secondaryMethods=loaded.profile.contact_methods.filter(method=>
      ['email','phone'].includes(method.kind)&&method.is_primary===false);
    assert(secondaryMethods.some(method=>method.kind==='phone'),'native preceding cases must leave a real secondary-phone control');
    assert(!loaded.profile.contact_methods.some(method=>method.kind==='phone'&&method.value===profile.phone),
      'this case must exercise a new primary value rather than promote a secondary');
    const beforeWelcomeAudit=Number(sql("SELECT count(*) FROM public.audit_logs WHERE action='welcome_saved'"));
    const saved=save(loaded.expected_token);assertFinal(saved);
    assert.equal(saved.profile.first_name,profile.first_name);assert.equal(saved.profile.phone,profile.phone);
    assert.equal(saved.profile.street_address,profile.street_address);assert.equal(saved.profile.city,profile.city);
    assert.equal(saved.profile.onboarding_stage,'signing_agreement');
    // contact_methods_with_primary (20270519010000) replaces a prior primary
    // when the requested value is new. It preserves the actual existing
    // secondaries; preceding incumbent cases may have changed their values.
    for(const secondary of secondaryMethods){
      const persisted=saved.profile.contact_methods.find(method=>method.kind===secondary.kind&&method.value===secondary.value);
      assert.deepEqual(persisted,secondary,'each loaded secondary must preserve exact kind/value/is_primary');
    }
    assert.equal(saved.profile.email,loaded.profile.email);
    assert.deepEqual(saved.answers,answers);assert(saved.intake_submitted_at);
    assert.equal(sql(`SELECT payload->>'unseen_history' FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`),'keep this historical value');
    assert.equal(sql(`SELECT payload->>'email' FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`),'historical@tests.invalid');
    assert.equal(sql(`SELECT jsonb_build_object('client',to_jsonb(c),'intake',(SELECT jsonb_agg(to_jsonb(i)) FROM public.paige_client_intake_submissions i WHERE i.client_id=c.id)) FROM public.clients c WHERE id=${lit(ids.cb)}`),foreign);
    const audits=sql('SELECT jsonb_build_object(\'profile\',(SELECT jsonb_agg(to_jsonb(a)) FROM public.audit_logs a),\'stage\',(SELECT jsonb_agg(to_jsonb(a)) FROM public.paige_audit_log a))');
    for(const value of [answers.goal,answers.notes,profile.first_name,profile.phone])assert(!audits.includes(value),'audit must not contain submitted values');
    const a=row(sql("SELECT data FROM public.audit_logs WHERE action='self_profile_updated' AND data->>'via'='client_portal_update_self_profile' LIMIT 1"));
    assert.equal(a.actor_user_id,ids.a);assert.equal(a.tenant_id,ids.ta);assert.equal(a.client_id,ids.ca);
    assert.equal(Number(sql("SELECT count(*) FROM public.audit_logs WHERE action='welcome_saved'")),beforeWelcomeAudit+1);
    const welcome=row(sql("SELECT to_jsonb(a) FROM public.audit_logs a WHERE action='welcome_saved' LIMIT 1"));
    assert.equal(welcome.user_id,ids.a);assert.equal(welcome.entity_id,ids.ca);assert.equal(welcome.entity,'client_portal');
    assert.deepEqual(welcome.data,{actor_user_id:ids.a,tenant_id:ids.ta,client_id:ids.ca,
      answer_fields:Object.keys(answers).sort(),via:'client_portal_save_welcome'});
  });
  check('Optional visible answers may be omitted/removed while unseen history is preserved',()=>{
    save(state().expected_token,profile,answers);
    const retained={goal:answers.goal,plan:answers.plan};
    const saved=save(state().expected_token,{city:'Composed Test City'},retained);assertFinal(saved);
    assert.deepEqual(saved.answers,retained);assert(saved.fields.some(field=>field.key==='notes'));
    const payload=row(sql(`SELECT payload FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`));
    for(const key of ['notes','count','start','callback','address'])assert(!(key in payload),'omitted visible answer must be removed: '+key);
    assert.equal(payload.unseen_history,'keep this historical value');assert.equal(payload.email,'historical@tests.invalid');
    assert(!('unseen_history'in saved.answers));assert(!('email'in saved.answers));
    assert.equal(saved.profile.first_name,profile.first_name);assert.equal(saved.profile.last_name,profile.last_name);
    assert.equal(saved.profile.phone,profile.phone,'valid composed profile may reuse omitted native name/phone fields');
  });
  // New Welcome completeness controls: the native partial profile writer alone
  // does not require pre-existing first/last name and a primary phone. The facade
  // must validate the resulting canonical profile before intake/stage success.
  for(const field of ['first_name','last_name'])for(const missing of [null,'   '])
    check('Welcome refuses omitted '+field+' when existing canonical value is '+(missing===null?'null':'blank'),()=>{
      const existing=row(sql(`SELECT to_jsonb(c) FROM public.clients c WHERE id=${lit(ids.ca)}`));
      try{sql(`UPDATE public.clients SET ${field}=${lit(missing)},onboarding_stage='invited' WHERE id=${lit(ids.ca)}`);
        const loaded=state();
        unchangedRefusal(()=>sql(rollbackTransaction(`SELECT public.client_portal_save_welcome(${lit(loaded.expected_token)},${json({city:'Valid Postal Patch'})},${json(answers)})`)),'22023');
      }finally{sql(`UPDATE public.clients SET first_name=${lit(existing.first_name)},last_name=${lit(existing.last_name)},onboarding_stage=${lit(existing.onboarding_stage)} WHERE id=${lit(ids.ca)}`);}
    });
  for(const repair of [false,true])check(repair?
    'A supplied native primary phone repairs a missing phone before Welcome completion':
    'Welcome refuses an omitted primary phone when the canonical client has no phones',()=>{
    const phones=JSON.parse(sql(`SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM public.client_contact_methods m WHERE client_id=${lit(ids.ca)} AND kind='phone'`));
    try{sql(`DELETE FROM public.client_contact_methods WHERE client_id=${lit(ids.ca)} AND kind='phone'`);
      const loaded=state();assert.equal(loaded.profile.phone,null);
      if(repair){const saved=save(loaded.expected_token,{phone:profile.phone},answers);assertFinal(saved);
        assert.equal(saved.profile.phone,profile.phone);assert(saved.profile.contact_methods.some(method=>method.kind==='phone'&&method.value===profile.phone&&method.is_primary));
      }else unchangedRefusal(()=>sql(rollbackTransaction(`SELECT public.client_portal_save_welcome(${lit(loaded.expected_token)},${json({city:'Valid Postal Patch'})},${json(answers)})`)),'22023');
    }finally{
      // match_key is a real generated column, so restore through explicit native columns.
      sql(`DELETE FROM public.client_contact_methods WHERE client_id=${lit(ids.ca)} AND kind='phone';
        INSERT INTO public.client_contact_methods(id,tenant_id,client_id,kind,value,label,is_primary,position,created_at,updated_at)
        SELECT id,tenant_id,client_id,kind,value,label,is_primary,position,created_at,updated_at
        FROM jsonb_populate_recordset(NULL::public.client_contact_methods,${json(phones)})`);
    }
  });
  check('A complete native patch can repair missing Welcome names before advancement',()=>{
    const existing=row(sql(`SELECT to_jsonb(c) FROM public.clients c WHERE id=${lit(ids.ca)}`));
    try{sql(`UPDATE public.clients SET first_name=NULL,last_name=NULL,onboarding_stage='invited' WHERE id=${lit(ids.ca)}`);
      const saved=save(state().expected_token,profile,answers);assertFinal(saved);
      assert.equal(saved.profile.first_name,profile.first_name);assert.equal(saved.profile.last_name,profile.last_name);
      assert.equal(saved.profile.phone,profile.phone);assert.equal(saved.profile.onboarding_stage,'signing_agreement');
    }finally{sql(`UPDATE public.clients SET first_name=${lit(existing.first_name)},last_name=${lit(existing.last_name)},onboarding_stage=${lit(existing.onboarding_stage)} WHERE id=${lit(ids.ca)}`);}
  });
  check('Lost acknowledgement recovers through canonical reload; old state is not a write receipt',()=>{
    const before=state();save(before.expected_token,{first_name:'Canonical Reload'},{...answers,goal:'Canonical recovery answer'});
    const recovered=state();assert.equal(recovered.profile.first_name,'Canonical Reload');
    assert.equal(recovered.answers.goal,'Canonical recovery answer');assert.notEqual(recovered.expected_token,before.expected_token);
    unchangedRefusal(()=>save(before.expected_token),'40001');
  });
  check('A later native onboarding stage is preserved',()=>{
    sql(`UPDATE public.clients SET onboarding_stage='completed' WHERE id=${lit(ids.ca)}`);
    const saved=save(state().expected_token);assert.equal(saved.profile.onboarding_stage,'completed');assertFinal(saved);
  });
  check('Stale profile alone conflicts before any Welcome mutation',()=>{
    const loaded=state();sql(`UPDATE public.clients SET first_name='Concurrent profile' WHERE id=${lit(ids.ca)}`);
    unchangedRefusal(()=>save(loaded.expected_token),'40001');
  });
  check('Stale intake alone conflicts before any Welcome mutation',()=>{
    const loaded=state();sql(`UPDATE public.paige_client_intake_submissions SET payload=payload||'{"goal":"Concurrent intake"}'::jsonb WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`);
    unchangedRefusal(()=>save(loaded.expected_token),'40001');
  });
  for(const target of ['profile','intake'])check('Same-now changed '+target+' state cannot reuse a token',()=>{
    const update=target==='profile'?`UPDATE public.clients SET first_name='Same timestamp changed' WHERE id=${lit(ids.ca)}`:
      `UPDATE public.paige_client_intake_submissions SET payload=payload||'{"goal":"Same timestamp changed"}'::jsonb WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`;
    const beforeRead=target==='profile'?`UPDATE public.clients SET first_name=first_name WHERE id=${lit(ids.ca)}`:
      `UPDATE public.paige_client_intake_submissions SET payload=payload WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`;
    unchangedRefusal(()=>sql(`BEGIN;${beforeRead};SELECT set_config('test.actor',${lit(ids.a)},true);SET LOCAL ROLE authenticated;
      SELECT set_config('test.welcome_token',public.client_portal_welcome_state()->>'expected_token',true);RESET ROLE;${update};SET LOCAL ROLE authenticated;
      SELECT public.client_portal_save_welcome(current_setting('test.welcome_token'),${json(profile)},${json(answers)});COMMIT;`),'40001');
  });
  check('Changed effective authored schema invalidates the loaded token',()=>{
    const loaded=state();try{setConfig(fullPlaybook(fields.map(f=>f.key==='goal'?{...f,label:'Changed goal label'}:f)));
      unchangedRefusal(()=>save(loaded.expected_token),'40001');}finally{setConfig(config);}
  });
  check('Expected absence conflicts with an inserted canonical intake row',()=>{
    const existing=row(sql(`SELECT to_jsonb(i) FROM public.paige_client_intake_submissions i WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`));
    sql(`DELETE FROM public.paige_client_intake_submissions WHERE id=${lit(existing.id)}`);
    try{const loaded=state();assert.equal(loaded.intake_updated_at,null);
      sql(`INSERT INTO public.paige_client_intake_submissions(client_id,section,payload) VALUES(${lit(ids.ca)},'playbook_intake','{"goal":"Inserted concurrently"}')`);
      unchangedRefusal(()=>save(loaded.expected_token),'40001');
    }finally{sql(`DELETE FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake';INSERT INTO public.paige_client_intake_submissions SELECT * FROM jsonb_populate_record(NULL::public.paige_client_intake_submissions,${json(existing)})`);}
  });
  check('A loaded absent intake can be created once with final canonical readback',()=>{
    const existing=row(sql(`SELECT to_jsonb(i) FROM public.paige_client_intake_submissions i WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`));
    sql(`DELETE FROM public.paige_client_intake_submissions WHERE id=${lit(existing.id)}`);
    try{const loaded=state();assert.equal(loaded.intake_updated_at,null);assert.equal(loaded.intake_submitted_at,null);
      assert.deepEqual(loaded.answers,{});const saved=save(loaded.expected_token);assertFinal(saved);
      assert.equal(sql(`SELECT count(*) FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`),'1');
      unchangedRefusal(()=>save(loaded.expected_token),'40001');
    }finally{sql(`DELETE FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake';INSERT INTO public.paige_client_intake_submissions SELECT * FROM jsonb_populate_record(NULL::public.paige_client_intake_submissions,${json(existing)})`);}
  });
  check('Replacing intake identity with identical payload/timestamps invalidates state',()=>{
    const existing=row(sql(`SELECT to_jsonb(i) FROM public.paige_client_intake_submissions i WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`));
    const loaded=state(),replacement={...existing,id:'e0942000-0000-0000-0000-000000000099'};
    try{sql(`DELETE FROM public.paige_client_intake_submissions WHERE id=${lit(existing.id)};INSERT INTO public.paige_client_intake_submissions SELECT * FROM jsonb_populate_record(NULL::public.paige_client_intake_submissions,${json(replacement)})`);
      unchangedRefusal(()=>save(loaded.expected_token),'40001');
    }finally{sql(`DELETE FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake';INSERT INTO public.paige_client_intake_submissions SELECT * FROM jsonb_populate_record(NULL::public.paige_client_intake_submissions,${json(existing)})`);}
  });

  for(const [name,p,a]of [
    ['Unknown answer key',profile,{...answers,unknown:'not authored'}],
    ['Native contact answer override',profile,{...answers,email:'changed@tests.invalid'}],
    ['Required missing answer',profile,{plan:'first'}],['Required blank answer',profile,{...answers,goal:'   '}],
    ['Required null answer',profile,{...answers,goal:null}],
    ['Wrong answer object shape',profile,[]],['Wrong text value',profile,{...answers,goal:12}],
    ['Wrong number JSON type',profile,{...answers,count:'3'}],['Invalid select choice',profile,{...answers,plan:'unpublished'}],
    ['Invalid date',profile,{...answers,start:'2026-02-31'}],['Invalid answer phone',profile,{...answers,callback:'x'}],
    ['Oversized answer',profile,{...answers,notes:'x'.repeat(200000)}],
    ['Empty native profile patch',{},answers],['Null native profile patch',null,answers],
    ['Unknown native profile field',{current_notes:'private'},answers],
    ['Forbidden native profile linkage',{linked_user_id:ids.b},answers],['Invalid native primary phone',{phone:'x'},answers]
  ])deny('Welcome rejects '+name,p,a);
  for(const token of [null,'','not-a-token'])check('Welcome rejects malformed token '+String(token),()=>unchangedRefusal(()=>save(token),'22023'));

  check('Missing published playbook_config is configuration_required',()=>{
    try{sql(`UPDATE public.tenants SET features='{}' WHERE id=${lit(ids.ta)}`);
      const loaded=state();assert.equal(loaded.status,'configuration_required');assert.equal(loaded.expected_token,null);
      unchangedRefusal(()=>save(null),'55000');
    }finally{setConfig(config);}
  });
  for(const [name,value]of [
    ['null authored config',null],['slug-only authored config',{slug:'test-welcome'}],
    ['malformed intake shape',{...config,intake:{goal:'invalid'}}],
    ['unknown field type',fullPlaybook([{key:'goal',label:'Goal',type:'unsupported'}])],
    ['duplicate field key',fullPlaybook([{key:'goal',label:'Goal',type:'text'},{key:'goal',label:'Other',type:'text'}])],
    ['missing field label',fullPlaybook([{key:'goal',type:'text'}])],
    ['unbounded field key',fullPlaybook([{key:'k'.repeat(1000),label:'Goal',type:'text'}])],
    ['unbounded field label',fullPlaybook([{key:'goal',label:'x'.repeat(20000),type:'text'}])],
    ['invalid select options',fullPlaybook([{key:'goal',label:'Goal',type:'select',options:[]}])],
    ['nonstring select option',fullPlaybook([{key:'goal',label:'Goal',type:'select',options:[1]}])],
    ['nonboolean required',fullPlaybook([{key:'goal',label:'Goal',type:'text',required:'yes'}])]
  ])check('Welcome withholds save for '+name,()=>{
    try{setConfig(value);const loaded=state();assert.equal(loaded.status,'configuration_required');
      assert.equal(loaded.expected_token,null);assert.deepEqual(loaded.fields,[]);assert.deepEqual(loaded.answers,{});
      unchangedRefusal(()=>save(null),'55000');}finally{setConfig(config);}
  });
  check('An explicitly authored empty intake remains a valid native configuration',()=>{
    try{setConfig(fullPlaybook([]));const loaded=state();assertReady(loaded);assert.deepEqual(loaded.fields,[]);
      const saved=save(loaded.expected_token,{first_name:'Empty Intake'},{});assertFinal(saved);assert.deepEqual(saved.answers,{});
    }finally{setConfig(config);}
  });
  for(const [name,actor,role]of [['anonymous',null,'anon'],['subjectless authenticated',null,'authenticated'],
    ['subjectless service',null,'service_role'],['unlinked actor','e0912000-0000-0000-0000-000000000099','authenticated']]){
    check('Welcome read refuses '+name,()=>unchangedRefusal(()=>state(actor,role),'42501'));
    deny('Welcome save refuses '+name,profile,answers,'42501',actor,role);
  }
  for(const [name,setup,restore]of [
    ['archived client',`UPDATE clients SET status='archived' WHERE id=${lit(ids.ca)}`,`UPDATE clients SET status='active' WHERE id=${lit(ids.ca)}`],
    ['merged client',`UPDATE clients SET merged_into_contact_id=${lit(ids.cb)} WHERE id=${lit(ids.ca)}`,`UPDATE clients SET merged_into_contact_id=NULL WHERE id=${lit(ids.ca)}`],
    ['revoked linkage',`UPDATE clients SET linked_user_id=NULL WHERE id=${lit(ids.ca)}`,`UPDATE clients SET linked_user_id=${lit(ids.a)} WHERE id=${lit(ids.ca)}`],
    ['inactive tenant',`UPDATE tenants SET status='suspended' WHERE id=${lit(ids.ta)}`,`UPDATE tenants SET status='active' WHERE id=${lit(ids.ta)}`]
  ])check('Welcome read/save refuse '+name+' without effects',()=>{
    const loaded=state();try{sql(setup);unchangedRefusal(()=>state(),'42501');unchangedRefusal(()=>save(loaded.expected_token),'42501');}finally{sql(restore);}
  });
  check('Foreign actor receives only their own sponsoring schema/profile',()=>{
    const own=state(ids.b);assert.equal(own.profile.id,ids.cb);assert.equal(own.profile.tenant_id,ids.tb);
    assert.equal(own.fields[0].key,'foreign_secret');assert(!JSON.stringify(own).includes('Synthetic welcome answer'));
    unchangedRefusal(()=>save(state().expected_token,profile,answers,ids.b),'40001');
  });
  for(const [name,operation]of [
    ['read','SELECT public.client_portal_welcome_state()'],
    ['save',`SELECT public.client_portal_save_welcome(${lit('a'.repeat(32))},${json(profile)},${json(answers)})`]
  ])check('Synthetic ambiguous relationship refuses Welcome '+name+' and restores uniqueness',()=>{
    // SYNTHETIC ONLY: the incumbent normal fixture keeps its committed UNIQUE
    // constraint. Relax it inside this one transaction to reach the native
    // resolver's ambiguity branch; both success and error paths roll back DDL.
    // This is not a claim of deployed multi-business support or permission.
    const unique=()=>sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.clients'::regclass AND conname='clients_linked_user_id_key'");
    const beforeUnique=unique();assert.match(beforeUnique,/UNIQUE \(linked_user_id\)/);
    try{unchangedRefusal(()=>sql(`BEGIN;
      ALTER TABLE public.clients DROP CONSTRAINT clients_linked_user_id_key;
      INSERT INTO public.clients(id,tenant_id,linked_user_id,first_name,last_name,onboarding_stage)
        VALUES('e0932000-0000-0000-0000-000000000099',${lit(ids.tb)},${lit(ids.a)},'Synthetic','Ambiguous','invited');
      SELECT set_config('test.actor',${lit(ids.a)},true);SET LOCAL ROLE authenticated;${operation};ROLLBACK;`),'42501');
    }finally{assert.equal(unique(),beforeUnique,'isolated ambiguity must restore normal fixture uniqueness');}
  });

  check('Raw other-section INSERT/UPDATE/SELECT remain authorized',()=>{
    const inserted=sql(transaction(`WITH changed AS(INSERT INTO public.paige_client_intake_submissions(client_id,section,payload) VALUES(${lit(ids.ca)},'about_you','{"raw":"before"}') RETURNING id) SELECT count(*) FROM changed`));
    assert.equal(scalar(inserted),'1');
    assert.equal(scalar(sql(transaction(`WITH changed AS(UPDATE public.paige_client_intake_submissions SET payload='{"raw":"after"}' WHERE client_id=${lit(ids.ca)} AND section='about_you' RETURNING id) SELECT count(*) FROM changed`))),'1');
    assert.equal(scalar(sql(transaction(`SELECT count(*) FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='about_you' AND payload->>'raw'='after'`))),'1');
  });
  for(const [name,mutation]of [['UPDATE',"payload='{\"goal\":\"raw overwrite\"}'"],['reassignment out',"section='business'"]])
    check('Raw playbook '+name+' affects zero rows without contaminating the baseline',()=>{
      const before=snapshot();
      try{assert.equal(scalar(sql(rollbackTransaction(`WITH changed AS(UPDATE public.paige_client_intake_submissions SET ${mutation} WHERE client_id=${lit(ids.ca)} AND section='playbook_intake' RETURNING id) SELECT count(*) FROM changed`))),'0');}
      finally{assert.equal(snapshot(),before,'raw mutation control must roll back even when its count assertion fails');}
    });
  check('Raw reassignment into protected playbook section is denied',()=>{
    // Avoid masking the policy check with the unique section constraint.
    const existing=row(sql(`SELECT to_jsonb(i) FROM public.paige_client_intake_submissions i WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`));
    sql(`DELETE FROM public.paige_client_intake_submissions WHERE id=${lit(existing.id)}`);
    try{unchangedRefusal(()=>sql(rollbackTransaction(`UPDATE public.paige_client_intake_submissions SET section='playbook_intake' WHERE client_id=${lit(ids.ca)} AND section='about_you'`)),'42501');
    }finally{sql(`DELETE FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake';INSERT INTO public.paige_client_intake_submissions SELECT * FROM jsonb_populate_record(NULL::public.paige_client_intake_submissions,${json(existing)})`);}
  });
  check('Raw protected INSERT is denied even when no playbook row exists',()=>{
    const existing=row(sql(`SELECT to_jsonb(i) FROM public.paige_client_intake_submissions i WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`));
    sql(`DELETE FROM public.paige_client_intake_submissions WHERE id=${lit(existing.id)}`);
    try{unchangedRefusal(()=>sql(rollbackTransaction(`INSERT INTO public.paige_client_intake_submissions(client_id,section,payload) VALUES(${lit(ids.ca)},'playbook_intake','{}')`)),'42501');
    }finally{sql(`DELETE FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake';INSERT INTO public.paige_client_intake_submissions SELECT * FROM jsonb_populate_record(NULL::public.paige_client_intake_submissions,${json(existing)})`);}
  });
  check('Existing own intake SELECT and trusted service writer remain available',()=>{
    assert.equal(scalar(sql(transaction(`SELECT count(*) FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`))),'1');
    assert.equal(scalar(sql(transaction(`SELECT count(*) FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.cb)}`))),'0');
    assert.equal(scalar(sql(transaction(`WITH changed AS(UPDATE public.paige_client_intake_submissions SET payload=payload||'{"service_history":"kept"}' WHERE client_id=${lit(ids.ca)} AND section='playbook_intake' RETURNING id) SELECT count(*) FROM changed`,null,'service_role'))),'1');
    for(const role of ['anon','authenticated'])assert.equal(sql(`SELECT has_table_privilege(${lit(role)},'public.paige_client_intake_submissions','TRUNCATE')`),'f');
  });

  for(const [name,table,event,condition,absent]of [['native profile audit','audit_logs','INSERT','true'],
    ['late intake update','paige_client_intake_submissions','UPDATE',"NEW.section='playbook_intake'"],
    ['late intake insert','paige_client_intake_submissions','INSERT',"NEW.section='playbook_intake'",true],
    ['late stage audit','paige_audit_log','INSERT','true'],
    ['late Welcome audit','audit_logs','INSERT',"NEW.action='welcome_saved'"],
    ['stage mutation','clients','UPDATE',"NEW.onboarding_stage='signing_agreement' AND OLD.onboarding_stage IS DISTINCT FROM NEW.onboarding_stage"]]){
    check('Welcome rolls back all rows/audits after injected '+name+' failure',()=>{
      const definitions=nativeDefinitions();let installed=false;
      const existing=absent?row(sql(`SELECT to_jsonb(i) FROM public.paige_client_intake_submissions i WHERE client_id=${lit(ids.ca)} AND section='playbook_intake'`)):null;
      try{
        if(existing)sql(`DELETE FROM public.paige_client_intake_submissions WHERE id=${lit(existing.id)}`);
        sql(`UPDATE public.clients SET onboarding_stage='invited' WHERE id=${lit(ids.ca)}`);
        const loaded=state();
        sql(`CREATE FUNCTION public.test_welcome_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF ${condition} THEN RAISE EXCEPTION 'E09_TEST_WELCOME_FAILURE' USING ERRCODE='P0001';END IF;RETURN NEW;END;$$;
          CREATE TRIGGER test_welcome_fail BEFORE ${event} ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.test_welcome_fail()`);installed=true;
        unchangedRefusal(()=>save(loaded.expected_token,{first_name:'Must Roll Back',phone:'+12025550132'},{...answers,goal:'Must roll back answer'}),'P0001','E09_TEST_WELCOME_FAILURE');
      }finally{
        if(installed)sql(`DROP TRIGGER test_welcome_fail ON public.${table};DROP FUNCTION public.test_welcome_fail()`);
        if(existing)sql(`DELETE FROM public.paige_client_intake_submissions WHERE client_id=${lit(ids.ca)} AND section='playbook_intake';INSERT INTO public.paige_client_intake_submissions SELECT * FROM jsonb_populate_record(NULL::public.paige_client_intake_submissions,${json(existing)})`);
        assert.equal(nativeDefinitions(),definitions,'failure fixture must preserve normal function definitions byte-for-byte');
      }
    });
  }
  check('Post-stage final-readback failure rolls back profile, methods, intake and both audits',()=>{
    const definitions=nativeDefinitions();let installed=false;
    try{
      sql(`UPDATE public.clients SET onboarding_stage='invited' WHERE id=${lit(ids.ca)}`);
      const loaded=state();
      // Trigger only after the final existing audit is inserted: stage and both
      // canonical data writes have already happened. Do not replace real helpers.
      sql(`CREATE FUNCTION public.test_welcome_post_readback() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action='welcome_saved' THEN
            IF (SELECT onboarding_stage FROM public.clients WHERE id=NEW.entity_id) IS DISTINCT FROM 'signing_agreement' THEN
              RAISE EXCEPTION 'E09_TEST_READBACK_TRIGGER_BEFORE_STAGE' USING ERRCODE='P0001';
            END IF;
            RAISE NOTICE 'E09_TEST_POST_STAGE_READBACK';
            UPDATE public.clients SET linked_user_id=NULL WHERE id=NEW.entity_id;
          END IF;
          RETURN NEW;
        END;$$;
        CREATE TRIGGER test_welcome_post_readback AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.test_welcome_post_readback()`);installed=true;
      unchangedRefusal(()=>save(loaded.expected_token,{first_name:'Readback Must Roll Back',phone:'+12025550133'},
        {...answers,goal:'Readback must roll back answer'}),'42501','E09_TEST_POST_STAGE_READBACK');
    }finally{
      if(installed)sql('DROP TRIGGER test_welcome_post_readback ON public.audit_logs;DROP FUNCTION public.test_welcome_post_readback()');
      assert.equal(nativeDefinitions(),definitions,'readback fixture must preserve every normal helper/function definition');
    }
  });

  // Two actual psql sessions share this cluster. A holder signals after taking
  // its lock; pg_stat_activity verifies the customer call really waited on it.
  const startSession=input=>{
    const child=spawn(exe('psql'),args,{windowsHide:true});let stdout='',stderr='';const sent=[];
    child.stdin.on('error',error=>stderr+=String(error));
    const timeout=setTimeout(()=>child.kill(),15000);
    const done=new Promise(resolve=>{child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
      child.on('error',error=>{clearTimeout(timeout);resolve({exit:-1,stdout,stderr:String(error)});});
      child.on('close',exit=>{clearTimeout(timeout);resolve({exit,stdout,stderr});});});
    const send=(text,finish=false)=>{sent.push(text);if(finish)child.stdin.end(text);else child.stdin.write(text);};
    if(input!==undefined)send(input,true);
    return {child,done,send,sent,output:()=>stdout};
  };
  const waitFor=async(predicate,message)=>{
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}
    throw new Error(message);
  };
  const asyncCheck=async(name,fn)=>{let failure;try{await fn();}catch(error){failure=error;}check(name,()=>{if(failure)throw failure;});};
  for(const [name,change,restore,code]of [
    ['tenant config',`UPDATE public.tenants SET features=jsonb_set(features,'{playbook_config,intake,0,label}','"Changed under lock"') WHERE id=${lit(ids.ta)}`,()=>setConfig(config),'40001'],
    ['linkage revoke',`UPDATE public.clients SET linked_user_id=NULL WHERE id=${lit(ids.ca)}`,()=>sql(`UPDATE public.clients SET linked_user_id=${lit(ids.a)} WHERE id=${lit(ids.ca)}`),'42501']
  ])await asyncCheck('Real lock race: committed '+name+' retires the waiting Welcome save',async()=>{
    const loaded=state(),holder=startSession();let waiter;
    try{holder.send(`BEGIN;${change};\n\\echo E09_WELCOME_LOCK_HELD\n`);
      await waitFor(()=>holder.output().includes('E09_WELCOME_LOCK_HELD'),'holder never acquired its real row lock');
      waiter=startSession(`SET application_name='e09_welcome_waiter';${saveText(loaded.expected_token)}`);
      await waitFor(()=>sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='e09_welcome_waiter' AND wait_event_type='Lock'")==='1','Welcome call did not wait on the expected client/config lock');
      const normalizedSnapshot=()=>{
        const value=JSON.parse(snapshot());
        if(name==='linkage revoke'){
          const client=value.clients.find(item=>item.id===ids.ca);
          delete client.linked_user_id;delete client.updated_at;
        }
        return JSON.stringify(value);
      };
      const before=normalizedSnapshot();
      holder.send('COMMIT;',true);assert.equal((await holder.done).exit,0);
      const result=await waiter.done;
      assert.notEqual(result.exit,0);assert(result.stderr.includes(code),result.stderr);
      assert.equal(normalizedSnapshot(),before,'waiting rejected call must not mutate canonical records');
    }finally{
      if(!holder.child.stdin.destroyed&&!holder.child.stdin.writableEnded)holder.send('ROLLBACK;',true);
      holder.child.kill();if(waiter)waiter.child.kill();
      const sessions=[{kind:'holder',session:holder},...(waiter?[{kind:'waiting-save',session:waiter}]:[])];
      for(const {kind,session}of sessions){
        const result=await session.done;
        // Use the incumbent sql collector to retain child argv/input/exit/output;
        // no second report writer, runner or output location is introduced.
        sql(`SELECT ${json({evidence:'synthetic-native-postgresql',case:name,session:kind,
          exe:exe('psql'),args,input:session.sent.join(''),...result})}`);
      }
      restore();
    }
  });
}
