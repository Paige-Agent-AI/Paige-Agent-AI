/** Invoice-only persisted facts. Processor/method/channel values are intent, never eligibility or dispatch authority. */
import {parseCommercialConditions,validateCommercialConditionLines,type CommercialConditions} from '../../../supabase/functions/_shared/sales-commercial/conditions.ts';
export type InvoiceAddress = { line1: string | null; line2: string | null; city: string | null; region: string | null; postal_code: string | null; country: string | null };
export type InvoiceItemInput = { price_id: string | null; item: string; description?: string | null; unit_minor: number | null; quantity: number };
export type InvoiceItemSnapshot = Omit<InvoiceItemInput, 'unit_minor'> & { unit_minor: number; price_snapshot: Record<string, unknown> | null };
export type InvoiceSnapshotInput = {
  schema_version: 2 | 3; client_id: string; items: InvoiceItemInput[];
  kind: 'one_time' | 'deposit' | 'recurring'; deposit_basis_points: number | null; currency: 'usd'; cadence: 'monthly' | null;
  /** Version3 exact deposits only; version2 never admits this field. */
  deposit_minor?: number;
  /** Included recorded invoice-line charges; absence is unknown, never implicit zero. */
  commercial_conditions?: CommercialConditions;
  recipient_email: string | null; recipient_phone: string | null; email_source_method_id: string | null; phone_source_method_id: string | null;
  billing_address: InvoiceAddress | null; agreement_id: string | null; processor_intent: string | null; payment_method_intents: string[];
  delivery_channel_intents: ('email' | 'sms')[]; due_date: string | null; memo: string | null;
};
export type InvoiceSnapshot = Omit<InvoiceSnapshotInput, 'items'> & {
  items: InvoiceItemSnapshot[]; agreement_snapshot: { id: string; title: string; version: number; status: string } | null;
  total_minor: number; due_now_minor: number; remainder_minor: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const nullableId = (value: unknown) => value === null || (typeof value === 'string' && uuid.test(value));
const text = (value: unknown, max: number) => value === null || (typeof value === 'string' && value.length <= max);
const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const addressKeys = ['line1', 'line2', 'city', 'region', 'postal_code', 'country'] as const;
const inputKeys = ['schema_version', 'client_id', 'items', 'kind', 'deposit_basis_points', 'currency', 'cadence', 'recipient_email', 'recipient_phone', 'email_source_method_id', 'phone_source_method_id', 'billing_address', 'agreement_id', 'processor_intent', 'payment_method_intents', 'delivery_channel_intents', 'due_date', 'memo'];

/** PostgreSQL amount_total_cents is int4. BigInt also prevents unsafe intermediate products. */
export function aggregateInvoiceItems(items: readonly Pick<InvoiceItemSnapshot, 'unit_minor' | 'quantity'>[], depositBasisPoints?: number, depositMinor?: number) {
  if (items.length < 1 || items.length > 50) throw new Error('Add between one and 50 items.');
  let total = 0n;
  for (const line of items) {
    if (!integer(line.unit_minor) || line.unit_minor < 1 || line.unit_minor > 2147483647
      || !integer(line.quantity) || line.quantity < 1 || line.quantity > 1000) throw new Error('Check item amounts and quantities.');
    total += BigInt(line.unit_minor) * BigInt(line.quantity);
    if (total > 2147483647n) throw new Error('The invoice amount exceeds the supported range.');
  }
  if (depositBasisPoints !== undefined && (!integer(depositBasisPoints) || depositBasisPoints < 1 || depositBasisPoints > 9999)) throw new Error('Check the deposit percentage.');
  if (depositMinor !== undefined && (depositBasisPoints !== undefined || !integer(depositMinor) || depositMinor < 1 || BigInt(depositMinor) >= total)) throw new Error('Check the deposit amount. It must leave a positive balance.');
  const due = depositMinor !== undefined ? BigInt(depositMinor) : depositBasisPoints === undefined ? total : (total * BigInt(depositBasisPoints) + 5000n) / 10000n;
  if (due < 1n || ((depositBasisPoints !== undefined || depositMinor !== undefined) && due >= total)) throw new Error('A deposit must leave a positive balance.');
  return { totalMinor: Number(total), dueNowMinor: Number(due), remainderMinor: Number(total - due) };
}

function readVersioned(value: Record<string, unknown>, expectedTotal: number): InvoiceSnapshot | null {
  const exact=value.schema_version===3;
  if (!only(value, [...inputKeys, ...(exact?['deposit_minor']:[]), 'commercial_conditions', 'agreement_snapshot', 'total_minor', 'due_now_minor', 'remainder_minor'])
    || (value.schema_version !== 2 && !exact) || typeof value.client_id !== 'string' || !uuid.test(value.client_id)
    || !['one_time', 'deposit', 'recurring'].includes(String(value.kind)) || value.currency !== 'usd'
    || (value.kind === 'recurring' ? value.cadence !== 'monthly' : value.cadence !== null)
    || (exact ? value.kind !== 'deposit' || value.deposit_basis_points !== null || !integer(value.deposit_minor)
      : value.kind === 'deposit' ? !integer(value.deposit_basis_points) : value.deposit_basis_points !== null)
    || !nullableId(value.email_source_method_id) || !nullableId(value.phone_source_method_id) || !nullableId(value.agreement_id)
    || !text(value.recipient_email, 254) || !text(value.recipient_phone, 40) || !text(value.memo, 2000) || !text(value.processor_intent, 80)
    || !text(value.due_date, 10) || (value.due_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(value.due_date)))
    || (value.recipient_email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value.recipient_email)))
    || (value.recipient_phone !== null && (!/^\+?[0-9 ()\-.]{7,40}$/.test(String(value.recipient_phone))
      || String(value.recipient_phone).replace(/\D/g, '').length < 7 || String(value.recipient_phone).replace(/\D/g, '').length > 15))
    || !Array.isArray(value.delivery_channel_intents) || value.delivery_channel_intents.length > 2
    || value.delivery_channel_intents.some(channel => channel !== 'email' && channel !== 'sms')
    || new Set(value.delivery_channel_intents).size !== value.delivery_channel_intents.length
    || !Array.isArray(value.items) || !Array.isArray(value.payment_method_intents) || value.payment_method_intents.length > 12
    || value.payment_method_intents.some(method => typeof method !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(method))
    || new Set(value.payment_method_intents).size !== value.payment_method_intents.length) return null;
  if (value.billing_address !== null && (!object(value.billing_address) || !only(value.billing_address, addressKeys)
    || addressKeys.some(key => !text((value.billing_address as Record<string, unknown>)[key], key === 'line1' || key === 'line2' ? 200 : 100)))) return null;
  if (value.agreement_id === null ? value.agreement_snapshot !== null : !object(value.agreement_snapshot)
    || value.agreement_snapshot.id !== value.agreement_id || !only(value.agreement_snapshot, ['id', 'title', 'version', 'status'])
    || typeof value.agreement_snapshot.title !== 'string' || !integer(value.agreement_snapshot.version) || value.agreement_snapshot.version < 1
    || !['draft', 'sent', 'viewed', 'partially_signed', 'completed'].includes(String(value.agreement_snapshot.status))) return null;
  for (const line of value.items) {
    if (!object(line) || !only(line, ['price_id', 'item', 'description', 'unit_minor', 'quantity', 'price_snapshot']) || !nullableId(line.price_id)
      || ('description' in line && !text(line.description, 10000))
      || typeof line.item !== 'string' || !line.item.trim() || line.item.length > 200
      || (line.price_id === null ? line.price_snapshot !== null : !object(line.price_snapshot)
        || !only(line.price_snapshot, ['price_id','product_id','product_name','unit_minor','currency','billing_interval','interval_count'])
        || typeof line.price_snapshot.product_id !== 'string' || !uuid.test(line.price_snapshot.product_id)
        || typeof line.price_snapshot.product_name !== 'string'
        || line.price_snapshot.price_id !== line.price_id || line.price_snapshot.unit_minor !== line.unit_minor || line.price_snapshot.currency !== 'usd'
        || (value.kind === 'recurring' ? line.price_snapshot.billing_interval !== 'month' || line.price_snapshot.interval_count !== 1 : line.price_snapshot.billing_interval !== 'one_time'))) return null;
  }
  try {
    if('commercial_conditions' in value){const conditions=parseCommercialConditions(value.commercial_conditions);if(!conditions)return null;validateCommercialConditionLines(conditions,value.items as InvoiceItemSnapshot[]);}
    const amounts = aggregateInvoiceItems(value.items as InvoiceItemSnapshot[], value.kind === 'deposit' && !exact ? Number(value.deposit_basis_points) : undefined,
      exact ? Number(value.deposit_minor) : undefined);
    if (amounts.totalMinor !== expectedTotal || value.total_minor !== amounts.totalMinor || value.due_now_minor !== amounts.dueNowMinor || value.remainder_minor !== amounts.remainderMinor) return null;
  } catch { return null; }
  return value as InvoiceSnapshot;
}

