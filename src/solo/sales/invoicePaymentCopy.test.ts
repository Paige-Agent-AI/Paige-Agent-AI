import {describe,it,expect} from 'vitest';
import {invoiceDisplayNumber,invoicePaymentStatus,invoiceReceiptEvidenceLabel} from './invoicePaymentCopy';

describe('invoice payment presentation',()=>{
  it('keeps issuance separate from recorded settlement',()=>{
    expect(invoicePaymentStatus('draft',499700,0,499700)).toBe('Draft · not issued');
    expect(invoicePaymentStatus('issued',499700,0,499700)).toBe('Issued · outstanding');
    expect(invoicePaymentStatus('issued',499700,202400,297300)).toBe('Partially paid · outstanding');
    expect(invoicePaymentStatus('issued',499700,499700,0)).toBe('Paid · business-recorded');
    expect(invoicePaymentStatus('void',499700,202400,297300)).toBe('Void');
  });
  it('distinguishes confirmed and mixed full payments with actual native business evidence',()=>{expect(invoicePaymentStatus('issued',1000,0,0,1000,2)).toBe('Paid · provider-confirmed');expect(invoicePaymentStatus('issued',1000,100,0,900,2)).toBe('Paid · confirmed and business-recorded');expect(invoicePaymentStatus('issued',1000,100,600,300,2)).toBe('Partially paid · outstanding');});
  it('does not promote legacy unqualified provider records to live customer payment',()=>{
    expect(invoicePaymentStatus('issued',1000,0,0,1000)).toBe('Issued · provider environment unverified');
    expect(invoicePaymentStatus('issued',1000,100,600,300)).toBe('Issued · provider environment unverified');
    expect(invoicePaymentStatus('draft',1000,0,0,1000)).toBe('Draft · not issued');
    expect(invoicePaymentStatus('void',1000,0,0,1000)).toBe('Void');
    expect(invoicePaymentStatus('issued',1000,0,1000,0,2)).toBe('Issued · outstanding');
  });
  it('labels persisted receipt environment without inferring it from a current merchant',()=>{
    expect(invoiceReceiptEvidenceLabel({evidence_kind:'provider_verified',provider_environment:'test'})).toBe('TEST provider confirmation · no customer funds');
    expect(invoiceReceiptEvidenceLabel({evidence_kind:'provider_verified',provider_environment:'live'})).toBe('Live provider-confirmed payment');
    expect(invoiceReceiptEvidenceLabel({evidence_kind:'provider_verified'})).toBe('Provider payment record · environment unverified');
    expect(invoiceReceiptEvidenceLabel({evidence_kind:'manual_recorded',provider_environment:null})).toBe('Human-recorded receipt');
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
