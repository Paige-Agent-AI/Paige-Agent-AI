// PDF is a capability of the existing warm browser, never a second browser service.
export const PDF_MAX_HTML_BYTES = 1_800_000;
export function validatePdfRequest(body) {
  return !!body && typeof body.html === 'string' && Buffer.byteLength(body.html, 'utf8') <= PDF_MAX_HTML_BYTES
    && body.html.startsWith('<!doctype html>') && !/<(?:script|iframe|object|embed|base)\b/i.test(body.html);
}
export async function renderPdf(browser, html) {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  try {
    // No network, cookies, credentials or URL navigation. Logos are frozen inline data images.
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const printStyle='<style>@media print{main{padding:0!important;margin:0 auto!important}tr{break-inside:avoid}thead{display:table-header-group}h2{break-after:avoid}}</style>';
    await page.setContent(html.replace('</head>', `${printStyle}</head>`), { waitUntil: 'load', timeout: 15_000 });
    await page.emulateMedia({ media: 'print' });
    const bytes = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '12mm', right: '12mm' }, timeout: 15_000 });
    if (bytes.length > 8_000_000 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF_INVALID');
    return bytes;
  } finally { await context.close(); }
}
