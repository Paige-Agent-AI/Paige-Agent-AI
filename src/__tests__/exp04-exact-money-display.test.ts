import { describe, expect, it, vi } from 'vitest';
import { money } from '../../supabase/functions/_shared/client-engagement/chat';
import { formatPaymentMinor } from '../solo/sales/customerPaymentRequest';

describe('exact original minor-unit presentation', () => {
  it.each([
    [Number.MAX_SAFE_INTEGER, 'USD', 'USD 90,071,992,547,409.91'],
    [-Number.MAX_SAFE_INTEGER, 'USD', 'USD -90,071,992,547,409.91'],
    [Number.MAX_SAFE_INTEGER, 'KWD', 'KWD 9,007,199,254,740.991'],
    [350000, 'USD', 'USD 3,500.00'],
    [-1, 'USD', 'USD -0.01'],
    [Number.MAX_SAFE_INTEGER, 'JPY', 'JPY 9,007,199,254,740,991'],
  ])('standing retains every accepted minor unit: %s %s', (minor, currency, expected) => {
    expect(money(minor, currency)).toBe(expected);
  });

  it.each([
    [Number.MAX_SAFE_INTEGER, 'USD', '$90,071,992,547,409.91'],
    [-Number.MAX_SAFE_INTEGER, 'USD', '-$90,071,992,547,409.91'],
    [Number.MAX_SAFE_INTEGER, 'KWD', 'KWD\u00a09,007,199,254,740.991'],
    [50000, 'USD', '$500.00'],
    [-1, 'USD', '-$0.01'],
  ])('the original customer request retains every minor unit: %s %s', (minor, currency, expected) => {
    expect(formatPaymentMinor(minor, currency)).toBe(expected);
  });

  it('retains exact native integer strings beyond the Number boundary', () => {
    expect(money('9223372036854775807', 'USD')).toBe('USD 92,233,720,368,547,758.07');
    expect(formatPaymentMinor('9223372036854775807', 'USD')).toBe('$92,233,720,368,547,758.07');
  });

  it('never turns missing, fractional or already-unsafe Number input into a financial figure', () => {
    expect(money(null, 'USD')).toBe('not known');
    expect(money(1.5, 'USD')).toBe('not known');
    expect(money(Number.MAX_SAFE_INTEGER + 1, 'USD')).toBe('not known');
    expect(formatPaymentMinor(Number.NaN, 'USD')).toBe('Amount unavailable');
    expect(formatPaymentMinor(Number.MAX_SAFE_INTEGER + 1, 'USD')).toBe('Amount unavailable');
  });

  it('keeps absent currency explicit and refuses malformed currency precision', () => {
    expect(money(12345, null)).toBe('12345 (minor units; currency not recorded)');
    expect(money(12345, '$')).toBe('not known');
    expect(formatPaymentMinor(12345, '$')).toBe('Amount unavailable');
  });

  it.each([
    ['9223372036854775807', 'KWD', 'KWD 9,223,372,036,854,775.807'],
    ['9223372036854775807', 'JPY', 'JPY 9,223,372,036,854,775,807'],
    ['9223372036854775807', 'CLF', 'CLF 922,337,203,685,477.5807'],
    ['-1', 'KWD', 'KWD -0.001'],
    ['0', 'KWD', 'KWD 0.000'],
    ['-0', 'USD', 'USD 0.00'],
  ])('native integer text retains currency precision without Number conversion: %s %s', (minor, currency, expected) => {
    expect(money(minor, currency)).toBe(expected);
  });

  it('preserves the customer locale, grouping, currency placement and signed sub-unit', () => {
    expect(formatPaymentMinor('9223372036854775807', 'EUR', 'de-DE')).toBe('92.233.720.368.547.758,07\u00a0€');
    expect(formatPaymentMinor('123456789', 'INR', 'hi-IN')).toBe('₹12,34,567.89');
    expect(formatPaymentMinor(-1, 'USD', 'ar-EG')).toBe(new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'USD' }).format(-0.01));
  });

  it.each(['', '01', '+1', '1.0', '1e3', ' 1', '1 ', 'NaN', '9'.repeat(129)])('does not silently reinterpret malformed native units: %s', minor => {
    expect(money(minor, 'USD', 'amount held')).toBe('amount held');
    expect(formatPaymentMinor(minor, 'USD')).toBe('Amount unavailable');
  });

  it('retains exact native units instead of inventing precision for an unknown currency', () => {
    expect(money('9223372036854775807', 'ZZZ')).toBe('ZZZ 9223372036854775807 (minor units; currency precision unavailable)');
    expect(formatPaymentMinor('9223372036854775807', 'ZZZ')).toBe('ZZZ 9223372036854775807 (minor units; currency precision unavailable)');
  });

  it('retains units when the runtime has no currency metadata and recovers when it returns', () => {
    const metadata = vi.spyOn(Intl.DisplayNames.prototype, 'of').mockReturnValueOnce(undefined);
    try {
      expect(formatPaymentMinor(12345, 'USD')).toBe('USD 12345 (minor units; currency precision unavailable)');
      expect(formatPaymentMinor(12345, 'USD')).toBe('$123.45');
    } finally {
      metadata.mockRestore();
    }
  });
});
