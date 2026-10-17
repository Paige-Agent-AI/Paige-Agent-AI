// Extends the existing disposable invitation harness; never connects to hosted data.
import {createHash} from 'node:crypto';
import {catalogueDeclarations,preservesCataloguePredecessor} from '../ci/tool-catalogue-lint.mjs';
export function invitationCatalogueProof({sql,check,assert,fs,path,root,ids,lit}){
 const file='supabase/migrations/20271108235000_e09_invitation_tool_catalogue.sql',migration=fs.readFileSync(path.join(root,file),'utf8');
 const declarations=catalogueDeclarations().filter(d=>d.file<file.split('/').at(-1));
 const start=declarations.findLastIndex(d=>!preservesCataloguePredecessor(d.sql));assert(start>=0);
 // Resolver/table infrastructure only; complete real catalogue bodies and their authority checks below.
 sql(`CREATE TABLE tenant_tool_autonomy(tenant_id uuid,tool_key text,mode text,updated_at timestamptz,PRIMARY KEY(tenant_id,tool_key));
 CREATE FUNCTION current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT tenant_id FROM tenant_members WHERE user_id=auth.uid() AND status='active' ORDER BY tenant_id LIMIT 1$$;`);
 for(const declaration of declarations.slice(start)){
  const text=declaration.sql,fn=text.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.list_tool_autonomy\s*\([\s\S]+?\bAS\s+(\$[a-z_0-9]*\$)[\s\S]+?\1\s*;/i);assert(fn);
  let rename='';if(preservesCataloguePredecessor(text)){const at=text.search(/ALTER\s+FUNCTION\s+public\.list_tool_autonomy/i),begin=text.slice(0,at).lastIndexOf('DO $$'),end=text.indexOf('END $$;',at);assert(begin>=0&&end>=0);rename=text.slice(begin,end+7)}
  const acl=[...text.matchAll(/(?:REVOKE|GRANT)[^;]*ON\s+FUNCTION\s+public\.(?:list_tool_autonomy|_list_tool_autonomy_[a-z0-9_]+)\(uuid\)[^;]*;/gi)].map(m=>m[0]).join('\n');
  sql(rename+'\n'+fn[0]+'\n'+acl);
 }
 const read=(tenant=ids.ta,actor=ids.a,role='authenticated')=>JSON.parse(sql(`BEGIN;SELECT set_config('test.actor',${lit(actor)},true);SET LOCAL ROLE ${role};SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.tool_key),'[]') FROM list_tool_autonomy('${tenant}')c;ROLLBACK;`).split(/\r?\n/).find(l=>l.startsWith('[')));
 const before=read(),body=sql("SELECT prosrc FROM pg_proc WHERE oid='list_tool_autonomy(uuid)'::regprocedure");
 sql(migration);const once=sql("SELECT pg_get_functiondef('list_tool_autonomy(uuid)'::regprocedure)");sql(migration);
 check('Catalogue migration replays without recursion or body drift',()=>assert.equal(sql("SELECT pg_get_functiondef('list_tool_autonomy(uuid)'::regprocedure)"),once));
 check('Catalogue predecessor body is byte-preserved',()=>assert.equal(sql("SELECT prosrc FROM pg_proc WHERE oid='_list_tool_autonomy_before_customer_invitation(uuid)'::regprocedure"),body));
 check('Every real incumbent catalogue row survives with identical metadata',()=>{assert(before.length>100);assert.deepEqual(read().filter(r=>r.tool_key!=='client_portal_invitation_send'),before)});
 const row=()=>read().find(r=>r.tool_key==='client_portal_invitation_send');
 check('Exactly one new invitation control defaults to confirm',()=>{assert.equal(read().length,before.length+1);assert.equal(row().mode,'confirm');assert.equal(row().is_default,true)});
 check('Invitation uses the existing Communications category',()=>assert.equal(row().category,'Communications'));
 check('Catalogue wrong business remains refused by incumbent',()=>assert.throws(()=>read(ids.tb),/42501/));
 check('Anonymous catalogue execution remains denied',()=>assert.throws(()=>read(ids.ta,'','anon'),/42501/));
 for(const role of ['anon','authenticated','service_role'])check('Predecessor stays internal for '+role,()=>assert.equal(sql(`SELECT has_function_privilege('${role}','_list_tool_autonomy_before_customer_invitation(uuid)','EXECUTE')`),'f'));
 check('Catalogue reads do not write settings',()=>assert.equal(sql('SELECT count(*) FROM tenant_tool_autonomy'),'0'));
 sql(`INSERT INTO tenant_tool_autonomy VALUES('${ids.ta}','client_portal_invitation_send','off',now())`);
 check('Existing off setting is visible unchanged',()=>{assert.equal(row().mode,'off');assert.equal(row().is_default,false)});
 check('Another business never inherits the off setting',()=>assert.equal(read(ids.tb,ids.b).find(r=>r.tool_key==='client_portal_invitation_send').mode,'confirm'));
 return {file,migrationSHA256:createHash('sha256').update(migration).digest('hex'),incumbentRows:before.length,resolver:'synthetic current-user membership resolver; actual catalogue bodies and authority checks',managedSupabase:'UNVERIFIED'};
}
