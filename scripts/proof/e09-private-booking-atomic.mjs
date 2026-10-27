// A mode of the original fenced, disposable PostgreSQL runner. This component
// proof does not authenticate a user, book a session or call any provider.
export async function bookingActorLockProof({sql,check,assert,fs,fixture,spawn,exe,args,transcripts,path,work,createHash,baseline}) {
 const migrationPath='supabase/migrations/20271119110009_e09_private_booking_atomic.sql';
 const read=file=>fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
 const source=read('supabase/migrations/20271111060000_e09_campaign_portal_audience.sql');
 const start=source.indexOf('CREATE FUNCTION public._client_portal_customer_open(');
 const end=source.indexOf('\n$$;',start)+4;
 assert(start>=0&&end>start,'Original Portal-open predicate source required');
 // Only this isolated REDUCED fixture is extended. Product tables, Auth and
 // access writers remain untouched; full-schema proof is independently owed.
 sql(`ALTER TABLE tenants ADD status text DEFAULT 'active';
  ALTER TABLE clients ADD portal_access_state text DEFAULT 'open';
  ALTER TABLE clients DROP CONSTRAINT clients_linked_user_id_key;
  CREATE UNIQUE INDEX clients_tenant_linked_user_key ON clients(tenant_id,linked_user_id);
  ${source.slice(start,end)}
  REVOKE ALL ON FUNCTION public._client_portal_customer_open(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;`);
 const f=fixture(),other=fixture();
 sql(`UPDATE clients SET linked_user_id='${f.actor}' WHERE id='${f.contact}';`);
 const helper='public._client_portal_lock_verified_customer(uuid,uuid,uuid)';
 const call=(actor=f.actor,tenant=f.tenant,client=f.contact)=>sql(
  `SELECT public._client_portal_lock_verified_customer(${literal(actor)},${literal(tenant)},${literal(client)});`);
 function literal(value){return value==null?'NULL':`'${String(value).replaceAll("'","''")}'`;}
 const metadata=()=>sql(`SELECT jsonb_build_object('body',md5(prosrc),'owner',proowner,
  'volatility',provolatile,'definer',prosecdef,'path',proconfig,'acl',proacl)
  FROM pg_proc WHERE oid='public._client_portal_customer_open(uuid,uuid)'::regprocedure;`);
 const before=metadata();
 check('Original open-access predicate matches the actual production source',()=>{
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public._client_portal_customer_open(uuid,uuid)'::regprocedure"),'888c27cfa1a9120478db7b7baee7c4f8');
 });
 if(baseline){
  check('Internal verified actor can lock its exact current business relationship',()=>assert.equal(call(),f.contact));
  return {baseline:true,auth:'SYNTHETIC',reducedSchema:true,booking:'NOT_RUN'};
 }
 const migration=read(migrationPath);
 const migrationSHA256=createHash('sha256').update(migration).digest('hex');
 fs.writeFileSync(path.join(work,'executed-private-booking-actor.sql'),migration);
 const original=sql("SELECT pg_get_functiondef('public._client_portal_customer_open(uuid,uuid)'::regprocedure);");
 const unknown=original.replace('SELECT EXISTS (','SELECT EXISTS ( -- unrecognized forward source');
 assert.notEqual(unknown,original);sql(unknown);
 check('Unknown original predicate refuses migration before any internal helper is created',()=>{
  assert.throws(()=>sql(migration),/Original Portal open-access contract changed/);
  assert.equal(sql(`SELECT to_regprocedure('${helper}') IS NULL;`),'t');
  assert.equal(sql("SELECT pg_get_functiondef('public._client_portal_customer_open(uuid,uuid)'::regprocedure);"),unknown);
 });
 sql(original);sql(migration);
 check('New helper retains the original predicate source, ABI, ACL, owner and path',()=>assert.equal(metadata(),before));
 check('Internal verified actor can lock only its original business relationship',()=>assert.equal(call(),f.contact));
 check('Helper is volatile, postgres-owned, definer, empty-path and returns only the relationship UUID',()=>{
  const m=JSON.parse(sql(`SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'volatility',provolatile,
   'definer',prosecdef,'path',proconfig,'result',pg_get_function_result(oid)) FROM pg_proc WHERE oid='${helper}'::regprocedure`));
  assert.deepEqual(m,{owner:'postgres',volatility:'v',definer:true,path:['search_path=""'],result:'uuid'});
 });
 for(const role of ['anon','authenticated','service_role']){
  check(`The ${role} API role cannot execute the internal actor helper`,()=>{
   assert.equal(sql(`SELECT has_function_privilege('${role}','${helper}','EXECUTE')`),'f');
   assert.throws(()=>sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public._client_portal_lock_verified_customer('${f.actor}','${f.tenant}','${f.contact}');ROLLBACK;`),/permission denied for function/);
  });
 }
 for(const [name,actor,tenant,client] of [
  ['missing actor',null,f.tenant,f.contact],['missing business',f.actor,null,f.contact],
  ['missing customer',f.actor,f.tenant,null],['other actor',other.actor,f.tenant,f.contact],
  ['owner instead of customer',f.other,f.tenant,f.contact],['other business',f.actor,f.foreign,f.contact],
  ['other customer',f.actor,f.tenant,other.contact]
 ])check(`Internal binding refuses ${name} without changing native records`,()=>{
  const snapshot=sql('SELECT proof_snapshot()');assert.throws(()=>call(actor,tenant,client),/customer relationship unavailable/);
  assert.equal(sql('SELECT proof_snapshot()'),snapshot);
 });
 for(const [name,table,column,value,id] of [
  ['paused','clients','portal_access_state','paused',f.contact],['ended','clients','portal_access_state','ended',f.contact],
  ['archived contact','clients','status','archived',f.contact],['merged contact','clients','merged_into_contact_id',other.contact,f.contact],
  ['inactive business','tenants','status','suspended',f.tenant]
 ]){
  const prior=sql(`SELECT ${column} FROM ${table} WHERE id='${id}'`);
  sql(`UPDATE ${table} SET ${column}=${literal(value)} WHERE id='${id}'`);
  check(`Canonical open-access predicate refuses ${name}`,()=>assert.throws(()=>call(),/customer relationship unavailable/));
  sql(`UPDATE ${table} SET ${column}=${prior?literal(prior):'NULL'} WHERE id='${id}'`);
 }
 check('Returning after fixture restoration resolves the same original customer',()=>assert.equal(call(),f.contact));
 sql(`INSERT INTO clients(id,tenant_id,linked_user_id,status,portal_access_state)
  VALUES('e09b1000-0000-4000-8000-000000000001','${f.foreign}','${f.actor}','active','open');`);
 check('One actor with two business relationships must name the exact matching pair',()=>{
  assert.equal(call(f.actor,f.foreign,'e09b1000-0000-4000-8000-000000000001'),'e09b1000-0000-4000-8000-000000000001');
  assert.throws(()=>call(f.actor,f.tenant,'e09b1000-0000-4000-8000-000000000001'),/customer relationship unavailable/);
  assert.equal(call(),f.contact);
 });
 const waits=[],sessions=[];
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function session(label){
  const child=spawn(exe('psql'),args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const s={child,out:'',err:'',closed:false};sessions.push(s);
  child.stdout.on('data',d=>{s.out+=d;});child.stderr.on('data',d=>{s.err+=d;});
  s.done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{
   s.closed=true;transcripts.push({command:label,args,exitCode:code,stdout:s.out,stderr:s.err});
   if(code===0)resolve();else reject(new Error(s.err||`${label}: ${code}`));
  });});s.done.catch(()=>{});return s;
 }
 const marker=(s,stage)=>s.out.split(/\r?\n/).filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).find(r=>r.stage===stage);
 async function until(fn,label){const end=Date.now()+8000;while(Date.now()<end){const value=fn();if(value)return value;await pause(40);}throw new Error('Missing actual booking-lock witness: '+label);}
 // The local wrapper captures refusal in a subtransaction. It does not grant
 // API roles access or simulate a customer-authenticated production request.
 sql(`CREATE FUNCTION proof_booking_actor_lock_result(actor uuid,business uuid,customer uuid) RETURNS jsonb
  LANGUAGE plpgsql AS $$ DECLARE resolved uuid;BEGIN
   resolved:=public._client_portal_lock_verified_customer(actor,business,customer);
   RETURN jsonb_build_object('ok',true,'customer',resolved);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'state',SQLSTATE,'error',SQLERRM);END $$;
  REVOKE ALL ON FUNCTION proof_booking_actor_lock_result(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;`);
 try{
  const holder=session('psql-booking-share-holder');
  holder.child.stdin.write(`BEGIN;SET LOCAL idle_in_transaction_session_timeout='15s';
SELECT public._client_portal_lock_verified_customer('${f.actor}','${f.tenant}','${f.contact}');
SELECT jsonb_build_object('stage','locked','pid',pg_backend_pid());\n`);
  await until(()=>marker(holder,'locked'),'contact and business shares');
  for(const [table,id] of [['clients',f.contact],['tenants',f.tenant]]){
   check(`Actual share lock excludes concurrent ${table} access changes`,()=>{
    assert.throws(()=>sql(`BEGIN;SET LOCAL lock_timeout='300ms';UPDATE ${table} SET status='suspended' WHERE id='${id}';ROLLBACK;`),/lock timeout/);
    assert.equal(sql(`SELECT status FROM ${table} WHERE id='${id}'`),'active');
   });
  }
  holder.child.stdin.end('ROLLBACK;\n');await holder.done;
  for(const [target,table,column,value] of [
   ['pause','clients','portal_access_state','paused'],['relink','clients','linked_user_id',f.other],
   ['archive','clients','status','archived'],['merge','clients','merged_into_contact_id',other.contact],
   ['close business','tenants','status','suspended']
  ]){
   const id=table==='clients'?f.contact:f.tenant,prior=sql(`SELECT ${column} FROM ${table} WHERE id='${id}'`);
   const owner=session(`psql-booking-${target}-holder`);
   owner.child.stdin.write(`BEGIN;SET LOCAL idle_in_transaction_session_timeout='15s';UPDATE ${table} SET ${column}=${literal(value)} WHERE id='${id}';
SELECT jsonb_build_object('stage','changed','pid',pg_backend_pid());\n`);
   const changed=await until(()=>marker(owner,'changed'),target+' holder');
   const customer=session(`psql-booking-${target}-waiter`);
   customer.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='15s';
SELECT jsonb_build_object('stage','before','pid',pg_backend_pid());
SELECT jsonb_build_object('stage','result','role',current_user,'result',public.proof_booking_actor_lock_result('${f.actor}','${f.tenant}','${f.contact}'));COMMIT;\n`);
   const started=await until(()=>marker(customer,'before'),target+' waiter');
   await until(()=>{
    const row=JSON.parse(sql(`SELECT jsonb_build_object('waiting',wait_event_type='Lock','blocked',${Number(changed.pid)}=ANY(pg_blocking_pids(pid))) FROM pg_stat_activity WHERE pid=${Number(started.pid)}`));
    return row?.waiting&&row.blocked;
   },target+' actual lock wait');
   owner.child.stdin.end('COMMIT;\n');await Promise.all([owner.done,customer.done]);
   const answered=marker(customer,'result');
   // Await actual concurrency outside the runner's synchronous check callback.
   check(`After observed ${target} wait the internal action rechecks and refuses`,()=>{
    assert.deepEqual(answered.result,{ok:false,state:'42501',error:'customer relationship unavailable'});
   });
   waits.push({target,observedNativeWait:true,actualCallerRole:answered.role,result:answered.result});
   sql(`UPDATE ${table} SET ${column}=${prior?literal(prior):'NULL'} WHERE id='${id}'`);
  }
 }finally{
  for(const s of sessions)if(!s.closed){if(!s.child.stdin.writableEnded&&!s.child.stdin.destroyed)s.child.stdin.end('ROLLBACK;\n');s.child.kill();}
  await Promise.allSettled(sessions.map(s=>s.done));
 }
 check('Concurrency and return preserve the original predicate contract',()=>{assert.equal(metadata(),before);assert.equal(call(),f.contact);});
 return {baseline:false,source:migrationPath,migrationSHA256,sourceNormalization:'LF',originalOpenPredicate:'888c27cfa1a9120478db7b7baee7c4f8',
  waits,auth:'SYNTHETIC',reducedSchema:true,fullSchema:'UNVERIFIED',internalComponent:true,
  booking:'NOT_RUN',providers:'NOT_RUN',customerAcceptance:'NOT_RUN'};
}
