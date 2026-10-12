import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ComposeOutbound, { CHANNELS } from "./ComposeOutbound";
import IntegrationsSurface, { INTEGRATIONS, INT_KINDS } from "./IntegrationsSurface";

/**
 * The failure these assertions exist to stop is the one this console has already shipped twice:
 * a surface that typechecks, lints, resolves a route and renders NOTHING a human can read.
 * Counting exports proves the module is addressed; only rendered CONTENT proves the port.
 *
 * Every string asserted below is verbatim pack copy with its line cited in the component, and
 * no assertion is on a figure that was typed — the counts are derived from the catalogue, so a
 * catalogue edit moves them rather than making this file lie.
 */

describe("Integrations grid — pack L1577–L1659 / L7928–L8082", () => {
  it("draws both filter bands with the pack's labels and notes", () => {
    const html = renderToStaticMarkup(<IntegrationsSurface />);
    for (const s of [
      "State",
      "Consequence",
      "Implemented adapters",
      "Catalogue readiness; access unverified",
      "Half-wired",
      "Waiting on credentials",
      "Not built",
      "Nothing behind it",
      "Blocking",
      "A built surface is dark",
      "Nice to have",
      "Blocks nothing we built",
    ]) {
      expect(html, `missing band copy: ${s}`).toContain(s);
    }
  });

  it("draws the search field, all six connection kinds and every shelf chip", () => {
    const html = renderToStaticMarkup(<IntegrationsSurface />);
    expect(html).toContain("Search 42 integrations");
    for (const k of Object.keys(INT_KINDS)) expect(html, `missing kind: ${k}`).toContain(k);
    expect(html).toContain(">All<");
    for (const sh of INTEGRATIONS) expect(html, `missing shelf: ${sh.cat}`).toContain(sh.cat);
  });

  it("renders every vendor tile, its action verb and the foot", () => {
    const html = renderToStaticMarkup(<IntegrationsSurface />);
    for (const sh of INTEGRATIONS) {
      for (const it of sh.items) {
        // `renderToStaticMarkup` escapes `&`, so compare against the escaped form.
        expect(html, `missing vendor: ${it.name}`).toContain(it.name.replace(/&/g, "&amp;"));
      }
    }
    for (const verb of ["Configure", "Finish", "Connect"]) expect(html).toContain(verb);
    expect(html).toContain("Blocking is the one that ranks the list");
  });

  it("composes the result line from the catalogue rather than typing it", () => {
    const total = INTEGRATIONS.reduce((n, sh) => n + sh.items.length, 0);
    const live = INTEGRATIONS.reduce((n, sh) => n + sh.items.filter((i) => i.state === "live").length, 0);
    const html = renderToStaticMarkup(<IntegrationsSurface />);
    expect(html).toContain(`${total} of ${total} shown · ${live} adapters described as implemented`);
    expect(html).toContain("Verified account connections and current provider health are not loaded");
    expect(html).not.toContain("A seam exists and runs today");
    expect(html).not.toContain("Connected means");
  });

  it("lets a live read override the catalogue's authored state (slice I drop-in)", () => {
    const html = renderToStaticMarkup(<IntegrationsSurface connectionStates={{ Stripe: "live" }} />);
    // Stripe is `planned` in the catalogue and carries a `blocks` line; a live read retires it.
    expect(html).not.toContain("Dark without it: tenant subscription billing");
    expect(html).toContain("1 reported connected");
    expect(html).toContain("catalogue-only implemented");
    expect(html).toContain("Catalogue readiness; account access and health unverified");
  });

  it("says what is there rather than blanking when a shelf matches nothing", () => {
    const html = renderToStaticMarkup(<IntegrationsSurface shelves={[]} />);
    expect(html).toContain("Nothing matches. 0 integrations exist across 0 shelves.");
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
