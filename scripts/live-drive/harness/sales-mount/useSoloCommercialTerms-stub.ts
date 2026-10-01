// The client-agreements read, stubbed at the NETWORK boundary only.
//
// Everything above this line renders unchanged: `AgreementEditor`, the band, the readiness row,
// the shared pill and every token. What is replaced is the one thing a local harness cannot have —
// a tenant-scoped round trip to PostgREST. That is also the honest limit of what any frame from
// here proves: it is a render, never an authenticated runtime.

export type AgreementsMode =
  | "none"
  | "no-clients"
  // Clients on the book, nothing agreed yet — the state a real workspace actually opens in, and
  // the one the composed first-use block was built for. It had no mode, so it could not be driven.
  | "empty"
  | "populated"
  | "unreadable"
  | "readonly"
  | "error"
  | "loading"
  | "resolving"
  | "save-refused"
  | "save-error"
  | "save-slow";

let mode: AgreementsMode = "none";
const listeners = new Set<() => void>();

export function setAgreementsHarnessMode(next: AgreementsMode) {
  mode = next;
  listeners.forEach((l) => l());
}

const CLIENTS = [
  { id: "c1", name: "Jordan Avery" },
  { id: "c2", name: "Meridian Advisory" },
  // The counterparty on the SIGNED document. Without this pair — this client and `a3` below — the
  // completed signing joins nothing and the terminal state of the whole flow renders in no frame,
  // which is how it stayed unreviewable until it was shot.
  { id: "c3", name: "Delaney Okafor" },
];

const AGREEMENTS = [
  {
    id: "a1", contactId: "c1", offerId: "offer-1", title: null, notes: "Renewed after the pilot",
    termKind: "recurring", billingInterval: "month", intervalCount: 1, installmentsTotal: null,
    paymentSchedule: null, priceBasis: "negotiated",
    agreedAmountMinor: 250000, agreedCurrency: "usd",
    // Deliberately DIFFERENT from the agreed figure — the pair is the whole point of the snapshot,
    // and a fixture where they match would hide a surface that conflated them.
    catalogSnapshotMinor: 300000, catalogSnapshotCurrency: "usd",
    catalogSnapshotAt: "2026-09-01T10:00:00Z",
    startsOn: "2026-09-01", renewsOn: "2026-10-01", endsOn: null,
    status: "active", updatedAt: "2026-09-01T10:00:00Z",
  },
  {
    id: "a2", contactId: "c2", offerId: "offer-2", title: null, notes: null,
    termKind: "installment", billingInterval: null, intervalCount: null, installmentsTotal: 3,
    paymentSchedule: null, priceBasis: "negotiated",
    agreedAmountMinor: 90000, agreedCurrency: "usd",
    catalogSnapshotMinor: null, catalogSnapshotCurrency: null, catalogSnapshotAt: null,
    startsOn: "2026-08-15", renewsOn: null, endsOn: null,
    status: "draft", updatedAt: "2026-08-15T09:00:00Z",
  },
  {
    // The SIGNED one. `status: "active"` beside a completed signature is the pairing the surface
    // has to keep apart: the signature finished, and the engagement it authorises is running —
    // two states, not one, which is exactly what the completion screen's closing line says.
    id: "a3", contactId: "c3", offerId: "offer-1", title: null, notes: null,
    termKind: "recurring", billingInterval: "month", intervalCount: 1, installmentsTotal: null,
    paymentSchedule: null, priceBasis: "catalog",
    agreedAmountMinor: 240000, agreedCurrency: "usd",
    catalogSnapshotMinor: 240000, catalogSnapshotCurrency: "usd",
    catalogSnapshotAt: "2026-09-18T08:58:00Z",
    startsOn: "2026-10-01", renewsOn: "2026-11-01", endsOn: null,
    status: "active", updatedAt: "2026-09-18T09:31:00Z",
  },
];


