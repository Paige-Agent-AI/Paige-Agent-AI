import { FunctionsHttpError } from '@supabase/supabase-js';

export const BOOKING_CONFIRMATION_UNKNOWN = "We couldn’t confirm whether your booking was saved. Contact the business before booking again. Your entered details are kept here.";

export type BookingReceipt = { id: string; startAt: string; endAt: string; title: string };
export type BookingCreateResult =
  | { kind: 'confirmed'; booking: BookingReceipt; manageUrl: string | null }
  | { kind: 'refused'; status: number; message: string; chooseAnotherTime: boolean }
  | { kind: 'unknown' };

type Choice = { startAt: string; durationMin: number; pageOrigin: string; appOrigin: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const instant = (value: unknown) => typeof value === 'string' && value.length <= 64 && TIMESTAMP.test(value) ? Date.parse(value) : NaN;

function manageLink(raw: unknown, choice: Choice): string | null {
  if (typeof raw !== 'string' || raw.length > 4096 || !raw.trim()) return null;
  try {
    const url = new URL(raw, choice.appOrigin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash
      || ![choice.appOrigin, choice.pageOrigin].includes(url.origin) || url.pathname !== '/booking/manage'
      || !url.searchParams.get('token')) return null;
    return url.href;
  } catch { return null; }
}

/** An original booking acknowledgement is not permission, delivery proof or a retry receipt. */
export function readBookingCreateResult(data: unknown, error: unknown, choice: Choice): BookingCreateResult {
  if (error) {
    // Only the SDK's actual HTTP response identifies these original pre-booking refusals.
    // A plain shaped error, transport error or 5xx may follow a write: keep it unknown.
    if (error instanceof FunctionsHttpError && typeof globalThis.Response === 'function' && error.context instanceof globalThis.Response) {
      const status = error.context.status;
      const messages: Record<number, string> = {
        400: 'Check your details and try again.',
        401: 'This booking request was not accepted. Reload the page before trying again.',
        403: 'This business isn’t accepting bookings here right now. Contact the business.',
        404: 'This booking page isn’t available. Contact the business.',
        409: 'That time is no longer available. Please choose another.',
        429: 'Too many attempts. Please wait before trying again.',
      };
      if (messages[status]) return { kind: 'refused', status, message: messages[status], chooseAnotherTime: status === 409 };
    }
    return { kind: 'unknown' };
  }
  if (!object(data) || !own(data, 'ok') || data.ok !== true || !own(data, 'booking') || !object(data.booking)) return { kind: 'unknown' };
  if (own(data, 'status') || (own(data, 'error') && data.error !== null && data.error !== undefined)) return { kind: 'unknown' };
  const b = data.booking;
  if (!['id', 'start_at', 'end_at', 'title'].every(key => own(b, key))
    || typeof b.id !== 'string' || !UUID.test(b.id) || typeof b.title !== 'string' || !b.title.trim() || b.title.length > 500) return { kind: 'unknown' };
  const start = instant(b.start_at), end = instant(b.end_at), expected = instant(choice.startAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(expected)
    || !Number.isInteger(choice.durationMin) || choice.durationMin <= 0 || start !== expected
    || end <= start || end - start !== choice.durationMin * 60_000) return { kind: 'unknown' };
  return {
    kind: 'confirmed',
    booking: { id: b.id, title: b.title, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() },
    manageUrl: manageLink(b.manageUrl ?? b.manage_url ?? data.manageUrl, choice),
  };
}
