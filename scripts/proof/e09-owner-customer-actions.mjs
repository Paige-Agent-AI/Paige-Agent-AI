// Extend the original E09 loopback PostgreSQL runner, not another DB/QA engine.
// Auth/tenant-admin transport is explicitly synthetic; the original Portal owner
// helper and current-workspace authorizer run unchanged. Full schema roles are
// additionally exercised by the existing customer_portal_access.sql CI suite.
export function ownerActionReadProof({sql,check,assert,fs,root,path,fixture}) {
 const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8').replaceAll('\r\n','\n');
 const sourceFunction=(source,name)=>{
  const match=source.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?END \\$\\$;`));
  assert(match,`Original native ${name} source required`);return match[0];
 };
 const owner=sourceFunction(read('20271108233000_e09_customer_invitation_operation.sql'),'_client_portal_invitation_owner');
 const authority=sourceFunction(read('20271111010000_e09_customer_portal_access.sql'),'_client_portal_access_authorize');
 const actionSchema=read('20260702031428_90fade5b-1028-4c00-bd76-dfee700357d2.sql');
 const legacy=actionSchema.slice(actionSchema.indexOf('CREATE OR REPLACE FUNCTION public.list_pending_customer_actions('));
 assert(legacy.includes('$$;'));sql(legacy.slice(0,legacy.indexOf('$$;')+3));
 sql(`ALTER TABLE clients ADD COLUMN portal_access_state text NOT NULL DEFAULT 'open',ADD COLUMN paige_shared_context_consent boolean NOT NULL DEFAULT false;
 CREATE OR REPLACE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT active_tenant_id FROM public.profiles WHERE user_id=auth.uid()$$;
 CREATE OR REPLACE FUNCTION public.is_tenant_admin(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=$1 AND user_id=auth.uid() AND status='active' AND role IN ('owner','admin'))$$;
 ${owner}
 ${authority}
 REVOKE ALL ON FUNCTION public._client_portal_invitation_owner(uuid),public._client_portal_access_authorize(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;`);
 const original=()=>sql(`SELECT md5(pg_get_functiondef('public.list_pending_customer_actions(uuid)'::regprocedure))||':'||md5(pg_get_functiondef('public.customer_respond_to_action(uuid,text,text,timestamptz)'::regprocedure))||':'||md5(pg_get_functiondef('public._client_portal_access_authorize(uuid,uuid,boolean)'::regprocedure))`);
 const before=original();
 if(process.env.E09_OWNER_ACTION_BASELINE!=='1'){
  const migration=read('20271114090000_e09_owner_customer_action_read.sql');sql(migration);sql(migration);
 }
 const f=fixture(),g=fixture();
 sql(`INSERT INTO profiles(user_id,active_tenant_id) VALUES('${f.other}','${f.tenant}'),('${g.other}','${g.tenant}');
 INSERT INTO tenant_members(tenant_id,user_id,role,status,is_owner) VALUES('${f.tenant}','${f.other}','owner','active',true),('${g.tenant}','${g.other}','owner','active',true);
 UPDATE clients SET linked_user_id='${f.actor}' WHERE id='${f.contact}';
 INSERT INTO paige_customer_actions(id,tenant_id,contact_id,initiated_by_admin_id,action_type,title,body,payload_json,status)
 VALUES('${f.invite}','${f.tenant}','${f.contact}','${f.other}','task','Review the welcome guide','Read the shared guide.','{"private":"DO NOT PROJECT"}','customer_notified'),
 ('${g.invite}','${g.tenant}','${g.contact}','${g.other}','task','FOREIGN ACTION',NULL,'{}','proposed');
 INSERT INTO paige_customer_responses(action_id,contact_id,responded_by_user_id,response_type,response_text)
 VALUES('${f.invite}','${f.contact}','${f.actor}','question','Which section first?'),('${f.invite}','${g.contact}','${g.actor}','question','FOREIGN RESPONSE');`);
 const lit=x=>x===null?'NULL':`'${String(x).replaceAll("'","''")}'`;
 const query=(actor=f.other,tenant=f.tenant,contact=f.contact,expected=actor,role='authenticated')=>sql(`BEGIN;SELECT set_config('test.actor',${lit(actor??'')},true);SET LOCAL ROLE ${role};SELECT public.list_pending_customer_actions(${lit(expected)},${lit(tenant)},${lit(contact)});COMMIT;`).split('\n').find(x=>x.startsWith('{'));
 const result=(...args)=>JSON.parse(query(...args));
 const snapshot=()=>sql('SELECT proof_action_snapshot()');
 check('Owner read preserves legacy reader, customer response writer and original authority byte-for-byte',()=>assert.equal(original(),before));
 check('Ordinary SOLO owner without global staff role reads exact original action and response',()=>{
  assert.equal(sql(`SELECT count(*) FROM user_roles WHERE user_id='${f.other}'`),'0');
  const r=result();assert.equal(r.actor_id,f.other);assert.equal(r.contact_id,f.contact);assert.equal(r.tenant_id,f.tenant);
  assert.equal(r.actions.length,1);assert.equal(r.actions[0].id,f.invite);assert.equal(r.actions[0].responses.length,1);
  assert.equal(r.actions[0].responses[0].response_text,'Which section first?');
 });
 check('Owner projection never includes private payload, login identity, foreign action or mismatched response',()=>{
  const r=result(),s=JSON.stringify(r);for(const denied of ['DO NOT PROJECT','FOREIGN ACTION','FOREIGN RESPONSE',f.actor,g.contact,'responded_by_user_id','payload_json','initiated_by_admin_id'])assert(!s.includes(denied),denied);
  assert.deepEqual(Object.keys(r).sort(),['schema_version','actor_id','tenant_id','contact_id','access_state','joined','shared_context_consent','actions','more_actions'].sort());
  assert.deepEqual(Object.keys(r.actions[0]).sort(),['id','action_type','title','body','status','created_at','updated_at','expires_at','is_expired','responses','more_responses'].sort());
 });
 check('A second eligible SOLO cohort uses the same scoped reader',()=>assert.equal(result(g.other,g.tenant,g.contact).actions[0].id,g.invite));
 for(const [name,actor,tenant,contact,expected,role]of[
  ['wrong current workspace',f.other,g.tenant,g.contact,f.other,'authenticated'],
  ['wrong customer',f.other,f.tenant,g.contact,f.other,'authenticated'],
  ['forged actor',f.other,f.tenant,f.contact,g.other,'authenticated'],
  ['missing expected actor',f.other,f.tenant,f.contact,null,'authenticated'],
  ['customer identity',f.actor,f.tenant,f.contact,f.actor,'authenticated'],
  ['service principal',f.other,f.tenant,f.contact,f.other,'service_role'],
  ['anonymous principal',null,f.tenant,f.contact,null,'anon']
 ])check('Owner read refuses '+name+' without effects',()=>{const prior=snapshot();assert.throws(()=>query(actor,tenant,contact,expected,role));assert.equal(snapshot(),prior);});
 check('Global staff role on a plain tenant member is not owner authority',()=>{
  sql(`INSERT INTO tenant_members(tenant_id,user_id,role,status)VALUES('${f.tenant}','${f.actor}','member','active');UPDATE profiles SET active_tenant_id='${f.tenant}' WHERE user_id='${f.actor}';INSERT INTO user_roles(user_id,role)VALUES('${f.actor}','admin') ON CONFLICT DO NOTHING;`);
  const prior=snapshot();assert.throws(()=>query(f.actor));assert.equal(snapshot(),prior);
 });
 check('Revoked owner membership invalidates a returning read',()=>{sql(`UPDATE tenant_members SET status='inactive' WHERE user_id='${f.other}'`);try{assert.throws(()=>query());}finally{sql(`UPDATE tenant_members SET status='active' WHERE user_id='${f.other}'`);}});
 for(const [field,value]of[['account_type','agency'],['account_type','sub_account'],['status','suspended']])check('Ineligible business '+value+' refuses',()=>{
  sql(`UPDATE tenants SET ${field}='${value}' WHERE id='${f.tenant}'`);try{assert.throws(()=>query());}finally{sql(`UPDATE tenants SET ${field}='${field==='status'?'active':'standalone'}' WHERE id='${f.tenant}'`);}
 });
 check('Paused, ended and nonconsenting relationships retain only shared history without changing consent',()=>{
  for(const state of ['open','paused','ended']){sql(`UPDATE clients SET portal_access_state='${state}' WHERE id='${f.contact}'`);const prior=snapshot(),r=result();assert.equal(r.access_state,state);assert.equal(r.shared_context_consent,false);assert.equal(r.actions[0].id,f.invite);assert.equal(snapshot(),prior);}
 });
 check('Expired pending item is derived truth, not a status write or completed action',()=>{sql(`UPDATE paige_customer_actions SET expires_at=now()-interval '1 day' WHERE id='${f.invite}'`);const prior=snapshot(),r=result();assert.equal(r.actions[0].is_expired,true);assert.equal(r.actions[0].status,'customer_notified');assert.equal(snapshot(),prior);});
 check('Bounded original actions and responses report more without silently implying a complete list',()=>{
  sql(`INSERT INTO paige_customer_actions(tenant_id,contact_id,initiated_by_admin_id,action_type,title)SELECT '${f.tenant}','${f.contact}','${f.other}','task','Bounded fixture '||n FROM generate_series(1,105)n;
  INSERT INTO paige_customer_responses(action_id,contact_id,responded_by_user_id,response_type)SELECT '${f.invite}','${f.contact}','${f.actor}','accepted' FROM generate_series(1,105);
  UPDATE paige_customer_actions SET created_at=now()+interval '1 day' WHERE id='${f.invite}';`);
  const r=result();assert.equal(r.actions.length,100);assert.equal(r.more_actions,true);const item=r.actions.find(x=>x.id===f.invite);assert.equal(item.responses.length,100);assert.equal(item.more_responses,true);
 });
}
