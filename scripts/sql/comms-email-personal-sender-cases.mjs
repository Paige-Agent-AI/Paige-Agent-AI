// Focused cases for the incumbent email PostgreSQL proof. No cluster bootstrap,
// provider, alternate writer or credentials: the parent verifies its disposable
// data_directory and supplies the same sessions/roles/assertion runner.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const source = name => readFileSync(new URL(name, migrations), 'utf8');
function nativeFunction(file, name) {
  const match = source(file).match(new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\([\\s\\S]*?\\$\\$;', 'i'));
  assert.ok(match, 'existing native function ' + name);
  return match[0];
}
export function installPersonalSenderProof({ sql, baseline }) {
  // Fixture-only row types for the current native function's optional reply-
  // approval branch. This campaign exercises the unlinked one-to-one command;
  // full-schema/linked lead-reply proof remains the incumbent separate campaign.
  sql(`ALTER TABLE public.channel_connectors
    ADD mailbox_class text NOT NULL DEFAULT 'shared_support',
    ADD mailbox_owner_user_id uuid REFERENCES auth.users(id);
    CREATE TABLE public.tenant_email_domains(tenant_id uuid,domain text,sendgrid_status text,sendgrid_domain_id text,sendgrid_verified_at timestamptz);
    CREATE TABLE public.paige_pending_approvals(id uuid,tenant_id uuid,contact_id uuid,status text,metadata jsonb);
    CREATE TABLE public.paige_actions(id uuid,tenant_id uuid,contact_id uuid,approval_id uuid,action_kind text);`);
  for (const name of ['_comms_email_sendgrid_sender_verified','prepare_comms_email_send','read_comms_email_send_binding']) {
    sql(nativeFunction('20271031000100_paige_email_sendgrid_governed_door.sql', name));
  }
  if (!baseline) {
    const migration = source('20271109040000_personal_email_sender_authority.sql');
    sql(migration); sql(migration); // compatible CREATE OR REPLACE replay, no data rewrite.
  }
  console.log(baseline ? 'Personal sender: incumbent pre-repair functions (expected refusal failures).' : 'Personal sender: current native40000 applied twice.');
}

export function registerPersonalSenderCases({ scenario, sql, asService, prepareCall, selectResult, session, waitFor, q, A, op }) {
  const other = 'f0000000-0328-4000-8000-00000000000c';
  const connector = 'c0000000-0328-4000-8000-00000000000c';
  const from = 'private@example.invalid';
  sql(`INSERT INTO auth.users(id,email)VALUES(${q(other)},'personal-proof@example.invalid');
    INSERT INTO public.profiles(user_id,active_tenant_id)VALUES(${q(other)},${q(A.tenant)});
    INSERT INTO public.tenant_members(tenant_id,user_id,role,status)VALUES(${q(A.tenant)},${q(other)},'admin','active');
    INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_address,status,active,mailbox_class,mailbox_owner_user_id)
      VALUES(${q(connector)},${q(A.tenant)},'email','gmail',${q(from)},'active',true,'personal',${q(A.actor)});`);
  const prepare = (n, extra = {}) => prepareCall({ op: op(n), connector, from, subject: 'Personal authority ' + n, ...extra });
  const message = n => sql(`SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=${q(op(n))}`);
  const read = n => JSON.parse(asService(`SELECT public.read_comms_email_send_binding(${q(message(n))})::text;`));
  const claim = n => JSON.parse(asService(`SELECT public.claim_comms_email_send(${q(message(n))},${q(op(n))},false)::text;`));
  const setOwner = owner => sql(`UPDATE public.channel_connectors SET mailbox_owner_user_id=${owner ? q(owner) : 'NULL'} WHERE id=${q(connector)}`);
  const untouched = n => {
    assert.equal(sql(`SELECT meta#>>'{comms_email_binding,attempts}' FROM public.messages WHERE id=${q(message(n))}`), '0');
    assert.equal(sql(`SELECT count(*) FROM public.paige_workspace_events WHERE source_id=${q(op(n))}`), '0');
  };
  scenario('(personal-own) original owner prepares, claims and records one canonical receipt', async () => {
    asService('SELECT ' + prepare(401) + ';'); assert.equal(read(401).eligible, true);
    assert.equal(claim(401).admitted, true);
    asService(`SELECT public.finalize_comms_email_send(${q(message(401))},${q(op(401))},'provider_accepted','synthetic-no-provider',NULL,1);`);
    assert.equal(sql(`SELECT count(*) FROM public.paige_workspace_events WHERE source_id=${q(op(401))} AND outcome='capability_succeeded'`), '1');
  });
  scenario('(personal-other) same-tenant admin cannot prepare another person\'s sender', async () => {
    const result = await session('SET ROLE service_role;' + selectResult(prepare(402, { actor: other })));
    assert.equal(result.sqlstate, '40001'); assert.equal(result.message, 'COMMS_EMAIL_SENDER_CHANGED');
    assert.equal(sql(`SELECT count(*) FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=${q(op(402))}`), '0');
  });
  scenario('(personal-missing) missing owner is not a shared/company sender', async () => {
    setOwner(null);
    try { const result = await session('SET ROLE service_role;' + selectResult(prepare(403))); assert.equal(result.message, 'COMMS_EMAIL_SENDER_CHANGED'); }
    finally { setOwner(A.actor); }
  });
  scenario('(personal-drift) changed owner invalidates prepared eligibility and claim without receipt', async () => {
    asService('SELECT ' + prepare(404) + ';'); setOwner(other);
    try { assert.equal(read(404).eligible, false); assert.equal(claim(404).admitted, false); untouched(404); }
    finally { setOwner(A.actor); }
  });
  scenario('(personal-revoked) disabled connector cannot be admitted after preparation', async () => {
    asService('SELECT ' + prepare(405) + ';'); sql(`UPDATE public.channel_connectors SET active=false,status='disabled' WHERE id=${q(connector)}`);
    try { assert.equal(read(405).eligible, false); assert.equal(claim(405).admitted, false); untouched(405); }
    finally { sql(`UPDATE public.channel_connectors SET active=true,status='active' WHERE id=${q(connector)}`); }
  });
  scenario('(personal-authority) wrong role, inactive seat and changed workspace remain refused', async () => {
    for (const [change, restore] of [
      [`UPDATE public.tenant_members SET role='member' WHERE user_id=${q(A.actor)}`, `UPDATE public.tenant_members SET role='owner' WHERE user_id=${q(A.actor)}`],
      [`UPDATE public.tenant_members SET status='inactive' WHERE user_id=${q(A.actor)}`, `UPDATE public.tenant_members SET status='active' WHERE user_id=${q(A.actor)}`],
      [`UPDATE public.profiles SET active_tenant_id=NULL WHERE user_id=${q(A.actor)}`, `UPDATE public.profiles SET active_tenant_id=${q(A.tenant)} WHERE user_id=${q(A.actor)}`],
    ]) {
      sql(change);
      try { const result = await session('SET ROLE service_role;' + selectResult(prepare(406))); assert.equal(result.sqlstate, '42501'); }
      finally { sql(restore); }
    }
  });
  scenario('(company-control) ordinary admin retains company sending; no global app role is seeded', async () => {
    const result = JSON.parse(asService('SELECT ' + prepareCall({ op: op(407), actor: other, subject: 'Company control' }) + '::text;'));
    assert.equal(result.ok, true); assert.equal(result.state, 'prepared');
  });
  scenario('(personal-acl) authenticated/anonymous cannot call service-only native writer/readback', async () => {
    for (const role of ['authenticated','anon']) for (const call of [prepare(408), `public.read_comms_email_send_binding(${q(message(401))})`]) {
      const result = await session(`SET ROLE ${role};SELECT ${call};`); assert.equal(result.sqlstate, '42501');
    }
  });
  scenario('(personal-lock) ownership change serializes behind native binding share lock', async () => {
    asService('SELECT ' + prepare(409) + ';');
    const held = session(`BEGIN;SET ROLE service_role;SELECT public.read_comms_email_send_binding(${q(message(409))});SELECT pg_sleep(1);COMMIT;`, 'comms_email_owner_hold');
    await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='comms_email_owner_hold' AND query LIKE 'SELECT pg_sleep%';", '1', 'native sender read holding its transaction');
    const update = await session(`SET lock_timeout='75ms';UPDATE public.channel_connectors SET mailbox_owner_user_id=${q(other)} WHERE id=${q(connector)};`);
    const holder = await held;
    assert.equal(holder.code, 0); assert.equal(update.sqlstate, '55P03');
    untouched(409);
  });
}
