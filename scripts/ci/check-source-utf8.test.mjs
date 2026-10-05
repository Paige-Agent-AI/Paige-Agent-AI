import {strict as assert} from 'node:assert';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {test} from 'node:test';import {checkSourceUtf8} from './check-source-utf8.mjs';
test('accepts ASCII and UTF-8 Unicode, rejects malformed source and missing paths',()=>{
 const dir=mkdtempSync(join(tmpdir(),'source-utf8-'));
 try {
  const valid=join(dir,'valid.tsx'),invalid=join(dir,'invalid.tsx'),missing=join(dir,'missing.tsx');
  writeFileSync(valid,Buffer.from('export const label="\\u2026";\n'.replace('\\u2026','\u2026'),'utf8'));
  writeFileSync(invalid,Buffer.from([0x61,0x85,0x62]));
  assert.deepEqual(checkSourceUtf8([valid]),[]);
  const errors=checkSourceUtf8([valid,invalid,missing]);
  assert.equal(errors.length,2);assert.match(errors[0],/invalid UTF-8/);assert.match(errors[1],/ENOENT/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
