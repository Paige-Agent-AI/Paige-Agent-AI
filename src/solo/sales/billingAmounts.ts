/** Pure arithmetic for billing drafts, never evidence of an issued bill or collected payment.
 * Currency exponent is explicit: the caller must obtain it from its validated currency contract.
 * Canonical writes must revalidate all amounts and source records on the server.
 */
function minor(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid minor-unit amount");
}

export function parseMinorAmount(input: string, exponent: number): number {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 3) throw new Error("Unsupported currency exponent");
  const value = input.trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Enter a decimal amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > exponent) throw new Error("Amount exceeds currency precision");
  // Build the integer string directly: no binary floating-point price conversion.
  const result = Number(whole + fraction.padEnd(exponent, "0"));
  minor(result);
  return result;
}

export function calculateBillingAmounts(unitMinor: number, quantity: number, depositBasisPoints?: number) {
  minor(unitMinor);
  if (unitMinor === 0) throw new Error("Billing amount must be positive");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error("Invalid quantity");
  const totalMinor = unitMinor * quantity;
  minor(totalMinor);
  if (depositBasisPoints === undefined) return { totalMinor, dueNowMinor: totalMinor, remainderMinor: 0 };
  if (!Number.isInteger(depositBasisPoints) || depositBasisPoints < 1 || depositBasisPoints > 9999) {
    throw new Error("Deposit must be between zero and the full obligation");
  }
  // BigInt prevents multiplication from overflowing before rounding to the nearest minor unit.
  const dueNowMinor = Number((BigInt(totalMinor) * BigInt(depositBasisPoints) + 5000n) / 10000n);
  if (dueNowMinor === 0 || dueNowMinor >= totalMinor) throw new Error("Deposit must leave a positive balance");
  return { totalMinor, dueNowMinor, remainderMinor: totalMinor - dueNowMinor };
}

/** Cumulative confirmed allocations and allocation reversals, not invoice status or payout state.
 * Refunding and then repaying can make cumulative gross allocations exceed the obligation.
 */
export function remainingObligation(totalMinor: number, allocatedMinor: number, refundedMinor: number): number {
  minor(totalMinor); minor(allocatedMinor); minor(refundedMinor);
  if (refundedMinor > allocatedMinor || allocatedMinor - refundedMinor > totalMinor) throw new Error("Allocation evidence is inconsistent");
  return totalMinor - (allocatedMinor - refundedMinor);
}
