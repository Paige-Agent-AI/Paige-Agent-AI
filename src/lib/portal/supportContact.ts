import { z } from "zod";

// A contact is public business presentation, never authority to send or delete.
// Refuse malformed mailto/header input and the platform's generic help contacts.
export function normalizePortalSupportEmail(value: unknown): string | null {
  if (typeof value !== "string" || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  const email = value.trim();
  if (!z.string().email().max(254).safeParse(email).success) return null;
  if (/^(?:privacy|support|help|no-?reply)@(?:mail\.)?paigeagent\.ai$/i.test(email)) return null;
  return email;
}

export function portalSupportHref(value: unknown): string | null {
  const email = normalizePortalSupportEmail(value);
  return email ? `mailto:${encodeURIComponent(email)}` : null;
}
