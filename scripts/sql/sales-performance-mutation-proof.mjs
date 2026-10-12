// Mutate only in-memory migration text in disposable local databases.
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const args=process.argv.slice(2);
if(args.length!==4)throw Error('Explicit isolated PostgreSQL target required');
const mutants=['mixed_currency','foreign_rows','void_invoice','reversal','widened_role','stale_revision','changed_version'];
const results=[];
for(const mutation of mutants){
 const p=spawnSync(process.execPath,[fileURLToPath(new URL('./sales-performance-proof.mjs',import.meta.url)),...args,'--mutation',mutation],{encoding:'utf8',windowsHide:true,maxBuffer:4e6});
 assert.notEqual(p.status,0,`${mutation}: contract regression escaped`);
 assert(p.stderr.includes('AssertionError'),`${mutation}: failed for infrastructure/SQL rather than a meaningful assertion: ${p.stderr}`);
 results.push({mutation,result:'CAUGHT'});console.log(`${mutation}: CAUGHT`);
}
mkdirSync(new URL('../../work/',import.meta.url),{recursive:true});
writeFileSync(new URL('../../work/sales-performance-mutations.json',import.meta.url),JSON.stringify({production:false,results},null,2));
