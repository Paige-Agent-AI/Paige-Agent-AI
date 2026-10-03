// Independent canonical snapshots, never a deal -> term -> invoice chain.
export type SalesPeriod = "all" | "30d" | "7d";
type Source<T> = { tenantId: string | null; phase: string; readable?: boolean; rows: readonly T[] };
type Deal = { id: string; title: string; clientName: string; status: string; stageId: string; nextAction: string; createdAt: string; updatedAt: string };
type Term = { id: string; contactId: string; status: string };
type Signing = { id: string; documentTitle: string; displayState: string };
type Invoice = { id: string; number: string; snapshot: { client_id: string; kind: string } };
export type SalesOverviewRow = { id: string; recordId: string; source: "deals" | "terms" | "signings" | "invoices"; title: string; person: string; state: string; next: string; group: "attention" | "motion" | "resolved"; target: "pipeline" | "agreements" | "payments" };
export type SalesOverviewInput = {
  tenantId: string | null;
  deals: Source<Deal>; terms: Source<Term>; signings: Source<Signing>; invoices: Source<Invoice>;
  stages: readonly { id: string; label: string }[];
  clients: readonly { id: string; name: string }[];
  period: SalesPeriod; now: number;
};
export function dealInSalesPeriod(createdAt: string, period: SalesPeriod, now: number): boolean {
  if (period === "all") return true;
  const date = Date.parse(createdAt);
  return Number.isFinite(date) && date <= now && date >= now - (period === "7d" ? 7 : 30) * 86400000;
}
export function deriveSalesOverview(input: SalesOverviewInput) {
  const ready = (source: Source<unknown>) => Boolean(input.tenantId) && source.tenantId === input.tenantId && source.phase === "ready" && source.readable !== false;
  const deals = ready(input.deals) ? input.deals.rows.filter(row => dealInSalesPeriod(row.createdAt, input.period, input.now)) : [];
  const terms = ready(input.terms) ? input.terms.rows : [];
  const signings = ready(input.signings) ? input.signings.rows : [];
  const invoices = ready(input.invoices) ? input.invoices.rows : [];
  const client = (id: string) => input.clients.find(row => row.id === id)?.name ?? "Client record unavailable";
  const rows: SalesOverviewRow[] = [
    ...deals.map(row => ({ id: `deal:${row.id}`, recordId: row.id, source: "deals" as const, title: row.title, person: row.clientName, state: row.status === "open" ? input.stages.find(stage => stage.id === row.stageId)?.label ?? "Stage unavailable" : row.status, next: row.nextAction, group: row.status === "open" ? "motion" as const : "resolved" as const, target: "pipeline" as const })),
    ...terms.map(row => ({ id: `term:${row.id}`, recordId: row.id, source: "terms" as const, title: "Commercial terms", person: client(row.contactId), state: row.status, next: row.status === "draft" ? "Review the recorded arrangement" : "Inspect engagement terms", group: row.status === "draft" ? "attention" as const : ["completed", "cancelled"].includes(row.status) ? "resolved" as const : "motion" as const, target: "agreements" as const })),
    ...signings.map(row => ({ id: `signing:${row.id}`, recordId: row.id, source: "signings" as const, title: row.documentTitle, person: "Signature document", state: row.displayState, next: "Inspect the signing record and trail", group: ["declined", "expired", "draft"].includes(row.displayState) ? "attention" as const : ["completed", "voided"].includes(row.displayState) ? "resolved" as const : "motion" as const, target: "agreements" as const })),
    ...invoices.map(row => ({ id: `invoice:${row.id}`, recordId: row.id, source: "invoices" as const, title: row.number, person: client(row.snapshot.client_id), state: "Draft · not issued", next: "Review the saved customer-money draft", group: "attention" as const, target: "payments" as const })),
  ];
  return {
    rows,
    counts: { deals: ready(input.deals) ? deals.length : null, terms: ready(input.terms) ? terms.length : null, signings: ready(input.signings) ? signings.length : null, invoices: ready(input.invoices) ? invoices.length : null },
    stages: ready(input.deals) ? input.stages.map(stage => ({ ...stage, count: deals.filter(row => row.status === "open" && row.stageId === stage.id).length })) : [],
  };
}

export const salesPeriodFromQuery = (value: string | null): SalesPeriod => value === "7d" || value === "30d" ? value : "all";
export const salesStageQuery = (stageId: string, period: SalesPeriod) => `stage=${encodeURIComponent(stageId)}&period=${period}`;
