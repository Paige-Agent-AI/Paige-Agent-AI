import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

/** Original fenced native signing/effectuation fixture only. This exercises the
 * actual private read against genuine native fixture operations and audit rows.
 * This flag requires the directory-fenced local cluster's stock postgres owner.
 * It applies the complete migration and exact metadata guards; full-schema RPC
 * success and hosted role/customer proof remain separately owed.
 */
export function proveEffectiveClientRead({sql,read,tenant,c,prepared}){
 let checks=0;
 const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
 const json=q=>JSON.parse(sql(q));
 const path='supabase/migrations/20271118100004_e04_client_effective_terms_read.sql';
 const migration=read(path),start=migration.indexOf('CREATE OR REPLACE FUNCTION public._sales_client_effective_terms(');
 assert(start>0);checks++;
 equal(sql('SELECT current_user;'),'postgres','Complete guard proof uses the canonical stock local schema owner');
 const source=read('supabase/migrations/20271110030000_e09_customer_portal_progress.sql');
 const at=source.indexOf('CREATE OR REPLACE FUNCTION public.read_client_engagement_status('),open=source.indexOf('AS $$',at),close=source.indexOf('$$;',open+5),body=source.slice(open+5,close);
 const publicSignature='public.read_client_engagement_status(uuid,uuid)';
 equal(sql(`SELECT to_regprocedure('${publicSignature}') IS NULL;`),'t','Unique original signing fixture has no pre-existing status reader to overwrite');
 sql(source.slice(at,close+3)+`\nREVOKE ALL ON FUNCTION ${publicSignature} FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION ${publicSignature} TO authenticated;`);
 // Normalize psql's Windows transport newline only. The migration and the
 // assertions below still pin native md5(prosrc), not a normalized server body.
 const publicDefinition=()=>sql(`SELECT pg_get_functiondef('${publicSignature}'::regprocedure);`).replaceAll('\r\n','\n');
 const publicBefore=publicDefinition();
 const publicMeta=()=>json(`SELECT jsonb_build_object('oid',oid,'acl',proacl::text,'owner',proowner,'definer',prosecdef,'volatility',provolatile,'path',proconfig)
  FROM pg_proc WHERE oid='${publicSignature}'::regprocedure;`);
 const publicMetadata=publicMeta();
 sql(migration);
 const signature='public._sales_client_effective_terms(uuid,uuid,uuid)';
 const meta=()=>json(`SELECT jsonb_build_object('oid',oid,'body',md5(prosrc),'acl',proacl::text,'owner',proowner,'definer',prosecdef,'volatility',provolatile,'path',proconfig)
  FROM pg_proc WHERE oid='${signature}'::regprocedure;`);
 const beforeMeta=meta(),publicAfter=publicDefinition();
 sql(migration);equal(meta(),beforeMeta,'Complete migration replays without changing private read identity or authority');
 equal(publicMeta(),publicMetadata,'Whole original public OID/owner/ACL/definer/path/volatility preserved');
 equal(publicDefinition(),publicAfter,'Complete original public projection replays exactly');
 const guard=migration.slice(migration.indexOf('DO $guard$'),start);
 for(const patch of [
  `ALTER FUNCTION ${publicSignature} STABLE;`,
  `ALTER FUNCTION ${publicSignature} SET search_path=public;`,
  `GRANT EXECUTE ON FUNCTION ${publicSignature} TO anon;`,
  `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`,
  'ALTER FUNCTION public._paige_accepted_commercial_payload(public.paige_agreements) SECURITY DEFINER;',
  'ALTER FUNCTION public._paige_retained_commercial_payload(public.paige_agreements) SET search_path=public;',
 ]){
  assert.throws(()=>sql('BEGIN;'+patch+guard+'ROLLBACK;'),/23514:.*changed|23514:[\s\S]*changed/);checks++;
 }
 equal(meta(),beforeMeta,'Guard refusals leave no private grant or metadata change');
 equal(publicMeta(),publicMetadata,'Guard refusals leave no public authority change');
 equal(beforeMeta.body,'2d0bb3db63603ffe58b66b492ffc37ef','Exact private projection body is tested');
 equal([beforeMeta.definer,beforeMeta.volatility,beforeMeta.path],[false,'s',['search_path=""']],'Private read has no definer/ambient path or write volatility');
 equal(json(`SELECT jsonb_build_array(has_function_privilege('anon','${signature}','EXECUTE'),has_function_privilege('authenticated','${signature}','EXECUTE'),has_function_privilege('service_role','${signature}','EXECUTE'));`),[false,false,false],'No client or server caller gains a private execution grant');
 for(const role of ['anon','authenticated','service_role']){
  assert.throws(()=>sql(`SET ROLE ${role};SELECT _sales_client_effective_terms('${tenant}','${prepared.payload.source.client_id}','${c.terms}');`),/42501:|permission denied/);checks++;
 }
 const client=prepared.payload.source.client_id;
 const readSnapshot=(patch='',t=tenant,who=client,id=c.terms)=>json(`BEGIN;SET LOCAL session_replication_role=replica;${patch}
  SELECT coalesce(_sales_client_effective_terms('${t}','${who}','${id}'),'null'::jsonb);ROLLBACK;`);
 const counts=()=>json(`SELECT jsonb_build_object('operations',(SELECT count(*) FROM paige_sales_collection_operations),
  'rail',(SELECT count(*) FROM paige_workspace_events),'signers',(SELECT count(*) FROM paige_agreement_signers),
  'events',(SELECT count(*) FROM paige_agreement_events),'invoices',(SELECT count(*) FROM paige_invoices),
  'payments',(SELECT count(*) FROM paige_invoice_payments));`);
 const before=counts(),original=readSnapshot();
 equal(original.state,'verified','Complete original signed/effectuated evidence can be read');
 equal(original.principal_minor,prepared.payload.principal_minor,'Principal comes from the immutable accepted payload');
 equal(original.collection_terms,prepared.payload.collection_terms,'Schedule comes from the immutable accepted payload');
 equal(original.terms_version,prepared.payload.source.terms_version,'Accepted revision is explicit');
 equal(original.signing_id,c.p.source.agreement_id,'Original signing identity is retained');
 equal(original.offer_id,prepared.payload.source.offer_id,'Original offer identity is explicit');
 equal(original.invoice_id,prepared.payload.source.invoice_id,'Original invoice identity is retained');
 equal(original.working_differs,false,'Unchanged working economics do not invent an amendment');
 equal(sql(`SELECT status FROM tenant_client_agreements WHERE id='${c.terms}';`),'paused','The incumbent effectuation proof leaves a later manual pause');
 equal(readSnapshot(),original,'Historical effectuation read does not reactivate paused terms');
 const zoneRead=readSnapshot("SET LOCAL TIME ZONE 'America/Los_Angeles';");
 equal(zoneRead.state,'verified','Session-zone spelling does not invalidate the same original effectuation instant');
 equal(Date.parse(zoneRead.effectuated_at),Date.parse(original.effectuated_at),'Original effectuation instant is preserved across session zones');
 for(const [t,who,id]of [[randomUUID(),client,c.terms],[tenant,randomUUID(),c.terms],[tenant,client,randomUUID()]])
  equal(readSnapshot('',t,who,id),null,'Foreign/missing original relationship does not expose a snapshot');
 const missing=readSnapshot(`UPDATE tenant_client_agreements SET effective_signing_id=NULL,effective_terms_version=NULL,
  effective_at=NULL,effective_operation_id=NULL,effective_source_digest=NULL WHERE id='${c.terms}';`);
 equal(missing.state,'not_recorded','Absent original provenance is not inferred from a signed-looking status');
 equal(Object.hasOwn(missing,'principal_minor'),false,'No unverified accepted amount is returned');
 const later=readSnapshot(`UPDATE tenant_client_agreements SET collection_terms_version=collection_terms_version+1,
  agreed_amount_minor=agreed_amount_minor+10000,agreed_currency='eur',starts_on=starts_on+30,
  collection_terms=jsonb_set(collection_terms,'{total_cents}','123456') WHERE id='${c.terms}';`);
 equal(later.state,'verified','A later working change does not erase original historical evidence');
 equal(later.working_differs,true,'Working change is explicit');
 equal(later.principal_minor,original.principal_minor,'Later proposed principal never replaces accepted economics');
 equal(later.currency,original.currency,'Later proposed currency never replaces accepted economics');
 equal(later.collection_terms,original.collection_terms,'Later proposed dates/amounts never replace the accepted schedule');
 const bad=[
  `UPDATE tenant_client_agreements SET collection_terms_version=0 WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET contact_id='c2222222-0000-4000-8000-000000000002' WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET offer_id='${randomUUID()}' WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET effective_operation_id='${randomUUID()}' WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET effective_source_digest=repeat('f',64) WHERE id='${c.terms}';`,
  `UPDATE tenant_client_agreements SET effective_at=effective_at+interval '1 second' WHERE id='${c.terms}';`,
  `UPDATE paige_agreements SET status='voided' WHERE id='${original.signing_id}';`,
  `UPDATE paige_agreements SET sealed_sha256=repeat('e',64) WHERE id='${original.signing_id}';`,
  `UPDATE paige_agreement_signers SET status='viewed' WHERE agreement_id='${original.signing_id}';`,
  `DELETE FROM paige_agreement_events WHERE agreement_id='${original.signing_id}' AND event_type='consented';`,
  `DELETE FROM paige_agreement_events WHERE agreement_id='${original.signing_id}' AND event_type='sealed';`,
  `DELETE FROM paige_workspace_events WHERE id='${original.receipt_id}';`,
  `UPDATE paige_workspace_events SET actor_id='${randomUUID()}' WHERE id='${original.receipt_id}';`,
  `UPDATE paige_workspace_events SET detail=detail-'origin' WHERE id='${original.receipt_id}';`,
  `UPDATE paige_sales_collection_operations SET result=jsonb_set(result,'{row,effective_at}','"2000-01-01T00:00:00+00:00"') WHERE id='${original.operation_id}';`,
  `UPDATE paige_sales_collection_operations SET result=jsonb_set(result,'{row,effective_at}','"2026-02-31T00:00:00+00:00"') WHERE id='${original.operation_id}';`,
  `UPDATE paige_sales_collection_operations SET result=jsonb_set(result,'{row,effective_at}','"2026-01-01T00:00:00"') WHERE id='${original.operation_id}';`,
  `UPDATE paige_sales_collection_operations SET command=jsonb_set(command,'{invoice_id}',to_jsonb('${randomUUID()}'::text)) WHERE id='${original.operation_id}';`,
  `UPDATE paige_sales_collection_operations SET actor_user_id='${randomUUID()}' WHERE id='${original.operation_id}';`,
 ];
 for(const patch of bad){
  const got=readSnapshot(patch);
  equal(got?.state??null,/SET contact_id/.test(patch)?null:'unverified','Altered original evidence cannot verify the snapshot: '+patch);
  if(got)equal(Object.hasOwn(got,'principal_minor'),false,'Broken evidence returns no claimed accepted economics');
 }
 equal(counts(),before,'Pure original reads create no operations, Rail, signers, audit events, invoice or payment');
 // Verify the exact additive public-reader transformation and inverse, including
 // original E09 Work share/version fields and all caller/role/size/bounds checks.
 const md5=value=>createHash('md5').update(value).digest('hex');
 const anchor="'collection_terms',p.collection_terms,'collection_terms_version',p.collection_terms_version,",
  replacement=anchor+"\n    'effective_terms',public._sales_client_effective_terms(_expected_tenant_id,_contact_id,p.id),";
 const gapAnchor="  -- Facts the platform does not record yet are declared, never inferred as zero.\n  'not_recorded',jsonb_build_array('payment_disputes','provider_refunds','terms_effective_transition','installment_allocation'),",
  gapReplacement="  -- Gaps in this projection are declared, never inferred as zero.\n  'not_recorded',jsonb_build_array('payment_disputes','provider_refunds','installment_allocation'),";
 equal(md5(body),'401d2de2a7dd91192da36b242b12041d','Original full source body matches deployed contract');
 equal(body.split(anchor).length,2,'Exactly one additive source projection anchor');
 equal(body.split(gapAnchor).length,2,'Exactly one obsolete global-gap declaration anchor');
 const transformed=body.replace(anchor,replacement).replace(gapAnchor,gapReplacement);
 equal(md5(transformed),'4680297b25322dca36b44dbaaf528a39','Expected full-reader successor hash');
 equal(transformed.includes('terms_effective_transition'),false,'Per-record effective evidence replaces the obsolete global absence claim');
 equal(transformed.replace(replacement,anchor).replace(gapReplacement,gapAnchor),body,'Whole inverse preserves original scope, E09 fields and every other source byte');
 equal(publicAfter.replace(replacement,anchor).replace(gapReplacement,gapAnchor),publicBefore,'Actual installed public reader inverse preserves every other original byte');
 return {checks,migration:path,projectionBody:beforeMeta.body,fullMigrationGuard:'PASS: complete source migration/replay and metadata negatives on canonical local owner',
  fullSchemaRpc:'PROOF_OWED: complete canonical schema and hosted owner/role read',
  scope:'Original native signing/effectuation/operation/Rail fixture; synthetic identity and file metadata only, no hosted role/byte/signing/payment/customer acceptance'};
}
