import { decodeKnowledgeText, downloadKnowledgeBytes, ExtractionError, type KnowledgeExtractionEvidence, type SourceMetadata, type TextSource } from './knowledge-extraction.ts';
import { extractKnowledgeFile, inspectKnowledgeFile, KnowledgeFileTextError, type KnowledgeFileParsers } from './knowledge-file-text.ts';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function sourceFailure(error: unknown): never {
  if (error instanceof KnowledgeFileTextError && /^FILE_(ENCRYPTED|PACKAGE_UNSAFE|TYPE_MISMATCH|TOO_LARGE|NO_READABLE_TEXT|TEXT_INVALID|TEXT_LIMIT|UNSUPPORTED|PARSE_FAILED|CANCELLED)$/.test(error.code)) {
    throw new ExtractionError(error.code.toLowerCase());
  }
  throw error;
}
/** Same original bounded Storage download. URLs/headers come only from the
 * original verified caller/worker, never document text or model tool arguments.
 * Byte identity is captured before native admission; parsing runs in the SAME
 * original durable Knowledge worker, not in a second submission-side job.
 */
async function capture(url: string, headers: Record<string, string>, name: string, fetcher: typeof fetch) {
  const source = await downloadKnowledgeBytes(url, headers, fetcher);
  let format;
  try { format = inspectKnowledgeFile({ bytes: source.bytes, name, mime: source.mime_type }); }
  catch (error) { sourceFailure(error); }
  // Generic browser MIME is inferred only after matching extension AND magic.
  // Explicit incompatible MIME was already refused by the original file core.
  const mime_type = format === 'pdf' ? 'application/pdf' : format === 'docx' ? DOCX_MIME
    : (!source.mime_type || source.mime_type === 'application/octet-stream') ? 'text/plain' : source.mime_type;
  return { ...source, mime_type, format };
}
export async function readKnowledgeFileMetadata(url: string, headers: Record<string, string>, name: string, fetcher: typeof fetch = fetch): Promise<SourceMetadata> {
  const source = await capture(url, headers, name, fetcher);
  if (source.format === 'text') decodeKnowledgeText(source); // Preserve original UTF8/size/BOM rules.
  return { sha256: source.sha256, byte_size: source.byte_size, mime_type: source.mime_type };
}
export async function readKnowledgeFile(url: string, headers: Record<string, string>, name: string, parsers: KnowledgeFileParsers, fetcher: typeof fetch = fetch): Promise<TextSource> {
  const source = await capture(url, headers, name, fetcher);
  if (source.format === 'text') {
    const decoded = decodeKnowledgeText(source);
    const evidence: KnowledgeExtractionEvidence = {
      schema_version: 1, format: 'text', source_sha256: decoded.sha256, text_sha256: decoded.sha256,
      extraction_version: 'utf8-v1', coverage: 'complete', segments: [{ kind: 'text', ordinal: 1, start: 0, end: decoded.text.length }], limits: [],
    };
    return { ...decoded, evidence };
  }
  const reading = await extractKnowledgeFile({ bytes: source.bytes, name, mime: source.mime_type }, parsers).catch(sourceFailure);
  return {
    text: reading.text, sha256: reading.sourceSha256, byte_size: reading.sourceByteSize, mime_type: source.mime_type,
    evidence: { schema_version: 1, format: reading.format, source_sha256: reading.sourceSha256, text_sha256: reading.textSha256,
      extraction_version: reading.extractionVersion, coverage: reading.coverage, segments: reading.segments, limits: reading.limits },
  };
}
