import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanSoloSetupBrief } from "./settings-setup-contract";
import { SoloFirstValue } from "./SoloFirstValue";
import type { useSoloBusinessContext } from "./data/useSoloBusinessContext";

type Context = ReturnType<typeof useSoloBusinessContext>;
const state = { context: {} as Context };

function makeContext(overrides: Partial<Context>): Context {
  return {
    loading: false, error: null, saving: false, saveOutcomeUnknown: false, reconciling: false,
    accessScope: "owner_full", canEdit: true, canEditLegal: true,
    activeTenantId: "tenant-a", resolvedTenantId: "tenant-a", contextRevision: 1,
    brief: cleanSoloSetupBrief(null),
    businessOwners: [], primaryBusinessEmail: "", primaryBusinessEmailProvenance: { source: "needs_confirmation", confidence: "unknown" },
    knowledgeSources: [], paigeProfile: {} as Context["paigeProfile"], voiceExamples: [],
    managedEmail: null, webIdentity: "none",
    refresh: async () => {}, reconcileSave: async () => ({ ok: true }) as never,
    save: async () => ({ ok: true }) as never,
    ...overrides,
  } as Context;
}

let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render() {
  await act(async () => root.render(<SoloFirstValue context={state.context} disabled={false} />));
}
const text = () => host.textContent ?? "";
const buttons = () => [...host.querySelectorAll("button")];

describe("SoloFirstValue — the grounded ALG-02/ALG-13 surface", () => {
  it("with no confirmed priority it asks for the priority and recommends nothing else", async () => {
    state.context = makeContext({});
    await render();
    expect(text()).toContain("Confirm your current priority");
    expect(buttons().map((b) => b.textContent)).toEqual([]); // foundational action carries no dismiss
    expect(host.querySelector("[data-logic-version]")?.getAttribute("data-logic-version")).toBe("1");
    expect(text()).toContain("MENTOR");
  });

  it("renders explainable ranked actions with the approved availability labels", async () => {
    state.context = makeContext({
      brief: cleanSoloSetupBrief({
        currentPriority: "Turn more quotes into booked work",
        industry: "Design consultancy",
        provenance: {
          currentPriority: { source: "owner_confirmed", confidence: "confirmed" },
          industry: { source: "owner_confirmed", confidence: "confirmed" },
        },
      }),
      webIdentity: "reserved",
      managedEmail: { address: "studio@mail.paigeagent.ai" } as Context["managedEmail"],
    });
    await render();
    expect(text()).toContain("Turn more quotes into booked work");
    expect(text()).toContain("Design consultancy");
    expect(text()).toContain("Not yet available");
    expect(text()).toContain("Web address");
    expect(text()).toContain("2 of 10 business facts confirmed");
  });

  it("a dismissed non-foundational action hides for the visit and the copy says it returns", async () => {
    state.context = makeContext({
      brief: cleanSoloSetupBrief({
        currentPriority: "Grow recurring work",
        provenance: { currentPriority: { source: "owner_confirmed", confidence: "confirmed" } },
      }),
    });
    await render();
    const dismissWeb = buttons().find((b) => b.textContent === "Not now" && b.previousElementSibling?.textContent?.includes("web address"));
    expect(dismissWeb).toBeTruthy();
    await act(async () => dismissWeb!.click());
    expect(text()).not.toContain("Reserve your temporary web address");
    expect(text()).toContain("return on your next visit");
  });

  it("an always-present managed email with an empty address is NOT configured — no fabricated achievement", async () => {
    state.context = makeContext({
      brief: cleanSoloSetupBrief({
        currentPriority: "Grow recurring work",
        provenance: { currentPriority: { source: "owner_confirmed", confidence: "confirmed" } },
      }),
      managedEmail: { address: "" } as Context["managedEmail"], // production shape: present, unconfigured
    });
    await render();
    expect(host.querySelector('[aria-label="Achieved, with evidence"]')?.textContent ?? "").not.toContain("PAIGE email sender");
    expect(text()).toContain("Turn on your PAIGE email address");
  });

  it("never claims the first action as achieved; the honest open line names the receipt", async () => {
    state.context = makeContext({
      brief: cleanSoloSetupBrief({
        currentPriority: "Grow recurring work",
        provenance: { currentPriority: { source: "owner_confirmed", confidence: "confirmed" } },
      }),
      managedEmail: { address: "x@mail.paigeagent.ai" } as Context["managedEmail"],
      primaryBusinessEmailProvenance: { source: "owner_confirmed", confidence: "confirmed" },
      webIdentity: "reserved",
    });
    await render();
    const achieved = host.querySelector('[aria-label="Achieved, with evidence"]');
    expect(achieved?.textContent).toContain("PAIGE email sender");
    expect(achieved?.textContent).not.toContain("first action");
    expect(text()).toContain("saved result");
  });
});
