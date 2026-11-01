// Local-only foundation proof, NOT an authenticated recovery or production runner.
// Real: current original actor/own-read policies, native PostgreSQL RLS/ACL/DDL/trigger.
// Ports: minimal audit table/Auth identity plus an explicitly permissive overlapping
// client policy. The owner write is a fixture, not the missing recovery RPC.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';

assert.equal(process.env.EXP08_DISPOSABLE,'1','Explicit local disposable opt-in required');
assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST),'Loopback only');
assert.match(process.env.PGPORT??'',/^\d+$/,'Explicit owned local port required');
const db=new OperatorPostgresFixture(Number(process.env.PGPORT));
const candidate=readFileSync(new URL('./exp08-owner-recovery-provenance.sql',import.meta.url),'utf8');
const source=name=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
function policy(file,name){const s=source(file),a=s.indexOf('CREATE POLICY "'+name+'"');
 assert(a>=0);const b=s.indexOf(';',a);assert(b>a);return s.slice(a,b+1);}
const actor='e8000000-0000-4000-8000-000000090001',tenant='e8000000-0000-4000-8000-000000090010';
const legacy='e8000000-0000-4000-8000-000000090100',recovery='e8000000-0000-4000-8000-000000090101';
const results=[];
const root=()=>{db.role='';db.actor='';};
const client=()=>{db.role='authenticated';db.actor=actor;};
const scalar=q=>db.run(q).split('\n').at(-1);
const rows=()=>{root();return scalar('SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),\'[]\') FROM public.paige_audit_log a');};
const descriptor=()=>{root();return scalar(`SELECT jsonb_build_object('table',(SELECT row_to_json(x) FROM
 (SELECT oid,relowner,relacl,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.paige_audit_log'::regclass)x),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE polrelid='public.paige_audit_log'::regclass),
 'trigger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.tgname) FROM pg_trigger t WHERE tgrelid='public.paige_audit_log'::regclass),
 'function',(SELECT to_jsonb(p) FROM pg_proc p WHERE oid=to_regprocedure('public.guard_owner_recovery_audit_truncate()')))`);};
async function refuse(label,fn,pattern=/EXP08 recovery provenance|OWNER_RECOVERY_AUDIT_RETAINED|row-level security|permission denied/){
 await assert.rejects(fn,pattern,label);results.push({case:label,passed:true});}
const insert=(id,action)=>`INSERT INTO public.paige_audit_log(id,actor_user_id,actor_role,tenant_id,action,payload)
 VALUES('${id}','${actor}','super_admin','${tenant}','${action}','{"port":"synthetic"}')`;
