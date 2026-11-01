// File parsing preparation for the ORIGINAL Knowledge extraction worker.
// No storage, authority, provider, model, dispatch or persistence is implemented here.
// Parser adapters must use pinned libraries, no URL input/external fetch, and release
// their own worker/document resources on cancellation. Output is untrusted DATA.
import { sourceHash } from './knowledge-extraction.ts';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 480000;
const MAX_PAGES = 200;
const MAX_ZIP_ENTRIES = 512;
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024;
const MAX_SELECTION_BYTES = 20 * 1024 * 1024;
const MAX_SELECTION_FILES = 20;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export type KnowledgeFileFormat = 'text' | 'pdf' | 'docx';
export type KnowledgeTextSegment = { kind: 'page' | 'paragraph' | 'text'; ordinal: number; start: number; end: number };
export interface KnowledgeFileText {
  format: KnowledgeFileFormat;
  sourceSha256: string;
  sourceByteSize: number;
  text: string;
  textSha256: string;
  coverage: 'complete' | 'partial';
  extractionVersion: string;
  segments: KnowledgeTextSegment[];
  limits: string[];
}
export interface KnowledgeFileParsers {
  pdf(bytes: Uint8Array, options: { maxPages: number; maxTextChars: number; signal?: AbortSignal }): Promise<{ pages: Array<string | null>; totalPages: number }>;
  docx(bytes: Uint8Array, options: { maxTextChars: number; signal?: AbortSignal }): Promise<string>;
}
export type KnowledgeFileInput = { bytes: Uint8Array; name: string; mime: string };
export type KnowledgePreparedFile = { inputIndex: number; fileName: string; notificationFailed?: true } & (
  | { status: 'prepared'; reading: KnowledgeFileText }
  | { status: 'duplicate'; duplicateOf: number }
  | { status: 'failed'; code: string }
  | { status: 'cancelled' }
);
export class KnowledgeFileTextError extends Error {
  constructor(public readonly code: string) { super(code); }
}
function fail(code: string): never { throw new KnowledgeFileTextError(code); }
function current(signal?: AbortSignal) { if (signal?.aborted) fail('FILE_CANCELLED'); }
function untilCancelled<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new KnowledgeFileTextError('FILE_CANCELLED')); };
    if (signal.aborted) { void work.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
const signature = (bytes: Uint8Array, magic: number[]) => magic.every((v, i) => bytes[i] === v);
const byteView = (value: unknown): value is Uint8Array => ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';

/** Defensive OOXML package preflight before Mammoth is allowed to expand the ZIP.
 * This bounds declared expansion and rejects encrypted/macros/ambiguous entries.
 * It is NOT a malware scanner or a claim of process/resource isolation.
 */
export type KnowledgeArchiveEntry = { start: number; end: number; expandedSize: number; method: 0 | 8 };
export function inspectDocxArchive(bytes: Uint8Array): KnowledgeArchiveEntry[] {
  const unsafe = () => fail('FILE_PACKAGE_UNSAFE');
  if (bytes.length < 22 || bytes.length > MAX_BYTES || !signature(bytes, [0x50, 0x4b, 3, 4])) unsafe();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) unsafe();
  const count = view.getUint16(end + 10, true);
  const length = view.getUint32(end + 12, true);
  const directory = view.getUint32(end + 16, true);
  if (!count || count > MAX_ZIP_ENTRIES || view.getUint16(end + 8, true) !== count || directory + length !== end) unsafe();
  let offset = directory; let expanded = 0;
  const names = new Set<string>(); const ranges: Array<[number, number]> = [];
  const entries: KnowledgeArchiveEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) unsafe();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extra + comment;
    if (!nameLength || next > end || flags & 1 || ![0, 8].includes(method) || view.getUint16(offset + 34, true) !== 0 || local + 30 > directory) unsafe();
    let name: string;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); }
    catch { return unsafe(); }
    const normalized = name.toLowerCase();
    if (/[%\\]/.test(name) || [...name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..')
      || names.has(normalized) || /(^|\/)(vbaproject\.bin|activex|embeddings)(\/|$)/i.test(name) || /\.(exe|dll|js|vbs|bat|cmd|ps1|docm)$/i.test(name)) unsafe();
    names.add(normalized);
    expanded += size;
    if (expanded > MAX_EXPANDED_BYTES || size > Math.max(1, compressed) * 100 || (compressed === 0 && size !== 0)) unsafe();
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) unsafe();
    const localName = view.getUint16(local + 26, true); const localExtra = view.getUint16(local + 28, true);
    const data = local + 30 + localName + localExtra;
    if (localName !== nameLength || data + compressed > directory) unsafe();
    for (let n = 0; n < nameLength; n++) if (bytes[local + 30 + n] !== bytes[offset + 46 + n]) unsafe();
    if (!(flags & 8) && (view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== size)) unsafe();
    const finish = data + compressed;
    if (ranges.some(([a, b]) => local < b && finish > a)) unsafe();
    ranges.push([local, finish]);
    entries.push({ start: data, end: finish, expandedSize: size, method: method as 0 | 8 });
    offset = next;
  }
  if (offset !== end || !names.has('[content_types].xml') || !names.has('_rels/.rels') || !names.has('word/document.xml')) unsafe();
  return entries;
}

