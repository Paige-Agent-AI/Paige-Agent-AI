import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  userId: "test-user-admission" as string | null,
  provisioned: false,
  profileFailure: false,
  tenantFailure: false,
  scopeFailure: false,
  roleFailure: false,
  actorFailure: false,
  catalogEmpty: false,
  selectedTenantId: "test-tenant-admission" as string | null,
  accountNumber: 10001,
  accountType: "standalone",
  enrollmentState: "pending",
  enrollmentDestination: "/solo/10001/command-center",
  trace: [] as string[],
  listeners: new Set<(event: string, session: unknown) => void>(),
  onVerified: null as (() => void) | null,
  scopeWait: null as Promise<void> | null,
  enrollmentWait: null as Promise<void> | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const session = () => fixture.userId ? { user: { id: fixture.userId } } : null;
  const from = (table: string) => {
    let list = false;
    const result = () => {
      fixture.trace.push(`read:${table}:${fixture.provisioned ? "fulfilled" : "pending"}`);
      if (table === "profiles") return {
        data: fixture.userId ? { user_id: fixture.userId, active_tenant_id: fixture.provisioned ? fixture.selectedTenantId : null, agency_login_default: null } : null,
        error: fixture.profileFailure ? { message: "profile unavailable" } : null,
      };
      if (table === "tenants") return {
        data: fixture.provisioned && !(list && fixture.catalogEmpty) ? [{ id: "test-tenant-admission", account_number: fixture.accountNumber, account_type: fixture.accountType, parent_tenant_id: null, name: "Test business", status: "active", features: {} }] : [],
        error: fixture.tenantFailure ? { message: "tenant unavailable" } : null,
      };
      return { data: [], error: null };
    };
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => { list = true; return builder; },
      maybeSingle: async () => {
        const value = result();
        return { ...value, data: Array.isArray(value.data) ? value.data[0] ?? null : value.data };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  };
  return { supabase: {
    from,
    auth: {
      getSession: vi.fn(async () => ({ data: { session: session() }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: session()?.user ?? null }, error: fixture.actorFailure ? { message: "actor unavailable" } : null })),
      onAuthStateChange: vi.fn((listener: (event: string, session: unknown) => void) => {
        fixture.listeners.add(listener);
        return { data: { subscription: { unsubscribe: () => fixture.listeners.delete(listener) } } };
      }),
    },
    rpc: vi.fn(async (name: string) => {
      fixture.trace.push(`rpc:${name}`);
      if (name === "current_user_tenant_id") {
        await fixture.scopeWait;
        return { data: fixture.provisioned ? fixture.selectedTenantId : null, error: fixture.scopeFailure ? { message: "scope unavailable" } : null };
      }
      return { data: false, error: fixture.roleFailure && name === "is_platform_admin" ? { message: "roles unavailable" } : null };
    }),
    functions: { invoke: vi.fn(async () => {
      fixture.trace.push(`enrollment:${fixture.enrollmentState}`);
      if (fixture.enrollmentState === "verified") fixture.onVerified?.();
      const data = { state: fixture.enrollmentState, reference_id: "test-enrollment-reference", retryable: true, message: "Server enrollment result", destination: fixture.enrollmentState === "choose_account" ? "/choose-account" : fixture.enrollmentDestination };
      await fixture.enrollmentWait;
      return { data, error: null };
    }) },
  } };
});

// The shell content is outside this proof. SoloEntry and TenantProvider are the real
// production components: the marker appears only after their actual entry fence.
vi.mock("@/solo/SoloApp", () => ({ default: () => <div data-solo-mounted="true">Authorized Solo shell</div> }));

import { TenantProvider, useTenantContext } from "@/hooks/useTenantContext";
import SoloEntry from "@/solo/SoloEntry";
import Welcome from "./Welcome";

function ContextProbe() {
  const context = useTenantContext();
  const location = useLocation();
  return <i data-location={location.pathname} data-provider-user={context.activeUserId ?? ""} data-provider-tenant={context.activeTenantId ?? ""} data-provider-status={context.accountContextStatus} />;
}

function LeaveWelcome() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/pricing")}>Leave Welcome</button>;
}