try{
 await db.exec(`DO $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
 END$$;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA auth TO authenticated,anon;
 CREATE TABLE public.paige_audit_log(id uuid PRIMARY KEY,actor_user_id uuid,actor_role text,tenant_id uuid,
  action text NOT NULL,payload jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
 ALTER TABLE public.paige_audit_log ENABLE ROW LEVEL SECURITY;
 GRANT ALL ON public.paige_audit_log TO anon,authenticated,service_role;
 ${policy('20270513000000_operator_act_as_reads_solo_setup.sql','Actors record their own actions')}
 ${policy('20261027000000_an_audit_row_belongs_to_its_tenant.sql','Read own audit rows')}
 -- Explicit stronger permissive port: restrictive protection must survive other allows.
 CREATE POLICY fixture_overlapping_client_permission ON public.paige_audit_log FOR ALL TO authenticated
  USING(actor_user_id=auth.uid()) WITH CHECK(actor_user_id=auth.uid());`);
 client();await db.exec(insert(recovery,'tenant:owner_recovery.grant_owner'));
 assert.equal(scalar(`SELECT count(*) FROM public.paige_audit_log WHERE id='${recovery}'`),'1');
 results.push({case:'baseline client-authored recovery-looking audit is not native evidence',passed:true});
 root();const before=descriptor(),beforeRows=rows();
 await refuse('first installation refuses an existing untrusted recovery-looking row',()=>db.exec(candidate));
 assert.equal(descriptor(),before);assert.equal(rows(),beforeRows);
 await db.exec(`DELETE FROM public.paige_audit_log WHERE id='${recovery}'`); // Synthetic fixture only.
 await db.exec(insert(legacy,'team.member_profile_changed'));
 const unchangedRows=rows();await db.exec(candidate);assert.equal(rows(),unchangedRows);
 const installed=descriptor();await db.exec(candidate);assert.equal(descriptor(),installed);assert.equal(rows(),unchangedRows);
 results.push({case:'first apply and exact replay conserve original rows and complete boundary metadata',passed:true});

 client();await refuse('client cannot fabricate recovery prefix',()=>db.exec(insert(recovery,'tenant:owner_recovery.grant_owner')));
 await refuse('client cannot rename a legacy row into recovery',()=>db.exec(`UPDATE public.paige_audit_log SET action='tenant:owner_recovery.set_account_holder' WHERE id='${legacy}'`));
 await db.exec(`UPDATE public.paige_audit_log SET payload='{"legacy":"still permitted"}' WHERE id='${legacy}'`);
 assert.equal(scalar(`SELECT payload->>'legacy' FROM public.paige_audit_log WHERE id='${legacy}'`),'still permitted');
 await db.exec(`DELETE FROM public.paige_audit_log WHERE id='${legacy}'`);
 assert.equal(scalar('SELECT count(*) FROM public.paige_audit_log'),'0');
 await db.exec(insert(legacy,'team.member_profile_changed'));await db.exec('TRUNCATE public.paige_audit_log');
 assert.equal(scalar('SELECT count(*) FROM public.paige_audit_log'),'0');
 results.push({case:'unrelated fixture writes remain permitted with original actor/read policies and explicit overlapping allow port',passed:true});

 root();await db.exec(insert(recovery,'tenant:owner_recovery.grant_owner'));
 const nativeRows=rows();const nativeMetadata=descriptor();await db.exec(candidate);
 assert.equal(rows(),nativeRows);assert.equal(descriptor(),nativeMetadata);
 results.push({case:'protected server fixture record survives replay; not proof of authorized recovery execution',passed:true});
 client();assert.equal(scalar(`SELECT count(*) FROM public.paige_audit_log WHERE id='${recovery}'`),'0');
 await db.exec(`UPDATE public.paige_audit_log SET action='team.changed',payload='{}' WHERE id='${recovery}'`);
 await db.exec(`DELETE FROM public.paige_audit_log WHERE id='${recovery}'`);
 await refuse('client truncate cannot erase protected records',()=>db.exec('TRUNCATE public.paige_audit_log'));
 await refuse('client cannot execute the private trigger guard',()=>db.exec('SELECT public.guard_owner_recovery_audit_truncate()'));
 assert.equal(rows(),nativeRows);
 results.push({case:'protected private row invisible and unchanged under client update/delete',passed:true});

 root();await db.exec('ALTER POLICY exp08_owner_recovery_native_rows ON public.paige_audit_log USING(true) WITH CHECK(true)');
 const drift=descriptor(),driftRows=rows();await refuse('weakened policy is refused rather than repaired',()=>db.exec(candidate));
 assert.equal(descriptor(),drift);assert.equal(rows(),driftRows);
 await db.exec(`DROP POLICY exp08_owner_recovery_native_rows ON public.paige_audit_log;
 CREATE POLICY exp08_owner_recovery_native_rows ON public.paige_audit_log AS RESTRICTIVE FOR ALL TO anon,authenticated
  USING(NOT pg_catalog.starts_with(action,'tenant:owner_recovery.')) WITH CHECK(NOT pg_catalog.starts_with(action,'tenant:owner_recovery.'));`);
 await db.exec('ALTER TABLE public.paige_audit_log DISABLE TRIGGER trg_owner_recovery_audit_truncate');
 await refuse('disabled truncate guard refused',()=>db.exec(candidate));
 await db.exec('ALTER TABLE public.paige_audit_log ENABLE TRIGGER trg_owner_recovery_audit_truncate');
 await db.exec('GRANT EXECUTE ON FUNCTION public.guard_owner_recovery_audit_truncate() TO authenticated');
 await refuse('private function exposure refused',()=>db.exec(candidate));
 await db.exec('REVOKE EXECUTE ON FUNCTION public.guard_owner_recovery_audit_truncate() FROM authenticated');
 await db.exec('REVOKE EXECUTE ON FUNCTION public.guard_owner_recovery_audit_truncate() FROM postgres');
 await refuse('missing owner execute refused',()=>db.exec(candidate));
 await db.exec('GRANT EXECUTE ON FUNCTION public.guard_owner_recovery_audit_truncate() TO postgres');
 await db.exec(candidate);assert.equal(rows(),nativeRows);
 // Retain the original fourteen controls above before extending the boundary proof.
 client();await refuse('caller-set recovery flag is not provenance',()=>db.exec(`SET paige.owner_recovery='on';
  ${insert('e8000000-0000-4000-8000-000000090102','tenant:owner_recovery.set_account_holder')}`));
 root();await db.exec('DROP TRIGGER trg_owner_recovery_audit_truncate ON public.paige_audit_log');
 const partial=descriptor();await refuse('partial boundary refuses without repairing or changing records',()=>db.exec(candidate));
 assert.equal(descriptor(),partial);assert.equal(rows(),nativeRows);
 await db.exec(`CREATE TRIGGER trg_owner_recovery_audit_truncate BEFORE TRUNCATE ON public.paige_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_owner_recovery_audit_truncate()`);
 const definition=JSON.parse(scalar(`SELECT to_json(pg_get_functiondef('public.guard_owner_recovery_audit_truncate()'::regprocedure))`));
 await db.exec(`CREATE OR REPLACE FUNCTION public.guard_owner_recovery_audit_truncate() RETURNS trigger
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$BEGIN RETURN NULL; END;$$`);
 const altered=descriptor();await refuse('changed guard body refuses without overwriting incoming source',()=>db.exec(candidate));
 assert.equal(descriptor(),altered);assert.equal(rows(),nativeRows);
 await db.exec(definition);await db.exec(candidate);assert.equal(rows(),nativeRows);
 console.log(JSON.stringify({scope:'LOCAL native provenance foundation ONLY; recovery RPC/private receipt/notice not implemented',
  ports:'Minimal Auth/table and overlapping client permission; privileged record insertion is a fixture, not an authorized act',
  candidateSha256:createHash('sha256').update(candidate).digest('hex'),cases:results},null,2));
}finally{
 root();assert.match(db.database,/^operator_account_lifecycle_proof_\d+_\d+$/);
 db.run(`DROP DATABASE ${db.database}`,[],'postgres');
 console.log('Disposed only the local recovery provenance database created by this run.');
}
