import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { useTenantContext } from "@/hooks/useTenantContext";
import { fleetDetailVisible, isInternal, useFleet, type FleetTenant } from "@/operator/data/useFleet";
import { STATUS_META, trialDaysLeft, type TenantStatus } from "@/lib/platform/tenantLifecycle";

/**
 * Fleet · Directory — authoritative v3 source:
 * `docs/design-references/cd-packs/super-admin-shell-v3/PAIGE Super Admin Shell v3.dc.html`
 * markup 956–1008 · builder `fleetVals` 8269–8362 (ROUTE-MAP.md 40).
 *
 * This replaces the retired pack's orbit / Field / Table console. The v3 tree, composition
 * bar, internal-account toggle, seat bars, risk count, and audited Enter rows are driven by
 * the existing `useFleet` adapter. No v3 tenant fixture or figure is copied into runtime.
 */

type FleetKind = "Agency" | "Sub-account" | "Standalone" | "Internal" | "Enterprise";
type Grade = "Nominal" | "At risk" | "Internal" | "Not graded";

type DirectoryRow = {
  tenant: FleetTenant;
  kind: FleetKind;
  grade: Grade;
  depth: 0 | 1;
  last: boolean;
  note: string;
};

const KIND_TONE: Record<Exclude<FleetKind, "Enterprise">, string> = {
  Agency: "#7C6CE0",
  "Sub-account": "#2F6B8F",
  Standalone: "#3F7F5C",
  Internal: "var(--pg-line-strong)",
};

function kindOf(tenant: FleetTenant, nested: boolean): FleetKind {
  if (isInternal(tenant)) return "Internal";
  if (nested) return "Sub-account";
  if (tenant.accountType === "agency") return "Agency";
  if (tenant.accountType === "enterprise") return "Enterprise";
  return "Standalone";
}

/**
 * `seatsRead` is whether this session could read seat counts at all. A tenant's status is always
 * readable here, so a non-active status grades At risk at every tier; a seat count this session
 * never read is not a zero and grades nothing (§13) — the row says Not graded instead.
 */
function gradeOf(tenant: FleetTenant, seatsRead: boolean): Grade {
  if (isInternal(tenant)) return "Internal";
  if (tenant.status && tenant.status !== "active") return "At risk";
  if (!seatsRead) return "Not graded";
  if (tenant.seats === 0) return "At risk";
  return "Nominal";
}

/**
 * The tenant's status in words, only when it is not the default — "Active" on every row would be
 * noise, and a non-active status is exactly what explains an At risk grade. Labels and trial maths
 * come from the lifecycle module the rest of the platform already uses (§18), never restated here.
 */
function statusNote(tenant: FleetTenant): string | null {
  const status = tenant.status;
  if (!status || status === "active") return null;
  const label = STATUS_META[status as TenantStatus]?.label ?? status;
  if (status !== "trial") return label;
  const left = trialDaysLeft(tenant.trialEndsAt);
  if (left === null) return label;
  if (left < 0) {
    // `trialDaysLeft` rounds a lapsed trial DOWN (so it is never a deceptive 0), which overstates
    // the elapsed time by up to a day. Elapsed whole days are counted here instead: 9.2 days ago
    // reads "9 days ago", and under a day reads "today" — never a figure the record does not hold.
    const ago = Math.floor((Date.now() - new Date(tenant.trialEndsAt as string).getTime()) / 86_400_000);
    if (ago < 1) return `${label} · ended today`;
    return `${label} · ended ${ago} ${ago === 1 ? "day" : "days"} ago`;
  }
  if (left === 0) return `${label} · ends today`;
  return `${label} · ${left} ${left === 1 ? "day" : "days"} left`;
}

function countNote(n: number, one: string, many: string): string {
  return n ? `${n} ${n === 1 ? one : many}` : `no ${many}`;
}

