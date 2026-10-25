// Original native bodies inside the existing fenced E09 proof. Synthetic scope,
// schema and realtime ports only; not full-schema or ordinary-customer evidence.
export async function messageActivityProof({sql,check,assert,fs,root,path,fixture}) {
 const read=p=>fs.readFileSync(path.join(root,p),'utf8').replaceAll('\r\n','\n');
 function source(file,name){
  const text=read(file),start=new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\(').exec(text)?.index??-1;
  assert.ok(start>=0,'Original source required: '+name);
  const tail=text.slice(start),quote=/\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(tail);
  assert.ok(quote,'Original function delimiter required: '+name);
  const end=tail.indexOf(quote[1],quote.index+quote[0].length);
  assert.ok(end>quote.index,'Original function terminator required: '+name);
  return tail.slice(0,end+quote[1].length)+';';
 }
 sql(`ALTER TABLE clients ADD COLUMN portal_access_state text NOT NULL DEFAULT 'open';
 CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,thread_key text,contact_id uuid,
  channel_type text,direction text,status text,sender jsonb,recipients jsonb,subject text,body_text text,meta jsonb,
  sent_at timestamptz,created_at timestamptz DEFAULT now());
 CREATE UNIQUE INDEX messages_portal_request ON messages((meta #>> '{portal,request_id}')) WHERE channel_type='portal';
 CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,title text,message text,action_url text,metadata jsonb);
 CREATE TABLE paige_event_kinds(slug text,tenant_id uuid,enabled boolean,default_audience text,default_visibility text,department text);
 INSERT INTO paige_event_kinds VALUES('comms.inbound',NULL,true,'both','client_visible','comms'),('comms.outbound',NULL,true,'both','client_visible','comms');
 ALTER TABLE paige_client_events ADD COLUMN id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 ADD COLUMN event_kind text,ADD COLUMN surface text,ADD COLUMN actor_type text,ADD COLUMN actor_user_id uuid,
 ADD COLUMN from_department text,ADD COLUMN to_department text,ADD COLUMN title text,ADD COLUMN summary text,
 ADD COLUMN payload jsonb,ADD COLUMN ref_table text,ADD COLUMN ref_id uuid,ADD COLUMN occurred_at timestamptz,
 ADD COLUMN actor_agent_slug text,ADD COLUMN actor_agent_label text;
 CREATE TABLE proof_rail_broadcasts(payload jsonb,event text,topic text,private boolean);
 CREATE SCHEMA realtime;
 CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS $$INSERT INTO proof_rail_broadcasts VALUES($1,$2,$3,$4)$$;
 CREATE FUNCTION public.has_any_role(uuid,text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=$1 AND role=ANY($2))$$;
 CREATE FUNCTION public.is_tenant_admin(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS(SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=auth.uid() AND status='active' AND role IN('owner','admin'))$$;`);
 const s7='supabase/migrations/20271111010000_e09_customer_portal_access.sql';
 const requestSource='supabase/migrations/20271113210109_e09_customer_request_scope.sql';
 sql(source(requestSource,'_client_portal_request_business'));
 sql(source(requestSource,'client_portal_relationship_id'));
 sql(source('supabase/migrations/20271110010000_e09_customer_portal_messages.sql','_portal_message_body'));
 sql(source(s7,'client_portal_send_message'));sql(source(s7,'comms_portal_reply'));
 let rail=source('supabase/migrations/20261201000800_the_rail_says_which_agent_acted.sql','record_rail_event');
 const doc=read('supabase/migrations/20271108150000_e09_customer_documents.sql');
 const old=doc.match(/_old text:=\$old\$([\s\S]*?)\$old\$/)?.[1],next=doc.match(/_new text:=\$new\$([\s\S]*?)\$new\$/)?.[1];
 assert.ok(old&&next&&rail.split(old).length===2,'Original Rail relationship patch must match once');rail=rail.replace(old,next);sql(rail);
 // Reconstruct the original canonical role retirement too; do not revive the
 // historical coach permission or weaken the observed-production fingerprint.
 const retired=read('supabase/migrations/20270504000000_retire_title_role_from_functions.sql');
 const readsRole=retired.match(/CREATE FUNCTION pg_temp\.reads_retired_role\([\s\S]*?\n\$\$;/)?.[0];
 const retireRole=retired.match(/CREATE FUNCTION pg_temp\.retire_role\([\s\S]*?\n\$\$;/)?.[0];
 assert.ok(readsRole&&retireRole,'Original canonical role-retirement helpers required');
 sql(readsRole+'\n'+retireRole+"\nSELECT pg_temp.retire_role('public.record_rail_event(uuid,text,text,text,text,text,jsonb,text,uuid,text,text,timestamptz,boolean,uuid,text)'::regprocedure);");
 const expected={client_portal_send_message:'0a0c835abd6fca8973068ea5c2640f83',comms_portal_reply:'e59afbaaa5d3f9003c2e26f1403b3729',record_rail_event:'06927b300c0a9645bae072a0a6aee2af'};
 for(const [name,hash]of Object.entries(expected))assert.equal(sql(`SELECT md5(prosrc) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='${name}'`),hash,'Actual production fingerprint: '+name);
 sql('REVOKE ALL ON FUNCTION client_portal_send_message(text,uuid,text,uuid),comms_portal_reply(uuid,uuid,text,uuid),record_rail_event(uuid,text,text,text,text,text,jsonb,text,uuid,text,text,timestamptz,boolean,uuid,text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION client_portal_send_message(text,uuid,text,uuid),comms_portal_reply(uuid,uuid,text,uuid),record_rail_event(uuid,text,text,text,text,text,jsonb,text,uuid,text,text,timestamptz,boolean,uuid,text) TO authenticated,service_role;');
 const f=fixture();
 sql(`UPDATE clients SET linked_user_id='${f.actor}' WHERE id='${f.contact}';
 INSERT INTO tenant_members VALUES('${f.tenant}','${f.other}','owner','active',true,now(),now());
 INSERT INTO profiles VALUES('${f.other}','${f.tenant}');INSERT INTO user_roles VALUES('${f.actor}','client'),('${f.other}','admin');`);
 const call=(actor,query)=>JSON.parse(sql(`BEGIN;SELECT set_config('test.actor','${actor}',true);SET LOCAL ROLE authenticated;${query};COMMIT;`).split(/\r?\n/).find(s=>s.startsWith('{')));
 const customer=`SELECT client_portal_send_message('Synthetic shared message','${f.invite}','message','${f.tenant}')`;
 let sent=call(f.actor,customer);
 check('Original current native customer message saves once',()=>{assert.equal(sent.ok,true);assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${sent.message_id}' AND tenant_id='${f.tenant}' AND contact_id='${f.contact}' AND direction='inbound' AND status='received'`),'1');});
 check('Customer shared message has one original Rail event linked to that message',()=>{assert.equal(sql(`SELECT count(*) FROM paige_client_events WHERE ref_table='messages' AND ref_id='${sent.message_id}' AND event_kind='comms.inbound' AND actor_type='client' AND actor_user_id='${f.actor}' AND tenant_id='${f.tenant}' AND contact_id='${f.contact}' AND audience='both' AND visibility='client_visible'`),'1');});
 check('Identical customer message request replays its original message',()=>{const again=call(f.actor,customer);assert.equal(again.replayed,true);assert.equal(again.message_id,sent.message_id);});
 const reply=`SELECT comms_portal_reply('${f.tenant}','${f.contact}','Synthetic business reply','${f.foreign}')`;
 const saved=call(f.other,reply);
 check('Original current native business reply saves once without a provider',()=>{assert.equal(saved.ok,true);assert.equal(sql(`SELECT count(*) FROM messages WHERE id='${saved.message_id}' AND direction='outbound' AND status='delivered'`),'1');assert.equal(sql(`SELECT count(*) FROM notifications WHERE metadata->>'message_id'='${saved.message_id}'`),'1');});
 check('Business shared reply has one original Rail event linked to that message',()=>{assert.equal(sql(`SELECT count(*) FROM paige_client_events WHERE ref_table='messages' AND ref_id='${saved.message_id}' AND event_kind='comms.outbound' AND actor_type='owner_staff' AND actor_user_id='${f.other}' AND tenant_id='${f.tenant}' AND contact_id='${f.contact}' AND audience='both' AND visibility='client_visible'`),'1');});
 check('Identical business reply request replays without a second notice',()=>{const again=call(f.other,reply);assert.equal(again.replayed,true);assert.equal(again.message_id,saved.message_id);assert.equal(sql(`SELECT count(*) FROM notifications WHERE metadata->>'message_id'='${saved.message_id}'`),'1');});
}
