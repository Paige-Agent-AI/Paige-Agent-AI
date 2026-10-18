// Disposable loopback database only, using the incumbent native proof adapter.
// The committed rollback proof also runs against the full rebuilt schema in CI.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';

const db=new OperatorPostgresFixture(Number(process.argv[2]));
db.prefix=()=>'';
const migration=name=>`supabase/migrations/${name}.sql`;
function source(file,name){
 const text=readFileSync(file,'utf8');
 const start=text.search(new RegExp(`create or replace function public\\.${name}\\(`,'i'));
 assert(start>=0,`existing ${name} source`);const rest=text.slice(start),tag=rest.match(/\bAS\s+(\$\w*\$)/i);
 assert(tag,`existing ${name} delimiter`);const end=rest.indexOf(`${tag[1]};`,tag.index+tag[0].length);
 assert(end>=0,`existing ${name} terminator`);return rest.slice(0,end+tag[1].length+1);
}
try {
 db.run(`CREATE SCHEMA auth;
  DO $$BEGIN
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;
  END$$;
  CREATE TYPE public.app_role AS ENUM('admin','moderator','user','super_admin','platform_admin');
  CREATE TYPE public.tenant_role AS ENUM('owner','admin','coach','member');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
  GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
  CREATE TABLE auth.users(id uuid PRIMARY KEY,instance_id uuid,aud text,role text,email text,encrypted_password text,created_at timestamptz,updated_at timestamptz,email_confirmed_at timestamptz);
  CREATE TABLE public.tenants(id uuid PRIMARY KEY,slug text,name text,account_number_prefix text,account_number bigint,account_type text,owner_user_id uuid,parent_tenant_id uuid,features jsonb);
  CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
  CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role public.tenant_role,status text,is_owner boolean,joined_at timestamptz DEFAULT now(),PRIMARY KEY(tenant_id,user_id));
  CREATE TABLE public.user_roles(user_id uuid,role public.app_role,PRIMARY KEY(user_id,role));
  CREATE FUNCTION public.agency_can_manage_child(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
  CREATE FUNCTION public.agency_team_role(uuid,uuid) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$;
  CREATE TABLE public.channel_connectors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,channel_type text,provider text,
   inbound_domain text,inbound_address text,from_name text,from_address text,reply_to text,display_name text,status text,active boolean,
   credentials_vault_ref text,config jsonb,updated_at timestamptz DEFAULT now());
  CREATE UNIQUE INDEX uq_channel_connectors_inbound_domain ON public.channel_connectors(channel_type,inbound_domain) WHERE inbound_domain IS NOT NULL;`);
 // Include the current native role-retirement floor instead of manufacturing a
 // seat the complete schema no longer permits. Execute its exact existing DDL.
 const retiredRoleDDL=readFileSync(migration('20270508000000_forbid_title_role_value'),'utf8')
  .match(/ALTER TABLE public\.tenant_members\s+ADD CONSTRAINT tenant_members_role_not_retired_title_role\s+CHECK \(role IS DISTINCT FROM 'coach'::public\.tenant_role\);/);
 assert(retiredRoleDDL,'existing tenant membership role-retirement constraint');
 db.run(retiredRoleDDL[0]);
 const platform=migration('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c');
 const actor=migration('20270521000000_operator_authority_in_company_workspaces');
 const initial=migration('20251009234919_3d7566f7-15b7-462f-90a3-b74b713298b6');
 db.run(source(initial,'has_role'));
 db.run(source(migration('20251009235043_6c594b86-0698-44bb-b6e3-728338243336'),'update_updated_at_column'));
 db.run(source(platform,'is_super_admin'));db.run(source(platform,'is_platform_owner'));
 db.run(source(migration('20260714142258_tier_rail_phaseB'),'is_platform_admin'));
 db.run(source(actor,'is_company_workspace'));db.run(source(actor,'is_tenant_admin_as'));
 db.run(source(migration('20260714144656_tier_rail_phaseB_agency_standing'),'current_user_tenant_id'));
 db.run(source(migration('20260726120000_platform_subscription_paige_seam'),'is_current_user_tenant_admin'));
 // Preserve the actual, intentionally asymmetric public-door ACLs.
 db.run(`REVOKE ALL ON FUNCTION public.is_tenant_admin_as(uuid,uuid) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.is_tenant_admin_as(uuid,uuid) TO service_role;
  REVOKE ALL ON FUNCTION public.is_current_user_tenant_admin() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.is_current_user_tenant_admin() TO authenticated;
  REVOKE ALL ON FUNCTION public.current_user_tenant_id() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.current_user_tenant_id() TO authenticated,service_role;`);
 db.run(readFileSync(migration('20260630023712_68d8be11-11cf-427c-861a-914d90fa5239'),'utf8'));
 db.run(readFileSync(migration('20260729030000_comms_email_connector_provision_on_verify'),'utf8'));
 const normalize=migration('20271101142133_tenant_email_domains_normalize_domain');
 db.run(`ALTER TABLE public.tenant_email_domains ADD COLUMN sendgrid_domain_id text,ADD COLUMN sendgrid_status text,ADD COLUMN sendgrid_verified_at timestamptz;`);
 db.run(source(normalize,'guard_tenant_email_domain_sendgrid_facts'));
 db.run(`REVOKE ALL ON FUNCTION public.guard_tenant_email_domain_sendgrid_facts() FROM PUBLIC,anon,authenticated;
  CREATE TRIGGER trg_guard_domain_sendgrid_facts BEFORE INSERT OR UPDATE ON public.tenant_email_domains FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_email_domain_sendgrid_facts();`);
 db.run(readFileSync(normalize,'utf8'));
 const result=spawnSync(db.psql,[...db.args(),'-v',`domain_role_apply=${!process.argv.includes('--baseline')}`,'-f',resolve('supabase/tests/tenant_email_domain_current_role.sql')],
  {encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,windowsHide:true});
 process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');if(result.error)throw result.error;
 process.exitCode=result.status??1;
} finally {await db.close();}
