import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('./e09-cura-teaching-concurrency.mjs',import.meta.url));
const local='postgresql://postgres:postgres@127.0.0.1:54322/postgres';
for(const [name,patch] of [
 ['non-CI',{CI:'false'}],
 ['non-GitHub',{GITHUB_ACTIONS:'false'}],
 ['remote host',{CURA_TEACHING_TEST_DB_URL:local.replace('127.0.0.1','192.0.2.1')}],
 ['libpq hostaddr override',{CURA_TEACHING_TEST_DB_URL:local+'?hostaddr=192.0.2.1'}],
 ['libpq service override',{CURA_TEACHING_TEST_DB_URL:local+'?service=foreign'}],
 ['fragment',{CURA_TEACHING_TEST_DB_URL:local+'#untrusted'}],
 ['other database',{CURA_TEACHING_TEST_DB_URL:local.replace('/postgres','/customer')}],
 ['other credential',{CURA_TEACHING_TEST_DB_URL:local.replace(':postgres@',':other@')}],
])test('refuses '+name+' before any database process',()=>{
 const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:5000,windowsHide:true,
  env:{...process.env,CI:'true',GITHUB_ACTIONS:'true',CURA_TEACHING_TEST_DB_URL:local,
   PSQL_BIN:'cura-proof-must-never-start',...patch}});
 assert.equal(result.status,1);
 assert.match(result.stderr,/Disposable CI loopback stack required/);
 assert.doesNotMatch(result.stderr,/ENOENT|spawn/);
});
