import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import OperationsDelivery from "./OperationsDelivery";

const fixture = vi.hoisted(() => ({ phase: "ready", readable: true, unknown: false, foreign: false }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: "test-tenant-a", activeUserId: "test-owner-a", accountContextLoading: false }) }));
vi.mock("@/solo/useSoloCommercialTerms", () => ({ useSoloCommercialTerms: () => ({
  tenantId: fixture.foreign ? "test-tenant-b" : "test-tenant-a", phase: fixture.phase,
  agreementsReadable: fixture.readable, authorityUnknown: fixture.unknown,
  agreements: [], clients: [], clientsReadable: true, retry: vi.fn(),
}) }));
vi.mock("@/solo/useSoloAgreementSignings", () => ({ useSoloAgreementSignings: () => ({
  tenantId: "test-tenant-a", phase: "ready", readable: true, signings: [], retry: vi.fn(),
}) }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ soloStandalone: true }) }));
vi.mock("./OperationsEngagementEvidence", () => ({ OperationsEngagementEvidence: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  Object.assign(fixture, { phase: "ready", readable: true, unknown: false, foreign: false });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
function button(name: string) { return Array.from(container.querySelectorAll("button")).find(node => node.textContent?.trim() === name); }

it("offers original Sales and Work exits from a confirmed empty source without claiming delivery", () => {
  const sales = vi.fn(), work = vi.fn(), paige = vi.fn();
  act(() => root.render(<OperationsDelivery onOpenAgreements={sales} onOpenWork={work} openPaige={paige} />));
  expect(button("Open Sales agreements")).toBeTruthy(); expect(button("Open existing work")).toBeTruthy();
  act(() => button("Open Sales agreements")!.click()); act(() => button("Open existing work")!.click());
  expect(sales).toHaveBeenCalledOnce(); expect(work).toHaveBeenCalledOnce(); expect(paige).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="How a promise becomes delivered work"]')).toBeTruthy();
  expect(container.querySelector("[data-observed=true]")).toBeNull(); expect(container.querySelector('[role="progressbar"]')).toBeNull();
});

it("withholds operative exits without their original navigation callbacks", () => {
  act(() => root.render(<OperationsDelivery />));
  expect(button("Open Sales agreements")?.disabled).toBe(true);
  expect(button("Open existing work")?.disabled).toBe(true);
});

it.each(["loading", "error", "denied", "unknown", "foreign"])("does not turn a %s source into first-use success", state => {
  if (state === "denied") fixture.readable = false;
  else if (state === "unknown") fixture.unknown = true;
  else if (state === "foreign") fixture.foreign = true;
  else fixture.phase = state;
  act(() => root.render(<OperationsDelivery onOpenAgreements={vi.fn()} onOpenWork={vi.fn()} />));
  expect(button("Open Sales agreements")).toBeUndefined(); expect(button("Open existing work")).toBeUndefined();
  expect(container.textContent).not.toContain("Agree the outcome. Follow it through.");
});
