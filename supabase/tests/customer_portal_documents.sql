-- E09 Documents: full replayed schema, actual caller roles, synthetic data; all rolled back.
-- Proves: client_files.shared_at/shared_by are derived by a trigger on every writer (and cannot be
-- forged); the owner's upload pair (reserve -> PUT -> finish) is bound to the current-workspace
-- business admin, never a top-level agency, with an exact server path, an object check, idempotent
-- replay and one audit row; the one share writer is version-guarded, state-idempotent and audited
-- once per real change; the owner's list pins tenant and contact; the customer reads, through an
-- exact allowlist, only files the business shared (ready) plus their own uploads, and storage
-- authorizes exactly those objects for a signed URL; the deployed customer upload pipeline still
-- works; a customer can no longer delete their own upload metadata; a staff PUT needs a
-- reservation; and released work is unavailable once the client or the business is inactive.
BEGIN;
SELECT plan(197);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0941000-0000-4000-8000-000000000001','authenticated','authenticated','documents-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0941000-0000-4000-8000-000000000002','authenticated','authenticated','documents-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0941000-0000-4000-8000-000000000003','authenticated','authenticated','jordan.rivera@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0941000-0000-4000-8000-000000000004','authenticated','authenticated','sam.okafor@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0941000-0000-4000-8000-000000000005','authenticated','authenticated','documents-staff-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0941000-0000-4000-8000-000000000006','authenticated','authenticated','documents-agency@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0941000-0000-4000-8000-000000000007','authenticated','authenticated','documents-sub-account@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0941000-0000-4000-8000-000000000008','authenticated','authenticated','documents-customer-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0941000-0000-4000-8000-000000000009','authenticated','authenticated','documents-two-businesses@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0941000-0000-4000-8000-000000000010','authenticated','authenticated','documents-platform@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0942000-0000-4000-8000-000000000001','test-tenant-e09-documents-a','Northwind Studio','active','standalone',NULL,'E09DA',9491001,'{}'),
 ('e0942000-0000-4000-8000-000000000002','test-tenant-e09-documents-b','Test tenant documents B','active','standalone',NULL,'E09DB',9491002,'{}'),
 ('e0942000-0000-4000-8000-000000000003','test-tenant-e09-documents-agency','Test agency documents','active','agency',NULL,'E09DG',9491003,'{}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0942000-0000-4000-8000-000000000004','test-tenant-e09-documents-sub','Test sub-account documents','active','sub_account','e0942000-0000-4000-8000-000000000003','E09DS',9491004,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0942000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0942000-0000-4000-8000-000000000002','e0941000-0000-4000-8000-000000000002','owner','active',true,now()),
 ('e0942000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000005','member','active',false,now()),
 -- Owner B is also a plain member of A (an assigned coach there) whose current workspace is B.
 ('e0942000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000002','member','active',false,now()),
 ('e0942000-0000-4000-8000-000000000003','e0941000-0000-4000-8000-000000000006','owner','active',true,now()),
 ('e0942000-0000-4000-8000-000000000004','e0941000-0000-4000-8000-000000000007','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e0942000-0000-4000-8000-000000000001'
 WHERE user_id IN('e0941000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000005');
UPDATE public.profiles SET active_tenant_id='e0942000-0000-4000-8000-000000000002' WHERE user_id='e0941000-0000-4000-8000-000000000002';
UPDATE public.profiles SET active_tenant_id='e0942000-0000-4000-8000-000000000003' WHERE user_id='e0941000-0000-4000-8000-000000000006';
UPDATE public.profiles SET active_tenant_id='e0942000-0000-4000-8000-000000000004' WHERE user_id='e0941000-0000-4000-8000-000000000007';
-- Every business owner holds the GLOBAL admin app role, as in production; so does the plain member
-- of business A (the §59 trap): authority must come from this tenant's membership, never that role.
INSERT INTO public.user_roles(user_id,role) VALUES
 ('e0941000-0000-4000-8000-000000000001','admin'),('e0941000-0000-4000-8000-000000000002','admin'),
 ('e0941000-0000-4000-8000-000000000005','admin'),('e0941000-0000-4000-8000-000000000006','admin'),
 ('e0941000-0000-4000-8000-000000000007','admin'),('e0941000-0000-4000-8000-000000000010','super_admin')
ON CONFLICT DO NOTHING;
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,assigned_coach_user_id,first_name,last_name,status) VALUES
 ('e0943000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000003','e0941000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000002','Jordan','Rivera','active'),
 ('e0943000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000004','e0941000-0000-4000-8000-000000000001',NULL,'Sam','Okafor','active'),
 ('e0943000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001',NULL,'e0941000-0000-4000-8000-000000000001',NULL,'Unconnected','Contact','active'),
 ('e0943000-0000-4000-8000-000000000004','e0942000-0000-4000-8000-000000000001',NULL,'e0941000-0000-4000-8000-000000000001',NULL,'Merged','Away','active'),
 ('e0943000-0000-4000-8000-000000000005','e0942000-0000-4000-8000-000000000002','e0941000-0000-4000-8000-000000000008','e0941000-0000-4000-8000-000000000002',NULL,'Foreign','Customer','active'),
 ('e0943000-0000-4000-8000-000000000006','e0942000-0000-4000-8000-000000000004',NULL,'e0941000-0000-4000-8000-000000000007',NULL,'Sub','Client','active'),
 ('e0943000-0000-4000-8000-000000000007','e0942000-0000-4000-8000-000000000003',NULL,'e0941000-0000-4000-8000-000000000006',NULL,'Agency','Client','active');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('app.crm_merge_lineage_write','on',true);
UPDATE public.clients SET merged_into_contact_id='e0943000-0000-4000-8000-000000000003',merged_at=now() WHERE id='e0943000-0000-4000-8000-000000000004';
SELECT set_config('app.crm_merge_lineage_write','off',true);
SELECT set_config('request.jwt.claims','{}',true);

-- Jordan's view: what he may see (J2, J10 shared and ready; J4, J5 his own uploads) and what he
-- must never see. Inserted directly, so the touch trigger does not run and each version is known.
INSERT INTO public.client_files(id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state,description,created_at,updated_at) VALUES
 ('e0944000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000001','PRIVATE TEAM PLAN.pdf','application/pdf',10,'internal','ready',NULL,now()-interval '4 days','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000002','Welcome pack.pdf','application/pdf',11,'shared','ready','PRIVATE DESCRIPTION NOTE',now()-interval '3 days','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000003','PENDING OWNER FILE.pdf','application/pdf',12,'shared','pending',NULL,now()-interval '1 hour','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000004','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/client_upload/e0941000-0000-4000-8000-000000000003/e0944000-0000-4000-8000-000000000004','Signed brief.png','image/png',13,'client_upload','ready',NULL,now()-interval '2 days','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000005','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/client_upload/e0941000-0000-4000-8000-000000000003/e0944000-0000-4000-8000-000000000005','Unfinished upload.pdf','application/pdf',14,'client_upload','pending',NULL,now()-interval '1 day','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000006','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000002/internal/e0944000-0000-4000-8000-000000000006','SAMS SHARED FILE.pdf','application/pdf',15,'shared','ready',NULL,now()-interval '1 day','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000007','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0941000-0000-4000-8000-000000000004','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000002/client_upload/e0941000-0000-4000-8000-000000000004/e0944000-0000-4000-8000-000000000007','SAMS UPLOAD.pdf','application/pdf',16,'client_upload','ready',NULL,now()-interval '1 day','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000008','e0942000-0000-4000-8000-000000000002','e0943000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000002/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000008','FOREIGN TENANT FILE.pdf','application/pdf',17,'shared','ready',NULL,now()-interval '1 day','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000009','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000004','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/client_upload/e0941000-0000-4000-8000-000000000004/e0944000-0000-4000-8000-000000000009','ANOTHER LOGINS UPLOAD.pdf','application/pdf',18,'client_upload','ready',NULL,now()-interval '1 day','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000010','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000010','Older guide.pdf','application/pdf',19,'shared','ready',NULL,now()-interval '5 days','2027-01-01T00:00:00Z');
-- Owner-writer files. Version 2027-01-01T00:00:00Z.
INSERT INTO public.client_files(id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state,updated_at) VALUES
 ('e0944000-0000-4000-8000-000000000021','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000002/internal/e0944000-0000-4000-8000-000000000021','Proposal.pdf','application/pdf',21,'internal','ready','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000022','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0941000-0000-4000-8000-000000000004','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000002/client_upload/e0941000-0000-4000-8000-000000000004/e0944000-0000-4000-8000-000000000022','Sams own file.pdf','application/pdf',22,'client_upload','ready','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000023','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000002/internal/e0944000-0000-4000-8000-000000000023','Not finished.pdf','application/pdf',23,'internal','pending','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000024','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000004','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000004/internal/e0944000-0000-4000-8000-000000000024','Merged client file.pdf','application/pdf',24,'internal','ready','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000025','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000003','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000003/internal/e0944000-0000-4000-8000-000000000025','Unconnected client file.pdf','application/pdf',25,'internal','ready','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000026','e0942000-0000-4000-8000-000000000002','e0943000-0000-4000-8000-000000000005','e0941000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000002/e0943000-0000-4000-8000-000000000005/internal/e0944000-0000-4000-8000-000000000026','Tenant B file.pdf','application/pdf',26,'internal','ready','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000027','e0942000-0000-4000-8000-000000000004','e0943000-0000-4000-8000-000000000006','e0941000-0000-4000-8000-000000000007','e0942000-0000-4000-8000-000000000004/e0943000-0000-4000-8000-000000000006/internal/e0944000-0000-4000-8000-000000000027','Sub-account file.pdf','application/pdf',27,'internal','ready','2027-01-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000028','e0942000-0000-4000-8000-000000000003','e0943000-0000-4000-8000-000000000007','e0941000-0000-4000-8000-000000000006','e0942000-0000-4000-8000-000000000003/e0943000-0000-4000-8000-000000000007/internal/e0944000-0000-4000-8000-000000000028','Agency file.pdf','application/pdf',28,'internal','ready','2027-01-01T00:00:00Z');
-- Objects behind Jordan's internal file, his shared file and his own upload (fixture role).
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES
 ('client-files','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000001','{"size":10,"mimetype":"application/pdf"}'),
 ('client-files','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000002','e0941000-0000-4000-8000-000000000001','{"size":11,"mimetype":"application/pdf"}'),
 ('client-files','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/client_upload/e0941000-0000-4000-8000-000000000003/e0944000-0000-4000-8000-000000000004','e0941000-0000-4000-8000-000000000003','{"size":13,"mimetype":"image/png"}');

CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon;
 ELSIF _role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.owner(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e0941000-0000-4000-8000-000000000001', _sql) $$;
CREATE FUNCTION pg_temp.jordan(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e0941000-0000-4000-8000-000000000003', _sql) $$;
CREATE FUNCTION pg_temp.share(_actor uuid, _tenant uuid, _file text, _shared boolean, _version timestamptz) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(_actor, format('SELECT public.client_file_set_client_share(%L,%L,%L,%L,%L)', _actor, _tenant, _file, _shared, _version)) $$;
CREATE FUNCTION pg_temp.a_share(_file text, _shared boolean, _version timestamptz DEFAULT '2027-01-01T00:00:00Z') RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.share('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001',_file,_shared,_version) $$;
CREATE FUNCTION pg_temp.begin_as(_actor uuid, _tenant uuid, _contact text, _file text, _name text DEFAULT 'Plan.pdf', _mime text DEFAULT 'application/pdf', _size bigint DEFAULT 4) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(_actor, format('SELECT public.client_file_owner_begin_upload(%L,%L,%L,%L,%L,%L,%L)', _actor, _tenant, _contact, _file, _name, _mime, _size)) $$;
CREATE FUNCTION pg_temp.finish_as(_actor uuid, _tenant uuid, _file text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(_actor, format('SELECT public.client_file_owner_finish_upload(%L,%L,%L)', _actor, _tenant, _file)) $$;
CREATE FUNCTION pg_temp.list_as(_actor uuid, _tenant uuid, _contact text, _limit int DEFAULT 100) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(_actor, format('SELECT public.client_file_owner_list(%L,%L,%L,%L)', _actor, _tenant, _contact, _limit)) $$;
CREATE FUNCTION pg_temp.put_as(_actor uuid, _path text, _size int DEFAULT 4, _mime text DEFAULT 'application/pdf') RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(_actor, format($q$WITH i AS (INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES ('client-files',%L,%L,%L) RETURNING 1) SELECT to_jsonb(count(*)) FROM i$q$,
    _path, _actor, jsonb_build_object('size',_size,'mimetype',_mime))) $$;
CREATE FUNCTION pg_temp.sees_object(_actor uuid, _path text) RETURNS bigint LANGUAGE sql AS
 $$ SELECT (pg_temp.as_user(_actor, format($q$SELECT to_jsonb(count(*)) FROM storage.objects WHERE bucket_id='client-files' AND name=%L$q$, _path)))::text::bigint $$;
CREATE FUNCTION pg_temp.file(_r jsonb, _id text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT e FROM jsonb_array_elements(_r->'files') e WHERE e->>'id' = _id $$;
CREATE FUNCTION pg_temp.ids(_r jsonb) RETURNS text LANGUAGE sql AS
 $$ SELECT string_agg(right(e->>'id',2), ',' ORDER BY o) FROM jsonb_array_elements(_r->'files') WITH ORDINALITY x(e,o) $$;
CREATE FUNCTION pg_temp.owner_page(_contact text, _limit int, _before timestamptz, _before_id text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e0941000-0000-4000-8000-000000000001', format('SELECT public.client_file_owner_list(%L,%L,%L,%L,%L,%L)',
    'e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001',_contact,_limit,_before,_before_id)) $$;
CREATE FUNCTION pg_temp.jordan_page(_limit int, _before timestamptz, _before_id text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.jordan(format('SELECT public.client_portal_documents(p_limit=>%L,p_before=>%L,p_before_id=>%L)',_limit,_before,_before_id)) $$;
CREATE FUNCTION pg_temp.at(_file text) RETURNS timestamptz LANGUAGE sql AS
 $$ SELECT created_at FROM public.client_files WHERE id=_file::uuid $$;
CREATE FUNCTION pg_temp.page(_r jsonb) RETURNS text LANGUAGE sql AS
 $$ SELECT coalesce(pg_temp.ids(_r),'')||'|'||(_r->>'has_more') $$;
CREATE FUNCTION pg_temp.keys(_o jsonb) RETURNS text LANGUAGE sql AS
 $$ SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(_o) k $$;
CREATE FUNCTION pg_temp.audits(_file text, _like text DEFAULT 'client_%') RETURNS bigint LANGUAGE sql AS
 $$ SELECT count(*) FROM public.audit_logs WHERE entity='client_files' AND entity_id=_file::uuid AND action LIKE _like $$;
CREATE FUNCTION pg_temp.fpath(_tenant text, _contact text, _file text) RETURNS text LANGUAGE sql AS
 $$ SELECT 'e0942000-0000-4000-8000-0000000000'||_tenant||'/e0943000-0000-4000-8000-0000000000'||_contact||'/internal/'||_file $$;

-- 1. Schema: shared_at/shared_by exist and are derived on every writer.
SELECT has_column('public','client_files','shared_at','client_files carries shared_at');
SELECT has_column('public','client_files','shared_by','client_files carries shared_by');
SELECT ok((SELECT shared_at IS NOT NULL FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000002'),'an INSERT as shared stamps shared_at');
SELECT ok((SELECT shared_at IS NULL AND shared_by IS NULL FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000001'),'an internal row carries no share stamp');
INSERT INTO public.client_files(id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state,shared_at,shared_by) VALUES
 ('e0944000-0000-4000-8000-000000000031','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000003','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000003/internal/e0944000-0000-4000-8000-000000000031','Trigger probe.pdf','application/pdf',31,'internal','ready','1999-01-01T00:00:00Z','e0941000-0000-4000-8000-000000000005');
SELECT ok((SELECT shared_at IS NULL AND shared_by IS NULL FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000031'),'an internal INSERT cannot carry a forged share stamp');
-- The share writer is the ONLY non-service writer that moves a file into or out of 'shared'
-- (round 2, verifier MAJOR-1). A direct REST write is refused by the trigger itself (its own error,
-- not an RLS miss) for the owner, for a member of this business who holds the global admin role,
-- and for an insert; the service role is the one exempt writer and is stamped like any other.
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET visibility='shared' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_SHARE_WRITER_REQUIRED','the owner cannot share a file by a direct REST update');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000005',$q$UPDATE public.client_files SET visibility='shared' WHERE id='e0944000-0000-4000-8000-000000000021' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_SHARE_WRITER_REQUIRED','a member holding the global admin role cannot share one over REST either');
SELECT is(pg_temp.owner($q$INSERT INTO public.client_files(tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state) VALUES ('e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000002/internal/e0944000-0000-4000-8000-000000000032','Direct.pdf','application/pdf',1,'shared','ready') RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_SHARE_WRITER_REQUIRED','or insert a file that is already shared');
SELECT ok((SELECT bool_and(visibility='internal') FROM public.client_files WHERE id IN ('e0944000-0000-4000-8000-000000000021','e0944000-0000-4000-8000-000000000031'))
  AND NOT EXISTS (SELECT 1 FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000032'),'no refused REST write shared anything');
SELECT ok(pg_temp.file(pg_temp.as_user('e0941000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_documents()$q$),'e0944000-0000-4000-8000-000000000021') IS NULL,'so Sam never sees the file the member tried to share');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000001',$q$UPDATE public.client_files SET visibility='shared' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(shared_by)$q$,'service_role'),
 '"e0941000-0000-4000-8000-000000000001"'::jsonb,'the service role may share directly, and the stamp records who');
SELECT ok((SELECT shared_at IS NOT NULL FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000031'),'and when');
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET shared_at='1999-01-01T00:00:00Z', shared_by='e0941000-0000-4000-8000-000000000005' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(shared_by)$q$),
 '"e0941000-0000-4000-8000-000000000001"'::jsonb,'the share stamp cannot be rewritten while the file stays shared');
SELECT ok((SELECT shared_at > '2000-01-01' FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000031'),'shared_at is not backdated');
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET visibility='internal' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_SHARE_WRITER_REQUIRED','the owner cannot unshare by a direct REST update either');
-- Moving a SHARED file to another client takes it away from the client who had it, so no signed-in
-- caller may do it directly (round 3, verifier MINOR-B): not the owner, not a member holding the
-- global admin role, and not even with the share writer's gate open. They withdraw the share through
-- the share writer (audited) and move the private file. Only the service role moves a shared file,
-- and it arrives private, its stamp cleared, because the new client was never shown it.
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET contact_id='e0943000-0000-4000-8000-000000000002' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_SHARED_MOVE_REFUSED','the owner cannot move a shared file to another client over REST');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000005',$q$UPDATE public.client_files SET contact_id='e0943000-0000-4000-8000-000000000002' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_SHARED_MOVE_REFUSED','nor can a member holding the global admin role');
SELECT set_config('paige.client_file_share','on',true);
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET contact_id='e0943000-0000-4000-8000-000000000002' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_SHARED_MOVE_REFUSED','the share writer''s gate does not open a move');
SELECT set_config('paige.client_file_share','off',true);
SELECT ok((SELECT visibility='shared' AND contact_id='e0943000-0000-4000-8000-000000000003' AND shared_by='e0941000-0000-4000-8000-000000000001' AND shared_at IS NOT NULL
  FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000031'),'so the file is still shared with its client, its stamp intact');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000001',$q$UPDATE public.client_files SET contact_id='e0943000-0000-4000-8000-000000000002' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(visibility::text||'|'||(shared_at IS NULL AND shared_by IS NULL)::text)$q$,'service_role'),
 '"internal|true"'::jsonb,'a move by the service role arrives private, its stamp cleared');
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET contact_id='e0943000-0000-4000-8000-000000000003', visibility='shared' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_SHARE_WRITER_REQUIRED','moving a file and sharing it in one direct write is refused');
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET contact_id='e0943000-0000-4000-8000-000000000003' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(visibility::text||'|'||contact_id::text)$q$),
 '"internal|e0943000-0000-4000-8000-000000000003"'::jsonb,'the owner moves a private file freely, and it stays private');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000001',$q$UPDATE public.client_files SET visibility='shared' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(visibility::text)$q$,'service_role'),
 '"shared"'::jsonb,'the service role shares it on its new client');
-- The signed-in route: withdraw through the share writer (one client_unshare audit row), then move.
SELECT is(pg_temp.a_share('e0944000-0000-4000-8000-000000000031',false,(SELECT updated_at FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000031'))->>'shared','false','the owner withdraws the share through the share writer');
SELECT is(pg_temp.audits('e0944000-0000-4000-8000-000000000031','client_unshare'),1::bigint,'which records the withdrawal once');
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET contact_id='e0943000-0000-4000-8000-000000000002' WHERE id='e0944000-0000-4000-8000-000000000031' RETURNING to_jsonb(visibility::text||'|'||contact_id::text)$q$),
 '"internal|e0943000-0000-4000-8000-000000000002"'::jsonb,'and then moves the private file');
-- shared_by follows auth.users ON DELETE SET NULL (round 3, verifier MAJOR-A): deleting the user who
-- shared a file that is still shared succeeds, the file stays shared, and the sharer becomes NULL.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
 ('e0941000-0000-4000-8000-0000000000ad','authenticated','authenticated','documents-departed-sharer@tests.invalid',now());
INSERT INTO public.client_files(id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state,shared_by) VALUES
 ('e0944000-0000-4000-8000-0000000000ad','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000003','e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000003/internal/e0944000-0000-4000-8000-0000000000ad','Departed sharer.pdf','application/pdf',1,'shared','ready','e0941000-0000-4000-8000-0000000000ad');
SELECT is((SELECT shared_by FROM public.client_files WHERE id='e0944000-0000-4000-8000-0000000000ad'),'e0941000-0000-4000-8000-0000000000ad'::uuid,'a fixture file is shared by a user who is about to be deleted');
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET shared_by=NULL WHERE id='e0944000-0000-4000-8000-0000000000ad' RETURNING to_jsonb(shared_by)$q$),
 '"e0941000-0000-4000-8000-0000000000ad"'::jsonb,'a direct write cannot clear the sharer of a shared file');
SELECT lives_ok($q$DELETE FROM auth.users WHERE id='e0941000-0000-4000-8000-0000000000ad'$q$,'deleting the user who shared a still-shared file succeeds');
SELECT ok((SELECT visibility='shared' AND shared_by IS NULL AND shared_at IS NOT NULL FROM public.client_files WHERE id='e0944000-0000-4000-8000-0000000000ad')
  AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id='e0941000-0000-4000-8000-0000000000ad'),'the file stays shared and its sharer becomes NULL');
-- The stamp is held by a constraint too, so a write that skips the trigger cannot leave a shared
-- row without shared_at (the list parsers require it) or a stamp on an unshared row.
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.client_files'::regclass AND conname='client_files_share_stamp_consistent'),'the share stamp is a table constraint');
SET LOCAL session_replication_role = replica;
SELECT throws_ok($q$UPDATE public.client_files SET visibility='shared' WHERE id='e0944000-0000-4000-8000-000000000025'$q$,'23514',NULL,'a shared row without shared_at is refused even when triggers are skipped');
SELECT throws_ok($q$UPDATE public.client_files SET shared_at=now() WHERE id='e0944000-0000-4000-8000-000000000025'$q$,'23514',NULL,'and so is a stamp on an unshared row');
SET LOCAL session_replication_role = origin;

-- 2. Grants.
SELECT ok(NOT has_function_privilege('anon','public.client_file_set_client_share(uuid,uuid,uuid,boolean,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('public','public.client_file_set_client_share(uuid,uuid,uuid,boolean,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.client_file_set_client_share(uuid,uuid,uuid,boolean,timestamptz)','EXECUTE'),'anon, PUBLIC and the service role cannot execute the share writer');
SELECT ok(NOT has_function_privilege('anon','public.client_file_owner_begin_upload(uuid,uuid,uuid,uuid,text,text,bigint)','EXECUTE')
  AND NOT has_function_privilege('public','public.client_file_owner_begin_upload(uuid,uuid,uuid,uuid,text,text,bigint)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.client_file_owner_begin_upload(uuid,uuid,uuid,uuid,text,text,bigint)','EXECUTE'),'anon, PUBLIC and the service role cannot reserve an owner upload');
SELECT ok(NOT has_function_privilege('anon','public.client_file_owner_finish_upload(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('public','public.client_file_owner_finish_upload(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.client_file_owner_finish_upload(uuid,uuid,uuid)','EXECUTE'),'anon, PUBLIC and the service role cannot finish an owner upload');
SELECT ok(NOT has_function_privilege('anon','public.client_file_owner_list(uuid,uuid,uuid,integer,timestamptz,uuid)','EXECUTE')
  AND NOT has_function_privilege('public','public.client_file_owner_list(uuid,uuid,uuid,integer,timestamptz,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.client_file_owner_list(uuid,uuid,uuid,integer,timestamptz,uuid)','EXECUTE'),'anon, PUBLIC and the service role cannot list owner files');
SELECT ok(has_function_privilege('authenticated','public.client_file_set_client_share(uuid,uuid,uuid,boolean,timestamptz)','EXECUTE')
  AND has_function_privilege('authenticated','public.client_file_owner_begin_upload(uuid,uuid,uuid,uuid,text,text,bigint)','EXECUTE')
  AND has_function_privilege('authenticated','public.client_file_owner_finish_upload(uuid,uuid,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.client_file_owner_list(uuid,uuid,uuid,integer,timestamptz,uuid)','EXECUTE'),'signed-in callers can execute the owner functions');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_documents(uuid,integer,timestamptz,uuid)','EXECUTE')
  AND NOT has_function_privilege('public','public.client_portal_documents(uuid,integer,timestamptz,uuid)','EXECUTE'),'anon and PUBLIC cannot execute the customer read');
SELECT ok(has_function_privilege('authenticated','public.client_portal_documents(uuid,integer,timestamptz,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.client_portal_documents(uuid,integer,timestamptz,uuid)','EXECUTE'),'signed-in callers and the service role can execute the customer read');
SELECT ok(NOT has_function_privilege('authenticated','public._client_files_share_stamp()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._client_file_owner_row(public.client_files)','EXECUTE'),'the trigger and projection helpers are not client-callable');

-- 3. Authority: business admin of the current workspace only.
SELECT is(pg_temp.share('e0941000-0000-4000-8000-000000000005','e0942000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-000000000021',true,'2027-01-01T00:00:00Z')->>'sqlstate','42501','a member holding the global admin role is refused');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000005','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000041')->>'sqlstate','42501','that member cannot reserve an upload either');
SELECT is(pg_temp.list_as('e0941000-0000-4000-8000-000000000005','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002')->>'sqlstate','42501','or list the files');
SELECT is(pg_temp.share('e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-000000000021',true,'2027-01-01T00:00:00Z')->>'sqlstate','42501','a customer is refused');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000001',$q$SELECT public.client_file_set_client_share('e0941000-0000-4000-8000-000000000005','e0942000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-000000000021',true,'2027-01-01T00:00:00Z')$q$)->>'sqlstate','42501','a caller claiming another actor is refused');
SELECT is(pg_temp.share('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000021',true,'2027-01-01T00:00:00Z')->>'sqlstate','42501','a workspace that is not the caller''s current one is refused');
SELECT is(pg_temp.share('e0941000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000021',true,'2027-01-01T00:00:00Z')->>'error','FILE_NOT_FOUND','another business''s admin gets not found for this file');
SELECT is(pg_temp.share('e0941000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-0000000000ff',true,'2027-01-01T00:00:00Z')->>'error','FILE_NOT_FOUND','the same code as a random id');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000002','e0943000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000042')->>'error','CONTACT_NOT_FOUND','another business''s admin cannot reserve onto this client');
SELECT is(pg_temp.share('e0941000-0000-4000-8000-000000000010',NULL,'e0944000-0000-4000-8000-000000000021',true,'2027-01-01T00:00:00Z')->>'sqlstate','42501','a platform user with no membership is refused');
UPDATE public.profiles SET active_tenant_id='e0942000-0000-4000-8000-000000000001' WHERE user_id='e0941000-0000-4000-8000-000000000010';
SELECT is(pg_temp.share('e0941000-0000-4000-8000-000000000010','e0942000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-000000000021',true,'2027-01-01T00:00:00Z')->>'sqlstate','42501','a platform user pointed at the business is still not its admin');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_file_set_client_share(NULL,NULL,'e0944000-0000-4000-8000-000000000021',true,'2027-01-01T00:00:00Z')$q$,'anon')->>'sqlstate','42501','anonymous caller refused');
SELECT is((SELECT visibility::text FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000021'),'internal','no refusal shared anything');
SELECT is((SELECT count(*) FROM public.client_files WHERE id IN ('e0944000-0000-4000-8000-000000000041','e0944000-0000-4000-8000-000000000042')),0::bigint,'no refusal reserved anything');

-- 4. Tier: never a top-level agency; a sub-account is the server's Sub-account tier row.
SELECT is(pg_temp.share('e0941000-0000-4000-8000-000000000006','e0942000-0000-4000-8000-000000000003','e0944000-0000-4000-8000-000000000028',true,'2027-01-01T00:00:00Z')->>'error','CLIENT_FILES_UNAVAILABLE','a top-level agency cannot share client files');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000006','e0942000-0000-4000-8000-000000000003','e0943000-0000-4000-8000-000000000007','e0944000-0000-4000-8000-000000000043')->>'error','CLIENT_FILES_UNAVAILABLE','or reserve one');
SELECT is(pg_temp.list_as('e0941000-0000-4000-8000-000000000006','e0942000-0000-4000-8000-000000000003','e0943000-0000-4000-8000-000000000007')->>'error','CLIENT_FILES_UNAVAILABLE','or list them');
SELECT is(pg_temp.share('e0941000-0000-4000-8000-000000000007','e0942000-0000-4000-8000-000000000004','e0944000-0000-4000-8000-000000000027',true,'2027-01-01T00:00:00Z')->>'ok','true','a sub-account admin shares their own client''s file');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000007','e0942000-0000-4000-8000-000000000004','e0943000-0000-4000-8000-000000000006','e0944000-0000-4000-8000-000000000044')->>'ok','true','and reserves an upload for them');

-- 5. Owner reservation.
CREATE TEMP TABLE b1 AS SELECT pg_temp.begin_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000045','Brand guide.pdf','application/pdf',4) AS r;
SELECT is((SELECT pg_temp.keys(r)||'|'||pg_temp.keys(r->'file') FROM b1),'file,ok|created_at,filename,id,mime_type,shared_at,size_bytes,source,storage_path,updated_at,upload_state,visibility','a reservation returns the owner row shape');
SELECT is((SELECT r#>>'{file,storage_path}' FROM b1),pg_temp.fpath('01','02','e0944000-0000-4000-8000-000000000045'),'the server fixes the exact tenant/contact/internal/id path');
SELECT is((SELECT (r#>>'{file,visibility}')||'|'||(r#>>'{file,upload_state}')||'|'||(r#>>'{file,source}') FROM b1),'internal|pending|business','a new owner file starts private and pending');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000045','Brand guide.pdf','application/pdf',4),(SELECT r FROM b1),'repeating the same reservation is idempotent');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000045','Other name.pdf','application/pdf',4)->>'sqlstate','42501','a conflicting replay of the same id is refused');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000046','Notes.pdf','text/html',4)->>'sqlstate','22023','an unapproved type is refused');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000046','Notes.png','application/pdf',4)->>'sqlstate','22023','a type that does not match the extension is refused');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000046','Huge.pdf','application/pdf',20971521)->>'sqlstate','22023','a file over 20 MB is refused');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000004','e0944000-0000-4000-8000-000000000046')->>'error','CONTACT_NOT_FOUND','a merged client cannot receive a new file');
SELECT is((SELECT count(*) FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000046'),0::bigint,'no refused reservation left a row');

-- 6. PUT and finish.
SELECT is(pg_temp.finish_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-000000000045')->>'sqlstate','22023','finishing before the object exists is refused');
SELECT is(pg_temp.put_as('e0941000-0000-4000-8000-000000000001',pg_temp.fpath('01','02','e0944000-0000-4000-8000-000000000045'),5),'1'::jsonb,'the owner PUTs to the reserved path');
SELECT is(pg_temp.finish_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-000000000045')->>'sqlstate','22023','an object of the wrong size is refused');
-- Storage forbids deleting object rows directly; the fixture role corrects the stored size instead.
UPDATE storage.objects SET metadata='{"size":4,"mimetype":"application/pdf"}' WHERE bucket_id='client-files' AND name=pg_temp.fpath('01','02','e0944000-0000-4000-8000-000000000045');
SELECT is(pg_temp.finish_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-0000000000aa')->>'error','FILE_NOT_FOUND','finishing a reservation that does not exist is not found');
SELECT is(pg_temp.finish_as('e0941000-0000-4000-8000-000000000005','e0942000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-000000000045')->>'sqlstate','42501','another member cannot finish it');
SELECT is(pg_temp.finish_as('e0941000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000045')->>'error','FILE_NOT_FOUND','another business cannot finish it');
CREATE TEMP TABLE f1 AS SELECT pg_temp.finish_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-000000000045') AS r;
SELECT is((SELECT (r->>'ok')||'|'||(r->>'replayed')||'|'||(r#>>'{file,upload_state}')||'|'||(r#>>'{file,visibility}') FROM f1),'true|false|ready|internal','finishing makes the file ready and keeps it private');
SELECT is(pg_temp.audits('e0944000-0000-4000-8000-000000000045','owner_file_uploaded'),1::bigint,'one audit row for the upload');
SELECT is((SELECT user_id::text||'|'||data::text FROM public.audit_logs WHERE entity='client_files' AND entity_id='e0944000-0000-4000-8000-000000000045'),
 'e0941000-0000-4000-8000-000000000001|'||jsonb_build_object('file_id','e0944000-0000-4000-8000-000000000045','tenant_id','e0942000-0000-4000-8000-000000000001','contact_id','e0943000-0000-4000-8000-000000000002')::text,
 'the upload audit names the actor, the business, the client and the file');
SELECT is((SELECT (r->>'replayed')||'|'||(r#>>'{file,upload_state}') FROM (SELECT pg_temp.finish_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-000000000045') AS r) x),'true|ready','finishing again replays');
SELECT is(pg_temp.audits('e0944000-0000-4000-8000-000000000045','owner_file_uploaded'),1::bigint,'and writes no second audit row');
SELECT is(pg_temp.sees_object('e0941000-0000-4000-8000-000000000001',pg_temp.fpath('01','02','e0944000-0000-4000-8000-000000000045')),1::bigint,'the owner can open the finished file');
SELECT is(pg_temp.sees_object('e0941000-0000-4000-8000-000000000004',pg_temp.fpath('01','02','e0944000-0000-4000-8000-000000000045')),0::bigint,'the client cannot open it while it is private');

-- 7. Share, replay, unshare.
SELECT is(pg_temp.a_share('e0944000-0000-4000-8000-000000000022',true)->>'error','FILE_IS_CLIENT_UPLOAD','a client''s own upload cannot be re-labelled');
SELECT is(pg_temp.a_share('e0944000-0000-4000-8000-000000000023',true)->>'error','FILE_NOT_READY','an unfinished upload cannot be shared');
SELECT is(pg_temp.a_share('e0944000-0000-4000-8000-000000000024',true)->>'error','CONTACT_NOT_FOUND','a merged client''s file cannot be shared');
SELECT is(pg_temp.a_share('e0944000-0000-4000-8000-000000000021',NULL)->>'error','INVALID_REQUEST','a missing share flag is refused');
SELECT is(pg_temp.audits('e0944000-0000-4000-8000-000000000022')+pg_temp.audits('e0944000-0000-4000-8000-000000000023')+pg_temp.audits('e0944000-0000-4000-8000-000000000024'),0::bigint,'refusals write no audit row');
CREATE TEMP TABLE before_stale AS SELECT to_jsonb(f) AS row FROM public.client_files f WHERE id='e0944000-0000-4000-8000-000000000021';
SELECT is((SELECT pg_temp.keys(x)||'|'||(x->>'ok')||'|'||(x->>'error')||'|'||((x->>'updated_at')::timestamptz='2027-01-01T00:00:00Z')::text
  FROM pg_temp.a_share('e0944000-0000-4000-8000-000000000021',true,'2026-12-31T00:00:00Z') x),
 'error,ok,updated_at|false|FILE_CHANGED|true','a stale version is refused with the current one');
SELECT is((SELECT to_jsonb(f) FROM public.client_files f WHERE id='e0944000-0000-4000-8000-000000000021'),(SELECT row FROM before_stale),'the row is byte-identical after a stale call');
SELECT is(pg_temp.a_share('e0944000-0000-4000-8000-000000000021',true,NULL)->>'error','FILE_CHANGED','a missing version is refused');
CREATE TEMP TABLE first_share AS SELECT pg_temp.a_share('e0944000-0000-4000-8000-000000000021',true) AS r;
SELECT is((SELECT r - 'shared_at' - 'updated_at' FROM first_share),
 '{"ok":true,"replayed":false,"file_id":"e0944000-0000-4000-8000-000000000021","shared":true,"portal_connected":true}'::jsonb,'the owner shares a file with a connected client');
SELECT ok((SELECT visibility='shared' AND shared_at=(SELECT (r->>'shared_at')::timestamptz FROM first_share) AND shared_by='e0941000-0000-4000-8000-000000000001'
  AND updated_at=(SELECT (r->>'updated_at')::timestamptz FROM first_share) FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000021'),'the row records the share, who made it and the new version');
CREATE TEMP TABLE after_share AS SELECT to_jsonb(f) AS row FROM public.client_files f WHERE id='e0944000-0000-4000-8000-000000000021';
SELECT is(pg_temp.a_share('e0944000-0000-4000-8000-000000000021',true)->>'replayed','true','repeating the share (with the old version) replays');
SELECT is((SELECT to_jsonb(f) FROM public.client_files f WHERE id='e0944000-0000-4000-8000-000000000021'),(SELECT row FROM after_share),'a replay writes nothing');
SELECT is(pg_temp.audits('e0944000-0000-4000-8000-000000000021'),1::bigint,'one audit row for the share and none for its replay');
SELECT is((SELECT action||'|'||user_id::text||'|'||data::text FROM public.audit_logs WHERE entity='client_files' AND entity_id='e0944000-0000-4000-8000-000000000021'),
 'client_share|e0941000-0000-4000-8000-000000000001|'||jsonb_build_object('file_id','e0944000-0000-4000-8000-000000000021','tenant_id','e0942000-0000-4000-8000-000000000001','contact_id','e0943000-0000-4000-8000-000000000002')::text,
 'the share audit names the actor, the business, the client and the file');
SELECT ok(pg_temp.file(pg_temp.as_user('e0941000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_documents()$q$),'e0944000-0000-4000-8000-000000000021') IS NOT NULL,'Sam sees the file once it is shared');
SELECT ok(current_setting('paige.client_file_share', true) IS DISTINCT FROM 'on','the share writer leaves no open permission behind in the transaction');
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET visibility='shared' WHERE id='e0944000-0000-4000-8000-000000000001' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_SHARE_WRITER_REQUIRED','so a direct REST share right after it is still refused');
SELECT is(pg_temp.a_share('e0944000-0000-4000-8000-000000000025',true)->>'portal_connected','false','sharing with a client who has not joined the portal says so');
SELECT is(pg_temp.a_share('e0944000-0000-4000-8000-000000000021',false,(SELECT updated_at FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000021')) - 'updated_at',
 '{"ok":true,"replayed":false,"file_id":"e0944000-0000-4000-8000-000000000021","shared":false,"shared_at":null,"portal_connected":true}'::jsonb,'the owner unshares it');
SELECT ok((SELECT visibility='internal' AND shared_at IS NULL AND shared_by IS NULL FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000021'),'unsharing clears the share stamp');
SELECT ok(pg_temp.file(pg_temp.as_user('e0941000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_documents()$q$),'e0944000-0000-4000-8000-000000000021') IS NULL,'and Sam no longer sees it once it is unshared');
SELECT is((SELECT string_agg(action, ',' ORDER BY created_at, action) FROM public.audit_logs WHERE entity='client_files' AND entity_id='e0944000-0000-4000-8000-000000000021'),'client_share,client_unshare','each real change writes exactly one audit row');
SELECT is(pg_temp.a_share('e0944000-0000-4000-8000-000000000024',false)->>'replayed','true','withdrawing a share never needs a live client');

-- 8. Owner list: pinned to tenant and contact, the actor's own pending rows only.
CREATE TEMP TABLE ol AS SELECT pg_temp.list_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001') AS r;
SELECT is((SELECT pg_temp.keys(r) FROM ol),'contact_id,files,has_more,ok,portal_connected','the list envelope carries exactly its keys');
SELECT is((SELECT count(*) FROM ol, jsonb_array_elements(r->'files') e WHERE pg_temp.keys(e)<>'created_at,filename,id,mime_type,shared_at,size_bytes,source,storage_path,updated_at,upload_state,visibility'),0::bigint,'every row carries exactly the owner row keys');
SELECT is((SELECT pg_temp.ids(r) FROM ol),'03,09,04,02,01,10','the business sees its own files, its own unfinished upload and the client''s finished uploads, newest first');
SELECT is((SELECT string_agg(right(e->>'id',2)||':'||(e->>'source')||':'||(e->>'visibility'), ',' ORDER BY e->>'id') FROM ol, jsonb_array_elements(r->'files') e),
 '01:business:internal,02:business:shared,03:business:shared,04:client:client_upload,09:client:client_upload,10:business:shared','each row says where it came from and who can see it');
SELECT ok((SELECT pg_temp.file(r,'e0944000-0000-4000-8000-000000000005') IS NULL AND pg_temp.file(r,'e0944000-0000-4000-8000-000000000008') IS NULL FROM ol),'the client''s unfinished upload and a mis-filed foreign row are not listed');
SELECT ok((SELECT strpos(r::text,'PRIVATE DESCRIPTION NOTE')=0 FROM ol),'descriptions are not projected');
SELECT is(pg_temp.list_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001',2)->>'has_more','true','a short page says more exist');
SELECT is(pg_temp.list_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000003')->>'portal_connected','false','the list says when the client has not joined the portal');
SELECT is(pg_temp.list_as('e0941000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001')->>'sqlstate','42501','an assigned coach from another business cannot list this client''s files');
-- Keyset paging (round 3, compliance S5): the next page starts strictly after the (created_at, id)
-- of the last row shown. Every file on a client is reachable, and two files saved in the same
-- instant are neither skipped nor repeated. Files 25 and ad were both inserted at now() (one
-- transaction), so they tie; 61-63 tie at an older instant.
INSERT INTO public.client_files(id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state,created_at) VALUES
 ('e0944000-0000-4000-8000-000000000061','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000003','e0941000-0000-4000-8000-000000000001',pg_temp.fpath('01','03','e0944000-0000-4000-8000-000000000061'),'Tie one.pdf','application/pdf',61,'internal','ready','2026-06-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000062','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000003','e0941000-0000-4000-8000-000000000001',pg_temp.fpath('01','03','e0944000-0000-4000-8000-000000000062'),'Tie two.pdf','application/pdf',62,'internal','ready','2026-06-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000063','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000003','e0941000-0000-4000-8000-000000000001',pg_temp.fpath('01','03','e0944000-0000-4000-8000-000000000063'),'Tie three.pdf','application/pdf',63,'internal','ready','2026-06-01T00:00:00Z');
SELECT is(pg_temp.page(pg_temp.owner_page('e0943000-0000-4000-8000-000000000003',100,NULL,NULL)),'ad,25,63,62,61|false','the whole library, newest first, ties broken by id');
SELECT is(pg_temp.page(pg_temp.owner_page('e0943000-0000-4000-8000-000000000003',1,NULL,NULL)),'ad|true','a one-file page says more exist');
SELECT is(pg_temp.page(pg_temp.owner_page('e0943000-0000-4000-8000-000000000003',1,pg_temp.at('e0944000-0000-4000-8000-0000000000ad'),'e0944000-0000-4000-8000-0000000000ad')),'25|true','the next page keeps a file saved in the same instant as the last one shown');
SELECT is(pg_temp.page(pg_temp.owner_page('e0943000-0000-4000-8000-000000000003',2,pg_temp.at('e0944000-0000-4000-8000-000000000025'),'e0944000-0000-4000-8000-000000000025')),'63,62|true','and continues into older files');
SELECT is(pg_temp.page(pg_temp.owner_page('e0943000-0000-4000-8000-000000000003',2,'2026-06-01T00:00:00Z','e0944000-0000-4000-8000-000000000062')),'61|false','through a three-way tie to the last file, then says there is no more');
SELECT is(pg_temp.owner_page('e0943000-0000-4000-8000-000000000003',2,'2026-06-01T00:00:00Z',NULL)->>'error','INVALID_REQUEST','a cursor without its id is refused');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000002',format('SELECT public.client_file_owner_list(%L,%L,%L,%L,%L,%L)','e0941000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000002','e0943000-0000-4000-8000-000000000003',100,'2027-12-31T00:00:00Z','e0944000-0000-4000-8000-0000000000ff'))->>'error','CONTACT_NOT_FOUND','a cursor never widens the read to another business''s client');

SELECT is(pg_temp.list_as('e0941000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000002','e0943000-0000-4000-8000-000000000001')->>'error','CONTACT_NOT_FOUND','even through their own workspace');

-- 9. Customer read: who gets nothing.
CREATE TEMP TABLE jr AS SELECT pg_temp.jordan($q$SELECT public.client_portal_documents()$q$) AS r;
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_documents()$q$,'anon')->>'sqlstate','42501','anonymous read refused');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_documents()$q$)->>'error','customer authentication required','signed-out read refused with the exact message');
SELECT ok(pg_temp.as_user('e0941000-0000-4000-8000-000000000005',$q$SELECT public.client_portal_documents()$q$) IS NULL,'staff with no relationship gets NULL');
SELECT ok(pg_temp.owner($q$SELECT public.client_portal_documents()$q$) IS NULL,'the business owner is not a customer of their own business');
SELECT ok(pg_temp.jordan($q$SELECT public.client_portal_documents(p_tenant_id=>'e0942000-0000-4000-8000-000000000002')$q$) IS NULL,'a foreign business argument returns NULL, never that business''s rows');
DROP INDEX public.clients_linked_user_id_unique;
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0943000-0000-4000-8000-000000000009','e0942000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000009','e0941000-0000-4000-8000-000000000001','Two','Businesses','active'),
 ('e0943000-0000-4000-8000-000000000010','e0942000-0000-4000-8000-000000000002','e0941000-0000-4000-8000-000000000009','e0941000-0000-4000-8000-000000000002','Two','Businesses','active');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000009',$q$SELECT public.client_portal_documents()$q$),
 '{"sqlstate":"42501","error":"select an authorized customer relationship"}'::jsonb,'two relationships raise 42501 with the exact message');
DELETE FROM public.clients WHERE id IN ('e0943000-0000-4000-8000-000000000009','e0943000-0000-4000-8000-000000000010');
CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients(linked_user_id) WHERE linked_user_id IS NOT NULL;

-- 10. Customer read: exact allowlist.
SELECT is((SELECT (r->>'tenant_id')||'|'||(r->>'client_id') FROM jr),'e0942000-0000-4000-8000-000000000001|e0943000-0000-4000-8000-000000000001','the read resolves the customer''s own business and relationship');
SELECT is((SELECT pg_temp.keys(r) FROM jr),'client_id,files,has_more,summary,tenant_id','the envelope carries exactly the allowlisted keys');
SELECT is((SELECT count(*) FROM jr, jsonb_array_elements(r->'files') e WHERE pg_temp.keys(e)<>'created_at,filename,id,mime_type,shared_at,size_bytes,source,state,storage_path'),0::bigint,'every file carries exactly the allowlisted keys');
SELECT is((SELECT pg_temp.keys(r->'summary') FROM jr),'from_you,shared','the summary carries exactly the allowlisted keys');
SELECT is((SELECT pg_temp.ids(r) FROM jr),'05,04,02,10','shared files and his own uploads, newest first');
SELECT is((SELECT string_agg(right(e->>'id',2)||':'||(e->>'source')||':'||(e->>'state'), ',' ORDER BY o) FROM jr, jsonb_array_elements(r->'files') WITH ORDINALITY x(e,o)),
 '05:you:pending,04:you:ready,02:business:ready,10:business:ready','each file says who it came from and whether it is complete');
SELECT is((SELECT r->'summary' FROM jr),'{"shared":2,"from_you":2}'::jsonb,'the summary counts both kinds');
SELECT is((SELECT pg_temp.file(r,'e0944000-0000-4000-8000-000000000002')->>'filename' FROM jr),'Welcome pack.pdf','a shared file carries its name');
SELECT ok((SELECT (pg_temp.file(r,'e0944000-0000-4000-8000-000000000002')->>'shared_at') IS NOT NULL AND (pg_temp.file(r,'e0944000-0000-4000-8000-000000000004')->>'shared_at') IS NULL FROM jr),'shared_at is set on shared files only');

-- 11. Customer read: what Jordan never sees.
SELECT ok((SELECT pg_temp.file(r,'e0944000-0000-4000-8000-000000000001') IS NULL AND strpos(r::text,'PRIVATE TEAM PLAN')=0 FROM jr),'an internal file on his own contact is not visible');
SELECT ok((SELECT pg_temp.file(r,'e0944000-0000-4000-8000-000000000003') IS NULL AND strpos(r::text,'PENDING OWNER FILE')=0 FROM jr),'a shared file the business has not finished uploading is not visible');
SELECT ok((SELECT pg_temp.file(r,'e0944000-0000-4000-8000-000000000006') IS NULL FROM jr),'another customer''s shared file is not visible');
SELECT ok((SELECT pg_temp.file(r,'e0944000-0000-4000-8000-000000000008') IS NULL AND strpos(r::text,'FOREIGN TENANT FILE')=0 FROM jr),'a shared file in another business that points at his client id is not visible');
SELECT ok((SELECT pg_temp.file(r,'e0944000-0000-4000-8000-000000000007') IS NULL FROM jr),'another customer''s upload is not visible');
SELECT ok((SELECT pg_temp.file(r,'e0944000-0000-4000-8000-000000000009') IS NULL AND strpos(r::text,'ANOTHER LOGINS UPLOAD')=0 FROM jr),'an upload by a different login on his contact is not visible');
SELECT ok((SELECT strpos(r::text,'PRIVATE DESCRIPTION NOTE')=0 FROM jr),'the description is never projected');
SELECT ok((SELECT strpos(r::text,'e0941000-0000-4000-8000-000000000001')=0 FROM jr),'the staff uploader and sharer are never projected');
SELECT is(pg_temp.ids(pg_temp.as_user('e0941000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_documents()$q$)),'22,07,06','the other customer sees only their own shared files and uploads, newest first');
SELECT is((SELECT pg_temp.ids(r)||'|'||(r->>'has_more') FROM (SELECT pg_temp.jordan($q$SELECT public.client_portal_documents(p_limit=>2)$q$) AS r) x),'05,04|true','a short page keeps the order and says more exist');
SELECT is(pg_temp.page(pg_temp.jordan_page(50,pg_temp.at('e0944000-0000-4000-8000-000000000004'),'e0944000-0000-4000-8000-000000000004')),'02,10|false','the next page continues after the last file seen');
SELECT is((SELECT r->'summary' FROM (SELECT pg_temp.jordan($q$SELECT public.client_portal_documents(p_limit=>1)$q$) AS r) x),(SELECT r->'summary' FROM jr),'the summary never depends on the page size');
-- Same-instant files are never skipped (round 3): two files the business shared in the same instant,
-- the older of them landing on a page boundary. A bare timestamp cursor used to drop the second.
INSERT INTO public.client_files(id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state,created_at) VALUES
 ('e0944000-0000-4000-8000-000000000064','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000001',pg_temp.fpath('01','01','e0944000-0000-4000-8000-000000000064'),'Same instant A.pdf','application/pdf',64,'shared','ready','2026-06-01T00:00:00Z'),
 ('e0944000-0000-4000-8000-000000000065','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000001',pg_temp.fpath('01','01','e0944000-0000-4000-8000-000000000065'),'Same instant B.pdf','application/pdf',65,'shared','ready','2026-06-01T00:00:00Z');
SELECT is(pg_temp.page(pg_temp.jordan_page(1,pg_temp.at('e0944000-0000-4000-8000-000000000010'),'e0944000-0000-4000-8000-000000000010')),'65|true','a page ends on the first of two files shared in the same instant');
SELECT is(pg_temp.page(pg_temp.jordan_page(1,'2026-06-01T00:00:00Z','e0944000-0000-4000-8000-000000000065')),'64|false','and the next page still shows the second one');
SELECT is(pg_temp.jordan_page(1,'2026-06-01T00:00:00Z',NULL)->>'sqlstate','22023','a cursor without its id is refused');


-- 12. Storage: what createSignedUrl relies on, under the customer's own RLS.
SELECT is(pg_temp.sees_object('e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000002'),1::bigint,'the customer can read the object of a shared file');
SELECT is(pg_temp.sees_object('e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000001'),0::bigint,'but not the object of an internal file');
SELECT is(pg_temp.sees_object('e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/client_upload/e0941000-0000-4000-8000-000000000003/e0944000-0000-4000-8000-000000000004'),1::bigint,'and can read his own upload');
SELECT is(pg_temp.sees_object('e0941000-0000-4000-8000-000000000004','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000002'),0::bigint,'another customer cannot read his shared file''s object');
-- A file's object is fixed once it exists (round 4, verifier MAJOR-E). Storage authorizes a customer's
-- download by matching the object name to a storage_path they may see, so a signed-in writer who could
-- rewrite storage_path (or the uploader it is bound to) could point a SHARED row at another file's
-- object and show that object to the client without the share writer or an audit row: in two steps
-- for Jordan (A9), and across clients for Sam (A10). Every signed-in rewrite is refused by the trigger.
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000005',$q$UPDATE public.client_files SET storage_path='e0942000-0000-4000-8000-000000000001/parked/001' WHERE id='e0944000-0000-4000-8000-000000000001' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_IDENTITY_IMMUTABLE','a member cannot move a private file''s path out of the way (A9a)');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000005',$q$UPDATE public.client_files SET storage_path='e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000001' WHERE id='e0944000-0000-4000-8000-000000000002' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_IDENTITY_IMMUTABLE','nor point a shared file at the private file''s object (A9b)');
SELECT is(pg_temp.sees_object('e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000001'),0::bigint,'so Jordan still cannot read the private file''s object (A9c)');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000005',$q$UPDATE public.client_files SET storage_path='e0942000-0000-4000-8000-000000000001/parked/002' WHERE id='e0944000-0000-4000-8000-000000000002' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_IDENTITY_IMMUTABLE','a member cannot park a shared file''s path either (A10a)');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000005',$q$UPDATE public.client_files SET storage_path='e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000001' WHERE id='e0944000-0000-4000-8000-000000000006' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_IDENTITY_IMMUTABLE','nor point another client''s shared file at it (A10b)');
SELECT is(pg_temp.sees_object('e0941000-0000-4000-8000-000000000004','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000001'),0::bigint,'so Sam cannot read Jordan''s private file''s object (A10c)');
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET storage_path='e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/internal/e0944000-0000-4000-8000-000000000001' WHERE id='e0944000-0000-4000-8000-000000000006' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_IDENTITY_IMMUTABLE','the business admin cannot rewrite a path either');
SELECT is(pg_temp.owner($q$UPDATE public.client_files SET uploaded_by_user_id='e0941000-0000-4000-8000-000000000005' WHERE id='e0944000-0000-4000-8000-000000000002' RETURNING to_jsonb(id)$q$)->>'error',
 'FILE_IDENTITY_IMMUTABLE','or who uploaded a file');
SELECT ok((SELECT count(*)=3 FROM public.client_files WHERE uploaded_by_user_id='e0941000-0000-4000-8000-000000000001' AND storage_path=pg_temp.fpath('01',CASE WHEN id='e0944000-0000-4000-8000-000000000006' THEN '02' ELSE '01' END,id::text)
  AND id IN ('e0944000-0000-4000-8000-000000000001','e0944000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000006')),'every refused rewrite left its row as it was');

-- 13. The deployed customer upload pipeline still works (§58).
CREATE TEMP TABLE cu AS SELECT pg_temp.jordan($q$SELECT public.client_portal_begin_file_upload('e0944000-0000-4000-8000-000000000051','e0943000-0000-4000-8000-000000000001','Receipt.pdf','application/pdf',4,NULL)$q$) AS r;
SELECT is((SELECT r->>'storage_path' FROM cu),'e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/client_upload/e0941000-0000-4000-8000-000000000003/e0944000-0000-4000-8000-000000000051','the customer still reserves an exact server path');
SELECT is(pg_temp.put_as('e0941000-0000-4000-8000-000000000003',(SELECT r->>'storage_path' FROM cu)),'1'::jsonb,'the customer still PUTs to the reserved path');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_finish_file_upload('e0944000-0000-4000-8000-000000000051',NULL)$q$)->>'upload_state','ready','the customer still finishes their upload');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_file_upload_status('e0944000-0000-4000-8000-000000000051',NULL)$q$)->>'object_verified','true','the status check still verifies the saved object');
SELECT is((SELECT pg_temp.file(pg_temp.jordan($q$SELECT public.client_portal_documents()$q$),'e0944000-0000-4000-8000-000000000051')->>'state'),'ready','the finished upload appears in his documents');
SELECT is(pg_temp.put_as('e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000001/client_upload/e0941000-0000-4000-8000-000000000003/e0944000-0000-4000-8000-000000000052')->>'sqlstate','42501','a customer PUT to a path that was never reserved is still refused');

-- 14. Fold-in: a customer can no longer delete their own upload metadata over REST.
SELECT is(pg_temp.jordan($q$WITH d AS (DELETE FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000004' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$),'0'::jsonb,'the customer''s delete of their own upload removes nothing');
SELECT is((SELECT count(*) FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000004'),1::bigint,'the upload record is still there');
SELECT is(pg_temp.owner($q$WITH d AS (DELETE FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000004' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$),'1'::jsonb,'the business admin can still delete it');

-- 15. Fold-in: a staff PUT needs a reservation.
SELECT is(pg_temp.put_as('e0941000-0000-4000-8000-000000000001',pg_temp.fpath('01','02','e0944000-0000-4000-8000-000000000053'))->>'sqlstate','42501','a staff PUT to an unreserved path is refused');
SELECT is(pg_temp.put_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001/e0943000-0000-4000-8000-000000000002/shared/e0944000-0000-4000-8000-000000000053.pdf')->>'sqlstate','42501','including the old direct staff path shape');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000053')->>'ok','true','once reserved');
SELECT is(pg_temp.put_as('e0941000-0000-4000-8000-000000000001',pg_temp.fpath('01','02','e0944000-0000-4000-8000-000000000053')),'1'::jsonb,'the same staff PUT is allowed');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','e0943000-0000-4000-8000-000000000002','e0944000-0000-4000-8000-000000000054')->>'ok','true','the owner reserves another upload');
SELECT is(pg_temp.put_as('e0941000-0000-4000-8000-000000000005',pg_temp.fpath('01','02','e0944000-0000-4000-8000-000000000054'))->>'sqlstate','42501','a member cannot PUT onto the owner''s reservation');
-- A reservation only for a caller who can then PUT (verifier minor): the staff storage branch also
-- needs the global admin role or the platform owner, so a platform admin in the company workspace
-- (a business admin there through is_platform_operator) is refused at reserve instead of leaving a
-- stuck pending row. (A tenant owner/admin membership is synced the global admin role, so for them
-- the two checks agree.)
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0941000-0000-4000-8000-000000000011','authenticated','authenticated','documents-platform-admin@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0942000-0000-4000-8000-000000000005','test-tenant-e09-documents-company','Test company workspace','active','standalone',NULL,'E09DC',9491005,'{"system_workspace":true}');
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,status) VALUES
 ('e0943000-0000-4000-8000-000000000008','e0942000-0000-4000-8000-000000000005','e0941000-0000-4000-8000-000000000011','Company','Client','active');
INSERT INTO public.user_roles(user_id,role) VALUES ('e0941000-0000-4000-8000-000000000011','platform_admin') ON CONFLICT DO NOTHING;
UPDATE public.profiles SET active_tenant_id='e0942000-0000-4000-8000-000000000005' WHERE user_id='e0941000-0000-4000-8000-000000000011';
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000011',$q$SELECT to_jsonb(public.is_tenant_admin('e0942000-0000-4000-8000-000000000005'))$q$),'true'::jsonb,'the platform admin passes the business-admin check in the company workspace');
SELECT is(pg_temp.begin_as('e0941000-0000-4000-8000-000000000011','e0942000-0000-4000-8000-000000000005','e0943000-0000-4000-8000-000000000008','e0944000-0000-4000-8000-000000000055')->>'sqlstate','42501','a platform admin in the company workspace cannot reserve an upload it could not store');
SELECT is((SELECT count(*) FROM public.client_files WHERE id='e0944000-0000-4000-8000-000000000055'),0::bigint,'and the refusal left no pending row');

-- 16. Released work: unavailable once the client or the business is inactive.
INSERT INTO public.plans(id,tenant_id,title,horizon,starts_on,ends_on,scope,created_by,owner_user_id) VALUES
 ('e0945000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001','Brand project','custom',current_date,current_date+30,'team','e0941000-0000-4000-8000-000000000005','e0941000-0000-4000-8000-000000000005');
INSERT INTO public.plan_items(id,tenant_id,plan_id,item_type,title,created_by,assigned_to_user_id,contact_id) VALUES
 ('e0945000-0000-4000-8000-000000000002','e0942000-0000-4000-8000-000000000001','e0945000-0000-4000-8000-000000000001','task','Brand brief','e0941000-0000-4000-8000-000000000005','e0941000-0000-4000-8000-000000000005','e0943000-0000-4000-8000-000000000001');
INSERT INTO public.studio_sessions(id,tenant_id,owner_user_id,title) VALUES
 ('e0945000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000005','Brand session');
INSERT INTO public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,snapshot,created_by) VALUES
 ('e0945000-0000-4000-8000-000000000004','e0942000-0000-4000-8000-000000000001','e0945000-0000-4000-8000-000000000003','content','e0945000-0000-4000-8000-000000000005',1,'{"kind":"text","title":"Brand brief","body":"The brief for review"}','e0941000-0000-4000-8000-000000000005');
SELECT ok((pg_temp.as_user('e0941000-0000-4000-8000-000000000005',format('SELECT public.operations_delivery_submit_scoped(%L,%L,%L,%L,%L,%L,0)',
  'e0945000-0000-4000-8000-000000000002','e0945000-0000-4000-8000-000000000004','e0941000-0000-4000-8000-000000000001','e0941000-0000-4000-8000-000000000005','e0942000-0000-4000-8000-000000000001',
  (SELECT updated_at FROM public.plan_items WHERE id='e0945000-0000-4000-8000-000000000002'))) ? 'sqlstate') IS FALSE,'the team submits the work for review');
SELECT ok((pg_temp.owner(format('SELECT public.operations_delivery_review_scoped(%L,%L,%L,%L,%L,NULL)',
  (SELECT id FROM public.operations_delivery_submissions WHERE work_item_id='e0945000-0000-4000-8000-000000000002'),'e0941000-0000-4000-8000-000000000001','e0942000-0000-4000-8000-000000000001',
  (SELECT updated_at FROM public.operations_delivery_submissions WHERE work_item_id='e0945000-0000-4000-8000-000000000002'),'approved')) ? 'sqlstate') IS FALSE,'a second person approves it');
SELECT is(pg_temp.as_user('e0941000-0000-4000-8000-000000000005',format('SELECT public.operations_delivery_release_scoped(%L,%L,%L,%L)',
  (SELECT id FROM public.operations_delivery_submissions WHERE work_item_id='e0945000-0000-4000-8000-000000000002'),'e0941000-0000-4000-8000-000000000005','e0942000-0000-4000-8000-000000000001',
  (SELECT updated_at FROM public.operations_delivery_submissions WHERE work_item_id='e0945000-0000-4000-8000-000000000002')))->>'state','awaiting_client','it is released to Jordan');
CREATE TEMP TABLE rel AS SELECT id, updated_at FROM public.operations_delivery_client_releases WHERE tenant_id='e0942000-0000-4000-8000-000000000001';
CREATE FUNCTION pg_temp.jread() RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.jordan(format('SELECT public.operations_delivery_client_read_scoped(%L,%L,%L)',(SELECT id FROM rel),'e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001')) $$;
CREATE FUNCTION pg_temp.jdecide() RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.jordan(format('SELECT public.operations_delivery_client_decide_scoped(%L,%L,%L,%L,%L,%L)',(SELECT id FROM rel),'e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001',(SELECT updated_at FROM rel),'accepted','Looks right')) $$;
CREATE FUNCTION pg_temp.jreviews() RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.jordan($q$SELECT public.operations_delivery_client_reviews_scoped('e0941000-0000-4000-8000-000000000003','e0942000-0000-4000-8000-000000000001',40)$q$) $$;
SELECT is(pg_temp.jread()->>'title','Brand brief','Jordan reads the released work while everything is active');
SELECT is(jsonb_array_length(pg_temp.jreviews()->'releases'),1,'and finds it in his reviews');
UPDATE public.clients SET status='archived' WHERE id='e0943000-0000-4000-8000-000000000001';
SELECT is(pg_temp.jread()->>'error','DELIVERY_CLIENT_UNAVAILABLE','an archived client cannot read released work');
SELECT is(pg_temp.jdecide()->>'error','DELIVERY_CLIENT_UNAVAILABLE','or decide on it');
SELECT is(pg_temp.jreviews() - 'actor_id' - 'tenant_id','{"releases":[],"unavailable_count":1,"has_more":false}'::jsonb,'and his reviews hold it back as unavailable');
UPDATE public.clients SET status='active' WHERE id='e0943000-0000-4000-8000-000000000001';
UPDATE public.tenants SET status='suspended' WHERE id='e0942000-0000-4000-8000-000000000001';
SELECT is(pg_temp.jread()->>'error','DELIVERY_CLIENT_UNAVAILABLE','a suspended business''s released work cannot be read');
SELECT is(pg_temp.jdecide()->>'error','DELIVERY_CLIENT_UNAVAILABLE','or decided on');
SELECT is(pg_temp.jreviews() - 'actor_id' - 'tenant_id','{"releases":[],"unavailable_count":1,"has_more":false}'::jsonb,'and is held back from his reviews');
UPDATE public.tenants SET status='active' WHERE id='e0942000-0000-4000-8000-000000000001';
SELECT is(pg_temp.jdecide()->>'state','accepted','once both are active again Jordan accepts it');
SELECT is((SELECT state FROM public.operations_delivery_client_releases WHERE id=(SELECT id FROM rel)),'accepted','and the decision is recorded');

SELECT * FROM finish();
ROLLBACK;
