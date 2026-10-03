import { billingDraftFailure, readBillingDraft, type BillingRpc, type DraftResult } from './billingDrafts';
import { normalizeInvoiceSnapshot, type InvoiceSnapshot, type InvoiceSnapshotInput } from './invoiceDraftSnapshot';

export type InvoiceDraft = { id: string; tenantId: string; version: number; schemaVersion: 1 | 2; number: string; totalMinor: number; snapshot: InvoiceSnapshot };
export type InvoiceDraftSaveRequest = { openedTenantId: string; invoiceId: string; expectedVersion: number; operationId: string; draft: InvoiceSnapshotInput };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const version = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Dual-schema reader deployed before the expanded UI writer. Unknown schemas fail the whole read. */
export function readInvoiceDraft(value: unknown, tenantId: string): InvoiceDraft | null {
  if (!object(value) || value.tenant_id !== tenantId || typeof value.id !== 'string' || !uuid.test(value.id)
    || value.status !== 'draft' || !version(value.billing_draft_version) || value.billing_draft_version < 1
    || !version(value.amount_total_cents) || value.amount_total_cents < 1 || value.amount_total_cents > 2147483647
    || typeof value.invoice_number !== 'string' || !object(value.billing_draft)) return null;
  const schemaVersion = value.billing_draft.schema_version === 2 ? 2 : 1;
  if (schemaVersion === 1 && !readBillingDraft(value, tenantId)) return null;
  const snapshot = normalizeInvoiceSnapshot(value.billing_draft, value.amount_total_cents);
  return snapshot ? { id: value.id, tenantId, version: value.billing_draft_version, schemaVersion, number: value.invoice_number, totalMinor: value.amount_total_cents, snapshot } : null;
}

export async function saveInvoiceDraft(rpc: BillingRpc, request: InvoiceDraftSaveRequest): Promise<DraftResult<InvoiceDraft>> {
  if (![request.openedTenantId, request.invoiceId, request.operationId].every(value => uuid.test(value)) || !version(request.expectedVersion)) {
    return { ok: false, outcome: 'refused', message: 'Reopen this draft in its workspace before saving.' };
  }
  try {
    const { data, error } = await rpc('save_sales_billing_draft', {
      _expected_tenant_id: request.openedTenantId, _invoice_id: request.invoiceId,
      _expected_version: request.expectedVersion, _operation_id: request.operationId, _draft: request.draft,
    });
    if (error) return billingDraftFailure(error);
    const row = object(data) ? readInvoiceDraft(data.row, request.openedTenantId) : null;
    if (!row || row.id !== request.invoiceId || row.version !== request.expectedVersion + 1) return billingDraftFailure(null);
    return { ok: true, value: row };
  } catch { return billingDraftFailure(null); }
}

export async function listInvoiceDrafts(rpc: BillingRpc, tenantId: string, beforeId: string | null = null): Promise<DraftResult<{ rows: InvoiceDraft[]; hasMore: boolean; nextCursor: string | null }>> {
  if (!uuid.test(tenantId) || (beforeId !== null && !uuid.test(beforeId))) return { ok: false, outcome: 'refused', message: 'This workspace could not be resolved.' };
  try {
    const { data, error } = await rpc('list_sales_billing_drafts', { _expected_tenant_id: tenantId, _limit: 50, _before_id: beforeId });
    if (error) return billingDraftFailure(error);
    if (!object(data) || !Array.isArray(data.rows) || data.rows.length > 50 || typeof data.has_more !== 'boolean'
      || (data.next_cursor !== null && (typeof data.next_cursor !== 'string' || !uuid.test(data.next_cursor)))) return billingDraftFailure(null);
    const rows = data.rows.map(row => readInvoiceDraft(row, tenantId));
    if (rows.some(row => row === null)) return billingDraftFailure(null);
    return { ok: true, value: { rows: rows as InvoiceDraft[], hasMore: data.has_more, nextCursor: data.next_cursor as string | null } };
  } catch { return billingDraftFailure(null); }
}
