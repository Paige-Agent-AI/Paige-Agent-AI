import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  memberships: [
    { tenant_id: "antonio", role: "admin" },
    { tenant_id: "mogul", role: "owner" },
  ],
  user: { id: "user-1", email: "mrmogulmaker@gmail.com" } as { id: string; email: string } | null,
  membershipError: null as { message: string } | null,
  context: {
    tenants: [
      { id: "antonio", slug: "antonio", name: "Antonio Daniel LLC", status: "active", account_type: "standalone", parent_tenant_id: null, account_number: 111111, features: { solo_shell_enabled: true } },
      { id: "mogul", slug: "mogul", name: "Mogul Maker Academy", status: "active", account_type: "standalone", parent_tenant_id: null, account_number: 222222, features: { solo_shell_enabled: true } },
      { id: "hidden", slug: "hidden", name: "Not My Account", status: "active", account_type: "standalone", parent_tenant_id: null, account_number: 333333, features: { solo_shell_enabled: true } },
    ],
    activeTenantId: "antonio",
    accountContextLoading: false,
    accountContextStatus: "ready",
    isPlatformStaff: false,
    switchTenant: vi.fn(),
    refresh: vi.fn(),
  },
}));

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => harness.context }));
vi.mock("@/integrations/auth/oauth", () => ({ signInWithOAuth: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: harness.user }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn(() => {
      const result = { data: harness.memberships, error: harness.membershipError };
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    }),
  },
}));

// Captured once, before any test can mutate the harness.
const PRISTINE_TENANTS = harness.context.tenants.map((t) => ({ ...t }));

import { registerAccountSwitchGuard } from "@/lib/auth/accountSwitchGuard";
import { supabase } from "@/integrations/supabase/client";
import { signInWithOAuth } from "@/integrations/auth/oauth";
import { GOD_CONSOLE } from "@/lib/auth/operatorTarget";
import ChooseAccount from "./ChooseAccount";

function LocationProbe() {
  const loc = useLocation();
  return <i data-loc={loc.pathname} data-search={loc.search} />;
}