// Local browser fixtures only. Never imported by production or used as persistence proof.
import type { AgreementDraft, ClientAgreement, AgreementStatus } from "../../../../src/solo/useSoloCommercialTerms";
const STORAGE_PREFIX = "paige-sales-local-fixture:tenant-harness:";
let fixtureTenant = "harness-tenant";
let epoch = 0;
const emit = () => listeners.forEach((listener) => listener());
const storageKey = () => `${STORAGE_PREFIX}${fixtureTenant}`;
function readRows(): ClientAgreement[] {
  try {
    const saved = localStorage.getItem(storageKey());
    if (saved) return JSON.parse(saved) as ClientAgreement[];
  } catch { /* A blocked local store leaves the seeded fixture visible. */ }
  return (mode === "populated" || mode === "readonly" ? AGREEMENTS : []) as ClientAgreement[];
}
function writeRows(rows: ClientAgreement[]) {
  localStorage.setItem(storageKey(), JSON.stringify(rows));
  emit();
}
export function setAgreementsHarnessTenant(next: string) {
  fixtureTenant = next === "harness-tenant-2" ? next : "harness-tenant";
  epoch += 1;
  emit();
}
export function resetAgreementsHarness() {
  localStorage.removeItem(storageKey());
  epoch += 1;
  emit();
}
// The drive can select added states without adding production UI or relying on React internals.
window.addEventListener("sales-agreements-harness", (event) => {
  const control = (event as CustomEvent).detail;
  if (control?.tenant) setAgreementsHarnessTenant(control.tenant);
  if (control?.mode) setAgreementsHarnessMode(control.mode);
  if (control?.reset) resetAgreementsHarness();
});
async function beforeWrite(tenantId: string | null) {
  const openedEpoch = epoch;
  const writeMode = mode;
  if (writeMode === "save-slow") await new Promise((resolve) => setTimeout(resolve, 900));
  if (openedEpoch !== epoch || tenantId !== fixtureTenant) return "Your workspace changed. Reopen the form.";
  if (["readonly", "unreadable", "save-refused"].includes(writeMode)) return "Owner or admin permission is required.";
  if (["loading", "resolving", "error"].includes(writeMode)) return "Wait for your workspace to finish loading.";
  if (writeMode === "save-error") return "The fixture save failed. Choose a ready fixture and retry.";
  return null;
}
async function saveAgreement(draft: AgreementDraft) {
  const refusal = await beforeWrite(draft.tenantId);
  if (refusal) return { ok: false, message: refusal };
  const rows = readRows();
  const previous = rows.find((row) => row.id === draft.id);
  if (draft.id && !previous) return { ok: false, message: "This record is not in the selected fixture workspace." };
  if (previous && previous.updatedAt !== draft.expectedUpdatedAt) return { ok: false, stale: true };
  if (!CLIENTS.some((client) => client.id === draft.contactId)) return { ok: false, message: "Choose a fixture client." };
  // The known Catalog fixture has one canonical plan. Never invent a price for an unknown plan.
  if (draft.priceBasis === "catalog" && draft.catalogPriceId !== "p1") {
    return { ok: false, message: "Choose the supported Catalog fixture plan." };
  }
  const timestamp = new Date().toISOString();
  const row: ClientAgreement = {
    ...draft,
    id: previous?.id ?? `fixture-terms-${crypto.randomUUID()}`,
    status: previous?.status ?? "draft",
    updatedAt: timestamp,
    agreedAmountMinor: draft.priceBasis === "catalog" ? 240000 : draft.agreedAmountMinor,
    agreedCurrency: draft.priceBasis === "catalog" ? "usd" : draft.agreedCurrency,
    catalogSnapshotMinor: previous?.catalogSnapshotMinor ?? (draft.priceBasis === "catalog" ? 240000 : null),
    catalogSnapshotCurrency: previous?.catalogSnapshotCurrency ?? (draft.priceBasis === "catalog" ? "usd" : null),
    catalogSnapshotAt: previous?.catalogSnapshotAt ?? (draft.priceBasis === "catalog" ? timestamp : null),
  };
  try { writeRows(previous ? rows.map((item) => item.id === row.id ? row : item) : [row, ...rows]); }
  catch { return { ok: false, message: "Local fixture storage is unavailable." }; }
  return { ok: true, result: { id: row.id } };
}
async function setAgreementStatus(id: string, status: AgreementStatus, expectedUpdatedAt: string | null, tenantId: string | null) {
  const refusal = await beforeWrite(tenantId);
  if (refusal) return { ok: false, message: refusal };
  const rows = readRows();
  const row = rows.find((item) => item.id === id);
  if (!row) return { ok: false, message: "This record is not in the selected fixture workspace." };
  if (row.updatedAt !== expectedUpdatedAt) return { ok: false, stale: true };
  try { writeRows(rows.map((item) => item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item)); }
  catch { return { ok: false, message: "Local fixture storage is unavailable." }; }
  return { ok: true, result: { id } };
}
function snapshot() {
  const base = {
    tenantId: fixtureTenant, phase: "ready" as const, agreements: readRows(), clients: CLIENTS,
    clientsReadable: true, agreementsReadable: true, canManage: true, authorityUnknown: false,
    retry: () => setAgreementsHarnessMode("none"), saveAgreement, setAgreementStatus,
  };
  switch (mode) {
    case "no-clients": return { ...base, clients: [], agreements: [] };
    case "empty": return { ...base, agreements: [] };
    case "unreadable": return { ...base, agreements: [], clients: [], clientsReadable: false, agreementsReadable: false, canManage: false };
    case "readonly": return { ...base, canManage: false };
    case "error": return { ...base, phase: "error" as const, agreements: [], clients: [], canManage: false };
    case "loading":
    case "resolving": return { ...base, phase: mode, agreements: [], clients: [], canManage: false };
    default: return base;
  }
}
export function useSoloCommercialTerms() {
  const React = (globalThis as { __React?: typeof import("react") }).__React!;
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const listener = () => force((n: number) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return snapshot();
}
