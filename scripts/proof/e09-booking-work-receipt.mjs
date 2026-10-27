// Original fenced runner mode. Real PostgreSQL roles/trigger/receipt source;
// reduced tables and Auth transport are SYNTHETIC, not managed or customer proof.
export async function bookingWorkReceiptProof({sql,check,assert,fs,fixture,spawn,exe,args,transcripts,path,work:proofDir,createHash,baseline}) {
 const read=file=>fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
 function original(file,name){
  const source=read(file),start=source.search(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\(`));
  assert(start>=0,name+' original source required');
  const tail=source.slice(start),tag=tail.match(/\bAS (\$\w*\$)/);assert(tag);
  const end=tail.indexOf(tag[1]+';',tag.index+tag[0].length);assert(end>=0);
  return tail.slice(0,end+tag[1].length+1);
 }
 sql(`${original('supabase/migrations/20271113210109_e09_customer_request_scope.sql','_client_portal_request_business')}
 ${original('supabase/migrations/20271113210109_e09_customer_request_scope.sql','client_portal_relationship_id')}
 ${original('supabase/migrations/20271111010000_e09_customer_portal_access.sql','_client_portal_lock_relationship')}
 REVOKE ALL ON FUNCTION public._client_portal_request_business() FROM PUBLIC,anon,authenticated,service_role;
 REVOKE ALL ON FUNCTION public._client_portal_lock_relationship(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
 ALTER TABLE client_contact_methods ADD is_primary boolean DEFAULT true;
 -- Reduced-schema authority fixtures ONLY; the full Sessions suite exercises
 -- the original real Operator registry and retirement functions separately.
 CREATE TABLE fixture_operator_authority(actor uuid PRIMARY KEY);
 CREATE TABLE operator_account_archives(id uuid PRIMARY KEY,state text,scope_ids uuid[]);
 REVOKE ALL ON fixture_operator_authority,operator_account_archives FROM PUBLIC,anon,authenticated,service_role;
 CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $a$
  SELECT EXISTS(SELECT 1 FROM fixture_operator_authority WHERE actor=auth.uid()) $a$;
 CREATE FUNCTION public.operator_may(text) RETURNS boolean LANGUAGE sql STABLE AS $a$
  SELECT $1='fleet.account.permanent_delete' AND public.is_platform_admin() $a$;
 CREATE FUNCTION public.operator_can_permanently_delete_accounts() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $a$
 SELECT auth.uid() IS NOT NULL AND public.is_platform_admin() AND public.operator_may('fleet.account.permanent_delete')
$a$;
 REVOKE ALL ON FUNCTION public.operator_can_permanently_delete_accounts() FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.operator_can_permanently_delete_accounts() TO authenticated;
 CREATE TABLE calendars(id uuid PRIMARY KEY,tenant_id uuid,type text DEFAULT 'personal',title text,description text,
  logo_url text,accent text,duration_min integer DEFAULT 30,buffer_before_min integer DEFAULT 0,buffer_after_min integer DEFAULT 0,
  min_notice_min integer DEFAULT 0,timezone text DEFAULT 'UTC',availability_json jsonb DEFAULT '[]',enabled boolean DEFAULT true,
  theme text DEFAULT 'light',subtitle text,show_company_name boolean DEFAULT true,location_type text DEFAULT 'phone',location_value text,
  notify_config jsonb DEFAULT '{"confirm_guest":false,"confirm_host":false}',location_options jsonb DEFAULT '[]',booking_horizon_days integer DEFAULT 60,
  redirect_url text,intake_questions jsonb DEFAULT '[]',appointment_types jsonb DEFAULT '[]',date_overrides jsonb DEFAULT '[]',capacity integer DEFAULT 2,
  assignment_strategy jsonb DEFAULT '{"mode":"balanced"}');
 CREATE TABLE calendar_hosts(calendar_id uuid,user_id uuid,priority integer DEFAULT 0,availability_json jsonb,timezone text,
  PRIMARY KEY(calendar_id,user_id));
 CREATE TABLE internal_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,host_user_id uuid,
  contact_id uuid,calendar_id uuid,title text,start_at timestamptz,end_at timestamptz,timezone text DEFAULT 'UTC',
  status text DEFAULT 'scheduled',booking_kind text DEFAULT 'single',collective_group_id uuid,notes text,
  capacity integer,class_session_id uuid,guest_name text,guest_email text,guest_phone text,
  location_type text,location_value text,intake_answers jsonb,appointment_type jsonb,source text);
 CREATE EXTENSION btree_gist;
 ALTER TABLE internal_bookings ADD CONSTRAINT fixture_original_time CHECK(end_at>start_at);
 ALTER TABLE internal_bookings ADD CONSTRAINT internal_bookings_no_overlap EXCLUDE USING gist
  (host_user_id WITH =,tstzrange(start_at,end_at,'[)') WITH &&) WHERE(status<>'cancelled' AND booking_kind<>'class_seat');
 CREATE UNIQUE INDEX uq_internal_bookings_class_session ON internal_bookings(calendar_id,start_at)
  WHERE booking_kind='class_session' AND status<>'cancelled';
 ${original('supabase/migrations/20270312000000_create_class_booking_tenant_scope_guard.sql','create_class_booking')}
 REVOKE ALL ON FUNCTION public.create_class_booking(uuid,uuid,uuid,timestamptz,timestamptz,text,integer,text,text,text,text,text,text,text,jsonb,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.create_class_booking(uuid,uuid,uuid,timestamptz,timestamptz,text,integer,text,text,text,text,text,text,text,jsonb,text,uuid) TO service_role;
 ALTER TABLE internal_bookings ENABLE ROW LEVEL SECURITY;
 CREATE POLICY fixture_original_host ON internal_bookings TO authenticated
  USING(host_user_id=auth.uid()) WITH CHECK(host_user_id=auth.uid());
 GRANT SELECT,INSERT,UPDATE,DELETE ON internal_bookings TO authenticated;`);
 check('Original caller resolver and lock are the real production bodies',()=>{
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_relationship_id(uuid)'::regprocedure"),'ff84ba24689e5043d7d15ed3d9150268');
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public._client_portal_lock_relationship(uuid,text)'::regprocedure"),'416002c40cb71ed54cc4c3387c37563f');
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_class_booking(uuid,uuid,uuid,timestamptz,timestamptz,text,integer,text,text,text,text,text,text,text,jsonb,text,uuid)'::regprocedure"),'8dee4ee76b1b4de00d52573fa7a8cb09');
 });
 const f=fixture(),other=fixture(),request='e09b3000-0000-4000-8000-000000000001',work='e09b4000-0000-4000-8000-000000000001';
 sql(`UPDATE clients SET linked_user_id='${f.actor}' WHERE id='${f.contact}';
  UPDATE clients SET linked_user_id='${other.actor}' WHERE id='${other.contact}';
  INSERT INTO internal_bookings(id,tenant_id,host_user_id,contact_id,title,start_at,end_at)
  VALUES('${work}','${f.tenant}','${f.other}','${f.contact}','Consultation',now()+interval '1 day',now()+interval '1 day 30 minutes');`);
 const readReceipt=({actor=f.actor,tenant=f.tenant,client=f.contact,rid=request,headers={},role='authenticated'}={})=>{
  assert(['authenticated','anon','service_role'].includes(role));
  const out=sql(`BEGIN;SELECT set_config('test.actor','${actor}',true);SELECT set_config('request.headers','${JSON.stringify(headers)}',true);
   SET LOCAL ROLE ${role};SELECT public.client_portal_booking_request('${tenant}','${client}','${rid}');ROLLBACK;`);
  return JSON.parse(out.split(/\r?\n/).find(l=>l.startsWith('{"')&&l.includes('schema_version')));
 };
 if(baseline){
  check('A customer can check its exact original request without repeating a create',()=>assert.equal(readReceipt().state,'not_found'));
  return {baseline:true,bookingWriter:'NOT_RUN',auth:'SYNTHETIC',reducedSchema:true};
 }
 const migration='supabase/migrations/20271119110019_e09_private_booking_commit.sql',migrationSource=read(migration);
 const migrationSHA256=createHash('sha256').update(migrationSource).digest('hex');
 const proofSource=read('scripts/proof/e09-booking-work-receipt.mjs'),proofSHA256=createHash('sha256').update(proofSource).digest('hex');
 fs.writeFileSync(path.join(proofDir,'executed-native-booking-proof.mjs'),proofSource);
 fs.writeFileSync(path.join(proofDir,'executed-private-booking-commit.sql'),migrationSource);sql(migrationSource);
 const snapshot=()=>sql("SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]') FROM internal_bookings b");
 check('An absent native request stays not_found, never authorization for another create',()=>{
  const before=snapshot();assert.equal(readReceipt().state,'not_found');assert.equal(snapshot(),before);
 });
 check('An arbitrary audit record cannot manufacture a saved native booking receipt',()=>{
  sql(`INSERT INTO audit_logs(user_id,entity,action,entity_id,data) VALUES('${f.actor}','internal_booking','client_portal_create','${work}',
   jsonb_build_object('portal_request_id','${request}','client_id','${f.contact}','tenant_id','${f.tenant}'));`);
  assert.equal(readReceipt().state,'not_found');
 });
 const mark=`portal_request_id='${request}',portal_actor_user_id='${f.actor}',portal_origin_contact_id='${f.contact}',
  portal_request_intent='{"start":"2026-11-01T10:00:00Z"}',portal_group_size=1`;
 check('Original authenticated host cannot forge trusted request metadata on its own row',()=>{
  const before=snapshot();assert.throws(()=>sql(`BEGIN;SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;
   UPDATE internal_bookings SET ${mark} WHERE id='${work}';COMMIT;`),/original server writer/);assert.equal(snapshot(),before);
 });
 // Fixture-only trusted producer. It is NOT an implemented/verified native
 // booking constructor; that complete pathway remains a separate obligation.
 sql(`UPDATE internal_bookings SET ${mark} WHERE id='${work}'`);
 const saved=readReceipt();
 check('Customer recovery returns only its original work and allowlisted facts',()=>{
  assert.equal(saved.state,'saved');assert.equal(saved.actor_id,f.actor);assert.equal(saved.client_id,f.contact);
  assert.equal(saved.tenant_id,f.tenant);assert.equal(saved.request_id,request);assert.equal(saved.booking.id,work);
  assert.deepEqual(Object.keys(saved.booking).sort(),['end_at','id','start_at','status','timezone','title']);
 });
 check('Returning read preserves the same receipt without touching native appointments',()=>{
  const before=snapshot();assert.deepEqual(readReceipt(),saved);assert.equal(snapshot(),before);
 });
 for(const [name,args]of [['anonymous',{role:'anon'}],['service API',{role:'service_role'}],
  ['owner substitution',{actor:f.other}],['other customer',{actor:other.actor}],['wrong business',{tenant:f.foreign}],
  ['wrong relationship',{client:other.contact}],['conflicting business header',{headers:{'x-client-portal-business':f.foreign}}]])
  check(`Original customer read refuses ${name}`,()=>assert.throws(()=>readReceipt(args)));
 check('A valid other customer never receives this customer original request',()=>{
  assert.equal(readReceipt({actor:other.actor,tenant:other.tenant,client:other.contact}).state,'not_found');
 });
 for(const [column,value]of [['portal_request_id',"'e09b3000-0000-4000-8000-000000000099'"],
  ['portal_actor_user_id',`'${other.actor}'`],['portal_origin_contact_id',`'${other.contact}'`],
  ['portal_request_intent',"'{}'::jsonb"],['portal_group_size','2'],['tenant_id',`'${f.foreign}'`]])
  check(`Trusted original ${column} cannot be rewritten`,()=>{
   const before=snapshot();assert.throws(()=>sql(`UPDATE internal_bookings SET ${column}=${value} WHERE id='${work}'`),/provenance cannot change/);assert.equal(snapshot(),before);
  });
 check('Deleting a marked appointment cannot reopen the old request for another create',()=>{
  assert.throws(()=>sql(`DELETE FROM internal_bookings WHERE id='${work}'`),/retain the original request receipt/);
  assert.deepEqual(readReceipt(),saved);
 });
 check('Original cancellation remains allowed and returning read reflects cancelled work',()=>{
  sql(`UPDATE internal_bookings SET status='cancelled' WHERE id='${work}'`);assert.equal(readReceipt().booking.status,'cancelled');
 });
 check('Historical unmarked host records keep their original update/delete behavior',()=>{
  const legacy='e09b4000-0000-4000-8000-000000000002';
  sql(`INSERT INTO internal_bookings(id,tenant_id,host_user_id,title) VALUES('${legacy}','${f.tenant}','${f.other}','Legacy');
   BEGIN;SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;
   UPDATE internal_bookings SET title='Updated' WHERE id='${legacy}';DELETE FROM internal_bookings WHERE id='${legacy}';COMMIT;`);
  assert.equal(sql(`SELECT count(*) FROM internal_bookings WHERE id='${legacy}'`),'0');
 });
 check('Internal receipt and both trigger functions remain inaccessible to every API role',()=>{
  for(const role of ['anon','authenticated','service_role'])for(const fn of ['_client_portal_booking_original_receipt(uuid,uuid,uuid,uuid)',
   '_client_portal_booking_request_seal()','_client_portal_booking_roster_lock()'])
   assert.equal(sql(`SELECT has_function_privilege('${role}','public.${fn}','EXECUTE')`),'f');
 });
 // Actual native commit component, driven as the service PostgreSQL role. The
 // ORIGINAL public-booking availability engine/server Auth adapter is NOT run.
 // This proves the native transaction, not a customer booking or provider act.
 const calendar='e09b5000-0000-4000-8000-000000000001',team='e09b5000-0000-4000-8000-000000000002',event='e09b5000-0000-4000-8000-000000000003';
 const secondCustomer='e09b6000-0000-4000-8000-000000000001';
 sql(`INSERT INTO tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
  ('${f.tenant}','${f.other}','owner','active',true),('${f.tenant}','${other.other}','member','active',false);
  INSERT INTO clients(id,tenant_id,linked_user_id,status,portal_access_state)
  VALUES('${secondCustomer}','${f.tenant}','${other.actor}','active','open');
  INSERT INTO client_contact_methods(client_id,tenant_id,kind,value,match_key)
  VALUES('${secondCustomer}','${f.tenant}','email','second@example.test','second@example.test');
  INSERT INTO calendars(id,tenant_id,type,title) VALUES('${calendar}','${f.tenant}','personal','Consultation'),
   ('${team}','${f.tenant}','collective','Team session'),('${event}','${f.tenant}','event','Workshop');
  INSERT INTO calendar_hosts(calendar_id,user_id,priority) VALUES('${calendar}','${f.other}',0),
   ('${team}','${f.other}',0),('${team}','${other.other}',1),('${event}','${f.other}',0);`);
 const loader=read('supabase/functions/public-booking/index.ts').match(/async function loadCalendar[\s\S]*?\.select\("([^"]+)"\)/);
 assert(loader,'Original calendar loader source must be available');
 const columns=loader[1].split(',').map(x=>x.trim());assert(columns.every(x=>/^[a-z_]+$/.test(x)));
 const literal=v=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
 let serial=0;
 function plan(cal,hostIds,kind){
  const hours=48+(++serial)*2;
  const raw=JSON.parse(sql(`SELECT jsonb_build_object('calendar_id',c.id,'calendar_source',
   (SELECT jsonb_object_agg(k,to_jsonb(c)->k) FROM unnest(ARRAY[${columns.map(literal).join(',')}]) k),
   'hosts_source',(SELECT jsonb_agg(jsonb_build_object('user_id',h.user_id,'priority',h.priority,
    'availability_json',h.availability_json,'timezone',h.timezone) ORDER BY h.user_id) FROM calendar_hosts h WHERE h.calendar_id=c.id),
   'host_ids',${literal(JSON.stringify(hostIds))}::jsonb,'booking_kind',${literal(kind)},'title',c.title,
   'start_at',clock_timestamp()+interval '${hours} hours','end_at',clock_timestamp()+interval '${hours} hours 30 minutes',
   'guest_name','Avery River','guest_email',${literal(f.email)},'guest_phone',NULL,'notes',NULL,
   'location_type','phone','location_value',NULL,'intake_answers',NULL,'appointment_type',NULL)
   FROM calendars c WHERE c.id='${cal}'`));
  const end=new Date(Date.parse(raw.start_at)+30*60000).toISOString();raw.end_at=end;return raw;
 }
 const requestIntent=p=>({calendar_id:p.calendar_id,start:p.start_at,appointment_type_id:null,location:'phone',notes:null,answers:{}});
 const requestId=n=>`e09b7000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 function commit(p,rid,{actor=f.actor,tenant=f.tenant,client=f.contact,intent=requestIntent(p),role='service_role'}={}){
  assert(['service_role','authenticated','anon'].includes(role));
  const out=sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.client_portal_commit_booking(${literal(actor)},${literal(tenant)},
   ${literal(client)},${literal(rid)},${literal(JSON.stringify(intent))}::jsonb,${p===null?'NULL':literal(JSON.stringify(p))+'::jsonb'});COMMIT;`);
  return JSON.parse(out.split(/\r?\n/).find(l=>l.startsWith('{"')&&l.includes('schema_version')));
 }
 const singlePlan=plan(calendar,[f.other],'single');let single;
 check('The real service-role native transaction saves the original appointment with the exact CRM relationship',()=>{
  single=commit(singlePlan,requestId(1));assert.equal(single.state,'saved');assert.equal(single.replayed,false);
  assert.equal(sql(`SELECT contact_id::text||':'||tenant_id::text FROM internal_bookings WHERE id='${single.booking.id}'`),`${f.contact}:${f.tenant}`);
  assert.equal(readReceipt({rid:requestId(1)}).booking.id,single.booking.id);
 });
 check('Exact native retry returns that same appointment without another booking or audit row',()=>{
  assert(single,'A failed original commit is not replay evidence');const before=snapshot(),audits=sql('SELECT count(*) FROM audit_logs');
  const replay=commit(singlePlan,requestId(1));assert.equal(replay.replayed,true);assert.deepEqual(replay.booking,single.booking);
  assert.equal(snapshot(),before);assert.equal(sql('SELECT count(*) FROM audit_logs'),audits);
 });
 check('A reused native request with changed customer intent is refused atomically',()=>{
  const before=snapshot();assert.throws(()=>commit(singlePlan,requestId(1),{intent:{...requestIntent(singlePlan),notes:'Changed request'}}),/conflicts with its original intent/);
  assert.equal(snapshot(),before);
 });
 check('Original request recovery never exposes later staff-only title or notes',()=>{
  sql(`UPDATE internal_bookings SET title='PRIVATE STAFF TITLE',notes='PRIVATE STAFF NOTE' WHERE id='${single.booking.id}'`);
  const r=readReceipt({rid:requestId(1)});assert.equal(r.state,'saved');assert.equal(r.booking.title,'Consultation');
  assert(!JSON.stringify(r).includes('PRIVATE STAFF'));
 });
 check('An inconsistent foreign calendar cannot supply another business title to the receipt',()=>{
  const foreignCalendar='e09b5000-0000-4000-8000-000000000099';
  sql(`INSERT INTO calendars(id,tenant_id,title) VALUES('${foreignCalendar}','${f.foreign}','PRIVATE FOREIGN CALENDAR');
   UPDATE internal_bookings SET calendar_id='${foreignCalendar}' WHERE id='${single.booking.id}'`);
  const r=readReceipt({rid:requestId(1)});assert.equal(r.booking.title,'Session');assert(!JSON.stringify(r).includes('PRIVATE FOREIGN'));
  sql(`UPDATE internal_bookings SET calendar_id='${calendar}' WHERE id='${single.booking.id}'`);
 });
 check('Native committed audit attribution is the verified customer and exact original work',()=>{
  assert(single);assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE user_id='${f.actor}' AND entity_id='${single.booking.id}'
   AND action='client_portal_create' AND data->>'portal_request_id'='${requestId(1)}'`),'1');
 });
 check('A typed or stale guest address cannot replace the verified customer primary recipient',()=>{
  const before=snapshot(),p={...plan(calendar,[f.other],'single'),guest_email:'unrelated@example.test'};
  assert.throws(()=>commit(p,requestId(92)),/booking recipient changed or unavailable/);assert.equal(snapshot(),before);
 });
 check('A typed phone cannot become a new notification recipient',()=>{
  const before=snapshot(),p={...plan(calendar,[f.other],'single'),guest_phone:'+15550000123'};
  assert.throws(()=>commit(p,requestId(93)),/booking recipient changed or unavailable/);assert.equal(snapshot(),before);
 });
 check('Native admission rechecks the same calendar notice window at the actual write',()=>{
  sql(`UPDATE calendars SET min_notice_min=90 WHERE id='${calendar}'`);
  const p=plan(calendar,[f.other],'single');p.start_at=new Date(Date.now()+10*60000).toISOString();p.end_at=new Date(Date.now()+40*60000).toISOString();
  const before=snapshot();assert.throws(()=>commit(p,requestId(94)),/booking policy window changed/);assert.equal(snapshot(),before);
  sql(`UPDATE calendars SET min_notice_min=0 WHERE id='${calendar}'`);
 });
 check('Native admission cannot pass an original calendar booking horizon',()=>{
  sql(`UPDATE calendars SET booking_horizon_days=1 WHERE id='${calendar}'`);const p=plan(calendar,[f.other],'single'),before=snapshot();
  assert.throws(()=>commit(p,requestId(95)),/booking policy window changed/);assert.equal(snapshot(),before);
  sql(`UPDATE calendars SET booking_horizon_days=60 WHERE id='${calendar}'`);
 });
 for(const role of ['anon','authenticated'])check(`The ${role} API role cannot invoke the private native constructor`,()=>{
  assert.equal(sql(`SELECT has_function_privilege('${role}','public.client_portal_commit_booking(uuid,uuid,uuid,uuid,jsonb,jsonb)','EXECUTE')`),'f');
  assert.throws(()=>commit(singlePlan,requestId(90),{role}),/permission denied for function/);
 });
 for(const [name,over]of [['owner identity',{actor:f.other}],['wrong customer',{client:other.contact}],['wrong business',{tenant:f.foreign}]])
  check('Native constructor refuses '+name+' without appointments or audits',()=>{
   const before=snapshot(),audits=sql('SELECT count(*) FROM audit_logs');assert.throws(()=>commit(singlePlan,requestId(91),over),/customer relationship unavailable/);
   assert.equal(snapshot(),before);assert.equal(sql('SELECT count(*) FROM audit_logs'),audits);
  });
 const stale=plan(calendar,[f.other],'single');
 sql(`UPDATE calendars SET duration_min=45 WHERE id='${calendar}'`);
 check('A service/calendar policy changed after preparation refuses the stale native plan',()=>{
  const before=snapshot();assert.throws(()=>commit(stale,requestId(2)),/booking policy changed/);assert.equal(snapshot(),before);
 });
 sql(`UPDATE calendars SET duration_min=30 WHERE id='${calendar}'`);
 const collectivePlan=plan(team,[f.other,other.other],'collective');let collective;
 check('Native collective booking writes every original host leg and returns the canonical representative',()=>{
  collective=commit(collectivePlan,requestId(3));assert.equal(collective.state,'saved');
  assert.equal(sql(`SELECT count(*) FROM internal_bookings WHERE portal_request_id='${requestId(3)}'`),'2');
  assert.equal(sql(`SELECT count(DISTINCT collective_group_id) FROM internal_bookings WHERE portal_request_id='${requestId(3)}'`),'1');
  assert.equal(sql(`SELECT id FROM internal_bookings WHERE portal_request_id='${requestId(3)}' ORDER BY id LIMIT 1`),collective.booking.id);
 });
 check('A late failure on the second collective host rolls back the first leg and its audit',()=>{
  const p=plan(team,[f.other,other.other],'collective');
  sql(`INSERT INTO internal_bookings(tenant_id,host_user_id,title,start_at,end_at) VALUES
   ('${f.tenant}','${other.other}','Host busy',${literal(p.start_at)},${literal(p.end_at)});`);
  const before=snapshot(),audits=sql('SELECT count(*) FROM audit_logs');assert.throws(()=>commit(p,requestId(4)),/exclusion constraint/);
  assert.equal(snapshot(),before);assert.equal(sql('SELECT count(*) FROM audit_logs'),audits);
 });
 const eventPlan=plan(event,[f.other],'class_seat');let seat;
 check('Native class booking invokes the original capacity writer and seals its actual seat',()=>{
  seat=commit(eventPlan,requestId(5));assert.equal(seat.state,'saved');
  assert.equal(sql(`SELECT booking_kind FROM internal_bookings WHERE id='${seat.booking.id}'`),'class_seat');
  assert.equal(sql(`SELECT count(*) FROM internal_bookings WHERE calendar_id='${event}' AND booking_kind='class_session'`),'1');
 });
 check('A class marker with an original Portal seat cannot be deleted out from under its receipt',()=>{
  const before=snapshot();assert.throws(()=>sql(`DELETE FROM internal_bookings WHERE calendar_id='${event}' AND booking_kind='class_session'`),/retain the original request receipt/);
  assert.equal(snapshot(),before);
 });
 check('Changed actual class timing refuses another seat without a partial native write',()=>{
  sql(`UPDATE internal_bookings SET end_at=end_at+interval '15 minutes' WHERE calendar_id='${event}' AND booking_kind='class_session'`);
  const before=snapshot(),audits=sql('SELECT count(*) FROM audit_logs');
  assert.throws(()=>commit({...eventPlan,guest_email:'second@example.test'},requestId(66),{actor:other.actor,client:secondCustomer}),/booking class changed/);
  assert.equal(snapshot(),before);assert.equal(sql('SELECT count(*) FROM audit_logs'),audits);
  sql(`UPDATE internal_bookings SET end_at=end_at-interval '15 minutes' WHERE calendar_id='${event}' AND booking_kind='class_session'`);
 });
 check('Another authorized customer uses the same original class session without crossing relationships',()=>{
  const p={...eventPlan,guest_name:'Casey Lake',guest_email:'second@example.test'};
  const r=commit(p,requestId(6),{actor:other.actor,client:secondCustomer});assert.equal(r.state,'saved');
  assert.equal(readReceipt({actor:other.actor,client:secondCustomer,rid:requestId(6)}).booking.id,r.booking.id);
  assert.equal(readReceipt({rid:requestId(6)}).state,'not_found');
 });
 check('Original class capacity refuses a further seat without a partial booking or audit',()=>{
  const before=snapshot(),audits=sql('SELECT count(*) FROM audit_logs');assert.throws(()=>commit(eventPlan,requestId(7)),/sold_out/);
  assert.equal(snapshot(),before);assert.equal(sql('SELECT count(*) FROM audit_logs'),audits);
 });
 check('An exact original class request still replays after that class fills',()=>{
  assert(seat);const before=snapshot(),r=commit(eventPlan,requestId(5));assert.equal(r.replayed,true);assert.equal(r.booking.id,seat.booking.id);assert.equal(snapshot(),before);
 });
 check('Native execution result preserves the actual engine host order and collective work identity',()=>{
  assert(collective);assert.deepEqual(collective.execution.host_ids,[f.other,other.other]);
  assert.equal(collective.execution.booking_kind,'collective');
  assert.equal(sql(`SELECT collective_group_id FROM internal_bookings WHERE id='${collective.booking.id}'`),collective.execution.collective_group_id);
  assert.equal(commit(collectivePlan,requestId(3)).execution,null,'A replay must not produce another provider execution instruction');
 });
 function reconcile(rid,intent){
  const out=sql(`BEGIN;SET LOCAL ROLE service_role;SELECT public.client_portal_reconcile_booking('${f.actor}','${f.tenant}','${f.contact}',
   '${rid}',${literal(JSON.stringify(intent))}::jsonb);COMMIT;`);
  return JSON.parse(out.split(/\r?\n/).find(l=>l.startsWith('{"')&&l.includes('schema_version')));
 }
 check('Exact-intent service reconciliation recovers original work even after its calendar closes',()=>{
  assert(single);sql(`UPDATE calendars SET enabled=false WHERE id='${calendar}'`);
  const before=snapshot(),r=reconcile(requestId(1),requestIntent(singlePlan));assert.equal(r.state,'saved');assert.equal(r.booking.id,single.booking.id);
  assert.equal(r.replayed,true);assert.equal(r.execution,null);assert.equal(snapshot(),before);
 });
 check('Changed request intent cannot relabel an earlier appointment as the new requested outcome',()=>{
  const r=reconcile(requestId(1),{...requestIntent(singlePlan),notes:'different intent'});assert.equal(r.state,'conflict');assert.equal(r.booking,null);assert.equal(r.execution,null);
 });
 // Real two-connection native request concurrency, awaited OUTSIDE the original
 // runner's synchronous check callbacks. Never turn an unresolved Promise PASS.
 const sessions=[],waits=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function session(label){
  const child=spawn(exe('psql'),args,{windowsHide:true,stdio:['pipe','pipe','pipe']}),s={child,out:'',err:'',closed:false};sessions.push(s);
  child.stdout.on('data',d=>{s.out+=d;});child.stderr.on('data',d=>{s.err+=d;});
  s.done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{
   s.closed=true;transcripts.push({command:label,args,exitCode:code,stdout:s.out,stderr:s.err});if(code===0)resolve();else reject(new Error(s.err||`${label}: ${code}`));
  });});s.done.catch(()=>{});return s;
 }
 const marker=(s,stage)=>s.out.split(/\r?\n/).filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).find(r=>r.stage===stage);
 async function until(fn,label){const end=Date.now()+8000;while(Date.now()<end){const value=fn();if(value)return value;await pause(40);}throw new Error('Missing native request witness: '+label);}
 const expression=(p,rid)=>`public.client_portal_commit_booking('${f.actor}','${f.tenant}','${f.contact}','${rid}',
  ${literal(JSON.stringify(requestIntent(p)))}::jsonb,${literal(JSON.stringify(p))}::jsonb)`;
 try{
  // A genuine priority order different from UUID order, rather than merely
  // labeling an arbitrary reversed input as the original engine's decision.
  sql(`UPDATE calendar_hosts SET priority=-1 WHERE calendar_id='${team}' AND user_id='${other.other}'`);
  const p=plan(team,[other.other,f.other],'collective'),rid=requestId(80),first=session('psql-portal-booking-first');
  first.child.stdin.write(`BEGIN;SET LOCAL idle_in_transaction_session_timeout='20s';SET LOCAL ROLE service_role;
SELECT jsonb_build_object('stage','saved','pid',pg_backend_pid(),'result',${expression(p,rid)});\n`);
  const saved=await until(()=>marker(first,'saved'),'first native save');
  const second=session('psql-portal-booking-retry');
  second.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL ROLE service_role;
SELECT jsonb_build_object('stage','before','pid',pg_backend_pid());
SELECT jsonb_build_object('stage','replayed','result',${expression(p,rid)});COMMIT;\n`);
  const started=await until(()=>marker(second,'before'),'native retry started');
  await until(()=>{
   const row=JSON.parse(sql(`SELECT jsonb_build_object('waiting',wait_event_type='Lock','blocked',${Number(saved.pid)}=ANY(pg_blocking_pids(pid)))
    FROM pg_stat_activity WHERE pid=${Number(started.pid)}`));return row?.waiting&&row.blocked;
  },'actual same-request native wait');
  // While the create is uncommitted, a read cannot invent saved work or treat
  // its absence as an instruction to dispatch an external action.
  const beforeCommit=readReceipt({rid});
  first.child.stdin.end('COMMIT;\n');await Promise.all([first.done,second.done]);
  const replayed=marker(second,'replayed');
  check('Concurrent identical native request waits and returns the same original appointment once',()=>{
   assert.equal(beforeCommit.state,'not_found');assert.equal(saved.result.replayed,false);assert.equal(replayed.result.replayed,true);
   assert.equal(saved.result.booking.id,replayed.result.booking.id);assert.equal(replayed.result.execution,null);
   assert.equal(sql(`SELECT count(*) FROM internal_bookings WHERE portal_request_id='${rid}'`),'2');
   assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE action='client_portal_create' AND data->>'portal_request_id'='${rid}'`),'1');
  });
  check('Actual collective execution retains the original engine order even when it differs from UUID sorting',()=>{
   assert.deepEqual(saved.result.execution.host_ids,[other.other,f.other]);
  });
  waits.push({kind:'identical request',observedNativeWait:true,sameOriginalWork:saved.result.booking.id===replayed.result.booking.id,
   createdHostLegs:2,createAudits:1,replayedExecution:null});
 }finally{
  for(const s of sessions)if(!s.closed){if(!s.child.stdin.writableEnded&&!s.child.stdin.destroyed)s.child.stdin.end('ROLLBACK;\n');s.child.kill();}
  await Promise.allSettled(sessions.map(s=>s.done));
 }
 // Gate behavior with explicitly synthetic Operator dependencies. The full
 // schema suite separately runs the REAL original registry/archive/delete path.
 const retirement='e09b8000-0000-4000-8000-000000000001';
 sql(`INSERT INTO fixture_operator_authority(actor) VALUES('${f.other}')`);
 const removeMarked=()=>sql(`BEGIN;SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;
  DELETE FROM internal_bookings WHERE id='${single.booking.id}' RETURNING id;ROLLBACK;`);
 check('A fixture Operator permission without the original deleting scope cannot erase a marked request',()=>{
  assert.throws(removeMarked,/retain the original request receipt/);
 });
 sql(`INSERT INTO operator_account_archives(id,state,scope_ids) VALUES('${retirement}','deleting',ARRAY['${f.foreign}']::uuid[])`);
 check('A deleting operation for another business cannot erase this original request',()=>{
  assert.throws(removeMarked,/retain the original request receipt/);
 });
 sql(`UPDATE operator_account_archives SET scope_ids=ARRAY['${f.tenant}']::uuid[] WHERE id='${retirement}'`);
 check('The marked deletion guard admits only the exact permitted deleting scope (rolled back synthetic authority)',()=>{
  assert(removeMarked().includes(single.booking.id));assert.equal(readReceipt({rid:requestId(1)}).booking.id,single.booking.id);
 });
 sql(`UPDATE operator_account_archives SET state='deleted' WHERE id='${retirement}'`);
 check('A finished old retirement record cannot be replayed as deletion permission',()=>{
  assert.throws(removeMarked,/retain the original request receipt/);
 });
 for(const access of ['paused','ended']){
  sql(`UPDATE clients SET portal_access_state='${access}' WHERE id='${f.contact}'`);
  check(`${access} customer access withholds the original booking receipt`,()=>assert.throws(()=>readReceipt()));
 }
 return {baseline:false,migration,migrationSHA256,proofSHA256,sourceNormalization:'LF',waits,auth:'SYNTHETIC',reducedSchema:true,fullSchema:'UNVERIFIED',
  nativeProvenanceProducer:'REAL SERVICE-ROLE NATIVE COMPONENT; original engine/actual Auth not run',providers:'NOT_RUN',customerAcceptance:'NOT_RUN'};
}
