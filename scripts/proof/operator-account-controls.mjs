// Isolated PostgreSQL adapter proof. The caller identity fixture is synthetic;
// this is not deployed Auth / RLS acceptance. No connection string is accepted.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
if (!process.argv[2]) throw new Error('Pass the local pinned PGlite module entry path. No production database is used.');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const owner='00000000-0000-0000-0000-000000000001';
const member='00000000-0000-0000-0000-000000000002';
const agency='00000000-0000-0000-0000-000000000011';
const child='00000000-0000-0000-0000-000000000012';
const solo='00000000-0000-0000-0000-000000000013';
const internal='00000000-0000-0000-0000-000000000014';
const fixture=`
CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='${owner}'::uuid $$;
CREATE TYPE public.tenant_status AS ENUM ('trial','active','past_due','suspended','canceled');
CREATE TABLE public.tenants(id uuid PRIMARY KEY,slug text UNIQUE,name text NOT NULL, status public.tenant_status NOT NULL,account_type text,parent_tenant_id uuid REFERENCES tenants(id),stripe_customer_id text,stripe_subscription_id text,updated_at timestamptz DEFAULT now());
CREATE TABLE public.tenant_revenue_classification(tenant_id uuid,revenue_class text);
CREATE TABLE public.audit_logs(user_id uuid,action text,entity text,entity_id uuid,data jsonb);
CREATE TABLE public.channel_connectors(tenant_id uuid,secret_fixture text);
CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid);
INSERT INTO tenants(id,name,status,account_type,parent_tenant_id) VALUES
('${agency}','Example Agency','active','agency',null),('${child}','Example Child','active','sub_account','${agency}'),('${solo}','Example Solo','active','standalone',null),('${internal}','Example Operator','active','standalone',null);
INSERT INTO tenant_revenue_classification VALUES('${internal}','internal_test');
INSERT INTO channel_connectors VALUES('${child}','DO_NOT_EXPOSE_SYNTHETIC_SECRET');
INSERT INTO tenant_members VALUES('${agency}','${member}');
`;
await db.exec(fixture);
const lifecycle=await readFile('supabase/migrations/20260804150000_operator_fleet_seam.sql','utf8');
const canonical=lifecycle.match(/CREATE OR REPLACE FUNCTION public\.operator_set_tenant_status\([\s\S]*?\$\$;/)?.[0];
assert.ok(canonical,'canonical lifecycle source missing'); await db.exec(canonical);
const migration=await readFile('supabase/migrations/20261010005059_operator_account_controls.sql','utf8');
await db.exec(migration); await db.exec(migration);
const actor=async id=>db.query("select set_config('test.actor',$1,false)",[id]);
const read=async (id=agency)=>(await db.query('select operator_read_account_details($1) as value',[id])).rows[0].value;
const edit=(id,name,status,version)=>db.query('select operator_edit_account_details($1,$2,$3,$4) as value',[id,name,status,version]);
const denied=async (fn,code)=>{try{await fn();assert.fail('Expected refusal');}catch(e){assert.equal(e.code,code,e.message);}};
try {
 await actor(''); await denied(()=>read(),'42501');
 await actor(member); await denied(()=>read(),'42501'); await denied(()=>edit(agency,'Forged','active','fake'),'42501');
 await denied(()=>db.query('select operator_preview_account_deletion($1)',[agency]),'42501');
 await actor(owner);
 const original=await read();const saved=(await edit(agency,'  Revised Agency  ','suspended',original.version)).rows[0].value;
 assert.equal(saved.name,'Revised Agency');assert.equal(saved.status,'suspended');assert.equal(saved.account_type,'agency');assert.equal(saved.parent_tenant_id,null);
 assert.equal((await read(child)).parent_tenant_id,agency);assert.equal((await read(solo)).name,'Example Solo');
 assert.equal((await db.query('select count(*)::int as n from audit_logs')).rows[0].n,2);
 await denied(()=>edit(agency,'Stale overwrite','active',original.version),'40001'); assert.equal((await read()).name,'Revised Agency');
 await denied(()=>edit(agency,'','active',saved.version),'22023');
 const protectedRow=await read(internal);await denied(()=>edit(internal,'Unsafe','canceled',protectedRow.version),'42501');
 await denied(()=>read('00000000-0000-0000-0000-000000000099'),'P0002');
 const preview=(await db.query('select operator_preview_account_deletion($1) as value',[agency])).rows[0].value;
 assert.equal(preview.accounts.length,2);assert.equal(preview.execution_available,false);
 assert.ok(preview.blockers.some(b=>b.startsWith('channel_connectors.tenant_id: 1')));
 assert.ok(!JSON.stringify(preview).includes('DO_NOT_EXPOSE_SYNTHETIC_SECRET'));
 const protectedPreview=(await db.query('select operator_preview_account_deletion($1) as value',[solo])).rows[0].value;
 assert.ok(protectedPreview.blockers.some(b=>b.startsWith('Solo and internal')));
 const grants=(await db.query("select has_function_privilege('anon','operator_read_account_details(uuid)','execute') as anon,has_function_privilege('service_role','operator_edit_account_details(uuid,text,text,text)','execute') as service")).rows[0];
 assert.equal(grants.anon,false);assert.equal(grants.service,false);
 // Negative control: weakening the new server guard must cause the denial oracle to fail.
 const weak=migration.replaceAll('auth.uid() IS NULL OR NOT public.is_platform_owner()','auth.uid() IS NULL');
 await db.exec(weak);await actor(member);let caught=false;try{await denied(()=>read(),'42501');}catch{caught=true;}assert.equal(caught,true,'negative control failed to detect weakened owner guard');
 console.log('PASS: real SQL apply/replay, owner edit/readback/audit, ordinary/anonymous refusal, stale edit, validation, internal protection, parent/Solo preservation, tree/dependency preview, secret-free counts, grants, and weakened-guard negative control. Auth role derivation remains a fixture; production acceptance UNVERIFIED.');
} finally {await db.close();}