describe("Welcome with the mounted canonical tenant provider", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    fixture.userId = "test-user-admission";
    fixture.provisioned = false;
    fixture.profileFailure = false;
    fixture.tenantFailure = false;
    fixture.scopeFailure = false;
    fixture.roleFailure = false;
    fixture.actorFailure = false;
    fixture.catalogEmpty = false;
    fixture.selectedTenantId = "test-tenant-admission";
    fixture.accountNumber = 10001;
    fixture.accountType = "standalone";
    fixture.enrollmentState = "pending";
    fixture.enrollmentDestination = "/solo/10001/command-center";
    fixture.trace = [];
    fixture.listeners.clear();
    fixture.onVerified = null;
    fixture.scopeWait = null;
    fixture.enrollmentWait = null;
    localStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  async function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(<QueryClientProvider client={client}><TenantProvider><MemoryRouter initialEntries={["/welcome?checkout=success"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ContextProbe />
        <LeaveWelcome />
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/solo/*" element={<SoloEntry />} />
          <Route path="/choose-account" element={<div data-chooser="true">Choose account</div>} />
          <Route path="/pricing" element={<div>Pricing</div>} />
        </Routes>
      </MemoryRouter></TenantProvider></QueryClientProvider>);
    });
  }

  async function fulfill() {
    fixture.provisioned = true;
    fixture.enrollmentState = "verified";
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  }

  it("rehydrates a pre-fulfillment empty provider before the real SoloEntry mounts", async () => {
    await mount();
    expect(host.querySelector("[data-provider-tenant]")?.getAttribute("data-provider-tenant")).toBe("");
    expect(host.querySelector("[data-provider-status]")?.getAttribute("data-provider-status")).toBe("ready");
    expect(fixture.trace).toContain("read:tenants:pending");
    await fulfill();
    expect(host.querySelector("[data-solo-mounted]")).not.toBeNull();
    expect(host.querySelector("[data-provider-tenant]")?.getAttribute("data-provider-tenant")).toBe("test-tenant-admission");
    expect(fixture.trace).toContain("read:profiles:fulfilled");
    expect(fixture.trace).toContain("read:tenants:fulfilled");
    expect(host.textContent).not.toContain("Couldn't verify your workspace");
    expect(fixture.trace.filter((item) => item.startsWith("enrollment:"))).toEqual(["enrollment:pending", "enrollment:verified"]);
  });

  function expectBlocked() {
    expect(host.querySelector("[data-location]")?.getAttribute("data-location")).toBe("/welcome");
    expect(host.querySelector("[data-solo-mounted]")).toBeNull();
    expect(host.textContent).toContain("We could not open your workspace");
    expect(host.textContent).toContain("Retry verification");
    expect(host.textContent).not.toContain("Solo access was not activated");
  }

  it("recovers from a profile read failure without losing the enrollment reference", async () => {
    await mount();
    fixture.profileFailure = true;
    await fulfill();
    expectBlocked();
    expect(host.textContent).toContain("test-enrollment-reference");
    fixture.profileFailure = false;
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry verification")?.click();
    });
    expect(host.querySelector("[data-solo-mounted]")).not.toBeNull();
  });

  it.each([null, "test-user-other"])("clears a settled workspace failure when Auth changes to %s", async (userId) => {
    await mount();
    fixture.profileFailure = true;
    await fulfill();
    expectBlocked();
    expect(host.textContent).toContain("Your enrollment is verified");
    await act(async () => {
      fixture.userId = userId;
      fixture.listeners.forEach((listener) => listener(userId ? "SIGNED_IN" : "SIGNED_OUT", userId ? { user: { id: userId } } : null));
    });
    expect(host.querySelector("[data-solo-mounted]")).toBeNull();
    expect(host.textContent).toContain("Your session ended before server verification completed");
    expect(host.textContent).toContain("Sign in and resume");
    expect(host.textContent).not.toContain("Your enrollment is verified");
    expect(host.textContent).not.toContain("Retry verification");
    expect(host.textContent).not.toContain("test-enrollment-reference");
  });

  it.each(["tenant", "role"] as const)("rejects a %s refresh failure even when a previous matching provider was accepted", async (failure) => {
    fixture.provisioned = true;
    await mount();
    expect(host.querySelector("[data-provider-tenant]")?.getAttribute("data-provider-tenant")).toBe("test-tenant-admission");
    if (failure === "tenant") fixture.tenantFailure = true;
    else fixture.roleFailure = true;
    await fulfill();
    expectBlocked();
  });

  it.each(["scope", "actor"] as const)("rejects failed fresh %s readback", async (failure) => {
    await mount();
    if (failure === "scope") fixture.scopeFailure = true;
    else fixture.actorFailure = true;
    await fulfill();
    expectBlocked();
  });

  it("rejects a provider with no selected catalog record even when canonical specific reads return a tenant", async () => {
    await mount();
    fixture.catalogEmpty = true;
    await fulfill();
    expectBlocked();
  });

  it.each(["/solo/10002/command-center", "/operator/fleet/directory", "/solo/9007199254740992/command-center"])("does not derive workspace scope from destination %s", async (destination) => {
    await mount();
    fixture.enrollmentDestination = destination;
    await fulfill();
    expectBlocked();
  });

  it("leaves an existing different server selection untouched", async () => {
    await mount();
    fixture.selectedTenantId = "test-tenant-other";
    await fulfill();
    expectBlocked();
    expect(fixture.selectedTenantId).toBe("test-tenant-other");
  });

  it("preserves canonical tier containment instead of turning an agency row into Solo", async () => {
    await mount();
    fixture.accountType = "agency";
    await fulfill();
    expectBlocked();
  });

  it.each([null, "test-user-other"])("drops an in-flight handoff when Auth changes to %s", async (userId) => {
    await mount();
    let release!: () => void;
    fixture.scopeWait = new Promise<void>((resolve) => { release = resolve; });
    await fulfill();
    expect(fixture.trace).toContain("rpc:current_user_tenant_id");
    await act(async () => {
      fixture.userId = userId;
      fixture.listeners.forEach((listener) => listener(userId ? "SIGNED_IN" : "SIGNED_OUT", userId ? { user: { id: userId } } : null));
      release();
    });
    expect(host.querySelector("[data-solo-mounted]")).toBeNull();
    expect(host.textContent).toContain("Sign in and resume");
  });

  it("refuses scope that changes during final canonical readback", async () => {
    await mount();
    let release!: () => void;
    fixture.scopeWait = new Promise<void>((resolve) => { release = resolve; });
    await fulfill();
    await act(async () => { fixture.selectedTenantId = "test-tenant-other"; release(); });
    expectBlocked();
  });

  it("does not return to Solo after the person leaves Welcome during readback", async () => {
    await mount();
    let release!: () => void;
    fixture.scopeWait = new Promise<void>((resolve) => { release = resolve; });
    await fulfill();
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Leave Welcome")?.click();
      release();
    });
    expect(host.querySelector("[data-location]")?.getAttribute("data-location")).toBe("/pricing");
    expect(host.querySelector("[data-solo-mounted]")).toBeNull();
  });

  it("times out hung canonical readback and ignores its late completion", async () => {
    await mount();
    let release!: () => void;
    fixture.scopeWait = new Promise<void>((resolve) => { release = resolve; });
    await fulfill();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expectBlocked();
    await act(async () => { release(); });
    expectBlocked();
  });

  it.each([0, 3000])("allows bounded workspace readback after late enrollment verification (response delay %sms)", async (responseDelay) => {
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(26000); });
    let releaseScope!: () => void;
    fixture.scopeWait = new Promise<void>((resolve) => { releaseScope = resolve; });
    fixture.provisioned = true;
    fixture.enrollmentState = "verified";
    let releaseEnrollment!: () => void;
    if (responseDelay) fixture.enrollmentWait = new Promise<void>((resolve) => { releaseEnrollment = resolve; });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    if (responseDelay) {
      await act(async () => { await vi.advanceTimersByTimeAsync(responseDelay); releaseEnrollment(); });
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(host.querySelector("[data-solo-mounted]")).toBeNull();
    expect(host.textContent).toContain("Confirming the selected workspace");
    expect(host.textContent).not.toContain("We could not open your workspace");
    await act(async () => { releaseScope(); });
    expect(host.querySelector("[data-solo-mounted]")).not.toBeNull();
    expect(host.querySelector("[data-provider-tenant]")?.getAttribute("data-provider-tenant")).toBe("test-tenant-admission");
  });

  it("preserves the existing deliberate chooser handoff", async () => {
    fixture.enrollmentState = "choose_account";
    await mount();
    expect(host.querySelector("[data-chooser]")).not.toBeNull();
    expect(fixture.trace).not.toContain("rpc:current_user_tenant_id");
  });

  it("ignores an old chooser response after the authenticated subject changes", async () => {
    fixture.enrollmentState = "choose_account";
    let release!: () => void;
    fixture.enrollmentWait = new Promise<void>((resolve) => { release = resolve; });
    await mount();
    await act(async () => {
      fixture.userId = "test-user-other";
      fixture.listeners.forEach((listener) => listener("SIGNED_IN", { user: { id: fixture.userId } }));
      release();
    });
    expect(host.querySelector("[data-chooser]")).toBeNull();
    expect(host.textContent).toContain("Sign in and resume");
  });
});
