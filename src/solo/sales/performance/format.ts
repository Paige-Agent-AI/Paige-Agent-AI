import { currencyDigits } from "../collections/presentation";

/** Formatting only: the server owns every amount and metric formula. */
export function formatMetricMoney(amountMinor: string, currency: string): string {
  const digits = currencyDigits(currency);
  if (digits === null || !/^-?\d+$/.test(amountMinor)) return `Amount unavailable (${currency})`;
  const amount = BigInt(amountMinor), scale = 10n ** BigInt(digits);
  const magnitude = amount < 0n ? -amount : amount;
  const whole = magnitude / scale, fraction = (magnitude % scale).toString().padStart(digits, "0");
  const parts = new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).formatToParts(whole);
  return `${amount < 0n ? "−" : ""}${parts.map(part => part.type === "fraction" ? fraction : part.value).join("")}`;
}

/** Bounded chart geometry, never a financial total or displayed KPI. */
export function chartRatio(amount: string, maximum: string): number {
  if (!/^-?\d+$/.test(amount) || !/^-?\d+$/.test(maximum)) return 0;
  const value = BigInt(amount), limit = BigInt(maximum);
  if (value <= 0n || limit <= 0n) return 0;
  return Number((value > limit ? limit : value) * 10000n / limit) / 100;
}
export function chartMaximum(amounts: string[]): string {
  return amounts.reduce((maximum, amount) => /^-?\d+$/.test(amount) && BigInt(amount) > BigInt(maximum) ? amount : maximum, "0");
}
export function performanceDate(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}
