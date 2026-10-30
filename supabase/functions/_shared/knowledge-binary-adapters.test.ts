import { strict as assert } from 'node:assert';
import JSZip from 'npm:jszip@3.10.1';
import { knowledgeBinaryParsers } from './knowledge-binary-adapters.ts';
import { extractKnowledgeFile, prepareKnowledgeFiles } from './knowledge-file-text.ts';

const phrase = 'Example Services LLC delivers a discovery report.';
const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function pdf(encrypted = false) {
  const stream = `BT /F1 12 Tf 40 700 Td (${phrase}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  if (encrypted) objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /P -4 >>`);
  let text = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((item, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${item}\nendobj\n`; });
  const position = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? `/Encrypt 6 0 R /ID [<${'00'.repeat(16)}> <${'00'.repeat(16)}>]` : ''} >>\nstartxref\n${position}\n%%EOF`;
  return new TextEncoder().encode(text);
}
function docx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${phrase}</w:t></w:r></w:p></w:body></w:document>`);
  return zip;
}
async function noNetwork(run: () => Promise<void>) {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; return Promise.reject(Error('EXTERNAL_FETCH_FORBIDDEN')); };
  try { await run(); assert.equal(calls, 0); } finally { globalThis.fetch = previous; }
}

Deno.test('actual pinned Deno PDF parser returns page evidence, distinct hashes and partial coverage without egress', () => noNetwork(async () => {
  const result = await extractKnowledgeFile({ bytes: pdf(), name: 'agreement.pdf', mime: 'application/pdf' }, knowledgeBinaryParsers);
  assert.ok(result.text.includes(phrase)); assert.equal(result.coverage, 'partial');
  assert.equal(result.segments[0].kind, 'page'); assert.equal(result.segments[0].ordinal, 1);
  assert.notEqual(result.sourceSha256, result.textSha256);
}));
Deno.test('actual pinned Deno DOCX parser reads main text without egress or macros', () => noNetwork(async () => {
  const bytes = await docx().generateAsync({ type: 'uint8array' });
  assert.ok((await knowledgeBinaryParsers.docx(bytes, { maxTextChars: 480000 })).includes(phrase));
  const result = await extractKnowledgeFile({ bytes, name: 'agreement.docx', mime }, knowledgeBinaryParsers);
  assert.ok(result.text.includes(phrase)); assert.equal(result.coverage, 'partial');
  assert.notEqual(result.sourceSha256, result.textSha256);
}));
Deno.test('actual PDF encryption is refused without asking a provider or guessing text', () => noNetwork(async () => {
  await assert.rejects(extractKnowledgeFile({ bytes: pdf(true), name: 'encrypted.pdf', mime: 'application/pdf' }, knowledgeBinaryParsers), { code: 'FILE_ENCRYPTED' });
}));
Deno.test('cancelled actual parser selection produces no late content', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(extractKnowledgeFile({ bytes: pdf(), name: 'agreement.pdf', mime: 'application/pdf' }, knowledgeBinaryParsers, controller.signal), { code: 'FILE_CANCELLED' });
});
Deno.test('actual adapters bound returned text while preserving an extra truncation signal character', () => noNetwork(async () => {
  const extractedPdf = await knowledgeBinaryParsers.pdf(pdf(), { maxPages: 1, maxTextChars: 10 });
  assert.equal(extractedPdf.pages.length, 1); assert.equal(extractedPdf.pages[0]?.length, 11);
  const bytes = await docx().generateAsync({ type: 'uint8array' });
  assert.equal((await knowledgeBinaryParsers.docx(bytes, { maxTextChars: 10 })).length, 11);
}));
Deno.test('active DOCX expansion cancellation settles without leaking stream work', async () => {
  const zip = docx(); const padding = new Uint8Array(200000); let seed = 123;
  for (let i = 0; i < padding.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; padding[i] = seed >>> 24; }
  zip.file('word/padding.bin', padding);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const controller = new AbortController();
  const pending = knowledgeBinaryParsers.docx(bytes, { maxTextChars: 480000, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 0);
  try { await assert.rejects(pending, { code: 'FILE_CANCELLED' }); }
  finally { clearTimeout(timer); }
});
Deno.test('active PDF cancellation drains its current stream and settles cleanup', async () => {
  const original = ReadableStream.prototype.getReader; const controller = new AbortController(); let readers = 0;
  ReadableStream.prototype.getReader = function(this: ReadableStream, options?: ReadableStreamGetReaderOptions) {
    const reader = Reflect.apply(original, this, options ? [options] : []);
    if (++readers === 1) queueMicrotask(() => controller.abort());
    return reader;
  } as typeof original;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = knowledgeBinaryParsers.pdf(pdf(), { maxPages: 200, maxTextChars: 480000, signal: controller.signal });
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('ACTIVE_PDF_CLEANUP_PENDING')), 3000); });
    await assert.rejects(Promise.race([pending, deadline]), { code: 'FILE_CANCELLED' });
    assert.ok(readers > 0);
  } finally { if (timer !== undefined) clearTimeout(timer); ReadableStream.prototype.getReader = original; }
});
Deno.test('actual bulk isolates unsupported file and duplicate while preserving PDF DOCX and text identities', () => noNetwork(async () => {
  const first = { bytes: pdf(), name: 'agreement.pdf', mime: 'application/pdf' };
  const result = await prepareKnowledgeFiles([first, { bytes: await docx().generateAsync({ type: 'uint8array' }), name: 'other.docx', mime }, { bytes: new TextEncoder().encode(phrase), name: 'notes.txt', mime: 'text/plain' }, first, { bytes: new Uint8Array([1]), name: 'unsafe.exe', mime: 'application/octet-stream' }], knowledgeBinaryParsers);
  assert.deepEqual(result.map(r => r.status), ['prepared', 'prepared', 'prepared', 'duplicate', 'failed']);
}));
Deno.test('actual expansion limit catches lying ZIP lengths before Mammoth receives a package', async () => {
  const zip = docx(); zip.file('word/padding.xml', 'x'.repeat(17 * 1024 * 1024));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 } });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Forge matching central/local uncompressed lengths to bypass declared-size
  // preflight. Actual streamed expansion must still be measured independently.
  for (let offset = 0; offset + 46 < bytes.length; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const size = view.getUint32(offset + 24, true);
    if (size <= 16 * 1024 * 1024) continue;
    view.setUint32(offset + 24, 1000, true);
    view.setUint32(view.getUint32(offset + 42, true) + 22, 1000, true);
  }
  await assert.rejects(knowledgeBinaryParsers.docx(bytes, { maxTextChars: 480000 }), { code: 'FILE_PACKAGE_UNSAFE' });
});
