// Read-only post-deploy proof inside the existing host. Synthetic HTML only; no secrets in output.
import assert from 'node:assert/strict';
const secret=process.env.PAIGE_BROWSER_SHARED_SECRET;assert(secret,'Browser secret must be configured');
const response=await fetch(`http://127.0.0.1:${Number(process.env.PORT)||8080}/pdf`,{method:'POST',headers:{'Content-Type':'application/json','X-Browser-Secret':secret},body:JSON.stringify({html:'<!doctype html><html><head></head><body><h1>Invoice INV-PROOF</h1><p>Read-only synthetic PDF deployment proof.</p></body></html>'}),signal:AbortSignal.timeout(45_000)});
assert.equal(response.status,200);assert(response.headers.get('content-type').startsWith('application/pdf'));
const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert(bytes.length<=8_000_000);
console.log(`PDF_HOST_SMOKE_PASS bytes=${bytes.length}; tenant/provider acceptance remains unverified`);
