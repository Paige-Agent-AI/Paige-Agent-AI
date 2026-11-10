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

export function parsePrivateDocumentWork(raw: string | null): OriginalDocumentReference | null {
  if (!raw || raw.length > 160) return null;
  try {
    const { threadId, intentId, workId } = JSON.parse(raw) ?? {};
    return uuid(threadId) && uuid(intentId) && uuid(workId) ? { threadId, intentId, workId } : null;
  } catch {
    return null;
  }
}

export function keepPrivateDocumentWork(actorId: string, tenantId: string, reference: OriginalDocumentReference) {
  const key = storageKey(actorId, tenantId);
  const { threadId, intentId, workId } = reference;
  if (!key || !uuid(threadId) || !uuid(intentId) || !uuid(workId)) return false;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ threadId, intentId, workId }));
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
