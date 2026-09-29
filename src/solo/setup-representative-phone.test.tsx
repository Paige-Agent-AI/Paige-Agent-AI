import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { e164Of } from "@/lib/contact-methods";
import { RepresentativePhonePicker } from "./setup-representative-phone";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[], eq: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({ select: () => ({ eq: async (column: string, value: string) => { mocks.eq(table, column, value); return { data: mocks.rows, error: null }; } }) }),
    rpc: vi.fn(),
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const phone = (id: string, value: string, is_primary: boolean, position: number, label: string | null = null) =>
  ({ id, user_id: "rep-1", kind: "phone", value, label, is_primary, position });

let host: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
async function mount(props: Partial<Parameters<typeof RepresentativePhonePicker>[0]> = {}) {
  await act(async () => {
    root.render(<MemoryRouter><RepresentativePhonePicker account="3855" userId="rep-1" personName="Dana Whitfield" value="" onChange={onChange} {...props} /></MemoryRouter>);
  });
  await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
}
const radios = () => [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];

beforeEach(() => {
  mocks.rows = []; mocks.eq.mockReset(); onChange.mockReset();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("the number carriers need", () => {
  it("removes formatting only, and never guesses a country code", () => {
    expect(e164Of("+1 (404) 555-0188")).toBe("+14045550188");
    expect(e164Of("+44 20 7946 0958")).toBe("+442079460958");
    expect(e164Of("(404) 555-0188")).toBeNull();
    expect(e164Of("+0 404 555")).toBeNull();
  });
});

describe("Setup → representative phone, picked from that person's own numbers", () => {
  it("asks for the representative first, and reads nobody's numbers until one is chosen", async () => {
    await mount({ userId: "" });
    expect(host.textContent).toContain("Choose the A2P authorized representative above");
    expect(mocks.eq).not.toHaveBeenCalled();
  });

  it("offers the representative's numbers, primary first, and stores the chosen one in E.164", async () => {
    mocks.rows = [phone("p2", "+1 404 555 0190", false, 1, "Work"), phone("p1", "+1 (404) 555-0188", true, 0, "Mobile")];
    await mount();
    expect(mocks.eq).toHaveBeenCalledWith("user_contact_methods", "user_id", "rep-1");
    expect(host.textContent).toContain("Picked from Dana's own numbers");
    expect(radios().map((r) => r.id)).toEqual(["setup-rep-phone-p1", "setup-rep-phone-p2"]);
    expect(host.textContent).toContain("Primary · Dana's main number");
    await act(async () => { radios()[1].click(); });
    expect(onChange).toHaveBeenCalledWith("+14045550190");
  });

  it("marks the stored number as chosen, whatever its formatting", async () => {
    mocks.rows = [phone("p1", "+1 (404) 555-0188", true, 0)];
    await mount({ value: "+14045550188" });
    expect(radios()[0].checked).toBe(true);
    expect(host.querySelector(".is-chosen .ctm-orb")).not.toBeNull();
  });

  it("shows a number without its country code but will not store it, and says where to fix it", async () => {
    mocks.rows = [phone("p1", "(404) 555-0188", true, 0)];
    await mount();
    expect(radios()[0].disabled).toBe(true);
    expect(host.textContent).toContain("Needs + and the country code. Update it under Team to use it.");
    await act(async () => { radios()[0].click(); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a number saved before this change visible and chosen, rather than silently dropping it", async () => {
    mocks.rows = [phone("p1", "+1 404 555 0188", true, 0)];
    await mount({ value: "+15125550100" });
    expect(host.textContent).toContain("Saved earlier · not one of Dana's numbers");
    expect(radios()[0].checked).toBe(true);
  });

  it("says so when the representative has no number, and points to Team", async () => {
    await mount();
    expect(host.textContent).toContain("Dana has no phone number yet. Add one under Team, then pick it here.");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/solo/3855/settings/team");
  });

  it("changes nothing while the value is held by a connection", async () => {
    mocks.rows = [phone("p1", "+1 404 555 0188", true, 0)];
    await mount({ locked: true });
    expect(radios().every((r) => r.disabled)).toBe(true);
  });
});
