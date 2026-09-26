import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Settings } from "lucide-react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenantCommandCenterShell, TenantPaigeCommandField } from "./TenantCommandCenterShell";
import { PaigeAIChat } from "@/components/dashboard/PaigeAIChat";

const themeMock = vi.hoisted(() => ({
  resolvedTheme: "light" as "light" | "dark",
  setTheme: vi.fn(),
}));

vi.mock("next-themes", () => ({ useTheme: () => themeMock }));

afterEach(() => {
  themeMock.resolvedTheme = "light";
  themeMock.setTheme.mockReset();
  window.localStorage.removeItem("paige.tenantShell.navExpanded");
});
// The Vibe Studio tests below mount the real SoloApp, whose media-jobs hook subscribes to a realtime
// channel. Unmocked, that opened a live WebSocket from jsdom to whatever VITE_SUPABASE_URL names, and
// undici's "open" event is rejected by Node's EventTarget under jsdom ("The event argument must be an
// instance of Event"): an uncaught exception that failed CI's Test step after every test had passed.
// No assertion here depends on realtime, so the channel is inert; everything else is the real client.
vi.mock("@/integrations/supabase/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/integrations/supabase/client")>();
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: async () => "ok" as const };
  return {
    ...actual,
    supabase: new Proxy(actual.supabase, {
      get(target, prop, receiver) {
        if (prop === "channel") return () => channel;
        if (prop === "removeChannel") return async () => "ok" as const;
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});
vi.mock("@/components/admin/AdminBridgeBell", () => ({ AdminBridgeBell: () => null }));
vi.mock("@/components/admin/voice/DialPadTrigger", () => ({ DialPadTrigger: () => null }));
vi.mock("@/components/ui/paige", () => ({
  AgentPresenceProvider: ({ children }: { children: React.ReactNode }) => children,
  useAgentPresence: () => {
    const [railExpanded, setRailExpanded] = useState(false);
    return {
      railExpanded,
      expandRail: () => setRailExpanded(true),
      collapseRail: () => setRailExpanded(false),
    };
  },
}));
vi.mock("@/hooks/usePendingApprovals", () => ({ usePendingApprovals: () => ({ items: [] }) }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({
    activeTenantId: "tenant-42",
    activeTenant: { account_number: "42", name: "Supplied Solo account", account_type: "standalone", parent_tenant_id: null },
  }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("@/hooks/useScopedUserId", () => ({ useScopedUserId: () => "owner-1" }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "PAIGE" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/voice/DictationMicButton", () => ({
  DictationMicButton: () => <button type="button" aria-label="Hold to dictate">Mock dictate</button>,
}));
vi.mock("@/hooks/useChatDocumentUpload", () => ({
  useChatDocumentUpload: () => {
    const [attachedDoc, setAttachedDoc] = useState<{ name: string; kind: "pdf"; size: number } | null>({ name: "local-proof.pdf", kind: "pdf", size: 128 });
    return {
      attachedDoc,
      isDragOver: false,
      fileInputRef: { current: null },
      acceptString: ".pdf",
      handleFileSelect: vi.fn(),
      handleDragOver: vi.fn(),
      handleDragLeave: vi.fn(),
      handleDrop: vi.fn(),
      removeAttachment: () => setAttachedDoc(null),
      openFilePicker: vi.fn(),
      setAttachedDoc,
    };
  },
}));
vi.mock("@/hooks/usePaigeThreads", () => ({
  usePaigeThreads: () => ({
    threads: [], isLoading: false, isFetched: true,
    loadTurns: vi.fn(async () => []), ensureThread: vi.fn(), onTurnPersisted: vi.fn(),
    renameThread: vi.fn(), archiveThread: vi.fn(), deleteThread: vi.fn(),
  }),
}));
vi.mock("@/components/dashboard/paige/ThreadRail", () => ({ ThreadRail: () => null }));
vi.mock("@/lib/voice/VoiceDeviceProvider", () => ({ VoiceDeviceProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/admin/voice/DialPadSurface", () => ({ DialPadSurface: () => null }));
vi.mock("@/components/admin/voice/IncomingCallOverlay", () => ({ IncomingCallOverlay: () => null }));
vi.mock("@/components/admin/voice/LiveTranscriptPanel", () => ({ LiveTranscriptPanel: () => null }));
vi.mock("@/solo/CommandCenter", () => ({ CommandHub: () => null }));
vi.mock("@/solo/paigehub", () => ({ PaigeHub: () => null }));
vi.mock("@/solo/SoloPaigeWorkspace", () => ({ SoloPaigeWorkspace: () => <div data-solo-paige-test-workspace /> }));
vi.mock("@/solo/compass", () => ({ TrustCompass: () => null }));
vi.mock("@/solo/automations-build", () => ({ AutomationsHub: () => null }));
vi.mock("@/components/tenant-relationships/TenantRelationshipsClientsWorkspace", () => ({ TenantRelationshipsClientsWorkspace: () => null }));
vi.mock("@/solo/conversations", () => ({ ClientsHub: () => null }));
vi.mock("@/components/tenant-calendar/TenantCanonicalCalendarWorkspace", () => ({ TenantCanonicalCalendarWorkspace: () => null }));
vi.mock("@/solo/analytics2", () => ({ Analytics2: () => null }));
vi.mock("@/solo/marketplace", () => ({ Marketplace: () => null }));
vi.mock("@/solo/settings", () => ({ SoloSettings: () => null }));

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RouteProbe = () => {
  const location = useLocation();
  return <output data-route-probe>{location.pathname}</output>;
};

const settlePaigeFocus = async () => {
  await new Promise<void>((resolveFrame) => window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => resolveFrame());
  }));
};

const PaigeWorkspaceFixture = () => {
  const surfaces = ["Chat", "Knowledge", "Helpers", "Capabilities"];
  const [activeSurface, setActiveSurface] = useState(surfaces[0]);
  const [draft, setDraft] = useState("Draft survives folding");
  return (
    <div>
      <div role="tablist" aria-label="PAIGE workspace views">
        {surfaces.map((surface) => (
          <button
            key={surface}
            type="button"
            role="tab"
            aria-selected={activeSurface === surface}
            onClick={() => setActiveSurface(surface)}
          >
            {surface}
          </button>
        ))}
      </div>
      <p data-paige-active-surface>{activeSurface}</p>
      <input aria-label="Persistent PAIGE draft" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
      <button type="button" onClick={() => setDraft("")}>Clear draft</button>
    </div>
  );
};

describe("tenant shell owns one PAIGE surface", () => {
  it("does not detach and reinsert the existing chat host on ordinary parent refresh", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = () => root.render(
      <MemoryRouter initialEntries={["/solo/410001/growth/pipeline"]}>
        <TenantCommandCenterShell accountName="Fixture" accountType="standalone" userRole="admin"
          brandHomeHref="/solo/410001/command-center" onSignOut={() => undefined}
          soloPaigeWorkspace={<div data-refresh-chat-fixture />}>
          <div />
        </TenantCommandCenterShell>
      </MemoryRouter>,
    );
    act(render);
    const fixture = container.querySelector("[data-refresh-chat-fixture]");
    const nativeAppend = Node.prototype.appendChild;
    let redundantMoves = 0;
    const spy = vi.spyOn(Node.prototype, "appendChild").mockImplementation(function <T extends Node>(this: Node, child: T): T {
      if (child.parentNode === this && child.contains(fixture)) redundantMoves += 1;
      return nativeAppend.call(this, child) as T;
    });
    try {
      act(render);
      act(render);
      expect(container.querySelector("[data-refresh-chat-fixture]")).toBe(fixture);
      expect(redundantMoves).toBe(0);
    } finally {
      spy.mockRestore();
      act(() => root.unmount());
      container.remove();
    }
  });

  it("renders one canonical Solo shell structure for different server-resolved tenants", () => {
    const renderTenant = (
      accountNumber: string,
      accountName: string,
      userRole: "admin" | "coach",
    ) => {
      window.localStorage.setItem("paige.tenantShell.navExpanded", "true");
      const host = document.createElement("div");
      const root = createRoot(host);

      act(() => root.render(
        <MemoryRouter initialEntries={[`/solo/${accountNumber}/growth/pipeline`]}>
          <TenantCommandCenterShell
            accountName={accountName}
            accountType="standalone"
            userRole={userRole}
            brandHomeHref={`/solo/${accountNumber}/command-center`}
            soloPaigeWorkspace={<div data-canonical-paige-workspace />}
            onSignOut={vi.fn()}
          >
            <div data-pipeline-domain>Pipeline domain</div>
          </TenantCommandCenterShell>
        </MemoryRouter>,
      ));

      const shell = host.querySelector<HTMLElement>("[data-tenant-shell]");
      const fingerprint = {
        shellClass: shell?.className,
        destinations: [...host.querySelectorAll<HTMLElement>("[data-tenant-destination]")]
          .map((item) => [item.dataset.tenantDestination, item.textContent?.trim()]),
        paigeWorkspaces: host.querySelectorAll("#tenant-paige-workspace").length,
        pipelineDomains: host.querySelectorAll("[data-pipeline-domain]").length,
        workspaceClaim: host.querySelector(".tcs-account-seal small")?.textContent,
      };

      act(() => root.unmount());
      return fingerprint;
    };

    const affectedTenant = renderTenant("410001", "First example business", "admin");
    const knownGoodTenant = renderTenant("410002", "Second example business", "coach");

    expect({ ...affectedTenant, workspaceClaim: undefined }).toEqual({
      ...knownGoodTenant,
      workspaceClaim: undefined,
    });
    expect(affectedTenant.workspaceClaim).toBe("Owner workspace");
    expect(knownGoodTenant.workspaceClaim).toBe("Team workspace");
    expect(affectedTenant.destinations.map(([id]) => id)).toEqual([
      "command", "clients", "campaigns", "marketplace", "analytics", "settings",
    ]);
    expect(affectedTenant.paigeWorkspaces).toBe(1);
    expect(affectedTenant.pipelineDomains).toBe(1);
  });

  it("derives the Solo workspace claim from server-resolved tenant ownership", () => {
    const owner = source("src/solo/SoloApp.tsx");
    expect(owner).not.toContain('userRole="admin"');
    // Pins BOTH halves of the claim, which is stronger than the single substring this used to
    // assert. That substring stopped matching when SoloApp.tsx:205 was correctly hardened to
    // `activeTenant?.owner_user_id != null && activeTenant.owner_user_id === activeUserId` — a
    // source-coupled assertion going red against a STRICTER implementation. Asserting the guard
    // and the comparison separately survives that reformatting and additionally pins the null
    // guard, so a regression that dropped it would now be caught rather than merely tolerated.
    expect(owner).toContain("activeTenant?.owner_user_id != null");
    expect(owner).toContain("activeTenant.owner_user_id === activeUserId");
  });

  it.each([
    ["light", "Obsidian", "dark"],
    ["dark", "Mineral", "light"],
  ] as const)("offers the approved opposite theme name from %s", (currentTheme, offeredTheme, nextTheme) => {
    themeMock.resolvedTheme = currentTheme;
    themeMock.setTheme.mockClear();
    window.localStorage.setItem("paige.tenantShell.navExpanded", "false");
    const host = document.createElement("div");
    const root = createRoot(host);

    try {
      act(() => root.render(
        <MemoryRouter>
          <TenantCommandCenterShell
            accountName="Solo account"
            accountType="standalone"
            userRole="admin"
            onSignOut={vi.fn()}
          >
            <p>Solo workspace</p>
          </TenantCommandCenterShell>
        </MemoryRouter>,
      ));

      const themeSwitch = host.querySelector<HTMLButtonElement>(`[aria-label="Use ${offeredTheme} theme"]`);
      expect(themeSwitch).not.toBeNull();
      expect(themeSwitch?.textContent).toBe(offeredTheme);
      expect(themeSwitch?.title).toBe(`${offeredTheme} theme`);

      act(() => themeSwitch?.click());
      expect(themeMock.setTheme).toHaveBeenCalledOnce();
      expect(themeMock.setTheme).toHaveBeenCalledWith(nextTheme);
    } finally {
      act(() => root.unmount());
    }
  });

  it.each([
    ["agency", "src/agency/AgencyApp.tsx"],
    ["solo", "src/solo/SoloApp.tsx"],
  ])("keeps the %s v3 owner on TenantCommandCenterShell without the legacy panel", (_tier, path) => {
    const owner = source(path);
    expect(owner.match(/<TenantCommandCenterShell/g)).toHaveLength(1);
    expect(owner).not.toContain("<PaigePanel");
    expect(owner).not.toMatch(/import\s+\{\s*PaigePanel\s*\}/);
    expect(owner).toContain("expandRail");
  });

  it("keeps business on the corrected shared agency shell", () => {
    const business = source("src/business/BusinessEntry.tsx");
    const sharedOwner = source("src/agency/AgencyApp.tsx");
    expect(business).toContain('import AgencyApp from "@/agency/AgencyApp"');
    expect(business).toContain('<AgencyApp mode="subaccount" />');
    expect(sharedOwner.match(/<TenantCommandCenterShell/g)).toHaveLength(1);
    expect(sharedOwner).not.toContain("<PaigePanel");
  });

  // REMOVED 2026-09-25 — "keeps the legacy panel available only for non-v3 hosts" asserted that
  // `src/solo/agent.tsx` contained `export const PaigePanel=`. There were no non-v3 hosts: nothing
  // in src/ imported that file, no route lazy-loaded it, and its unique strings were absent from
  // dist/assets while the live chat's were present. The test passed green for as long as the file
  // shipped nothing, which is the §71.1 reachability trap in miniature — an export is not a mount.
  // The file and its hook are deleted; §58 is satisfied because no shipped capability went with
  // them. The live Solo chat is SoloPaigeWorkspace -> PaigeAIChat, covered by the tests below.

  it("owns one accessible Solo brand-home link at the server-resolved Command Center container", async () => {
    const { default: SoloApp } = await import("@/solo/SoloApp");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/marketplace"]}>
          <Routes>
            <Route path="/solo/:account/*" element={<><SoloApp /><RouteProbe /></>} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const brandHome = host.querySelector<HTMLAnchorElement>('[aria-label="PAIGE Solo home"]');
    expect(brandHome).not.toBeNull();
    expect(brandHome?.getAttribute("href")).toBe("/solo/42/command-center");
    expect(brandHome?.textContent).toContain("PAIGE");
    expect(brandHome?.textContent).toContain("Solo");
    expect(brandHome?.textContent).not.toContain("Business operating system");
    expect(brandHome?.textContent).not.toContain("Platform Operator");
    expect(host.querySelectorAll('[aria-label="PAIGE Solo home"]')).toHaveLength(1);
    expect(host.querySelectorAll("#tenant-paige-workspace")).toHaveLength(1);

    await act(async () => brandHome?.click());
    expect(host.querySelector("[data-route-probe]")?.textContent).toBe("/solo/42/command-center");

    await act(async () => root.unmount());
    host.remove();
  });

  it("derives Solo brand home from activeTenant and leaves every non-Solo shell unchanged", () => {
    const solo = source("src/solo/SoloApp.tsx");
    const shell = source("src/components/tenant-shell/TenantCommandCenterShell.tsx");
    const css = source("src/components/tenant-shell/tenant-command-center-shell.css");

    expect(solo).toContain("brandHomeHref");
    expect(solo).toMatch(/brandHomeHref=\{activeTenant\?\.account_number[^}]*branchPath\('solo',String\(activeTenant\.account_number\),'command-center'\)/);
    expect(shell).toContain('aria-label="PAIGE Solo home"');
    expect(shell).toContain("brandHomeHref ?");
    expect(css).toContain(".tcs-brand-home");
    expect(css).toContain("background: var(--pg-artifact)");
  });

  it("preserves the non-Solo shell brand treatment when no Solo home is supplied", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <TenantCommandCenterShell
            accountName="Shared agency account"
            accountType="agency"
            userRole="admin"
            onSignOut={vi.fn()}
          >
            <p>Agency workspace</p>
          </TenantCommandCenterShell>
        </MemoryRouter>,
      );
    });

    expect(host.querySelector('[aria-label="PAIGE Solo home"]')).toBeNull();
    expect(host.textContent).toContain("Business operating system");
    expect(host.textContent).not.toContain("Platform Operator");

    await act(async () => root.unmount());
    host.remove();
  });

  it("leaves immersive Vibe Studio and restores the main Solo home through the brand control", async () => {
    const { default: SoloApp } = await import("@/solo/SoloApp");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/growth"]}>
          <Routes>
            <Route path="/solo/:account/*" element={<><SoloApp /><RouteProbe /></>} />
          </Routes>
        </MemoryRouter>,
      );
    });

    const launcher = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Vibe Studio");
    await act(async () => launcher?.click());
    expect(host.textContent).toContain("Back to Campaigns");

    const brandHome = host.querySelector<HTMLAnchorElement>('[aria-label="PAIGE Solo home"]');
    await act(async () => brandHome?.click());

    expect(host.textContent).not.toContain("Back to Campaigns");
    expect(host.querySelector("[data-route-probe]")?.textContent).toBe("/solo/42/command-center");
    expect(host.querySelectorAll('[aria-label="PAIGE Solo home"]')).toHaveLength(1);
    expect(host.querySelectorAll("#tenant-paige-workspace")).toHaveLength(1);

    await act(async () => root.unmount());
    host.remove();
  });

  it("keeps operator authority in the canonical operator tree after the legacy shell is retired", () => {
    expect(existsSync(resolve(process.cwd(), "src/components/admin/AdminLayout.tsx"))).toBe(false);
    const operator = source("src/operator/OperatorEntry.tsx");
    expect(operator).toContain("<RequireOperator>");
    expect(operator).toContain("<OperatorApp />");
    expect(operator.indexOf("<RequireOperator>")).toBeLessThan(operator.indexOf("<OperatorApp />"));
  });

  it("reuses the existing immersive Vibe Studio from Campaigns and returns through its owner", () => {
    const solo = source("src/solo/SoloApp.tsx");
    const campaigns = source("src/solo/growth2.tsx");
    const vibe = source("src/solo/vibe.tsx");

    expect(campaigns).toContain("detail:{returnFocus:event.currentTarget}");
    expect(campaigns).toContain("data-solo-vibe-studio-launcher");
    expect(campaigns).toContain(">Vibe Studio</button>");
    expect(campaigns).toContain('eyebrow="Campaigns"');
    expect(campaigns).not.toContain('eyebrow="Growth & acquisition"');
    expect(solo).toContain("window.addEventListener('paige-studio',h)");
    expect(solo).toContain("<VibeStudio onBack={closeStudio}/>");
    expect(solo.match(/<VibeStudio/g)).toHaveLength(1);
    expect(vibe).toContain("Back to Campaigns");
    expect(vibe).not.toContain("Back to Growth");
  });

  it.each(["back", "escape"])("restores the real Campaigns Vibe Studio launcher after %s closes the mounted owner", async (exit) => {
    const { default: SoloApp } = await import("@/solo/SoloApp");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/growth"]}>
          <Routes>
            <Route path="/solo/:account/*" element={<><SoloApp /><RouteProbe /></>} />
          </Routes>
        </MemoryRouter>,
      );
    });

    const launcher = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Vibe Studio");
    expect(launcher).toBeTruthy();
    launcher?.focus();
    expect(document.activeElement).toBe(launcher);
    await act(async () => launcher?.click());

    const back = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Back to Campaigns"));
    expect(back).toBeTruthy();
    back?.focus();
    expect(document.activeElement).toBe(back);

    if (exit === "back") {
      await act(async () => back?.click());
    } else {
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    }

    expect(host.textContent).not.toContain("Back to Campaigns");
    expect(document.activeElement).toBe(launcher);
    expect(host.querySelector("[data-route-probe]")?.textContent).toBe("/solo/42/growth");

    await act(async () => root.unmount());
    host.remove();
  });

  it("restores focus to the Solo main-menu owner after Back or Escape closes Settings", () => {
    const shell = source("src/components/tenant-shell/TenantCommandCenterShell.tsx");

    expect(shell).toContain("queueSoloContextualExit");
    expect(shell).toContain("data-tenant-destination={id}");
    expect(shell).toMatch(/focusReturnDestination\.current[\s\S]*?\.focus\(\)/);
  });

  it.each(["back", "escape"])("returns focus to Settings after the %s exit", async (exit) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const shellProps = {
      accountName: "Supplied Solo account",
      accountType: "standalone",
      userRole: "admin" as const,
      onSignOut: vi.fn(),
    };

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/settings/connections"]}>
          <Routes>
            <Route
              path="/solo/42/settings/*"
              element={
                <TenantCommandCenterShell
                  {...shellProps}
                  contextualNavigation={{
                    label: "Settings",
                    backHref: "/solo/42/command-center",
                    backLabel: "Back to PAIGE",
                    activeId: "connections",
                    items: [{ id: "connections", label: "Connections", href: "/solo/42/settings/connections", icon: Settings }],
                  }}
                >
                  <p>Settings workspace</p>
                </TenantCommandCenterShell>
              }
            />
            <Route path="/solo/42/command-center" element={<TenantCommandCenterShell {...shellProps}><p>Command Center</p></TenantCommandCenterShell>} />
          </Routes>
        </MemoryRouter>,
      );
    });

    if (exit === "back") {
      await act(async () => host.querySelector<HTMLAnchorElement>(".tcs-context-back")?.click());
    } else {
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    }
    await act(async () => new Promise((resolveFrame) => window.requestAnimationFrame(() => resolveFrame(undefined))));

    const settings = host.querySelector<HTMLAnchorElement>('[data-tenant-destination="settings"]');
    expect(settings).not.toBeNull();
    expect(document.activeElement).toBe(settings);
    expect(
      Array.from(host.querySelectorAll<HTMLElement>("[data-tenant-destination]"))
        .map((item) => item.textContent?.trim()),
    ).toEqual(["Command Center", "Clients", "Campaigns", "Marketplace", "Analytics", "Settings"]);

    await act(async () => root.unmount());
    host.remove();
  });
});

