// Disposable native PostgreSQL proof. Real consumer predicates AND lower helpers; synthetic Auth/schema.
// No managed Supabase, provider send, customer record or production acceptance.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import {invitationOperationProof} from './e09-customer-invitation-operation.mjs';
import {invitationDeliveryProof} from './e09-customer-invitation-delivery.mjs';
const root=process.cwd(),workspace=path.resolve(root,'..'),baseline=process.argv.includes('--baseline');
const out=path.resolve(root,process.env.E09_INVITE_PROOF_DIR??'../e09-invitation-history-native');
assert(out.startsWith(workspace+path.sep));fs.mkdirSync(out,{recursive:true});
const bin=process.env.E09_PG_BIN??(process.platform==='win32'?'C:/Program Files/PostgreSQL/16/bin':'');
const port=Number(process.env.E09_INVITE_PG_PORT??55531);assert(Number.isInteger(port)&&port>=1024&&port<=65535&&![5432,54322].includes(port));
const exe=n=>bin?path.join(bin,n+(process.platform==='win32'?'.exe':'')):n;
const cluster=fs.mkdtempSync(path.join(out,'cluster-')),transcript=[],results=[];
function run(name,args,input){const op=path.join(out,transcript.length+'-'+name+'.stdout'),ep=path.join(out,transcript.length+'-'+name+'.stderr');
 const ofd=fs.openSync(op,'w'),efd=fs.openSync(ep,'w');let r;
 try{r=spawnSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,timeout:60000,stdio:['pipe',ofd,efd]});}finally{fs.closeSync(ofd);fs.closeSync(efd);}
 const stdout=fs.readFileSync(op,'utf8'),stderr=fs.readFileSync(ep,'utf8');transcript.push({name,args,exit:r.status,stdout,stderr});
 if(r.error)throw r.error;if(r.status!==0)throw new Error(stderr||stdout);return stdout.trim();}
const args=['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const sql=s=>run('psql',args,s),lit=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const ids={a:'e0918000-0000-0000-0000-000000000001',b:'e0918000-0000-0000-0000-000000000002',
 delegate:'e0918000-0000-0000-0000-000000000003',platform:'e0918000-0000-0000-0000-000000000004',
 operator:'e0918000-0000-0000-0000-000000000005',parentOwner:'e0918000-0000-0000-0000-000000000006',
 ta:'e0928000-0000-0000-0000-000000000001',tb:'e0928000-0000-0000-0000-000000000002',
 parent:'e0928000-0000-0000-0000-000000000003',child:'e0928000-0000-0000-0000-000000000004',
 otherChild:'e0928000-0000-0000-0000-000000000005',company:'e0928000-0000-0000-0000-000000000006',
 absent:'e0928000-0000-0000-0000-000000000099',
 i:'e0938000-0000-0000-0000-000000000001',empty:'e0938000-0000-0000-0000-000000000002',blank:'e0938000-0000-0000-0000-000000000003'};
