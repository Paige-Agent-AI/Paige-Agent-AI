// Wiring proof for the `/solo/*` tier gate (owner ruling 2026-09-02).
//
// `/business/*` shipped with no tier gate and `/solo/*` shipped with the mirror
// image of the same hole: `SoloApp`'s own guard rewrites the `:account` segment
// to the caller's own account number, so a sub-account or agency caller who
// reached `/solo/{n}` was quietly renumbered and left running the Solo shell —
// the right address, the wrong operating mode. Fixing one and leaving the other
// would have closed half a defect, so both are gated and both are proven here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Tenant = {
  account_type: string | null;
  parent_tenant_id: string | null;
  account_number: number | null;
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
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => tc.ctx }));
vi.mock("@/solo/SoloApp", () => ({ default: () => <div data-mounted="solo-shell" /> }));

import SoloEntry from "./SoloEntry";
import { landAt } from "@/operator/actAs";
import { recordOperatorActAs } from "@/lib/auth/workspaceEntry";

function LocationProbe() {
  const loc = useLocation();
  return <i data-loc={loc.pathname} />;
}

describe("/solo/* tier gate", () => {
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
  });

  async function renderAt(path: string) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/solo/*" element={<SoloEntry />} />
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

  it("mounts the Solo shell for a Solo tenant, exactly as before", async () => {
    tc.ctx.activeTenant = { account_type: "standalone", parent_tenant_id: null, account_number: 1971670 };
    const { html } = await renderAt("/solo/1971670/command-center");
    expect(html).toContain("solo-shell");
  });

  it("sends a sub-account caller to their own business root instead of the Solo shell", async () => {
    tc.ctx.activeTenant = { account_type: "sub_account", parent_tenant_id: "parent-uuid", account_number: 3855 };
    const { html, location } = await renderAt("/solo/1971670/command-center");
    expect(html).not.toContain("solo-shell");
    expect(location).toBe("/business/3855/command-center");
  });

  it("sends an agency caller to their own agency root instead of the Solo shell", async () => {
    tc.ctx.activeTenant = { account_type: "agency", parent_tenant_id: null, account_number: 1924546 };
    const { html, location } = await renderAt("/solo/1971670/command-center");
    expect(html).not.toContain("solo-shell");
    expect(location).toBe("/agency/1924546/command-center");
  });

  it("fails closed to the chooser rather than guessing a home it cannot name", async () => {
    tc.ctx.activeTenant = { account_type: "sub_account", parent_tenant_id: "p", account_number: null };
    const { html, location } = await renderAt("/solo/1971670/command-center");
    expect(html).not.toContain("solo-shell");
    expect(location).toBe("/choose-account");
  });

  it("still refuses to mount on an unresolved account context", async () => {
    tc.ctx.activeTenant = null;
    const { html } = await renderAt("/solo/1971670/command-center");
    expect(html).not.toContain("solo-shell");
    expect(host.textContent).toContain("Couldn't verify your workspace");
  });

  // Codex review of #1547 (2026-09-27): an operator whose Enter succeeded but whose arrival could
  // not load its account context was left here with only "Try again" — inside an open act-as.
  describe("an operator stranded on the verify screen", () => {
    let go: ReturnType<typeof vi.spyOn>;
    const exitButton = () =>
      Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Exit tenant"));

    beforeEach(() => {
      sessionStorage.clear();
      tc.ctx.accountContextStatus = "error";
      tc.ctx.exitOperatorActAs = vi.fn(async () => true);
      go = vi.spyOn(landAt, "go").mockImplementation(() => {});
    });
    afterEach(() => {
      go.mockRestore();
      sessionStorage.clear();
      tc.ctx.exitOperatorActAs = async () => true;
    });

    it("offers the audited exit when this session opened an act-as", async () => {
      recordOperatorActAs("op", "t1");
      await renderAt("/solo/1971670/command-center");
      expect(exitButton()?.hasAttribute("data-operator-exit")).toBe(true);
      await act(async () => { exitButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(tc.ctx.exitOperatorActAs).toHaveBeenCalledTimes(1);
      expect(go).toHaveBeenCalledWith("/operator/fleet/directory");
    });

    it("stays, and keeps the exit, when the server refuses it", async () => {
      recordOperatorActAs("op", "t1");
      tc.ctx.exitOperatorActAs = vi.fn(async () => false);
      await renderAt("/solo/1971670/command-center");
      await act(async () => { exitButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(go).not.toHaveBeenCalled();
      expect(exitButton()?.hasAttribute("disabled")).toBe(false);
    });

    it("offers nothing extra to someone who opened no act-as", async () => {
      await renderAt("/solo/1971670/command-center");
      expect(host.textContent).toContain("Try again");
      expect(exitButton()).toBeFalsy();
    });

    // Codex review of 88b651b8: storage blocked by policy silently dropped the record, and with it
    // the only way out. Where storage cannot be used, the arrival address carries the flag instead.
    it("still offers the exit when storage is blocked and the arrival carries the flag", async () => {
      const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
      window.history.replaceState(null, "", "/?acting-as=op");
      try {
        await renderAt("/solo/1971670/command-center");
        expect(exitButton()).toBeTruthy();
      } finally {
        blocked.mockRestore();
        window.history.replaceState(null, "", "/");
      }
    });

    // Codex review of b22716a6: the flag survives a sign-out redirect, so it must name its operator.
    it("ignores an address flag that names a different user", async () => {
      const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
      window.history.replaceState(null, "", "/?acting-as=someone-else");
      try {
        await renderAt("/solo/1971670/command-center");
        expect(exitButton()).toBeFalsy();
      } finally {
        blocked.mockRestore();
        window.history.replaceState(null, "", "/");
      }
    });

    // Codex review of 221ffbc5: storage can look usable yet have failed to hold the record, so this
    // operator's own flag counts whenever their record is absent.
    it("honours this operator's flag when storage holds no record for them", async () => {
      window.history.replaceState(null, "", "/?acting-as=op");
      try {
        await renderAt("/solo/1971670/command-center");
        expect(exitButton()).toBeTruthy();
      } finally {
        window.history.replaceState(null, "", "/");
      }
    });

    // Independent review of 88b651b8: an act-as left in this tab by a user who signed out must not
    // be offered to the next person who signs in here.
    it("offers nothing to a different user than the one who opened the act-as", async () => {
      recordOperatorActAs("op", "t1");
      tc.ctx.activeUserId = "next-person";
      await renderAt("/solo/1971670/command-center");
      expect(exitButton()).toBeFalsy();
      tc.ctx.activeUserId = "op";
    });
  });
});