describe("ChooseAccount", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    harness.membershipError = null;
    harness.context.activeTenantId = "antonio";
    harness.context.isPlatformStaff = false;
    harness.context.switchTenant = vi.fn(async () => true);
    harness.context.refresh = vi.fn(async () => undefined);
    harness.context.accountContextStatus = "ready";
    // Restore the tenant fixture. Several cases mutate it (status, canary,
    // account_number) and without this the mutations leak forward and the next
    // test passes or fails for a reason that has nothing to do with its subject.
    harness.context.tenants = PRISTINE_TENANTS.map((t) => ({ ...t }));
    harness.user = { id: "user-1", email: "mrmogulmaker@gmail.com" };
    harness.memberships = [
      { tenant_id: "antonio", role: "admin" },
      { tenant_id: "mogul", role: "owner" },
    ];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows only the signed-in identity's active Paige memberships", async () => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
    });

    expect(host.textContent).toContain("Where do you want to work?");
    expect(host.textContent).toContain("mrmogulmaker@gmail.com");
    expect(host.textContent).toContain("Antonio Daniel LLC");
    expect(host.textContent).toContain("Solo account · Admin");
    expect(host.textContent).toContain("Mogul Maker Academy");
    expect(host.textContent).not.toContain("Not My Account");
    expect(host.querySelectorAll("button").length).toBeGreaterThanOrEqual(3);
  });

  it("pauses platform staff with an explicit Platform choice and their direct memberships", async () => {
    harness.context.isPlatformStaff = true;
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });

    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    expect(host.textContent).toContain("Choose the Platform or a Paige account to continue.");
    expect(host.textContent).toContain("Platform operations");
    expect(host.textContent).toContain("Antonio Daniel LLC");
    expect(host.textContent).toContain("Mogul Maker Academy");
    expect(host.textContent).not.toContain("Not My Account");
  });

  it("pauses platform-only staff and offers Platform without inventing a workspace", async () => {
    harness.context.isPlatformStaff = true;
    harness.context.activeTenantId = null;
    harness.context.tenants = [];
    harness.memberships = [];

    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });

    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    expect(host.textContent).toContain("Platform operations");
    expect(host.textContent).not.toContain("couldn't confirm a workspace");
  });

  it("still pauses platform staff after the chooser is refreshed", async () => {
    harness.context.isPlatformStaff = true;
    sessionStorage.setItem("paige.workspace.entered", "antonio");

    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    expect(host.textContent).toContain("Platform operations");

    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });

    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    expect(host.textContent).toContain("Platform operations");
  });

  it("enters Platform through the audited null-scope switch before navigating", async () => {
    harness.context.isPlatformStaff = true;
    sessionStorage.setItem("paige.workspace.entered", "antonio");
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Platform operations"));
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(harness.context.switchTenant).toHaveBeenCalledWith(null);
    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe(GOD_CONSOLE);
    expect(sessionStorage.getItem("paige.workspace.entered")).toBeNull();
  });

  it("recovers a safe operator deep link only after Platform is selected", async () => {
    harness.context.isPlatformStaff = true;
    harness.context.activeTenantId = null;
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account?next=%2Foperator%2Fsettings%2Fteam%2Froles"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Platform operations"));
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/operator/settings/team/roles");
  });

  it("stays on the chooser when Platform scope cannot be entered", async () => {
    harness.context.isPlatformStaff = true;
    harness.context.switchTenant = vi.fn(async () => false);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Platform operations"));
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    expect(host.textContent).toContain("couldn't open the Platform");
  });

  // The owner ruling of 2026-09-02: choosing a workspace ENTERS it. Routing the
  // choice back through `/admin` is what re-opened the parked context and put an
  // owner in a workspace they had not chosen, so the destination is the chosen
  // workspace's own root.
  it("enters the CHOSEN workspace at its own root instead of routing back through /admin", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign, search: "" } });
    harness.context.switchTenant = vi.fn(async () => true);

    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
    });
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Mogul Maker Academy"));
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(harness.context.switchTenant).toHaveBeenCalledWith("mogul");
    expect(assign).toHaveBeenCalledWith("/solo/222222/command-center");
    expect(assign).not.toHaveBeenCalledWith("/admin");
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  // The loop breaker. `/admin` now sends a multi-context person here, and the two
  // surfaces count workspaces from different sources — this page re-queries
  // memberships, the host reads the tenant context — so they can disagree by one.
  // Without the marker on the way back, a disagreement is an infinite redirect.
  // ONE TRUTHFUL TRANSITION. With a single workspace to offer, the page does not
  // merely record it and leave — it performs the switch, and only records the entry
  // once that succeeded. Recording an entry that never happened is exactly what made
  // the door and this page disagree forever.
  it("pauses on the chooser for a single workspace and enters it only after selection", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign, search: "" } });
    harness.memberships = [{ tenant_id: "mogul", role: "owner" }];
    harness.context.switchTenant = vi.fn(async () => true);

    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });

    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    expect(host.textContent).toContain("Mogul Maker Academy");
    expect(harness.context.switchTenant).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("paige.workspace.entered")).toBeNull();

    const button = Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("Mogul Maker Academy"));
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(harness.context.switchTenant).toHaveBeenCalledWith("mogul");
    expect(assign).toHaveBeenCalledWith("/solo/222222/command-center");
    expect(sessionStorage.getItem("paige.workspace.entered")).toBe("mogul");
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  // The other half of the same rule: a FAILED switch records nothing and goes
  // nowhere, so the door still knows this person has not settled anywhere.
  it("records nothing and stays put when the switch itself fails", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign, search: "" } });
    harness.memberships = [{ tenant_id: "mogul", role: "owner" }];
    harness.context.switchTenant = vi.fn(async () => false);

    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
    });
    const button = Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("Mogul Maker Academy"));
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(assign).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("paige.workspace.entered")).toBeNull();
    expect(host.textContent).toContain("couldn't open that account");
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("does not change scope when the selected workspace has no safe canonical route", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign, search: "" } });
    harness.context.tenants = harness.context.tenants.map((tenant) =>
      tenant.id === "mogul" ? { ...tenant, account_number: null } : tenant,
    ) as typeof harness.context.tenants;

    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
    });
    const button = Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("Mogul Maker Academy"));
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(harness.context.switchTenant).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("paige.workspace.entered")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(host.textContent).toContain("canonical workspace address");
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });


  // THE LOCKOUT GUARD. The owner was parked in a sub-account and could not reach
  // this page's picker at all: two of his three workspaces were on `trial`, the
  // filter counted only `active`, so it saw ONE choice, concluded there was
  // nothing to choose, and redirected him back to /admin — into the exact context
  // he was trying to leave. A trial workspace is live and must be offered.
  it("offers TRIAL workspaces, not only active ones", async () => {
    harness.context.tenants = harness.context.tenants.map((t) =>
      t.id === "mogul" ? { ...t, status: "trial" } : t,
    ) as typeof harness.context.tenants;
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    // Still two choices, so the picker RENDERS rather than bouncing to /admin.
    // The probe always renders; what matters is that it still reads this page.
    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    expect(host.textContent).toContain("Where do you want to work?");
    expect(host.textContent).toContain("Mogul Maker Academy");
  });

  it("does not offer a workspace that is genuinely gone", async () => {
    harness.context.tenants = harness.context.tenants.map((t) =>
      t.id === "mogul" ? { ...t, status: "canceled" } : t,
    ) as typeof harness.context.tenants;
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    expect(host.textContent).not.toContain("Mogul Maker Academy");
  });

  // LOOP GUARD. `/admin` sends multi-context people here; this page re-queries
  // memberships while the door reads the tenant context, so the two can disagree.
  // On zero choices an earlier revision wrote no settlement record and still left
  // for `/admin`, which bounced it straight back — an infinite redirect in exactly
  // the branch where the sources disagree.
  // LOOP GUARD, restated for the converged transition. With nothing to offer there
  // is no transition to make and nothing honest to record, so handing back to
  // `/admin` is only safe when that door would not immediately ask again. Here the
  // context still lists enterable workspaces while the membership read returned
  // none — the exact disagreement — so the page stops rather than starting a cycle.
  it("stays on the chooser when memberships and visible workspaces disagree", async () => {
    harness.memberships = [];
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    expect(host.textContent).toContain("couldn't confirm a workspace");
    expect(sessionStorage.getItem("paige.workspace.entered")).toBeNull();
  });

  // ROUND EIGHT'S FINDING 3. The refusal above is right only when the door really
  // would ask. This page's copy of that rule counted workspaces but never consulted
  // the entry record, so with a record already naming the active workspace — the
  // person HAS chosen, and the door would wave them through — it still parked them
  // on an error card the door itself would never have shown. Both surfaces now run
  // one predicate, so a divergence like this cannot be reintroduced on one side.
  it("stays honest when the record names a workspace that is no longer available", async () => {
    sessionStorage.setItem("paige.workspace.entered", "antonio");
    harness.memberships = [];
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    expect(host.textContent).toContain("couldn't confirm a workspace");
  });

  // And when the door genuinely would NOT ask — no enterable workspaces at all —
  // leaving for /admin is correct and terminates.
  it("stays on account selection with an actionable error when no workspace is available", async () => {
    harness.memberships = [];
    harness.context.tenants = [];
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    expect(host.textContent).toContain("couldn't confirm a workspace");
  });


  // A FAILED READ IS NOT ZERO CHOICES. Navigating away on an error made the error
  // card and its Retry unreachable, and turned any transient failure on one query
  // into a redirect storm.
  it("shows its error and its Retry instead of leaving when the membership read fails", async () => {
    harness.membershipError = { message: "network" };
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    // It stays here rather than leaving for /admin, which is what makes the card
    // reachable at all.
    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    expect(host.textContent).toContain("couldn't load your Paige accounts");
    expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent?.includes("Retry"))).toBe(true);
  });

  it("shows honest recovery and no choices when account authority cannot be resolved", async () => {
    harness.context.isPlatformStaff = true;
    harness.context.accountContextStatus = "error";

    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
    });

    expect(host.textContent).toContain("couldn't confirm your account access");
    expect(host.textContent).not.toContain("Platform operations");
    expect(host.textContent).not.toContain("Antonio Daniel LLC");
    const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Retry"));
    await act(async () => { retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(harness.context.refresh).toHaveBeenCalledTimes(1);
  });

  // §58 — a protection that shipped on `main` for the control this PR DELETES.
  // `settings-setup.tsx` registers a guard while Setup is dirty or mid-save, and
  // the deleted `MemberAccountSwitcher` was its only caller. Replacing that control
  // has to carry its protection across, not just its capability.
  it("refuses to switch when a registered guard says the workspace has unsaved work", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign, search: "" } });
    harness.context.switchTenant = vi.fn(async () => true);
    const release = registerAccountSwitchGuard(async () => false);

    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
    });
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Mogul Maker Academy"));
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(harness.context.switchTenant).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    release();
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("protects unsaved work before leaving a Paige workspace for Platform", async () => {
    harness.context.isPlatformStaff = true;
    harness.context.switchTenant = vi.fn(async () => true);
    const release = registerAccountSwitchGuard(async () => false);

    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /><LocationProbe /></MemoryRouter>);
    });
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Platform operations"));
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(harness.context.switchTenant).not.toHaveBeenCalled();
    expect(host.querySelector("[data-loc]")?.getAttribute("data-loc")).toBe("/choose-account");
    release();
  });

  // Nothing from the previous account may render under the new one's heading.
  // A full-page load already clears React state and the query cache; what survives
  // is browser storage, and these three keys name the OLD account rather than a
  // preference belonging to the person.
  it("drops the leaving workspace's identity and navigation state when a choice is made", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign, search: "" } });
    harness.context.switchTenant = vi.fn(async () => true);
    sessionStorage.setItem("paige_impersonating_contact", '{"id":"contact-from-old-account"}');
    sessionStorage.setItem("paige.oauth.return", '{"path":"/solo/111111/settings"}');
    // Deliberately NOT cleared: `BusinessContext` selects by `owner_user_id`, so
    // this names the PERSON, not the account they were in.
    localStorage.setItem("paige.activeBusinessId", "belongs-to-the-person");

    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
    });
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Mogul Maker Academy"));
    await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(sessionStorage.getItem("paige_impersonating_contact")).toBeNull();
    expect(sessionStorage.getItem("paige.oauth.return")).toBeNull();
    expect(localStorage.getItem("paige.activeBusinessId")).toBe("belongs-to-the-person");
    expect(sessionStorage.getItem("paige.workspace.entered")).toBe("mogul");
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
  // Codex review of #1547 (850ba847). An operator acting as a tenant reaches this page through
  // Switch workspace with the act-as still open. The server now refuses an enter over an open
  // act-as, and signing out leaves the server-side act-as open with no exit receipt, so both
  // routes out of this page end the act-as through the audited exit first.
  describe("an operator arriving with an act-as open", () => {
    beforeEach(() => {
      harness.context.isPlatformStaff = true;
      harness.context.activeTenantId = "antonio";
    });

    it("ends the act-as before entering the chosen workspace", async () => {
      const assign = vi.fn();
      const original = window.location;
      Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign, search: "" } });
      const calls: Array<string | null> = [];
      harness.context.switchTenant = vi.fn(async (id: string | null) => { calls.push(id); return true; });
      await act(async () => {
        root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
      });
      const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Mogul Maker Academy"));
      await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(calls).toEqual([null, "mogul"]);
      expect(assign).toHaveBeenCalledWith("/solo/222222/command-center");
      Object.defineProperty(window, "location", { configurable: true, value: original });
    });

    it("enters nothing and says so when the act-as cannot be ended", async () => {
      const assign = vi.fn();
      const original = window.location;
      Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign, search: "" } });
      harness.context.switchTenant = vi.fn(async (id: string | null) => id !== null);
      await act(async () => {
        root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
      });
      const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Mogul Maker Academy"));
      await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(harness.context.switchTenant).not.toHaveBeenCalledWith("mogul");
      expect(assign).not.toHaveBeenCalled();
      expect(host.textContent).toContain("Paige couldn't end your act-as in Antonio Daniel LLC. Nothing else was entered.");
      Object.defineProperty(window, "location", { configurable: true, value: original });
    });

    it("ends the act-as before signing out for a different account", async () => {
      const order: string[] = [];
      harness.context.switchTenant = vi.fn(async (id: string | null) => { order.push(`switch:${id}`); return true; });
      vi.mocked(supabase.auth.signOut).mockImplementationOnce(async () => { order.push("signOut"); return { error: null }; });
      vi.mocked(signInWithOAuth).mockResolvedValueOnce({ error: null } as never);
      await act(async () => {
        root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
      });
      const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("different Google account"));
      await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(order).toEqual(["switch:null", "signOut"]);
    });

    it("does not sign out while the act-as cannot be ended", async () => {
      harness.context.switchTenant = vi.fn(async () => false);
      vi.mocked(supabase.auth.signOut).mockClear();
      await act(async () => {
        root.render(<MemoryRouter initialEntries={["/choose-account"]}><ChooseAccount /></MemoryRouter>);
      });
      const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("different Google account"));
      await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
      expect(host.textContent).toContain("Paige couldn't end your act-as in Antonio Daniel LLC, so you're still signed in.");
    });
  });
});
