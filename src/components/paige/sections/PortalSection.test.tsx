import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it } from "vitest";
import { generalDefault } from "@/lib/playbook/presets";
import type { Playbook } from "@/lib/playbook/types";
import { PortalSection } from "./PortalSection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let latest: Playbook;
function Host() {
  const [pb, setPb] = useState<Playbook>(() => structuredClone(generalDefault));
  latest = pb;
  return <PortalSection pb={pb} patch={(fn) => setPb((prev) => { const d = structuredClone(prev); fn(d); return d; })} />;
}
let root: Root, host: HTMLDivElement;
const inputs = () => Array.from(host.querySelectorAll<HTMLInputElement>('input[aria-label="Portal module name"]'));
const type = (el: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("renaming an existing module keeps its key, so the entry keeps its route", async () => {
  await act(async () => root.render(<Host />));
  const sessions = inputs().find((i) => i.value === "Sessions")!;
  await type(sessions, "Appointments");
  const row = latest.portal.modules.find((m) => m.label === "Appointments")!;
  expect(row.key).toBe("sessions");
});

it("a new module still takes its key from its first name", async () => {
  await act(async () => root.render(<Host />));
  await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Add module"))!.click());
  const fresh = inputs().at(-1)!;
  await type(fresh, "Weekly check-ins");
  expect(latest.portal.modules.at(-1)).toEqual({ key: "weekly_check_ins", label: "Weekly check-ins" });
});

it("points to where the customer menu is set: a link in Solo, plain text elsewhere", async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={["/solo/1234567/paige"]}><Host /></MemoryRouter>));
  const link = Array.from(host.querySelectorAll("a")).find((a) => a.textContent?.includes("Clients → Portal"));
  expect(link?.getAttribute("href")).toBe("/solo/1234567/clients/portal");
  expect(host.textContent).toContain("Names, order and visibility of your customers' menu are set in Clients → Portal.");
  act(() => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={["/business/2/paige"]}><Host /></MemoryRouter>));
  expect(host.querySelector("a")).toBeNull();
  expect(host.textContent).toContain("Names, order and visibility of your customers' menu are set in Clients → Portal.");
});
