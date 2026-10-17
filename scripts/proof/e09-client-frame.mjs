// Extend the incumbent isolated native PostgreSQL proof. Existing identity,
// presentation and brand cascade bodies execute unchanged; no second QA engine.
import {createHash} from 'node:crypto';
export function frameProof({sql,check,assert,fs,root,path,uid,other,tenant,foreign,contact,otherContact,presentationMigration,unsafeFrame}) {
  let source=fs.readFileSync(path.join(root,'supabase/migrations/20271108190000_e09_customer_frame_projection.sql'),'utf8');
  const migrationSHA256=createHash('sha256').update(source).digest('hex');
  if(unsafeFrame){const guard="WHERE b.tenant_id = (_profile->>'tenant_id')::uuid";assert(source.includes(guard));source=source.replace(guard,'');}
  sql(source);
  const call=(actor=uid,role='authenticated')=>{
    const output=sql(`BEGIN;SELECT set_config('test.actor','${actor??''}',true);SET LOCAL ROLE ${role};SELECT public.client_portal_frame();COMMIT;`);
    const json=output.split('\n').find(line=>line.startsWith('{'));return json?JSON.parse(json):null;
  };
  check('Frame migration is replayable and read-only, with a fixed search path',()=>{
    const before=sql("SELECT pg_get_functiondef('client_portal_frame()'::regprocedure)");sql(source);
    assert.equal(sql("SELECT pg_get_functiondef('client_portal_frame()'::regprocedure)"),before);
    assert.equal(sql("SELECT provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']::text[] FROM pg_proc WHERE oid='client_portal_frame()'::regprocedure"),'t');
  });
  check('Frame permits authenticated execution, refuses anon and service-role execution',()=>{
    assert.equal(sql("SELECT has_function_privilege('authenticated','client_portal_frame()','EXECUTE') AND NOT has_function_privilege('anon','client_portal_frame()','EXECUTE') AND NOT has_function_privilege('service_role','client_portal_frame()','EXECUTE')"),'t');
    assert.throws(()=>call(null,'anon'));assert.throws(()=>call(uid,'service_role'));assert.throws(()=>call(null));
  });
  check('Frame reads the own profile and same business presentation without raw CRM SELECT',()=>{
    const frame=call();assert.deepEqual(Object.keys(frame).sort(),['actor_id','profile','brand','config'].sort());
    assert.equal(frame.actor_id,uid);assert.equal(frame.profile.linked_user_id,uid);assert.equal(frame.profile.id,contact);
    assert.equal(frame.brand.tenant_id,tenant);assert.equal(frame.profile.tenant_id,tenant);assert.equal(frame.config.welcome.headline,'Saved greeting A');
    assert.deepEqual(Object.keys(frame.brand).sort(),['tenant_id','tenant_name','tenant_slug','logo_url','primary_color','support_email'].sort());
    assert.equal(sql("SELECT has_table_privilege('authenticated','clients','SELECT')"),'f');
    assert(!JSON.stringify(frame).includes('INTERNAL'));assert(!JSON.stringify(frame).includes('FOREIGN'));assert(!JSON.stringify(frame).includes('poison'));
  });
  check('Frame follows the actual second subject rather than borrowing the first business',()=>{
    const frame=call(other);assert.equal(frame.actor_id,other);assert.equal(frame.profile.id,otherContact);
    assert.equal(frame.brand.tenant_id,foreign);assert.equal(frame.config.welcome.headline,'Foreign greeting B');assert(!JSON.stringify(frame).includes('Saved greeting A'));
  });
  check('Unlinked authenticated subject receives no customer frame',()=>assert.equal(call('e0911000-0000-0000-0000-000000000099'),null));
  for(const [name,setup,restore] of [
    ['Revoked link',`UPDATE clients SET linked_user_id=NULL WHERE id='${contact}'`,`UPDATE clients SET linked_user_id='${uid}' WHERE id='${contact}'`],
    ['Archived relationship',`UPDATE clients SET status='archived' WHERE id='${contact}'`,`UPDATE clients SET status='active' WHERE id='${contact}'`],
    ['Merged relationship',`UPDATE clients SET merged_into_contact_id='${otherContact}' WHERE id='${contact}'`,`UPDATE clients SET merged_into_contact_id=NULL WHERE id='${contact}'`],
    ['Inactive business',`UPDATE tenants SET status='suspended' WHERE id='${tenant}'`,`UPDATE tenants SET status='active' WHERE id='${tenant}'`],
  ])check(`${name} cannot publish a frame`,()=>{sql(setup);try{assert.equal(call(),null);}finally{sql(restore);}});
  check('Frame cannot select the first of ambiguous future business relationships',()=>{
    sql(`DROP INDEX clients_linked_user_id_unique;UPDATE clients SET linked_user_id='${uid}' WHERE id='${otherContact}';`);
    try{assert.throws(()=>call());}finally{sql(`UPDATE clients SET linked_user_id='${other}' WHERE id='${otherContact}';CREATE UNIQUE INDEX clients_linked_user_id_unique ON clients(linked_user_id) WHERE linked_user_id IS NOT NULL;`);}
  });
  check('A mismatched native brand cannot be composed with an authorized customer',()=>{
    const old=sql("SELECT pg_get_functiondef('get_client_portal_brand()'::regprocedure)");
    // A deliberate isolated negative control substitutes ONLY the brand scope;
    // the production frame and native own-profile definitions stay unchanged.
    assert(old.includes('rb.tenant_id, rb.tenant_name, rb.tenant_slug'));
    sql(old.replace('rb.tenant_id, rb.tenant_name, rb.tenant_slug',`'${foreign}'::uuid, rb.tenant_name, rb.tenant_slug`));
    try{assert.throws(()=>call());}finally{sql(presentationMigration);}
  });
  check('Frame reload uses saved profile/config and creates no durable effects',()=>{
    sql(`UPDATE clients SET first_name='Returned customer' WHERE id='${contact}';UPDATE tenants SET features=jsonb_set(features,'{portal_config,welcome,headline}','"Returned greeting"'::jsonb) WHERE id='${tenant}';`);
    const snapshot=()=>sql("SELECT jsonb_build_object('clients',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM clients c),'tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tenants t),'methods',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM client_contact_methods m),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM paige_audit_log a))");
    const before=snapshot(),frame=call();assert.equal(frame.profile.first_name,'Returned customer');assert.equal(frame.config.welcome.headline,'Returned greeting');assert.equal(snapshot(),before);
  });
  return {frameMigration:'20271108190000_e09_customer_frame_projection.sql',frameMigrationSHA256:migrationSHA256,unsafeFrameControl:unsafeFrame};
}