function formatFor(bytes: Uint8Array, name: string, suppliedMime: string): KnowledgeFileFormat {
  const mime = suppliedMime.split(';')[0].trim().toLowerCase();
  const generic = !mime || mime === 'application/octet-stream';
  const looksPdf = signature(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  const looksZip = signature(bytes, [0x50, 0x4b, 3, 4]);
  if (/\.pdf$/i.test(name)) {
    if ((!generic && mime !== 'application/pdf') || !looksPdf) fail('FILE_TYPE_MISMATCH');
    return 'pdf';
  }
  if (/\.docx$/i.test(name)) {
    if ((!generic && mime !== DOCX_MIME) || !looksZip) fail('FILE_TYPE_MISMATCH');
    return 'docx';
  }
  if (/\.(txt|md|markdown|csv|json)$/i.test(name)) {
    if ((!generic && !mime.startsWith('text/') && mime !== 'application/json') || looksPdf || looksZip) fail('FILE_TYPE_MISMATCH');
    return 'text';
  }
  return fail('FILE_UNSUPPORTED');
}

/** Validate permitted bytes before durable submission without executing a parser. */
export function inspectKnowledgeFile(input: KnowledgeFileInput): KnowledgeFileFormat {
  if (!byteView(input.bytes) || !input.bytes.length) return fail('FILE_TEXT_INVALID');
  if (input.bytes.byteLength > MAX_BYTES) return fail('FILE_TOO_LARGE');
  const format = formatFor(input.bytes, input.name, input.mime);
  if (format === 'docx') inspectDocxArchive(input.bytes);
  return format;
}

/** Returns only a bounded untrusted reading. No fact/Memory approval is inferred.
 * PDF/DOCX always remain partial: images, layout semantics and OCR are not read.
 */
export async function extractKnowledgeFile(input: KnowledgeFileInput, parsers: KnowledgeFileParsers, signal?: AbortSignal): Promise<KnowledgeFileText> {
  current(signal);
  if (!byteView(input.bytes) || !input.bytes.length) return fail('FILE_TEXT_INVALID');
  if (input.bytes.byteLength > MAX_BYTES) return fail('FILE_TOO_LARGE');
  const bytes = new Uint8Array(input.bytes); // Snapshot also accepts genuine cross-realm byte views.
  const format = inspectKnowledgeFile({ ...input, bytes });
  const sourceSha256 = await sourceHash(bytes);
  current(signal);
  let output = ''; const segments: KnowledgeTextSegment[] = []; const limits = new Set<string>();
  const add = (value: string, kind: KnowledgeTextSegment['kind'], ordinal: number) => {
    if (!value.trim()) return;
    if (value.includes('\0')) fail('FILE_TEXT_INVALID');
    const separator = output ? '\n\n' : '';
    const available = MAX_TEXT - output.length - separator.length;
    if (available <= 0) { limits.add('TEXT_LIMIT'); return; }
    let kept = value.slice(0, available);
    if (kept.length < value.length) {
      limits.add('TEXT_LIMIT');
      if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
    }
    if (!kept) return;
    const start = output.length + separator.length;
    output += separator + kept;
    segments.push({ kind, ordinal, start, end: output.length });
  };
  try {
    if (format === 'text') {
      let decoded: string;
      try { decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { return fail('FILE_TEXT_INVALID'); }
      if (decoded.length > MAX_TEXT) fail('FILE_TEXT_LIMIT');
      add(decoded, 'text', 1);
    } else if (format === 'pdf') {
      const result = await untilCancelled(parsers.pdf(bytes.slice(), { maxPages: MAX_PAGES, maxTextChars: MAX_TEXT, signal }), signal);
      current(signal);
      if (!Number.isSafeInteger(result.totalPages) || result.totalPages < 1 || !Array.isArray(result.pages)
        || result.pages.length > MAX_PAGES || result.pages.length > result.totalPages || result.pages.some(page => page !== null && typeof page !== 'string')) fail('FILE_PARSE_FAILED');
      limits.add('PDF_TEXT_LAYER_ONLY');
      if (result.totalPages > result.pages.length) limits.add('PAGE_LIMIT');
      result.pages.forEach((page, index) => {
        if (page === null || !page.trim()) limits.add('EMPTY_PDF_PAGES');
        else add(page, 'page', index + 1);
      });
    } else {
      const value = await untilCancelled(parsers.docx(bytes.slice(), { maxTextChars: MAX_TEXT, signal }), signal);
      current(signal);
      if (typeof value !== 'string') fail('FILE_PARSE_FAILED');
      limits.add('DOCX_MAIN_TEXT_ONLY');
      value.split(/\n\s*\n/).forEach((paragraph, index) => add(paragraph, 'paragraph', index + 1));
    }
  } catch (error) {
    current(signal);
    if (error instanceof KnowledgeFileTextError) throw error;
    if (error instanceof Error && error.name === 'PasswordException') fail('FILE_ENCRYPTED');
    return fail('FILE_PARSE_FAILED'); // Never echo parser errors or document contents.
  }
  current(signal);
  if (!output.trim()) return fail('FILE_NO_READABLE_TEXT');
  const textSha256 = await sourceHash(new TextEncoder().encode(output));
  current(signal);
  return { format, sourceSha256, sourceByteSize: bytes.length, text: output, textSha256,
    coverage: format === 'text' ? 'complete' : 'partial', extractionVersion: format === 'text' ? 'utf8-v1' : `${format}-text-v1`, segments, limits: [...limits] };
}

/** Finite, in-memory preparation of an already-authorized selection. This is not
 * a worker, durable batch, uploader or retry queue. Each future save uses the
 * original per-document intent/review writer. No successful file is replayed here.
 * Duplicate means identical bytes/format within THIS selection only; it grants
 * no access to another stored document and does not merge or delete a source.
 */
export async function prepareKnowledgeFiles(inputs: readonly KnowledgeFileInput[], parsers: KnowledgeFileParsers, signal?: AbortSignal,
  onResult?: (result: KnowledgePreparedFile) => void): Promise<KnowledgePreparedFile[]> {
  // Technical memory bounds for this one preparation call, not a durable upload
  // allowance. The mounted caller must expose these and can prepare later groups.
  if (inputs.length > MAX_SELECTION_FILES || inputs.reduce((size, input) => size + (byteView(input.bytes) ? input.bytes.byteLength : 0), 0) > MAX_SELECTION_BYTES) fail('FILE_SELECTION_TOO_LARGE');
  // Freeze EVERY member before the first await, including a caller replacing its
  // array or mutating a later byte view while an earlier document is parsing.
  const selection = inputs.map(input => ({ bytes: byteView(input.bytes) ? new Uint8Array(input.bytes) : new Uint8Array(), name: input.name, mime: input.mime }));
  const results: KnowledgePreparedFile[] = [];
  const prepared = new Map<string, number>();
  for (let inputIndex = 0; inputIndex < selection.length; inputIndex++) {
    const input = selection[inputIndex];
    let result: KnowledgePreparedFile;
    if (signal?.aborted) result = { inputIndex, fileName: input.name, status: 'cancelled' };
    else {
      try {
        const captured = input;
        if (!captured.bytes.length) fail('FILE_TEXT_INVALID');
        if (captured.bytes.length > MAX_BYTES) fail('FILE_TOO_LARGE');
        const format = formatFor(captured.bytes, captured.name, captured.mime);
        const key = `${format}:${await sourceHash(captured.bytes)}`;
        current(signal);
        const duplicateOf = prepared.get(key);
        if (duplicateOf !== undefined) result = { inputIndex, fileName: captured.name, status: 'duplicate', duplicateOf };
        else {
          const reading = await extractKnowledgeFile(captured, parsers, signal);
          current(signal);
          prepared.set(key, inputIndex);
          result = { inputIndex, fileName: captured.name, status: 'prepared', reading };
        }
      } catch (error) {
        result = signal?.aborted ? { inputIndex, fileName: input.name, status: 'cancelled' }
          : { inputIndex, fileName: input.name, status: 'failed', code: error instanceof KnowledgeFileTextError ? error.code : 'FILE_PARSE_FAILED' };
      }
    }
    results.push(result);
    try { onResult?.(result); }
    catch {
      // Rendering/progress observers do not own parsing or discard other files.
      // Return explicit notice failure without echoing observer/private content.
      results[results.length - 1] = { ...result, notificationFailed: true };
    }
  }
  return results;
}
