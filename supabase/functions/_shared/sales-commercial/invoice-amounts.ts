/** One invoice amount calculation for the native draft door and its editor. */
export type InvoiceAmountLine = { unit_minor: number; quantity: number };
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

/** PostgreSQL amount_total_cents is int4. BigInt also prevents unsafe intermediate products. */
export function aggregateInvoiceItems(items: readonly InvoiceAmountLine[], depositBasisPoints?: number, depositMinor?: number) {
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