function gradeTone(grade: Grade): string {
  if (grade === "At risk") return "var(--pg-warning)";
  if (grade === "Internal") return "var(--pg-violet)";
  if (grade === "Not graded") return "var(--pg-faint)";
  return "var(--pg-positive)";
}

function directoryRows(tenants: FleetTenant[], seatsRead: boolean): DirectoryRow[] {
  const children = new Map<string, FleetTenant[]>();
  const present = new Set(tenants.map((tenant) => tenant.id));
  for (const tenant of tenants) {
    if (!tenant.parentTenantId || !present.has(tenant.parentTenantId)) continue;
    const group = children.get(tenant.parentTenantId) ?? [];
    group.push(tenant);
    children.set(tenant.parentTenantId, group);
  }

  const rows: DirectoryRow[] = [];
  for (const tenant of tenants) {
    if (tenant.parentTenantId && present.has(tenant.parentTenantId)) continue;
    const nested = children.get(tenant.id) ?? [];
    rows.push({
      tenant,
      kind: kindOf(tenant, false),
      grade: gradeOf(tenant, seatsRead),
      depth: 0,
      last: false,
      note: nested.length ? `Parent of ${nested.length}` : "",
    });
    nested.forEach((child, index) =>
      rows.push({
        tenant: child,
        kind: kindOf(child, true),
        grade: gradeOf(child, seatsRead),
        depth: 1,
        last: index === nested.length - 1,
        note: "Under the agency",
      }),
    );
  }
  return rows;
}

