import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PortalInvitationHistory } from "./PortalInvitationHistory";
import type { PortalInvitation } from "./portalDashboardModel";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const at = "2026-10-15T12:00:00Z";
const row: PortalInvitation = { id: "invite-a", contact_id: "client-a", email: "client@example.test", created_at: at, expires_at: at,
  last_used_at: null, revoked_at: null, delivery: { history: [], truncated: false } };
const show = async (invitations: PortalInvitation[]) => { await act(async () => root.render(<PortalInvitationHistory invitations={invitations} contactId="client-a" />)); };
beforeEach(() => { host = document.createElement("div"); root = createRoot(host); });
afterEach(() => act(() => root.unmount()));
it("shows missing evidence without claiming an unsent message or accepted customer", async () => {
  await show([row]); expect(host.textContent).toContain("Delivery not recorded"); expect(host.textContent).toContain("is unknown");
  expect(host.textContent).not.toMatch(/Invitation accepted|never sent|Not sent/); expect(host.querySelectorAll("button,a")).toHaveLength(0);
});
it("keeps foreign client history absent and a true empty history explicit", async () => {
  await show([{ ...row, contact_id: "client-b", email: "foreign@example.test" }]); expect(host.textContent).toContain("No invitations are recorded"); expect(host.textContent).not.toContain("foreign@example.test");
});
it("separates email acceptance, delivery and later native invitation acceptance", async () => {
  const events = [{ id: "send", status: "sent", outcome: "accepted" as const, at }, { id: "delivery", status: "delivered", outcome: "delivered" as const, at }];
  await show([{ ...row, delivery: { history: events, truncated: false } }]); expect(host.textContent).toContain("Accepted for sending"); expect(host.textContent).toContain("Delivered");
  expect(host.textContent).not.toContain("Invitation accepted"); expect(host.querySelectorAll('[aria-label="Recorded email events"] li')).toHaveLength(2);
  await show([{ ...row, last_used_at: at, delivery: { history: events, truncated: false } }]); expect(host.textContent).toContain("Invitation accepted");
});
it("retains unknown transport and bounded-history warning after reload", async () => {
  const saved = { ...row, revoked_at: at, delivery: { history: Array.from({ length: 50 }, (_, i) => ({ id: "unknown-" + i, at, status: "failed", outcome: "unknown" as const })), truncated: true } };
  await show([saved]); expect(host.textContent).toContain("Delivery unknown"); expect(host.textContent).toContain("Invitation canceled"); expect(host.textContent).toContain("latest 50");
  act(() => root.unmount()); root = createRoot(host); await show([saved]); expect(host.textContent).toContain("Delivery unknown");
});
it("renders hostile stored recipient as text and never as an executable link", async () => {
  await show([{ ...row, email: '<img src=x onerror="alert(1)">' }]); expect(host.querySelectorAll("img,a,script")).toHaveLength(0); expect(host.textContent).toContain("<img");
});
