import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";

import { DomainGuidanceCard } from "./DomainGuidanceCard";
import { prepareHostingDeployment, type HostingPrepared } from "./studio-data";

vi.mock("./studio-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studio-data")>();
  return { ...actual, prepareHostingDeployment: vi.fn() };
});
const prep = vi.mocked(prepareHostingDeployment);

let root: Root | null = null;
const host = () => {
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  root = createRoot(el);
  return el;
};
afterEach(() => {
  act(() => { root?.unmount(); });
});

const open = (el: HTMLElement) => {
  const details = el.querySelector("details.vs-domain-card") as HTMLDetailsElement | null;
  if (details) act(() => { details.open = true; details.dispatchEvent(new Event("toggle", { bubbles: false })); });
  return details;
};

describe("DomainGuidanceCard", () => {
  it("renders closed as a quiet disclosure; opening shows the honest reserved-address state", () => {
    const el = host();
    act(() => root!.render(<DomainGuidanceCard tenantSlug="acme-coaching" />));
    const details = el.querySelector("details.vs-domain-card") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toBe("Use my own address");

    open(el);
    expect(details.textContent).toContain("acme-coaching.paigeagent.ai");
    // The honest starting state: the reserved address's serving status is UNOBSERVED from this
    // card (a publication receipt proves the artifact's URL, not the reserved host root) — so
    // the headline claims neither "serving" nor "held", and points at the proven address above.
    // "www." appears only inside the guidance's own next-step example, never as a claimed address.
    const state = details.querySelector(".vs-domain-state")!;
    expect(state.querySelector("p:first-child")!.textContent).toBe("Your reserved address (acme-coaching.paigeagent.ai)");
    expect(state.querySelector("p:nth-child(2)")!.textContent).toContain("isn't checked from this panel");
    expect(state.querySelector("p:nth-child(2)")!.textContent).not.toContain("www.");
    expect(state.textContent).not.toContain("Live at");
  });

  it("carries the six provider profiles behind the selector, WIX's external-authority rule included", () => {
    const el = host();
    act(() => root!.render(<DomainGuidanceCard tenantSlug="acme-coaching" />));
    open(el);
    const options = [...el.querySelectorAll("select option")].map((o) => o.textContent);
    expect(options).toEqual(["Cloudflare", "Namecheap", "GoDaddy", "Squarespace Domains", "Porkbun", "WIX"]);
    // Default profile shows; switching to WIX swaps in its rule.
    expect(el.querySelector(".vs-domain-providers")!.textContent).toContain("Cloudflare");
    const select = el.querySelector("select") as HTMLSelectElement;
    act(() => { select.value = "wix"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(el.querySelector(".vs-domain-providers")!.textContent).toContain("outside Wix");
  });

  it("pins the never-touch mail records and the no-silent-DNS promise", () => {
    const el = host();
    act(() => root!.render(<DomainGuidanceCard tenantSlug="acme-coaching" />));
    open(el);
    const mail = el.querySelector(".vs-domain-mail")!.textContent!;
    for (const rec of ["MX", "SPF", "DKIM", "DMARC", "DNSSEC"]) expect(mail).toContain(rec);
    expect(mail).toContain("never changes your DNS");
  });

  it("lays out the owner-gated host path with the cost line, and promises nothing live", () => {
    const el = host();
    act(() => root!.render(<DomainGuidanceCard tenantSlug="acme-coaching" />));
    open(el);
    const hostPath = el.querySelector(".vs-domain-hostpath")!.textContent!;
    expect(hostPath).toContain("Export the published version");
    expect(hostPath).toContain("owner-approved");
    expect(hostPath).toContain("never a move");
    expect(hostPath).toContain("free tier");
    // Nowhere does the card claim a hosted site or a purchased domain exists.
    expect(hostPath).not.toMatch(/your hosted site|we (will|'ll) deploy/i);
  });

  it("an overridden observation is told truthfully (conflict shown, never 'almost ready')", () => {
    const el = host();
    act(() => root!.render(
      <DomainGuidanceCard tenantSlug="acme-coaching" observations={{ customDomain: "www.acme-coaching.com", recordConflict: true }} />,
    ));
    open(el);
    const state = el.querySelector(".vs-domain-state")!.textContent!;
    expect(state).toContain("An existing record is in the way");
    expect(state).toContain("never overwritten");
  });
});

describe("PublishPanel mounting (static)", () => {
  it("the card is mounted in BOTH live views, gated on tenantSlug, and nothing else calls it", () => {
    const src = readFileSync("src/solo/studio/PublishPanel.tsx", "utf8");
    expect(src.match(/<DomainGuidanceCard /g)).toHaveLength(2);
    expect(src).toContain('artifact.kind === "page" && <DomainGuidanceCard tenantSlug={tenantSlug} pageId={artifact.page.id} />');
    expect(src).toContain('!confirming && tenantSlug && artifact.kind === "page" &&');
    // The disclosure adds no door contact of its own: the panel still names no publish/unpublish RPC.
    expect(src).not.toMatch(/growth_page_(publish|unpublish)/);
  });

  it("the card component itself holds no network, RPC, or DNS-call surface", () => {
    const src = readFileSync("src/solo/studio/DomainGuidanceCard.tsx", "utf8");
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|supabase|\.rpc\(|WebSocket/);
    expect(src).not.toMatch(/window\.open|location\.assign/);
  });
});

describe("DomainGuidanceCard — the host path's Check hosting step (WEB-05 wiring)", () => {
  it("shows no check button when the artifact is not a page (no pageId)", () => {
    const el = host();
    act(() => root!.render(<DomainGuidanceCard tenantSlug="acme-coaching" />));
    expect(el.querySelector("button.vs-link")).toBeNull();
  });

  it("renders the door's honest dormant sentence VERBATIM when hosting isn't switched on", async () => {
    const answer: HostingPrepared = { state: "disabled", message: "Hosting isn't switched on yet. Nothing was changed." };
    prep.mockResolvedValueOnce(answer);
    const el = host();
    act(() => root!.render(<DomainGuidanceCard tenantSlug="acme-coaching" pageId="33333333-3333-4333-8333-333333333333" />));
    open(el);
    const btn = el.querySelector("button.vs-link") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await act(async () => { btn.click(); });
    const line = el.querySelector("[data-hosting-state]") as HTMLElement;
    expect(line.getAttribute("data-hosting-state")).toBe("disabled");
    expect(line.textContent).toBe("Hosting isn't switched on yet. Nothing was changed.");
    expect(prep).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  it("when the door has a proposal (post-activation), points at the approval review — never claims live", async () => {
    prep.mockResolvedValueOnce({ state: "ready", message: "Put a hosted copy of this page online.", fingerprint: "fp-1", summary: "Put a hosted copy of “Spring offer” at https://acme-spring-offer.paigeagent.workers.dev.", address: "https://acme-spring-offer.paigeagent.workers.dev" });
    const el = host();
    act(() => root!.render(<DomainGuidanceCard tenantSlug="acme-coaching" pageId="33333333-3333-4333-8333-333333333333" />));
    open(el);
    const btn = el.querySelector("button.vs-link") as HTMLButtonElement;
    await act(async () => { btn.click(); });
    const line = el.querySelector("[data-hosting-state]") as HTMLElement;
    expect(line.getAttribute("data-hosting-state")).toBe("ready");
    expect(line.textContent).toContain("review it in your approvals");
    expect(line.textContent).not.toMatch(/is live|went live/i);
  });

  it("a transport failure says the check failed — nothing was changed, never a promise", async () => {
    prep.mockRejectedValueOnce(new Error("Hosting couldn't be checked just now. Nothing was changed. Try again."));
    const el = host();
    act(() => root!.render(<DomainGuidanceCard tenantSlug="acme-coaching" pageId="33333333-3333-4333-8333-333333333333" />));
    open(el);
    const btn = el.querySelector("button.vs-link") as HTMLButtonElement;
    await act(async () => { btn.click(); });
    const line = el.querySelector("[data-hosting-state]") as HTMLElement;
    expect(line.textContent).toContain("couldn't be checked");
  });
});
