import {describe,it,expect} from 'vitest';
import {renderSalesInvoiceDocument} from '../../../supabase/functions/_shared/sales-invoice-document';
describe('frozen invoice artifact',()=>{
  const input={document:{renderer_version:'paige-invoice-html-v1',invoice_number:'INV1',issuer_name:'Business',client_name:'Client',total_cents:1000,snapshot:{items:[{item:'Service',description:'日本語\n<script>alert(1)</script>',quantity:1,unit_minor:1000}],due_now_minor:250,remainder_minor:750,due_date:'2026-10-10',payment_method_intents:['cash'],memo:'<img src=x onerror=alert(1)>'}},document_input_digest:'a'.repeat(64),manual_recorded_cents:400,remaining_cents:600};
  it('escapes all content and preserves Unicode/multiline, without executable resources',()=>{const html=renderSalesInvoiceDocument(input)!;expect(html).toContain('日本語\n&lt;script&gt;');expect(html).not.toContain('<script');expect(html).not.toContain('<img');expect(html).toContain('Original requested amount: $2.50 USD');expect(html).toContain('Current outstanding: $6.00 USD');expect(html).not.toContain('Due now');expect(html).toContain('not provider verification');});
  it('refuses unknown renderer and missing digest',()=>{expect(renderSalesInvoiceDocument({...input,document_input_digest:''})).toBeNull();expect(renderSalesInvoiceDocument({...input,document:{...input.document,renderer_version:'unknown'}})).toBeNull();});
});
