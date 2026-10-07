// Real disposable localhost PostgreSQL; synthetic caller/Trust identity fixtures only.
import {readFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const binary='C:/Program Files/PostgreSQL/16/bin/',root=new URL('../../work/',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),cluster=root+'merchant-catalogue-pg-'+randomUUID(),port='56480';
const command=(exe,args,input='',quiet=false)=>{const p=spawnSync(binary+exe,args,{input,encoding:'utf8',windowsHide:true,stdio:quiet?'ignore':undefined,timeout:30000});if(p.status!==0)throw Error(p.stderr||`${exe} exit ${p.status}`);return p.stdout?.trim()??'';};
const run=sql=>command('psql.exe',['-h','127.0.0.1','-p',port,'-U','catalogue_proof','-d','postgres','-v','ON_ERROR_STOP=1','-At'],sql);
const read=name=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
const fn=src=>{const start=src.indexOf('CREATE OR REPLACE FUNCTION public.list_tool_autonomy('),end=src.indexOf('$$;',start);assert(start>=0&&end>start);return src.slice(start,end+3);};
const tenant=randomUUID(),other=randomUUID(),actor=randomUUID();let checks=0,started=false;
const eq=(sql,want)=>{assert.equal(run(sql).split('\n').at(-1),want);checks++;};
const deny=sql=>{assert.throws(()=>run(sql),/permission denied|AUTONOMY_FORBIDDEN/);checks++;};
mkdirSync(cluster,{recursive:true});
try{
 command('initdb.exe',['-D',cluster,'-U','catalogue_proof','--auth=trust','--no-locale']);command('pg_ctl.exe',['-D',cluster,'-l',cluster+'/server.log','-w','-o',`-p ${port} -h 127.0.0.1`,'start'],'',true);started=true;
 assert.equal(run('SHOW data_directory;').replaceAll('\\','/').toLowerCase(),cluster.toLowerCase());checks++;
 run(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT '${tenant}'::uuid$$;
 CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('test.owner',true),'false')='true'$$;
 CREATE TABLE tenant_tool_autonomy(tenant_id uuid,tool_key text,mode text CHECK(mode IN('auto','confirm','off')),updated_at timestamptz,PRIMARY KEY(tenant_id,tool_key));
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
 CREATE TABLE tenant_stripe_accounts(tenant_id uuid,stripe_account_id text,onboarding_id uuid,provider_environment text);
 INSERT INTO tenant_stripe_accounts VALUES('${tenant}',NULL,'${randomUUID()}','live');`);
 // Actual latest full catalogue followed by every actual additive predecessor wrapper.
 run(fn(read('20270546000000_studio_content_workspace_authority.sql')));
 const chain=['20270547000002_sales_collection_autonomy_catalogue.sql','20270548000000_studio_publish_autonomy_catalogue.sql','20270553000000_sales_invoice_preferences.sql','20270564000000_marketing_email_paige_tools.sql','20270582000000_sales_governed_invoice_draft.sql','20270587000000_sales_governed_commercial_create.sql','20270595000000_marketing_email_series_paige_tools.sql','20270597000001_sales_invoice_provider_operations.sql'];
 for(const name of chain){const src=read(name),match=src.match(/DO \$\$ BEGIN\s*IF to_regprocedure\('public\.(_list_tool_autonomy\w*)\(uuid\)'\) IS NULL THEN\s*ALTER FUNCTION public\.list_tool_autonomy\(uuid\) RENAME TO \1;\s*END IF;\s*END \$\$;/);assert(match,name);run(match[0]+fn(src));}
 const before=run(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY tool_key),'[]') FROM list_tool_autonomy('${tenant}') t;`),pending=run('SELECT row_to_json(t) FROM tenant_stripe_accounts t;');
 const migration=read('20270601000007_sales_merchant_tool_catalogue.sql');run(migration);run(migration);
 eq(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY tool_key),'[]') FROM list_tool_autonomy('${tenant}') t WHERE tool_key NOT IN('sales_start_merchant_onboarding','sales_create_merchant_login_link');`,before);
 eq('SELECT row_to_json(t) FROM tenant_stripe_accounts t;',pending);
 eq(`SELECT count(*) FROM list_tool_autonomy('${tenant}') WHERE tool_key IN('sales_start_merchant_onboarding','sales_create_merchant_login_link') AND category='Payments' AND mode='confirm' AND is_default;`,'2');
 eq(`SELECT label FROM list_tool_autonomy('${tenant}') WHERE tool_key='sales_start_merchant_onboarding';`,'Start Stripe Express merchant setup');
 eq(`SELECT label FROM list_tool_autonomy('${tenant}') WHERE tool_key='sales_create_merchant_login_link';`,'Open the Stripe merchant dashboard');
 eq(`SELECT count(*)=count(DISTINCT tool_key) FROM list_tool_autonomy('${tenant}');`,'t');
 const auth=`SET ROLE authenticated;SET test.actor='${actor}';`;
 eq(auth+`SELECT count(*) FROM list_tool_autonomy() WHERE tool_key LIKE 'sales_%merchant%';`,'2');
 deny(auth+`SELECT * FROM list_tool_autonomy('${other}');`);
 eq(auth+`SET test.owner='true';SELECT count(*) FROM list_tool_autonomy('${other}') WHERE tool_key LIKE 'sales_%merchant%';`,'2');
 run(`INSERT INTO tenant_tool_autonomy VALUES('${tenant}','sales_start_merchant_onboarding','off',now());`);
 eq(auth+`SELECT mode||':'||is_default FROM list_tool_autonomy() WHERE tool_key='sales_start_merchant_onboarding';`,'off:false');
 eq(`SET ROLE service_role;SELECT count(*) FROM list_tool_autonomy('${tenant}') WHERE tool_key LIKE 'sales_%merchant%';`,'2');
 deny(`SET ROLE anon;SELECT * FROM list_tool_autonomy('${tenant}');`);
 for(const role of ['anon','authenticated','service_role'])deny(`SET ROLE ${role};SELECT * FROM _list_tool_autonomy_before_merchant_setup('${tenant}');`);
 eq(`SELECT NOT has_function_privilege('anon','list_tool_autonomy(uuid)','EXECUTE');`,'t');
 eq(`SELECT NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.list_tool_autonomy(uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE');`,'t');
 console.log(`PASS ${checks} PostgreSQL catalogue assertions: actual predecessor chain preserved, exactly two Payments tools, Ask First defaults, stored Off, tenant/owner/service admission, public/anon/private ACLs, replay, LIVE pending row unchanged. No provider calls.`);
}finally{
 if(started)command('pg_ctl.exe',['-D',cluster,'-m','fast','-w','stop'],'',true);
 assert(cluster.startsWith(root+'merchant-catalogue-pg-'));assert(!existsSync(cluster+'/postmaster.pid'));rmSync(cluster,{recursive:true,force:true});
}
