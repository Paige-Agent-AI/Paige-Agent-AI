// INT-345 K-3 — the calling-setup card renders the FOUR facts as four facts, offers
// the governed one-click setup exactly when the account is not configured, and never
// offers a step the state cannot perform (no buy button here — buying lives in the
// search below; the primary is the owner's "Send from this" choice).
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { CallingSetupCard } from "./CallingSetupCard";
import type { CommsReadiness } from "./settings";

const base = (calling: CommsReadiness["calling"]): Parameters<typeof CallingSetupCard>[0] => ({
  calling,
  settingUp: false,
  note: null,
  canManage: true,
  onRun: vi.fn(),
});

let host: HTMLDivElement;
let root: Root;
const render = async (props: Parameters<typeof CallingSetupCard>[0]) => {
  await act(async () => {
    root.render(<CallingSetupCard {...props} />);
  });
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("CallingSetupCard (INT-345 K-3)", () => {
  it("renders nothing while the resolver is still loading", async () => {
    render(base(undefined));
    expect(host.textContent).toBe("");
  });

  it("absent account: shows the Set up calling button and all four stages open", async () => {
    const props = base({ ready: false, code: "calling_not_configured", reason_code: null, account: "absent", number_assigned: false, primary_selected: false, primary_e164: null, twiml_app: "absent" });
    await render(props);
    const stages = host.querySelectorAll(".ss-a2p-stage");
    expect(stages).toHaveLength(4);
    expect(host.textContent).toContain("Calling account");
    expect(host.textContent).toContain("Set up calling");
    expect(host.textContent).not.toContain("Calling READY ✓");
  });

  it("configured account, no number yet: no setup button — the next step is buying a number", async () => {
    const props = base({ ready: false, code: "calling_number_needs_verification", reason_code: "no_active_primary_number", account: "configured", number_assigned: false, primary_selected: false, primary_e164: null, twiml_app: "configured" });
    await render(props);
    expect(host.textContent).not.toContain("Set up calling");
    expect(host.textContent).not.toContain("Finish calling setup");
  });

  it("incomplete account: offers Finish calling setup", async () => {
    const props = base({ ready: false, code: "calling_not_configured", reason_code: null, account: "incomplete", number_assigned: false, primary_selected: false, primary_e164: null, twiml_app: "pending" });
    await render(props);
    expect(host.textContent).toContain("Finish calling setup");
  });

  it("READY: all four stages complete", async () => {
    const props = base({ ready: true, code: "calling_ready", reason_code: null, account: "configured", number_assigned: true, primary_selected: true, primary_e164: "+15550000001", twiml_app: "configured" });
    await render(props);
    const done = host.querySelectorAll(".ss-a2p-stage span[aria-hidden]");
    expect(done.length).toBe(4); // non-vacuous: an empty render cannot pass this
    expect([...done].every((s) => s.textContent === "✓")).toBe(true);
    expect(host.textContent).not.toContain("Set up calling");
  });

  it("the button calls the governed run handler and is disabled while running", async () => {
    const onRun = vi.fn();
    const props = { ...base({ ready: false, code: "calling_not_configured", reason_code: null, account: "absent", number_assigned: false, primary_selected: false, primary_e164: null, twiml_app: "absent" }), onRun };
    await render({ ...props, settingUp: true });
    const btn = host.querySelector("button");
    expect(btn?.textContent).toContain("Connecting calling…");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await render(props);
    const btn2 = host.querySelector("button") as HTMLButtonElement;
    act(() => { btn2.click(); });
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("a member (canManage false) sees the stages but never the setup button", async () => {
    const props = { ...base({ ready: false, code: "calling_not_configured", reason_code: null, account: "absent", number_assigned: false, primary_selected: false, primary_e164: null, twiml_app: "absent" }), canManage: false };
    await render(props);
    expect(host.textContent).toContain("Calling account");
    expect(host.textContent).not.toContain("Set up calling");
  });
});
