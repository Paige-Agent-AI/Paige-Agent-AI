// Original Setup writer only. Generate an inert candidate; never apply remote DDL.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const read=p=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
export function originalSetupWriter() {
 const sql=read('supabase/migrations/20261046000000_solo_setup_persistence_repair.sql');
 const start=sql.indexOf('create or replace function public.save_solo_setup_context(');
 const end=sql.indexOf('\n$$;',start)+4;
 assert.ok(start>0&&end>start);
 return sql.slice(start,end);
}
export const functionBody=sql=>sql.split('\nas $$\n')[1].split('\n$$;')[0];
// prosrc includes the newline directly after and directly before the delimiter.
export const bodyHash=sql=>createHash('md5').update('\n'+functionBody(sql)+'\n').digest('hex');
const original=originalSetupWriter();
assert.equal(bodyHash(original),'d70cdc664b5c703395e4f077a30fdbd8','exact existing production writer');

const protectedRow=alias=>`(${alias}.owner_seat_vacant_since is not null
          or exists(select 1 from public.tenant_members seated
            where seated.tenant_id=v_tid and seated.business_owner_id=${alias}.id)
          or exists(select 1 from public.tenant_invite_tokens invitation
            where invitation.tenant_id=v_tid and invitation.business_owner_id=${alias}.id
              and invitation.default_role::text='owner' and invitation.kind not in ('consumer','agency_team')
              and invitation.revoked_at is null and invitation.business_owner_removed_at is null
              and invitation.uses=0 and (invitation.max_uses is null or invitation.max_uses>invitation.uses)
              and invitation.expires_at>clock_timestamp()))`;
const refusal=`raise exception '% holds an owner seat on the team, so it can''t be removed or changed here yet.',
          coalesce(nullif(btrim(v_existing_owner.display_name),''),v_existing_owner.legal_name)
          using errcode='42501',hint='OWNER_RECORD_SEATED';`;
const itemPoint="      if coalesce((v_item ->> 'deleteRequested')::boolean,false) then";
const itemGuard=`      -- E01 I2: original owner-row locks precede current seat/invitation inspection.
      if found and (coalesce((v_item ->> 'deleteRequested')::boolean,false)
          or v_existing_owner.owner_kind is distinct from v_kind
          or v_existing_owner.representative_user_id is distinct from v_rep)
        and ${protectedRow('v_existing_owner')} then
        ${refusal}
      end if;
`;
const omissionPoint='    if exists(\n      select 1 from public.tenant_business_owners bo\n      where bo.tenant_id=v_tid and not (bo.id=any(v_keep))';
const omissionGuard=`    -- E01 I2: omission is a deletion, even with an explicit source override.
    select bo.* into v_existing_owner from public.tenant_business_owners bo
    where bo.tenant_id=v_tid and not (bo.id=any(v_keep)) and ${protectedRow('bo')}
    order by bo.id limit 1;
    if found then
      ${refusal}
    end if;
`;
assert.equal(original.split(itemPoint).length,2);
assert.equal(original.split(omissionPoint).length,2);
export const guardedWriter=original.replace(itemPoint,itemGuard+itemPoint)
 .replace(omissionPoint,omissionGuard+omissionPoint);
assert.equal(guardedWriter.replace(itemGuard,'').replace(omissionGuard,''),original,
 'all existing CAS/private/provenance/Owner/Admin logic is byte-conserved');
const guardedHash=bodyHash(guardedWriter);
const metadataCheck=`pg_catalog.pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
   OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proretset
   OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.prokind<>'f'
   OR p.pronargs<>4 OR p.pronargdefaults<>3
   OR pg_catalog.pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM '''[]''::jsonb, NULL::text, NULL::uuid'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'jsonb'
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, vault']
   OR p.proargnames IS DISTINCT FROM ARRAY['_brief','_business_owners','_expected_updated_at','_proposal_id']
   OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL OR p.provariadic<>0
   OR (SELECT l.lanname FROM pg_catalog.pg_language l WHERE l.oid=p.prolang)<>'plpgsql'`;
export const candidate=`-- E01 I2: original Setup writer legal-owner protection; inert until normal ordered release.
BEGIN;
DO $exp01_owner_guard_install$
DECLARE p record; original_oid oid;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public.save_solo_setup_context(jsonb,jsonb,text,uuid)');
 IF NOT FOUND THEN RAISE EXCEPTION 'Original Setup writer unavailable' USING ERRCODE='23514'; END IF;
 IF ${metadataCheck}
   OR pg_catalog.md5(p.prosrc) NOT IN ('d70cdc664b5c703395e4f077a30fdbd8','${guardedHash}') THEN
  RAISE EXCEPTION 'Original Setup writer source or authority changed; reconcile before applying' USING ERRCODE='23514';
 END IF;
 original_oid:=p.oid;
 EXECUTE $exp01_writer_definition$${guardedWriter}$exp01_writer_definition$;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=original_oid;
 IF NOT FOUND OR ${metadataCheck}
   OR pg_catalog.md5(p.prosrc) IS DISTINCT FROM '${guardedHash}' THEN
  RAISE EXCEPTION 'Setup owner guard installation did not preserve original identity/authority' USING ERRCODE='23514';
 END IF;
END $exp01_owner_guard_install$;
COMMIT;
`;
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const path='scripts/proof/exp01-setup-owner-guard-candidate.sql';
 if(process.argv.includes('--check'))assert.equal(read(path),candidate,'owner guard candidate is exact generated source');
 else writeFileSync(path,candidate);
 console.log(JSON.stringify({result:'PASS',originalBody:'d70cdc664b5c703395e4f077a30fdbd8',guardedBody:guardedHash,
  insertions:2,allOutsideWriterInsertions:'EXACT',state:'INERT_CANDIDATE',path}));
}
