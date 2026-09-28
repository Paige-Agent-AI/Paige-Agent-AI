// Wiring proof for the `/business/*` entry guards (owner ruling 2026-09-02).
//
// The pure rule is covered by `src/lib/auth/workspaceEntry.test.ts`. This file
// asserts the different thing that actually matters for the reported defect:
// that the ENTRY COMPONENT applies it, and — just as important — that it does
// NOT apply it to a caller it has not classified yet.
//
// It renders on a real client root inside `act` rather than with
// `renderToStaticMarkup`, because `<Navigate>` navigates in an effect: under
// static markup no redirect ever runs, so a test written that way can only ever
// observe "the shell did not mount" and never WHERE the caller was sent. An
// earlier revision of this file claimed to read the resulting location and did
// not. These tests read it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Tenant = {
  account_type: string | null;
  parent_tenant_id: string | null;
  account_number: number | null;
  status?: string;
};

const tc = vi.hoisted(() => ({
  ctx: {
    accountContextLoading: false,
    accountContextStatus: "ready" as string,
    isPlatformStaff: false,
    activeTenant: null as Tenant | null,
    refresh: async () => {},
    activeUserId: "op" as string | null,
    exitOperatorActAs: (async () => true) as () => Promise<boolean>,
    probeOperatorActAs: (async () => false) as () => Promise<boolean>,
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => tc.ctx }));
// The sub-account shell is heavy and irrelevant here — we only need to know
// whether the guards let anything through to it.
vi.mock("@/agency/AgencyApp", () => ({ default: () => <div data-mounted="sub-account-shell" /> }));

import BusinessEntry from "./BusinessEntry";
import { recordOperatorActAs } from "@/lib/auth/workspaceEntry";

function LocationProbe() {
  const loc = useLocation();
  return <i data-loc={loc.pathname} />;
}

describe("/business/* entry guards", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    tc.ctx.accountContextLoading = false;
    tc.ctx.accountContextStatus = "ready";
    tc.ctx.isPlatformStaff = false;
    tc.ctx.activeTenant = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    sessionStorage.clear();
  });

  async function renderAt(path: string) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/business/*" element={<BusinessEntry />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    return {
      html: host.innerHTML,
      location: host.querySelector("[data-loc]")?.getAttribute("data-loc") ?? null,
    };
  }

  it("sends a Solo-tier caller to their OWN Solo root instead of mounting the sub-account shell", async () => {
    tc.ctx.activeTenant = { account_type: "standalone", parent_tenant_id: null, account_number: 1971670 };
    const { html, location } = await renderAt("/business/9999/command-center");
    expect(html).not.toContain("sub-account-shell");
    expect(location).toBe("/solo/1971670/command-center");
  });

  it("still mounts the sub-account shell for a caller whose tier genuinely owns it", async () => {
    tc.ctx.activeTenant = { account_type: "sub_account", parent_tenant_id: "parent-uuid", account_number: 3855 };
    const { html } = await renderAt("/business/3855/command-center");
    expect(html).toContain("sub-account-shell");
  });

  it("treats a parented tenant as a sub-account even when mislabelled agency (§51 parent-first)", async () => {
    tc.ctx.activeTenant = { account_type: "agency", parent_tenant_id: "parent-uuid", account_number: 42 };
    const { html } = await renderAt("/business/42/command-center");
    expect(html).toContain("sub-account-shell");
  });

  it("fails closed to the chooser when a wrong-tier caller has no account number to go home to", async () => {
    tc.ctx.activeTenant = { account_type: "standalone", parent_tenant_id: null, account_number: null };
    const { html, location } = await renderAt("/business/9999/command-center");
    expect(html).not.toContain("sub-account-shell");
    expect(location).toBe("/choose-account");
  });

  it("does not mount the shell while the account context is still resolving", async () => {
    tc.ctx.accountContextLoading = true;
    tc.ctx.activeTenant = { account_type: "sub_account", parent_tenant_id: "p", account_number: 1 };
    const { html } = await renderAt("/business/1/command-center");
    expect(html).not.toContain("sub-account-shell");
  });

  // The defect this guard exists for: `switchTenant` commits the new active id
  // before the tenant list refetches, so `activeTenant` is briefly null while the
  // context reports itself ready. Classifying that as a tier — `resolveTierKey`
  // fail-safes a null `account_type` to "solo" — would eject a sub-account owner
  // out of the shell they legitimately own, mid-switch.
  it("does NOT classify an unresolved caller as Solo and eject them", async () => {
    tc.ctx.accountContextStatus = "ready";
    tc.ctx.activeTenant = null;
    const { html, location } = await renderAt("/business/3855/command-center");
    expect(html).not.toContain("sub-account-shell");
    // It holds on this route with an honest recovery affordance; it does not
    // redirect anywhere, and it certainly does not redirect to a Solo root.
    expect(location).toBeNull();
    expect(host.textContent).toContain("Couldn't verify your workspace");
    // Nobody here opened an act-as, so the operator's exit is not offered.
    expect(host.querySelector("[data-operator-exit]")).toBeNull();
  });

  // Codex review of #1547 (2026-09-27): the sub-account entry strands an operator the same way.
  it("offers the audited exit to an operator stranded here inside an act-as", async () => {
    recordOperatorActAs("op", "t1");
    tc.ctx.accountContextStatus = "error";
    await renderAt("/business/3855/command-center");
    expect(host.textContent).toContain("Try again");
    expect(host.querySelector("[data-operator-exit]")?.textContent).toContain("Exit tenant");
  });

  it("sends a signed-out caller to sign in, carrying where they were going", async () => {
    tc.ctx.accountContextStatus = "signed_out";
    const { location } = await renderAt("/business/3855/command-center");
    expect(location).toBe("/auth");
  });
});
