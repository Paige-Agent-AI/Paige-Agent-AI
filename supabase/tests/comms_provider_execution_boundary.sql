-- Isolated empty PostgreSQL test database ONLY. Never target the linked project.
\set ON_ERROR_STOP on
begin;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}');
create type public.tenant_status as enum ('trial','active','suspended');
create table public.tenants(id uuid primary key, owner_user_id uuid, status public.tenant_status default 'active',
 account_type text default 'standalone', parent_tenant_id uuid, features jsonb default '{}', slug text default 'test-tenant', name text default 'Test tenant');
create table public.tenant_members(tenant_id uuid, user_id uuid, status text);
create table public.messages(id uuid, tenant_id uuid, direction text, status text, channel_type text default 'email', recipients jsonb default '[]');
create table public.channel_connectors(id uuid primary key default gen_random_uuid(), tenant_id uuid, channel_type text, provider text,
 inbound_address text, inbound_domain text, display_name text, from_name text, from_address text, reply_to text, status text, active boolean, config jsonb);
create unique index test_managed_connector on public.channel_connectors(tenant_id)
 where channel_type='email' and provider='resend' and config->>'managed_default'='true';
create table public.platform_email_settings(shared_domain text, default_reply_to text);
create table public.tenant_setup_business_context_meta(tenant_id uuid, managed_email_local_part text);
create table public.tenant_email_identities(tenant_id uuid, local_part text);
create function public.sanitize_email_local_part(text) returns text language sql immutable as $$select $1$$;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
\ir ../migrations/20270602000104_comms_provider_execution_boundary.sql
-- Retry applies cleanly before any account/tenant construction.
\ir ../migrations/20270602000104_comms_provider_execution_boundary.sql
insert into auth.users values
 ('10000000-0000-4000-8000-000000000001','restricted@example.test','{"comms_provider_execution":"disabled"}'),
 ('10000000-0000-4000-8000-000000000002','ordinary@example.test','{}'),
 ('10000000-0000-4000-8000-000000000003','replacement@example.test','{}');
create function public.test_managed_sender_lifecycle() returns trigger language plpgsql as $$
declare connector uuid;
begin
 connector := public.provision_paige_managed_email_connector(new.id);
 if new.comms_provider_execution_disabled and connector is not null then raise exception 'first insert granted restricted authority'; end if;
 if not new.comms_provider_execution_disabled and connector is null then raise exception 'first ordinary insert unavailable'; end if;
 return new;
end $$;
create trigger test_managed_sender_lifecycle after insert on public.tenants
 for each row execute function public.test_managed_sender_lifecycle();
insert into public.tenants(id,owner_user_id) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
do $$ begin
 if public.comms_provider_execution_allowed('20000000-0000-4000-8000-000000000001') then raise exception 'restricted tenant allowed'; end if;
 if not public.comms_provider_execution_allowed('20000000-0000-4000-8000-000000000002') then raise exception 'ordinary tenant denied'; end if;
 if public.comms_provider_execution_allowed(null,'10000000-0000-4000-8000-000000000001') then raise exception 'restricted actor allowed'; end if;
 if public.comms_provider_execution_allowed(null,null,'restricted@example.test') then raise exception 'restricted recipient allowed'; end if;
 if not public.comms_provider_execution_allowed(null,null,'new@example.test') then raise exception 'ordinary platform invite denied'; end if;
 if public.comms_provider_execution_allowed() then raise exception 'missing scope allowed'; end if;
 if public.comms_provider_execution_allowed('20000000-0000-4000-8000-000000000009') then raise exception 'unknown tenant allowed'; end if;
 if public.comms_provider_execution_allowed(null,null,'malformed') then raise exception 'malformed recipient allowed'; end if;
 if has_function_privilege('authenticated','public.comms_provider_execution_allowed(uuid,uuid,text)','EXECUTE') then raise exception 'browser RPC granted'; end if;
 if not has_function_privilege('service_role','public.comms_provider_execution_allowed(uuid,uuid,text)','EXECUTE') then raise exception 'service RPC absent'; end if;
 begin
   update public.tenants set comms_provider_execution_disabled=false where id='20000000-0000-4000-8000-000000000001';
   raise exception 'lowered restriction';
 exception when insufficient_privilege then null; end;
 update public.tenants set owner_user_id='10000000-0000-4000-8000-000000000003' where id='20000000-0000-4000-8000-000000000001';
 if public.comms_provider_execution_allowed('20000000-0000-4000-8000-000000000001') then raise exception 'owner transfer bypass'; end if;
 begin
   insert into public.messages(tenant_id,direction,status) values ('20000000-0000-4000-8000-000000000001','outbound','queued');
   raise exception 'restricted queue persisted';
 exception when insufficient_privilege then null; end;
 insert into public.messages(tenant_id,direction,status) values ('20000000-0000-4000-8000-000000000002','outbound','queued');
 insert into public.messages(tenant_id,direction,status) values ('20000000-0000-4000-8000-000000000001','outbound','failed');
 if (select count(*) from public.messages where status='queued') <> 1 then raise exception 'queue effect mismatch'; end if;
 -- An active restricted membership remains a floor even if the Auth marker is removed.
 update auth.users set raw_app_meta_data='{}' where id='10000000-0000-4000-8000-000000000001';
 insert into public.tenant_members values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','active');
 if public.comms_provider_execution_allowed(null,'10000000-0000-4000-8000-000000000001') then raise exception 'active membership bypass'; end if;
 -- Browser-claim owners cannot write the protected column even upward.
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin
   update public.tenants set comms_provider_execution_disabled=true where id='20000000-0000-4000-8000-000000000002';
   raise exception 'browser protected-column write';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims','',true);
 insert into public.messages(tenant_id,direction,status,channel_type,recipients) values
   ('20000000-0000-4000-8000-000000000002','outbound','queued','sms','[{"address":"+15555550100"}]');
end $$;
rollback;

