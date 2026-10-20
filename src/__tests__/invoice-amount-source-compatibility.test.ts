import {expect,it} from 'vitest';
import {aggregateInvoiceItems as frontendAmount} from '../solo/sales/invoiceDraftSnapshot';
import {aggregateInvoiceItems as sharedAmount} from '../../supabase/functions/_shared/sales-commercial/invoice-amounts';

it('preserves the frontend public amount API as the same shared calculation used by the native door',()=>{
  expect(frontendAmount).toBe(sharedAmount);
});
