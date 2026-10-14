// Mutate only in-memory migration text in disposable local databases.
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const args=process.argv.slice(2);
if(args.length!==4 && !(args.length===6 && args[4]==='--forward-migration'))throw Error('Explicit isolated PostgreSQL target required; optional explicit forward migration');
const baselineMutants=['mixed_currency','foreign_rows','void_invoice','reversal','widened_role','stale_revision','changed_version'];
const calendarMutants=['utc_day','due_today','missing_zone_fallback','invalid_zone_fallback','stale_zone_revision','renamed_without_version'];
const mutants=args.length===6?[...baselineMutants,...calendarMutants]:baselineMutants;
const results=[];
for(const mutation of mutants){
 // Preserve every incumbent control; calendar controls target the forward function separately.
 const targetArgs=calendarMutants.includes(mutation)?args:args.slice(0,4);
 const p=spawnSync(process.execPath,[fileURLToPath(new URL('./sales-performance-proof.mjs',import.meta.url)),...targetArgs,'--mutation',mutation],{encoding:'utf8',windowsHide:true,maxBuffer:4e6});
 assert.notEqual(p.status,0,`${mutation}: contract regression escaped`);
 assert(p.stderr.includes('AssertionError'),`${mutation}: failed for infrastructure/SQL rather than a meaningful assertion: ${p.stderr}`);
 results.push({mutation,result:'CAUGHT'});console.log(`${mutation}: CAUGHT`);
}
mkdirSync(new URL('../../work/',import.meta.url),{recursive:true});
writeFileSync(new URL('../../work/sales-performance-mutations.json',import.meta.url),JSON.stringify({production:false,results},null,2));
