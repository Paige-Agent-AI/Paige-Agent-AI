import { getResolvedPDFJS } from 'npm:unpdf@2.1.0';
// Reuse the EXACT raw-text pipeline from Mammoth1.13.0/lib/index.js, using its
// native Promise result. Its public compatibility wrapper mutates __proto__,
// which Deno2.1.4 disables. No prototype/security flag or library patch is used.
// These internal module paths are deliberately pinned and covered by real tests.
import { openArrayBuffer } from 'npm:mammoth@1.13.0/lib/zipfile.js';
import { read as readDocx } from 'npm:mammoth@1.13.0/lib/docx/docx-reader.js';
import { convertElementToRawText } from 'npm:mammoth@1.13.0/lib/raw-text.js';
import { inspectDocxArchive, KnowledgeFileTextError, type KnowledgeFileParsers } from './knowledge-file-text.ts';

const MAX_EXPANDED = 16 * 1024 * 1024;
const fail = (code: string): never => { throw new KnowledgeFileTextError(code); };
function current(signal?: AbortSignal) { if (signal?.aborted) fail('FILE_CANCELLED'); }

/** Actual expansion is measured before Mammoth can read the package. The core
 * separately checks ZIP metadata/identity/macros/encryption before this stage.
 * This is a bounded library adapter, not malware detection or a process sandbox.
 */
async function inspectExpandedDocx(bytes: Uint8Array, signal?: AbortSignal) {
  const entries = inspectDocxArchive(bytes); current(signal);
  let expanded = 0;
  for (const entry of entries) {
    current(signal);
    const compressed = bytes.subarray(entry.start, entry.end); let size = 0;
    if (entry.method === 0) { size = compressed.length; expanded += size; }
    else {
      // Use native cancellable DEFLATE rather than JSZip's delayed Node stream:
      // pausing that stream leaves scheduled resume work after cancellation.
      const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'), { signal }).getReader();
      try {
        for (;;) {
          current(signal); const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength; expanded += part.value.byteLength;
          if (expanded > MAX_EXPANDED) fail('FILE_PACKAGE_UNSAFE');
        }
      } catch (error) { current(signal); if (error instanceof KnowledgeFileTextError) throw error; fail('FILE_PACKAGE_UNSAFE'); }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    current(signal);
    if (expanded > MAX_EXPANDED || size !== entry.expandedSize) fail('FILE_PACKAGE_UNSAFE');
  }
}

/** Pure-JS parsers for the ORIGINAL Knowledge extraction producer. No URLs,
 * providers, filesystem, document scripts, macros, writers or background work.
 * The hosting Edge request retains its CPU/memory isolation; a timer alone
 * cannot preempt synchronous library work. Raw-source and text hashes remain
 * the core's distinct output, with partial coverage for both binary formats.
 */
export const knowledgeBinaryParsers: KnowledgeFileParsers = {
  async pdf(bytes, { maxPages, maxTextChars, signal }) {
    current(signal);
    const engine = await getResolvedPDFJS(); current(signal);
    // Use the pinned serverless build directly: no auto-discovered font paths,
    // remote CMaps, WASM, system fonts, images or canvas/native dependencies.
    const task = engine.getDocument({ data: bytes, enableXfa: false, useWasm: false,
      useSystemFonts: false, useWorkerFetch: false, disableFontFace: true,
      maxImageSize: 0, isImageDecoderSupported: false, isOffscreenCanvasSupported: false,
      stopAtErrors: true });
    let timedOut = false;
    // Cooperative deadline: do not destroy a live serverless PDFJS text reader.
    // Actual Deno cancellation shows that doing so can deadlock its close.
    // Retire consumer results promptly in the core; settle/drain the current
    // local phase here, then destroy before returning FILE_CANCELLED.
    const timer = setTimeout(() => { timedOut = true; }, 25000);
    try {
      current(signal);
      const pdf = await task.promise; current(signal);
      const pages: string[] = []; let remaining = maxTextChars + 1;
      for (let n = 1; n <= Math.min(maxPages, pdf.numPages) && remaining > 0; n++) {
        current(signal); if (timedOut) fail('FILE_PARSE_FAILED');
        const page = await pdf.getPage(n);
        const reader = page.streamTextContent().getReader(); let text = '';
        try {
          for (;;) {
            const next = await reader.read(); if (next.done) break;
            if (signal?.aborted || timedOut) continue;
            for (const item of next.value.items) {
              if (!('str' in item)) continue;
              const part = item.str + (item.hasEOL ? '\n' : ' ');
              text += part.slice(0, remaining); remaining -= Math.min(part.length, remaining);
              if (!remaining) break;
            }
            // Drain this page without retaining more text. Cancelling a live
            // serverless PDFJS stream at the text limit races its final close
            // under Deno2.1.4; the actual short-limit control reproduces that.
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); page.cleanup(); }
        pages.push(text);
      }
      current(signal); if (timedOut) fail('FILE_PARSE_FAILED');
      return { pages, totalPages: pdf.numPages };
    } finally {
      clearTimeout(timer);
      await task.destroy();
    }
  },
  async docx(bytes, { maxTextChars, signal }) {
    current(signal); await inspectExpandedDocx(bytes, signal); current(signal);
    const parsed = await readDocx(await openArrayBuffer(bytes.slice()));
    const result = parsed.map(convertElementToRawText);
    current(signal);
    // One extra character lets the core report truncation honestly. Main-text
    // extraction remains partial (no OCR, comments, tracked changes guarantee).
    return result.value.slice(0, maxTextChars + 1);
  },
};
