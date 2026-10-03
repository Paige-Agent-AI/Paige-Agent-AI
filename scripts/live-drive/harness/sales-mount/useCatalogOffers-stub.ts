// The canonical offer read, stubbed at the network boundary. Sales calls the REAL hook in
// production; here only the round trip is replaced, so the offers table and the quick-create
// path render against the real component.
import type { CatalogOffer, CatalogOffersState, OfferDraft, OfferWriteResult, OfferAvailability } from "../../../../src/solo/useCatalogOffers";
const OFFERS: CatalogOffer[] = [
  {
    id: "offer-1", name: "Twelve-week advisory program", summary: "Weekly sessions and a plan.",
    description: null, availability: "active", billingCadence: "recurring", kind: "service",
    deliveryShape: "program", pricePresentation: "fixed", customerAction: "apply",
    category: "Programs", imageUrl: null, updatedAt: "2026-08-28T12:00:00Z",
    prices: [{ id: "p1", nickname: "Standard", unitAmount: 240000, currency: "usd",
               billingInterval: "month", kind: "recurring", installmentsTotal: null, active: true }],
  },
  {
    id: "offer-2", name: "Onboarding toolkit", summary: null, description: null,
    availability: "draft", billingCadence: "one_time", kind: "product", deliveryShape: "digital",
    pricePresentation: "fixed", customerAction: "buy", category: "Downloads", imageUrl: null,
    updatedAt: "2026-08-20T12:00:00Z",
    // No price recorded — the table must show an em-dash, never a zero.
    prices: [],
  },
];
/** Source-only fixture for saved-price/current-price re-opening. Never production Catalog data. */
export const BILLING_CATALOG_FIXTURE: CatalogOffer = {
  id: 'test-billing-offer', name: 'Catalog service', summary: 'Synthetic current price', description: null,
  availability: 'active', billingCadence: 'one_time', kind: 'service', deliveryShape: 'digital',
  pricePresentation: 'fixed', customerAction: 'enquire', category: null, imageUrl: null, updatedAt: null,
  prices: [{ id: 'test-billing-price', nickname: 'Current', unitAmount: 15000, currency: 'usd', billingInterval: 'one_time', kind: 'one_time', installmentsTotal: null, active: true }],
};

