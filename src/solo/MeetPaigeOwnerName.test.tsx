import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const ownerProfile = vi.hoisted(() => ({ name: null as string | null, save: vi.fn() }));
vi.mock("./data/useSoloOwner", () => ({
  useSoloOwner: () => ({
    loading: false,
    error: null,
    saving: false,
    owner: { name: "阿美" },
    savedName: ownerProfile.name,
    saveOwner: ownerProfile.save,
  }),
}));

import { MEET_PAIGE_NAME_QUESTION, MeetPaigeOwnerName } from "./MeetPaigeOwnerName";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("confirms the owner’s name only after the existing profile reader returns it", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  document.body.append(host);
  ownerProfile.name = null;
  ownerProfile.save.mockResolvedValue({ ok: true });
  try {
    await act(async () => root.render(<MeetPaigeOwnerName />));
    const field = host.querySelector("input")!;
    expect(host.querySelector("label")?.textContent).toBe(MEET_PAIGE_NAME_QUESTION);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "  阿美  ");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(ownerProfile.save).toHaveBeenCalledWith({ full_name: "阿美" });
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("couldn’t confirm");
    ownerProfile.name = "阿美";
    await act(async () => root.render(<MeetPaigeOwnerName />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("I’ll call you 阿美.");
    expect(host.querySelector("form")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    ownerProfile.save.mockReset();
    ownerProfile.name = null;
  }
});
