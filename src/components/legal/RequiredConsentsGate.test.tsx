import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RequiredConsentsGate } from "./RequiredConsentsGate";

// D-QA2: the shell needs to know when the consents wall is up (or still checking) so nothing opens over it.
const consents = vi.hoisted(() => ({ state: { outstanding: [] as unknown[], loading: true } }));
vi.mock("@/lib/legal/useLegalDocuments", () => ({ useOutstandingConsents: () => ({ ...consents.state, refresh: async () => {} }) }));
vi.mock("./RequiredConsentsModal", () => ({ RequiredConsentsModal: () => <div role="dialog">Updated agreements</div> }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("reports blocking while checking and while documents are outstanding, and clear once there are none", async () => {
  const seen: boolean[] = [];
  const onBlockingChange = (b: boolean) => { seen.push(b); };
  consents.state = { outstanding: [], loading: true };
  await act(async () => root.render(<RequiredConsentsGate userId="u1" onBlockingChange={onBlockingChange} />));
  expect(seen.at(-1)).toBe(true);
  consents.state = { outstanding: [{ slug: "terms", version: 2 }], loading: false };
  await act(async () => root.render(<RequiredConsentsGate userId="u1" onBlockingChange={onBlockingChange} />));
  expect(seen.at(-1)).toBe(true);
  expect(host.textContent).toContain("Updated agreements");
  consents.state = { outstanding: [], loading: false };
  await act(async () => root.render(<RequiredConsentsGate userId="u1" onBlockingChange={onBlockingChange} />));
  expect(seen.at(-1)).toBe(false);
});

it("is never blocking without a signed-in person", async () => {
  const seen: boolean[] = [];
  consents.state = { outstanding: [], loading: true };
  await act(async () => root.render(<RequiredConsentsGate userId={undefined} onBlockingChange={b => seen.push(b)} />));
  expect(seen.at(-1)).toBe(false);
});
