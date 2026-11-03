// Extend, never replace, the existing E08 disposable PostgreSQL proof. All its
// assertions/mutants run first, including the incumbent E04 and A2b contracts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { provePlanningConcurrency, provePlanningReadOnlyHistory } from './exp05-zion-planning-concurrency.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
assert(['127.0.0.1','localhost'].includes(process.env.PGHOST??'127.0.0.1'),'Disposable local PostgreSQL only');
const run=join(repo,'work','planning-native-proof',`run-${Date.now()}`);mkdirSync(run,{recursive:true});
const inputs=new Map();
function materialize(path){
 path=resolve(path);if(inputs.has(path))return inputs.get(path).copy;
 const source=readFileSync(path,'utf8').replace(/\r\n/g,'\n');
 const copy=join(run,`${inputs.size}-${createHash('sha256').update(relative(repo,path)).digest('hex').slice(0,10)}.sql`);
 inputs.set(path,{copy,sha256:createHash('sha256').update(source).digest('hex')});
 let sql=source;
 if(path===join(repo,'supabase/tests/exp08_team_hub_a2b_cards.sql')){
  const anchor="RESET ROLE;\n\\c postgres\nDROP DATABASE exp08_team_hub_a2b_proof;\n\\echo 'PASS: EXP08 Team Hub agents A2b proof complete; disposable database dropped'";
  assert.equal(sql.split(anchor).length,2,'Exactly one final disposable cleanup');
  sql=sql.replace(anchor,`\\ir '${join(repo,'supabase/tests/exp05_zion_planning_read.sql').replaceAll('\\','/')}'\n${process.argv.includes('--calendar') ? `\\ir '${join(repo,'supabase/tests/exp05_zion_calendar_read.sql').replaceAll('\\','/')}'\n` : ''}\\if :{?exp05_concurrent}\n\\echo 'EXP05 retained original disposable fixture only for concurrent probes'\n\\else\n${anchor}\n\\endif`);
 }
 // Incumbent sed commands extract SQL text only. Feed the exact same ranges
 // through SQL literals on Windows; preserve every original drift/mutant probe.
 sql=sql.replace(/^\\set (\w+) `sed -n '\/\^(.+)\/,\/\^(.+)\/p' (.+)`$/gm,(_,name,start,end,target)=>{
  const carrier=readFileSync(resolve(repo,target),'utf8').replace(/\r\n/g,'\n');
  const range=carrier.match(new RegExp('^'+start+'[\\s\\S]*?^'+end,'m'));assert(range,'Original sed range exists');
  materialize(resolve(repo,target));
  return `SELECT $exp05_transport$${range[0]}$exp05_transport$ AS ${name} \\gset`;
 });
 sql=sql.replace(/^[ \t]*\\ir[ \t]+(.+)$/gm,(_,target)=>{
  target=target.trim().replace(/^'(.*)'$/,'$1');
  return `\\ir '${materialize(isAbsolute(target)?target:resolve(dirname(path),target)).replaceAll('\\','/')}'`;
 });
 if(process.platform==='win32')sql=sql.replaceAll('\\o /dev/null','\\o NUL');
 writeFileSync(copy,sql);return copy;
}
const fixture=materialize(join(repo,'supabase/tests/exp08_team_hub_a2b_cards.sql'));
const psql=process.env.PG_BIN?join(process.env.PG_BIN,process.platform==='win32'?'psql.exe':'psql'):
 process.platform==='win32'?'C:/Program Files/PostgreSQL/16/bin/psql.exe':'psql';
const connection=['-h',process.env.PGHOST??'127.0.0.1','-p',process.env.PGPORT??'55485','-U',process.env.PGUSER??'postgres'];
const concurrent=!process.argv.includes('--red')&&!process.argv.includes('--search-red')&&!process.argv.includes('--links-red');
const result=spawnSync(psql,['-X',...connection,'-d','postgres','-v','ON_ERROR_STOP=1',
 ...(concurrent?['-v','exp05_concurrent=1']:[]),
 ...(process.argv.includes('--red')?['-v','exp05_native_red=1']:[]),
 ...(process.argv.includes('--search-red')?['-v','exp05_search_red=1']:[]),
 ...(process.argv.includes('--links-red')?['-v','exp05_links_red=1']:[]),'-f',fixture],
 {cwd:repo,encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024,timeout:120000});
