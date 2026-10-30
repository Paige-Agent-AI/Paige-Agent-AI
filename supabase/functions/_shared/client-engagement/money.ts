/**
 * Presentation only, shared by the original standing answer and payment request.
 * Keep native integer text exact; never divide an amount through floating point.
 * This establishes no payment, allocation, currency conversion or action authority.
 */
export function formatExactMinor(
  minor: number | string | null,
  currency: string | null,
  options: { locale?: string | string[]; currencyDisplay?: 'symbol' | 'code' } = {},
): string | null {
  const text = typeof minor === 'number'
    ? Number.isSafeInteger(minor) ? String(minor) : null
    : typeof minor === 'string' && minor.length <= 128 && /^-?(0|[1-9][0-9]*)$/.test(minor)
      ? minor : null;
  if (text === null) return null;
  // Canonical integer sources have no negative zero, but a caller may supply it.
  const integer = BigInt(text);
  if (!currency) return `${integer} (minor units; currency not recorded)`;
  if (!/^[a-z]{3}$/i.test(currency)) return null;
  const code = currency.toUpperCase();
  try {
    // Intl otherwise assigns an invented two-digit default to an unknown code.
    // DisplayNames includes defined units such as CLF that supportedValuesOf's
    // selectable list omits. No hand-maintained currency/precision table.
    const known = typeof Intl.DisplayNames === 'function'
      ? new Intl.DisplayNames('en', { type: 'currency', fallback: 'none' }).of(code)
      : undefined;
    if (!known) {
      return `${code} ${integer} (minor units; currency precision unavailable)`;
    }
    const currencyFormatter = new Intl.NumberFormat(options.locale, { style: 'currency', currency: code });
    const resolved = currencyFormatter.resolvedOptions();
    const digits = resolved.maximumFractionDigits;
    if (typeof digits !== 'number' || !Number.isInteger(digits) || digits < 0 || digits > 20) return null;
    const negative = integer < BigInt(0);
    const absolute = (negative ? -integer : integer).toString().padStart(digits + 1, '0');
    const whole = BigInt(digits === 0 ? absolute : absolute.slice(0, -digits));
    const fraction = digits === 0 ? '' : absolute.slice(-digits);
    const formatter = options.currencyDisplay === 'code'
      ? new Intl.NumberFormat(resolved.locale, {
        numberingSystem: resolved.numberingSystem,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
      : currencyFormatter;
    // BigInt has no negative zero; Intl must still retain the sign of -1 cent.
    const signedWhole = negative ? whole === BigInt(0) ? -0 : -whole : whole;
    const parts = formatter.formatToParts(signedWhole);
    if (digits > 0 && !parts.some(part => part.type === 'fraction')) return null;
    const exactFraction = digits === 0 ? '' : new Intl.NumberFormat(resolved.locale, {
      numberingSystem: resolved.numberingSystem,
      useGrouping: false,
      minimumIntegerDigits: digits,
      maximumFractionDigits: 0,
    }).format(BigInt(fraction));
    const amount = parts.map(part => part.type === 'fraction' ? exactFraction : part.value).join('');
    return options.currencyDisplay === 'code' ? `${code} ${amount}` : amount;
  } catch {
    return null;
  }
}
