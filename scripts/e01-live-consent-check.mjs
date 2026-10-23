/** EXP01 consent repair — the Live acknowledgement gate + per-account status read,
 * proven against a real local PostgreSQL. Rollback-only: fixture schema + shims + the
 * REAL predicate-defining migrations (tier, rollout, open-to-solo) + the REAL new
 * migration, then the cases in supabase/tests/e01_live_consent.sql.
 * Mirrors scripts/e01-interview-resume-check.mjs. */
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;if(!url)throw Error('INT336_DATABASE_URL required');const parsed=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!/^\/int336_test/.test(parsed.pathname))throw Error('isolated localhost fixture required');
const root=path.resolve(import.meta.dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const stripTx=p=>p.replace(/^begin;\r?$/mg,'').replace(/^commit;\r?$/mg,'');
const shims=`
create schema if not exists auth;
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role()returns text language sql stable as $$select coalesce(current_setting('request.jwt.claim.role',true),'authenticated')$$;
create function public.current_user_tenant_id()returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
-- The REAL tier predicate (live_conversation_tier_allows) is defined by an earlier
-- migration whose readiness-envelope chain this fixture does not carry; reproduce its
-- exact body verbatim (20270422000000 / prod-verified definition).
create function public.live_conversation_tier_allows(_tenant_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $tier$
  SELECT COALESCE((
    SELECT t.parent_tenant_id IS NULL
       AND coalesce(t.account_type, 'standalone') NOT IN ('agency', 'sub_account')
      FROM public.tenants t
     WHERE t.id = _tenant_id
  ), false);
$tier$;
`;
const fixtureSchema=`
create table public.tenants(id uuid primary key, account_type text default 'standalone', parent_tenant_id uuid, status text default 'active', archived_at timestamptz, lifecycle_execution_paused boolean default false, features jsonb default '{}'::jsonb);
create table public.tenant_members(tenant_id uuid, user_id uuid, role text, status text, is_owner boolean default false);
create table public.paige_live_tenant_availability(tenant_id uuid primary key, enabled boolean not null default false, updated_at timestamptz not null default now());
create table public.paige_live_pilot_subjects(user_id uuid, tenant_id uuid, admitted_by uuid, admitted_at timestamptz, revoked_at timestamptz, expires_at timestamptz, accepted_default_provider_retention boolean default false, accepted_procedural_single_speaker boolean default false, acceptance_actor_user_id uuid, updated_at timestamptz default now(), primary key(user_id,tenant_id));
`;
const roles=['anon','authenticated','service_role'].map(r=>`do $$begin if not exists(select 1 from pg_roles where rolname='${r}')then create role ${r} nologin;end if;end$$;`).join('');
const sql=`begin;${roles}${fixtureSchema}${shims}
-- The FINAL pre-existing predicate rewrite (no enablement ceremony) defines the
-- predicate standalone; the earlier readiness-envelope chain it superseded is not
-- needed for this fixture, exactly as production's own chain ends up here.
${stripTx(read('supabase/migrations/20270425000000_live_is_open_to_solo_no_enablement_ceremony.sql'))}
${stripTx(read('supabase/migrations/20271113600000_live_acknowledgement_before_audio.sql'))}
${read('supabase/tests/e01_live_consent.sql')}
rollback;`;
const result=spawnSync(process.env.PSQL_BIN??'psql',['-X','-v','ON_ERROR_STOP=1',url],{input:sql,encoding:'utf8',timeout:60000,windowsHide:true});
if(result.status!==0){console.error(result.stderr);process.exit(1)}
const passes=(result.stdout+'\n'+result.stderr).split('\n').filter(l=>l.includes('LIVE_CONSENT_PROOF')&&!l.includes(' FAIL '));
const fails=(result.stdout+'\n'+result.stderr).split('\n').filter(l=>l.includes('LIVE_CONSENT_PROOF')&&l.includes(' FAIL '));
if(fails.length){console.error(fails.join('\n'));process.exit(1)}
if(passes.length<10)throw Error(`expected 10 passing LIVE_CONSENT_PROOF lines, saw ${passes.length}`);
console.log(passes.join('\n'));
console.log('PASS e01 live consent gate: unacknowledged refused, acknowledged admitted, revoked/expired refused, kill switch and tier still refuse, service-role only, status RPC tells this account its own truth, execute grants authenticated-only');