writeFileSync(join(run,'stdout.txt'),result.stdout??'');writeFileSync(join(run,'stderr.txt'),result.stderr??'');
const contractLine=(result.stdout??'').split(/\r?\n/).find(line=>line.startsWith('EXP05_NATIVE_CONTRACT:'));
const contract=contractLine?JSON.parse(contractLine.slice('EXP05_NATIVE_CONTRACT:'.length)):null;
let proofError=null,races=[],calendarRaces=[],readOnlyHistory=[];
if(result.status===0){
 try{
  assert(contract?.length===14,'Successful proof includes the actual native source/metadata contract');
  if(concurrent){
   const line=(result.stdout??'').split(/\r?\n/).find(l=>l.startsWith('EXP05_RACE_CONTEXT:'));
   assert(line,'Original fixture exported its synthetic concurrency context');
   const context=JSON.parse(line.slice('EXP05_RACE_CONTEXT:'.length));
   races=await provePlanningConcurrency(psql,[...connection,'-d','exp08_team_hub_a2b_proof'],context);
   if(process.argv.includes('--calendar')){
    const calendarLine=(result.stdout??'').split(/\r?\n/).find(l=>l.startsWith('EXP05_CALENDAR_RACE_CONTEXT:'));
    assert(calendarLine,'Calendar extension exported its original synthetic context');
    calendarRaces=await provePlanningConcurrency(psql,[...connection,'-d','exp08_team_hub_a2b_proof'],
     JSON.parse(calendarLine.slice('EXP05_CALENDAR_RACE_CONTEXT:'.length)),{source:'calendar'});
   }
   // The incumbent final history control ends the seat and canonically deletes
   // its DM/turns. Preserve that destructive negative LAST, after Calendar has
   // used the same original conversation; never recreate it to bypass cleanup.
   readOnlyHistory=provePlanningReadOnlyHistory(psql,[...connection,'-d','exp08_team_hub_a2b_proof'],context);
  }
 }catch(error){proofError=error.stack??String(error);}
 finally{
  if(concurrent){
   const cleanup=spawnSync(psql,['-X',...connection,'-d','postgres','-v','ON_ERROR_STOP=1','-c','DROP DATABASE exp08_team_hub_a2b_proof;'],
    {encoding:'utf8',windowsHide:true,timeout:15000});
   if(cleanup.status!==0)proofError=(proofError??'')+'\nCleanup failed: '+cleanup.stderr;
  }
 }
}
if(contract)writeFileSync(join(run,'native-contract.json'),JSON.stringify(contract,null,2)+'\n');
const exit=result.status===0&&!proofError?0:1;
writeFileSync(join(run,'result.json'),JSON.stringify({exit,error:proofError??result.error?.message??null,races,calendarRaces,readOnlyHistory,
 inputs:[...inputs].map(([path,value])=>({path:relative(repo,path),sha256:value.sha256})),
 proof:'Original E08 reduced-schema disposable fixture plus EXP05 extension; no customer/full-schema/production claim'},null,2));
console.log((result.stdout??'').split(/\r?\n/).filter(line=>line.startsWith('PASS:')).join('\n'));
if(result.status!==0)console.error((result.stderr??'').slice(-6000));
if(proofError)console.error(proofError);
if(exit===0&&concurrent)console.log('PASS: four actual native source/role publication blocking pairs; same original retry/history; disposable database dropped');
if(exit===0&&concurrent)console.log(`PASS: ${readOnlyHistory.length} actual read-only original history/Search positive, revocation and recovery controls; no new messages`);
if(exit===0&&calendarRaces.length)console.log('PASS: four additional actual Calendar source/role publication blocking pairs, same-message retry and history masking');
console.log(`Evidence: ${run}`);process.exitCode=exit;
