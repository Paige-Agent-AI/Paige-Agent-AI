// One bounded mode of the original isolated E09 PostgreSQL runner. Executes the
// exact incumbent/new native projection. Resolver/brand/table ports below are
// synthetic; real authorization/frame/paused/multiple roles require the original
// full-schema customer_portal_access.sql and relationship-choices CI suites.
export function supportContactProof({sql,check,assert,fs,fixture}) {
 const migration=fs.readFileSync('supabase/migrations/20271116010309_e09_business_support_contact.sql','utf8');
 const source=fs.readFileSync('supabase/migrations/20271106110000_e09_client_presentation_scope.sql','utf8').replaceAll('\r\n','\n');
 const incumbent=source.slice(source.indexOf('CREATE OR REPLACE FUNCTION public.get_client_portal_brand()'),source.indexOf('CREATE OR REPLACE FUNCTION public.get_client_portal_config()'));
 sql(`ALTER TABLE public.tenants ADD COLUMN brand jsonb DEFAULT '{}',ADD COLUMN name text,ADD COLUMN slug text;
 CREATE TABLE public.tenant_legal_profile(tenant_id uuid PRIMARY KEY,brand_logo_url text,support_email text);
 CREATE TABLE public.tenant_email_identities(tenant_id uuid PRIMARY KEY,local_part text,kind text,status text);
 CREATE TABLE public.platform_email_settings(id boolean PRIMARY KEY,shared_domain text);
 CREATE TABLE public.channel_connectors(tenant_id uuid,channel_type text,active boolean,inbound_address text);
 INSERT INTO public.platform_email_settings VALUES(true,'business-mail.example');
 CREATE FUNCTION public.client_portal_relationship_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT id FROM public.clients WHERE linked_user_id=auth.uid() AND status='active' LIMIT 1 $$;
 CREATE FUNCTION public.resolve_tenant_brand(uuid) RETURNS TABLE(tenant_id uuid,tenant_name text,tenant_slug text,logo_url text,primary_color text,logo_dark_url text,favicon_url text,accent_color text,font text,tagline text,product_name text,from_name text,support_email text)
 LANGUAGE sql STABLE AS $$ SELECT $1,'Northwind Studio'::text,'northwind'::text,NULL::text,'#170F35'::text,NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,'Northwind Studio'::text,'Northwind Studio'::text,'support@paigeagent.ai'::text $$;`);
 sql(incumbent);
 const f=fixture();sql(`UPDATE clients SET linked_user_id='${f.actor}' WHERE id='${f.contact}';`);
 const read=()=>JSON.parse(sql(`BEGIN;SELECT set_config('test.actor','${f.actor}',true);SET LOCAL ROLE authenticated;SELECT to_jsonb(b) FROM public.get_client_portal_brand() b;COMMIT;`).split(/\r?\n/).find(l=>l.startsWith('{')));
 const metadata=()=>sql(`SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'security',prosecdef,'volatility',provolatile,'argtypes',proallargtypes,'argnames',proargnames,'argmodes',proargmodes)::text FROM pg_proc WHERE oid='public.get_client_portal_brand()'::regprocedure`);
 const before=metadata(),original=sql("SELECT pg_get_functiondef('public.get_client_portal_brand()'::regprocedure)");
 check('Native incumbent matches actual production fingerprint',()=>assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_client_portal_brand()'::regprocedure"),'76db8ac4261c65f20a6465d0fc42fdab'));
 const old=read();
 check('Actual old projection reproduces platform-support fallback',()=>assert.equal(old.support_email,'support@paigeagent.ai'));
 sql(migration);
 const installed=sql("SELECT pg_get_functiondef('public.get_client_portal_brand()'::regprocedure)");
 check('Projection preserves original OID, ABI, ACL, owner, volatility and security configuration',()=>assert.equal(metadata(),before));
 check('All original noncontact brand fields stay exact',()=>{const next=read();delete old.support_email;delete next.support_email;assert.deepEqual(next,old);});
 check('No-source business does not inherit platform support',()=>assert.equal(read().support_email,null));
 sql(`INSERT INTO tenant_legal_profile VALUES('${f.tenant}',NULL,'public@northwind.example');`);
 check('Published original business support fallback',()=>assert.equal(read().support_email,'public@northwind.example'));
 sql(`UPDATE tenants SET brand='{"support_email":"care@northwind.example"}' WHERE id='${f.tenant}';`);
 check('Explicit original business contact takes precedence',()=>assert.equal(read().support_email,'care@northwind.example'));
 for(const value of ['privacy@paigeagent.ai','support@mail.paigeagent.ai','bad','a..b@northwind.example','a@example.com?bcc=other@example.com','care@northwind.example\r\nBcc:other@example.com']) {
  sql(`UPDATE tenants SET brand=jsonb_build_object('support_email','${value.replaceAll("'","''")}') WHERE id='${f.tenant}';`);
  check('Unsafe/platform input falls through: '+JSON.stringify(value),()=>assert.equal(read().support_email,'public@northwind.example'));
 }
 sql(`UPDATE tenants SET brand='{}' WHERE id='${f.tenant}';UPDATE tenant_legal_profile SET support_email=NULL;
 INSERT INTO tenant_email_identities VALUES('${f.tenant}','northwind','shared','active');`);
 check('Sending registration is not receiving readiness',()=>assert.equal(read().support_email,null));
 sql(`INSERT INTO channel_connectors VALUES('${f.tenant}','email',true,'northwind@business-mail.example');`);
 check('Actual original active exact inbound route enables managed contact',()=>assert.equal(read().support_email,'northwind@business-mail.example'));
 sql('UPDATE channel_connectors SET active=false');
 check('Disabled route is withheld',()=>assert.equal(read().support_email,null));
 sql(`UPDATE channel_connectors SET active=true;INSERT INTO channel_connectors VALUES('${f.foreign}','email',true,'northwind@business-mail.example');`);
 check('Ambiguous foreign inbound route is withheld',()=>assert.equal(read().support_email,null));
 sql(`DELETE FROM channel_connectors WHERE tenant_id='${f.foreign}';UPDATE tenant_email_identities SET status='disabled';`);
 check('Disabled sending identity is withheld',()=>assert.equal(read().support_email,null));
 check('Exact migration replay preserves definition and metadata',()=>{sql(migration);assert.equal(sql("SELECT pg_get_functiondef('public.get_client_portal_brand()'::regprocedure)"),installed);assert.equal(metadata(),before);});
 const drift=original.replace("c.id = public.client_portal_relationship_id()","true");
 sql(drift);
 check('Unknown authorization-source drift refuses without overwriting',()=>{assert.throws(()=>sql(migration));assert.equal(sql("SELECT pg_get_functiondef('public.get_client_portal_brand()'::regprocedure)"),drift);assert.equal(metadata(),before);});
 sql(original);sql(migration);
 check('Native read does not provision any mailbox or route',()=>assert.equal(sql('SELECT (SELECT count(*) FROM tenant_email_identities)::text||\':\'||(SELECT count(*) FROM channel_connectors)::text'),'1:1'));
}
