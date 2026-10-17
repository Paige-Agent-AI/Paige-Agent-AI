// Extends the existing isolated native sharing proof; no hosted identity/content.
import {createHash,randomUUID} from 'node:crypto';
export function resourceReadProof({sql,check,assert,fs,root,path,uid,other,tenant,foreign,contact}){
 const owner='e091a000-0000-4000-8000-000000000001',doc='e094a000-0000-4000-8000-000000000003';
 const peer='e091a000-0000-4000-8000-000000000006';
 const text='A'.repeat(11999)+'😀'+'B'.repeat(13000);
 const json=value=>`$json$${JSON.stringify(value)}$json$::jsonb`;
 // The real canonical table also has a source column. Preserve that shape so
 // PL/pgSQL name collisions fail locally as well as in full-schema replay.
 sql("ALTER TABLE public.tenant_knowledge_docs ADD COLUMN source text NOT NULL DEFAULT 'text';");
 const as=(query,actor=uid,role='authenticated')=>{
  const result=sql(`BEGIN; SELECT set_config('test.actor','${actor??''}',true);SET LOCAL ROLE ${role};${query};COMMIT;`);
  const value=result.split(/\r?\n/).find(s=>s.startsWith('{'));return value?JSON.parse(value):result;
 };
 sql(`UPDATE tenant_knowledge_docs SET content=${json(text)}#>>'{}',source_url='https://private.example.test/internal',
  metadata='{"private":"PRIVATE_RESOURCE_METADATA"}',extraction_input='PRIVATE_RESOURCE_EXTRACTION' WHERE id='${doc}';`);
 const proposal=as(`SELECT prepare_client_portal_knowledge_share('${tenant}','${contact}','${doc}');`,owner);
 const saved=as(`SELECT set_client_portal_knowledge_share('${tenant}','${contact}','${doc}',true,
  ${proposal.expected_share_revision},'${proposal.proposal_hash}','${randomUUID()}');`,owner);
 const fingerprint=sql(`SELECT source_fingerprint FROM tenant_knowledge_client_shares WHERE id='${saved.share_id}';`);
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20271108232000_e09_customer_resource_read.sql'),'utf8');
 check('Full resource read refuses a changed source-authority lease before creating its RPC',()=>{
  assert.throws(()=>sql(migration.replace('13a90bbbf1cfbd20c944c7a116e7f418','0'.repeat(32))),/resource authority changed/);
  assert.equal(sql("SELECT to_regprocedure('public.client_portal_knowledge_document(uuid,uuid,integer,text,integer,integer)') IS NULL;"),'t');
 });
 sql(migration);
 const read=(offset=0,limit=12000,actor=uid,business=tenant,revision=saved.current_revision,hash=fingerprint,role='authenticated')=>
  as(`SELECT client_portal_knowledge_document('${business}','${saved.share_id}',${revision},'${hash}',${offset??'NULL'},${limit??'NULL'});`,actor,role);
 check('The real canonical source-column shape catches an unqualified resource variable',()=>{
  const replace=migration.replace('CREATE FUNCTION public.client_portal_knowledge_document','CREATE OR REPLACE FUNCTION public.client_portal_knowledge_document');
  sql(replace.replace('resource_read.source->>','source->>'));
  try{assert.throws(()=>read(),/column reference "source" is ambiguous/);}
  finally{sql(replace);}
 });
 const first=read(),second=read(first.next_offset),third=read(second.next_offset);
 check('Authorized resource pages return the complete canonical text without splitting Unicode or inventing a complete excerpt',()=>{
  assert.equal(first.actor_id,uid);assert.equal(first.contact_id,contact);assert.equal(first.tenant_id,tenant);
  assert.equal(first.document.id,doc);assert.equal(first.source_ref.share_id,saved.share_id);
  assert.equal(first.next_offset,12000);assert(first.content.endsWith('😀'));
  assert.equal(first.total_characters,25000);assert.equal(first.has_more,true);assert.equal(second.has_more,true);assert.equal(third.has_more,false);
  assert.equal(first.content+second.content+third.content,text);assert.equal(third.next_offset,25000);
 });
 check('The full reader returns a closed source, pagination and identity projection without private document metadata',()=>{
  assert.deepEqual(Object.keys(first).sort(),['actor_id','contact_id','tenant_id','source_ref','document','content','offset','next_offset','total_characters','has_more'].sort());
  assert.deepEqual(Object.keys(first.document).sort(),['id','revision','generation_id','title'].sort());
  assert(!JSON.stringify(first).includes('PRIVATE_RESOURCE'));assert(!JSON.stringify(first).includes('private.example.test'));
 });
 for(const [label,actor,business]of[['same-business other customer',peer,tenant],['foreign customer',other,tenant],['wrong business',uid,foreign],['unlinked owner identity',owner,tenant]])
  check('Full resource rejects '+label+' even with the exact known grant and fingerprint',()=>assert.throws(()=>read(0,12000,actor,business)));
 for(const [label,offset,limit]of[['negative offset',-1,12000],['missing offset',null,12000],['empty chunk',0,0],['missing limit',0,null],['oversized chunk',0,12001],['beyond end',25001,12000]])
  check('Resource range rejects '+label,()=>assert.throws(()=>read(offset,limit),/CUSTOMER_RESOURCE_(ARGUMENTS|RANGE)_INVALID/));
 check('Exact EOF is an honest empty final page and a returning read uses the same canonical state',()=>{
  const eof=read(25000);assert.equal(eof.content,'');assert.equal(eof.next_offset,25000);assert.equal(eof.has_more,false);assert.deepEqual(read(),first);
 });
 check('Stale source revision and fingerprint cannot obtain resource text',()=>{
  assert.throws(()=>read(0,12000,uid,tenant,saved.current_revision+1));assert.throws(()=>read(0,12000,uid,tenant,saved.current_revision,'0'.repeat(64)));
 });
 for(const role of ['anon','service_role'])check(role+' cannot execute the full customer resource reader',()=>{
  assert.equal(sql(`SELECT has_function_privilege('${role}','public.client_portal_knowledge_document(uuid,uuid,integer,text,integer,integer)','EXECUTE');`),'f');
  assert.throws(()=>read(0,12000,uid,tenant,saved.current_revision,fingerprint,role));
 });
 check('A changed canonical source retires every subsequent resource chunk',()=>{
  sql(`UPDATE tenant_knowledge_docs SET content='Changed source' WHERE id='${doc}';`);
  try{assert.throws(()=>read(first.next_offset))}finally{sql(`UPDATE tenant_knowledge_docs SET content=${json(text)}#>>'{}' WHERE id='${doc}';`)}
 });
 const withdraw=as(`SELECT prepare_client_portal_knowledge_share('${tenant}','${contact}','${doc}',false);`,owner);
 as(`SELECT set_client_portal_knowledge_share('${tenant}','${contact}','${doc}',false,
  ${withdraw.expected_share_revision},'${withdraw.proposal_hash}','${randomUUID()}');`,owner);
 check('Explicit source withdrawal denies reload and continuation without deleting canonical content',()=>{
  assert.throws(()=>read());assert.throws(()=>read(first.next_offset));assert.equal(sql(`SELECT char_length(content) FROM tenant_knowledge_docs WHERE id='${doc}';`),'25000');
 });
 return{resourceReadMigrationSHA256:createHash('sha256').update(migration).digest('hex'),resourceReadProof:'isolated actual native authority with synthetic metadata; no production resource view, customer session, provider or engagement receipt'};
}
