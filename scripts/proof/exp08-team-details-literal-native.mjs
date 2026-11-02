// Inspectable native representation of the original Team writers/readers.
// The preserved, never-production 28010008 carrier is not changed or replayed here.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const catalogue=JSON.parse(readFileSync(new URL('./exp08-team-details-native-catalog.json',import.meta.url),'utf8'));
const md5=s=>createHash('md5').update(s).digest('hex');
const lit=s=>s===null?'NULL':`'${String(s).replaceAll("'","''")}'`;
const bodyOf=definition=>{
 const match=/\bAS (\$[A-Za-z_0-9]*\$)([\s\S]*)\1\s*;?\s*$/i.exec(definition);
 assert(match,'One complete original literal function body is required');return match[2];
};
const gate='LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;';
export const teamDetailsNative=catalogue.reviewed.map(row=>{
 const original=bodyOf(row.definition);assert.equal(md5(original),row.body_hash);
 let definition=row.definition;
 assert.equal([...definition.matchAll(/^[ \t]*PERFORM 1 FROM auth\.users/gm)].length,1);
 assert(!original.includes(gate));
 definition=definition.replace(/^([ \t]*)PERFORM 1 FROM auth\.users/m,(_whole,indent)=>`${indent}-- Original retirement exclusion precedes Auth/member row locks.\n${indent}${gate}\n${indent}PERFORM 1 FROM auth.users`);
 const inverse=definition.replace(/^([ \t]*)-- Original retirement exclusion precedes Auth\/member row locks\.\n\1LOCK TABLE public\.tenants IN ROW EXCLUSIVE MODE;\n/gm,'');
 assert.equal(inverse,row.definition,'Only the retirement lock-order repair may change the reviewed native definition');
 const body=bodyOf(definition);
 return {...row,definition:definition.trimEnd()+';\n',body,body_hash:md5(body)};
});
const old=new Map(catalogue.before.map(row=>[row.signature,row]));
function metadataMismatch(p,e){
 const config=e.config===null?'NULL::text[]':`ARRAY[${e.config.map(lit).join(',')}]::text[]`;
 return `${p}.proowner::regrole::text IS DISTINCT FROM ${lit(e.owner)} OR NOT ${p}.prosecdef
   OR ${p}.proacl::text IS DISTINCT FROM ${lit(e.acl)} OR ${p}.proconfig IS DISTINCT FROM ${config}
   OR ${p}.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname=${lit(e.language)})
   OR ${p}.prokind<>${lit(e.kind)} OR ${p}.provolatile<>${lit(e.volatility)}
   OR ${p}.proisstrict IS DISTINCT FROM ${e.strict} OR ${p}.proleakproof IS DISTINCT FROM ${e.leakproof}
   OR ${p}.proparallel<>${lit(e.parallel)} OR ${p}.proretset IS DISTINCT FROM ${e.set}
   OR ${p}.pronargdefaults<>${e.defaults_count} OR pg_catalog.pg_get_function_arguments(${p}.oid) IS DISTINCT FROM ${lit(e.arguments)}
   OR pg_catalog.pg_get_function_result(${p}.oid) IS DISTINCT FROM ${lit(e.result)}`;
}
function labels(row){
 if(row.signature.startsWith('set_solo_team_member_work_profile('))return row.signature.split(',').length===3
  ?['EXP08 owner work profile original metadata drift','EXP08 owner work profile original source drift']
  :['EXP08 scoped work profile original door drift','EXP08 scoped work profile original door drift'];
 if(row.signature.startsWith('set_solo_team_member_permission('))return row.signature.split(',').length===2
  ?['EXP08 permission original metadata drift','EXP08 permission original source drift']
  :['EXP08 scoped permission original door drift','EXP08 scoped permission original door drift'];
 if(row.signature.startsWith('get_'))return [`EXP08 owner read original reader metadata drift: public.${row.signature}`,`EXP08 owner read original source drift: public.${row.signature}`];
 throw new Error('Unexpected native function outside teammate details');
}
function guard(rows,{post=false,dependencies=[]}={}){
 let sql=`DO $exp08_literal_guard$\nDECLARE p pg_catalog.pg_proc; before_state boolean:=true; after_state boolean:=true;\nBEGIN\n IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 native installer requires postgres'; END IF;\n`;
 for(const d of dependencies){
  const prefix='EXP08 owner read original helper drift: public.';
  sql+=` SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(${lit('public.'+d.signature)});\n IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>${lit(d.hash)} OR ${metadataMismatch('p',d)} THEN\n  RAISE EXCEPTION ${lit(prefix+d.signature)}; END IF;\n`;
 }
 for(const row of rows){
  const before=old.get(row.signature);const [metadataError,sourceError]=labels(row);
  sql+=` SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(${lit('public.'+row.signature)});\n IF NOT FOUND THEN\n  after_state:=false;${before||post?' before_state:=false;':''}\n ELSE\n  IF ${metadataMismatch('p',row)} THEN RAISE EXCEPTION ${lit(metadataError)}; END IF;\n  IF pg_catalog.md5(p.prosrc)<>${lit(row.body_hash)} THEN after_state:=false; END IF;\n  ${before&&!post?`IF pg_catalog.md5(p.prosrc)<>${lit(before.body_hash)} THEN before_state:=false; END IF;`: 'before_state:=false;'}\n  IF pg_catalog.md5(p.prosrc) NOT IN (${[row.body_hash,...(before&&!post?[before.body_hash]:[])].map(lit).join(',')}) THEN RAISE EXCEPTION ${lit(sourceError)}; END IF;\n END IF;\n`;
 }
 if(!post)for(const signature of ['public.set_solo_team_member_work_profile(uuid,text,text,uuid)','public.set_solo_team_member_permission(uuid,text,uuid)'].filter(s=>rows.some(r=>('public.'+r.signature).startsWith(s.split('(')[0]+'(')))){
  sql+=` IF pg_catalog.to_regprocedure(${lit(signature)}) IS NOT NULL THEN RAISE EXCEPTION 'EXP08 unexpected intermediate scoped overload'; END IF;\n`;
 }
 sql+=post?` IF NOT after_state THEN RAISE EXCEPTION 'EXP08 literal native result could not be verified'; END IF;\n`:` IF NOT before_state AND NOT after_state THEN RAISE EXCEPTION 'EXP08 Team details partial installation'; END IF;\n`;
 return sql+'END $exp08_literal_guard$;\n';
}
export function literalTeamComponent(kind='all'){
 const rows=kind==='profile'?teamDetailsNative.filter(r=>r.signature.startsWith('set_solo_team_member_work_profile('))
  :kind==='permission'?teamDetailsNative.filter(r=>r.signature.startsWith('set_solo_team_member_permission('))
  :kind==='readers'?teamDetailsNative.filter(r=>r.signature.startsWith('get_')):teamDetailsNative;
 assert(rows.length===(kind==='all'?6:2));
 const definitions=rows.map(r=>`${r.definition}REVOKE ALL ON FUNCTION public.${r.signature} FROM PUBLIC,anon,authenticated,service_role;\nGRANT EXECUTE ON FUNCTION public.${r.signature} TO authenticated;\n`).join('\n');
 const dependencies=kind==='all'||kind==='readers'?catalogue.dependencies:[];
 return '-- Literal original Team native source; no provider or business-data operation.\n'+guard(rows,{dependencies})+definitions+guard(rows,{post:true});
}
export function literalTeamPreflight(){
 return guard(teamDetailsNative,{dependencies:catalogue.dependencies});
}
function atomicTestComponent(kind){
 const sql=literalTeamComponent(kind),tag=`$exp08_literal_${kind}_sql$`;
 assert(!sql.includes(tag),'Atomic component delimiter collision');
 return `-- Original standalone proof component remains atomic.\nDO $exp08_literal_${kind}_component$\nBEGIN\n EXECUTE ${tag}${sql}${tag};\nEND $exp08_literal_${kind}_component$;\n`;
}
export function literalTeamCarrier(){return `-- EXP08 teammate-details: one new unapplied source carrier, not a rename.\n-- Previous 28010008 remains immutable in preserved PR3214/ee431a9be.\nBEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL search_path=pg_catalog;\n${literalTeamComponent()}COMMIT;\n`;}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 assert(['--write','--check'].includes(process.argv[2])&&process.argv.length===3);
 const path=new URL('../../supabase/migrations/20271128020008_exp08_team_details_guarded_native.sql',import.meta.url);
 const expected=literalTeamCarrier();
 const outputs=[[path,expected],
  [new URL('./exp08-owner-work-profile-patch.sql',import.meta.url),atomicTestComponent('profile')],
  [new URL('./exp08-team-permission-patch.sql',import.meta.url),atomicTestComponent('permission')],
  [new URL('./exp08-owner-read-projection-patch.sql',import.meta.url),"-- INERT original EXP08 I2 §5.5 candidate. No managed version/publication/apply.\n-- Extends two ORIGINAL readers, not their authority, writers or grants.\nBEGIN;\nSET LOCAL lock_timeout='2s';\n"+literalTeamComponent('readers')+'\nCOMMIT;\n']];
 for(const [target,content] of outputs){
  if(process.argv[2]==='--write')writeFileSync(target,content);
  else assert.equal(readFileSync(target,'utf8').replace(/\r\n/g,'\n'),content);
 }
 console.log(JSON.stringify({functions:teamDetailsNative.map(r=>({signature:r.signature,body_hash:r.body_hash})),oldAppliedCarrierRewritten:false,nativeExecution:'UNVERIFIED'}));
}
