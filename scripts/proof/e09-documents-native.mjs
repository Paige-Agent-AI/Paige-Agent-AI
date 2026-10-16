// Extends the incumbent E09 loopback runner. Local Auth/role/Storage metadata
// transports are explicit stand-ins; actual migration and Rail body execute.
// The same cases also run under pgTAP against the full replayed schema in CI.
export function documentProof({sql,check,assert,fs,root,path}) {
 const source=fs.readFileSync(path.join(root,'supabase/migrations/20260630024905_2f3328c2-0b7a-47a1-bb25-cf77a9980e40.sql'),'utf8').replaceAll('\r\n','\n');
 const table=source.match(/CREATE TABLE public\.client_files \([\s\S]*?\n\);/)?.[0];assert(table);
 sql(`DROP TABLE client_files;
 CREATE TYPE client_file_visibility AS ENUM('internal','shared','client_upload');
 CREATE TYPE app_role AS ENUM('admin','user');
 ALTER TABLE auth.users ADD aud text,ADD role text,ADD raw_app_meta_data jsonb;
 ALTER TABLE clients ADD entity_name text,ADD merged_at timestamptz;
 -- Match the hosted service fixture role for lineage setup, never the customer.
 ALTER ROLE service_role BYPASSRLS;
 GRANT SELECT,UPDATE ON clients TO service_role;
 ${table}
 ALTER TABLE client_files ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON client_files TO authenticated;
 CREATE POLICY "Clients upload own" ON client_files FOR INSERT TO authenticated WITH CHECK(false);
 CREATE POLICY "Clients read own shared/uploads" ON client_files FOR SELECT TO authenticated
 USING(visibility IN ('shared','client_upload') AND contact_id=client_portal_relationship_id(tenant_id));
 CREATE POLICY proof_uploader_update ON client_files FOR UPDATE TO authenticated USING(uploaded_by_user_id=auth.uid());
 CREATE POLICY proof_uploader_delete ON client_files FOR DELETE TO authenticated USING(uploaded_by_user_id=auth.uid());
 CREATE FUNCTION has_role(uuid,app_role) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=$1 AND role=$2::text)$$;
 CREATE FUNCTION has_any_role(uuid,text[]) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=$1 AND role=ANY($2))$$;
 CREATE FUNCTION is_tenant_admin(uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM tenant_members WHERE user_id=auth.uid() AND tenant_id=$1 AND status='active' AND role IN ('owner','admin'))$$;
 CREATE POLICY proof_staff_file_read ON client_files FOR SELECT TO authenticated
 USING(tenant_id=current_user_tenant_id() AND is_tenant_admin(tenant_id));
 CREATE POLICY proof_staff_file_insert ON client_files FOR INSERT TO authenticated
 WITH CHECK(uploaded_by_user_id=auth.uid() AND tenant_id=current_user_tenant_id() AND is_tenant_admin(tenant_id)
 AND EXISTS(SELECT 1 FROM clients c WHERE c.id=client_files.contact_id AND c.tenant_id=client_files.tenant_id));
 CREATE SCHEMA storage;GRANT USAGE ON SCHEMA storage TO authenticated,anon,service_role;
 CREATE PUBLICATION supabase_realtime;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,UNIQUE(bucket_id,name));
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
 -- Negative control: an unrelated permissive arm must not widen this bucket.
 CREATE POLICY proof_unrelated_wide_storage ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
 CREATE TABLE paige_event_kinds(slug text PRIMARY KEY,tenant_id uuid,label text,description text,default_audience text,default_visibility text,department text,enabled boolean);
 ALTER TABLE paige_client_events ADD id uuid DEFAULT gen_random_uuid(),ADD event_kind text,ADD surface text,ADD actor_type text,ADD actor_user_id uuid,
 ADD from_department text,ADD to_department text,ADD title text,ADD summary text,ADD payload jsonb,ADD ref_table text,ADD ref_id uuid,
 ADD occurred_at timestamptz,ADD actor_agent_slug text,ADD actor_agent_label text;
 ALTER TABLE paige_client_events ENABLE ROW LEVEL SECURITY;GRANT SELECT ON paige_client_events TO authenticated;
 CREATE POLICY proof_staff_rail_read ON paige_client_events FOR SELECT TO authenticated
 USING(tenant_id=current_user_tenant_id() AND is_tenant_admin(tenant_id));
 CREATE TABLE paige_subagents(slug text,tenant_id uuid,rail_display_name text);
 CREATE FUNCTION proof_document_profile() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO profiles(user_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;RETURN NEW;END$$;
 CREATE TRIGGER proof_document_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION proof_document_profile();
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('e0900000-0000-0000-0000-000000999999','document-owner@tests.invalid',now());
 INSERT INTO tenants(id,owner_user_id,status) SELECT v.id,'e0900000-0000-0000-0000-000000999999'::uuid,'active' FROM
 (VALUES('e0901000-0000-0000-0000-000000000001'::uuid),('e0901000-0000-0000-0000-000000000002'::uuid))v(id);
 INSERT INTO user_roles(user_id,role) VALUES('e0900000-0000-0000-0000-000000999999','admin');
 INSERT INTO tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES('e0901000-0000-0000-0000-000000000001','e0900000-0000-0000-0000-000000999999','owner','active',true,now());
 UPDATE profiles SET active_tenant_id='e0901000-0000-0000-0000-000000000001' WHERE user_id='e0900000-0000-0000-0000-000000999999';
 CREATE OR REPLACE FUNCTION current_user_tenant_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$SELECT active_tenant_id FROM profiles WHERE user_id=auth.uid()$$;`);
 const rail=fs.readFileSync(path.join(root,'supabase/migrations/20261201000800_the_rail_says_which_agent_acted.sql'),'utf8').replaceAll('\r\n','\n')
  .match(/CREATE OR REPLACE FUNCTION public\.record_rail_event\([\s\S]*?END \$\$;/)?.[0];assert(rail);sql(rail);
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20271108150000_e09_customer_documents.sql'),'utf8');
 check('Document migration preserves the incumbent Rail body except its exact client scope branch',()=>{
  const before=sql("SELECT pg_get_functiondef('record_rail_event(uuid,text,text,text,text,text,jsonb,text,uuid,text,text,timestamptz,boolean,uuid,text)'::regprocedure)").replaceAll('\r\n','\n');
  sql(migration);
  const after=sql("SELECT pg_get_functiondef('record_rail_event(uuid,text,text,text,text,text,jsonb,text,uuid,text,text,timestamptz,boolean,uuid,text)'::regprocedure)").replaceAll('\r\n','\n');
  const old=migration.match(/_old text:=\$old\$([\s\S]*?)\$old\$/)?.[1]?.replaceAll('\r\n','\n'),next=migration.match(/_new text:=\$new\$([\s\S]*?)\$new\$/)?.[1]?.replaceAll('\r\n','\n');
  assert(old&&next);assert.equal(before.replace(old,next),after);
  sql(migration);assert.equal(sql("SELECT pg_get_functiondef('record_rail_event(uuid,text,text,text,text,text,jsonb,text,uuid,text,text,timestamptz,boolean,uuid,text)'::regprocedure)").replaceAll('\r\n','\n'),after);
 });
 const tests=fs.readFileSync(path.join(root,'supabase/tests/consumer_invite_acceptance.sql'),'utf8').replaceAll('\r\n','\n').split('-- E09_DOCUMENTS_BEGIN:')[1]?.split('-- E09_DOCUMENTS_END')[0];assert(tests);
 // The comment after the marker is retained. Declarations/three bucket-ACL
 // assertions are identical to the full-schema suite; case calls are bounded.
 check('Actual document SQL lifecycle cases, isolation and recovery',()=>{
  const output=sql(`CREATE FUNCTION pg_temp.ok(boolean,text) RETURNS text LANGUAGE plpgsql AS $$BEGIN IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',$2;END IF;RETURN $2;END$$;
   CREATE FUNCTION pg_temp.is(anyelement,anyelement,text) RETURNS text LANGUAGE plpgsql AS $$BEGIN IF $1 IS DISTINCT FROM $2 THEN RAISE EXCEPTION 'FAIL: % (actual %, expected %)',$3,$1,$2;END IF;RETURN $3;END$$;
   SET search_path=pg_temp,public;
   CREATE TEMP TABLE e09_history_fixture AS SELECT 'e0900000-0000-0000-0000-000000999999'::uuid AS owner_id;
   -- E09_DOCUMENTS_BEGIN:${tests.replace(/\bis\(/g,'pg_temp.is(').replace(/\bok\(/g,'pg_temp.ok(')}`);
  assert(output.includes('failed audit rolls back file and canonical Rail: no file/audit/Rail effects'),'All lifecycle cases must execute');
 });
}
