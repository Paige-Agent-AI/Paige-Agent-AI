// The Edit contact dialog's Email and Phone fields are the contact's PRIMARY addresses, which live
// in its contact methods. Saving a changed one sets that primary (every other address stays) through
// the contact-methods seam; the contact-row update never carries an address column.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setContactPrimaryAddresses: vi.fn(),
  updateContact: vi.fn(),
}));

vi.mock("@/lib/contacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contacts")>()),
  setContactPrimaryAddresses: mocks.setContactPrimaryAddresses,
  updateContact: mocks.updateContact,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { EditContactDialog } = await import("./EditContactDialog");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, kind: "email" | "phone", value: string, is_primary: boolean, position: number) =>
  ({ id, kind, value, label: null, is_primary, position });
// What the page read: two emails, two phones.
const LOADED = [
  row("e1", "email", "jordan@reyesbuild.co", true, 0),
  row("e2", "email", "jordan.home@fastmail.com", false, 1),
  row("p1", "phone", "+1 (512) 555-0148", true, 0),
  row("p2", "phone", "+1 (512) 555-0190", false, 1),
];

const contact = {
  id: "c1", tenant_id: "tenant-a", first_name: "Jordan", last_name: "Reyes",
  email: "jordan@reyesbuild.co", phone: "+1 (512) 555-0148", client_contact_methods: LOADED,
  entity_name: null, title: null, funding_goal: null, lifecycle_stage: "new_lead", source: "manual",
  tags: [], do_not_contact: false, current_notes: null, assigned_coach_user_id: null,
};

let host: HTMLDivElement;
let root: Root;
const onSaved = vi.fn();

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const field = (inputType: string) => document.querySelector(`input[type="${inputType}"]`) as HTMLInputElement;
const phoneField = () => {
  const label = [...document.querySelectorAll("label")].find((l) => l.textContent === "Phone");
  return label?.parentElement?.querySelector("input") as HTMLInputElement;
};
async function save() {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save changes") as HTMLButtonElement;
  await act(async () => { button.click(); });
  await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
}

beforeEach(async () => {
  mocks.setContactPrimaryAddresses.mockReset().mockResolvedValue(LOADED);
  mocks.updateContact.mockReset().mockResolvedValue({ id: "c1" });
  onSaved.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<EditContactDialog open onOpenChange={() => {}} contact={contact} coaches={[]} onSaved={onSaved} />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Edit contact — the Email and Phone fields", () => {
  it("a changed email sets the contact's primary email; the row update carries no address", async () => {
    const stored = [row("e1", "email", "new@reyesbuild.co", true, 0), ...LOADED.slice(1)];
    mocks.setContactPrimaryAddresses.mockResolvedValue(stored);
    await act(async () => type(field("email"), "  new@reyesbuild.co "));
    await save();

    // The write builds on, and names, the list this page loaded — in the contact's own workspace.
    expect(mocks.setContactPrimaryAddresses).toHaveBeenCalledWith("c1", { email: "new@reyesbuild.co" }, { tenantId: "tenant-a", loaded: LOADED });
    const [, patch] = mocks.updateContact.mock.calls[0];
    expect(patch).not.toHaveProperty("email");
    expect(patch).not.toHaveProperty("phone");
    expect(patch).toMatchObject({ first_name: "Jordan", last_name: "Reyes" });
    // The address is written before the rest of the record.
    expect(mocks.setContactPrimaryAddresses.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateContact.mock.invocationCallOrder[0]);
    // The page now holds the list as stored, so its next save names the right list.
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ email: "new@reyesbuild.co", phone: "+1 (512) 555-0148", client_contact_methods: stored }));
  });

  it("clearing the phone clears the primary phone only, and the page shows the phone that took its place", async () => {
    const stored = [LOADED[0], LOADED[1], row("p2", "phone", "+1 (512) 555-0190", true, 0)];
    mocks.setContactPrimaryAddresses.mockResolvedValue(stored);
    await act(async () => type(phoneField(), ""));
    await save();
    expect(mocks.setContactPrimaryAddresses).toHaveBeenCalledWith("c1", { phone: null }, { tenantId: "tenant-a", loaded: LOADED });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ phone: "+1 (512) 555-0190" }));
  });

  it("an unchanged email and phone write no addresses at all", async () => {
    await save();
    expect(mocks.setContactPrimaryAddresses).not.toHaveBeenCalled();
    expect(mocks.updateContact).toHaveBeenCalledTimes(1);
  });

  it("a refused address stops the save before the record changes", async () => {
    mocks.setContactPrimaryAddresses.mockRejectedValue(new Error("CONTACT_METHOD_TAKEN: new@reyesbuild.co already belongs to another contact"));
    await act(async () => type(field("email"), "new@reyesbuild.co"));
    await save();
    expect(mocks.updateContact).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
