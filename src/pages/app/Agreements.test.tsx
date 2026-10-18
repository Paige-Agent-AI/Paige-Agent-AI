import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Agreements from "./Agreements";
import { openFailureCopy, signNoteCopy, type AgreementCopy } from "@/lib/portal/agreementsCopy";
import type { ClientPortalBrandState } from "@/hooks/useClientPortalBrand";
import type { ClientPortalAgreementsState, OpenAgreementFailure, PortalAgreement } from "@/hooks/useClientPortalAgreements";

// Synthetic test tenant (Northwind Studio); never a real account.
const T = "e0923000-0000-4000-8000-000000000002";
const f = vi.hoisted(() => ({
  state: null as unknown as ClientPortalAgreementsState,
  open: vi.fn(),
  fetchCopy: vi.fn(),
  goTo: vi.fn(),
  brand: null as unknown as ClientPortalBrandState,
}));
vi.mock("@/hooks/useClientPortalAgreements", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useClientPortalAgreements")>()),
  useClientPortalAgreements: () => f.state,
  openAgreementForSigning: (...a: unknown[]) => f.open(...a),
  fetchSignedCopy: (...a: unknown[]) => f.fetchCopy(...a),
  goToSigningPage: (...a: unknown[]) => f.goTo(...a),
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({
  useClientPortalBrandState: () => f.brand,
}));
const CUSTOMER_BRAND: ClientPortalBrandState = {
  brand: { tenant_id: T, tenant_name: "Northwind Studio", primary_color: null, logo_url: null }, loading: false, error: false, multipleBusinesses: false,
};
vi.mock("@/pages/MyAgreements", () => ({ default: () => <p data-testid="platform-terms-page">Your PaigeAgent agreements</p> }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Any wording that tells the customer to go and use the emailed link, as if it certainly still works. */
const EMAIL_PROMISE = /use the link|from the link|link .* emailed you to sign|Sign each agreement from the link/i;
/** What the copy reads as on screen: the words, then the inline Messages link when it finishes the sentence. */
const spoken = (c: AgreementCopy) => (c.ask === "inline" ? `${c.text} ask Northwind Studio for a new link.` : c.text);

let n = 0;
const ag = (extra: Partial<PortalAgreement> = {}): PortalAgreement => ({
  id: `e0923000-0000-4000-9000-${String(++n).padStart(12, "0")}`, title: `Agreement ${n}`, engagement_title: null,
  state: "awaiting_you", sent_at: "2026-10-10T12:00:00Z", completed_at: null, expires_at: "2026-11-02T12:00:00Z",
  can_sign: true, can_download: false, sign_note: null, ...extra,
});
const withList = (agreements: PortalAgreement[], extra: Partial<ClientPortalAgreementsState> = {}) => {
  f.state = {
    ...f.state, agreements, loading: false,
    summary: { awaiting_you: agreements.filter((a) => a.state === "awaiting_you").length, signed: agreements.filter((a) => a.state === "signed").length },
    ...extra,
  };
};

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
let root: Root, host: HTMLDivElement;
const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/app/agreements"]}>
      <Routes>
        <Route path="/app/agreements" element={<Agreements />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  ));
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
};
const rows = () => Array.from(host.querySelectorAll<HTMLElement>("[data-testid=agreement-row]"));
const rowOf = (title: string) => rows().find((r) => r.querySelector("h3")?.textContent === title)!;
const buttons = (scope: ParentNode, name: RegExp) => Array.from(scope.querySelectorAll("button")).filter((b) => name.test(b.textContent ?? ""));
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); for (let i = 0; i < 6; i++) await Promise.resolve(); });

