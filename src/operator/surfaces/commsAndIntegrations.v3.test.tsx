import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ComposeOutbound, { CHANNELS } from "./ComposeOutbound";
import IntegrationsSurface, { INTEGRATIONS, INT_KINDS, PLATFORM_SHELF, TYPE_TABS } from "./IntegrationsSurface";

/**
 * The failure these assertions exist to stop is the one this console has already shipped twice:
 * a surface that typechecks, lints, resolves a route and renders NOTHING a human can read.
 * Counting exports proves the module is addressed; only rendered CONTENT proves the port.
 *
 * The Integrations surface was redesigned under the owner's explicit 2026-11-05 approval
 * (mockup po-integrations-redesign.html — "Yes this is perfect"): type sub-tabs with Social
 * first, honest state chips (Live / Needs attention / Not switched on / Locked · consult CSM),
 * the platform's own hosting shelf, and the WHITE-LABEL rule — the social provider behind the
 * platform's channels is never named in the UI. The pack's drawn Directory surface (bands,
 * kinds, search, foot) ports whole inside the Directory tab, so its copy stays asserted here.
 */

describe("Integrations — owner-approved type-tab redesign (mockup po-integrations-redesign)", () => {
  it("opens on Social with the live platform channel home and never names the social provider", () => {
    const html = renderToStaticMarkup(<IntegrationsSurface />);
    for (const t of TYPE_TABS) expect(html, `missing tab: ${t}`).toContain(t.replace(/&/g, "&amp;"));
    expect(html).toContain("Company channels");
    expect(html).toContain("Which workspaces may use which company channels");
    expect(html).toContain("Channels connected in the platform hub");
    expect(html).toContain("a connection grants reach, never authority");
    // WHITE-LABEL (owner 2026-11-05): the provider behind the channels gets no surface branding.
    expect(html).not.toMatch(/zernio/i);
  });

  it("carries every catalogue vendor into the Directory with the pack's drawn surface whole", () => {
    const html = renderToStaticMarkup(<IntegrationsSurface initialTab="Directory" />);
    const every = [...INTEGRATIONS, PLATFORM_SHELF];
    const total = every.reduce((n, sh) => n + sh.items.length, 0);
    expect(html).toContain(`Search ${total} integrations`);
    for (const sh of every) {
      expect(html, `missing shelf: ${sh.cat}`).toContain(sh.cat);
      for (const it of sh.items) {
        // `renderToStaticMarkup` escapes `&`, so compare against the escaped form.
        expect(html, `missing vendor: ${it.name}`).toContain(it.name.replace(/&/g, "&amp;"));
      }
    }
    for (const s of [
      "State",
      "Consequence",
      "Implemented adapters",
      "Catalogue readiness; access unverified",
      "Blocking",
      "A built surface is dark",
      "Nice to have",
      "Blocks nothing we built",
    ]) {
      expect(html, `missing band copy: ${s}`).toContain(s);
    }
    for (const k of Object.keys(INT_KINDS)) expect(html, `missing kind: ${k}`).toContain(k);
    expect(html).toContain("Blocking is the one that ranks the list");
  });

  it("renders the typed tabs with honest state chips and the platform's own hosting shelf", () => {
    const payments = renderToStaticMarkup(<IntegrationsSurface initialTab="Payments" />);
    expect(payments).toContain("Stripe");
    expect(payments).toContain("Not switched on");
    const web = renderToStaticMarkup(<IntegrationsSurface initialTab="Web & Hosting" />);
    for (const host of ["Vercel", "Cloudflare", "Supabase"]) expect(web, `missing host: ${host}`).toContain(host);
    expect(web.match(/>Live</g) ?? []).toHaveLength(3);
    const auto = renderToStaticMarkup(<IntegrationsSurface initialTab="Automations" />);
    expect(auto).toContain("HighLevel");
    expect(auto).toContain("Locked · consult CSM");
  });

  it("keeps the live-read override and says what is there when a typed tab matches nothing", () => {
    const html = renderToStaticMarkup(<IntegrationsSurface initialTab="Directory" connectionStates={{ Stripe: "live" }} />);
    // Stripe is `planned` in the catalogue and carries a `blocks` line; a live read retires it.
    expect(html).not.toContain("Dark without it: tenant subscription billing");
    expect(html).toContain("1 reported connected");
    expect(html).toContain("catalogue-only implemented");
    const empty = renderToStaticMarkup(<IntegrationsSurface shelves={[]} initialTab="Payments" />);
    expect(empty).toContain("Nothing sits under Payments yet.");
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
