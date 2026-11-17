import type { OriginalDocumentReference } from "@/components/chat/documentWorkRecovery";

export const PRIVATE_DOCUMENT_WORK_CHANGED = "paige:private-document-work-changed";

const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

function storageKey(actorId: string, tenantId: string) {
  return uuid(actorId) && uuid(tenantId) ? `paige:private-document-work:${tenantId}:${actorId}` : null;
}

// This is a tab-local locator. The original status endpoint decides current access.
export function privateDocumentWorkSnapshot(actorId: string, tenantId: string): string | null {
  const key = storageKey(actorId, tenantId);
  if (!key) return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export type PrivateOpportunityReference = { kind: "opportunity"; dealId: string; correlationId: string };
export type PrivateOriginalWorkReference = (OriginalDocumentReference & { kind?: "research" }) | PrivateOpportunityReference;

export function parsePrivateDocumentWork(raw: string | null): PrivateOriginalWorkReference | null {
  if (!raw || raw.length > 184) return null;
  try {
    const saved = JSON.parse(raw);
    if (saved?.kind === "opportunity") {
      return Object.keys(saved).length === 3 && uuid(saved.dealId) && uuid(saved.correlationId)
        && saved.dealId.length === 36 && saved.correlationId.length === 36
        ? { kind: "opportunity", dealId: saved.dealId, correlationId: saved.correlationId } : null;
    }
    if (!saved || typeof saved !== "object" || Array.isArray(saved) ||
      (saved.kind !== undefined && saved.kind !== "research")) return null;
    if (saved.kind !== "research" && raw.length > 160) return null;
    const { threadId, intentId, workId } = saved;
    if (!uuid(threadId) || !uuid(intentId) || !uuid(workId)) return null;
    return saved.kind === "research"
      ? { kind: "research", threadId, intentId, workId }
      : { threadId, intentId, workId };
  } catch {
    return null;
  }
}

export function keepPrivateDocumentWork(actorId: string, tenantId: string, reference: OriginalDocumentReference) {
  return keepPrivateWork(actorId, tenantId, reference);
}

export function keepPrivateResearchWork(actorId: string, tenantId: string, reference: OriginalDocumentReference) {
  return keepPrivateWork(actorId, tenantId, reference, "research");
}

export function keepPrivateOpportunity(actorId: string, tenantId: string, dealId: string, correlationId: string) {
  const key = storageKey(actorId, tenantId);
  const value = { kind: "opportunity" as const, dealId, correlationId };
  if (!key || actorId.length !== 36 || tenantId.length !== 36
    || !parsePrivateDocumentWork(JSON.stringify(value))) return false;
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { return false; }
  window.dispatchEvent(new Event(PRIVATE_DOCUMENT_WORK_CHANGED));
  return true;
}

function keepPrivateWork(actorId: string, tenantId: string, reference: OriginalDocumentReference, kind?: "research") {
  const key = storageKey(actorId, tenantId);
  const { threadId, intentId, workId } = reference;
  if (!key || !uuid(threadId) || !uuid(intentId) || !uuid(workId)) return false;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(kind === "research"
      ? { kind, threadId, intentId, workId }
      : { threadId, intentId, workId }));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(PRIVATE_DOCUMENT_WORK_CHANGED));
  return true;
}

export function clearPrivateDocumentWork(actorId: string, tenantId: string, snapshot: string) {
  const key = storageKey(actorId, tenantId);
  if (!key) return false;
  try {
    if (window.sessionStorage.getItem(key) !== snapshot) return false;
    window.sessionStorage.removeItem(key);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(PRIVATE_DOCUMENT_WORK_CHANGED));
  return true;
}