export function FleetDirectoryView({
  tenants,
  classificationVisible,
  detailVisible,
  loading = false,
  error = null,
  onEnter,
}: {
  tenants: FleetTenant[];
  classificationVisible: boolean;
  /** Seat/client counts readable by this session; null when the check did not answer. */
  detailVisible: boolean | null;
  loading?: boolean;
  error?: string | null;
  onEnter: (tenant: FleetTenant) => void;
}) {
  const [showInternal, setShowInternal] = useState(false);
  const internalCount = useMemo(
    () => (classificationVisible ? tenants.filter(isInternal).length : null),
    [classificationVisible, tenants],
  );
  const live = useMemo(
    () => (classificationVisible ? tenants.filter((tenant) => !isInternal(tenant)) : tenants),
    [classificationVisible, tenants],
  );
  const shown = useMemo(
    () => (showInternal || !classificationVisible ? tenants : live),
    [classificationVisible, live, showInternal, tenants],
  );
  const seatsRead = detailVisible === true;
  const rows = useMemo(() => directoryRows(shown, seatsRead), [shown, seatsRead]);
  const maxSeats = Math.max(...shown.map((tenant) => tenant.seats), 1);
  // Counted over the rows on screen, so the header can never disagree with the tags beneath it.
  // At either tier the grade is built only from data this session read (status, and seats where
  // they are readable), so this is a real count at both — never a dash standing in for one.
  const risk = rows.filter((row) => row.grade === "At risk").length;

  const composition = useMemo(() => {
    const values = (["Agency", "Sub-account", "Standalone", "Internal"] as const).map((kind) => {
      const count = kind === "Internal"
        ? showInternal && internalCount !== null
          ? internalCount
          : 0
        : live.filter((tenant) => kindOf(tenant, Boolean(tenant.parentTenantId)) === kind).length;
      return { kind, count, tone: KIND_TONE[kind] };
    });
    return values.filter((item) => item.count > 0);
  }, [internalCount, live, showInternal]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-labelledby="fleet-directory-title">
      <div className="flex-none border-b border-[var(--pg-line)] pb-[15px]">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          <b id="fleet-directory-title" className="text-[12px] font-medium">The fleet</b>
          <small className="min-w-0 text-[10.5px] text-[var(--pg-faint)]">
            {loading
              ? "—"
              : classificationVisible
                ? `${live.length} live · ${shown.length} shown · entering performs an audited act-as`
                : `${shown.length} ${shown.length === 1 ? "tenant" : "tenants"}, internal accounts included · entering performs an audited act-as`}
          </small>
          {/* Only offered when this session can tell internal accounts apart. A disabled chip that
              can never act asserts a capability that is not there; the header line above already
              says the count includes them. */}
          {classificationVisible && (
            <button
              type="button"
              aria-pressed={showInternal}
              onClick={() => setShowInternal((visible) => !visible)}
              className="ml-auto min-h-[24px] flex-none whitespace-nowrap rounded-full border bg-transparent px-2.5 text-[10px] font-medium"
              style={{
                borderColor: showInternal ? "var(--pg-violet)" : "var(--pg-line)",
                color: showInternal ? "var(--pg-violet)" : "var(--pg-muted)",
              }}
            >
              {showInternal ? "Hide internal" : `Show ${internalCount ?? "—"} internal`}
            </button>
          )}
        </div>

        <div className="mt-3 flex h-1.5 gap-px overflow-hidden rounded-full" aria-label="Fleet composition">
          {composition.length ? (
            composition.map((item) => (
              <i
                key={item.kind}
                title={`${item.kind} · ${item.count}`}
                className="min-w-0"
                style={{ flex: item.count, background: item.tone }}
              />
            ))
          ) : (
            <i className="flex-1 bg-[var(--pg-line-soft)]" />
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-x-[15px] gap-y-1">
          {composition.map((item) => (
            <span key={item.kind} className="inline-flex items-center gap-1.5">
              <i className="h-1.5 w-1.5 rotate-45" style={{ background: item.tone }} />
              <small className="whitespace-nowrap text-[10.5px] text-[var(--pg-muted)]">{item.kind}</small>
              <small className="font-mono text-[10px] text-[var(--pg-faint)]">{item.count}</small>
            </span>
          ))}
          <small className="ml-auto whitespace-nowrap text-[10.5px] font-medium" style={{ color: risk ? "var(--pg-warning)" : "var(--pg-faint)" }}>
            {risk} at risk{classificationVisible ? "" : ", internal included"}
          </small>
        </div>

        {!loading && !error && !seatsRead && (
          <p className="mt-2.5 text-[10.5px] leading-[1.5] text-[var(--pg-muted)]">
            {detailVisible === false
              ? "Seat and client counts are not visible to your role; only tenants whose status is not active are marked at risk."
              : "Seat and client counts could not be confirmed; only tenants whose status is not active are marked at risk."}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pt-0.5 [scrollbar-gutter:stable]">
        {loading && (
          <div aria-busy="true" aria-label="Reading the fleet">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 border-b border-[var(--pg-line-soft)] py-3">
                <span className="h-1.5 w-1.5 animate-pulse rotate-45 bg-[var(--pg-line-strong)]" />
                <span className="h-3 w-52 animate-pulse rounded bg-[var(--pg-surface)]" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div role="alert" className="py-8 text-[12px] text-[var(--pg-negative)]">
            The fleet could not be read. {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <p className="py-8 text-[12px] text-[var(--pg-faint)]">No tenant has been recorded here yet.</p>
        )}

        {!loading &&
          !error &&
          rows.map((row) => (
            <div
              key={row.tenant.id}
              className="relative flex min-w-0"
              style={{ paddingLeft: row.depth ? 22 : 0 }}
            >
              {row.depth === 1 && (
                <i
                  className="absolute left-2 top-0 w-px bg-[var(--pg-line-strong)]"
                  style={{ bottom: row.last ? "50%" : 0 }}
                />
              )}
              <button
                type="button"
                onClick={() => onEnter(row.tenant)}
                className="flex min-w-0 flex-1 flex-col border-0 border-b border-[var(--pg-line-soft)] bg-transparent px-0 py-[9px] text-left"
              >
                <span className="flex min-w-0 items-center gap-[9px]">
                  <i className="h-1.5 w-1.5 flex-none rotate-45" style={{ background: gradeTone(row.grade) }} />
                  <b className="min-w-0 truncate text-[12.5px] font-medium">{row.tenant.name}</b>
                  <small className="min-h-[17px] flex-none whitespace-nowrap rounded-full border border-[var(--pg-line)] px-1.5 text-[9px] leading-[17px] text-[var(--pg-faint)]">
                    {row.kind}
                  </small>
                </span>
                <span className="mt-[5px] flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1">
                  {seatsRead ? (
                    <span className="flex items-center gap-[7px]">
                      <span className="h-[3px] w-[52px] flex-none overflow-hidden rounded-full bg-[var(--pg-line)]">
                        <i
                          className="block h-full bg-[var(--pg-muted)]"
                          style={{ width: row.tenant.seats ? `${Math.max(6, (row.tenant.seats / maxSeats) * 100)}%` : 0 }}
                        />
                      </span>
                      <small className="whitespace-nowrap font-mono text-[10.5px] text-[var(--pg-muted)]">
                        {row.tenant.seats ? `${row.tenant.seats} ${row.tenant.seats === 1 ? "seat" : "seats"}` : "no seats"}
                      </small>
                    </span>
                  ) : (
                    // Stated once in the header; the row carries only the absence, never a zero.
                    <small className="whitespace-nowrap font-mono text-[10.5px] text-[var(--pg-faint)]">
                      seats —
                    </small>
                  )}
                  {seatsRead && (
                    <small className="whitespace-nowrap font-mono text-[10.5px] text-[var(--pg-muted)]">
                      {countNote(row.tenant.customers, "client", "clients")}
                    </small>
                  )}
                  {row.note && (
                    <small className="min-w-0 truncate text-[10.5px] text-[var(--pg-faint)]">{row.note}</small>
                  )}
                  <small className="whitespace-nowrap text-[10px] font-medium" style={{ color: gradeTone(row.grade) }}>{row.grade}</small>
                  {statusNote(row.tenant) && (
                    <small className="whitespace-nowrap text-[10.5px] text-[var(--pg-muted)]">{statusNote(row.tenant)}</small>
                  )}
                  <small className="ml-auto whitespace-nowrap text-[10.5px] text-[var(--pg-faint)]">Enter →</small>
                </span>
              </button>
            </div>
          ))}

        {!loading && !error && (
          <p className="mt-[15px] max-w-[66ch] text-[10.5px] leading-[1.55] text-[var(--pg-faint)]">
            Entering a tenant is an audited act-as: it adds no membership, and leaving returns you to platform scope. A tenant is at risk when its status is not active{seatsRead ? " or it has no active seats" : ""}.{classificationVisible ? " Internal accounts are hidden by default; the chip reveals them." : ""}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * `isPlatformOwner` is the shell's one server answer (`useIsPlatformOwner`, re-asked on sign-in
 * changes) — passed through rather than asked a second time here (§18).
 */
export default function FleetConsole({ isPlatformOwner }: { isPlatformOwner: boolean | null }) {
  const { tenants, classificationVisible, detailReadFailed, loading, error } = useFleet(true);
  const detailVisible = fleetDetailVisible(isPlatformOwner, detailReadFailed);
  const { switchTenant } = useTenantContext();

  const enterTenant = useCallback(
    async (tenant: FleetTenant) => {
      const entered = await switchTenant(tenant.id);
      if (!entered) {
        toast.error(`Couldn't enter ${tenant.name}.`);
        return;
      }
      toast.success(`Acting as ${tenant.name}. Everything you do here is recorded.`);
    },
    [switchTenant],
  );

  return (
    <FleetDirectoryView
      tenants={tenants}
      classificationVisible={classificationVisible}
      detailVisible={detailVisible}
      loading={loading}
      error={error}
      onEnter={(tenant) => void enterTenant(tenant)}
    />
  );
}
