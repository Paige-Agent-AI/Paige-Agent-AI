import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

/**
 * E09 Slice 7: the inbox contact card's "Client intake" panel read the link alone, so a paused client
 * (link kept) looked like an ordinary joined client and an ended one (link cleared) looked like someone
 * who never accepted. The business's access decision is named first.
 */
const f = vi.hoisted(() => ({ status: null as Record<string, unknown> | null }));
vi.mock("@/hooks/useClientOnboardingStatus", () => ({ useClientOnboardingStatus: () => ({ status: f.status, loading: false }) }));
import { ClientOnboardingStatusPanel } from "./ClientOnboardingStatusPanel";

const base = { contact_id: "c-1", linked_user_id: "login-1", invite_accepted_at: "2026-10-01T00:00:00Z", agreement_signed_at: "2026-10-02T00:00:00Z",
  intake_submitted_at: null, stage: "completed", ready: true, portal_access_state: "open" };
beforeEach(() => { f.status = { ...base }; });

it("a paused client reads Access paused and says client view is closed until restored", () => {
  f.status = { ...base, portal_access_state: "paused" };
  const html = renderToStaticMarkup(<ClientOnboardingStatusPanel contactId="c-1" />);
  expect(html).toContain("Access paused");
  expect(html).not.toContain(">Ready<");
  expect(html).toContain("closed until it’s restored");
});

it("an ended client reads Access ended, not 'waiting to accept'", () => {
  f.status = { ...base, linked_user_id: null, ready: false, portal_access_state: "ended" };
  const html = renderToStaticMarkup(<ClientOnboardingStatusPanel contactId="c-1" />);
  expect(html).toContain("Access ended");
  expect(html).toContain("A new invitation brings them back");
  expect(html).not.toContain("Waiting for client to accept invite");
});

it("an open, ready client is unchanged", () => {
  const html = renderToStaticMarkup(<ClientOnboardingStatusPanel contactId="c-1" />);
  expect(html).toContain("Ready");
  expect(html).not.toMatch(/Access paused|Access ended/);
});
