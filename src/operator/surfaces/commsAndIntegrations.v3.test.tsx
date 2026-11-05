import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ComposeOutbound, { CHANNELS } from "./ComposeOutbound";
import IntegrationsSurface from "./IntegrationsSurface";
import { SOCIAL_PLATFORMS } from "../../solo/social-platform-catalog";

/**
 * The failure these assertions exist to stop is the one this console has already shipped twice:
 * a surface that typechecks, lints, resolves a route and renders NOTHING a human can read.
 * Counting exports proves the module is addressed; only rendered CONTENT proves the port.
 *
 * The Integrations surface is the SOLO SHELL page carrying the platform's own connections
 * (owner ruling 2026-11-05, mockup po-integrations-solo-shell.html: "make the Platform
 * Operator account Integrations look just like the Solo Shell account"): the Solo page's
 * count chips, section headings with their one-line descriptions, and brand-tile cards —
 * the SAME fixed options every Solo account sees. The per-workspace grants matrix is
 * deleted, not hidden ("There should be no reason that I need to approve any of the Solo
 * account"), and the social provider behind the platform's channels is never named.
 *
 * renderToStaticMarkup runs no effects, so the Social door is still reading on first
 * paint: cards assert nothing ("Checking connection…") — which is itself the doctrine
 * under test.
 */

describe("Integrations — the Solo Shell layout carrying the platform's own connections", () => {
  const html = renderToStaticMarkup(<IntegrationsSurface />);

  it("opens as the Solo page: one Integrations tab, count chips that agree with the wall below", () => {
    expect(html).toContain("Integrations");
    // The chip ladder and its counts are computed from the same tiles the wall renders.
    for (const [label, count] of [
      ["All", "22"], ["Automation", "2"], ["Team chat", "2"], ["Social", "11"],
      ["Finance", "4"], ["Documents", "1"], ["Client data", "1"], ["Developer", "1"],
    ] as const) {
      expect(html, `missing chip: ${label}`).toContain(`>${label}<em>${count}</em>`);
    }
  });

  it("carries the same fixed options every Solo account sees, in the Solo group vocabulary", () => {
    for (const platform of SOCIAL_PLATFORMS) {
      expect(html, `missing social card: ${platform.name}`).toContain(platform.name);
    }
    for (const row of [
      "n8n", "Zapier", "Slack", "Microsoft Teams", "Stripe Connect", "PayPal",
      "QuickBooks", "Plaid", "DocuSign", "Apollo", "Webhooks &amp; direct API",
    ]) {
      expect(html, `missing provider card: ${row}`).toContain(row);
    }
    for (const blurb of [
      "Run workflows and reach other apps.",
      "Workplace chat and channels.",
      "Post, schedule and read.",
      "Invoices, payments and books.",
      "Send, sign and track.",
      "Find and enrich contacts.",
      "Wire it up yourself.",
    ]) {
      expect(html, `missing group blurb: ${blurb}`).toContain(blurb);
    }
  });

  it("states the platform-only truth on the Social section and honest states on every card", () => {
    expect(html).toContain("These connections belong to the platform itself.");
    expect(html).toContain("every account in Paige gets the same fixed options");
    // First paint: the door is still reading, so cards assert nothing…
    expect((html.match(/Checking connection…/g) ?? []).length).toBe(10);
    // …except the one platform whose OAuth is provider-side unavailable, pinned by the catalogue.
    expect(html).toContain("OAuth unavailable");
    // No platform-level seam exists behind the non-social providers yet — said plainly.
    expect((html.match(/>Not available</g) ?? []).length).toBe(11);
  });

  it("has no approvals apparatus and no retired chrome anywhere on the page", () => {
    expect(html).not.toContain("Which workspaces may use which company channels");
    expect(html).not.toContain("Grant");
    expect(html).not.toContain("Revoke");
    expect(html).not.toContain("Company channels");
    expect(html).not.toContain("Load channels");
    expect(html).not.toContain("Load workspaces");
    expect(html).not.toContain("Social hub");
    expect(html).not.toContain("Browse directory");
    // The six typed tabs of the superseded redesign are gone with it.
    expect(html).not.toContain("Email &amp; Messaging");
    expect(html).not.toContain("Web &amp; Hosting");
    // WHITE-LABEL (owner, 2026-11-05): the provider behind the channels gets no surface branding.
    expect(html).not.toMatch(/zernio/i);
  });
});

describe("Compose, outbound — pack L823–L878 / L5241–L5470", () => {
  it("draws the composer with the pack's Live hint and no warning line", () => {
    const html = renderToStaticMarkup(<ComposeOutbound sendAs="Email" />);
    expect(html).toContain("Write a message");
    expect(html).toContain("Write, or let her draft it");
    expect(html).toContain("Send");
    expect(html).not.toContain("nothing will send");
  });

  it("swaps the hint and raises the warning on a channel with no substrate", () => {
    const html = renderToStaticMarkup(<ComposeOutbound sendAs="Voice" />);
    expect(html).toContain("She can compose — no substrate");
    expect(html).toContain("nothing will send");
  });

  it("draws no draft line without a draft, and the pack's label with one", () => {
    expect(renderToStaticMarkup(<ComposeOutbound sendAs="Email" />)).not.toContain("She drafted");
    const withDraft = renderToStaticMarkup(<ComposeOutbound sendAs="Email" draft="A drafted line." />);
    expect(withDraft).toContain("She drafted");
    expect(withDraft).toContain("A drafted line.");
    // Pack L5347 — the label changes only when the pane is wide enough to keep both acts.
    expect(withDraft).toContain("Send her draft");
  });

  it("drops Save draft and shortens the act on a tight pane", () => {
    const html = renderToStaticMarkup(<ComposeOutbound sendAs="Email" draft="A drafted line." tight />);
    expect(html).not.toContain("Save draft");
    expect(html).not.toContain("Send her draft");
    expect(html).toContain(">Send<");
  });

  it("disables every control that has no seam behind it rather than faking one", () => {
    const html = renderToStaticMarkup(<ComposeOutbound sendAs="Email" />);
    // Send, Save draft, the three tools and Snippets — six disabled controls with nothing wired.
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(6);
  });

  it("carries all five channels into the send-as list once a handler exists", () => {
    // The popover is closed on first paint (pack: `chanOpen` starts false), so the contract
    // asserted here is the catalogue the trigger opens over.
    expect(CHANNELS.map((c) => c.key)).toEqual(["Email", "SMS", "Voice", "WhatsApp", "DM"]);
    const html = renderToStaticMarkup(<ComposeOutbound sendAs="DM" network="LinkedIn" />);
    // Pack L5443 — a DM shows the network it arrived on, not the generic channel word.
    expect(html).toContain("LinkedIn");
  });
});
