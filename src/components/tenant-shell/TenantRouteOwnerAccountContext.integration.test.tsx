import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TenantFixture = {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan_offer: string | null;
  seat_limit: number;
  customer_limit: number;
  owner_user_id: string | null;
  account_type: string;
  parent_tenant_id: string | null;
  account_number: number;
  features: Record<string, unknown>;
};

type LoadResult = {
  owner?: { data: boolean; error: unknown };
  staff?: { data: boolean; error: unknown };
  profile: { data: { active_tenant_id: string | null; agency_login_default: string | null }; error: unknown };
  tenants: { data: TenantFixture[]; error: unknown };
  classes?: { data: unknown[]; error: unknown };
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const makeDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const harness = vi.hoisted(() => ({
  loads: [] as Array<Deferred<LoadResult>>,
  currentLoad: -1,
  authListener: null as null | ((event: string) => void),
  sessionUid: "authenticated-owner" as string | null,
  lastSignInAt: null as string | null,
  primaryLoads: [] as Array<Deferred<{ data: Array<{ tenant_id: string }> | null; error: unknown }>>,
  agencyAccountNumber: null as string | null,
}));

function loadPart<K extends keyof LoadResult>(key: K): Promise<NonNullable<LoadResult[K]>> {
  const current = harness.loads[harness.currentLoad];
  if (!current) throw new Error(`No tenant load exists for ${String(key)}`);
  return current.promise.then((result) => {
    if (key === "owner") return (result.owner ?? { data: false, error: null }) as NonNullable<LoadResult[K]>;
    if (key === "staff") return (result.staff ?? { data: false, error: null }) as NonNullable<LoadResult[K]>;
    if (key === "classes") return (result.classes ?? { data: [], error: null }) as NonNullable<LoadResult[K]>;
    return result[key] as NonNullable<LoadResult[K]>;
  });
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({
        data: { session: harness.sessionUid ? { user: { id: harness.sessionUid, last_sign_in_at: harness.lastSignInAt } } : null },
      }),
      getUser: () => Promise.resolve({
        data: { user: { id: "authenticated-owner", email: "owner@example.test", user_metadata: { full_name: "Owner" } } },
      }),
      onAuthStateChange: (listener: (event: string) => void) => {
        harness.authListener = listener;
        return { data: { subscription: { unsubscribe: () => { harness.authListener = null; } } } };
      },
    },
    rpc: (name: string) => {
      // The tenant context reads operator standing once per load (one server answer). The
      // fixtures still describe it as owner/staff; this folds them into the answer's shape, and a
      // failed read of either side is a failed read of the answer.
      if (name === "operator_standing") {
        harness.currentLoad += 1;
        return Promise.all([loadPart("owner"), loadPart("staff")]).then(([owner, staff]) =>
          owner.error || staff.error
            ? { data: null, error: owner.error ?? staff.error }
            : {
                data: [{
                  tier: owner.data ? "super_admin" : staff.data ? "platform_admin" : null,
                  active_tenant_id: null,
                  holds_unlisted: Boolean(owner.data),
                }],
                error: null,
              },
        );
      }
      if (name === "get_user_primary_tenant") {
        const primary = harness.primaryLoads.shift();
        if (!primary) throw new Error("No primary-tenant response is queued");
        return primary.promise;
      }
      if (name === "agency_switch_context") {
        return Promise.resolve({
          data: harness.agencyAccountNumber
            ? { is_agency_manager: true, agency_account_number: harness.agencyAccountNumber }
            : { is_agency_manager: false, agency_account_number: null },
          error: null,
        });
      }
      if (name === "agency_list_my_subaccounts") return new Promise(() => {});
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => loadPart("profile") }),
          }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        };
      }
      if (table === "tenants") {
        return {
          select: () => ({ order: () => loadPart("tenants") }),
        };
      }
      if (table === "tenant_revenue_classification") {
        return { select: () => loadPart("classes") };
      }
      throw new Error(`Unexpected table read: ${table}`);
    },
  },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));
