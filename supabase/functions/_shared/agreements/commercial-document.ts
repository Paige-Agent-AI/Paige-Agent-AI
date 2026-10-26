import {sha256Hex} from './token.ts';
import {
  canonicalPresentationJson,
  commercialPresentationText,
  prepareCommercialPresentation,
  type PreparedCommercialPresentation,
  type RenderedCommercialPresentation,
} from './commercial-presentation.ts';

/** Native rendering stays outside the pure commercial/field contract imported
 * by the browser. This is the original renderer and exact reviewed payload,
 * not a second PDF engine or permission path. */
/** Preparation/rendering only. Caller must independently bind expected to existing approval,
 * resolve source again and atomically freeze this exact payload with the presented document. */
export async function renderCommercialPresentation(
  current: unknown,
  expected: PreparedCommercialPresentation,
  renderer?: (
    input: { title: string; bodyMarkdown: string },
  ) => Promise<Uint8Array>,
): Promise<RenderedCommercialPresentation> {
  const captured = structuredClone(current);
  const prepared = await prepareCommercialPresentation(captured);
  if (
    !expected || prepared.payload_digest !== expected.payload_digest ||
    canonicalPresentationJson(prepared.payload) !==
      canonicalPresentationJson(expected.payload) ||
    prepared.appendix !== expected.appendix
  ) throw Error('COMMERCIAL_PRESENTATION_CHANGED');
  const body = (captured as Record<string, unknown>).body_markdown as string;
  const render = renderer ?? (await import('./document.ts')).renderPresentedPdf;
  const presentedBody = commercialPresentationText(body, prepared);
  const bytes = await render({
    title: prepared.payload.title,
    bodyMarkdown: presentedBody,
  });
  return {
    ...prepared,
    document_bytes: bytes,
    document_sha256: await sha256Hex(bytes),
    presented_body_markdown: presentedBody,
    presented_body_sha256: await sha256Hex(presentedBody),
  };
}
