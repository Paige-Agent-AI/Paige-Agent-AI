import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readReviewedDeliveryEvidence} from '../../supabase/functions/_shared/client-engagement/reviewed-delivery.ts';

/** Actual private projection and original signing/effectuation fixture. Work
 * table shapes use the inspected canonical columns, with synthetic rows only.
 * This does NOT execute canonical Work writers, full-schema RPC or customer JWTs.
 */
export function proveReviewedDelivery({sql,read,quote,tenant,c,prepared}){
 let checks=0;const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
 const json=q=>JSON.parse(sql(q)),client=prepared.payload.source.client_id;
 const effective=json(`SELECT _sales_client_effective_terms('${tenant}','${client}','${c.terms}');`);
 equal(effective.state,'verified','Original native signing/effectuation evidence is present, not stubbed');
 const scope={tenantId:tenant,clientId:client,termsId:c.terms,signingId:effective.signing_id,
  signingVersion:effective.signing_version,contentSha256:effective.document_sha256,sealedSha256:effective.sealed_sha256};
 const id=n=>`e4770000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const plan=id(1),work=id(2),work2=id(3),submission=id(4),artifact=id(5),release=id(6),staff=id(7),reviewer=id(8),customer=id(9);
 for(const table of ['plans','plan_items','studio_artifact_versions','operations_delivery_submissions','operations_delivery_client_releases','audit_logs'])
  equal(sql(`SELECT to_regclass('public.${table}') IS NULL;`),'t','Unique native fixture owns no existing Work table: '+table);
 equal(sql(`SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto';`),
  'public','Original disposable signing fixture retains its real pgcrypto namespace');
 // Production uses extensions.pgcrypto; retain the fixture's ORIGINAL public
 // installation and delegate to its real digest rather than moving or stubbing it.
 sql(`CREATE SCHEMA extensions;
 CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT SET search_path=''
  AS 'SELECT public.digest($1,$2)';
 CREATE TABLE public.plans(id uuid PRIMARY KEY,tenant_id uuid,status text,metadata jsonb);
 CREATE TABLE public.plan_items(id uuid PRIMARY KEY,tenant_id uuid,plan_id uuid,contact_id uuid,item_type text,status text,title text,summary text,metadata jsonb);
 CREATE TABLE public.studio_artifact_versions(id uuid PRIMARY KEY,tenant_id uuid,kind text,snapshot jsonb);
 CREATE TABLE public.operations_delivery_submissions(id uuid PRIMARY KEY,tenant_id uuid,plan_id uuid,work_item_id uuid,client_id uuid,
  artifact_version_id uuid,artifact_digest text,revision_no integer,submitted_by uuid,submitted_at timestamptz,
  reviewer_user_id uuid,state text,reviewed_by uuid,reviewed_at timestamptz,review_mode text);
 CREATE TABLE public.operations_delivery_client_releases(id uuid PRIMARY KEY,submission_id uuid,tenant_id uuid,client_id uuid,client_user_id uuid,
  released_by uuid,released_at timestamptz,state text,decision_by uuid,decision_at timestamptz,client_note text);
 CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,entity text,action text,entity_id uuid,data jsonb);`);
 const migration=read('supabase/migrations/20271121131404_e04_reviewed_delivery_projection.sql');
 sql(migration);
 const signature='public._sales_client_reviewed_delivery(uuid,uuid,uuid)';
 const meta=()=>json(`SELECT jsonb_build_object('oid',oid,'body',md5(prosrc),'owner',proowner,'acl',proacl::text,'definer',prosecdef,'path',proconfig,'volatility',provolatile)
  FROM pg_proc WHERE oid='${signature}'::regprocedure;`);
 const originalMeta=meta();sql(migration);equal(meta(),originalMeta,'Whole projection migration replays exactly');
 equal([originalMeta.definer,originalMeta.volatility,originalMeta.path],[false,'s',['search_path=""']],'Private stable invoker has no ambient path or definer authority');
 const guard=migration.slice(migration.indexOf('DO $guard$'),migration.indexOf('CREATE OR REPLACE FUNCTION'));
 for(const patch of [`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`,`ALTER FUNCTION ${signature} SECURITY DEFINER;`,
  `ALTER FUNCTION ${signature} SET search_path=public;`,`GRANT EXECUTE ON FUNCTION public._sales_client_effective_terms(uuid,uuid,uuid) TO service_role;`]){
  assert.throws(()=>sql('BEGIN;'+patch+guard+'ROLLBACK;'),/23514:[\s\S]*changed/);checks++;
 }
 equal(meta(),originalMeta,'Failed guards leave original identity and private authority intact');
 const readback=migration.slice(migration.indexOf('DO $readback$'),migration.lastIndexOf('COMMIT;'));
 assert.throws(()=>sql(`BEGIN;GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`+readback+'ROLLBACK;'),/23514:[\s\S]*changed/);checks++;
 for(const role of ['anon','authenticated','service_role']){
  equal(sql(`SELECT has_function_privilege('${role}','${signature}','EXECUTE');`),'f','No private RPC grant: '+role);
  assert.throws(()=>sql(`SET ROLE ${role};SELECT _sales_client_reviewed_delivery('${tenant}','${client}','${c.terms}');`),/42501:|permission denied/);checks++;
 }
 const projection=(patch='',t=tenant,who=client,terms=c.terms)=>json(`BEGIN;SET LOCAL session_replication_role=replica;${patch}
  SELECT coalesce(_sales_client_reviewed_delivery('${t}','${who}','${terms}'),'null'::jsonb);ROLLBACK;`);
 const parsed=patch=>readReviewedDeliveryEvidence(projection(patch),scope);
 equal(projection().state,'not_linked','No reviewed handoff is never zero completed work');
 for(const [t,who,terms]of [[randomUUID(),client,c.terms],[tenant,randomUUID(),c.terms],[tenant,client,randomUUID()]])
  equal(projection('',t,who,terms),null,'Foreign or absent original commercial scope returns no evidence');
 const metadata={operations_engagement:{agreement_id:effective.signing_id,commercial_terms_id:c.terms,contact_id:client,
  offer_id:effective.offer_id,version:effective.signing_version,content_sha256:effective.document_sha256,sealed_sha256:effective.sealed_sha256,
  milestone_ids:[work,work2],scope_draft:{scope_origin:'owner_reviewed',milestones:[{title:'Discovery report',summary:null},{title:'Final recommendations',summary:'Reviewed scope'}]}}};
 const wm=JSON.stringify({operations_engagement:{agreement_id:effective.signing_id,commercial_terms_id:c.terms,version:effective.signing_version}});
 sql(`INSERT INTO plans VALUES('${plan}','${tenant}','active',${quote(JSON.stringify(metadata))}::jsonb);
 INSERT INTO plan_items VALUES('${work}','${tenant}','${plan}','${client}','milestone','done','Discovery report',NULL,${quote(wm)}::jsonb),
 ('${work2}','${tenant}','${plan}','${client}','milestone','done','Final recommendations','Reviewed scope',${quote(wm)}::jsonb);`);
 equal(parsed('').accepted,0,'All Work marked done with no delivery submission gives zero accepted milestones');
 equal(parsed('').items.map(x=>x.phase),['not_submitted','not_submitted'],'Missing submissions stay explicit');
 sql(`INSERT INTO studio_artifact_versions VALUES('${artifact}','${tenant}','content','{"kind":"text","title":"Report","body":"Reviewed work"}');
 INSERT INTO operations_delivery_submissions VALUES('${submission}','${tenant}','${plan}','${work}','${client}','${artifact}',
  (SELECT encode(extensions.digest(snapshot::text,'sha256'),'hex') FROM studio_artifact_versions WHERE id='${artifact}'),
  1,'${staff}','2026-10-20T10:00Z','${reviewer}','in_review',NULL,NULL,'second_person');`);
 equal(parsed('').items[0].phase,'internal_review','Submission is not staff approval or client acceptance');
 sql(`UPDATE operations_delivery_submissions SET state='approved',reviewed_by='${reviewer}',reviewed_at='2026-10-20T11:00Z';
 INSERT INTO audit_logs(user_id,entity,action,entity_id,data) VALUES('${reviewer}','operations_delivery','delivery_reviewed','${submission}',
  jsonb_build_object('tenant_id','${tenant}','state','approved','revision_no',1));`);
 equal(parsed('').items[0].phase,'not_released','Staff approval is not client release');
 sql(`INSERT INTO operations_delivery_client_releases VALUES('${release}','${submission}','${tenant}','${client}','${customer}',
  '${staff}','2026-10-20T12:00Z','awaiting_client',NULL,NULL,NULL);
 INSERT INTO audit_logs(user_id,entity,action,entity_id,data) VALUES('${staff}','operations_delivery','delivery_released','${submission}',
  jsonb_build_object('tenant_id','${tenant}','release_id','${release}'));`);
 equal(parsed('').items[0].phase,'awaiting_client','Release awaits a separate actual client decision');
 sql(`UPDATE operations_delivery_client_releases SET state='accepted',decision_by='${customer}',decision_at='2026-10-20T13:00Z';
 INSERT INTO audit_logs(user_id,entity,action,entity_id,data) SELECT '${customer}','operations_delivery','delivery_client_decision','${submission}',
  jsonb_build_object('tenant_id','${tenant}','release_id','${release}','state','accepted','artifact_digest',artifact_digest)
  FROM operations_delivery_submissions WHERE id='${submission}';`);
 equal(parsed('').accepted,1,'Only the exact released version and supported client decision count');
 equal(parsed('').state,'in_progress','One accepted milestone cannot hide a second missing submission');
 const changes=[
  [`UPDATE plans SET metadata=jsonb_set(metadata,'{operations_engagement,version}','999');`,'scope_changed'],
  [`UPDATE plans SET metadata=jsonb_set(metadata,'{operations_engagement,contact_id}',to_jsonb('${randomUUID()}'::text));`,'scope_changed'],
  [`UPDATE plans SET status='archived';`,'scope_changed'],
  [`UPDATE plans SET metadata=jsonb_set(metadata,'{operations_engagement,milestone_ids}','[]');`,'unavailable'],
  [`UPDATE plans SET metadata=jsonb_set(metadata,'{operations_engagement,milestone_ids}',jsonb_build_array('${work}','${work}'));`,'unavailable'],
  [`UPDATE plans SET metadata=jsonb_set(metadata,'{operations_engagement,milestone_ids}','[{}]');`,'unavailable'],
  [`UPDATE plans SET metadata=jsonb_set(metadata,'{operations_engagement,scope_draft,milestones}','[]');`,'unavailable'],
  [`UPDATE plan_items SET contact_id='${randomUUID()}' WHERE id='${work}';`,'scope_changed'],
  [`UPDATE plan_items SET tenant_id='${randomUUID()}' WHERE id='${work}';`,'scope_changed'],
  [`UPDATE plan_items SET status='cancelled' WHERE id='${work}';`,'scope_changed'],
  [`UPDATE plan_items SET title='Different services' WHERE id='${work}';`,'scope_changed'],
  [`UPDATE plan_items SET summary='Changed scope' WHERE id='${work}';`,'scope_changed'],
  [`DELETE FROM plan_items WHERE id='${work}';`,'scope_changed'],
  [`INSERT INTO plan_items SELECT '${id(40)}',tenant_id,plan_id,contact_id,item_type,status,title,summary,metadata FROM plan_items WHERE id='${work}';`,'scope_changed'],
  [`UPDATE operations_delivery_submissions SET client_id='${randomUUID()}';`,'unavailable'],
  [`UPDATE operations_delivery_submissions SET tenant_id='${randomUUID()}';`,'unavailable'],
  [`UPDATE operations_delivery_submissions SET plan_id='${randomUUID()}';`,'unavailable'],
  [`UPDATE operations_delivery_submissions SET artifact_digest=repeat('f',64);`,'unavailable'],
  [`UPDATE operations_delivery_submissions SET reviewed_by='${randomUUID()}';`,'unavailable'],
  [`UPDATE operations_delivery_submissions SET review_mode='owner_self_review';`,'unavailable'],
  [`DELETE FROM audit_logs WHERE action='delivery_reviewed';`,'unavailable'],
  [`DELETE FROM audit_logs WHERE action='delivery_released';`,'unavailable'],
  [`DELETE FROM audit_logs WHERE action='delivery_client_decision';`,'unavailable'],
  [`UPDATE operations_delivery_client_releases SET tenant_id='${randomUUID()}';`,'unavailable'],
  [`UPDATE operations_delivery_client_releases SET client_id='${randomUUID()}';`,'unavailable'],
  [`UPDATE operations_delivery_client_releases SET decision_by='${staff}';`,'unavailable'],
  [`UPDATE operations_delivery_client_releases SET decision_at=NULL;`,'unavailable'],
  [`UPDATE operations_delivery_client_releases SET decision_at='2026-10-19T00:00Z';`,'unavailable'],
  [`UPDATE studio_artifact_versions SET snapshot='{"kind":"text","title":"Changed","body":"Different content"}';`,'unavailable'],
  [`DELETE FROM studio_artifact_versions;`,'unavailable'],
 ];
 for(const [patch,state]of changes){equal(parsed(patch).state,state,'Broken source withholds acceptance: '+patch);equal(parsed(patch).accepted,null,'Broken source is not zero/accepted');}
 const newer=`INSERT INTO operations_delivery_submissions SELECT '${id(20)}',tenant_id,plan_id,work_item_id,client_id,artifact_version_id,artifact_digest,
  2,submitted_by,submitted_at,reviewer_user_id,'in_review',NULL,NULL,review_mode FROM operations_delivery_submissions WHERE id='${submission}';`;
 equal(parsed(newer).items[0].phase,'internal_review','Newer unapproved version cannot inherit historical acceptance');
 equal(parsed(newer+`UPDATE operations_delivery_submissions SET tenant_id='${randomUUID()}' WHERE id='${id(20)}';`).state,'unavailable','Malformed newer foreign revision cannot be filtered away');
 equal(parsed(newer.replace('2,submitted_by','1,submitted_by')).state,'unavailable','Ambiguous latest revision cannot choose an accepted row');
 const revision=`UPDATE operations_delivery_client_releases SET state='client_revision_requested',client_note='Please revise';
  UPDATE audit_logs SET data=jsonb_set(data,'{state}','"client_revision_requested"') WHERE action='delivery_client_decision';`;
 equal(parsed(revision).items[0].phase,'revision_requested','Client requested revision is distinct from acceptance');
 equal(parsed(revision+`UPDATE operations_delivery_client_releases SET client_note=' ';`).state,'unavailable','Unsupported revision decision is withheld');
 const internal=`DELETE FROM operations_delivery_client_releases;
  UPDATE operations_delivery_submissions SET state='revision_requested';
  UPDATE audit_logs SET data=jsonb_set(data,'{state}','"revision_requested"') WHERE action='delivery_reviewed';`;
 equal(parsed(internal).state,'revision_requested','Staff-requested revision is not silently labelled waiting for review');
 equal(parsed(internal).items[0].phase,'internal_revision_requested','Original staff decision stays separate from client revision');
 equal(Date.parse(parsed(internal).items[0].decisionAt),Date.parse('2026-10-20T11:00:00Z'),'Staff decision retains its actual review instant across session-zone spelling');
 const owner=`UPDATE operations_delivery_submissions SET reviewer_user_id=submitted_by,reviewed_by=submitted_by,review_mode='owner_self_review';
  UPDATE audit_logs SET user_id='${staff}' WHERE action='delivery_reviewed';`;
 equal(parsed(owner).accepted,1,'Original owner-reviewed mode is consumed without inventing client acceptance');
 equal(parsed(owner+`DELETE FROM operations_delivery_client_releases;`).accepted,0,'Owner review alone cannot accept deliverables');
 const all=`INSERT INTO operations_delivery_submissions SELECT '${id(30)}',tenant_id,plan_id,'${work2}',client_id,artifact_version_id,artifact_digest,revision_no,
  submitted_by,submitted_at,reviewer_user_id,state,reviewed_by,reviewed_at,review_mode FROM operations_delivery_submissions WHERE id='${submission}';
  INSERT INTO operations_delivery_client_releases SELECT '${id(31)}','${id(30)}',tenant_id,client_id,client_user_id,released_by,released_at,state,decision_by,decision_at,client_note FROM operations_delivery_client_releases;
  INSERT INTO audit_logs(user_id,entity,action,entity_id,data) SELECT user_id,entity,action,'${id(30)}',
   CASE WHEN data ? 'release_id' THEN jsonb_set(data,'{release_id}',to_jsonb('${id(31)}'::text)) ELSE data END FROM audit_logs;`;
 equal(parsed(all).state,'accepted','All bounded original milestones can have supported exact-version client decisions');
 equal(parsed(all).engagementCompletion,'not_determined','Even all tracked acceptance never auto-closes commercial/service obligations');
 const counts=()=>json(`SELECT jsonb_build_object('work',(SELECT count(*) FROM plan_items),'submissions',(SELECT count(*) FROM operations_delivery_submissions),
  'releases',(SELECT count(*) FROM operations_delivery_client_releases),'audit',(SELECT count(*) FROM audit_logs),
  'operations',(SELECT count(*) FROM paige_sales_collection_operations),'rail',(SELECT count(*) FROM paige_workspace_events));`);
 const before=counts();projection();projection();equal(counts(),before,'Projection creates no work, delivery, audit, operation or Rail record');
 console.log(JSON.stringify({checkpoint:'C77 native delivery controls before malformed reviewed wording',checks}));
 equal(parsed(`UPDATE plans SET metadata=jsonb_set(metadata,'{operations_engagement,scope_draft,milestones,0,title}','""');
  UPDATE plan_items SET title='' WHERE id='${work}';`).state,'scope_changed','An empty description of promised work cannot retain accepted progress');
 equal(parsed(`UPDATE plans SET metadata=jsonb_set(metadata,'{operations_engagement,scope_draft,milestones,0,summary}','{"x":1}');
  UPDATE plan_items SET summary='{"x": 1}' WHERE id='${work}';`).state,'scope_changed','Malformed reviewed summary cannot match stringified current Work');
 return {checks,migrationReplay:2,scope:'Actual private SQL and original signing/effectuation fixture; synthetic Work table shapes/records only. No canonical Work-writer, complete-schema RPC, customer JWT, hosted byte/provider/UI or customer-acceptance proof.'};
}
