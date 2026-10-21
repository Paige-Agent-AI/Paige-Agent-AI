import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  impersonating: false,
  context: {
    loading: false, accountContextLoading: false, accountContextStatus: "ready",
    activeUserId: "test-user-a" as string | null, activeTenantId: "test-tenant-a" as string | null,
    isPlatformStaff: false, isPlatformOwner: false, soloShellEnabled: true,
    activeTenant: { id: "test-tenant-a", account_type: "standalone", parent_tenant_id: null as string | null },
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => h.context }));
vi.mock("@/contexts/ImpersonationContext", () => ({ useImpersonation: () => ({ isImpersonating: h.impersonating }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { ComposerDraftSessionBinding } from "./ComposerDraftSessionBinding";
import { setScopedUserId } from "@/lib/scopedUser";
import {
  clearComposerDraft, readComposerDraft, readComposerDraftReloadProtection,
  resolveComposerScopeState, setComposerDraftSessionScope, takeComposerDraft,
  useComposerDraft, writeComposerDraft,
} from "@/lib/paigeComposerScopeState";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cacheKey = "paige.composer.drafts.v1";
const handle = () => ({ tenantId: h.context.activeTenantId!, userId: h.context.activeUserId!,
  conversationId: "thread-a", focusedClientId: "none", focusedBusinessMissionId: "none" });

describe("canonical account binding for unsent draft recovery", () => {
  let host: HTMLDivElement, root: Root;
  let counter = 0;
  beforeEach(() => {
    counter++;
    setComposerDraftSessionScope({ kind: "clear" });
    sessionStorage.clear();
    setScopedUserId(null);
    h.impersonating = false;
    Object.assign(h.context, { loading: false, accountContextLoading: false, accountContextStatus: "ready",
      activeUserId: `test-user-${counter}`, activeTenantId: "test-tenant-a",
      isPlatformStaff: false, isPlatformOwner: false, soloShellEnabled: true,
      activeTenant: { id: "test-tenant-a", account_type: "standalone", parent_tenant_id: null } });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount()); host.remove();
    setComposerDraftSessionScope({ kind: "clear" }); setScopedUserId(null); vi.restoreAllMocks();
  });

  function DraftProbe() {
    const identity = handle();
    const draft = useComposerDraft(resolveComposerScopeState({ currentIdentity: identity, displayedIdentity: identity,
      busy: false, conversation: { history: "settled", newConversationId: "new-chat", intent: "explicit",
        requested: { kind: "thread", id: "thread-a" }, displayed: { kind: "thread", id: "thread-a" } } }));
    return <output data-protection={draft.reloadProtection}>{draft.value}</output>;
  }
  const render = () => act(() => root.render(<><ComposerDraftSessionBinding /><DraftProbe /></>));

  it("retains an ordinary eligible actor's own input through the canonical store", () => {
    render();
    act(() => writeComposerDraft(handle(), "Unsent business review question"));
    expect(host.textContent).toBe("Unsent business review question");
    expect(host.querySelector("output")?.dataset.protection).toBe("protected");
    expect(sessionStorage.getItem(cacheKey)).toContain("Unsent business review question");
  });

  it.each(["staff", "owner", "impersonating", "effective", "agency", "child", "shell-off", "error", "signed-out", "missing-actor", "wrong-tenant"])(
    "does not retain input when the canonical account/view is %s", (state) => {
      if (state === "staff") h.context.isPlatformStaff = true;
      if (state === "owner") h.context.isPlatformOwner = true;
      if (state === "impersonating") h.impersonating = true;
      if (state === "effective") setScopedUserId("effective-user");
      if (state === "agency") h.context.activeTenant.account_type = "agency";
      if (state === "child") h.context.activeTenant.parent_tenant_id = "test-parent";
      if (state === "shell-off") h.context.soloShellEnabled = false;
      if (state === "error" || state === "signed-out") h.context.accountContextStatus = state === "error" ? "error" : "signed_out";
      if (state === "missing-actor") h.context.activeUserId = null;
      if (state === "wrong-tenant") h.context.activeTenant.id = "test-other";
      render();
      const own = { ...handle(), userId: h.context.activeUserId ?? "unresolved" };
      act(() => writeComposerDraft(own, "Not retained"));
      expect(readComposerDraftReloadProtection(own)).toBe("disabled");
      expect(sessionStorage.getItem(cacheKey)).toBeNull();
    },
  );

  it("waits through cold identity resolution without reading or deleting its cache", () => {
    const own = handle();
    sessionStorage.setItem(cacheKey, JSON.stringify({ version: 1, owner: { tenantId: own.tenantId, userId: own.userId },
      entries: [{ key: JSON.stringify([own.tenantId, own.userId, own.conversationId, "none", "none"]), text: "Retained question", updatedAt: Date.now() }] }));
    h.context.accountContextStatus = "resolving"; h.context.accountContextLoading = true;
    render();
    expect(host.textContent).toBe("");
    expect(sessionStorage.getItem(cacheKey)).toContain("Retained question");
    h.context.accountContextStatus = "ready"; h.context.accountContextLoading = false;
    render();
    expect(host.textContent).toBe("Retained question");
  });

  it("retires retained input on an actual persona change, even before the caller rerenders", () => {
    render(); act(() => writeComposerDraft(handle(), "Old view"));
    act(() => setScopedUserId("effective-user"));
    expect(sessionStorage.getItem(cacheKey)).toBeNull();
    expect(readComposerDraft(handle())).toBe("");
    expect(host.textContent).toBe("");
  });

  it("does not erase a valid accepted context for an ordinary background/foreground refresh spinner", () => {
    render(); act(() => writeComposerDraft(handle(), "Keep while refreshing"));
    h.context.loading = true; render();
    expect(host.textContent).toBe("Keep while refreshing");
    expect(readComposerDraftReloadProtection(handle())).toBe("protected");
  });

  it("reports quota failure even when the text itself has not changed, then recovers on an edit", () => {
    render(); act(() => writeComposerDraft(handle(), "Same thought"));
    const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
    act(() => writeComposerDraft(handle(), "Same thought"));
    expect(host.textContent).toBe("Same thought");
    expect(host.querySelector("output")?.dataset.protection).toBe("unavailable");
    quota.mockRestore();
    act(() => writeComposerDraft(handle(), "Edited thought"));
    expect(host.querySelector("output")?.dataset.protection).toBe("protected");
    act(() => takeComposerDraft(handle()));
    expect(host.textContent).toBe(""); expect(sessionStorage.getItem(cacheKey)).toBeNull();
  });

  it("never promises reload recovery for oversized text and keeps Clear effective", () => {
    render(); act(() => writeComposerDraft(handle(), "x".repeat(20_001)));
    expect(host.querySelector("output")?.dataset.protection).toBe("unavailable");
    expect(host.textContent).toHaveLength(20_001);
    act(() => clearComposerDraft(handle()));
    expect(host.textContent).toBe("");
  });
});
