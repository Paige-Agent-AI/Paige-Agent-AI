// Identity/version of the ORIGINAL saved message, never permission to read or send it.
// Keep Postgres microseconds verbatim: Date/ISO normalization would lose a stale-write fence.
import { UUID } from "./contract.ts";

export interface CommsEmailDraftSource {
  message_id: string;
  updated_at: string;
}

export function parseCommsEmailDraftSource(value: unknown): CommsEmailDraftSource {
  const invalid = () => new TypeError("COMMS_EMAIL_DRAFT_SOURCE_INVALID");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 2 || !Object.hasOwn(v, "message_id") || !Object.hasOwn(v, "updated_at")
    || typeof v.message_id !== "string" || !UUID.test(v.message_id) || typeof v.updated_at !== "string") throw invalid();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(v.updated_at);
  if (!m) throw invalid();
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const days = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (year < 100 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59
    || (m[7] !== "Z" && (Number(m[9]) > 14 || Number(m[10]) > 59 || (Number(m[9]) === 14 && Number(m[10]) !== 0)))) throw invalid();
  return Object.freeze({ message_id: v.message_id.toLowerCase(), updated_at: v.updated_at });
}

export function commsEmailDraftSourcesEqual(a: CommsEmailDraftSource | undefined, b: CommsEmailDraftSource | undefined): boolean {
  return a === undefined || b === undefined ? a === b : a.message_id === b.message_id && a.updated_at === b.updated_at;
}
