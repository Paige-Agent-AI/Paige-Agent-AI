import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SoloSettings } from "./settings";

const testState = vi.hoisted(() => ({ tab: "team" }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useUserRoles", () => ({
  // The predicate the SERVER gates on (platform owner OR global admin/coach). Mocked
  // rather than left to the real hook, which opens its own auth subscription.
  useUserRoles: () => ({ loading: false, userId: "u1", roles: ["admin"], isAdmin: true, isCoach: false, isClient: false, isBroker: false, isStaff: true }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // `current_user_tenant_id` is the resolver both new adapters read through — it is
    // what the WRITES use, so the reads use it too. A double that answers null for it
    // makes every surface report an unidentifiable workspace instead of rendering copy.
    rpc: vi.fn(async (fn: string) =>
      fn === "current_user_tenant_id" ? { data: "tenant-1971670", error: null } : { data: null, error: null }),
    // The number panel calls an edge function now, and `useSoloNumbers` reads the
    // numbers table, so both have to exist on the double or the surface throws
    // before any copy is rendered.
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }), limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    })),
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({
    activeTenantId: "tenant-1971670",
    loading: false,
    activeTenant: { account_number: "1971670" },
  }),
}));
vi.mock("@/lib/routing/useSubtabRoute", () => ({
  useSubtabRoute: () => [testState.tab, vi.fn()],
}));
vi.mock("./data/useSoloPeople", () => ({
  useSoloPeople: () => ({ people: [], loading: false, error: null }),
}));
vi.mock("./data/useSoloBusiness", () => ({
  useSoloBusiness: () => ({
    name: "First Sterling Capital",
    brand: { website: null, business_phone: null, industry: null },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("./data/useSoloOwner", () => ({
  useSoloOwner: () => ({
    owner: { name: "Antonio Cook", email: null, phone: null, website: null },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("./data/useSoloSetupBrief", () => ({
  useSoloSetupBrief: () => ({
    loading: false,
    error: null,
    saving: false,
    canEdit: true,
    brief: {
      legalName: "First Sterling Capital",
      publicName: "First Sterling Capital",
      dbaName: "",
      website: "",
      address: "",
      phone: "",
      industry: "",
      naicsCode: "",
      sicCode: "",
      offers: "",
      deliveryModel: "",
      idealCustomer: "",
      customerSegments: "",
      serviceArea: "",
      currentPriority: "",
      goals90Day: "",
      annualDirection: "",
      successDefinition: "",
      constraints: "",
      brandVoice: "",
      operatingPreferences: "",
      doNotAssume: "",
      representativeUserIds: [],
      provenance: {},
    },
    representatives: [],
    managedSendingEmail: null,
    primaryBusinessEmail: null,
    pendingProposal: null,
    save: vi.fn(),
    dismissProposal: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("./data/useSoloComms", () => ({
  useSoloComms: () => ({
    business: { name: "", website: "", phone: "" }, mailbox: { connected: false, address: null, displayName: null, provider: null, status: null }, canManage: true, saveBusiness: vi.fn(async () => ({ ok: true, error: null })), addDomain: vi.fn(async () => ({ ok: true, error: null })), refreshDomain: vi.fn(async () => ({ ok: true, error: null })), setDefaultDomain: vi.fn(async () => ({ ok: true, error: null })), removeDomain: vi.fn(async () => ({ ok: true, error: null })), startGmailConnect: vi.fn(async () => ({ url: null, error: null })), disconnectGmail: vi.fn(async () => ({ ok: true, error: null })), domains: [],
    billing: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

const destinations = [
  "setup",
  "team",
  "connections",
  "integrations",
  "security-data",
  "vault",
  "billing",
] as const;

function renderDestination(tab: (typeof destinations)[number]) {
  testState.tab = tab;
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/solo/1971670/settings/${tab}`]}>
      <Routes>
        <Route path="/solo/:account/settings/:tab" element={<SoloSettings />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderedText(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("Solo Settings rendered customer copy", () => {
  it("redirects the real legacy Settings mount before rendering its retired content", async () => {
    testState.tab = "setup";
    const router = createMemoryRouter([{ path: "/solo/:account/*", element: <SoloSettings/> }], {
      initialEntries: ["/solo/41/settings/notifications?origin=calendar"],
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<RouterProvider router={router}/>));
      expect(router.state.location.pathname).toBe("/solo/41/settings/setup/business-profile");
      expect(router.state.location.state?.notificationMoveNotice).not.toBe(true);
      expect(host.textContent).toContain("Setup");
      expect(host.querySelector("h1")).toBeNull();
      expect(host.textContent).toContain("Notifications now appear in the area where the work happens.");
      expect(host.textContent).not.toContain("Customer notifications");
      expect(host.textContent).not.toContain("Delivery failures");
    } finally {
      await act(async () => root.unmount());
      router.dispose();
      host.remove();
    }
  });

  it("renders the approved Workspace permissions title and body", () => {
    const text = renderedText(renderDestination("team"));
    expect(text).toContain("Workspace permissions");
    expect(text).toContain("Owners and authorized admins may manage team access. Permissions apply only to this Solo workspace.");
  });

  it("keeps operator-only terminology out of every rendered destination", () => {
    const rendered = destinations.map(renderDestination).join(" ").toLowerCase();
    const forbiddenTerms = [
      "platform operator",
      "break-glass",
      "fleet",
      "cross-tenant",
      "tenant-null",
      "tenant_id is null",
      "operator surface",
    ];

    for (const term of forbiddenTerms) expect(rendered).not.toContain(term);
  });

  it("renders Integrations as its own truthful Settings destination", () => {
    const text = renderedText(renderDestination("integrations"));
    // A static render shows the surface before its tenant-scoped read resolves,
    // so the copy proven here is the chrome and the honest waiting state. The
    // provider cards themselves are proven in the rendered-flow tests, which
    // drive the real read (settings-integrations.test.tsx).
    expect(text).toContain("Integrations");
    expect(text).toContain("Automations");
    expect(text).toMatch(/Resolving this account/);
    // The removed chrome must not come back: no oversized catalogue masthead,
    // no ownership table, no scroll cue.
    expect(text).not.toContain("Integration catalogue");
    expect(text).not.toContain("Browse by provider");
    expect(text).not.toContain("Scroll to browse");
    expect(text).not.toContain("Marketplace Governed Paige capability lifecycle");
    expect(text).not.toContain("External tools and bridges");
    expect(text).not.toContain("Marketplace / Storefront");
    expect(text).not.toContain("Business phone");
    expect(text).not.toContain("A2P");
  });

  it("keeps Communications focused on communication methods", () => {
    const text = renderedText(renderDestination("connections"));

    expect(text).toContain("Business phone");
    expect(text).toContain("Sending identity");
    expect(text).not.toContain("Find a number");
    expect(text).not.toContain("Messaging registration");
    expect(text).not.toContain("Consent and opt-outs");
    expect(text).not.toContain("Delivery health");
    expect(text).not.toContain("Billing for messaging");
  });

  it("puts number search and the complete messaging-registration area in Registration", () => {
    testState.tab = "connections";
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/solo/1971670/settings/connections?segment=registration"]}>
        <Routes>
          <Route path="/solo/:account/settings/:tab" element={<SoloSettings />} />
        </Routes>
      </MemoryRouter>,
    );
    const text = renderedText(html);

    expect(html).toMatch(/aria-selected="true"[^>]*>Registration</);
    for (const heading of ["Find a number", "Messaging registration", "Carrier registration", "Consent and opt-outs", "Complete registration"]) {
      expect(text, "missing Registration content: " + heading).toContain(heading);
    }
    expect(html.indexOf("Find a number")).toBeLessThan(html.indexOf("Messaging registration"));
    expect(html.indexOf("Messaging registration")).toBeLessThan(html.indexOf("Complete registration"));
    expect(text).not.toContain("Number on this business");
  });

  /**
   * NARROWED, and the narrowing is the honest part.
   *
   * This asserted that Connections contained no connector names at all. That
   * passed — but only because #660's `Available` catalogue sits behind its own
   * tab and the default view is Communications. A test that green-lights on
   * which tab happens to be selected is not evidence about the seam; it is
   * evidence about a default.
   *
   * What this PR was actually told to do is narrower: do not BUILD Integrations
   * as a tab inside Connections. That is what is asserted now. #660's Available
   * catalogue predates the split, is annotated there as owner-locked, and is
   * deliberately left alone — whether it still earns a place in Connections now
   * that #657 ships a real Integrations destination is the owner's call and
   * that lane's, not this PR's.
   */
  it("replaces the Available provider wall with a job-led Add channel workspace", () => {
    testState.tab = "connections";
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/solo/1971670/settings/connections?segment=available"]}>
        <Routes><Route path="/solo/:account/settings/:tab" element={<SoloSettings />} /></Routes>
      </MemoryRouter>,
    );
    const text = renderedText(html);

    expect(html).toMatch(/aria-selected="true"[^>]*>Add channel</);
    for (const copy of ["Add a communication channel", "Email and inbox", "Phone and messaging", "Calendar and booking", "Go to Integrations"]) {
      expect(text).toContain(copy);
    }
    expect(text).toContain("Receiving mail and sending mail are different permissions.");
    expect(text).toContain("Unavailable");
    expect(text).not.toContain("PARTIAL");
    for (const provider of ["n8n", "Zapier", "Make.com", "MCP", "Direct APIs"]) expect(text).not.toContain(provider);
    expect(html.match(/Go to Integrations/g)).toHaveLength(1);
    expect(html).toContain(`/solo/1971670/settings/integrations`);
  });

  it("keeps readiness, delivery, and messaging billing under Health", () => {
    testState.tab = "connections";
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/solo/1971670/settings/connections?segment=health"]}>
        <Routes>
          <Route path="/solo/:account/settings/:tab" element={<SoloSettings />} />
        </Routes>
      </MemoryRouter>,
    );
    const text = renderedText(html);

    expect(html).toMatch(/aria-selected="true"[^>]*>Health</);
    expect(text).toContain("Business texting readiness");
    expect(text).toContain("Delivery health");
    expect(text).toContain("Billing for messaging");
  });

  it("does not build an Integrations tab inside Connections", () => {
    const text = renderedText(renderDestination("connections"));
    // No Integrations destination of Connections' own — the §18 duplication.
    expect(text).not.toContain("Integrations");
    // And Connections opens on Communications, not on a connector catalogue.
    expect(text).toContain("Business phone");
  });

  it("actually searches, and reports a setup gap as a setup gap", async () => {
    // REPLACES "keeps number search non-mutating and explains the unavailable
    // execution contract". That test locked the panel's inertness — it asserted
    // the button ran nothing and said so. Owner ruling 2026-08-31: bring it live.
    // `comms-search-numbers` was always real; only the caller was missing.
    //
    // So what is locked now is the opposite, plus the honesty rule that matters
    // most here: a workspace with no messaging account CANNOT buy, and that is a
    // setup gap, never an empty result. Reporting "no numbers found" would blame
    // the search for something it did not do.
    testState.tab = "connections";
    const shellScrollOwner = document.createElement("main");
    shellScrollOwner.id = "tenant-shell-main";
    const host = document.createElement("div");
    shellScrollOwner.append(host);
    document.body.append(shellScrollOwner);
    const root = createRoot(host);

    const client = (await import("@/integrations/supabase/client")).supabase;
    // Resolve the caller as a workspace admin, which is what the server requires:
    // `comms-search-numbers` returns 403 to anyone else, so a surface that showed
    // the control to a non-admin would be showing a button that always fails.
    (client.rpc as ReturnType<typeof vi.fn>).mockImplementation(async (fn: string) =>
      // Both resolvers, because the adapter needs both: the workspace it is scoped to,
      // and whether this caller may change its numbers. Answering only the second left
      // the surface unable to say which workspace it was in, so it showed no controls.
      fn === "current_user_tenant_id" ? { data: "tenant-1971670", error: null }
        : fn === "is_current_user_tenant_admin" ? { data: true, error: null }
          : { data: null, error: null });
    const invoke = client.functions.invoke as ReturnType<typeof vi.fn>;
    invoke.mockResolvedValue({ data: { needs_config: true, message: "Messaging isn't set up yet.", numbers: [] }, error: null });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/1971670/settings/connections"]}>
          <Routes>
            <Route path="/solo/:account/settings/:tab" element={<SoloSettings />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    const registrationTab = Array.from(host.querySelectorAll("button")).find((c) => (c.textContent ?? "").trim() === "Registration");
    await act(async () => registrationTab?.click());

    const button = Array.from(host.querySelectorAll("button")).find((c) => (c.textContent ?? "").includes("Search numbers"));
    const form = button?.closest("form");
    expect(button, "the live search button should render").toBeTruthy();
    expect(shellScrollOwner.classList.contains("tcs-main--settings-scrollbar-hidden")).toBe(true);

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // It REACHED the real seam — the assertion the old test made impossible.
    expect(invoke.mock.calls.some((c) => c[0] === "comms-search-numbers"),
      "Search must call comms-search-numbers").toBe(true);
    // And a setup gap reads as one.
    expect(host.textContent).toContain("can't buy a number yet");
    expect(host.textContent).not.toContain("No numbers matched");

    await act(async () => root.unmount());
    expect(shellScrollOwner.classList.contains("tcs-main--settings-scrollbar-hidden")).toBe(false);
    shellScrollOwner.remove();
  });

  it("opens Calendars when the entry says the link came from Calendar", () => {
    // The Calendar's "Manage calendar settings" exit carries origin=calendar.
    // Landing on Communications after following it is how someone concludes the
    // setting is not there, so the validated entry picks the segment.
    testState.tab = "connections";
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/solo/1971670/settings/connections?origin=calendar&returnTo=%2Fsolo%2F1971670%2Fclients%2Fcalendar"]}>
        <Routes>
          <Route path="/solo/:account/settings/:tab" element={<SoloSettings />} />
        </Routes>
      </MemoryRouter>,
    );
    const text = renderedText(html);
    // The Calendars segment's eyebrow. #1224 renamed it from "Booking presets" (owner copy ruling:
    // user-facing "preset" becomes "calendar"); both the positive and negative checks follow it.
    expect(text).toContain("Booking calendars");
    expect(html).toMatch(/aria-selected="true"[^>]*>Calendars</);
    // …and an ordinary visit still lands on Communications.
    const plain = renderDestination("connections");
    expect(renderedText(plain)).not.toContain("Booking calendars");
    expect(plain).toMatch(/aria-selected="true"[^>]*>Communications</);
  });

  it("opens Calendars when the OAuth return names that segment", () => {
    // Which segment you were on is local state and never reaches the URL, so
    // the return address carries it explicitly — otherwise the callback rebuilds
    // Settings from the path alone and lands on Communications.
    testState.tab = "connections";
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/solo/1971670/settings/connections?segment=calendars"]}>
        <Routes>
          <Route path="/solo/:account/settings/:tab" element={<SoloSettings />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>Calendars</);
  });

  it("ignores a segment the surface does not have, rather than rendering nothing", () => {
    // The value arrives from a URL. Casting it would select no segment at all
    // and paint an empty Connections page.
    testState.tab = "connections";
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/solo/1971670/settings/connections?segment=nonsense"]}>
        <Routes>
          <Route path="/solo/:account/settings/:tab" element={<SoloSettings />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>Communications</);
  });

  it("pins the Connections sub-navigation so the context survives a long scroll", () => {
    const css = readFileSync(path.resolve(process.cwd(), "src/solo/settings.css"), "utf8");
    expect(css).toMatch(/\.ss-subnav\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.ss-subnav\s*\{[^}]*background:\s*var\(--pg-canvas\)/);
  });

  it("dresses and resets the element that actually scrolls, not the one above it", async () => {
    // SoloApp nests a screen host inside the shell's `#tenant-shell-main`, and
    // that host is what scrolls Settings. Adding the scrollbar-hiding class to the
    // outer main left the VISIBLE scrollbar undressed. And because one host serves
    // the whole route, its scroll position outlived a tab change — opening a short
    // destination after a long one landed part-way down its content.
    testState.tab = "connections";
    const shellMain = document.createElement("main");
    shellMain.id = "tenant-shell-main";
    const screenHost = document.createElement("main");
    screenHost.setAttribute("data-solo-screen-host", "");
    const host = document.createElement("div");
    screenHost.append(host);
    shellMain.append(screenHost);
    document.body.append(shellMain);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/1971670/settings/connections"]}>
          <Routes><Route path="/solo/:account/settings/:tab" element={<SoloSettings />} /></Routes>
        </MemoryRouter>,
      );
    });

    expect(screenHost.classList.contains("tcs-main--settings-scrollbar-hidden")).toBe(true);
    expect(shellMain.classList.contains("tcs-main--settings-scrollbar-hidden")).toBe(false);

    screenHost.scrollTop = 900;
    testState.tab = "security-data";
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/solo/1971670/settings/security-data"]}>
          <Routes><Route path="/solo/:account/settings/:tab" element={<SoloSettings />} /></Routes>
        </MemoryRouter>,
      );
    });
    expect(screenHost.scrollTop).toBe(0);

    await act(async () => root.unmount());
    expect(screenHost.classList.contains("tcs-main--settings-scrollbar-hidden")).toBe(false);
    shellMain.remove();
  });

  it("keeps Settings off SoloApp's clipped-host list, so its long tabs can be scrolled", () => {
    // The regression this exists for: `settings` was in SoloApp's `full` set, so
    // the screen host rendered `overflow:hidden` at `height:100%`. The Calendars
    // tab — the longest surface in Settings — was cut off at the fold, and the
    // shell's own scroll owner never overflowed either, so there was nothing to
    // scroll by wheel, key or scrollbar. `.solo-settings` is a document flow with
    // no internal scroller; its host must be the one that scrolls.
    const app = readFileSync(path.resolve(process.cwd(), "src/solo/SoloApp.tsx"), "utf8");
    const full = app.match(/const full=([^;]+);/)?.[1] ?? "";
    expect(full).not.toBe("");
    expect(full).not.toContain("'settings'");
    // The host itself still switches on `full` — that is what makes the list load-bearing.
    expect(app).toMatch(/overflow:full\?'hidden':'auto'/);
  });

  it("hides Settings scrollbar chrome without disabling scrolling", () => {
    const css = readFileSync(path.resolve(process.cwd(), "src/solo/settings.css"), "utf8");
    expect(css).toContain(".tcs-main--settings-scrollbar-hidden");
    expect(css).toContain("scrollbar-width: none");
    expect(css).toContain(".ss-phone-title");
    expect(css).toMatch(/\.ss-phone-title[^}]*font:\s*650 18px/);
    expect(css).not.toMatch(/\.tcs-main--settings-scrollbar-hidden\s*\{[^}]*overflow[^}]*hidden/);
  });
});