/** Old facts gain a local view only. No database rewrite or CRM refresh is performed. */
export function normalizeInvoiceSnapshot(value: unknown, expectedTotal: number): InvoiceSnapshot | null {
  if (!object(value)) return null;
  if ('schema_version' in value) return readVersioned(value, expectedTotal);
  if (!only(value, ['client_id','price_id','item','unit_minor','quantity','kind','deposit_basis_points','provider','currency','cadence','due_date','recipient_email','memo','total_minor','due_now_minor','remainder_minor','price_snapshot'])) return null;
  if (!['stripe', 'paypal'].includes(String(value.provider))) return null;
  const candidate = {
    schema_version: 2, client_id: value.client_id,
    items: [{ price_id: value.price_id, item: value.item, unit_minor: value.unit_minor, quantity: value.quantity, price_snapshot: value.price_snapshot ?? null }],
    kind: value.kind, deposit_basis_points: value.deposit_basis_points, currency: value.currency, cadence: value.cadence,
    recipient_email: value.recipient_email, recipient_phone: null, email_source_method_id: null, phone_source_method_id: null,
    billing_address: null, agreement_id: null, agreement_snapshot: null, processor_intent: value.provider, payment_method_intents: [],
    delivery_channel_intents: [], due_date: value.due_date, memo: value.memo,
    total_minor: expectedTotal, due_now_minor: value.due_now_minor, remainder_minor: value.remainder_minor,
  };
  return readVersioned(candidate, expectedTotal);
}

/** A deliberate edit resolves Catalog amounts again; an unknown retry uses the original request instead. */
export function snapshotEditInput(snapshot: InvoiceSnapshot): InvoiceSnapshotInput {
  const { agreement_snapshot: _agreement, total_minor: _total, due_now_minor: _due, remainder_minor: _remainder, ...input } = snapshot;
  return { ...input, ...(input.commercial_conditions ? { commercial_conditions: structuredClone(input.commercial_conditions) } : {}), billing_address: input.billing_address ? { ...input.billing_address } : null,
    payment_method_intents: [...input.payment_method_intents], delivery_channel_intents: [...input.delivery_channel_intents],
    items: snapshot.items.map(({ price_snapshot: _price, ...line }) => ({ ...line, unit_minor: line.price_id === null ? line.unit_minor : null })) };
}