describe("tenant PAIGE command field", () => {
  it("lets the native hidden state win over the authored PAIGE layout", () => {
    const css = source("src/components/tenant-shell/tenant-command-center-shell.css");
    expect(css).toMatch(/\.tcs-paige\[hidden\]\s*\{[^}]*display:\s*none;/);
  });

  it("keeps the mounted Chat and management workspace non-present while folded and restores its launcher", async () => {
    const styles = document.createElement("style");
    styles.textContent = source("src/components/tenant-shell/tenant-command-center-shell.css");
    document.head.appendChild(styles);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/command-center"]}>
          <TenantCommandCenterShell
            accountName="Solo account"
            accountType="standalone"
            userRole="admin"
            onSignOut={vi.fn()}
            soloPaigeWorkspace={<PaigeWorkspaceFixture />}
          >
            <p>Main CRM remains usable</p>
          </TenantCommandCenterShell>
        </MemoryRouter>,
      );
    });

    const workspace = host.querySelector<HTMLElement>("#tenant-paige-workspace");
    const command = host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]");
    const draft = host.querySelector<HTMLInputElement>('[aria-label="Persistent PAIGE draft"]');
    expect(workspace?.hidden).toBe(true);
    expect(workspace && getComputedStyle(workspace).display).toBe("none");
    expect(command?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]")?.click());
    expect(host.querySelector("#tenant-paige-workspace")).toBe(workspace);
    expect(workspace?.hidden).toBe(false);
    expect(workspace && getComputedStyle(workspace).display).toBe("flex");
    expect(host.querySelector("[data-tenant-paige-command]")?.getAttribute("aria-expanded")).toBe("true");

    for (const [index, activeSurface] of ["Chat", "Knowledge", "Helpers", "Capabilities"].entries()) {
      const surface = Array.from(workspace?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent === activeSurface);
      await act(async () => surface?.click());
      surface?.focus();
      expect(document.activeElement).toBe(surface);
      expect(surface?.getAttribute("aria-selected")).toBe("true");
      expect(workspace?.querySelector("[data-paige-active-surface]")?.textContent).toBe(activeSurface);

      await act(async () => {
        if (index % 2 === 0) {
          workspace?.querySelector<HTMLButtonElement>('[aria-label="Fold PAIGE conversation"]')?.click();
        } else {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        }
        await settlePaigeFocus();
      });

      expect(host.querySelector("#tenant-paige-workspace")).toBe(workspace);
      expect(workspace?.hidden).toBe(true);
      expect(workspace && getComputedStyle(workspace).display).toBe("none");
      expect(workspace?.contains(document.activeElement)).toBe(false);
      expect(document.activeElement).toBe(host.querySelector("[data-tenant-paige-command]"));
      expect(host.querySelector("[data-tenant-paige-command]")?.getAttribute("aria-expanded")).toBe("false");
      expect(draft?.value).toBe("Draft survives folding");

      await act(async () => host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]")?.click());
      expect(host.querySelector("#tenant-paige-workspace")).toBe(workspace);
      expect(host.querySelector('[aria-label="Persistent PAIGE draft"]')).toBe(draft);
      expect(draft?.value).toBe("Draft survives folding");
      expect(workspace?.querySelector("[data-paige-active-surface]")?.textContent).toBe(activeSurface);
      expect(host.querySelectorAll("#tenant-paige-workspace")).toHaveLength(1);
    }

    await act(async () => root.unmount());
    host.remove();
    styles.remove();
  });

  it("moves the one Solo workspace into a pop-out host instead of loading a second app", () => {
    const shell = source("src/components/tenant-shell/TenantCommandCenterShell.tsx");
    expect(shell).toContain('import { createPortal } from "react-dom"');
    expect(shell).toContain("paigePortalHost");
    expect(shell).toContain("createPortal(");
    expect(shell).toContain("popoutReturnFocusRef");
    expect(shell).toMatch(/if \(soloPaigeWorkspace\)[\s\S]*return;[\s\S]*next\.searchParams\.set\("paigeSurface", "detached"\)/);
    expect(shell).toContain("if (detached && !soloPaigeWorkspace)");
    expect(shell.match(/content=\{soloPaigeWorkspace\}/g)).toHaveLength(1);
    expect(shell).toContain('popup,width=520,height=820,resizable=yes');
  });

  it("keeps the mounted workspace in the shell until the pop-out application stylesheet is ready", async () => {
    const applicationStyles = document.createElement("link");
    applicationStyles.rel = "stylesheet";
    applicationStyles.href = "/assets/solo-paige.css";
    document.head.appendChild(applicationStyles);

    const popupDocument = document.implementation.createHTMLDocument("PAIGE delayed stylesheet popup");
    const popupRecord = {
      document: popupDocument,
      closed: false,
      focus: vi.fn(),
      addEventListener: vi.fn(),
      close: vi.fn(() => { popupRecord.closed = true; }),
    };
    const open = vi.spyOn(window, "open").mockReturnValue(popupRecord as unknown as Window);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/command-center"]}>
          <TenantCommandCenterShell accountName="Solo account" accountType="standalone" userRole="admin" onSignOut={vi.fn()} soloPaigeWorkspace={<PaigeWorkspaceFixture />}>
            <p>Main CRM remains usable</p>
          </TenantCommandCenterShell>
        </MemoryRouter>,
      );
      await Promise.resolve();
      host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]")?.click();
      await Promise.resolve();
    });

    const workspace = host.querySelector("#tenant-paige-workspace");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Open PAIGE in a new window"]')?.click();
      await Promise.resolve();
    });

    expect(host.querySelector("#tenant-paige-workspace")).toBe(workspace);
    expect(popupDocument.body.querySelector("#tenant-paige-workspace")).toBeNull();

    await act(async () => {
      popupDocument.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')?.dispatchEvent(new Event("load"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector("#tenant-paige-workspace")).toBeNull();
    expect(popupDocument.body.querySelector("#tenant-paige-workspace")).toBe(workspace);
    expect(popupDocument.body.querySelectorAll("#tenant-paige-workspace")).toHaveLength(1);
    const popupHost = popupDocument.body.querySelector<HTMLElement>("[data-paige-popout]");
    expect(popupDocument.body.style.height).toBe("100vh");
    expect(popupDocument.body.style.overflow).toBe("hidden");
    expect(popupHost?.style.height).toBe("100vh");
    expect(popupHost?.style.minWidth).toBe("0px");
    expect(popupHost?.style.overflow).toBe("hidden");

    await act(async () => root.unmount());
    host.remove();
    applicationStyles.remove();
    open.mockRestore();
  });

  it.each(["error", "timeout"] as const)("keeps the same interactive workspace in the shell when pop-out styles %s", async (failure) => {
    if (failure === "timeout") vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const applicationStyles = document.createElement("link");
    applicationStyles.rel = "stylesheet";
    applicationStyles.href = `/assets/solo-paige-${failure}.css`;
    document.head.appendChild(applicationStyles);

    const popupDocument = document.implementation.createHTMLDocument(`PAIGE stylesheet ${failure} popup`);
    const popupRecord = {
      document: popupDocument,
      closed: false,
      focus: vi.fn(),
      addEventListener: vi.fn(),
      close: vi.fn(() => { popupRecord.closed = true; }),
    };
    const open = vi.spyOn(window, "open").mockReturnValue(popupRecord as unknown as Window);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/command-center"]}>
          <TenantCommandCenterShell accountName="Solo account" accountType="standalone" userRole="admin" onSignOut={vi.fn()} soloPaigeWorkspace={<PaigeWorkspaceFixture />}>
            <p>Main CRM remains usable</p>
          </TenantCommandCenterShell>
        </MemoryRouter>,
      );
      await Promise.resolve();
      host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]")?.click();
      await Promise.resolve();
    });

    const workspace = host.querySelector("#tenant-paige-workspace");
    const draft = host.querySelector<HTMLInputElement>('[aria-label="Persistent PAIGE draft"]');
    const knowledge = Array.from(workspace?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
      .find((button) => button.textContent === "Knowledge");
    await act(async () => knowledge?.click());
    const launcher = workspace?.querySelector<HTMLButtonElement>('[aria-label="Open PAIGE in a new window"]');

    await act(async () => {
      launcher?.click();
      await Promise.resolve();
    });
    expect(host.querySelector("#tenant-paige-workspace")).toBe(workspace);

    await act(async () => {
      if (failure === "error") {
        popupDocument.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')?.dispatchEvent(new Event("error"));
      } else {
        await vi.advanceTimersByTimeAsync(2_000);
      }
      await Promise.resolve();
      await Promise.resolve();
    });
    if (failure === "timeout") vi.useRealTimers();
    await settlePaigeFocus();

    expect(popupRecord.closed).toBe(true);
    expect(host.querySelector("#tenant-paige-workspace")).toBe(workspace);
    expect(popupDocument.body.querySelector("#tenant-paige-workspace")).toBeNull();
    expect(host.querySelectorAll("#tenant-paige-workspace")).toHaveLength(1);
    expect(workspace?.querySelector("[data-paige-active-surface]")?.textContent).toBe("Knowledge");
    expect(host.querySelector('[aria-label="Persistent PAIGE draft"]')).toBe(draft);
    expect(draft?.value).toBe("Draft survives folding");
    expect(document.activeElement).toBe(launcher);

    await act(async () => root.unmount());
    host.remove();
    applicationStyles.remove();
    open.mockRestore();
    vi.useRealTimers();
  });

  it("keeps the identical mounted Solo workspace interactive after redock and a second pop-out native close", async () => {
    const styles = document.createElement("style");
    styles.textContent = source("src/components/tenant-shell/tenant-command-center-shell.css");
    document.head.appendChild(styles);
    const popupRecords = ["first", "second"].map((name) => {
      const popupDocument = document.implementation.createHTMLDocument(`PAIGE ${name} popup`);
      let beforeUnload: EventListener | null = null;
      const popupRecord = {
        document: popupDocument,
        closed: false,
        focus: vi.fn(),
        addEventListener: vi.fn((type: string, listener: EventListener) => { if (type === "beforeunload") beforeUnload = listener; }),
        close: vi.fn(() => {
          beforeUnload?.(new Event("beforeunload"));
          popupRecord.closed = true;
        }),
        nativeClose: () => {
          beforeUnload?.(new Event("beforeunload"));
          popupRecord.closed = true;
        },
      };
      return popupRecord;
    });
    const open = vi.spyOn(window, "open")
      .mockReturnValueOnce(popupRecords[0] as unknown as Window)
      .mockReturnValueOnce(popupRecords[1] as unknown as Window);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/command-center"]}>
          <TenantCommandCenterShell accountName="Solo account" accountType="standalone" userRole="admin" onSignOut={vi.fn()} soloPaigeWorkspace={<PaigeWorkspaceFixture />}>
            <p>Main CRM remains usable</p>
          </TenantCommandCenterShell>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]")?.click();
      await Promise.resolve();
    });
    const workspace = host.querySelector("#tenant-paige-workspace");
    const draft = host.querySelector<HTMLInputElement>('[aria-label="Persistent PAIGE draft"]');
    expect(workspace).not.toBeNull();
    expect((workspace as HTMLElement | null)?.hidden).toBe(false);
    expect(draft?.value).toBe("Draft survives folding");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Open PAIGE in a new window"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector("#tenant-paige-workspace")).toBeNull();
    expect(popupRecords[0].document.body.querySelector("#tenant-paige-workspace")).toBe(workspace);
    expect(popupRecords[0].document.body.querySelector('[aria-label="Persistent PAIGE draft"]')).toBe(draft);
    expect(popupRecords[0].document.body.querySelector('[aria-label="Fold PAIGE conversation"]')).toBeNull();
    expect(host.textContent).toContain("Main CRM remains usable");

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]")?.click();
      await Promise.resolve();
    });
    expect(popupRecords[0].focus).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".tcs-paige-backdrop")).toBeNull();
    expect(host.querySelectorAll("#tenant-paige-workspace")).toHaveLength(0);
    expect(popupRecords[0].document.body.querySelectorAll("#tenant-paige-workspace")).toHaveLength(1);

    await act(async () => {
      popupRecords[0].document.body.querySelector<HTMLButtonElement>('[aria-label="Dock PAIGE back into the workspace"]')?.click();
      await Promise.resolve();
    });
    expect(host.querySelector("#tenant-paige-workspace")).toBe(workspace);
    expect(host.querySelector('[aria-label="Persistent PAIGE draft"]')).toBe(draft);
    expect(draft?.value).toBe("Draft survives folding");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Open PAIGE in a new window"]')?.click();
      await Promise.resolve();
    });
    expect(popupRecords[1].document.body.querySelector("#tenant-paige-workspace")).toBe(workspace);

    await act(async () => {
      popupRecords[1].nativeClose();
      expect(host.querySelector("#tenant-paige-workspace")).toBe(workspace);
      await Promise.resolve();
    });

    for (const activeSurface of ["Chat", "Knowledge", "Helpers", "Capabilities"]) {
      const surface = Array.from(workspace?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
        .find((button) => button.textContent === activeSurface);
      await act(async () => surface?.click());
      expect(workspace?.querySelector("[data-paige-active-surface]")?.textContent).toBe(activeSurface);
    }

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(draft, "Recovered draft");
      draft?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(draft?.value).toBe("Recovered draft");

    const clearDraft = Array.from(workspace?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Clear draft");
    await act(async () => clearDraft?.click());
    expect(draft?.value).toBe("");
    expect(host.querySelectorAll("#tenant-paige-workspace")).toHaveLength(1);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Fold PAIGE conversation"]')?.click();
      await settlePaigeFocus();
    });
    expect(host.querySelectorAll("#tenant-paige-workspace")).toHaveLength(1);
    expect((workspace as HTMLElement | null)?.hidden).toBe(true);
    expect(workspace && getComputedStyle(workspace).display).toBe("none");
    expect(document.activeElement).toBe(host.querySelector("[data-tenant-paige-command]"));
    expect(popupRecords[0].closed).toBe(true);
    expect(popupRecords[1].closed).toBe(true);

    await act(async () => root.unmount());
    host.remove();
    styles.remove();
    open.mockRestore();
  });

  it("returns the real Solo composer before popup cleanup discards its document", async () => {
    const styles = document.createElement("style");
    styles.textContent = source("src/components/tenant-shell/tenant-command-center-shell.css");
    document.head.appendChild(styles);
    const popupDocument = document.implementation.createHTMLDocument("PAIGE cleanup popup");
    let beforeUnload: EventListener | null = null;
    let pageHide: EventListener | null = null;
    let returnedBeforeDiscard = false;
    const popupRecord = {
      document: popupDocument,
      closed: false,
      focus: vi.fn(),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === "beforeunload") beforeUnload = listener;
        if (type === "pagehide") pageHide = listener;
      }),
      close: vi.fn(() => {
        beforeUnload?.(new Event("beforeunload"));
        popupRecord.closed = true;
      }),
      cleanup: () => {
        pageHide?.(new Event("pagehide"));
        returnedBeforeDiscard = document.body.querySelector("#tenant-paige-workspace") !== null;
        popupDocument.body.replaceChildren();
        popupRecord.closed = true;
      },
    };
    const open = vi.spyOn(window, "open").mockReturnValue(popupRecord as unknown as Window);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/42/command-center"]}>
          <TenantCommandCenterShell
            accountName="Solo account"
            accountType="standalone"
            userRole="admin"
            onSignOut={vi.fn()}
            soloPaigeWorkspace={<PaigeAIChat hideHeader fill enableHistory soloTenantSafety />}
          >
            <p>Main CRM remains usable</p>
          </TenantCommandCenterShell>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]")?.click());
    const workspace = host.querySelector("#tenant-paige-workspace");
    const composer = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="Talk while she works…"]')!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      valueSetter.call(composer, "Local recovery draft");
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("local-proof.pdf");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.disabled).toBe(false);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Open PAIGE in a new window"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(popupDocument.body.querySelector("#tenant-paige-workspace")).toBe(workspace);

    await act(async () => {
      popupRecord.cleanup();
      if (!returnedBeforeDiscard) beforeUnload?.(new Event("beforeunload"));
      await Promise.resolve();
    });
    expect(host.querySelector("#tenant-paige-workspace")).toBe(workspace);
    expect(host.querySelectorAll("#tenant-paige-workspace")).toHaveLength(1);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Clear unsent message"]')?.click();
      await settlePaigeFocus();
    });
    expect(composer.value).toBe("");
    expect(host.textContent).not.toContain("local-proof.pdf");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.disabled).toBe(true);
    expect(document.activeElement).toBe(composer);

    await act(async () => root.unmount());
    host.remove();
    styles.remove();
    open.mockRestore();
    expect(returnedBeforeDiscard).toBe(true);
  });

  it("opens the surviving workspace through one restrained command control", () => {
    const onOpen = vi.fn();
    const host = document.createElement("div");
    const root = createRoot(host);

    act(() => root.render(<TenantPaigeCommandField expanded={false} onOpen={onOpen} />));
    const command = host.querySelector<HTMLButtonElement>("[data-tenant-paige-command]");

    expect(command).not.toBeNull();
    // §13/§70 — THIS PINNED A KEY THAT DID NOTHING. The shell binds ⌘/Ctrl + backslash (see its
    // keydown handler); ⌘K's global owner is registered only when `launcherEnabled`, which the Solo
    // app sets false. So the one keyboard hint on the surface named a key that opens nothing, and
    // this assertion held it there. Corrected to the key that actually works.
    expect(command?.textContent).toContain("Direct PAIGE, or press ⌘\\");
    expect(command?.querySelector("kbd")?.textContent).toBe("⌘\\");
    expect(command?.getAttribute("aria-controls")).toBe("tenant-paige-workspace");
    expect(host.querySelectorAll("[data-tenant-paige-command]")).toHaveLength(1);

    act(() => command?.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("routes the command field into expandRail instead of another chat instance", () => {
    const shell = source("src/components/tenant-shell/TenantCommandCenterShell.tsx");
    const solo = source("src/solo/SoloApp.tsx");
    expect(shell).toMatch(/const openPaige = useCallback\(\(\) => \{[\s\S]*child\.focus\(\);[\s\S]*expandRail\(\)/);
    expect(shell).toMatch(/<TenantPaigeCommandField[^>]*expanded=\{railExpanded \|\| paigeFull\}[^>]*onOpen=\{openPaige\}/);
    expect(shell.match(/function PaigeWorkspace\(/g)).toHaveLength(1);
    expect(shell).toContain("soloPaigeWorkspace");
    expect(shell).toContain("paigeFull");
    expect(shell).toContain('!railExpanded || paigeOverlay ? "0px"');
    expect(solo).not.toContain("paige:<PaigeHub/>");
    expect(solo).toContain("<SoloPaigeWorkspace");
    expect(solo.match(/<SoloPaigeWorkspace/g)).toHaveLength(1);
  });
});

describe("PAIGE message presentation", () => {
  it("renders no illustrated PAIGE avatar and leaves no avatar gutter", () => {
    const chat = source("src/components/dashboard/PaigeAIChat.tsx");
    expect(chat).not.toContain("paige-ai-avatar.png");
    expect(chat).not.toContain("paigeAvatar");
    expect(chat).not.toContain("pl-[35px]");
    expect(chat).not.toContain("pl-[52px]");
  });
});
