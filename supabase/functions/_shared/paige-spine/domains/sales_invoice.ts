import type { SpineCapability } from '../contracts.ts';

// Declarations reflect the bound dispatch, not authenticated delivery. The Sales surface remains
// PROOF_OWED; no processor charge, delivered email, link creation or Mind capability is claimed.
const mutations = [
  ['publish', 'sales_publish_invoice'], ['record_manual_payment', 'sales_record_manual_payment'],
  ['reverse_manual_payment', 'sales_reverse_manual_payment'], ['void', 'sales_void_invoice'],
] as const;
export const SALES_INVOICE_CAPABILITIES: readonly SpineCapability[] = [
  { key: 'sales_invoice.read', domain: 'sales_invoice', owner: 'sales', humanSurface: '/solo/:account/sales?tab=payments',
    action: { classification: 'read', executor: 'public.read_sales_invoice', chatTool: 'read_sales_invoice', riskPolicyKey: 'read_only', approvalAuthority: 'none', idempotency: 'Read-only; authenticated tenant and owner/admin role are revalidated by the RPC.' },
    outcome: { kinds: ['available', 'refused', 'failed'], projector: 'public.read_sales_invoice', railVisibility: 'Only safe current invoice and manual receipt facts; manual settlement is not processor verification.' },
    chatBinding: 'LIVE', mindBinding: 'UNAVAILABLE', sharedPrimitiveChange: 'NONE', maturity: 'PARTIAL' },
  ...mutations.map(([verb, chatTool]): SpineCapability => ({
    key: `sales_invoice.${verb}`, domain: 'sales_invoice', owner: 'sales', humanSurface: '/solo/:account/sales?tab=payments',
    action: { classification: 'mutate', executor: 'public.execute_sales_invoice_command', chatTool, riskPolicyKey: 'high', approvalAuthority: 'chat-canonical', idempotency: 'Canonical tenant + actor + operation UUID and stored command result. Chat derives operation UUID from stable user turn and command; approved calls reuse stored arguments. Only sales-invoice-command atomically consumes the canonical approval.' },
    outcome: { kinds: ['published', 'manual_payment_recorded', 'manual_payment_reversed', 'voided', 'refused', 'outcome_unknown'], projector: 'public.read_sales_invoice_command_result', railVisibility: 'Canonical governed command receipt and readback only. Never claims money was charged, refunded, sent, or provider verified.' },
    chatBinding: 'LIVE', mindBinding: 'UNAVAILABLE', sharedPrimitiveChange: 'NONE', maturity: 'PARTIAL',
  })),
  { key: 'sales_invoice.email_send', domain: 'sales_invoice', owner: 'sales', humanSurface: '/solo/:account/sales?tab=payments',
    action: { classification: 'external_effect', executor: 'public.prepare_sales_invoice_delivery', chatTool: 'billing_send_invoice', riskPolicyKey: 'high', approvalAuthority: 'chat-canonical', idempotency: 'Canonical tenant + actor + stored operation UUID through sales-invoice-command and executeSalesInvoiceDelivery. Server connection and issued invoice are revalidated; send-message admission uses public.claim_sales_invoice_delivery, then public.finalize_sales_invoice_delivery. Unknown provider results require reconciliation, never a new-operation retry.' },
    outcome: { kinds: ['provider_accepted', 'refused', 'failed', 'unknown', 'outcome_unknown'], projector: 'public.read_sales_invoice_delivery_result', railVisibility: 'Records verified provider acceptance only, never delivered, read or paid. Provider eligibility and authenticated runtime remain UNVERIFIED.' },
    chatBinding: 'LIVE', mindBinding: 'UNAVAILABLE', sharedPrimitiveChange: 'NONE', maturity: 'PARTIAL' },
];
