// Disposable loopback PostgreSQL only. Reuse the incumbent proof adapter; no
// provider/network/credentials, production schema, or real account is accepted.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';

const port=Number(process.argv[2]??65461);
const db=new OperatorPostgresFixture(port);
db.prefix=()=>`SELECT set_config('test.actor','',false);SELECT set_config('test.role','postgres',false);`;
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const T='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const lit=x=>x===null?'NULL':`'${String(x).replaceAll("'","''")}'`;
const service=sql=>`SET ROLE service_role;SELECT set_config('test.role','service_role',false);${sql};RESET ROLE;`;
const value=sql=>db.run(sql).split(/\r?\n/).filter(Boolean).at(-1);
const json=sql=>JSON.parse(db.run(service(sql)).split(/\r?\n/).find(x=>x.startsWith('{')));
const call=(actor=A,tenant=T,address='fixture@example.invalid',purpose='inbox',token='fixture-token-A')=>
  `SELECT public.provision_gmail_connection('${actor}','${tenant}','fixture-google',${lit(address)},'Fixture',${lit(purpose)},ARRAY['https://www.googleapis.com/auth/gmail.modify'],${lit(token)})`;
const disconnect=(row,actor=A,tenant=T)=>`SELECT public.disconnect_gmail_connection('${actor}','${tenant}',${lit(row.id)},${lit(row.credentials_vault_ref)},${lit(row.updated_at)}::timestamptz)`;
function functionSource(path,name) {
  const text=readFileSync(path,'utf8');
  const start=text.search(new RegExp(`create or replace function public\\.${name}\\(`,'i'));
  assert(start>=0,`Incumbent function ${name} exists`);
  const rest=text.slice(start);const tag=rest.match(/\bAS\s+(\$\w*\$)/i);
  assert(tag,`Function delimiter ${name}`);const end=rest.indexOf(`${tag[1]};`,tag.index+tag[0].length);
  assert(end>=0,`Function terminator ${name}`);return rest.slice(0,end+tag[1].length+1);
}
const actorMigration='supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql';
let checks=0;
function check(label,fn){fn();checks++;console.log(`PASS ${label}`);}
function refuse(sql,code){assert.throws(()=>db.run(service(sql)),error=>error.code===code,`Native refusal ${code}`);}
function rows(){return Number(value('SELECT count(*) FROM public.channel_connectors'));}
function secrets(){return Number(value('SELECT count(*) FROM vault.secrets'));}
function reset(){db.run(`TRUNCATE public.channel_connectors,vault.secrets;UPDATE public.tenants SET status='active';
  INSERT INTO public.profiles VALUES('${A}','${T}'),('${B}','${T}') ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;
  INSERT INTO public.tenant_members VALUES('${A}','${T}','owner','active') ON CONFLICT DO NOTHING;
  UPDATE public.tenant_members SET status='active',role='owner';DELETE FROM public.user_roles;UPDATE auth.users SET deleted_at=NULL,banned_until=NULL;`);}