beforeEach(() => {
  vi.clearAllMocks();
  n = 0;
  f.state = {
    agreements: [], summary: null, businessName: "Northwind Studio", hasMore: false, serverNow: "2026-10-18T12:00:00Z",
    loading: false, error: null, unavailable: false, customerConfirmed: true, multipleBusinesses: false, tenantId: T, scopeEpoch: 0,
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  f.brand = CUSTOMER_BRAND;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("who sees what", () => {
  it("shows anyone who is not a customer of a business the platform terms page, unchanged (§58)", async () => {
    f.state = { ...f.state, unavailable: true, summary: null, businessName: null, tenantId: null };
    await render();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(host.querySelector("[data-testid=platform-terms-page]")).not.toBeNull();
    expect(host.querySelector("#agreements-title")).toBeNull();
  });

  it("keeps the platform terms page for staff when the customer read fails or the function is missing (§58)", async () => {
    // Nothing says this login is a customer: the read failed before any list came back, and the brand resolver
    // does not know them as one (staff, or a login with no relationship).
    for (const brand of [
      { brand: null, loading: false, error: false, multipleBusinesses: false },
      { brand: null, loading: false, error: true, multipleBusinesses: false },
    ]) {
      act(() => root.unmount()); root = createRoot(host);
      f.state = { ...f.state, customerConfirmed: false, summary: null, tenantId: null, error: "We couldn't load your agreements. Check your connection and try again." };
      f.brand = brand;
      await render();
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(host.querySelector("[data-testid=platform-terms-page]"), JSON.stringify(brand)).not.toBeNull();
      expect(host.textContent).not.toContain("couldn't load your agreements");
      expect(host.querySelector("#agreements-title")).toBeNull();
    }
  });

  it("shows the customer 'couldn't load' card only to a login the brand resolver knows as a customer", async () => {
    f.state = { ...f.state, customerConfirmed: false, summary: null, error: "We couldn't load your agreements. Check your connection and try again." };
    await render();
    expect(host.querySelector("[data-testid=platform-terms-page]")).toBeNull();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("couldn't load your agreements");
    // While the brand is still resolving, neither page: just the shape of a list.
    act(() => root.unmount()); root = createRoot(host);
    f.brand = { brand: null, loading: true, error: false, multipleBusinesses: false };
    await render();
    expect(host.querySelector("[data-testid=agreements-skeleton]")).not.toBeNull();
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(host.querySelector("[data-testid=platform-terms-page]")).toBeNull();
  });

  it("shows no customer header or footer before the login is known to be a customer", async () => {
    f.state = { ...f.state, customerConfirmed: false, summary: null, loading: true };
    await render();
    expect(host.querySelector("[data-testid=agreements-skeleton]")).not.toBeNull();
    expect(host.querySelector("#agreements-title")).toBeNull();
    expect(host.querySelector("[data-testid=platform-terms-link]")).toBeNull();
  });

  it("titles a customer's page by their business and links their platform terms, always", async () => {
    withList([ag({ title: "Website build agreement" })]);
    await render();
    expect(host.querySelector("h1")?.textContent).toBe("Agreements with Northwind Studio");
    const terms = host.querySelector<HTMLAnchorElement>("[data-testid=platform-terms-link]")!;
    expect(terms.textContent).toBe(" PaigeAgent terms you've accepted");
    expect(terms.getAttribute("href")).toBe("/app/agreements/platform");
    for (const extra of [{ agreements: [] as PortalAgreement[] }, { multipleBusinesses: true, summary: null }, { error: "We couldn't load your agreements.", summary: null }]) {
      act(() => root.unmount()); root = createRoot(host);
      f.state = { ...f.state, ...extra };
      await render();
      expect(host.querySelector("[data-testid=platform-terms-link]"), JSON.stringify(extra)).not.toBeNull();
    }
  });
});

describe("the list", () => {
  it("puts what waits for you first, then everything else, each with where it stands", async () => {
    withList([
      ag({ title: "Website build agreement", engagement_title: "Website build" }),
      ag({ title: "Brand retainer", state: "signed", can_sign: false, can_download: true, completed_at: "2026-10-12T12:00:00Z" }),
      ag({ title: "Photo release", state: "awaiting_business", can_sign: false }),
      ag({ title: "NDA", state: "awaiting_others", can_sign: false }),
      ag({ title: "Old proposal", state: "declined", can_sign: false }),
      ag({ title: "Pilot terms", state: "expired", can_sign: false, expires_at: "2026-10-01T12:00:00Z" }),
      ag({ title: "Draft retainer", state: "withdrawn", can_sign: false }),
    ]);
    await render();
    const waiting = host.querySelector("section[aria-labelledby=agreements-waiting]")!;
    const rest = host.querySelector("section[aria-labelledby=agreements-rest]")!;
    expect(waiting.querySelector("h2")?.textContent).toBe("Waiting for you");
    expect(rest.querySelector("h2")?.textContent).toBe("Everything else");
    expect(Array.from(waiting.querySelectorAll("h3")).map((h) => h.textContent)).toEqual(["Website build agreement"]);
    expect(Array.from(rest.querySelectorAll("[data-testid=agreement-state]")).map((p) => p.textContent)).toEqual([
      "Signed", "Waiting for Northwind Studio", "Waiting for others", "Declined", "Expired", "Withdrawn",
    ]);
    expect(rowOf("Website build agreement").querySelector("[data-testid=engagement-title]")?.textContent).toBe("For Website build");
    // The heading says "Waiting for you" once; its rows do not repeat it.
    expect(waiting.querySelectorAll("[data-testid=agreement-state], [data-testid=state-inline]")).toHaveLength(0);
    expect(host.querySelector("[data-testid=agreements-summary]")?.textContent).toBe("1 waiting for your signature");
    // Never a body, a signer, an amount or a storage address: the page holds only what the row carries.
    expect(host.textContent).not.toMatch(/\$|@|storage|sha256|token/i);
  });

  it("titles the only group 'Your agreements' when nothing is waiting", async () => {
    withList([ag({ title: "Brand retainer", state: "signed", can_sign: false, can_download: true })]);
    await render();
    expect(host.querySelector("section[aria-labelledby=agreements-waiting]")).toBeNull();
    expect(host.querySelector("section[aria-labelledby=agreements-rest] h2")?.textContent).toBe("Your agreements");
    expect(host.querySelector("[data-testid=agreements-summary]")?.textContent).toBe("Nothing is waiting for your signature.");
  });

  it("says plainly when the business has sent nothing", async () => {
    withList([]);
    await render();
    expect(host.textContent).toContain("Northwind Studio hasn't sent you any agreements");
    expect(rows()).toHaveLength(0);
  });

  it("says when the account is linked to several businesses, and when the list is still loading", async () => {
    f.state = { ...f.state, multipleBusinesses: true };
    await render();
    expect(host.textContent).toContain("Agreements for more than one business aren't available here yet");
    act(() => root.unmount()); root = createRoot(host);
    f.state = { ...f.state, multipleBusinesses: false, loading: true };
    await render();
    expect(host.querySelector("[data-testid=agreements-skeleton]")).not.toBeNull();
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
    // Several businesses: no business is named, and no link is promised to work.
    expect(EMAIL_PROMISE.test(host.textContent ?? "")).toBe(false);
  });

  it("keeps the list and offers Try again when a refresh fails", async () => {
    withList([ag({ title: "Website build agreement" })], { error: "We couldn't refresh this list, so it may be out of date." });
    await render();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("may be out of date");
    expect(rows()).toHaveLength(1);
    await click(buttons(host, /Try again/)[0]);
    expect(f.state.refresh).toHaveBeenCalled();
  });
});

describe("Review and sign", () => {
  it("is offered only when the server says the customer can sign, and only the first one is gold (§11)", async () => {
    withList([
      ag({ title: "First" }), ag({ title: "Second" }),
      ag({ title: "By email only", can_sign: false, sign_note: "use_email_link" }),
      ag({ title: "Done", state: "signed", can_sign: false }),
    ]);
    await render();
    expect(buttons(rowOf("First"), /Review and sign/)).toHaveLength(1);
    expect(buttons(rowOf("Second"), /Review and sign/)).toHaveLength(1);
    expect(buttons(rowOf("By email only"), /Review and sign/)).toHaveLength(0);
    expect(buttons(rowOf("Done"), /Review and sign/)).toHaveLength(0);
    expect(rowOf("By email only").querySelector("[data-testid=agreement-note]")?.textContent).toBe(
      "Northwind Studio sent this one's signing link by email. If you can't use it, ask Northwind Studio for a new link.");
    expect(rowOf("By email only").querySelector("[data-testid=ask-new-link-inline]")?.getAttribute("href")).toBe("/app/messages");
    const gold = Array.from(host.querySelectorAll("button, a")).filter((el) => /bg-gradient-gold/.test(el.className));
    expect(gold.map((g) => g.closest("[data-testid=agreement-row]")?.querySelector("h3")?.textContent)).toEqual(["First"]);
    // The customer is told, beside the act, that opening here retires the emailed link (D-A4).
    expect(host.querySelector("[data-testid=replaces-email-link]")?.textContent).toBe("Opening an agreement here replaces the signing link Northwind Studio emailed you.");
  });

  it("opens the existing signing page with the link the server issued", async () => {
    const a = ag({ title: "Website build agreement" });
    withList([a]);
    f.open.mockResolvedValue({ ok: true, token: "b".repeat(64), expiresAt: "2026-11-01T12:00:00Z" });
    await render();
    await click(buttons(host, /Review and sign/)[0]);
    expect(f.open).toHaveBeenCalledWith(a.id, T);
    expect(f.goTo).toHaveBeenCalledWith("b".repeat(64));
  });

  it("says why it could not open, in the customer's words, for every refusal", async () => {
    const codes: OpenAgreementFailure[] = ["NOT_SIGNABLE_HERE", "TRY_AGAIN_LATER", "NOT_SIGNABLE", "CLIENT_AGREEMENT_UNAVAILABLE", "MULTIPLE_BUSINESSES", "FAILED"];
    for (const code of codes) {
      act(() => root.unmount()); root = createRoot(host);
      withList([ag({ title: "Website build agreement" })]);
      f.open.mockResolvedValue({ ok: false, code });
      await render();
      await click(buttons(host, /Review and sign/)[0]);
      expect(host.querySelector("[data-testid=agreement-problem]")?.textContent?.trim(), code).toBe(spoken(openFailureCopy(code, "Northwind Studio")));
      expect(f.goTo).not.toHaveBeenCalled();
      expect(f.state.refresh).toHaveBeenCalledTimes(["NOT_SIGNABLE", "CLIENT_AGREEMENT_UNAVAILABLE", "NOT_SIGNABLE_HERE"].includes(code) ? 1 : 0);
      (f.state.refresh as ReturnType<typeof vi.fn>).mockClear();
    }
  });

  it("never sends the customer to a link that is dead: every refusal is true in every case it is returned", () => {
    for (const code of ["NOT_SIGNABLE_HERE", "TRY_AGAIN_LATER", "NOT_SIGNABLE", "CLIENT_AGREEMENT_UNAVAILABLE", "MULTIPLE_BUSINESSES", "FAILED"] as OpenAgreementFailure[]) {
      for (const note of ["use_email_link", "link_expired", "link_revoked", undefined] as const) {
        expect(EMAIL_PROMISE.test(spoken(openFailureCopy(code, "Northwind Studio", note))), `${code}/${note}`).toBe(false);
      }
    }
    // "Opened too many times": the first of those opens already replaced the emailed link (D-A4).
    expect(spoken(openFailureCopy("TRY_AGAIN_LATER", "Northwind Studio"))).toBe(
      "This agreement has been opened several times in the last hour. Try again in an hour, or ask Northwind Studio for a new link.");
    expect(spoken(openFailureCopy("NOT_SIGNABLE_HERE", "Northwind Studio", "link_expired"))).toBe("The signing link Northwind Studio emailed you has expired.");
    expect(spoken(openFailureCopy("NOT_SIGNABLE_HERE", "Northwind Studio", "link_revoked"))).toBe("The signing link Northwind Studio emailed you is no longer active.");
  });

  it("on 'opened too many times', links Messages and turns the gold button quiet until the list is re-read", async () => {
    const first = ag({ title: "Website build agreement" });
    withList([first, ag({ title: "Second" })]);
    f.open.mockResolvedValue({ ok: false, code: "TRY_AGAIN_LATER" });
    await render();
    const isGold = () => /bg-gradient-gold/.test(buttons(rowOf("Website build agreement"), /Review and sign/)[0].className);
    expect(isGold()).toBe(true);
    await click(buttons(rowOf("Website build agreement"), /Review and sign/)[0]);
    const problem = rowOf("Website build agreement").querySelector("[data-testid=agreement-problem]")!;
    expect(problem.querySelector("[data-testid=ask-new-link-inline]")?.getAttribute("href")).toBe("/app/messages");
    expect(isGold()).toBe(false);
    expect(host.querySelectorAll("[class*=bg-gradient-gold]")).toHaveLength(0);
    // The list is read again (focus, or a later press elsewhere): the row is a new object, and the act is gold again.
    withList([{ ...first }, ag({ title: "Second" })]);
    await render();
    expect(isGold()).toBe(true);
  });

  it("on a dead emailed link, offers the business a request for a new one instead", async () => {
    for (const note of ["link_expired", "link_revoked"] as const) {
      act(() => root.unmount()); root = createRoot(host);
      withList([ag({ title: "Website build agreement" })]);
      f.open.mockResolvedValue({ ok: false, code: "NOT_SIGNABLE_HERE", note });
      await render();
      await click(buttons(host, /Review and sign/)[0]);
      const r = rowOf("Website build agreement");
      expect(r.querySelector("[data-testid=agreement-problem]")?.textContent?.trim()).toBe(spoken(signNoteCopy(note, "Northwind Studio")));
      expect(f.state.refresh).toHaveBeenCalledTimes(1);
      (f.state.refresh as ReturnType<typeof vi.fn>).mockClear();
    }
  });
});

describe("under StrictMode (the app's dev mount)", () => {
  it("still shows the answer to a press after React's mount, unmount, mount", async () => {
    withList([ag({ title: "Website build agreement" })]);
    f.open.mockResolvedValue({ ok: false, code: "NOT_SIGNABLE_HERE", note: "link_expired" });
    await act(async () => root.render(
      <StrictMode>
        <MemoryRouter initialEntries={["/app/agreements"]}>
          <Routes><Route path="/app/agreements" element={<Agreements />} /></Routes>
        </MemoryRouter>
      </StrictMode>,
    ));
    await click(buttons(host, /Review and sign/)[0]);
    expect(host.querySelector("[data-testid=agreement-problem]")?.textContent?.trim()).toBe("The signing link Northwind Studio emailed you has expired.");
    expect(buttons(host, /Review and sign/)[0].disabled).toBe(false);
  });
});

describe("the signed copy", () => {
  it("downloads and opens only a signed agreement whose copy exists, through the portal door", async () => {
    const signed = ag({ title: "Brand retainer", state: "signed", can_sign: false, can_download: true });
    withList([signed, ag({ title: "Sealing", state: "signed", can_sign: false, can_download: false })]);
    await render();
    expect(buttons(rowOf("Sealing"), /Download|Open/)).toHaveLength(0);
    expect(rowOf("Sealing").querySelector("[data-testid=agreement-note]")?.textContent).toBe("The signed copy isn't ready to download yet.");

    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    f.fetchCopy.mockResolvedValue({ ok: true, blob });
    const createObjectURL = vi.fn(() => "blob:harness/1");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clicked: { href: string; download: string }[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });
    await click(buttons(rowOf("Brand retainer"), /Download signed copy/)[0]);
    expect(f.fetchCopy).toHaveBeenCalledWith(signed.id, T, true);
    expect(clicked).toEqual([{ href: "blob:harness/1", download: "Brand retainer (signed).pdf" }]);

    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    await click(buttons(rowOf("Brand retainer"), /^Open$/)[0]);
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(f.fetchCopy).toHaveBeenLastCalledWith(signed.id, T, false);
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe("blob:harness/1");
    spy.mockRestore(); open.mockRestore();
  });

  it("says so, and closes the tab it opened, when the copy cannot be fetched", async () => {
    withList([ag({ title: "Brand retainer", state: "signed", can_sign: false, can_download: true })]);
    f.fetchCopy.mockResolvedValue({ ok: false });
    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    await render();
    await click(buttons(host, /^Open$/)[0]);
    expect(tab.close).toHaveBeenCalled();
    expect(host.querySelector("[data-testid=agreement-problem]")?.textContent).toContain("couldn't get the signed copy");
    open.mockRestore();
  });
});

describe("other states", () => {
  it("asks the business for a new link on an expired agreement, in Messages (no suggested words until Messages reads them)", async () => {
    withList([ag({ title: "Pilot terms", state: "expired", can_sign: false })]);
    await render();
    const ask = host.querySelector<HTMLAnchorElement>("[data-testid=ask-new-link]")!;
    expect(ask.textContent?.trim()).toBe("Ask Northwind Studio for a new link");
    expect(ask.getAttribute("href")).toBe("/app/messages");
    await click(ask);
    expect(host.querySelector("[data-testid=where]")?.textContent).toBe("/app/messages");
  });

  it("a waiting row whose emailed link is dead says so, dates it, and offers a new link — never 'use the link'", async () => {
    withList([
      ag({ title: "Expired link", can_sign: false, sign_note: "link_expired", expires_at: "2026-10-16T12:00:00Z" }),
      ag({ title: "Revoked link", can_sign: false, sign_note: "link_revoked" }),
    ]);
    await render();
    expect(rowOf("Expired link").querySelector("[data-testid=agreement-note]")?.textContent).toBe("The signing link Northwind Studio emailed you has expired.");
    expect(rowOf("Expired link").textContent).toMatch(/Link expired/);
    expect(rowOf("Expired link").textContent).not.toMatch(/Sign by/);
    expect(rowOf("Revoked link").querySelector("[data-testid=agreement-note]")?.textContent).toBe("The signing link Northwind Studio emailed you is no longer active.");
    expect(rowOf("Revoked link").textContent).not.toMatch(/Sign by/);
    for (const t of ["Expired link", "Revoked link"]) {
      const ask = rowOf(t).querySelector<HTMLAnchorElement>("[data-testid=ask-new-link]")!;
      expect(ask.getAttribute("href")).toBe("/app/messages");
      expect(/bg-gradient-gold/.test(ask.className)).toBe(false);
    }
    expect(EMAIL_PROMISE.test(host.textContent ?? "")).toBe(false);
  });

  it("a signature the portal cannot prove is theirs is neither headed nor counted as theirs", async () => {
    withList([ag({ title: "Co-signed", state: "awaiting_signature", can_sign: false, sign_note: "use_email_link" })]);
    await render();
    expect(host.querySelector("section[aria-labelledby=agreements-waiting]")).toBeNull();
    expect(host.querySelector("section[aria-labelledby=agreements-rest] h2")?.textContent).toBe("Your agreements");
    expect(rowOf("Co-signed").querySelector("[data-testid=agreement-state]")?.textContent).toBe("Waiting for a signature");
    expect(host.querySelector("[data-testid=agreements-summary]")?.textContent).toBe("Nothing is waiting for your signature.");
    expect(rowOf("Co-signed").querySelector("[data-testid=agreement-note]")?.textContent).toBe(
      "Northwind Studio sent this one's signing link by email. If you can't use it, ask Northwind Studio for a new link.");
  });

  it("says who is left once the customer has signed: the business by name, or everyone else", async () => {
    withList([
      ag({ title: "Countersign", state: "awaiting_countersign", can_sign: false }),
      ag({ title: "Witnessed", state: "awaiting_others", can_sign: false }),
    ]);
    await render();
    expect(rowOf("Countersign").querySelector("[data-testid=agreement-state]")?.textContent).toBe("Waiting for Northwind Studio");
    expect(rowOf("Countersign").querySelector("[data-testid=agreement-note]")?.textContent).toBe("You've signed. It's complete once Northwind Studio signs.");
    expect(rowOf("Witnessed").querySelector("[data-testid=agreement-state]")?.textContent).toBe("Waiting for others");
  });

  it("says a withdrawn agreement has nothing to sign, and who signs first", async () => {
    withList([
      ag({ title: "Draft retainer", state: "withdrawn", can_sign: false }),
      ag({ title: "Photo release", state: "awaiting_business", can_sign: false }),
    ]);
    await render();
    expect(rowOf("Draft retainer").querySelector("[data-testid=agreement-note]")?.textContent).toBe("Northwind Studio withdrew this agreement. There's nothing to sign.");
    expect(rowOf("Photo release").querySelector("[data-testid=agreement-note]")?.textContent).toBe("Northwind Studio signs first. You'll be able to sign once they have.");
    expect(host.querySelectorAll("button").length).toBe(0);
  });
});
