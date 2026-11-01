// Native disposable proof, NOT hosted Auth/RLS or customer acceptance. No production connection.
// Auth/current-workspace/minimal tables and the preparing audit are explicit fixture ports.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

assert.equal(process.env.EXP02_DISPOSABLE, '1');
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.match(process.env.PGPORT ?? '', /^\d+$/);
assert.ok(Number(process.env.PGPORT) >= 1024 && Number(process.env.PGPORT) <= 65535);
assert.ok(process.env.PSQL && process.env.PGUSER && process.env.EXP02_PG_DATA_DIRECTORY);
assert.ok(process.argv.slice(2).every(x => x === '--baseline') && process.argv.length <= 3);
const baseline = process.argv.includes('--baseline');
const producer = '65264e3e5faa9274195f6f541c1d30661f396a8a';
const database = `exp02_recovery_${randomUUID().replaceAll('-', '')}`;
const args = db => ['-X', '--no-password', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', process.env.PGPORT,
  '-U', process.env.PGUSER, '-d', db, '-v', 'ON_ERROR_STOP=1'];
function sql(query, db = database, failure) {
  const r = spawnSync(process.env.PSQL, args(db), { input: '\\set VERBOSITY verbose\n' + query,
    encoding: 'utf8', timeout: 30000, env: process.env, windowsHide: true });
  if (r.error) throw r.error;
  if (failure) { assert.notEqual(r.status, 0); assert.match(r.stderr, failure); }
  else assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const normalized = p => p.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
assert.equal(normalized(sql('SHOW data_directory;', 'postgres')), normalized(process.env.EXP02_PG_DATA_DIRECTORY));
assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname IN ('postgres','authenticated','anon','service_role');", 'postgres'), '4');
const source = name => readFileSync(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const frozen = path => {
  const r = spawnSync('git', ['show', `${producer}:${path}`], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); return r.stdout.replaceAll('\r\n', '\n');
};
function original(file, name, prefix = '') {
  const s = source(file), start = s.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(' + prefix);
  assert.ok(start >= 0, name); const tail = s.slice(start), tag = tail.match(/AS\s+(\$[a-z_]*\$)/i);
  assert.ok(tag, name); const end = tail.indexOf(tag[1] + ';', tag.index + tag[0].length);
  assert.ok(end > 0, name); return tail.slice(0, end + tag[1].length + 1);
}
const A = 'e2000000-0000-4000-8000-000000000001', B = 'e2000000-0000-4000-8000-000000000002';
const actor = 'e2000000-0000-4000-8000-000000000010', owner = 'e2000000-0000-4000-8000-000000000011';
const target = 'e2000000-0000-4000-8000-000000000012', other = 'e2000000-0000-4000-8000-000000000013';
const contact = 'e2000000-0000-4000-8000-000000000020', second = 'e2000000-0000-4000-8000-000000000021';
const request = 'e2000000-0000-4000-8000-000000000030';
const identity = who => `SET test.actor='${who}';`;
const cleanup = (tenant = A, user = target, id = request) => `SELECT public._exp02_billing_recovery_cleanup('${tenant}','${user}','${id}');`;
const prepare = (act = 'revoke_owner') => `INSERT INTO public.paige_audit_log(id,actor_user_id,actor_role,action,target_type,target_id,tenant_id,payload)
  VALUES('${request}','${actor}','super_admin','tenant:owner_recovery.${act}','user','${target}','${A}',
    jsonb_build_object('request_id','${request}','target','${target}','outcome','preparing',
      'transaction_id',pg_current_xact_id()::text,'backend_pid',pg_backend_pid()));`;
const invoke = (query = cleanup(), before = '', act) => `BEGIN;${identity(actor)}${prepare(act)}${before}${query}COMMIT;`;
const results = [];
const pass = label => { results.push(label); console.log(JSON.stringify({ case: label, passed: true })); };
function reset() {
  sql(`DELETE FROM public.paige_audit_log;TRUNCATE public.platform_billing_contacts,public.tenant_members,public.tenants,auth.users,public.user_roles,proof.active_workspaces;
    INSERT INTO auth.users(id) VALUES('${actor}'),('${owner}'),('${target}'),('${other}');
    INSERT INTO public.user_roles VALUES('${actor}','super_admin');
    INSERT INTO public.tenants(id,account_type) VALUES('${A}','standalone'),('${B}','standalone');
    INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status,role) VALUES
      ('${A}','${owner}',true,'active','owner'),('${A}','${target}',true,'active','owner');
    INSERT INTO proof.active_workspaces VALUES('${owner}','${A}');`);
}
const put = (id = contact, user = target, designation = 'delegate', tenant = A) =>
  sql(`INSERT INTO public.platform_billing_contacts(id,tenant_id,user_id,designation) VALUES('${id}','${tenant}','${user}','${designation}');`);
const state = () => sql("SELECT jsonb_build_object('contacts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.platform_billing_contacts c),'audits',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.paige_audit_log a));");
const metadata = () => sql("SELECT (to_jsonb(p)-'prosrc') || jsonb_build_object('comment',obj_description(p.oid,'pg_proc')) FROM pg_proc p WHERE oid='public.platform_billing_contact_revoke(uuid)'::regprocedure;");
const candidate = () => readFileSync(new URL('../proof/exp02-billing-recovery.sql', import.meta.url), 'utf8');
function denied(label, query, pattern = /42501:|permission denied/) {
  const before = state(); sql(query, database, pattern); assert.equal(state(), before, label + ' preserves contacts/audits'); pass(label);
}
let created = false;
try {
  sql(`CREATE DATABASE ${database};`, 'postgres'); created = true;
  sql(`CREATE SCHEMA auth;CREATE SCHEMA proof;
    CREATE TYPE public.app_role AS ENUM('super_admin','platform_admin','admin');
    CREATE TYPE public.tenant_role AS ENUM('owner','admin','member');
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE public.user_roles(user_id uuid,role public.app_role,PRIMARY KEY(user_id,role));
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,owner_user_id uuid,account_type text,archived_at timestamptz,
      company boolean DEFAULT false,platform_fee_bps integer,parent_tenant_id uuid,stripe_customer_id text,stripe_subscription_id text);
    CREATE TABLE public.tenant_members(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,is_owner boolean,status text,
      role public.tenant_role DEFAULT 'member',business_owner_id uuid,updated_at timestamptz DEFAULT now());
    CREATE TABLE proof.active_workspaces(actor uuid PRIMARY KEY,tenant_id uuid);
    CREATE TABLE public.platform_billing_contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,designation text,
      designated_by uuid,revoked_at timestamptz,revoked_by uuid);
    CREATE TABLE public.paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,actor_role text,
      action text NOT NULL,target_type text,target_id uuid,tenant_id uuid,payload jsonb NOT NULL DEFAULT '{}',created_at timestamptz DEFAULT now());
    ALTER TABLE public.paige_audit_log ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON public.paige_audit_log TO authenticated,anon,service_role;
    CREATE POLICY fixture_audit ON public.paige_audit_log FOR ALL TO authenticated USING(true) WITH CHECK(true);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
    CREATE FUNCTION public.billing_active_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT tenant_id FROM proof.active_workspaces WHERE actor=auth.uid()$$;
    CREATE FUNCTION public.is_company_workspace(t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT company FROM public.tenants WHERE id=t$$;
    CREATE FUNCTION public.is_tenant_owner(u uuid,t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=u AND tenant_id=t AND is_owner AND status='active')$$;
    ${original('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_super_admin','_user_id uuid')}
    ${original('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_super_admin',')')}
    ${original('20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_platform_owner',')')}
    ${original('20271116020008_exp08_co_owner_authority.sql','is_tenant_account_holder')}
    ${original('20271116020008_exp08_co_owner_authority.sql','grant_co_owner')}
    REVOKE ALL ON FUNCTION public.grant_co_owner(uuid,uuid) FROM PUBLIC,anon;
    GRANT EXECUTE ON FUNCTION public.grant_co_owner(uuid,uuid) TO authenticated,service_role;
    ${original('20271120010008_exp08_owner_invitations.sql','_solo_shell_tenant')}
    ${original('20271120010008_exp08_owner_invitations.sql','_tenant_account_holder_state')}
    ${original('20261045000000_platform_billing_accounts_foundation_a.sql','platform_billing_workspace_owner_scope')}
    ${original('20261045000000_platform_billing_accounts_foundation_a.sql','platform_billing_contact_designate')}
    ${original('20261111050000_the_workspace_can_connect_a_payment_method.sql','platform_billing_contact_revoke')}
    REVOKE ALL ON FUNCTION public.platform_billing_workspace_owner_scope() FROM PUBLIC,anon,authenticated,service_role;
    REVOKE ALL ON FUNCTION public.platform_billing_contact_designate(uuid,text),public.platform_billing_contact_revoke(uuid) FROM PUBLIC,anon,service_role;
    GRANT EXECUTE ON FUNCTION public.platform_billing_contact_designate(uuid,text),public.platform_billing_contact_revoke(uuid) TO authenticated;
    COMMENT ON FUNCTION public.platform_billing_contact_revoke(uuid) IS 'Fixture incumbent comment';`);
  sql(source('20271126080006_exp02_billing_current_authority.sql'));
  sql(source('20271126080007_exp02_billing_final_authority.sql'));
  sql(frozen('scripts/proof/exp08-owner-recovery-writers.sql'));
  sql(frozen('scripts/proof/exp08-owner-recovery-provenance.sql'));
  reset(); put();
  const beforeMetadata = metadata();
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.platform_billing_contact_revoke(uuid)'::regprocedure;"), 'f8fa3a425f70d301f47b5b5750c57ad3');
  if (!baseline) sql(candidate());
  // Failing-first baseline: the new private integration is intentionally absent on released main.
  const answer = JSON.parse(sql(invoke()));
  assert.equal(answer.status, 'revoked'); assert.deepEqual(answer.contact_ids, [contact]);
  assert.equal(answer.audit_ids.length, 1); assert.equal(metadata(), beforeMetadata);
  pass('private original-writer cleanup binds native preparing recovery and returns original contact/audit identities');
  assert.equal(sql(`SELECT count(*) FROM public.platform_billing_contacts WHERE id='${contact}' AND revoked_at IS NOT NULL AND revoked_by='${actor}';`), '1');
  assert.equal(sql(`SELECT count(*) FROM public.paige_audit_log WHERE id='${answer.audit_ids[0]}' AND actor_role='super_admin' AND payload->>'owner_recovery_request_id'='${request}';`), '1');
  pass('recovery audit truthfully attributes actual super_admin; ordinary API metadata preserved');
  const settled = state(); sql(candidate()); assert.equal(state(), settled); assert.equal(metadata(), beforeMetadata);
  pass('exact replay conserves source, original ABI/OID/ACL/comment and all business rows');
  reset(); put();
  assert.deepEqual(JSON.parse(sql(`${identity(owner)}SET ROLE authenticated;SELECT public.platform_billing_contact_revoke('${contact}');`)), { id: contact, revoked: true });
  assert.equal(sql("SELECT actor_role FROM public.paige_audit_log;"), 'owner');
  assert.equal(sql("SELECT payload ? 'owner_recovery_request_id' FROM public.paige_audit_log;"), 'f');
  pass('ordinary authenticated owner retains original result and audit without recovery metadata');
  reset(); put(); denied('super_admin cannot borrow ordinary owner API even during a preparing request', invoke(`SELECT public.platform_billing_contact_revoke('${contact}');`));
  for (const role of ['authenticated', 'anon', 'service_role']) {
    for (const query of [cleanup(), `SELECT public._exp02_billing_contact_revoke('${contact}','${A}','${target}','${request}');`,
      `SELECT public._exp02_billing_revoke_scope('${A}','${target}','${request}');`]) {
      denied(role + ' has no private Billing EXECUTE: ' + query.split('(')[0], `${identity(actor)}SET ROLE ${role};${query}`);
    }
  }
  reset();
  const zero = JSON.parse(sql(invoke())); assert.deepEqual(zero, { status: 'not_required', contact_ids: [], audit_ids: [] });
  assert.equal(sql("SELECT count(*) FROM public.paige_audit_log WHERE action='platform_billing_contact_revoked';"), '0');
  pass('known authorized zero returns not_required without inventing a Billing effect or audit');
  reset(); put();
  denied('no native preparing request is not zero', identity(actor) + cleanup());
  denied('wrong request action refuses without effects', invoke(cleanup(), '', 'grant_owner'));
  denied('foreign tenant refuses without effects', invoke(cleanup(B)));
  denied('foreign target refuses without effects', invoke(cleanup(A, other)));
  denied('partial-null context refuses without effects', invoke(`SELECT public._exp02_billing_recovery_cleanup('${A}',NULL,'${request}');`));
  denied('all-null cleanup cannot enter ordinary owner lane', identity(owner) + 'SELECT public._exp02_billing_recovery_cleanup(NULL,NULL,NULL);');
  denied('private kernel cannot revoke another recipient contact', invoke(`SELECT public._exp02_billing_contact_revoke('${contact}','${A}','${other}','${request}');`));
  sql(`BEGIN;${identity(actor)}${prepare()}COMMIT;`);
  denied('committed preparing row is not a current-transaction credential', identity(actor) + cleanup());
  const changes = [
    ['revoked super_admin role', 'DELETE FROM public.user_roles;'],
    ['platform_admin instead of super_admin', "UPDATE public.user_roles SET role='platform_admin';"],
    ['soft-deleted recovery actor', `UPDATE auth.users SET deleted_at=now() WHERE id='${actor}';`],
    ['banned recovery actor', `UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${actor}';`],
    ['working holder', `UPDATE public.tenants SET owner_user_id='${owner}' WHERE id='${A}';`],
    ['paused holder', `UPDATE public.tenants SET owner_user_id='${owner}' WHERE id='${A}';UPDATE public.tenant_members SET status='suspended' WHERE user_id='${owner}';`],
    ['archived workspace', `UPDATE public.tenants SET archived_at=now() WHERE id='${A}';`],
    ['agency workspace', `UPDATE public.tenants SET account_type='agency' WHERE id='${A}';`],
    ['parented Billing-ineligible workspace', `UPDATE public.tenants SET parent_tenant_id='${B}' WHERE id='${A}';`],
  ];
  for (const [label, change] of changes) { reset(); put(); sql(change); denied(label + ' refuses cleanup without effects', invoke()); }
  reset(); put(contact, target, 'delegate'); put(second, target, 'primary_contact');
  denied('last primary refusal rolls back earlier target cleanup and all audits atomically', invoke(), /billing_primary_contact_required/);
  reset(); put(contact, target, 'primary_contact'); put(second, other, 'primary_contact');
  assert.equal(JSON.parse(sql(invoke())).status, 'revoked');
  assert.equal(sql(`SELECT count(*) FROM public.platform_billing_contacts WHERE id='${second}' AND revoked_at IS NULL;`), '1');
  pass('existing other primary is retained when the target primary is legitimately removed');
  reset(); put(); sql("ALTER TABLE public.paige_audit_log ADD CONSTRAINT fixture_billing_audit_failure CHECK(action<>'platform_billing_contact_revoked');");
  denied('original Billing audit failure rolls back contact and preparing audit', invoke(), /fixture_billing_audit_failure/);
  sql('ALTER TABLE public.paige_audit_log DROP CONSTRAINT fixture_billing_audit_failure;');
  reset(); put();
  sql(`CREATE FUNCTION proof.revoke_actor_after_contact() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN DELETE FROM public.user_roles WHERE user_id='${actor}';RETURN NEW;END$$;
    CREATE TRIGGER fixture_contact_authority AFTER UPDATE ON public.platform_billing_contacts FOR EACH ROW EXECUTE FUNCTION proof.revoke_actor_after_contact();`);
  denied('effect-time role change after contact write is detected and rolls back', invoke());
  sql('DROP TRIGGER fixture_contact_authority ON public.platform_billing_contacts;DROP FUNCTION proof.revoke_actor_after_contact();');
  reset(); put();
  sql(`CREATE FUNCTION proof.restore_holder_after_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='platform_billing_contact_revoked' THEN UPDATE public.tenants SET owner_user_id='${owner}' WHERE id='${A}';END IF;RETURN NEW;END$$;
    CREATE TRIGGER fixture_audit_authority AFTER INSERT ON public.paige_audit_log FOR EACH ROW EXECUTE FUNCTION proof.restore_holder_after_audit();`);
  denied('holder becomes working after audit: final effect gate rolls back all effects', invoke());
  sql('DROP TRIGGER fixture_audit_authority ON public.paige_audit_log;DROP FUNCTION proof.restore_holder_after_audit();');
  reset(); put();
  const kernelSig = 'public._exp02_billing_contact_revoke(uuid,uuid,uuid,uuid)';
  const kernelDefinition = sql(`SELECT pg_get_functiondef('${kernelSig}'::regprocedure);`).replaceAll('\r\n', '\n');
  const altered = kernelDefinition.replace('    PERFORM public._exp02_billing_revoke_scope(p_recovery_tenant,p_recovery_user,p_recovery_request);', '    PERFORM 1;');
  assert.notEqual(altered, kernelDefinition); sql(altered);
  const alteredState = state(); sql(candidate(), database, /original-body conservation failed/); assert.equal(state(), alteredState);
  assert.equal(sql(`SELECT pg_get_functiondef('${kernelSig}'::regprocedure);`).replaceAll('\r\n', '\n'), altered);
  sql(kernelDefinition); pass('reverted private currentness span refuses replay without repairing drift');
  sql(`GRANT EXECUTE ON FUNCTION ${kernelSig} TO authenticated;`);
  sql(candidate(), database, /private Billing source or metadata drift/);
  assert.equal(sql(`SELECT has_function_privilege('authenticated','${kernelSig}','EXECUTE');`), 't');
  sql(`REVOKE EXECUTE ON FUNCTION ${kernelSig} FROM authenticated;`);
  pass('private ACL drift is refused rather than silently repaired');
  const scopeSig = 'public.platform_billing_workspace_owner_scope()';
  const scopeDefinition = sql(`SELECT pg_get_functiondef('${scopeSig}'::regprocedure);`).replaceAll('\r\n', '\n');
  sql(scopeDefinition.replace('BEGIN\n', 'BEGIN\n  -- fixture source drift\n'));
  sql(candidate(), database, /original Billing scope drift/); sql(scopeDefinition);
  pass('original Billing authority source drift refuses installation/replay');
  sql(candidate()); assert.equal(metadata(), beforeMetadata);
  pass('exact original and private source restored by fixture; final idempotent replay passes');
  console.log(JSON.stringify({ scope: 'LOCAL NATIVE ONLY; minimal ports, preparing audit fixture; not E08 full transaction or hosted/customer proof', producer, baseline,
    cases: results.length, passed: true, candidateSha256: createHash('sha256').update(readFileSync(new URL('../proof/exp02-billing-recovery.sql', import.meta.url))).digest('hex') }));
} finally {
  if (created) sql(`DROP DATABASE ${database};`, 'postgres');
}
