import {afterEach,describe,expect,it,vi} from 'vitest';
import {readInvoicePdf} from './invoicePdf';
afterEach(()=>vi.unstubAllGlobals());
describe('customer PDF download contract',()=>{
 it('requires server PDF MIME and binary signature, not an HTML file with a PDF extension',async()=>{for(const [body,type] of [['<!doctype html>','text/html'],['<html>not PDF','application/pdf']]){vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(body,{headers:{'Content-Type':type}})));await expect(readInvoicePdf('https://example.test/scoped-invoice',{})).rejects.toThrow();}vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('%PDF-1.7\nfixture',{headers:{'Content-Type':'application/pdf'}})));const blob=await readInvoicePdf('https://example.test/scoped-invoice',{});expect(blob.type).toBe('application/pdf');expect(await blob.text()).toContain('%PDF-');expect(fetch).toHaveBeenCalledWith('https://example.test/scoped-invoice',expect.objectContaining({cache:'no-store',referrerPolicy:'no-referrer'}));});
 it('never downloads a denied invoice document',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('unavailable',{status:404})));await expect(readInvoicePdf('https://example.test/scoped-invoice',{})).rejects.toThrow('PDF_UNAVAILABLE');});
});
