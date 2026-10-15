/** Read-only rendering through PAIGE's one browser host. No caller URL or credentials cross it. */
export async function renderDocumentPdf(html: string): Promise<Uint8Array> {
  const base = Deno.env.get('PAIGE_BROWSER_URL')?.replace(/\/+$/, '');
  const secret = Deno.env.get('PAIGE_BROWSER_SECRET');
  if (!base || !secret) throw new Error('PDF_RENDERER_UNAVAILABLE');
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('PDF_RENDERER_UNAVAILABLE');
  const response = await fetch(`${base}/pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Browser-Secret': secret }, body: JSON.stringify({ html }), signal: AbortSignal.timeout(35_000), redirect: 'error' });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error('PDF_RENDERER_UNAVAILABLE');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 8_000_000 || new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw new Error('PDF_RENDERER_INVALID');
  return bytes;
}