vi.mock("framer-motion", () => ({ useReducedMotion: () => false }));
vi.mock("@/hooks/usePendingApprovals", () => ({
  usePendingApprovals: () => ({ items: [], loading: false, refresh: vi.fn() }),
}));
vi.mock("@/components/ui/paige", () => ({
  AgentPresenceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAgentPresence: () => ({
    railExpanded: false,
    expandRail: vi.fn(),
    collapseRail: vi.fn(),
  }),
}));
vi.mock("@/lib/voice/VoiceDeviceProvider", () => ({
  VoiceDeviceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/admin/voice/DialPadSurface", () => ({ DialPadSurface: () => null }));
vi.mock("@/components/admin/voice/IncomingCallOverlay", () => ({ IncomingCallOverlay: () => null }));
vi.mock("@/components/admin/voice/LiveTranscriptPanel", () => ({ LiveTranscriptPanel: () => null }));
vi.mock("@/components/admin/voice/DialPadTrigger", () => ({ DialPadTrigger: () => null }));
vi.mock("@/components/admin/AdminBridgeBell", () => ({ AdminBridgeBell: () => null }));
vi.mock("@/components/dashboard/PaigeAIChat", () => ({ PaigeAIChat: () => null }));
vi.mock("@/components/systems-check/SystemsCheckTile", () => ({ SystemsCheckTile: () => null }));
// Business Game Plan is the default Command Center landing. This suite proves auth/tenant-identity
// resolution, not the panel content, so its composed data reads are stubbed out like every other
// Solo screen mocked here (§18 — the surface's own tests own its behaviour). It still emits the
// canonical shell-contract identity markers from the resolved account context CommandHub passes,
// exactly as the real surface does, so identity resolution is verified on the DEFAULT landing.
vi.mock("@/solo/SoloGamePlanWorkspace", () => ({
  SoloGamePlanWorkspace: ({ accountContext }: {
    accountContext?: { accountName?: string | null; accountTypeLabel?: string | null } | null;
  }) => (
    <output>
      <span data-tenant-account-name>{accountContext?.accountName}</span>
      <span data-tenant-account-tier>{accountContext?.accountTypeLabel}</span>
    </output>
  ),
}));
vi.mock("@/lib/auth/signOut", () => ({ performSignOut: vi.fn() }));

const emptyCoreData = {
  greeting: { name: "Owner", dateLabel: "Today", summary: "Nothing waiting." },
  metrics: [],
  approvals: [],
  attention: undefined,
  departments: [],
  loading: false,
  empty: true,
  counts: { approvals: 0 },
  approve: vi.fn(async () => ({ ok: true })),
  decline: vi.fn(async () => ({ ok: true })),
  refresh: vi.fn(),
};

vi.mock("@/solo/data/useCommandCenter", () => ({
  useCommandCenter: () => emptyCoreData,
}));
vi.mock("@/agency/data/useAgencyCommandCenter", () => ({
  useAgencyCommandCenter: () => ({ ...emptyCoreData, mode: "agency", metrics: { kpis: [] } }),
}));
vi.mock("@/agency/data/useAgencyMetrics", () => ({
  useAgencyMetrics: () => ({
    identity: { name: null, plan: null, agencyRole: null },
    subCount: null,
    portfolioMrrCents: null,
    ownRevenueCents: null,
    kpis: [],
    loading: false,
    isError: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/agency/data/useAgencyRoster", () => ({
  useAgencyRoster: () => ({ available: true, loading: false, rows: [], refresh: vi.fn() }),
  isAgencyAggregate: ({ isAgency, acting }: { isAgency: boolean; acting: unknown }) => isAgency && !acting,
}));

vi.mock("@/solo/paigehub", () => ({ PaigeHub: () => null }));
vi.mock("@/solo/compass", () => ({ TrustCompass: () => null }));
vi.mock("@/solo/automations-build", () => ({ AutomationsHub: () => null }));
vi.mock("@/solo/conversations", () => ({ ClientsHub: () => null }));
vi.mock("@/solo/growth2", () => ({ GrowthHub: () => null }));
vi.mock("@/solo/calendar-book", () => ({ CalendarHub: () => null }));
vi.mock("@/solo/analytics2", () => ({ Analytics2: () => null }));
vi.mock("@/solo/marketplace", () => ({ Marketplace: () => null }));
vi.mock("@/solo/vault", () => ({ VaultView: () => null }));
vi.mock("@/solo/integrations", () => ({ Integrations: () => null }));
vi.mock("@/solo/team", () => ({ TeamHub: () => null }));
vi.mock("@/solo/setup", () => ({ Setup: () => null }));
vi.mock("@/solo/vibe", () => ({ VibeStudio: () => null }));

vi.mock("@/agency/paige", () => ({ default: () => null }));
vi.mock("@/agency/compass", () => ({ default: () => null }));
vi.mock("@/agency/automations", () => ({ default: () => null }));
vi.mock("@/agency/clients", () => ({ default: () => null }));
vi.mock("@/agency/calendar", () => ({ default: () => null }));
vi.mock("@/agency/support", () => ({ default: () => null }));
vi.mock("@/agency/growth", () => ({ default: () => null }));
vi.mock("@/agency/analytics", () => ({ default: () => null }));
vi.mock("@/agency/billing", () => ({ default: () => null }));
vi.mock("@/agency/marketplace", () => ({ default: () => null }));
vi.mock("@/agency/team", () => ({ default: () => null }));
vi.mock("@/agency/vault", () => ({ default: () => null }));
vi.mock("@/agency/setup", () => ({ default: () => null }));
vi.mock("@/agency/integrations", () => ({ default: () => null }));
vi.mock("@/components/tenant-calendar/SoloCalendarWorkspace", () => ({
  SoloCalendarWorkspace: ({ activeTenantId, connectionsHref }: {
    activeTenantId: string;
    connectionsHref: string;
  }) => (
    <output
      data-canonical-calendar
      data-solo-native="true"
      data-calendar-tenant={activeTenantId}
      data-calendar-connections={connectionsHref}
    />
  ),
}));
vi.mock("@/pages/admin/CalendarAdmin", () => ({
  default: ({ activeTenantId, activeTab, connectionsHref }: {
    activeTenantId: string;
    activeTab: string;
    connectionsHref: string;
  }) => (
    <output
      data-canonical-calendar
      data-calendar-tenant={activeTenantId}
      data-calendar-tab={activeTab}
      data-calendar-connections={connectionsHref}
    />
  ),
}));

import { TenantProvider, useTenantContext } from "@/hooks/useTenantContext";
import SoloEntry from "@/solo/SoloEntry";
import AgencyEntry from "@/agency/AgencyEntry";
import BusinessEntry from "@/business/BusinessEntry";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function TenantContextProbe() {
  const { loading, accountContextLoading, activeTenantId, activeTenant, refresh } = useTenantContext();
  return (
    <>
      <output
        data-provider-loading={String(loading)}
        data-provider-account-loading={String(accountContextLoading)}
        data-provider-tenant-id={activeTenantId ?? ""}
        data-provider-tenant-name={activeTenant?.name ?? ""}
      />
      <button type="button" data-provider-refresh onClick={() => void refresh()}>Refresh tenant context</button>
    </>
  );
}

function LocationProbe() {
  return <output data-current-path={useLocation().pathname} />;
}

const tenant = (input: Partial<TenantFixture> & Pick<TenantFixture, "id" | "name" | "account_type" | "account_number">): TenantFixture => ({
  slug: input.id,
  status: "active",
  plan_offer: null,
  seat_limit: 1,
  customer_limit: 1,
  owner_user_id: "authenticated-owner",
  parent_tenant_id: null,
  features: {},
  ...input,
});
const loadResult = (activeTenantId: string | null, tenants: TenantFixture[]): LoadResult => ({
  profile: { data: { active_tenant_id: activeTenantId, agency_login_default: null }, error: null },
  tenants: { data: tenants, error: null },
});

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount(path: string, route: React.ReactNode) {
  const agencyMatch = path.match(/^\/agency\/(\d+)/);
  harness.agencyAccountNumber = agencyMatch?.[1] ?? null;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <MemoryRouter initialEntries={[path]}>
            <TenantContextProbe />
            <LocationProbe />
            <Routes>{route}</Routes>
          </MemoryRouter>
        </TenantProvider>
      </QueryClientProvider>,
    );
  });
}

async function startOverlappingLoads() {
  await settle();
  expect(harness.currentLoad).toBe(0);
  await act(async () => {
    harness.authListener?.("INITIAL_SESSION");
    await Promise.resolve();
  });
  expect(harness.currentLoad).toBe(1);
}

async function resolveLoad(index: number, result: LoadResult) {
  await act(async () => {
    harness.loads[index].resolve(result);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function accountName() {
  return container.querySelector("[data-tenant-account-name]")?.textContent ?? "";
}

function accountTier() {
  return container.querySelector("[data-tenant-account-tier]")?.textContent ?? "";
}

function shellAccountName() {
  return container.querySelector(".tcs-context > span")?.textContent ?? "";
}

function shellAccountTier() {
  return container.querySelector(".tcs-context > small")?.textContent ?? "";
}

beforeEach(() => {
  harness.loads = [makeDeferred<LoadResult>(), makeDeferred<LoadResult>()];
  harness.currentLoad = -1;
  harness.authListener = null;
  harness.sessionUid = "authenticated-owner";
  harness.lastSignInAt = null;
  harness.primaryLoads = [];
  harness.agencyAccountNumber = null;
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe("tenant route owners preserve the newest authenticated account context", () => {
  it("fails closed before mounting Solo when no authenticated subject is available", async () => {
    harness.sessionUid = null;
    mount("/solo/424242/command-center", <Route path="/solo/*" element={<SoloEntry />} />);
    await settle();

    expect(container.querySelector("[data-tenant-shell]")).toBeNull();
    expect(container.querySelector("[data-current-path]")?.getAttribute("data-current-path")).toBe("/auth");
  });

  it("fails closed before mounting Solo when the server cannot resolve tenant identity", async () => {
    const recovered = tenant({
      id: "recovered-solo",
      name: "Recovered Solo Workspace",
      account_type: "standalone",
      account_number: 424242,
    });
    mount("/solo/424242/command-center", <Route path="/solo/*" element={<SoloEntry />} />);
    await settle();
    await resolveLoad(0, {
      owner: { data: false, error: null },
      staff: { data: false, error: null },
      profile: {
        data: { active_tenant_id: null, agency_login_default: null },
        error: new Error("profile unavailable"),
      },
      tenants: { data: [], error: new Error("tenant resolver unavailable") },
    });

    expect(container.querySelector("[data-tenant-shell]")).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't verify your workspace");

    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(harness.currentLoad).toBe(1);
    expect(container.querySelector("[data-tenant-shell]")).toBeNull();

    await resolveLoad(1, loadResult(recovered.id, [recovered]));
    expect(accountName()).toBe("Recovered Solo Workspace");
    expect(accountTier()).toBe("Solo");
  });

  it.each([
    ["Agency Parent", "/agency/700001/calendar/tasks", "agency", "tasks"],
    ["direct Sub-account", "/business/700002/calendar/availability", "sub_account", "availability"],
    ["Enterprise compatibility", "/agency/600001/calendar/booking-pages", "enterprise", "booking"],
  ] as const)("mounts the canonical Calendar through the real %s route owner", async (_label, path, accountType, tab) => {
    const routeTenant = tenant({
      id: `calendar-${accountType}`,
      name: `${accountType} Calendar Account`,
      account_type: accountType,
      account_number: Number(path.split("/")[2]),
    });
    const route = path.startsWith("/solo/")
      ? <Route path="/solo/*" element={<SoloEntry />} />
      : path.startsWith("/business/")
        ? <Route path="/business/*" element={<BusinessEntry />} />
        : <Route path="/agency/*" element={<AgencyEntry />} />;
    mount(path, route);
    await startOverlappingLoads();
    await resolveLoad(1, loadResult(routeTenant.id, [routeTenant]));

    const calendar = container.querySelector("[data-canonical-calendar]");
    expect(calendar?.getAttribute("data-calendar-tenant")).toBe(routeTenant.id);
    expect(calendar?.getAttribute("data-calendar-tab")).toBe(tab);
    expect(container.querySelectorAll("[data-canonical-calendar]")).toHaveLength(1);
  });

  it("mounts the Solo-native Calendar through the real Solo route owner", async () => {
    const routeTenant = tenant({
      id: "calendar-solo",
      name: "solo Calendar Account",
      account_type: "solo",
      account_number: 424242,
    });
    mount("/solo/424242/calendar/agenda", <Route path="/solo/*" element={<SoloEntry />} />);
    await startOverlappingLoads();
    await resolveLoad(1, loadResult(routeTenant.id, [routeTenant]));

    const calendar = container.querySelector("[data-canonical-calendar]");
    expect(calendar?.getAttribute("data-calendar-tenant")).toBe(routeTenant.id);
    expect(calendar?.getAttribute("data-solo-native")).toBe("true");
    expect(container.querySelectorAll("[data-canonical-calendar]")).toHaveLength(1);
  });

  it("mounts the canonical Calendar for the authenticated acting child, never the parent", async () => {
    const parent = tenant({ id: "calendar-parent", name: "Calendar Parent", account_type: "agency", account_number: 700001 });
    const child = tenant({
      id: "calendar-child",
      name: "Calendar Child",
      account_type: "sub_account",
      parent_tenant_id: parent.id,
      account_number: 700002,
    });
    mount(
      "/agency/700001/sub/700002/calendar/connections",
      <Route path="/agency/*" element={<AgencyEntry />} />,
    );
    await startOverlappingLoads();
    await resolveLoad(1, loadResult(child.id, [parent, child]));

    const calendar = container.querySelector("[data-canonical-calendar]");
    expect(calendar?.getAttribute("data-calendar-tenant")).toBe(child.id);
    expect(calendar?.getAttribute("data-calendar-tenant")).not.toBe(parent.id);
    expect(calendar?.getAttribute("data-calendar-connections")).toBe(
      "/agency/700001/sub/700002/integrations",
    );
  });

  it("resolves the real Solo owner chain asynchronously and rejects a stale empty load", async () => {
    const solo = tenant({
      id: "solo-async",
      name: "Async Sterling Workspace",
      account_type: "standalone",
      account_number: 424242,
    });
    mount(
      "/solo/424242/command-center",
      <Route path="/solo/*" element={<SoloEntry />} />,
    );

    expect(container.querySelector("[data-provider-loading]")?.getAttribute("data-provider-loading")).toBe("true");
    expect(accountName()).toBe("");
    await startOverlappingLoads();

    await resolveLoad(1, loadResult(solo.id, [solo]));
    expect(accountName()).toBe("Async Sterling Workspace");
    expect(accountTier()).toBe("Solo");
    expect(container.textContent).not.toContain("Your business");

    await resolveLoad(0, loadResult(null, []));
    expect(container.querySelector("[data-provider-loading]")?.getAttribute("data-provider-loading")).toBe("false");
    expect(container.querySelector("[data-provider-tenant-id]")?.getAttribute("data-provider-tenant-id")).toBe(solo.id);
    expect(accountName()).toBe("Async Sterling Workspace");
    expect(accountTier()).toBe("Solo");
    expect(container.textContent).not.toContain("Your business");
    expect(container.textContent).not.toContain("Your workspace");
  });

  it("keeps the authenticated Agency acting-child identity separate from its parent", async () => {
    const parent = tenant({
      id: "agency-parent",
      name: "Agency Parent",
      account_type: "agency",
      account_number: 700001,
    });
    const child = tenant({
      id: "acting-child",
      name: "Acting Child",
      account_type: "standalone",
      parent_tenant_id: parent.id,
      account_number: 700002,
    });
    mount(
      "/agency/700001/sub/700002/command-center",
      <Route path="/agency/*" element={<AgencyEntry />} />,
    );

    expect(container.querySelector("[data-provider-loading]")?.getAttribute("data-provider-loading")).toBe("true");
    expect(accountName()).toBe("");
    await startOverlappingLoads();

    await resolveLoad(1, loadResult(child.id, [parent, child]));
    expect(container.querySelector("[data-provider-tenant-id]")?.getAttribute("data-provider-tenant-id")).toBe(child.id);
    expect(accountName()).toBe("Acting Child");
    expect(accountTier()).toBe("Sub-account");
    expect(accountName()).not.toBe("Agency Parent");
    expect(container.querySelector("[data-current-path]")?.getAttribute("data-current-path")).toBe(
      "/agency/700001/sub/700002/command-center",
    );
    expect(
      Array.from(container.querySelectorAll('nav[aria-label="Tenant workspace"] a')).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual([
      "/agency/700001/sub/700002/command-center",
      "/agency/700001/sub/700002/clients",
      "/agency/700001/sub/700002/growth",
      "/agency/700001/sub/700002/analytics",
      "/agency/700001/sub/700002/setup",
    ]);

    await resolveLoad(0, loadResult(parent.id, [parent]));
    expect(container.querySelector("[data-provider-tenant-id]")?.getAttribute("data-provider-tenant-id")).toBe(child.id);
    expect(accountName()).toBe("Acting Child");
    expect(accountTier()).toBe("Sub-account");
  });

  it("keeps Enterprise on the existing agency compatibility owner with Enterprise identity", async () => {
    const enterprise = tenant({
      id: "enterprise-parent",
      name: "Enterprise Parent",
      account_type: "enterprise",
      account_number: 600001,
    });
    mount("/agency/600001/clients/people", <Route path="/agency/*" element={<AgencyEntry />} />);
    await startOverlappingLoads();
    await resolveLoad(1, loadResult(enterprise.id, [enterprise]));

    expect(shellAccountName()).toBe("Enterprise Parent");
    expect(shellAccountTier()).toBe("Enterprise");
    expect(
      Array.from(container.querySelectorAll('nav[aria-label="Tenant workspace"] a')).map((link) => link.getAttribute("href")),
    ).toEqual([
      "/agency/600001/command-center",
      "/agency/600001/clients",
      "/agency/600001/growth",
      "/agency/600001/analytics",
      "/agency/600001/setup",
    ]);
  });

  it("never commits an older authenticated subject after a different user signs in", async () => {
    const userA = tenant({
      id: "user-a-tenant",
      name: "User A Private Workspace",
      account_type: "standalone",
      account_number: 424242,
    });
    const userB = tenant({
      id: "user-b-tenant",
      name: "User B Workspace",
      account_type: "standalone",
      account_number: 424242,
    });
    harness.sessionUid = "user-a";
    mount("/solo/424242/command-center", <Route path="/solo/*" element={<SoloEntry />} />);
    await settle();
    expect(harness.currentLoad).toBe(0);

    harness.sessionUid = "user-b";
    await act(async () => {
      harness.authListener?.("SIGNED_IN");
      await Promise.resolve();
    });
    expect(harness.currentLoad).toBe(1);

    await resolveLoad(0, loadResult(userA.id, [userA]));
    expect(container.textContent).not.toContain("User A Private Workspace");
    expect(accountName()).toBe("");

    await resolveLoad(1, loadResult(userB.id, [userB]));
    expect(accountName()).toBe("User B Workspace");
    expect(accountTier()).toBe("Solo");
  });

  it("preserves a valid account when a later foreground refresh has a transient read failure", async () => {
    const solo = tenant({
      id: "stable-solo",
      name: "Stable Solo Workspace",
      account_type: "standalone",
      account_number: 424242,
    });
    mount("/solo/424242/command-center", <Route path="/solo/*" element={<SoloEntry />} />);
    await settle();
    await resolveLoad(0, loadResult(solo.id, [solo]));
    expect(accountName()).toBe("Stable Solo Workspace");

    await act(async () => {
      (container.querySelector("[data-provider-refresh]") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(harness.currentLoad).toBe(1);
    await resolveLoad(1, {
      profile: { data: { active_tenant_id: solo.id, agency_login_default: null }, error: null },
      tenants: { data: [], error: new Error("temporary tenants read failure") },
    });

    expect(accountName()).toBe("Stable Solo Workspace");
    expect(accountTier()).toBe("Solo");
    expect(container.querySelector("[data-provider-loading]")?.getAttribute("data-provider-loading")).toBe("false");
  });

  it("does not let an older fresh-sign-in reconciliation release or burn a newer load", async () => {
    const solo = tenant({
      id: "fresh-solo",
      name: "Fresh Solo Workspace",
      account_type: "standalone",
      account_number: 424242,
    });
    const primaryA = makeDeferred<{ data: Array<{ tenant_id: string }> | null; error: unknown }>();
    const primaryB = makeDeferred<{ data: Array<{ tenant_id: string }> | null; error: unknown }>();
    harness.primaryLoads = [primaryA, primaryB];
    harness.lastSignInAt = "2026-08-25T20:00:00.000Z";
    mount("/solo/424242/command-center", <Route path="/solo/*" element={<SoloEntry />} />);
    await settle();
    await resolveLoad(0, loadResult(solo.id, [solo]));

    await act(async () => {
      harness.authListener?.("TOKEN_REFRESHED");
      await Promise.resolve();
    });
    expect(harness.currentLoad).toBe(1);
    await resolveLoad(1, loadResult(solo.id, [solo]));

    await act(async () => {
      primaryA.resolve({ data: [{ tenant_id: solo.id }], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-provider-loading]")?.getAttribute("data-provider-loading")).toBe("true");
    expect(window.localStorage.getItem("paige.auth.lastSignInAt.authenticated-owner")).toBeNull();

    await act(async () => {
      primaryB.resolve({ data: [{ tenant_id: solo.id }], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-provider-loading]")?.getAttribute("data-provider-loading")).toBe("false");
    expect(window.localStorage.getItem("paige.auth.lastSignInAt.authenticated-owner")).toBe(harness.lastSignInAt);
    expect(accountName()).toBe("Fresh Solo Workspace");
    expect(accountTier()).toBe("Solo");
  });

  it("withholds a parked child identity until fresh-sign-in home resolution completes", async () => {
    const home = tenant({
      id: "home-solo",
      name: "Home Solo Workspace",
      account_type: "standalone",
      account_number: 424242,
    });
    const parkedChild = tenant({
      id: "parked-child",
      name: "Parked Child Workspace",
      account_type: "standalone",
      parent_tenant_id: "agency-parent",
      account_number: 999999,
    });
    const primary = makeDeferred<{ data: Array<{ tenant_id: string }> | null; error: unknown }>();
    harness.primaryLoads = [primary];
    harness.lastSignInAt = "2026-08-25T21:00:00.000Z";
    mount("/solo/424242/command-center", <Route path="/solo/*" element={<SoloEntry />} />);
    await settle();
    await resolveLoad(0, loadResult(parkedChild.id, [home, parkedChild]));

    expect(container.querySelector("[data-provider-account-loading]")?.getAttribute("data-provider-account-loading")).toBe("true");
    expect(accountName()).toBe("");
    expect(container.textContent).not.toContain("Parked Child Workspace");
    expect(container.querySelector("[data-current-path]")?.getAttribute("data-current-path")).toBe(
      "/solo/424242/command-center",
    );

    await act(async () => {
      primary.resolve({ data: [{ tenant_id: home.id }], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-provider-account-loading]")?.getAttribute("data-provider-account-loading")).toBe("false");
    expect(accountName()).toBe("Home Solo Workspace");
    expect(accountTier()).toBe("Solo");
    expect(container.textContent).not.toContain("Parked Child Workspace");
  });
});
