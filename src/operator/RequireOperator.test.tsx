// The one guard above all 78 operator routes, tested for the one thing static review keeps
// missing: WHOSE grant it is acting on (§9, §39 peer-gate finding on PR #546).
//
// The defect this file locks shut: the guard used to treat `useTenantContext`'s
// `isPlatformStaff || isPlatformOwner` as an ALLOW while its own server check was still in
// flight. Those flags live on a provider mounted at the app ROOT, which never unmounts, and
// they are refreshed on SIGNED_IN by a BACKGROUND load that bails without committing on a
// transient failure. So when a DIFFERENT user's session landed — a second sign-in in the same
// tab, a magic link, the cross-tab broadcast of a session created in another tab — the previous
// operator's `true` was still sitting there and admitted the new user to the whole console.
//
// Every case below therefore pins the tenant context to the MOST DANGEROUS possible value —
// `{ isPlatformStaff: true, isPlatformOwner: true }`, always, for everyone. Any render of the
// console in these tests can only have come from a server answer keyed to the uid that is
// signed in at that moment. If someone re-introduces an unkeyed cache as an allow path, these
// go red.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// --- The supabase seam, driven by hand so the in-flight window is inspectable. ----------------
/** The session `getSession()` will report on the NEXT mount. */
let sessionUid: string | null = null;
/** The guard's `onAuthStateChange` listener, so a test can deliver a user swap. */
let authListener: ((event: string, session: unknown) => void) | null = null;
/** Every `rpc()` call parks its resolver here; a test answers them one at a time. */
let pendingRpc: Array<(value: { data: unknown; error: unknown }) => void> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: sessionUid ? { user: { id: sessionUid } } : null },
        }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authListener = cb;
        return { data: { subscription: { unsubscribe: () => { authListener = null; } } } };
      },
    },
    // Deliberately NEVER auto-resolves: the whole finding lives in the window between the
    // call and the answer, so the test holds that window open on purpose.
    rpc: () => new Promise((resolve) => { pendingRpc.push(resolve); }),
  },
}));

// The stale cache, pinned hot. See the header note.
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ loading: false, isPlatformStaff: true, isPlatformOwner: true }),
}));

// Presentation stubs — this file asserts WHICH branch the guard takes, not how it paints.
vi.mock("@/components/ui/page", () => ({
  PageSkeleton: () => <div>WAITING</div>,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));

import RequireOperator from "./RequireOperator";

// React 18's `act` needs this flag to run without warning under jsdom.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/**
 * Mounts the guard exactly as `OperatorEntry` does — behind `/operator/:section/*`, with the
 * door and the old console as real sibling routes, so a redirect is observable as the page it
 * lands on rather than inferred from an absence.
 */
const mount = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={["/operator/fleet/tenants"]}>
        <Routes>
          <Route path="/operator/login" element={<div>DOOR</div>} />
          <Route path="/app" element={<div>STANDARD_APP</div>} />
          <Route
            path="/operator/:section/*"
            element={
              <RequireOperator>
                <div>OPERATOR_CONSOLE</div>
              </RequireOperator>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });
};

const unmount = () => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
};

const screen = () => container?.textContent ?? "";

/** Let the mocked `getSession()` promise (and any chained state commit) settle. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Answer the oldest outstanding `operator_standing()` call. */
const answerRpc = async (isOperator: boolean) => {
  const resolve = pendingRpc.shift();
  if (!resolve) throw new Error("no rpc in flight — the guard did not ask the server");
  await act(async () => {
    // The one server answer: a row with the caller's operator tier, or no tier at all.
    resolve({ data: [{ tier: isOperator ? "platform_admin" : null, active_tenant_id: null }], error: null });
    await Promise.resolve();
  });
};

/** Deliver an auth event to the mounted guard, the way supabase-js does. */
const signalAuth = async (event: string, uid: string | null) => {
  await act(async () => {
    authListener?.(event, uid ? { user: { id: uid } } : null);
    await Promise.resolve();
  });
};

