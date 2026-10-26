// One mode of the original fenced synthetic-Postgres proof, not another runner.
// Real original E08 wrapper and E09 migration; pre-E08 catalogue is a local port.
export function requestShareCatalogueProof({sql,check,assert,fs,fixture,baseline=false}) {
 const file='supabase/migrations/20271114320009_e09_request_share_autonomy_catalogue.sql';
 const candidate=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
 const predecessorFile='supabase/migrations/20271114240108_exp08_team_hub_reply_catalogue.sql';
 const predecessor=fs.readFileSync(predecessorFile,'utf8').replaceAll('\r\n','\n');
 const f=fixture({staff:true});
 sql(`CREATE TABLE public.tenant_tool_autonomy(tenant_id uuid,tool_key text,mode text,updated_at timestamptz,PRIMARY KEY(tenant_id,tool_key));
 CREATE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
 RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE _tenant uuid;
 BEGIN
  IF auth.uid() IS NOT NULL THEN
   _tenant:=public.current_user_tenant_id();
   IF _tenant IS NULL THEN RAISE EXCEPTION 'No original active membership' USING ERRCODE='42501';END IF;
  ELSE _tenant:=_tenant_id;END IF;
  RETURN QUERY WITH c(tool_key,label,category) AS(VALUES('crm_log_activity','Log activity','Clients'),('team_hub_conversations','Read Team Hub','Team'))
   SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at FROM c
   LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
 END$$;`);
 sql(predecessor);
 const definition=sql("SELECT pg_get_functiondef('public.list_tool_autonomy(uuid)'::regprocedure)");
 const body=sql("SELECT prosrc FROM pg_proc WHERE oid='public.list_tool_autonomy(uuid)'::regprocedure");
 const read=(tenant=f.tenant,actor=f.actor,role='authenticated')=>{
  const output=sql(`BEGIN;SELECT set_config('test.actor','${actor}',true);SET LOCAL ROLE ${role};
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY tool_key),'[]'::jsonb) FROM public.list_tool_autonomy('${tenant}') t;ROLLBACK;`);
  return JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('[')));
 };
 const old=read(),businessBefore=sql('SELECT proof_snapshot()');
 check('Catalogue proof reconstructs the exact original E08 wrapper fingerprint',()=>assert.equal(sql("SELECT md5(pg_get_functiondef('public.list_tool_autonomy(uuid)'::regprocedure))"),'7b224b776dcd79d51f1216196351a1b8'));
 check('Unexpected original catalogue source refuses migration without overwriting it',()=>{
  const changed=definition.replace('BEGIN','BEGIN\n-- controlled unreviewed source\n');
  assert.notEqual(changed,definition);
  assert.throws(()=>sql('BEGIN;'+changed+';\n'+candidate+'\nROLLBACK;'),/Original autonomy catalogue changed/);
  assert.equal(sql("SELECT pg_get_functiondef('public.list_tool_autonomy(uuid)'::regprocedure)"),definition);
 });
 if(!baseline)sql(candidate);
 check('New request sharing appears exactly once and defaults to confirm',()=>{
  const rows=read().filter(x=>x.tool_key==='client_portal_request_share');
  assert.equal(rows.length,1);assert.equal(rows[0].mode,'confirm');assert.equal(rows[0].is_default,true);
 });
 if(baseline)return {baseline:true,source:file,originalWrapper:'real E08',predecessorCatalogue:'synthetic port',productionOperation:false};
 check('Every original catalogue row remains identical',()=>assert.deepEqual(read().filter(x=>x.tool_key!=='client_portal_request_share'),old));
 check('The original predecessor body is retained in full',()=>assert.equal(sql("SELECT prosrc FROM pg_proc WHERE oid='public._list_tool_autonomy_before_e09_request_share(uuid)'::regprocedure"),body));
 for(const mode of ['off','auto','confirm'])check(`Stored ${mode} mode remains the original metadata (HIGH clamp is separate)`,()=>{
  sql(`INSERT INTO tenant_tool_autonomy VALUES('${f.tenant}','client_portal_request_share','${mode}','2026-10-25T12:00:00Z') ON CONFLICT(tenant_id,tool_key) DO UPDATE SET mode=excluded.mode;`);
  const row=read().find(x=>x.tool_key==='client_portal_request_share');assert.equal(row.mode,mode);assert.equal(row.is_default,false);
 });
 check('A foreign tenant argument cannot select another business setting',()=>{
  sql(`UPDATE tenant_tool_autonomy SET mode='off' WHERE tenant_id='${f.tenant}';INSERT INTO tenant_tool_autonomy VALUES('${f.foreign}','client_portal_request_share','auto',now());`);
  assert.equal(read(f.foreign).find(x=>x.tool_key==='client_portal_request_share').mode,'off');
 });
 check('An anonymous caller cannot read the catalogue',()=>assert.throws(()=>read(f.tenant,'','anon'),/permission denied/));
 check('An unseated actor cannot gain catalogue access',()=>assert.throws(()=>read(f.tenant,f.other),/No original active membership/));
 check('The preserved predecessor is inaccessible to every API role',()=>{
  for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','public._list_tool_autonomy_before_e09_request_share(uuid)','EXECUTE')`),'f');
 });
 check('The public catalogue retains authenticated/service grants only',()=>{
  assert.equal(sql("SELECT has_function_privilege('anon','public.list_tool_autonomy(uuid)','EXECUTE')"),'f');
  for(const role of ['authenticated','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','public.list_tool_autonomy(uuid)','EXECUTE')`),'t');
 });
 check('Catalogue reads and metadata do not change customer business records',()=>assert.equal(sql('SELECT proof_snapshot()'),businessBefore));
 return {baseline:false,source:file,originalWrapper:'real E08',predecessorCatalogue:'synthetic port',productionOperation:false,sourceGuard:'exact original function definition',activation:'NONE'};
}
