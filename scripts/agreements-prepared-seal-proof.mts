// deno run --allow-import --node-modules-dir=none --allow-read --allow-write=<output> ... <output>
// Native renderer/field constructors only. Synthetic data, no signing authority,
// database, browser session, provider, notification or agreement-state mutation.
import {preparedSealFixture} from '../supabase/functions/_shared/agreements/test-fixtures/prepared-seal.ts';
import {sealAgreementPdf,hashDocument} from '../supabase/functions/_shared/agreements/document.ts';
const output=Deno.args[0];if(!output||!/^([A-Za-z]:[\\/]|\/)/.test(output))throw new Error('An absolute proof output folder is required');
await Deno.mkdir(output,{recursive:true});
const input=await preparedSealFixture(),sealed=await sealAgreementPdf(input);
await Deno.writeFile(`${output}/presented.pdf`,input.presentedBytes);
await Deno.writeFile(`${output}/sealed.pdf`,sealed);
const paths=['supabase/functions/_shared/agreements/document.ts','supabase/functions/_shared/agreements/document-preparation.ts','supabase/functions/_shared/agreements/field-preparation.ts','supabase/functions/_shared/agreements/test-fixtures/prepared-seal.ts','scripts/agreements-prepared-seal-proof.mts'];
const sources=Object.fromEntries(await Promise.all(paths.map(async path=>[path,await hashDocument(new TextEncoder().encode((await Deno.readTextFile(path)).replace(/\r\n?/g,'\n')))])));
await Deno.writeTextFile(`${output}/receipt.json`,JSON.stringify({proof:'ACTUAL_NATIVE_RENDERER_SYNTHETIC_INPUT',source_hash_encoding:'UTF-8 LF',created_at:new Date().toISOString(),sources,
  presented_sha256:await hashDocument(input.presentedBytes),sealed_sha256:await hashDocument(sealed),preparation_sha256:input.preparedFields.preparation.preparation_sha256,
  field_input_sha256:input.preparedFields.inputs[0].field_input_sha256,rotations:[0,90,180,270],kinds:['signature','initials','signed_date','text','checkbox'],
  authenticated:'UNVERIFIED',authority:'NOT_ESTABLISHED',signing_execution:'NOT_PERFORMED',provider:'NOT_EXERCISED'},null,2));
console.log('PASS: actual original prepared-field PDF bytes generated; rendered inspection and hosted/authenticated signing remain separate.');
