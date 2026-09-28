// Codex review of #1547 (d51754bd): the tenant shells' Sign out called performSignOut directly, so an
// operator acting as the tenant signed out with the server-side act-as still open.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  outcome: "clear" as "clear" | "refused" | "unknown",
  order: [] as string[],
  errors: [] as string[],
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({
    endActAsBeforeSignOut: async () => { h.order.push("end"); return h.outcome; },
  }),
}));
vi.mock("@/lib/auth/signOut", () => ({
  performSignOut: vi.fn(async () => { h.order.push("signOut"); }),
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => { h.errors.push(m); } } }));

import { useSignOutEndingActAs } from "./useSignOutEndingActAs";

describe("useSignOutEndingActAs", () => {
  let host: HTMLDivElement;
  let root: Root;
  let signOut: ReturnType<typeof useSignOutEndingActAs> | null = null;

  function Probe() {
    signOut = useSignOutEndingActAs();
    return null;
  }

  beforeEach(async () => {
    h.order = [];
    h.errors = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<Probe />); });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("ends the act-as before signing out", async () => {
    h.outcome = "clear";
    let signedOut = false;
    await act(async () => { signedOut = await signOut!({ redirectTo: "/" }); });
    expect(signedOut).toBe(true);
    expect(h.order).toEqual(["end", "signOut"]);
  });

  it("stays signed in when the act-as does not end", async () => {
    h.outcome = "refused";
    await act(async () => { await signOut!({ redirectTo: "/" }); });
    expect(h.order).toEqual(["end"]);
    expect(h.errors[0]).toContain("still signed in");
  });

  it("stays signed in when Paige cannot tell whether an act-as is open", async () => {
    h.outcome = "unknown";
    await act(async () => { await signOut!({ redirectTo: "/" }); });
    expect(h.order).toEqual(["end"]);
    expect(h.errors[0]).toContain("couldn't confirm whether your act-as is still open");
  });
});

// The shells an operator lands in pass their sign-out to the shared shell header. Both must go through
// this hook, never performSignOut directly, or the act-as stays open on the server after sign-out.
describe("the tenant shells an operator can land in", () => {
  const read = (file: string) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
  it.each([["solo/SoloApp.tsx"], ["agency/AgencyApp.tsx"]])("%s signs out through the act-as-ending hook", (file) => {
    const source = read(file);
    expect(source).toMatch(/onSignOut=\{\(\)\s*=>\s*void signOut\(/);
    expect(source).not.toMatch(/onSignOut=\{\(\)\s*=>\s*void performSignOut\(/);
  });
});
