import { renderToStaticMarkup } from "react-dom/server";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SoloClientContextPane, SoloConversationOperatingBar, SoloConversationsWorkspace } from "./SoloConversationsWorkspace";
import { ThreadFilters } from "../ThreadFilters";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Solo Conversations workspace", () => {
  it("uses one bounded queue/thread/context area with a permanently mounted sibling context", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SoloConversationsWorkspace
          threadList={<div>Queue</div>}
          activeThread={<div>Thread</div>}
          clientContext={<div>Client context</div>}
          hasSelection
          showFirstRun={false}
          firstRun={<div>First run</div>}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("data-solo-conversations-workspace");
    expect(html).toContain('data-pane="queue"');
    expect(html).toContain('data-pane="thread"');
    expect(html).toContain('data-pane="client-context"');
    expect(html).toContain("Client context");
    expect(html).not.toMatch(/Your client book|Client conversations|role="dialog"|aria-label="Close/i);
  });

  it("preserves all three sibling panes in first-run instead of swapping out the workspace", () => {
    const html = renderToStaticMarkup(
      <SoloConversationsWorkspace
        threadList={<div>Empty queue</div>}
        activeThread={<div>Unused thread</div>}
        clientContext={<div>No client selected</div>}
        hasSelection={false}
        showFirstRun
        firstRun={<div>Guided first run</div>}
      />,
    );
    expect(html).toContain("Guided first run");
    expect(html).toContain("Empty queue");
    expect(html).toContain("No client selected");
    expect(html.match(/data-pane=/g)).toHaveLength(3);
  });

  it("keeps Needs attention Solo-only", () => {
    const props = { view: "active" as const, onView: () => undefined, activeUnread: 0, foldedPending: 2, catalog: [], labelFilter: null, onLabelFilter: () => undefined };
    const generic = renderToStaticMarkup(<ThreadFilters {...props} />);
    const solo = renderToStaticMarkup(<ThreadFilters {...props} soloAttention />);
    expect(generic).not.toContain("Needs attention");
    expect(solo).toContain("Needs attention");
  });

  it("enables PAIGE drafts only when the email composer has a usable identity and recipient", () => {
    const renderBar = (canDraftWithPaige: boolean) => renderToStaticMarkup(
      <MemoryRouter>
        <SoloConversationOperatingBar
          mode="human"
          onModeChange={() => undefined}
          channels={[]}
          activeChannel="email"
          canDraftWithPaige={canDraftWithPaige}
          connectionsHref="/connections"
          selectedClientName="Avery Stone"
          selectedThreadLabel="Email thread"
          onOpenPaige={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(renderBar(false)).toMatch(/disabled=""[^>]*title="PAIGE drafting needs a ready email identity and recipient"/);
    expect(renderBar(true)).not.toContain("PAIGE drafting needs a ready email identity and recipient");
  });

  it("shows one active-channel disclosure instead of permanently wrapping every channel across the thread", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SoloConversationOperatingBar
          mode="human"
          onModeChange={() => undefined}
          channels={[
            { id: "email", label: "Email", availability: "PARTIAL", providerConnection: "Connected", providerSource: "Google", identity: "paige@example.test", sendPermission: "Ask First", inbound: "Not reported", webhookHealth: "Not reported", operationalHealth: "Partial", setupOwner: "Settings → Connections" },
            { id: "sms", label: "SMS", availability: "PARTIAL", providerConnection: "Connected", providerSource: "Twilio", identity: "+12025550142", a2p: "Not reported", sendPermission: "Ask First", inbound: "Not reported", webhookHealth: "Not reported", operationalHealth: "Partial", setupOwner: "Settings → Connections" },
          ]}
          activeChannel="email"
          canDraftWithPaige
          connectionsHref="/connections"
          selectedClientName="Antonio Cook"
          selectedThreadLabel="Email · givalli44@icloud.com"
          onOpenPaige={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('class="solo-channel-menu"');
    expect(html).toContain("Current channel");
    expect(html).toContain("All channels");
    expect(html.match(/solo-channel-menu-option/g)).toHaveLength(2);
    expect(html).not.toContain("solo-channel-strip");
  });

  it("fails an unrepresented active channel closed instead of substituting Portal", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SoloConversationOperatingBar
          mode="human"
          onModeChange={() => undefined}
          channels={[
            { id: "portal", label: "Portal", availability: "PARTIAL", providerConnection: "Not a proven message transport", providerSource: "Portal access", identity: "Not applicable", sendPermission: "Not proven", inbound: "Not proven", webhookHealth: "Not applicable", operationalHealth: "Not reported", setupOwner: "Clients → Portal" },
          ]}
          activeChannel="whatsapp"
          canDraftWithPaige={false}
          connectionsHref="/connections"
          selectedClientName="Antonio Cook"
          selectedThreadLabel="WhatsApp thread"
          onOpenPaige={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Current channel: WhatsApp, UNAVAILABLE");
    expect(html).toContain("Not represented in this workspace");
    expect(html).not.toContain("Current channel: Portal");
  });

  it("opens the primary PAIGE workspace while labeling unproven client and agent continuity honestly", () => {
    const openPaige = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => root.render(
      <MemoryRouter>
        <SoloConversationOperatingBar
          mode="human"
          onModeChange={() => undefined}
          channels={[]}
          activeChannel="email"
          canDraftWithPaige
          connectionsHref="/connections"
          selectedClientName="Antonio Cook"
          selectedThreadLabel="Email · givalli44@icloud.com"
          onOpenPaige={openPaige}
        />
      </MemoryRouter>,
    ));

    expect(host.textContent).toContain("Primary PAIGE");
    expect(host.textContent).toContain("Account context");
    expect(host.textContent).toContain("Client and thread handoff");
    expect(host.textContent).toContain("Specialist delegation");
    expect(host.textContent).toContain("Durable outcomes");
    expect(host.querySelector("summary")?.getAttribute("aria-label")).toBe("Primary PAIGE coordination status: live");
    expect(host.querySelectorAll(".solo-paige-coordination-truth dd")[0]?.textContent).toBe("LIVE");
    expect(Array.from(host.querySelectorAll(".solo-paige-coordination-truth dd")).slice(1).every((node) => node.textContent === "PROPOSED")).toBe(true);
    expect(host.textContent).toContain("Antonio Cook");
    expect(host.textContent).toContain("Email · givalli44@icloud.com");

    act(() => host.querySelector<HTMLButtonElement>("[data-open-primary-paige]")?.click());
    expect(openPaige).toHaveBeenCalledTimes(1);

    const coordination = host.querySelector<HTMLDetailsElement>(".solo-paige-coordination");
    const summary = coordination?.querySelector<HTMLElement>("summary");
    if (coordination) coordination.open = true;
    act(() => coordination?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(coordination?.open).toBe(false);
    expect(document.activeElement).toBe(summary);

    act(() => root.unmount());
    host.remove();
  });

  it("keeps relationship truth read-only and routes edits to canonical owners", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SoloClientContextPane
          contact={{
            id: "person-1", first_name: "Avery", last_name: "Stone", entity_name: "Northstar",
            email: "avery@example.test", phone: "+12025550142", status: "active", timezone: null,
            created_at: null, created_by: null, created_by_channel_type: null, lifecycle_stage: "lead",
            entity_type: "person", title: "Founder", source: "referral", tags: ["Priority"],
            last_contacted_at: "2026-08-27T12:00:00.000Z", assigned_coach_user_id: "owner-1",
            linked_user_id: null, dnd_active: false, dnd_reason: null, dnd_until: null,
          }}
          labels={[]}
          recentMessages={[]}
          links={{ people: "/people", portal: "/portal", campaigns: "/campaigns", connections: "/connections" }}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Avery Stone");
    expect(html).toContain("People owns this record");
    expect(html).toContain("Pipeline / deal");
    expect(html).toContain("Not reported");
    expect(html).toContain("Portal access");
    expect(html).toContain("Invitation");
    expect(html).toContain("Access / account link");
    expect(html).toContain("Open People record");
    expect(html).not.toMatch(/Save|Edit owner|Invite now|Assign pipeline/);
  });

  // E09 Slice 7: a paused client keeps their link; the fact must not read as "can get in".
  it.each([
    ["paused", "login-1", "Linked account · portal access paused"],
    ["ended", null, "Portal access ended"],
    ["open", "login-1", "Linked account reported"],
  ] as const)("names a %s client's portal access honestly", (state, linked, fact) => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SoloClientContextPane
          contact={{
            id: "person-1", first_name: "Jordan", last_name: "Rivera", entity_name: null,
            email: "jordan@example.test", phone: null, status: "active", timezone: null,
            created_at: null, created_by: null, created_by_channel_type: null, lifecycle_stage: "client",
            entity_type: "person", title: null, source: null, tags: [],
            last_contacted_at: null, assigned_coach_user_id: null,
            linked_user_id: linked, portal_access_state: state, dnd_active: false, dnd_reason: null, dnd_until: null,
          }}
          labels={[]}
          recentMessages={[]}
          links={{ people: "/people", portal: "/portal", campaigns: "/campaigns", connections: "/connections" }}
        />
      </MemoryRouter>,
    );
    expect(html).toContain(fact);
    if (state !== "open") expect(html).not.toContain("Linked account reported");
  });

  it("retains focus when the bounded context rail is collapsed", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <SoloConversationsWorkspace
        threadList={<div>Queue</div>}
        activeThread={<div>Thread</div>}
        clientContext={<div>Context</div>}
        hasSelection
        showFirstRun={false}
        firstRun={null}
      />,
    ));
    const collapse = host.querySelector<HTMLButtonElement>(".solo-context-collapse");
    collapse?.focus();
    await act(async () => collapse?.click());
    expect(document.activeElement).toBe(collapse);
    expect(collapse?.getAttribute("aria-expanded")).toBe("false");
    act(() => root.unmount());
    host.remove();
  });

  it("keeps the selected-client context expanded when the workspace becomes tight", async () => {
    const OriginalResizeObserver = globalThis.ResizeObserver;
    class TightResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 580 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TightResizeObserver);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <SoloConversationsWorkspace
        threadList={<div>Queue</div>}
        activeThread={<div>Thread</div>}
        clientContext={<div>Antonio Cook profile</div>}
        hasSelection
        showFirstRun={false}
        firstRun={null}
      />,
    ));
    const workspace = host.querySelector("[data-solo-conversations-workspace]");
    const collapse = host.querySelector<HTMLButtonElement>(".solo-context-collapse");
    expect(workspace?.getAttribute("data-form-fit")).toBe("tight");
    expect(workspace?.getAttribute("data-context-collapsed")).toBe("false");
    expect(collapse?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".solo-context-content")?.textContent).toContain("Antonio Cook profile");
    await act(async () => collapse?.click());
    expect(workspace?.getAttribute("data-context-collapsed")).toBe("true");
    expect(collapse?.getAttribute("aria-label")).toBe("Expand client context");
    await act(async () => collapse?.click());
    expect(workspace?.getAttribute("data-context-collapsed")).toBe("false");
    expect(collapse?.getAttribute("aria-label")).toBe("Collapse client context");
    act(() => root.unmount());
    host.remove();
    vi.stubGlobal("ResizeObserver", OriginalResizeObserver);
  });
});
