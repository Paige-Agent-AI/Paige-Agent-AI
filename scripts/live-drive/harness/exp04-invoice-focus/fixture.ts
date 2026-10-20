// Synthetic local proof only: no authenticated identity, customer data, payment or provider action.
export * from '../sales-invoice-lifecycle/fixture';
import { supabase as original, invoiceLifecycleFixtureRow } from '../sales-invoice-lifecycle/fixture';

export const FOCUSED_INVOICE = 'e4000000-0000-4000-8000-0000000a0017';
let reads = 0;
const focused = structuredClone(invoiceLifecycleFixtureRow(FOCUSED_INVOICE, 'issued'));
focused.invoice_number = 'INV-17';
focused.billing_draft.items[0].item = 'Retained service invoice';
// This row deliberately is NOT in the register fixture's first page.
focused.document = { ...focused.document!, invoice_number: focused.invoice_number };

export const supabase = { ...original, rpc: async (name: string, args: Record<string, unknown>) => {
  if (name !== 'read_sales_invoice' || args._invoice_id !== FOCUSED_INVOICE) return original.rpc(name, args);
  reads += 1;
  (window as unknown as { __e4FocusReads: number }).__e4FocusReads = reads;
  const state = new URLSearchParams(location.search).get('focus-state');
  if (state === 'loading') return new Promise<{ data: null; error: null }>(() => {});
  if (state === 'missing') return { data: null, error: null };
  if (state === 'refused') return { data: null, error: { code: '42501', message: 'Synthetic refusal' } };
  if (state === 'retry' && reads === 1) return { data: null, error: { code: '57014', message: 'Synthetic temporary read failure' } };
  if (state === 'foreign') return { data: { ...focused, tenant_id: 'e4000000-0000-4000-8000-00000000ffff' }, error: null };
  return { data: structuredClone(focused), error: null };
} };
