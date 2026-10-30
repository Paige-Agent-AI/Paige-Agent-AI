// LiveRoom — the /live/:id room page. What these tests pin is the page's honesty, not the
// SDK (the SDK is doubled; its real join proof is the post-deploy authenticated drive):
// the door's answers render truthfully in every state, each joiner gets their OWN
// door-minted pass (init receives exactly that token), and no state ever invents a room.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  answer: { ok: false, code: "BROADCAST_NOT_LIVE" } as Record<string, unknown>,
  initTokens: [] as string[],
  joined: 0,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async () => ({ data: fixture.answer, error: null }) } },
}));
vi.mock("@/lib/integrations/connectError", () => ({ readFunctionErrorBody: async () => null }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ id: "ffff0000-0000-4000-8000-00000000c001" }) }));
vi.mock("@cloudflare/realtimekit", () => ({
  default: { init: async ({ authToken }: { authToken: string }) => { fixture.initTokens.push(authToken); return { join: async () => { fixture.joined += 1; } }; } },
}));
vi.mock("@cloudflare/realtimekit-react-ui", () => ({
  RtkMeeting: ({ meeting }: { meeting: unknown }) => <div data-testid="room-mount">{meeting ? "room" : "no-meeting"}</div>,
}));

import LiveRoom from "../pages/LiveRoom";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const mount = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<LiveRoom />); });
  return container;
};

beforeEach(() => {
  fixture.answer = { ok: false, code: "BROADCAST_NOT_LIVE" };
  fixture.initTokens = [];
  fixture.joined = 0;
});
afterEach(() => { act(() => { root?.unmount(); }); container?.remove(); });

describe("LiveRoom — the door's answers, truthfully", () => {
  it("joins the room with the joiner's OWN door-minted pass and mounts the SDK exactly once", async () => {
    fixture.answer = { ok: true, session: { id: "s1", title: "Spring open house" }, join: { meeting_id: "m1", participant_id: "p1", token: "this-joiners-own-pass" } };
    await mount();
    expect(fixture.initTokens).toEqual(["this-joiners-own-pass"]);
    expect(fixture.joined).toBe(1);
    expect(container?.querySelector("[data-testid='room-mount']")?.textContent).toBe("room");
    expect(container?.textContent).toContain("Spring open house");
  });

  it("not live is named for what it is, with the Social tab as the truth source", async () => {
    await mount();
    expect(container?.textContent).toContain("This broadcast isn’t live");
    expect(container?.textContent).toContain("Social tab shows the real state");
    expect(fixture.initTokens).toHaveLength(0);
  });

  it("an unauthenticated visitor is asked to sign in — no room, no token", async () => {
    fixture.answer = { ok: false, code: "NOT_AUTHENTICATED" };
    await mount();
    expect(container?.textContent).toContain("Sign in to join");
    expect(fixture.initTokens).toHaveLength(0);
  });

  it("a full room is named for what it is", async () => {
    fixture.answer = { ok: false, code: "BROADCAST_ROOM_FULL" };
    await mount();
    expect(container?.textContent).toContain("This live room is full");
    expect(fixture.initTokens).toHaveLength(0);
  });

  it("a malformed door answer never becomes a room", async () => {
    fixture.answer = { ok: true, join: { meeting_id: "m1" } }; // no token — refuse
    await mount();
    expect(fixture.initTokens).toHaveLength(0);
    expect(container?.querySelector("[data-testid='room-mount']")).toBeNull();
  });
});