function connector(){return JSON.parse(value('SELECT row_to_json(c) FROM public.channel_connectors c LIMIT 1'));}
try {
  db.run(`CREATE SCHEMA auth;CREATE SCHEMA vault;
    DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;END$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('test.role',true)$$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text,parent_tenant_id uuid,account_type text,features jsonb DEFAULT '{}');
    CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
    CREATE TABLE public.tenant_members(user_id uuid,tenant_id uuid,role text,status text,PRIMARY KEY(user_id,tenant_id));
    CREATE TABLE public.user_roles(user_id uuid,role text,PRIMARY KEY(user_id,role));
    CREATE TABLE public.channel_connectors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,channel_type text,
      provider text,inbound_address text,external_account_id text,from_address text,from_name text,display_name text,
      credentials_vault_ref text,status text,active boolean,updated_at timestamptz NOT NULL DEFAULT now(),
      mailbox_class text NOT NULL DEFAULT 'shared_support',mailbox_owner_user_id uuid,mailbox_scopes text[] DEFAULT '{}');
    CREATE UNIQUE INDEX uq_channel_connectors_inbound_address ON public.channel_connectors(channel_type,lower(inbound_address)) WHERE inbound_address IS NOT NULL;
    CREATE TABLE vault.secrets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text UNIQUE,secret text,description text);
    CREATE FUNCTION vault.create_secret(_secret text,_name text,_description text) RETURNS uuid LANGUAGE plpgsql AS $$DECLARE v uuid;BEGIN INSERT INTO vault.secrets(name,secret,description) VALUES(_name,_secret,_description) RETURNING id INTO v;RETURN v;END$$;
    CREATE FUNCTION vault.update_secret(_id uuid,_secret text,_name text,_description text) RETURNS void LANGUAGE sql AS $$UPDATE vault.secrets SET secret=_secret,name=_name,description=_description WHERE id=_id$$;
    INSERT INTO auth.users(id) VALUES('${A}'),('${B}');
    INSERT INTO public.tenants(id,status,account_type,features) VALUES('${T}','active','standalone','{}'),('${U}','active','standalone','{}'),('${C}','active','standalone','{"system_workspace":true}');
    INSERT INTO public.profiles VALUES('${A}','${T}'),('${B}','${T}');
    INSERT INTO public.tenant_members VALUES('${A}','${T}','owner','active'),('${B}','${T}','owner','active'),('${B}','${U}','owner','active');`);
  db.run(functionSource('supabase/migrations/20260714142258_tier_rail_phaseB.sql','is_platform_admin'));
  db.run(functionSource(actorMigration,'is_company_workspace'));
  db.run(functionSource(actorMigration,'is_tenant_admin_as'));
  db.run(readFileSync('supabase/migrations/20260727120000_write_channel_secret_bridge.sql','utf8'));
  const migration=readFileSync('supabase/migrations/20271108200000_gmail_connection_authority.sql','utf8');
  db.run(migration);db.run(migration);
  check('migration replay and service-only public door/helper ACL',()=>{
    assert.equal(value(`SELECT has_function_privilege('service_role','public.provision_gmail_connection(uuid,uuid,text,text,text,text,text[],text)','EXECUTE')`),'t');
    for(const role of ['anon','authenticated'])for(const signature of ['provision_gmail_connection(uuid,uuid,text,text,text,text,text[],text)','disconnect_gmail_connection(uuid,uuid,uuid,text,timestamp with time zone)'])
      assert.equal(value(`SELECT has_function_privilege('${role}','public.${signature}','EXECUTE')`),'f');
    assert.equal(value(`SELECT has_function_privilege('service_role','public._gmail_connection_actor(uuid,uuid)','EXECUTE')`),'f');
  });
  check('ordinary owner without global role saves one exact native connector and incumbent Vault secret',()=>{
    const result=json(call());assert.equal(result.connection_saved,true);assert.equal(result.tenant_id,T);
    assert.equal(rows(),1);assert.equal(secrets(),1);assert.equal(value('SELECT mailbox_owner_user_id FROM public.channel_connectors'),A);
    assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-A');
  });
  check('authenticated and anonymous callers cannot use the service credential setter',()=>{
    for(const role of ['authenticated','anon'])assert.throws(()=>db.run(`SET ROLE ${role};SELECT set_config('test.role','${role}',false);${call()}`),error=>error.code==='42501');
  });
  check('ordinary admin without global role retains canonical native authority',()=>{
    reset();db.run(`UPDATE public.tenant_members SET role='admin' WHERE user_id='${A}'`);
    assert.equal(json(call()).connection_saved,true);
  });
  check('same actor reconnect reuses connector and stable Vault identity',()=>{
    const before=connector().id;const result=json(call(A,T,'fixture@example.invalid','inbox','fixture-token-B'));
    assert.equal(result.reconnected,true);assert.equal(connector().id,before);assert.equal(rows(),1);assert.equal(secrets(),1);
    assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-B');
  });
  for(const purpose of ['inbox','send'])check(`another personal owner ${purpose} refuses without overwriting credential`,()=>{
    refuse(call(B,T,'fixture@example.invalid',purpose,'forbidden-token'),'42501');assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-B');assert.equal(connector().mailbox_owner_user_id,A);
  });
  for(const purpose of ['inbox','send'])check(`changed address with the same Google/Vault identity ${purpose} cannot replace a private credential`,()=>{
    refuse(call(B,T,'renamed@example.invalid',purpose,'forbidden-token'),'23505');
    assert.equal(rows(),1);assert.equal(secrets(),1);assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-B');
  });
  check('shared mailbox cannot be privatized',()=>{
    reset();json(call(A,T,'fixture@example.invalid','send'));refuse(call(),'42501');assert.equal(connector().mailbox_class,'shared_support');assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-A');
  });
  for(const [label,change]of[
    ['member',`UPDATE public.tenant_members SET role='member' WHERE user_id='${A}'`],
    ['revoked owner',`UPDATE public.tenant_members SET status='revoked' WHERE user_id='${A}'`],
    ['deleted actor',`UPDATE auth.users SET deleted_at=now() WHERE id='${A}'`],
    ['banned actor',`UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${A}'`],
    ['changed active workspace',`UPDATE public.profiles SET active_tenant_id='${U}' WHERE user_id='${A}'`],
    ['global admin without tenant authority',`DELETE FROM public.tenant_members WHERE user_id='${A}';INSERT INTO public.user_roles VALUES('${A}','admin')`],
    ['missing profile',`DELETE FROM public.profiles WHERE user_id='${A}'`],
    ['inactive workspace',`UPDATE public.tenants SET status='archived' WHERE id='${T}'`],
  ])check(`${label} refuses before native persistence`,()=>{
    reset();db.run(`INSERT INTO public.tenant_members VALUES('${A}','${T}','owner','active') ON CONFLICT DO NOTHING;${change}`);
    refuse(call(),'42501');assert.equal(rows(),0);assert.equal(secrets(),0);
  });
  check('existing canonical company exception is preserved as source-regression only',()=>{
    reset();db.run(`UPDATE public.profiles SET active_tenant_id='${C}' WHERE user_id='${A}';INSERT INTO public.user_roles VALUES('${A}','platform_admin')`);
    assert.equal(json(call(A,C)).connection_saved,true);assert.equal(connector().tenant_id,C);
  });
  check('a losing foreign-workspace collision keeps original credential intact',()=>{
    reset();db.run(`INSERT INTO public.tenant_members VALUES('${A}','${T}','owner','active') ON CONFLICT DO NOTHING`);json(call());
    db.run(`UPDATE public.profiles SET active_tenant_id='${U}' WHERE user_id='${B}'`);refuse(call(B,U),'23505');
    assert.equal(rows(),1);assert.equal(secrets(),1);assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-A');
  });
  check('connector failure rolls back the earlier Vault write in the same transaction',()=>{
    reset();db.run(`CREATE FUNCTION public.fixture_refuse_connector() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.inbound_address='rollback@example.invalid' THEN RAISE EXCEPTION 'fixture rollback';END IF;RETURN NEW;END$$;CREATE TRIGGER fixture_refuse_connector BEFORE INSERT OR UPDATE ON public.channel_connectors FOR EACH ROW EXECUTE FUNCTION public.fixture_refuse_connector();`);
    refuse(call(A,T,'rollback@example.invalid'),'P0001');assert.equal(rows(),0);assert.equal(secrets(),0);
  });
  reset();
  const providerCollision=await db.holdArchive(`INSERT INTO public.channel_connectors(tenant_id,channel_type,provider,inbound_address,status,active) VALUES('${T}','email','smtp','provider-race@example.invalid','active',true)`);
  refuse(call(A,T,'provider-race@example.invalid'),'23505');await providerCollision.completed;
  check('an actual concurrent other-provider unique-index winner rolls back Gmail Vault creation',()=>{
    assert.equal(rows(),1);assert.equal(connector().provider,'smtp');assert.equal(secrets(),0);
  });
  reset();db.run(`INSERT INTO public.tenant_members VALUES('${A}','${T}','owner','active') ON CONFLICT DO NOTHING`);
  const held=await db.holdArchive(service(call()));const began=Date.now();
  refuse(call(B),'42501');await held.completed;
  check('two actual sessions serialize competing personal owners before credential replacement',()=>{
    assert(Date.now()-began>=200,'second native request waited for the held transaction');assert.equal(rows(),1);assert.equal(connector().mailbox_owner_user_id,A);assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-A');
  });
  reset();
  const sameKey=await db.holdArchive(service(call()));const sameKeyBegan=Date.now();
  refuse(call(B,T,'renamed@example.invalid','send','forbidden-token'),'23505');await sameKey.completed;
  check('two actual sessions serialize changed addresses sharing the same stable credential identity',()=>{
    assert(Date.now()-sameKeyBegan>=200);assert.equal(rows(),1);assert.equal(secrets(),1);
    assert.equal(connector().mailbox_owner_user_id,A);assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-A');
  });
  for(const [label,sql] of [
    ['workspace switch',`UPDATE public.profiles SET active_tenant_id='${U}' WHERE user_id='${A}'`],
    ['membership revocation',`UPDATE public.tenant_members SET status='revoked' WHERE user_id='${A}' AND tenant_id='${T}'`],
  ]){
    reset();const held=await db.holdArchive(sql);const start=Date.now();refuse(call(),'42501');await held.completed;
    check(`two-session ${label} wins before waiting native commit`,()=>{assert(Date.now()-start>=200);assert.equal(rows(),0);assert.equal(secrets(),0);});
  }
  reset();db.run(`UPDATE public.profiles SET active_tenant_id='${C}' WHERE user_id='${A}';INSERT INTO public.user_roles VALUES('${A}','platform_admin')`);
  const companyRevocation=await db.holdArchive(`DELETE FROM public.user_roles WHERE user_id='${A}'`);
  refuse(call(A,C),'42501');await companyRevocation.completed;
  check('existing company authority source revocation wins before a waiting native commit',()=>{assert.equal(rows(),0);assert.equal(secrets(),0);});
  reset();json(call());let snapshot=connector();
  check('disconnect refuses a teammate personal mailbox without tombstone',()=>{
    refuse(disconnect(snapshot,B),'42501');assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-A');assert.equal(connector().active,true);
  });
  check('disconnect rejects stale native version after a legitimate reconnect',()=>{
    json(call(A,T,'fixture@example.invalid','inbox','fixture-token-latest'));refuse(disconnect(snapshot),'40001');
    assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-latest');assert.equal(connector().active,true);snapshot=connector();
  });
  check('disconnect cannot tombstone a credential outside the canonical tenant/account namespace',()=>{
    db.run(`UPDATE public.channel_connectors SET credentials_vault_ref='gmail_refresh_token:${U}:foreign'`);
    refuse(disconnect(connector()),'42501');assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-latest');
    db.run(`UPDATE public.channel_connectors SET credentials_vault_ref='gmail_refresh_token:${T}:fixture-google'`);snapshot=connector();
  });
  check('disconnect refuses an ambiguous legacy shared credential without tombstoning another mailbox',()=>{
    db.run(`INSERT INTO public.channel_connectors(tenant_id,channel_type,provider,inbound_address,external_account_id,credentials_vault_ref,active,status,mailbox_class,mailbox_owner_user_id)
      VALUES('${T}','email','gmail','legacy-second@example.invalid','fixture-google','gmail_refresh_token:${T}:fixture-google',true,'active','personal','${B}')`);
    refuse(disconnect(snapshot),'42501');assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-latest');
    assert.equal(rows(),2);db.run(`DELETE FROM public.channel_connectors WHERE inbound_address='legacy-second@example.invalid'`);
  });
  check('disconnect atomically tombstones and disables its exact current connector',()=>{
    assert.equal(json(disconnect(snapshot)).disconnected,true);assert.equal(value('SELECT secret FROM vault.secrets'),'revoked');
    assert.equal(connector().active,false);assert.equal(connector().credentials_vault_ref,null);snapshot=connector();
    assert.equal(json(disconnect(snapshot)).disconnected,false);assert.equal(secrets(),1);
  });
  reset();json(call());snapshot=connector();
  const disconnectRevocation=await db.holdArchive(`UPDATE public.tenant_members SET status='revoked' WHERE user_id='${A}' AND tenant_id='${T}'`);
  refuse(disconnect(snapshot),'42501');await disconnectRevocation.completed;
  check('two-session authority revocation prevents disconnect tombstone and disable',()=>{
    assert.equal(connector().active,true);assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-A');
  });
  reset();json(call());snapshot=connector();
  check('disconnect connector failure rolls back its Vault tombstone',()=>{
    db.run(`CREATE FUNCTION public.fixture_refuse_disable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.active=false THEN RAISE EXCEPTION 'fixture disable rollback';END IF;RETURN NEW;END$$;CREATE TRIGGER fixture_refuse_disable BEFORE UPDATE ON public.channel_connectors FOR EACH ROW EXECUTE FUNCTION public.fixture_refuse_disable();`);
    refuse(disconnect(snapshot),'P0001');assert.equal(value('SELECT secret FROM vault.secrets'),'fixture-token-A');assert.equal(connector().active,true);
  });
  console.log(`PASS ${checks} native Gmail transaction checks (actual PostgreSQL; provider NOT_RUN; full schema/hosted acceptance UNVERIFIED)`);
} finally {await db.close();}
