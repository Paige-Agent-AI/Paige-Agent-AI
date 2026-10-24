import assert from 'node:assert/strict';
export function provePreparationEditability({sql,read,context,tenant,fresh,quote,applyMigration}){
 let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
 const identity="public.read_paige_agreement_preparation(uuid,uuid)";
 const meta=()=>JSON.parse(sql(`SELECT jsonb_build_object('body',md5(prosrc),'owner',pg_get_userbyid(proowner),'acl',proacl::text,'config',proconfig,'volatility',provolatile,'definer',prosecdef,'defaults',pronargdefaults,'args',pg_get_function_identity_arguments(oid),'returns',prorettype::regtype::text) FROM pg_proc WHERE oid='${identity}'::regprocedure;`));
 const before=meta();check(before.body==='a3950836bd7b886838da885bfd799fa0','Exact current production reader body reproduced');
 const current=source=>JSON.parse(sql(context+`SELECT read_paige_agreement_preparation('${tenant}','${source.id}');`));
 const source=fresh(),initial=current(source);check(initial.agreement.id===source.id&&initial.agreement.contact_id===source.contact_id,'Actual original source/client read');
 check(initial.agreement.status==='draft'&&initial.agreement.can_edit===true,'Actual unfrozen Draft is editable');
 check(initial.agreement.content_sha256===null&&initial.agreement.sealed_sha256===null,'Positive source is genuinely unfrozen');
 check(!('content_storage_key' in initial.agreement)&&!('sealed_storage_key' in initial.agreement),'Private object paths remain outside closed projection');
 const shape=Object.keys(initial.agreement).sort().join(',');
 if(applyMigration){
  const migration=read('supabase/migrations/20271113260004_agreement_preparation_editability.sql');sql(migration);sql(migration);
  const after=meta();check(after.body!==before.body,'Original projection repaired');delete before.body;delete after.body;check(JSON.stringify(before)===JSON.stringify(after),'Original owner/ACL/search_path/STABLE/DEFINER/defaults/arguments/return preserved');
  check(current(source).agreement.can_edit===true,'Ordinary original draft still editable after replay');
 }
 console.log(JSON.stringify({editabilityPositiveControls:checks,mode:applyMigration?'repaired':'baseline'}));
 // A sealed-object reference can exist before its digest is retained. Existing
 // native writers already refuse it; the original closed read must agree.
 for(const [column,value]of [['sealed_storage_key',`${tenant}/synthetic-retained.pdf`],['content_storage_key',`${tenant}/synthetic-content.pdf`],['sealed_sha256','a'.repeat(64)],['content_sha256','b'.repeat(64)]]){
  const row=fresh();sql(`UPDATE paige_agreements SET ${column}=${quote(value)} WHERE id='${row.id}';`);
  const result=current(row);check(result.agreement.can_edit===false,`Retained ${column} must project noneditable`);check(Object.keys(result.agreement).sort().join(',')===shape,'Closed original agreement shape preserved');
 }
 const uploaded=fresh();sql(`UPDATE paige_agreements SET body_source='tenant_upload',body_markdown=NULL,document_path=${quote(`${tenant}/synthetic-unretained.pdf`)} WHERE id='${uploaded.id}';`);check(current(uploaded).agreement.can_edit===true,'Original unretained uploaded source remains preparable');
 const immutable=fresh();sql(`UPDATE paige_agreements SET status='sent',content_sha256='${'c'.repeat(64)}' WHERE id='${immutable.id}';`);check(current(immutable).agreement.can_edit===false,'Original valid frozen sent source remains noneditable');
 const refused=(prefix,expectedTenant=tenant)=>{assert.throws(()=>sql(prefix+`SELECT read_paige_agreement_preparation('${expectedTenant}','${source.id}');`),/Agreement workspace or authority unavailable/);checks++;};
 refused(context+"SET test.admin='false';");refused(context+"SET test.uid='';");refused(context,'aaaaaaaa-0000-4000-8000-000000000002');
 const stamp=()=>sql(`SELECT jsonb_build_object('version',version,'updated_at',updated_at,'body',body_markdown,'events',(SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${source.id}')) FROM paige_agreements WHERE id='${source.id}';`);
 const recorded=stamp();current(source);current(source);check(stamp()===recorded,'Projection reads do not alter source, version, words or events');
 const definition=sql(`SELECT pg_get_functiondef('${identity}'::regprocedure);`);
 sql(definition.replace('BEGIN','BEGIN\n -- Deliberate different reader source in disposable proof.'));
 assert.throws(()=>sql(read('supabase/migrations/20271113260004_agreement_preparation_editability.sql')),/Original agreement preparation reader changed; reconcile before applying/);checks++;sql(definition);
 return {checks,migrationReplay:2,authority:'original reader metadata and floor preserved',scope:'Original closed editability only; synthetic fixture is not customer acceptance'};
}