const migrationFile='supabase/migrations/20271107120000_e09_owner_invitation_history.sql';
const migration=fs.readFileSync(path.join(root,migrationFile),'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const proofScriptSHA256=hash(fs.readFileSync(path.join(root,'scripts/proof/e09-owner-invitation-history.mjs')));
const hostedTestFile='supabase/tests/consumer_invite_acceptance.sql';
const hostedTest=fs.readFileSync(path.join(root,hostedTestFile),'utf8');
// Execute the exact hosted fixture, not a second handwritten copy of its UNION.
const hostedEmailInsert=hostedTest.match(/INSERT INTO public\.email_send_log\([\s\S]*?FROM e09_history_fixture;/)?.[0];
assert(hostedEmailInsert,'exact hosted email fixture INSERT not found');
const accountTypeSourceFile='supabase/migrations/20260803120000_p1_subaccount_owner_leak_fix.sql';
const accountTypeSource=fs.readFileSync(path.join(root,accountTypeSourceFile),'utf8');
const accountTypeConstraint=accountTypeSource.match(/ALTER TABLE public\.tenants\s+ADD CONSTRAINT tenants_account_type_chk[\s\S]*?;/)?.[0];
assert(accountTypeConstraint,'actual account-type CHECK not found');
function actual(header,file){const source=fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8').replaceAll('\r\n','\n');
 const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+header),tail=source.slice(start);
 const tag=tail.match(/\bAS\s+(\$[a-zA-Z_0-9]*\$)/i)?.[1];assert(start>=0&&tag,'actual native body not found: '+header);
 const body=tail.indexOf(tag)+tag.length,end=tail.indexOf(tag+';',body);assert(end>=body);return tail.slice(0,end+tag.length+1);}
const governance='20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql';
const helperSpecs=[
 ['is_super_admin()','is_super_admin()',governance],
 ['is_super_admin(uuid)','is_super_admin(_user_id uuid)',governance],
 ['is_platform_admin(uuid)','is_platform_admin(_actor uuid)','20260714142258_tier_rail_phaseB.sql'],
 ['is_platform_owner()','is_platform_owner()',governance,['08ff6983c07e71b7c4bec3b8b4fcae28']],
 ['is_platform_owner(uuid)','is_platform_owner(_user_id uuid)',governance,['dc789c98cf26f96d52c5138754c0f131']],
 ['is_platform_operator()','is_platform_operator()','20260816130000_operator_role_tiers_and_grant_lockdown.sql'],
 ['is_company_workspace(uuid)','is_company_workspace(_tenant uuid)','20270521000000_operator_authority_in_company_workspaces.sql'],
 ['is_tenant_admin(uuid)','is_tenant_admin(_tenant uuid)','20270521000000_operator_authority_in_company_workspaces.sql',['7d393ee77b2ebbc42791f0dce8dbcca5']],
 ['agency_can_manage_child(uuid,uuid)','agency_can_manage_child(_child uuid, _actor uuid)','20260714051416_fix_agency_team_enforcement.sql',['b1f1bb620eae26744519c1ff7700e28d']],
 ['agency_can_manage_child(uuid)','agency_can_manage_child(_child uuid)','20260712300000_agency_mcp_guards.sql',['28b9778e8612a4bbb33a8adb72c77251']],
 ['email_delivery_rank(text)','email_delivery_rank(','20261105000000_an_invitation_says_what_happened_to_it.sql']
].map(([signature,header,file,expectedMD5])=>({signature,file,expectedMD5,source:actual(header,file)}));
const helperCatalog=[];
function check(name,fn){try{fn();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',error:String(e.message)});}}
function call(actor=ids.a,expected=ids.a,tenant=ids.ta,role='authenticated'){
 const value=sql(`BEGIN;SELECT set_config('test.actor',${lit(actor)},true);SET LOCAL ROLE ${role};SELECT public.client_portal_owner_invitations(${lit(expected)}::uuid,${lit(tenant)}::uuid);ROLLBACK;`);
 return JSON.parse(value.split(/\r?\n/).find(line=>line.startsWith('{')));}
const snapshot=()=>sql("SELECT jsonb_build_object('tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)FROM tenants t),'members',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)FROM tenant_members t),'agency_members',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)FROM agency_team_members t),'roles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id,role)FROM user_roles t),'invites',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)FROM tenant_invite_tokens t),'email',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id)FROM email_send_log t))");
function denied(name,actor,expected,tenant,role='authenticated'){check(name,()=>{const before=snapshot();assert.throws(()=>call(actor,expected,tenant,role),e=>e.message.includes('42501'));assert.equal(snapshot(),before);});}
const event=(id,status,seconds,extra={})=>sql(`INSERT INTO email_send_log(id,tenant_id,template_name,recipient_email,status,message_id,metadata,created_at)VALUES(
 ${lit('e0948000-0000-0000-0000-'+String(id).padStart(12,'0'))},${lit(extra.tenant===undefined?ids.ta:extra.tenant)}::uuid,
 ${lit(extra.template??'portal_invite')},${lit(extra.email??' CUSTOMER@tests.invalid ')},${lit(status)},${lit(extra.message===undefined?'PRIVATE_PROVIDER_ID':extra.message)},
 ${lit(JSON.stringify({invite_id:extra.invite??ids.i,token:'PRIVATE_TOKEN',error:'PRIVATE_ERROR',body:'PRIVATE_BODY',join_url:'PRIVATE_URL',...extra.metadata}))}::jsonb,
 '2026-10-15T12:00:00Z'::timestamptz+make_interval(secs=>${seconds}));`);
let started=false;
try{
 run('initdb',['-D',cluster,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
 started=true;run('pg_ctl',['-D',cluster,'-l',path.join(cluster,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
 sql(`CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN;CREATE ROLE service_role NOLOGIN;
 CREATE SCHEMA auth;CREATE FUNCTION auth.uid()RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
 CREATE TYPE public.tenant_role AS ENUM('owner','admin','member');
 CREATE TYPE public.app_role AS ENUM('super_admin','platform_admin','admin','client','user');
 CREATE TABLE tenants(id uuid PRIMARY KEY,account_type text NOT NULL DEFAULT 'standalone',parent_tenant_id uuid,features jsonb DEFAULT '{}');
 ${accountTypeConstraint}
 CREATE TABLE tenant_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,status text,role tenant_role,is_owner boolean);
 CREATE TABLE agency_team_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agency_tenant_id uuid,user_id uuid,status text,agency_role text,scoped_subaccounts uuid[] DEFAULT '{}');
 CREATE TABLE user_roles(user_id uuid,role public.app_role);
 CREATE TABLE tenant_invite_tokens(id uuid PRIMARY KEY,tenant_id uuid,kind text,contact_id uuid,email text,created_at timestamptz,expires_at timestamptz,last_used_at timestamptz,revoked_at timestamptz,token text);
 CREATE TABLE email_send_log(id uuid PRIMARY KEY,tenant_id uuid,template_name text,recipient_email text,status text,message_id text,metadata jsonb,error_message text,created_at timestamptz);
 ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
 ALTER TABLE agency_team_members ENABLE ROW LEVEL SECURITY;ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
 ALTER TABLE tenant_invite_tokens ENABLE ROW LEVEL SECURITY;ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON tenants,tenant_members,agency_team_members,user_roles,tenant_invite_tokens,email_send_log FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO tenants(id,account_type,parent_tenant_id,features) VALUES('${ids.ta}','standalone',NULL,'{}'),('${ids.tb}','standalone',NULL,'{}'),
 ('${ids.parent}','agency',NULL,'{}'),('${ids.child}','sub_account','${ids.parent}','{}'),('${ids.otherChild}','sub_account','${ids.parent}','{}'),
 ('${ids.company}','standalone',NULL,'{"system_workspace":true}');
 INSERT INTO tenant_members(tenant_id,user_id,status,role,is_owner) VALUES('${ids.ta}','${ids.a}','active','owner',true),('${ids.tb}','${ids.b}','active','admin',false),
 ('${ids.parent}','${ids.parentOwner}','active','owner',true);
 INSERT INTO agency_team_members(agency_tenant_id,user_id,status,agency_role,scoped_subaccounts) VALUES('${ids.parent}','${ids.delegate}','active','agency_admin',ARRAY['${ids.child}']::uuid[]);
 INSERT INTO user_roles VALUES('${ids.platform}','super_admin'),('${ids.operator}','platform_admin');
 INSERT INTO tenant_invite_tokens(id,tenant_id,kind,email,created_at,expires_at,token) VALUES
 ('${ids.i}','${ids.ta}','consumer','customer@tests.invalid','2026-10-15','2026-11-15','PRIVATE_TOKEN'),
 ('${ids.empty}','${ids.ta}','consumer','empty@tests.invalid','2026-10-14','2026-11-15','PRIVATE_TOKEN'),
 ('${ids.blank}','${ids.ta}','consumer',NULL,'2026-10-13','2026-11-15','PRIVATE_TOKEN'),
 ('e0938000-0000-0000-0000-000000000004','${ids.tb}','consumer','foreign@tests.invalid','2026-10-15','2026-11-15','PRIVATE_TOKEN'),
 ('e0938000-0000-0000-0000-000000000005','${ids.ta}','team','team@tests.invalid','2026-10-15','2026-11-15','PRIVATE_TOKEN');`);
 for(const helper of helperSpecs){sql(helper.source);const md5=sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.${helper.signature}'::regprocedure`);
 helperCatalog.push({signature:helper.signature,file:helper.file,sourceSHA256:hash(helper.source),catalogProsrcMD5:md5,productionMetadataMatch:helper.expectedMD5?helper.expectedMD5.includes(md5):'NOT_SUPPLIED'});
 if(helper.expectedMD5)assert(helper.expectedMD5.includes(md5),'catalog signature/body mismatch '+helper.signature+' '+md5);}
 // Match the incumbent service-only explicit-actor agency helper; reader calls as its definer.
 sql('REVOKE ALL ON FUNCTION agency_can_manage_child(uuid,uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION agency_can_manage_child(uuid,uuid) TO service_role;');
 if(!baseline){sql(migration);const once=sql("SELECT pg_get_functiondef('client_portal_owner_invitations(uuid,uuid)'::regprocedure)");sql(migration);
 check('Migration repeat preserves exact reader definition',()=>assert.equal(sql("SELECT pg_get_functiondef('client_portal_owner_invitations(uuid,uuid)'::regprocedure)"),once));}
 check('Actual source account-type CHECK rejects old subaccount and admits native sub_account',()=>{
 const before=snapshot(),insert=account=>`BEGIN;INSERT INTO public.tenants(id,account_type,parent_tenant_id)VALUES('${ids.absent}',${lit(account)},'${ids.parent}');SELECT account_type FROM public.tenants WHERE id='${ids.absent}';ROLLBACK;`;
 assert.throws(()=>sql(insert('subaccount')),e=>e.message.includes('23514')&&e.message.includes('tenants_account_type_chk'));
 assert(sql(insert('sub_account')).split(/\r?\n/).includes('sub_account'));assert.equal(snapshot(),before);
 });
 check('Exact hosted UNION fixture executes; omitted first UUID cast reproduces CI42804',()=>{
 const before=snapshot(),setup=`BEGIN;
 CREATE TEMP TABLE e09_history_fixture AS SELECT '${ids.i}'::uuid AS invite_id;
 INSERT INTO public.tenants(id,account_type) VALUES
 ('e0901000-0000-0000-0000-000000000001','standalone'),('e0901000-0000-0000-0000-000000000002','standalone');
 -- Match the actual used email columns, defaults, FK, CHECK and sent-id uniqueness.
 -- This remains a synthetic shape proof; full-schema triggers/pgTAP execute only in CI.
 ALTER TABLE public.email_send_log ALTER COLUMN id SET DEFAULT gen_random_uuid(),
 ALTER COLUMN template_name SET NOT NULL,ALTER COLUMN recipient_email SET NOT NULL,
 ALTER COLUMN status SET NOT NULL,ALTER COLUMN created_at SET NOT NULL,
 ADD CONSTRAINT e09_hosted_tenant_fk FOREIGN KEY(tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL,
 ADD CONSTRAINT e09_hosted_status_check CHECK(status IN('pending','sent','suppressed','failed','bounced','complained','dlq','delivered','delivery_delayed','opened','clicked','dropped'));
 CREATE UNIQUE INDEX e09_hosted_sent_id_unique ON public.email_send_log(message_id) WHERE status='sent';`;
 const raw=sql(setup+hostedEmailInsert+"SELECT jsonb_build_object('rows',count(*),'null_tenant',count(*)FILTER(WHERE tenant_id IS NULL))FROM public.email_send_log;ROLLBACK;");
 assert.deepEqual(JSON.parse(raw.split(/\r?\n/).find(line=>line.startsWith('{'))),{rows:9,null_tenant:1});
 const broken=hostedEmailInsert.replace("SELECT 'e0901000-0000-0000-0000-000000000001'::uuid,","SELECT 'e0901000-0000-0000-0000-000000000001',");
 assert.notEqual(broken,hostedEmailInsert);assert.throws(()=>sql(setup+broken+'ROLLBACK;'),e=>e.message.includes('42804')&&e.message.includes('UNION types text and uuid cannot be matched'));
 assert.equal(snapshot(),before);
 });
 const statuses=['pending','sent','delivered','delivery_delayed','opened','clicked','bounced','complained','suppressed','failed','dlq','dropped','future_status'];
 statuses.forEach((status,index)=>event(index+1,status,index));
 event(20,'failed',20,{metadata:{reason:'transport'}});event(21,'sent',21,{message:null});event(22,'sent',22,{message:' '});
 event(30,'delivered',30,{tenant:ids.tb});event(31,'delivered',31,{tenant:null});event(32,'delivered',32,{email:'foreign@tests.invalid'});
 event(33,'delivered',33,{template:'team_invite'});event(34,'delivered',34,{invite:ids.empty,email:'customer@tests.invalid'});
 event(35,'delivered',35,{invite:ids.blank,email:''});
 event(36,'delivered',36,{metadata:{kind:'team'}});event(37,'delivered',37,{metadata:{kind:'subaccount_owner'}});
 event(38,'delivered',38,{metadata:{kind:null}});event(39,'delivered',39,{metadata:{kind:{invalid:true}}});
 event(40,'delivered',40,{metadata:{kind:'consumer'}});
 check('Actual owner gets closed nonsecret exact-tenant consumer envelope without effects',()=>{const before=snapshot(),r=call();
 assert.deepEqual(Object.keys(r).sort(),['actor_id','invitations','tenant_id']);assert.equal(r.actor_id,ids.a);assert.equal(r.tenant_id,ids.ta);assert.equal(r.invitations.length,3);
 assert.deepEqual(Object.keys(r.invitations[0]).sort(),['contact_id','created_at','delivery','email','expires_at','id','last_used_at','revoked_at']);
 assert.deepEqual(Object.keys(r.invitations[0].delivery).sort(),['history','truncated']);assert(!JSON.stringify(r).includes('PRIVATE_'));
 assert.equal(snapshot(),before);});
 check('Canonical log binds tenant/template/invite/normalized stored recipient',()=>{const h=call().invitations[0].delivery.history;assert.equal(h.length,17);
 for(const e of h)assert.deepEqual(Object.keys(e).sort(),['at','id','outcome','status']);assert(!h.some(e=>Number(e.id.slice(-12))>=30&&Number(e.id.slice(-12))!==40));});
 check('Explicit consumer kind and absent-kind receipts pass; other/null/malformed kinds refuse',()=>{
 const h=call().invitations[0].delivery.history.map(e=>Number(e.id.slice(-12)));assert(h.includes(1)&&h.includes(40));
 for(const n of [36,37,38,39])assert(!h.includes(n));});
 check('No matching evidence remains empty/unknown without a fabricated never-sent result',()=>{const r=call();for(const i of r.invitations.slice(1))assert.deepEqual(i.delivery,{history:[],truncated:false});});
 check('Outcomes distinguish provider handoff, transport uncertainty and unknown status',()=>{const h=call().invitations[0].delivery.history;
 const expected=['pending','accepted','delivered','delayed','opened','clicked','failed','failed','failed','failed','failed','failed','unknown','unknown','unknown','unknown','delivered'];
 assert.deepEqual(h.map(e=>e.outcome),expected);assert.equal(h[12].status,'unknown');});
 check('Current admin authority in the named other workspace works',()=>{const r=call(ids.b,ids.b,ids.tb);assert.equal(r.tenant_id,ids.tb);assert.equal(r.invitations.length,1);});
 const admitted=(name,actor,tenant)=>check(name,()=>{const before=snapshot(),r=call(actor,actor,tenant);assert.equal(r.actor_id,actor);assert.equal(r.tenant_id,tenant);assert.equal(snapshot(),before);});
 admitted('Canonical platform owner without a target membership is admitted',ids.platform,ids.ta);
 admitted('Canonical company operator without a company seat is admitted',ids.operator,ids.company);
 denied('Company operator has no implied customer authority',ids.operator,ids.operator,ids.ta);
 denied('Platform authority still requires an existing exact tenant',ids.platform,ids.platform,ids.absent);
 admitted('Active parent agency owner manages child without a child seat',ids.parentOwner,ids.child);
 for(const agencyRole of ['agency_owner','agency_admin','agency_manager','agency_specialist']){
 sql(`UPDATE agency_team_members SET agency_role=${lit(agencyRole)} WHERE user_id='${ids.delegate}'`);
 admitted('Actual active '+agencyRole+' consumer authority in exact child',ids.delegate,ids.child);}
 denied('Specialist cannot manage an off-scope sibling',ids.delegate,ids.delegate,ids.otherChild);
 for(const agencyRole of ['agency_viewer','agency_biller']){sql(`UPDATE agency_team_members SET agency_role=${lit(agencyRole)} WHERE user_id='${ids.delegate}'`);
 denied('Actual '+agencyRole+' does not manage a child',ids.delegate,ids.delegate,ids.child);}
 sql(`UPDATE agency_team_members SET agency_role='agency_admin',status='suspended' WHERE user_id='${ids.delegate}'`);
 denied('Suspended agency admin loses child authority',ids.delegate,ids.delegate,ids.child);
 sql(`UPDATE agency_team_members SET status='active' WHERE user_id='${ids.delegate}'`);
 denied('Delegated child authority cannot read an unrelated business',ids.delegate,ids.delegate,ids.ta);
 sql(`UPDATE tenant_members SET role='admin' WHERE user_id='${ids.parentOwner}'`);
 denied('Parent tenant admin alone is not an agency child-management grant',ids.parentOwner,ids.parentOwner,ids.child);
 sql(`UPDATE tenant_members SET role='owner' WHERE user_id='${ids.parentOwner}';UPDATE tenants SET account_type='enterprise' WHERE id='${ids.parent}'`);
 admitted('Enterprise parent owner retains canonical child-management authority',ids.parentOwner,ids.child);
 sql(`UPDATE tenants SET account_type='standalone' WHERE id='${ids.parent}'`);
 denied('Nonagency parent cannot create delegated child authority',ids.delegate,ids.delegate,ids.child);
 sql(`UPDATE tenants SET account_type='agency' WHERE id='${ids.parent}'`);
 denied('Pure agency target is denied even for platform authority',ids.platform,ids.platform,ids.parent);
 for(const account of ['enterprise','sub_account'])check('Native consumer tier retains '+account,()=>{sql(`UPDATE tenants SET account_type=${lit(account)},parent_tenant_id=${account==='sub_account'?lit(ids.parent)+'::uuid':'NULL'} WHERE id='${ids.ta}'`);try{assert.equal(call().tenant_id,ids.ta);}finally{sql(`UPDATE tenants SET account_type='standalone',parent_tenant_id=NULL WHERE id='${ids.ta}'`);}});
 denied('No Auth is refused despite service role',null,ids.a,ids.ta,'service_role');
 denied('Anonymous caller cannot execute',null,ids.a,ids.ta,'anon');
 denied('A claimed actor different from actual Auth is refused',ids.b,ids.a,ids.ta);
 denied('Null expected actor is refused',ids.a,null,ids.ta);
 denied('Null workspace is refused',ids.a,ids.a,null);
 denied('Foreign workspace is not selected by active/global context',ids.a,ids.a,ids.tb);
 sql(`UPDATE tenant_members SET role='member',is_owner=false WHERE user_id='${ids.a}'`);
 denied('Ordinary active member is not an invitation-history grant',ids.a,ids.a,ids.ta);
 sql(`UPDATE tenant_members SET is_owner=true WHERE user_id='${ids.a}'`);
 denied('is_owner flag alone does not widen the consumer mint role rules',ids.a,ids.a,ids.ta);
 sql(`UPDATE tenant_members SET role='owner',is_owner=true,status='revoked' WHERE user_id='${ids.a}'`);
 denied('Revoked owner membership is not authority',ids.a,ids.a,ids.ta);
 sql(`UPDATE tenant_members SET status='active' WHERE user_id='${ids.a}';UPDATE tenants SET account_type='agency' WHERE id='${ids.ta}'`);
 denied('Pure agency refuses the consumer view',ids.a,ids.a,ids.ta);
 sql(`UPDATE tenants SET account_type='standalone' WHERE id='${ids.ta}'`);
 check('NULL predicate perturbation refuses; omitting coalesces demonstrates the bypass control',()=>{
 const before=snapshot(),nullHelpers=`CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT NULL::boolean$$;
 CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$SELECT NULL::boolean$$;
 CREATE OR REPLACE FUNCTION public.agency_can_manage_child(_child uuid,_actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$SELECT NULL::boolean$$;`;
 const invocation=`SELECT set_config('test.actor','${ids.a}',true);SET LOCAL ROLE authenticated;SELECT public.client_portal_owner_invitations('${ids.a}','${ids.ta}');ROLLBACK;`;
 // These NULL-returning functions are explicitly adversarial, transaction-local replacements,
 // not the actual helpers used for every nominal authority case above. Failure rolls DDL back.
 assert.throws(()=>sql('BEGIN;'+nullHelpers+invocation),e=>e.message.includes('42501'));
 const mutant=migration.replaceAll(/COALESCE\((public\.(?:is_platform_owner\(\)|is_tenant_admin\(p_expected_tenant_id\)|agency_can_manage_child\(p_expected_tenant_id,_actor\))),false\)/g,'$1');
 assert.notEqual(mutant,migration);const raw=sql('BEGIN;'+nullHelpers+mutant+invocation);
 assert(JSON.parse(raw.split(/\r?\n/).find(line=>line.startsWith('{'))).invitations.length>0);
 assert.equal(snapshot(),before);
 for(const h of helperCatalog)assert.equal(sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.${h.signature}'::regprocedure`),h.catalogProsrcMD5);
 });
 check('Reader grants stay narrow; raw tables gain no browser grant',()=>{assert.equal(sql("SELECT has_function_privilege('anon','client_portal_owner_invitations(uuid,uuid)','EXECUTE')"),'f');
 for(const role of ['authenticated','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','client_portal_owner_invitations(uuid,uuid)','EXECUTE')`),'t');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='client_portal_owner_invitations(uuid,uuid)'::regprocedure AND a.grantee=0)"),'f');
 assert.equal(sql("SELECT has_table_privilege('authenticated','email_send_log','SELECT')"),'f');});
 check('Empty authorized workspace returns an array',()=>{sql(`DELETE FROM tenant_invite_tokens WHERE tenant_id='${ids.tb}'`);assert.deepEqual(call(ids.b,ids.b,ids.tb).invitations,[]);});
 check('History retains newest50 in stable chronological priority/id order, explicitly truncated',()=>{
 sql("DELETE FROM email_send_log");for(let n=1;n<=55;n++)event(n,'sent',n);
 const d=call().invitations[0].delivery;assert.equal(d.history.length,50);assert.equal(d.truncated,true);
 assert.equal(Number(d.history[0].id.slice(-12)),6);assert.equal(Number(d.history.at(-1).id.slice(-12)),55);
 sql("DELETE FROM email_send_log");event(1,'clicked',0);event(2,'pending',0);event(3,'sent',0);event(4,'sent',0);
 assert.deepEqual(call().invitations[0].delivery.history.map(e=>Number(e.id.slice(-12))),[2,3,4,1]);});
 check('Exactly50 events is not reported truncated',()=>{sql("DELETE FROM email_send_log");for(let n=1;n<=50;n++)event(n,'sent',n);assert.equal(call().invitations[0].delivery.truncated,false);});
 check('Invitation overflow returns bounded1001 newest rows for frontend refusal',()=>{sql(`INSERT INTO tenant_invite_tokens(id,tenant_id,kind,email,created_at,expires_at)
 SELECT ('e0958000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${ids.ta}','consumer','cap@tests.invalid','2026-10-16','2026-11-16' FROM generate_series(1,1002)n`);
 const r=call();assert.equal(r.invitations.length,1001);assert.equal(r.invitations[0].id,'e0958000-0000-0000-0000-000000001002');assert.equal(r.invitations.at(-1).id,'e0958000-0000-0000-0000-000000000002');});
 const operationProof=process.argv.includes('--operation')||process.argv.includes('--delivery')?await invitationOperationProof({sql,check,assert,fs,path,root,actual,ids,lit,spawn,exe,port,transcript}):null;
 const deliveryProof=process.argv.includes('--delivery')?invitationDeliveryProof({sql,check,assert,fs,path,root,ids,lit}):null;
 const failed=results.filter(r=>r.result==='FAIL');fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({evidence:'synthetic-native-postgresql',baseline,proofScriptSHA256,migrationFile,migrationSHA256:baseline?null:hash(migration),operationProof,deliveryProof,
 hostedTestFile,hostedTestSHA256:hash(hostedTest),hostedEmailInsertSHA256:hash(hostedEmailInsert),
 accountTypeSourceFile,accountTypeSourceSHA256:hash(accountTypeSource),accountTypeConstraintSHA256:hash(accountTypeConstraint),
 authority:'actual consumer-mint trio and actual lower helper bodies',helperCatalog,
 standIns:['auth.uid() from transaction-local test.actor GUC','tenants/tenant_members/agency_team_members/user_roles narrow synthetic tables (no production triggers)','tenant_role/app_role minimal enum members used by actual helpers','tenant_invite_tokens/email_send_log narrow synthetic tables','NO authority or lower-helper predicate stand-in in nominal tests; NULL helpers only in explicit rollback perturbation'],
 managedSupabase:'UNVERIFIED',authenticatedQA:'NOT_RUN',results},null,2));
 console.log(JSON.stringify({pass:results.length-failed.length,fail:failed.length,out}));if(failed.length)process.exitCode=1;
}finally{try{if(started)run('pg_ctl',['-D',cluster,'-w','stop','-m','fast']);}finally{fs.writeFileSync(path.join(out,'transcript.json'),JSON.stringify(transcript,null,2));}}