// LOCAL FIXTURE ONLY: this store is never imported by the production adapter.
// Sales and Catalog subscribe to the same fixture records to exercise the real return flow.
export type CatalogHarnessMode = "ready" | "empty" | "error" | "loading" | "readonly" | "save-refused" | "save-error" | "save-slow";
const STORAGE_KEY = "paige-sales-local-fixture:catalog:harness-tenant";
const listeners = new Set<() => void>();
let mode: CatalogHarnessMode = "ready";
const emit = () => listeners.forEach((listener) => listener());
// Scale fixtures exercise rendering/search/page behavior only, not production query capacity.
// Large catalogs stay in memory and are never serialized into browser storage.
let scaleRows: CatalogOffer[] | null = null;
export type CatalogHarnessQuery = { search?: string; page?: number; pageSize?: number; referenceIds?: readonly string[] };
type CatalogHarnessState = CatalogOffersState & { hasMore: boolean; referencedOffers: readonly CatalogOffer[] };
export function setCatalogHarnessSize(size: 1 | 80 | 80000) {
  if (![1, 80, 80000].includes(size)) return;
  scaleRows = Array.from({ length: size }, (_, index) => index < OFFERS.length ? OFFERS[index] : {
    ...OFFERS[1], id: `offer-${index + 1}`, name: `Catalog item ${index + 1}`,
    category: "Fixture catalog", updatedAt: "2026-09-03T12:00:00Z",
  });
  emit();
}
function readRows(): CatalogOffer[] {
  if (scaleRows) return scaleRows;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const rows = JSON.parse(saved);
      if (Array.isArray(rows)) return rows;
    }
  } catch { /* The seeded fixture remains readable if local storage is blocked. */ }
  return OFFERS;
}
function writeRows(rows: CatalogOffer[]) {
  if (scaleRows) scaleRows = rows;
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  emit();
}
export function setCatalogHarnessMode(next: CatalogHarnessMode) {
  if (!["ready", "empty", "error", "loading", "readonly", "save-refused", "save-error", "save-slow"].includes(next)) return;
  mode = next;
  emit();
}
export function resetCatalogHarness() {
  scaleRows = null;
  localStorage.removeItem(STORAGE_KEY);
  mode = "ready";
  emit();
}
window.addEventListener("sales-catalog-harness", (event) => {
  const control = (event as CustomEvent).detail;
  if (control?.reset) resetCatalogHarness();
  if (control?.size) setCatalogHarnessSize(control.size);
  if (control?.mode) setCatalogHarnessMode(control.mode);
});
async function writeRefusal(tenantId: string | null): Promise<string | null> {
  if (mode === "save-slow") await new Promise((resolve) => setTimeout(resolve, 900));
  if (tenantId !== "harness-tenant") return "Your workspace changed. Reopen the form.";
  if (mode === "readonly" || mode === "save-refused") return "Owner or admin permission is required.";
  if (mode === "loading" || mode === "error") return "Wait for your workspace to finish loading.";
  if (mode === "save-error") return "Could not save this local fixture. Try again.";
  return null;
}
async function saveOffer(draft: OfferDraft): Promise<OfferWriteResult> {
  const refusal = await writeRefusal(draft.tenantId);
  if (refusal) return { ok: false, message: refusal };
  if (!draft.name?.trim()) return { ok: false, message: "Give your offer a name." };
  const rows = mode === "empty" ? [] : readRows();
  const previous = draft.id ? rows.find((row) => row.id === draft.id) : null;
  if (draft.id && !previous) return { ok: false, message: "Offer unavailable in this fixture workspace." };
  if (previous && previous.updatedAt !== draft.expectedUpdatedAt) return { ok: false, stale: true };
  const id = previous?.id ?? `offer-fixture-${rows.length + 1}`;
  const updatedAt = new Date().toISOString();
  const recurring = !!draft.priceInterval && draft.priceInterval !== "one_time";
  const price = draft.priceAmount === null ? [] : [{
    id: draft.priceId || `${id}-price`, nickname: null, unitAmount: draft.priceAmount,
    currency: draft.priceCurrency || "usd", billingInterval: recurring ? draft.priceInterval : null,
    kind: recurring ? "recurring" as const : "one_time" as const, installmentsTotal: null, active: true,
  }];
  const row: CatalogOffer = {
    id, name: draft.name.trim(), summary: draft.summary || null, description: draft.description || null,
    availability: previous?.availability ?? "draft", billingCadence: recurring ? "recurring" : "one_time",
    kind: draft.kind || null, deliveryShape: draft.deliveryShape || null,
    pricePresentation: draft.pricePresentation || null, customerAction: draft.customerAction || null,
    category: draft.category || null, imageUrl: previous?.imageUrl ?? null, updatedAt, prices: price,
  };
  try { writeRows(previous ? rows.map((item) => item.id === id ? row : item) : [row, ...rows]); }
  catch { return { ok: false, message: "Local fixture storage is unavailable." }; }
  mode = "ready";
  emit();
  return { ok: true, result: { id, updated_at: updatedAt } };
}
async function setOfferStatus(id: string, next: OfferAvailability, expectedUpdatedAt: string | null): Promise<OfferWriteResult> {
  const refusal = await writeRefusal("harness-tenant");
  if (refusal) return { ok: false, message: refusal };
  const rows = readRows();
  const previous = rows.find((row) => row.id === id);
  if (!previous) return { ok: false, message: "Offer unavailable in this fixture workspace." };
  if (previous.updatedAt !== expectedUpdatedAt) return { ok: false, stale: true };
  const updatedAt = new Date().toISOString();
  try { writeRows(rows.map((row) => row.id === id ? { ...row, availability: next, updatedAt } : row)); }
  catch { return { ok: false, message: "Local fixture storage is unavailable." }; }
  return { ok: true, result: { id, status: next, updated_at: updatedAt } };
}
export function useCatalogOffers(options?: CatalogHarnessQuery): CatalogHarnessState {
  const React = (globalThis as { __React?: typeof import("react") }).__React!;
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const listener = () => force((n: number) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  const hidden = ["empty", "error", "loading"].includes(mode);
  const rows = hidden ? [] : new URLSearchParams(location.search).get('billing-fixture') === 'populated' ? [...readRows(), BILLING_CATALOG_FIXTURE] : readRows();
  const search = (options?.search ?? "").trim().toLocaleLowerCase();
  const page = Number.isFinite(options?.page) ? Math.max(0, Math.floor(options!.page!)) : 0;
  const pageSize = Number.isFinite(options?.pageSize) ? Math.min(100, Math.max(1, Math.floor(options!.pageSize!))) : 5;
  const ordered = options ? rows.filter((row) => row.name.toLocaleLowerCase().includes(search))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)) : rows;
  const bounded = !!options || scaleRows !== null;
  const start = page * pageSize;
  const references = new Set(options?.referenceIds ?? []);
  return {
    tenantId: "harness-tenant", phase: mode === "error" || mode === "loading" ? mode : "ready",
    offers: bounded ? ordered.slice(start, start + pageSize) : ordered,
    hasMore: bounded && ordered.length > start + pageSize,
    referencedOffers: rows.filter((row) => references.has(row.id)),
    canManage: !["readonly", "error", "loading"].includes(mode),
    authorityUnknown: false, fieldsUnavailable: false,
    retry: () => setCatalogHarnessMode("ready"), saveOffer, setOfferStatus,
  };
}
