/**
 * E09 — the Solo channel strip names the portal with the same door icon the thread, the list and
 * the composer use (CHANNEL_ICON.portal), never the SMS speech bubble.
 *
 * PROOF CLASS: static render (react-dom/server) of the real operating bar.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SoloConversationOperatingBar } from "./SoloConversationsWorkspace";
import type { SoloChannelTruth } from "./soloConversationModel";

const truth = (id: string, label: string): SoloChannelTruth => ({
  id, label, availability: "PARTIAL", providerConnection: "Not reported", providerSource: "Not reported",
  identity: "Not applicable", sendPermission: "Not reported", inbound: "Not reported", webhookHealth: "Not applicable",
  operationalHealth: "Not reported", setupOwner: "Clients → Portal",
});

const summaryFor = (activeChannel: string) => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SoloConversationOperatingBar
        mode="human"
        onModeChange={() => undefined}
        channels={[truth("email", "Email"), truth("sms", "SMS"), truth("portal", "Portal")]}
        activeChannel={activeChannel}
        canDraftWithPaige={false}
        connectionsHref="/connections"
        selectedClientName="Maya Ortiz"
        selectedThreadLabel="Portal · client portal"
        onOpenPaige={() => undefined}
      />
    </MemoryRouter>,
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  const summary = host.querySelector(".solo-channel-menu > summary");
  if (!summary) throw new Error("channel summary not found");
  return summary;
};

describe("Solo channel strip — portal icon", () => {
  it("shows the portal door icon for the Portal channel, not the SMS icon", () => {
    const summary = summaryFor("portal");
    expect(summary.getAttribute("aria-label")).toBe("Current channel: Portal, PARTIAL");
    expect(summary.querySelector("svg.lucide-door-open")).toBeTruthy();
    expect(summary.querySelector("svg.lucide-message-square-text")).toBeNull();
  });

  it("keeps the SMS icon for SMS", () => {
    const summary = summaryFor("sms");
    expect(summary.querySelector("svg.lucide-message-square-text")).toBeTruthy();
    expect(summary.querySelector("svg.lucide-door-open")).toBeNull();
  });
});
