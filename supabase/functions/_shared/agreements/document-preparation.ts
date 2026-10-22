import { inspectUploadedPdf } from './document.ts';
import { verifyRetainedAgreementPdf } from './retained-document.ts';
import { readAgreementPdfDocument, type AgreementPdfDocument } from './field-preparation.ts';

/** Dormant native preparation inspector. Never saves/re-renders the document,
 * changes its existing metadata, approves it, or authorizes access. Caller must
 * obtain the original scoped retained bytes and their canonical checksum first. */
export async function inspectAgreementPreparationPdf(bytes: Uint8Array, expectedSha256: unknown): Promise<AgreementPdfDocument> {
  const fail = (): never => { throw new TypeError('AGREEMENT_PREPARATION_PDF_UNAVAILABLE'); };
  if (bytes.length > 26214400) return fail();
  // Pin ONE private copy before the first await; external buffer mutation must
  // not pair a previously checked digest with subsequently different page data.
  const retained = bytes.slice();
  if (!await verifyRetainedAgreementPdf(retained, expectedSha256)) return fail();
  const inspected = await inspectUploadedPdf(retained);
  if (!inspected.ok || inspected.pages > 250) return fail();
  try {
    // SAME existing native loader/version; encryption is never ignored.
    const { PDFDocument, PDFName, PDFNumber } = await import('npm:pdf-lib@1.17.1');
    const pdf = await PDFDocument.load(retained, { updateMetadata: false });
    const pages = pdf.getPages().map((page, index) => {
      const unit = page.node.get(PDFName.of('UserUnit'));
      if (unit !== undefined && (!(unit instanceof PDFNumber) || unit.asNumber() !== 1)) return fail();
      const crop = page.getCropBox(), media = page.getMediaBox();
      if (![crop.x, crop.y, crop.width, crop.height, media.x, media.y, media.width, media.height].every(Number.isFinite)
        || crop.width <= 0 || crop.height <= 0 || media.width <= 0 || media.height <= 0) return fail();
      // The visible page is the crop/media INTERSECTION; never place a field
      // outside what a recipient's PDF viewer can actually display.
      const x = Math.max(crop.x, media.x), y = Math.max(crop.y, media.y);
      const width = Math.min(crop.x + crop.width, media.x + media.width) - x;
      const height = Math.min(crop.y + crop.height, media.y + media.height) - y;
      const rawRotation = page.getRotation().angle;
      if (!Number.isFinite(rawRotation)) return fail();
      const rotation = ((rawRotation % 360) + 360) % 360;
      if (![0, 90, 180, 270].includes(rotation)) return fail();
      return { page: index + 1, crop_x: x, crop_y: y, crop_width: width, crop_height: height, rotation,
        width: rotation % 180 ? height : width, height: rotation % 180 ? width : height };
    });
    return readAgreementPdfDocument({ sha256: expectedSha256, byte_length: retained.length, pages });
  } catch { return fail(); }
}
