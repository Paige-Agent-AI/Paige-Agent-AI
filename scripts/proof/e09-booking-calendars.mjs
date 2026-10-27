// One mode of the incumbent disposable loopback runner, not a second proof engine.
// Executes the exact production-bound resolver and new migration. Auth transport
// and reduced tables remain synthetic; the original full-schema pgTAP suite is
// independently required. Never accepts a remote endpoint or production identity.
export function bookingCalendarsProof({sql,check,assert,fs,fixture,baseline}) {
 const read=file=>fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
 const source=read('supabase/migrations/20271113210109_e09_customer_request_scope.sql');
 const extract=name=>{
  const start=source.search(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\(`));
  assert(start>=0,`Original ${name} source`);
  const tail=source.slice(start),tag=tail.match(/\bAS (\$\w*\$)/);
  assert(tag);const end=tail.indexOf(tag[1]+';',tag.index+tag[0].length);
  assert(end>=0);return tail.slice(0,end+tag[1].length+1);
 };
 const migrationPath='supabase/migrations/20271118110009_e09_customer_calendar_discovery.sql';
 const migration=read(migrationPath);
 // Match the real per-business identity floor in this REDUCED fixture. This
 // does not run against a managed database or remove any product constraint.
 sql(`ALTER TABLE tenants ADD status text DEFAULT 'active';
  ALTER TABLE clients ADD portal_access_state text DEFAULT 'open';
  ALTER TABLE clients DROP CONSTRAINT clients_linked_user_id_key;
  CREATE UNIQUE INDEX clients_tenant_linked_user_key ON clients(tenant_id,linked_user_id);
  CREATE TABLE calendars(id uuid PRIMARY KEY,tenant_id uuid,slug text UNIQUE,title text,description text,
   duration_min integer,timezone text,enabled boolean DEFAULT false);
  CREATE INDEX calendars_tenant_idx ON calendars(tenant_id);
  CREATE TABLE calendar_hosts(calendar_id uuid,user_id uuid,PRIMARY KEY(calendar_id,user_id));
  ${extract('_client_portal_request_business')}
  REVOKE ALL ON FUNCTION public._client_portal_request_business() FROM PUBLIC,anon,authenticated,service_role;
  ${extract('client_portal_relationship_id')}
  REVOKE ALL ON FUNCTION public.client_portal_relationship_id(uuid) FROM PUBLIC,anon;
  GRANT EXECUTE ON FUNCTION public.client_portal_relationship_id(uuid) TO authenticated,service_role;`);
 const f=fixture(),other=fixture();
 sql(`UPDATE clients SET linked_user_id='${f.actor}' WHERE id='${f.contact}';
  INSERT INTO tenant_members(tenant_id,user_id,role,status,is_owner) VALUES('${f.tenant}','${f.other}','owner','active',true);
  INSERT INTO calendars VALUES
   ('e09c0000-0000-4000-8000-000000000001','${f.tenant}','test-calendar-alpha','Alpha',repeat('Public ',500),30,'UTC',true),
   ('e09c0000-0000-4000-8000-000000000002','${f.tenant}','test-calendar-beta','Beta',NULL,45,'UTC',true),
   ('e09c0000-0000-4000-8000-000000000003','${f.tenant}','test-calendar-paused','Paused',NULL,30,'UTC',false),
   ('e09c0000-0000-4000-8000-000000000004','${f.tenant}','test-calendar-unrostered','No hosts',NULL,30,'UTC',true),
   ('e09c0000-0000-4000-8000-000000000005','${f.foreign}','test-calendar-foreign','Other business',NULL,30,'UTC',true),
   ('e09c0000-0000-4000-8000-000000000006','${f.tenant}','test-calendar-wrong-host','Wrong host',NULL,30,'UTC',true);
  INSERT INTO calendar_hosts VALUES
   ('e09c0000-0000-4000-8000-000000000001','${f.other}'),
   ('e09c0000-0000-4000-8000-000000000002','${f.other}'),
   ('e09c0000-0000-4000-8000-000000000003','${f.other}'),
   ('e09c0000-0000-4000-8000-000000000005','${f.other}'),
   ('e09c0000-0000-4000-8000-000000000006','${other.other}');`);
 const literal=v=>v==null?'NULL':`'${String(v).replaceAll("'","''")}'`;
 const call=({actor=f.actor,tenant=f.tenant,client=f.contact,after=null,limit=20,headers={},role='authenticated'}={})=>{
  assert(['authenticated','anon','service_role'].includes(role));
  const out=sql(`BEGIN;SELECT set_config('test.actor',${literal(actor)},true);
   SELECT set_config('request.headers',${literal(JSON.stringify(headers))},true);
   SET LOCAL ROLE ${role};SELECT public.client_portal_booking_calendars(
    ${literal(tenant)},${literal(client)},${literal(after)},${limit===null?'NULL':Number(limit)});ROLLBACK;`);
  return JSON.parse(out.split(/\r?\n/).find(line=>line.startsWith('{"calendars"')||line.startsWith('{"tenant_id"')||line.includes('"next_after_slug"')));
 };
 const metadata=()=>sql("SELECT jsonb_build_object('body',md5(prosrc),'acl',proacl::text,'owner',proowner,'volatility',provolatile,'config',proconfig) FROM pg_proc WHERE oid='public.client_portal_relationship_id(uuid)'::regprocedure");
 const before=metadata();
 check('Actual original customer resolver matches production body and safe source dependency',()=>{
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_relationship_id(uuid)'::regprocedure"),'ff84ba24689e5043d7d15ed3d9150268');
 });
 if(baseline){
  check('An authorized customer can discover the actual published business calendars',()=>assert.equal(call().calendars.length,2));
  return {baseline:true,source:migrationPath,availability:'NOT_RUN',bookingWriter:'NOT_RUN',fullSchema:'UNVERIFIED'};
 }
 const original=sql("SELECT pg_get_functiondef('public.client_portal_relationship_id(uuid)'::regprocedure)");
 const unknown=original.replace('_uid uuid := auth.uid();','_uid uuid := auth.uid(); -- unknown predecessor');
 assert.notEqual(unknown,original);sql(unknown);
 check('Unknown original authorization source refuses migration without creating an exposed reader',()=>{
  assert.throws(()=>sql(migration),/Original customer relationship contract changed/);
  assert.equal(sql("SELECT pg_get_functiondef('public.client_portal_relationship_id(uuid)'::regprocedure)"),unknown);
  assert.equal(sql("SELECT to_regprocedure('public.client_portal_booking_calendars(uuid,uuid,text,integer)') IS NULL"),'t');
 });
 sql(original);sql(migration);
 check('Discovery does not alter the original resolver body, ACL, owner, volatility or path',()=>assert.equal(metadata(),before));
 const result=call();
 check('Only original enabled/rostered calendars for the selected business are returned',()=>{
  assert.deepEqual(result.calendars.map(c=>c.slug),['test-calendar-alpha','test-calendar-beta']);
  assert.equal(result.tenant_id,f.tenant);assert.equal(result.client_id,f.contact);
 });
 check('No host/provider/guest/notes/configuration fields leak through the allowlist',()=>{
  for(const c of result.calendars)assert.deepEqual(Object.keys(c).sort(),['description','duration_min','id','slug','timezone','title']);
  assert.equal(result.calendars[0].description.length,1200);
 });
 check('Bounded keyset pages preserve the original records and final cursor state',()=>{
  const first=call({limit:1}),last=call({after:first.next_after_slug,limit:1});
  assert.equal(first.has_more,true);assert.equal(first.calendars.length,1);
  assert.equal(last.calendars[0].slug,'test-calendar-beta');assert.equal(last.has_more,false);assert.equal(last.next_after_slug,null);
  assert.deepEqual(call({after:'test-calendar-beta'}).calendars,[]);
 });
 for(const [name,options] of [
  ['anonymous database role',{role:'anon'}],['service database role',{role:'service_role'}],
  ['no Auth subject',{actor:null}],['business owner in place of customer',{actor:f.other}],
  ['wrong customer relationship',{client:other.contact}],['wrong business',{tenant:f.foreign}],
  ['missing business intent',{tenant:null}],['missing customer intent',{client:null}],
  ['conflicting request business',{headers:{'x-client-portal-business':f.foreign}}],
  ['malformed request business',{headers:{'x-client-portal-business':'bad'}}],
  ['zero bound',{limit:0}],['unbounded page',{limit:51}],['null bound',{limit:null}],
  ['oversized cursor',{after:'x'.repeat(241)}]
 ])check(`Discovery refuses ${name}`,()=>assert.throws(()=>call(options)));
 check('Return reads are identical and never create a booking, profile or CRM record',()=>{
  const snapshot=sql('SELECT proof_snapshot();');assert.deepEqual(call(),result);assert.equal(sql('SELECT proof_snapshot();'),snapshot);
 });
 sql(`INSERT INTO clients(id,tenant_id,linked_user_id,status,portal_access_state)
  VALUES('e09c1000-0000-4000-8000-000000000001','${f.foreign}','${f.actor}','active','open');
  INSERT INTO tenant_members(tenant_id,user_id,role,status,is_owner) VALUES('${f.foreign}','${f.other}','owner','active',true);`);
 check('Multi-business selection never combines the two original relationship lists',()=>{
  assert.deepEqual(call().calendars,result.calendars);
  const foreign=call({tenant:f.foreign,client:'e09c1000-0000-4000-8000-000000000001'});
  assert.deepEqual(foreign.calendars.map(c=>c.slug),['test-calendar-foreign']);
  assert.throws(()=>call({client:'e09c1000-0000-4000-8000-000000000001'}));
 });
 // Direct fixture state below is not an access-writer proof. The committed
 // full-schema suite independently uses the original owner pause/restore/end.
 for(const state of ['paused','ended']){
  sql(`UPDATE clients SET portal_access_state='${state}' WHERE id='${f.contact}';`);
  check(`Original resolver withholds discovery after fixture access becomes ${state}`,()=>assert.throws(()=>call()));
 }
 sql(`UPDATE clients SET portal_access_state='open' WHERE id='${f.contact}';`);
 check('Returning after fixture access restoration reads the same original calendars',()=>assert.deepEqual(call(),result));
 sql(`UPDATE tenant_members SET status='suspended' WHERE tenant_id='${f.tenant}' AND user_id='${f.other}';`);
 check('Inactive original hosts immediately remove their calendars from discovery',()=>assert.deepEqual(call().calendars,[]));
 return {baseline:false,source:migrationPath,originalResolverBody:'ff84ba24689e5043d7d15ed3d9150268',authTransport:'SYNTHETIC',
  reducedSchema:true,fullSchema:'UNVERIFIED',availability:'NOT_RUN',bookingWriter:'NOT_RUN',providers:'NOT_RUN',customerAcceptance:'NOT_RUN'};
}