// Each case uses its OWN uids. That is not cosmetic: the memo under test is module-scoped
// (it has to survive the remounts it exists to smooth over), and a fresh uid is cleared by the
// guard's own subject-change path — the very behaviour being asserted. No test-only hatch is
// cut into the guard to arrange it.
beforeEach(() => {
  pendingRpc = [];
  authListener = null;
  sessionUid = null;
});

afterEach(() => {
  unmount();
});

describe("RequireOperator — a grant belongs to a person, not to a browser", () => {
  it("does NOT admit a newly signed-in user on the previous operator's resolved grant", async () => {
    // Operator A is in, verified by the server.
    sessionUid = "user-A1";
    mount();
    await settle();
    await answerRpc(true);
    expect(screen()).toContain("OPERATOR_CONSOLE");

    // Someone else's session lands in this tab — a second sign-in, a magic link, or the
    // cross-tab broadcast of a session created elsewhere. No SIGNED_OUT precedes it.
    await signalAuth("SIGNED_IN", "user-B1");

    // THE FINDING. The tenant-context flags still read `staff: true, owner: true` (they are
    // A's, and the provider's background refresh has not returned). Before the fix that alone
    // rendered the console for B. Now nothing but a server answer for B can.
    expect(screen()).not.toContain("OPERATOR_CONSOLE");
    expect(screen()).toContain("WAITING");
    expect(pendingRpc).toHaveLength(1); // B is being asked about, not assumed.
  });

  it("admits that new user once the server answers for THEM, and denies when it says no", async () => {
    sessionUid = "user-A2";
    mount();
    await settle();
    await answerRpc(true);
    await signalAuth("SIGNED_IN", "user-B2");

    // B is not an operator: the honest end of the window is the old console, not the new one.
    await answerRpc(false);
    expect(screen()).not.toContain("OPERATOR_CONSOLE");
    expect(screen()).toContain("STANDARD_APP");
  });

  it("still spares the SAME operator a flash when they re-enter the subtree", async () => {
    // The reason a cache exists at all: the guard remounts on every entry, and re-asking the
    // server means a round-trip of blank. Keyed correctly, that benefit survives the fix.
    sessionUid = "user-A3";
    mount();
    await settle();
    await answerRpc(true);
    expect(screen()).toContain("OPERATOR_CONSOLE");
    unmount();

    mount();
    await settle();
    // No rpc answered this time — the console is up from A's own prior server answer.
    expect(screen()).toContain("OPERATOR_CONSOLE");
    expect(pendingRpc).toHaveLength(1); // and it is being re-confirmed in the background.
  });

  it("burns the grant on sign-out, even for the very same person signing back in", async () => {
    sessionUid = "user-A4";
    mount();
    await settle();
    await answerRpc(true);
    expect(screen()).toContain("OPERATOR_CONSOLE");

    await signalAuth("SIGNED_OUT", null);
    expect(screen()).toContain("DOOR");
    unmount();

    // A returns. Their role could have been revoked while they were away, so the previous
    // session's grant must not stand in for a fresh answer.
    pendingRpc = [];
    sessionUid = "user-A4";
    mount();
    await settle();
    expect(screen()).not.toContain("OPERATOR_CONSOLE");
    expect(screen()).toContain("WAITING");
    expect(pendingRpc).toHaveLength(1);
  });

  it("never lets a remembered DENY lock out a role that was just granted", async () => {
    // The memo pre-empts the round-trip in ONE direction only. A cached no would strand an
    // operator who was promoted a moment ago, so it is never seeded from `false`.
    sessionUid = "user-C5";
    mount();
    await settle();
    await answerRpc(false);
    expect(screen()).toContain("STANDARD_APP");
    unmount();

    pendingRpc = [];
    mount();
    await settle();
    expect(screen()).toContain("WAITING"); // asking again, not repeating itself
    await answerRpc(true);
    expect(screen()).toContain("OPERATOR_CONSOLE");
  });
});
