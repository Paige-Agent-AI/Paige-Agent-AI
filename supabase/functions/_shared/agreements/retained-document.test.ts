import assert from 'node:assert/strict';
import {PDFDocument} from 'npm:pdf-lib@1.17.1';
import {sha256Hex} from './token.ts';
import {verifyRetainedAgreementPdf} from './retained-document.ts';

Deno.test('actual retained presented/sealed PDF bytes require their own exact digest',async()=>{
  const document=await PDFDocument.create();document.addPage();const bytes=await document.save();
  const digest=await sha256Hex(bytes);assert.equal(await verifyRetainedAgreementPdf(bytes,digest),true);
  const changed=bytes.slice();changed[changed.length-1]^=1;
  assert.equal(await verifyRetainedAgreementPdf(changed,digest),false);
  assert.equal(await verifyRetainedAgreementPdf(bytes,'a'.repeat(64)),false);
});
Deno.test('refuses missing/malformed digest and non-PDF bytes even with a matching hash',async()=>{
  const bytes=new TextEncoder().encode('<html>Not a retained PDF</html>');
  assert.equal(await verifyRetainedAgreementPdf(bytes,await sha256Hex(bytes)),false);
  for(const digest of [null,undefined,'',17,'G'.repeat(64),'a'.repeat(63)])assert.equal(await verifyRetainedAgreementPdf(new TextEncoder().encode('%PDF-1.7'),digest),false);
});
Deno.test('hashes only the exact byte view without borrowing surrounding buffer bytes',async()=>{
  const whole=new TextEncoder().encode('excluded%PDF-1.7\nexact retained bytesexcluded');
  const selected=whole.subarray(8,whole.length-8),digest=await sha256Hex(selected);
  assert.equal(await verifyRetainedAgreementPdf(selected,digest),true);
  assert.equal(await verifyRetainedAgreementPdf(whole,digest),false);
});
