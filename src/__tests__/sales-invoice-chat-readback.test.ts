import { describe, expect, it } from 'vitest';
import { dispatchSalesInvoiceChat } from '../../supabase/functions/_shared/sales-invoice-chat.ts';

const tenant = '11111111-1111-4111-8111-111111111111';
const invoice = '2222222a-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const context = {
  tenantId: tenant, userId: tenant, toolName: 'read_sales_invoice', args: { invoice_id: invoice },
  approved: new Set<string>(), sameToolCalls: 1,
  turn: { thread_id: null, user_turn_ordinal: 1, user_turn: 'Read this invoice' },
};
const record = { id: invoice, tenant_id: tenant, version: 2, status: 'issued', currency: 'usd',
  amount_total_cents: 5000, remaining_cents: 0, payments: [] };

async function read(data: unknown, error: unknown = null, ctx = context) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const result = await dispatchSalesInvoiceChat(ctx, {
    admin: { from() { throw new Error('Invoice reads cannot select an approval'); } },
    caller: {
      async rpc(name, args) { calls.push({ name, args }); return { data, error }; },
      functions: { async invoke() { throw new Error('Invoice reads cannot invoke a mutation'); } },
    },
  });
  return { result, calls };
}

describe('canonical invoice Chat readback', () => {
  it.each([null, [], true, 'unavailable', {}, { ...record, id: undefined },
    { ...record, tenant_id: undefined }, { ...record, id: other },
    { ...record, tenant_id: other }, { ...record, version: undefined },
    { ...record, version: 0 }, { ...record, version: 1.5 },
    { ...record, version: '2' }, { ...record, version: Number.MAX_SAFE_INTEGER + 1 },
  ])('does not report an absent, mismatched or unusable native record as read', async data => {
    const { result, calls } = await read(data);
    expect(result.content.success).toBe(false);
    expect(result.content).not.toHaveProperty('invoice');
    expect(calls).toEqual([{ name: 'read_sales_invoice', args: {
      _expected_tenant_id: tenant, _invoice_id: invoice,
    } }]);
  });

  it.each([{ ...record, version: 1, status: 'draft', remaining_cents: 5000 }, record,
    { ...record, id: other, tenant_id: other, version: 4 },
  ])('preserves valid canonical records across eligible workspaces and record versions', async data => {
    const ctx = { ...context, tenantId: data.tenant_id, args: { invoice_id: data.id.toUpperCase() } };
    const { result, calls } = await read({ ...data, document: 'private', actor_user_id: 'private' }, null, ctx);
    expect(result.content).toMatchObject({ success: true, invoice: {
      id: data.id, version: data.version, remaining_cents: data.remaining_cents,
    } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result.content.invoice).not.toHaveProperty('tenant_id');
    expect(calls).toEqual([{ name: 'read_sales_invoice', args: {
      _expected_tenant_id: data.tenant_id, _invoice_id: data.id,
    } }]);
  });

  it('preserves native permission errors even when data is also present', async () => {
    const { result } = await read(record, { code: '42501', message: 'private' });
    expect(result.content.success).toBe(false);
    expect(result.content).not.toHaveProperty('invoice');
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
