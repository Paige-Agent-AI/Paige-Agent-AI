/** Display-only labels. Canonical lifecycle and approval identity remain server owned. */
export function invoicePaymentStatus(status: 'draft' | 'issued' | 'void', total: number, recorded: number, remaining: number): string {
  if (status === 'draft') return 'Draft · not issued';
  if (status === 'void') return 'Void';
  if (![total, recorded, remaining].every(n => Number.isSafeInteger(n) && n >= 0) || recorded + remaining !== total) return 'Issued · balance unavailable';
  if (remaining === 0) return 'Paid · business-recorded';
  if (recorded > 0) return 'Partially paid · outstanding';
  return 'Issued · outstanding';
}

export function invoiceDisplayNumber(value: unknown, issued = true): string {
  if (typeof value === 'string' && /^DRAFT-[0-9a-f-]{36}$/i.test(value)) return issued ? 'Previously issued invoice' : 'Assigned when issued';
  return typeof value === 'string' && value.trim() ? value : 'Invoice number unavailable';
}
