/** Display-only labels. Canonical lifecycle and approval identity remain server owned. */
export function invoiceRecordAmountLabels(status: 'draft' | 'issued' | 'void') {
  if (status === 'draft') return {total:'Draft total',requested:'Planned initial amount',schedule:'Planned later amount',balance:'Unissued draft amount'} as const;
  if (status === 'void') return {total:'Original invoice total',requested:'Original requested amount',schedule:'Original remaining schedule',balance:'Recorded balance (voided)'} as const;
  return {total:'Total obligation',requested:'Original requested amount',schedule:'Original remaining schedule',balance:'Outstanding balance'} as const;
}

export function invoicePaymentStatus(status: 'draft' | 'issued' | 'void', total: number, recorded: number, remaining: number, verified = 0): string {
  if (status === 'draft') return 'Draft · not issued';
  if (status === 'void') return 'Void';
  if (![total, recorded, verified, remaining].every(n => Number.isSafeInteger(n) && n >= 0) || recorded + verified + remaining !== total) return 'Issued · balance unavailable';
  if (remaining === 0) return verified > 0 ? (recorded > 0 ? 'Paid · confirmed and business-recorded' : 'Paid · provider-confirmed') : 'Paid · business-recorded';
  if (recorded + verified > 0) return 'Partially paid · outstanding';
  return 'Issued · outstanding';
}

export function invoiceDisplayNumber(value: unknown, issued = true): string {
  if (typeof value === 'string' && /^DRAFT-[0-9a-f-]{36}$/i.test(value)) return issued ? 'Previously issued invoice' : 'Assigned when issued';
  return typeof value === 'string' && value.trim() ? value : 'Invoice number unavailable';
}
