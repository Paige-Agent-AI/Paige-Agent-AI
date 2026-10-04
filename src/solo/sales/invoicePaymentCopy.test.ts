import {describe,it,expect} from 'vitest';
import {invoiceDisplayNumber,invoicePaymentStatus} from './invoicePaymentCopy';

describe('invoice payment presentation',()=>{
  it('keeps issuance separate from recorded settlement',()=>{
    expect(invoicePaymentStatus('draft',499700,0,499700)).toBe('Draft · not issued');
    expect(invoicePaymentStatus('issued',499700,0,499700)).toBe('Issued · outstanding');
    expect(invoicePaymentStatus('issued',499700,202400,297300)).toBe('Partially paid · outstanding');
    expect(invoicePaymentStatus('issued',499700,499700,0)).toBe('Paid · business-recorded');
    expect(invoicePaymentStatus('void',499700,202400,297300)).toBe('Void');
  });
  it('never claims paid from malformed or inconsistent balance facts',()=>{
    expect(invoicePaymentStatus('issued',499700,0,0)).toBe('Issued · balance unavailable');
    expect(invoicePaymentStatus('issued',499700,-1,499701)).toBe('Issued · balance unavailable');
  });
  it('does not substitute an internal ID when the number is missing',()=>{
    expect(invoiceDisplayNumber('INV-0012')).toBe('INV-0012');
    expect(invoiceDisplayNumber('DRAFT-22222222-2222-4222-8222-222222222222')).toBe('Previously issued invoice');
    expect(invoiceDisplayNumber('DRAFT-22222222-2222-4222-8222-222222222222',false)).toBe('Assigned when issued');
    expect(invoiceDisplayNumber(null)).toBe('Invoice number unavailable');
    expect(invoiceDisplayNumber(' ')).toBe('Invoice number unavailable');
  });
});
