import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { OperationsAssignee } from "./OperationsAssignee";

let container: HTMLDivElement;
let root: Root;
const images: Array<{ onload: ((event: unknown) => void) | null; onerror: (() => void) | null; src: string; complete: boolean; naturalWidth: number }> = [];
const member = { user_id: "test-user", full_name: "Sample Person", email: null,
  avatar_url: "https://images.invalid/profile.jpg" } as TeamMemberRecord;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  images.length = 0;
  vi.stubGlobal("Image", class {
    onload: ((event: unknown) => void) | null = null;
    onerror: (() => void) | null = null; src = ""; complete = false; naturalWidth = 0;
    constructor() { images.push(this); }
    addEventListener(event: string, handler: (event: unknown) => void) {
      if (event === "load") this.onload = handler;
      if (event === "error") this.onerror = () => handler(undefined);
    }
    removeEventListener(event: string) {
      if (event === "load") this.onload = null;
      if (event === "error") this.onerror = null;
    }
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("shows the canonical photo with the person's visible name after load", async () => {
  await act(async () => root.render(<OperationsAssignee member={member} />));
  await act(async () => { images[0].complete = true; images[0].naturalWidth = 80; images[0].onload?.({ currentTarget: images[0] }); });
  expect(container.querySelector("img")?.getAttribute("src")).toBe(member.avatar_url);
  expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  expect(container.querySelector(".ops-assignee-name")?.textContent).toBe("Sample Person");
});
it("uses initials on failure and resets the image when the member changes", async () => {
  await act(async () => root.render(<OperationsAssignee member={member} />));
  await act(async () => images[0].onerror?.());
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".ops-assignee-fallback")?.textContent).toBe("SP");
  await act(async () => root.render(<OperationsAssignee member={{ ...member, user_id: "test-next", full_name: "Next Person", avatar_url: "https://images.invalid/next.jpg" }} />));
  await act(async () => { images[1].complete = true; images[1].naturalWidth = 80; images[1].onload?.({ currentTarget: images[1] }); });
  expect(container.querySelector("img")?.getAttribute("src")).toBe("https://images.invalid/next.jpg");
  expect(container.textContent).not.toContain("Sample Person");
});
it("keeps a person's name when no photo exists", async () => {
  await act(async () => root.render(<OperationsAssignee member={{ ...member, avatar_url: null }} />));
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".ops-assignee-fallback")?.textContent).toBe("SP");
  expect(container.textContent).toContain("Sample Person");
});
