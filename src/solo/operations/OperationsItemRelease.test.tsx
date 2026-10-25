import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { OperationsItemRelease } from "./OperationsItemRelease";
import { canReleaseItem, releaseReviewers, releasesAvailable } from "./operations-item-release";

const preparation=vi.hoisted(()=>({held:false}));
vi.mock("./OperationsDeliverablePreparation", () => ({ OperationsDeliverablePreparation: ({ scope, registerCloseGuard, onSubmitted }: { scope: { clientId: string }; registerCloseGuard?:(guard:(showNotice?:boolean)=>boolean)=>()=>void;onSubmitted?:()=>void }) => {useLayoutEffect(()=>registerCloseGuard?.(()=>!preparation.held),[registerCloseGuard]);return <><div data-testid="prepare">Prepare for {scope.clientId}</div><button onClick={onSubmitted}>Fixture verified submission</button></>;} }));
vi.mock("./OperationsStaffDeliveryReview", () => ({ OperationsStaffDeliveryReview: ({ scope, recordedOnly }: { scope: { workItemId: string; workUpdatedAt: string }; recordedOnly?: boolean }) => <div data-testid="review" data-recorded-only={String(Boolean(recordedOnly))}>Review {scope.workItemId} at {scope.workUpdatedAt}</div> }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const actor = "e0914000-0000-4000-8000-0000000000b1";
const member = (id: string, status = "active"): TeamMemberRecord => ({ membership_id: `m-${id}`, user_id: id, full_name: "Sam Okafor", email: null, avatar_url: null, status,
  permission: "member" as TeamMemberRecord["permission"], is_owner: false, job_title: null, responsibilities: null, last_sign_in_at: null });
const item = { id: "e0974000-0000-4000-8000-000000000001", plan_id: "e0984000-0000-4000-8000-000000000001", contact_id: "e0934000-0000-4000-8000-000000000001", updated_at: "2026-01-02T00:00:00Z" };
let host: HTMLDivElement, root: Root;
beforeEach(() => { sessionStorage.clear();preparation.held=false; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async (members: TeamMemberRecord[], peopleReady = true) => act(async () => root.render(
  <OperationsItemRelease actorId={actor} tenantId="e0924000-0000-4000-8000-0000000000b1" item={item} members={members} peopleReady={peopleReady} theme="light" />));

it("says plainly that a second reviewer is needed, instead of an empty reviewer picker", async () => {
  await render([member(actor), member("e0914000-0000-4000-8000-0000000000b2", "invited")]);
  expect(host.textContent).toContain("Releasing work needs a second person on your team to review it.");
  expect(host.querySelector('[data-testid="prepare"]')).toBeNull();
  // The recorded state is still shown: a release made while a second person was on the team is never hidden.
  expect(host.querySelector('[data-testid="review"]')?.textContent).toBe(`Review ${item.id} at ${item.updated_at}`);
  // …but only what is recorded: no "nominate a reviewer" advice under "needs a second person".
  expect(host.querySelector('[data-testid="review"]')?.getAttribute("data-recorded-only")).toBe("true");
});
it("opens preparation and review one at a time with the same exact item and client scope", async () => {
  await render([member(actor), member("e0914000-0000-4000-8000-0000000000b2")]);
  expect(host.querySelector('[data-testid="prepare"]')?.textContent).toBe(`Prepare for ${item.contact_id}`);
  // One original recovery identity has one editable consumer at a time.
  expect(host.querySelector('[data-testid="review"]')).toBeNull();
  const review=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Review delivery');expect(review).toBeTruthy();await act(async()=>review?.click());
  expect(host.querySelector('[data-testid="prepare"]')).toBeNull();
  expect(host.querySelector('[data-testid="review"]')?.textContent).toBe(`Review ${item.id} at ${item.updated_at}`);
  expect(host.textContent).not.toContain("second person");
  expect(host.querySelector('[data-testid="review"]')?.getAttribute("data-recorded-only")).toBe("false");
});
it("waits for the team read before deciding", async () => {
  await render([], false);
  expect(host.textContent).toContain("Checking who on your team can review this work");
  expect(host.textContent).not.toContain("second person");
  // A skeleton holds the place; nothing is decided or shown until the team is read.
  expect(host.querySelector(".ops-item-release-skeleton")).not.toBeNull();
  expect(host.querySelector('[data-testid="review"]')).toBeNull();
  expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
});
it("releases only client work inside a project with a row version", () => {
  expect(canReleaseItem(item)).toBe(true);
  expect(canReleaseItem({ ...item, contact_id: null })).toBe(false);
  expect(canReleaseItem({ ...item, plan_id: null })).toBe(false);
  expect(canReleaseItem({ ...item, updated_at: undefined })).toBe(false);
  expect(canReleaseItem({ ...item, updated_at: "not a date" })).toBe(false);
});
it("never offers the signed-in person, or someone not yet active, as their own reviewer", () => {
  expect(releaseReviewers([member(actor), member("e0914000-0000-4000-8000-0000000000b2", "invited"), member("e0914000-0000-4000-8000-0000000000b3")], actor).map(m => m.user_id))
    .toEqual(["e0914000-0000-4000-8000-0000000000b3"]);
  expect(releaseReviewers([member("e0914000-0000-4000-8000-0000000000b3")], null)).toEqual([]);
  expect(releasesAvailable(true)).toBe(true);
  expect(releasesAvailable(false)).toBe(false);
});

it("forwards the existing close guard and refuses another editable mode while preparation is held",async()=>{let close:(showNotice?:boolean)=>boolean=()=>true;await act(async()=>root.render(<OperationsItemRelease actorId={actor} tenantId="e0924000-0000-4000-8000-0000000000b1" item={item} members={[member(actor),member("e0914000-0000-4000-8000-0000000000b2")]} peopleReady theme="light" registerCloseGuard={guard=>{close=guard;return()=>{close=()=>true;};}}/>));preparation.held=true;expect(close(false)).toBe(false);const review=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Review delivery');await act(async()=>review?.click());expect(host.querySelector('[data-testid="prepare"]')).not.toBeNull();expect(host.querySelector('[data-testid="review"]')).toBeNull();preparation.held=false;expect(close(false)).toBe(true);await act(async()=>review?.click());expect(host.querySelector('[data-testid="prepare"]')).toBeNull();expect(host.querySelector('[data-testid="review"]')).not.toBeNull();});
it("refreshes the original nomination read only after a verified submission callback",async()=>{const submitted=vi.fn();await act(async()=>root.render(<OperationsItemRelease actorId={actor} tenantId="e0924000-0000-4000-8000-0000000000b1" item={item} members={[member(actor),member("e0914000-0000-4000-8000-0000000000b2")]} peopleReady theme="light" onSubmitted={submitted}/>));expect(submitted).not.toHaveBeenCalled();const confirmed=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Fixture verified submission');await act(async()=>confirmed?.click());expect(submitted).toHaveBeenCalledOnce();expect(host.querySelectorAll('[data-testid="prepare"]')).toHaveLength(1);expect(host.querySelector('[data-testid="review"]')).toBeNull();});

it("offers the active canonical owner one existing inspection for their explicit review", async () => {
  await render([{ ...member(actor), is_owner: true }]);
  expect(host.querySelectorAll('[data-testid="prepare"]')).toHaveLength(1);
  expect(host.querySelector('[data-testid="review"]')).toBeNull();
  expect(host.textContent).toContain("Review the exact version yourself");
  expect(host.textContent).not.toContain("needs a second person");
  const review = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Review delivery");
  await act(async () => review?.click());
  expect(host.querySelector('[data-testid="prepare"]')).toBeNull();
  expect(host.querySelectorAll('[data-testid="review"]')).toHaveLength(1);
});
it("an owner display permission without canonical ownership does not offer self-review", async () => {
  await render([{ ...member(actor), permission: "owner", is_owner: false }]);
  expect(host.querySelector('[data-testid="prepare"]')).toBeNull();
  expect(host.textContent).toContain("second person");
});
it("inactive ownership cannot unlock preparation and earlier recorded work stays inspectable", async () => {
  await render([{ ...member(actor, "inactive"), is_owner: true }]);
  expect(host.querySelector('[data-testid="prepare"]')).toBeNull();
  expect(host.querySelector('[data-testid="review"]')?.getAttribute("data-recorded-only")).toBe("true");
});
