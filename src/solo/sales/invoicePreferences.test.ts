import {describe,it,expect} from 'vitest';
import {DEFAULT_INVOICE_APPEARANCE,readInvoicePreferences,invoiceNumberExample} from './invoicePreferences';
const tenant='11111111-1111-4111-8111-111111111111';
describe('invoice preferences readback',()=>{
 it('validates tenant, initial version and canonical settings',()=>{const r={tenant_id:tenant,version:0,settings:DEFAULT_INVOICE_APPEARANCE,can_manage:true};expect(readInvoicePreferences(r,tenant)).toEqual(r);expect(invoiceNumberExample({...DEFAULT_INVOICE_APPEARANCE,next_number:124})).toBe('INV-00124');expect(invoiceNumberExample({...DEFAULT_INVOICE_APPEARANCE,prefix:'',padding:2,next_number:124})).toBe('124');});
 it('fails closed for foreign scope, unsafe numbering and invalid templates',()=>{const r={tenant_id:tenant,version:0,settings:DEFAULT_INVOICE_APPEARANCE,can_manage:true};expect(readInvoicePreferences(r,'22222222-2222-4222-8222-222222222222')).toBeNull();for(const change of [{next_number:0},{padding:12},{prefix:'<script>'},{template:'external-html'},{logo_data_uri:'https://example.com/logo.png'}])expect(readInvoicePreferences({...r,settings:{...r.settings,...change}},tenant)).toBeNull();expect(readInvoicePreferences({...r,can_manage:'yes'},tenant)).toBeNull();});
});
