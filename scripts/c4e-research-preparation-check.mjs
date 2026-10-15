/** Native preparation proof, rollback-only on an empty localhost int336_test database. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;
if(!url) throw Error('INT336_DATABASE_URL required');
const parsed=new URL(url);
if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!/^\/int336_test[a-z0-9_]*$/.test(parsed.pathname)) throw Error('Empty isolated localhost database required');
const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const proof=read('scripts/proof/paige-durable-work-concurrency.mjs');
let schema=proof.match(/const fixtureSchema = `([\s\S]*?)`;/)?.[1];
if(!schema)throw Error('Canonical fixture schema missing');
schema=schema.replace(/create role (\w+)([^;]*);/g,(_,name,options)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${name}')then create role ${name}${options};end if;end$$;`);
const document=read('supabase/migrations/20270418000000_paige_durable_document_work.sql');
const columns=document.slice(document.indexOf('alter table public.paige_durable_work'),document.indexOf('-- The canonical artifact'));
const identity=document.match(/create or replace function public\._paige_durable_work_protect_identity\(\)[\s\S]*?\$\$;/)?.[0];
if(!identity)throw Error('Canonical immutable payload trigger missing');
const file=fs.readdirSync(path.join(root,'supabase/migrations')).find(f=>f.endsWith('_c4e_research_preparation.sql'));
if(!file)throw Error('Preparation migration missing');
const sql=`begin;
do $$begin if to_regclass('public.paige_durable_work')is not null or to_regclass('public.tenants')is not null then raise exception 'Database must be empty';end if;end$$;
${schema}
${read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql')}
${columns}\n${identity}
${read('supabase/migrations/'+file).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'')}
${read('supabase/tests/c4e_research_preparation.sql')}
rollback;`;
const psql=process.env.PSQL_BIN??'psql';
const result=spawnSync(psql,['-X','--no-password','-v','ON_ERROR_STOP=1',url],{input:sql,encoding:'utf8',timeout:45000,windowsHide:true});
if(result.status!==0){console.error(result.stderr);process.exit(1)}
console.log(result.stdout.split('\n').filter(line=>line.includes('C4E_PROOF')).join('\n'));
console.log('PASS native rollback-only research preparation; no provider, wake, result or runtime activation');
