/** Canonical Sales draft API. No provider dispatch, invoice issue or payment success inference. */
export type BillingDraftInput = {
  client_id: string; price_id: string | null; item: string; unit_minor: number | null;
  quantity: number; kind: "one_time" | "deposit" | "recurring";
  deposit_basis_points: number | null; provider: "stripe" | "paypal";
  currency: "usd"; due_date: string | null; recipient_email: string | null; memo: string | null;
  cadence: "monthly" | null;
};
export type BillingDraft = {
  id: string; tenantId: string; version: number; number: string;
  totalMinor: number; facts: BillingDraftFacts; dueNowMinor: number; remainderMinor: number;
};
export type BillingDraftFacts = Omit<BillingDraftInput, 'unit_minor'> & { unit_minor: number };
/** Catalog amounts are persisted evidence; edits must resolve the current price on the server. */
export function billingDraftEditInput(facts: BillingDraftFacts): BillingDraftInput {
  const { client_id, price_id, item, unit_minor, quantity, kind, deposit_basis_points, provider, currency, due_date, recipient_email, memo, cadence } = facts;
  return { client_id, price_id, item, unit_minor: price_id === null ? unit_minor : null, quantity, kind, deposit_basis_points, provider, currency, due_date, recipient_email, memo, cadence };
}
export type DraftSaveRequest = {
  openedTenantId: string; invoiceId: string; expectedVersion: number;
  operationId: string; draft: BillingDraftInput;
};
export type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
export type BillingRpc = (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
export type DraftResult<T> = { ok: true; value: T } | { ok: false; outcome: "refused" | "unknown" | "unavailable"; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const money = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export function readBillingDraft(value: unknown, expectedTenant: string): BillingDraft | null {
  if (!object(value) || value.tenant_id !== expectedTenant || typeof value.id !== "string" || !uuid.test(value.id)
    || typeof value.invoice_number !== "string" || value.status !== "draft"
    || !money(value.billing_draft_version) || value.billing_draft_version < 1
    || !money(value.amount_total_cents) || value.amount_total_cents === 0 || !object(value.billing_draft)) return null;
  const f = value.billing_draft;
  if (!['one_time', 'deposit', 'recurring'].includes(String(f.kind)) || !['stripe', 'paypal'].includes(String(f.provider))
    || f.currency !== 'usd' || typeof f.client_id !== 'string' || !uuid.test(f.client_id)
    || typeof f.item !== 'string' || (f.recipient_email !== null && typeof f.recipient_email !== 'string')
    || (f.due_date !== null && typeof f.due_date !== 'string') || (f.memo !== null && typeof f.memo !== 'string')
    || (f.price_id !== null && (typeof f.price_id !== 'string' || !uuid.test(f.price_id)))
    || (f.kind === 'recurring' ? f.cadence !== 'monthly' : f.cadence !== null)
    || (f.kind === 'deposit' ? !Number.isInteger(f.deposit_basis_points) || Number(f.deposit_basis_points) < 1 || Number(f.deposit_basis_points) > 9999 : f.deposit_basis_points !== null)
    || !money(f.unit_minor) || f.unit_minor === 0 || !Number.isInteger(f.quantity) || Number(f.quantity) < 1 || Number(f.quantity) > 1000
    || f.unit_minor * Number(f.quantity) !== value.amount_total_cents
    || !money(f.due_now_minor) || !money(f.remainder_minor)
    || f.due_now_minor + f.remainder_minor !== value.amount_total_cents) return null;
  return { id: value.id, tenantId: expectedTenant, version: value.billing_draft_version, number: value.invoice_number,
    totalMinor: value.amount_total_cents, facts: f as BillingDraftFacts, dueNowMinor: f.due_now_minor, remainderMinor: f.remainder_minor };
}

export function billingDraftFailure(error: RpcResult['error']): DraftResult<never> {
  if (error?.code === '42883' || error?.code === 'PGRST202') return { ok: false, outcome: 'unavailable', message: 'Billing draft storage is unavailable in this environment.' };
  if (error?.code && (/^PA/.test(error.code) || ['42501', '22023', '22P02', '22007', '22008', '40001', '23505'].includes(error.code))) {
    return { ok: false, outcome: 'refused', message: error.code === '40001' ? 'This draft changed. Reopen its current version before saving.' : 'The draft was refused. Check workspace, access and billing details.' };
  }
  return { ok: false, outcome: 'unknown', message: 'The save could not be confirmed. Keep this draft and retry the same operation after checking its record.' };
}

export async function saveBillingDraft(rpc: BillingRpc, request: DraftSaveRequest): Promise<DraftResult<BillingDraft>> {
  if (![request.openedTenantId, request.invoiceId, request.operationId].every(v => uuid.test(v))
    || !money(request.expectedVersion)) return { ok: false, outcome: 'refused', message: 'Reopen this draft in its workspace before saving.' };
  try {
    const { data, error } = await rpc('save_sales_billing_draft', {
      _expected_tenant_id: request.openedTenantId, _invoice_id: request.invoiceId,
      _expected_version: request.expectedVersion, _operation_id: request.operationId, _draft: request.draft,
    });
    if (error) return billingDraftFailure(error);
    const row = object(data) ? readBillingDraft(data.row, request.openedTenantId) : null;
    if (!row || row.id !== request.invoiceId || row.version !== request.expectedVersion + 1) return billingDraftFailure(null);
    return { ok: true, value: row };
  } catch { return billingDraftFailure(null); }
}

export async function listBillingDrafts(rpc: BillingRpc, tenantId: string, beforeId: string | null = null): Promise<DraftResult<{ rows: BillingDraft[]; hasMore: boolean; nextCursor: string | null }>> {
  if (!uuid.test(tenantId) || (beforeId !== null && !uuid.test(beforeId))) return { ok: false, outcome: 'refused', message: 'This workspace could not be resolved.' };
  try {
    const { data, error } = await rpc('list_sales_billing_drafts', { _expected_tenant_id: tenantId, _limit: 50, _before_id: beforeId });
    if (error) return billingDraftFailure(error);
    if (!object(data) || !Array.isArray(data.rows) || data.rows.length > 50 || typeof data.has_more !== 'boolean') return billingDraftFailure(null);
    const rows = data.rows.map(row => readBillingDraft(row, tenantId));
    if (rows.some(row => row === null) || (data.next_cursor !== null && (typeof data.next_cursor !== 'string' || !uuid.test(data.next_cursor)))) return billingDraftFailure(null);
    return { ok: true, value: { rows: rows as BillingDraft[], hasMore: data.has_more, nextCursor: data.next_cursor as string | null } };
  } catch { return billingDraftFailure(null); }
}
