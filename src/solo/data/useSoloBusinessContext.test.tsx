import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSoloBusinessContext } from "./useSoloBusinessContext";

const state = vi.hoisted(() => ({
  tenantId: "tenant-a" as string | null,
  rpc: vi.fn(),
  identityResponse: { data: [{ default_web_hostname: "studio.paigeagent.ai" }], error: null } as {
    data: Array<{ default_web_hostname?: string | null }> | null;
    error: unknown;
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: state.tenantId }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
      // The identity read is routed separately so the queued, name-agnostic
      // incumbent expectations below are untouched by the hook's advisory
      // resolve_tenant_domain_identity call.
      rpc: (name: string, args?: unknown) =>
        name === "resolve_tenant_domain_identity"
          ? Promise.resolve(state.identityResponse)
          : state.rpc(name, args),
    },
}));
vi.mock("./useSoloPeople", () => ({
  useSoloPeople: () => ({ people: [], loading: false, error: null }),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let latest: ReturnType<typeof useSoloBusinessContext>;
function Probe() {
  latest = useSoloBusinessContext();
  return (
    <div data-loading={latest.loading}>
      {latest.error || latest.brief.publicName}
    </div>
  );
}

function currentDraft() {
  return {
    brief: latest.brief,
    businessOwners: latest.businessOwners,
    primaryBusinessEmail: latest.primaryBusinessEmail,
    knowledgeSources: latest.knowledgeSources,
    paigeProfile: latest.paigeProfile,
    voiceExamples: latest.voiceExamples,
    proposalId: null,
  };
}

const loaded = (tenantId = "tenant-a", accessScope = "owner_full") => ({
  data: {
    tenantId,
    brief: { publicName: tenantId },
    accessScope,
    contextRevision: 4,
    primaryBusinessEmail: "business@example.com",
    managedEmail: {
      registrationAvailable: true,
      available: null,
      localPart: "old-business",
      domain: "mail.example.com",
      address: "old-business@mail.example.com",
    },
  },
  error: null,
});

describe("Solo business context data boundary", () => {
  it.each(["08007", "40003", "08006"])("holds uncertain PostgreSQL outcome %s until authoritative getter without another write", async code => {
    state.rpc.mockResolvedValueOnce(loaded()).mockResolvedValueOnce({data:null,error:{code,message:"private connection details"}}).mockResolvedValueOnce(loaded());
    const root=createRoot(document.createElement("div"));await act(async()=>root.render(<Probe />));
    await act(async()=>{expect(await latest.save(currentDraft())).toMatchObject({ok:false,kind:"unknown"});});
    expect(latest.saveOutcomeUnknown).toBe(true);
    await act(async()=>{expect(await latest.save(currentDraft())).toMatchObject({ok:false,kind:"unknown"});});
    expect(state.rpc.mock.calls.filter(([name])=>name==="save_solo_business_context")).toHaveLength(1);
    await act(async()=>{expect(await latest.reconcileSave()).toMatchObject({ok:true,kind:"reconciled"});});
    expect(latest.saveOutcomeUnknown).toBe(false);await act(async()=>root.unmount());
  });

  it("keeps a proxy ERROR outcome unknown after a failed read without another write", async () => {
    state.rpc.mockResolvedValueOnce(loaded()).mockResolvedValueOnce({ data: null, error: {code:"ERROR",message:"conflict private proxy detail"} }).mockResolvedValueOnce({data:null,error:{code:"42501",message:"private denied detail"}});
    const root = createRoot(document.createElement("div"));
    await act(async()=>root.render(<Probe />));
    await act(async()=>{ expect(await latest.save(currentDraft())).toMatchObject({ok:false,kind:"unknown"}); });
    await act(async()=>{ expect(await latest.reconcileSave()).toMatchObject({ok:false}); });
    expect(latest.saveOutcomeUnknown).toBe(true); expect(latest.reconciling).toBe(false);
    await act(async()=>{ expect(await latest.save(currentDraft())).toMatchObject({ok:false,kind:"unknown"}); });
    expect(state.rpc.mock.calls.filter(([name])=>name==="save_solo_business_context")).toHaveLength(1);
    expect(latest.error).not.toContain("private");
    await act(async()=>root.unmount());
  });

  beforeEach(() => {
    state.tenantId = "tenant-a";
    state.rpc.mockReset();
    state.identityResponse = { data: [{ default_web_hostname: "studio.paigeagent.ai" }], error: null };
  });

  it("maps the canonical identity seam to the truthful web-identity state", async () => {
    const identityCases = [
      [{ default_web_hostname: "studio.paigeagent.ai" }, "reserved"],
      [{ default_web_hostname: null }, "none"],
      [null, "unknown"],
    ] as const;
    for (const [row, expected] of identityCases) {
      state.identityResponse = { data: row ? [row] : null, error: null };
      state.rpc.mockResolvedValueOnce(loaded());
      const root = createRoot(document.createElement("div"));
      await act(async () => root.render(<Probe />));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(latest.webIdentity).toBe(expected);
      await act(async () => root.unmount());
    }
    state.identityResponse = { data: null, error: { code: "IDENTITY_READ_FAILED" } };
    state.rpc.mockResolvedValueOnce(loaded());
    const erroredRoot = createRoot(document.createElement("div"));
    await act(async () => erroredRoot.render(<Probe />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(latest.webIdentity).toBe("unknown");
    await act(async () => erroredRoot.unmount());
  });

  it("returns the canonical saved brief and revision instead of treating the interview draft as readback", async () => {
    state.rpc.mockResolvedValueOnce(loaded()).mockResolvedValueOnce({
      data: {
        ...loaded().data,
        contextRevision: 5,
        brief: {
          publicName: "Stored business name",
          currentPriority: "Follow up with warm leads",
          updatedAt: "2026-10-12T18:00:00Z",
          provenance: {
            currentPriority: { source: "owner_confirmed", confidence: "confirmed" },
          },
        },
      },
      error: null,
    });
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    const draft = currentDraft();
    draft.brief = { ...draft.brief, currentPriority: "  Follow up with warm leads  " };
    await act(async () => {
      const result = await latest.save(draft);
      expect(result).toMatchObject({
        ok: true,
        kind: "saved",
        readback: {
          tenantId: "tenant-a",
          contextRevision: 5,
          brief: { publicName: "Stored business name", currentPriority: "Follow up with warm leads" },
        },
      });
    });
    expect(latest.brief.currentPriority).toBe("Follow up with warm leads");
    expect(state.rpc).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it("does not return a foreign workspace's save payload as interview readback", async () => {
    state.rpc.mockResolvedValueOnce(loaded()).mockResolvedValueOnce(loaded("tenant-b"));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await act(async () => {
      const result = await latest.save(currentDraft());
      expect(result).toMatchObject({ ok: false, kind: "unknown" });
      expect(result).not.toHaveProperty("readback");
    });
    expect(latest.brief.publicName).toBe("tenant-a");
    await act(async () => root.unmount());
  });

  it("requires reconciliation when the saved revision is absent", async () => {
    state.rpc.mockResolvedValueOnce(loaded()).mockResolvedValueOnce({
      data: { tenantId: "tenant-a", brief: { publicName: "Stored name" }, accessScope: "owner_full" },
      error: null,
    });
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await act(async () => {
      expect(await latest.save(currentDraft())).toMatchObject({ ok: false, kind: "unknown" });
    });
    await act(async () => root.unmount());
  });

  it("reconciles a lost write response through the canonical getter without resubmitting", async () => {
    let stored = loaded();
    state.rpc.mockImplementation(async name => {
      if (name === "save_solo_business_context") {
        stored = { ...loaded(), data: { ...loaded().data, brief: { publicName: "Saved before connection loss" }, contextRevision: 5 } };
        throw new Error("response lost after commit");
      }
      return stored;
    });
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    const draft = currentDraft();
    await act(async () => expect(await latest.save(draft)).toMatchObject({ ok: false, kind: "unknown" }));
    expect(latest.saveOutcomeUnknown).toBe(true);
    await act(async () => expect(await latest.save(draft)).toMatchObject({ ok: false, kind: "unknown" }));
    await act(async () => expect(await latest.reconcileSave()).toMatchObject({ ok: true, kind: "reconciled", readback: { tenantId: "tenant-a", contextRevision: 5, brief: { publicName: "Saved before connection loss" } } }));
    expect(latest.saveOutcomeUnknown).toBe(false);
    expect(latest.brief.publicName).toBe("Saved before connection loss");
    expect(state.rpc.mock.calls.filter(([name]) => name === "save_solo_business_context")).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it("keeps the write blocked when reconciliation is denied or returns a foreign workspace", async () => {
    state.rpc.mockResolvedValueOnce(loaded()).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(loaded("tenant-b"));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await act(async () => latest.save(currentDraft()));
    await act(async () => expect(await latest.reconcileSave()).toMatchObject({ ok: false }));
    expect(latest.saveOutcomeUnknown).toBe(true);
    expect(latest.brief.publicName).not.toBe("tenant-b");
    expect(state.rpc.mock.calls.filter(([name]) => name === "save_solo_business_context")).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it("shows a safe retryable load failure instead of spinning forever or leaking database detail", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "relation private_secret_table not found",
        code: "42P01",
      },
    });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<Probe />));
    expect(latest.loading).toBe(false);
    expect(latest.error).toBe("Couldn't load this business context.");
    expect(host.textContent).not.toContain("private_secret_table");
    await act(async () => root.unmount());
  });

  it("refuses an unresolved session without an infinite loading state", async () => {
    state.tenantId = null;
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    expect(latest.loading).toBe(false);
    expect(latest.canEdit).toBe(false);
    expect(latest.error).toContain("Choose a Solo workspace");
    expect(state.rpc).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("keeps unresolved snapshots stable so the edit-form reset effect cannot loop", async () => {
    state.tenantId = null;
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    const before = latest;
    await act(async () => root.render(<Probe />));
    expect(latest.brief).toBe(before.brief);
    expect(latest.businessOwners).toBe(before.businessOwners);
    expect(latest.knowledgeSources).toBe(before.knowledgeSources);
    expect(latest.voiceExamples).toBe(before.voiceExamples);
    await act(async () => root.unmount());
  });

  it("drops a late response after switching tenants", async () => {
    let resolveA!: (value: unknown) => void;
    state.rpc
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockResolvedValue({
        data: {
          tenantId: "tenant-b",
          brief: { publicName: "Business B" },
          accessScope: "owner_full",
          contextRevision: 0,
        },
        error: null,
      });
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    state.tenantId = "tenant-b";
    await act(async () => root.render(<Probe />));
    await act(async () =>
      resolveA({
        data: {
          tenantId: "tenant-a",
          brief: { publicName: "Business A" },
          accessScope: "owner_full",
        },
        error: null,
      }),
    );
    expect(latest.brief.publicName).toBe("Business B");
    await act(async () => root.unmount());
  });

  it("sends expected workspace/revision/email and rejects duplicate save synchronously", async () => {
    state.rpc.mockResolvedValueOnce(loaded());
    let finish!: (value: unknown) => void;
    state.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    let save!: ReturnType<typeof latest.save>;
    await act(async () => {
      save = latest.save(currentDraft());
      expect((await latest.save(currentDraft())).ok).toBe(false);
    });
    expect(latest.saving).toBe(true);
    expect(state.rpc).toHaveBeenLastCalledWith(
      "save_solo_business_context",
      expect.objectContaining({
        _expected_tenant_id: "tenant-a",
        _expected_context_revision: 4,
        _expected_primary_business_email: "business@example.com",
        _primary_business_email_decision: null,
      }),
    );
    await act(async () => {
      finish(loaded());
      await save;
    });
    expect(latest.saving).toBe(false);
    expect(state.rpc).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it("uses null unchanged supplemental fields for an Admin operational save", async () => {
    state.rpc.mockResolvedValue(loaded("tenant-a", "admin_operational"));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await act(async () => {
      expect((await latest.save(currentDraft())).ok).toBe(true);
    });
    expect(state.rpc).toHaveBeenLastCalledWith(
      "save_solo_business_context",
      expect.objectContaining({
        _primary_business_email: null,
        _knowledge_sources: null,
        _paige_profile: null,
        _voice_examples: null,
      }),
    );
    await act(async () => root.unmount());
  });

  it("preserves draft failure for retry without exposing provider error text", async () => {
    state.rpc
      .mockResolvedValueOnce(loaded())
      .mockResolvedValueOnce({
        data: null,
        error: { message: "private SQL endpoint details", code: "XX000" },
      })
      .mockResolvedValueOnce(loaded());
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await act(async () => {
      const result = await latest.save(currentDraft());
      expect(result).toEqual({
        ok: false,
        kind: "failed",
        error: "Couldn't save this business context.",
      });
    });
    expect(latest.saving).toBe(false);
    await act(async () => {
      expect((await latest.save(currentDraft())).ok).toBe(true);
    });
    await act(async () => root.unmount());
  });

  it("does not accept a held save or stale callback after account switch", async () => {
    let finish!: (value: unknown) => void;
    state.rpc
      .mockResolvedValueOnce(loaded())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(loaded("tenant-b"));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    const oldSave = latest.save;
    const oldDraft = currentDraft();
    let held!: ReturnType<typeof latest.save>;
    await act(async () => {
      held = oldSave(oldDraft);
    });
    state.tenantId = "tenant-b";
    await act(async () => root.render(<Probe />));
    await act(async () => {
      finish(loaded());
      expect(await held).toMatchObject({ ok: false, kind: "stale" });
      expect((await oldSave(oldDraft)).ok).toBe(false);
    });
    expect(latest.brief.publicName).toBe("tenant-b");
    expect(state.rpc).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
  });

  it("guards managed registration and proposal dismissal with expected workspace", async () => {
    state.rpc
      .mockResolvedValueOnce(loaded())
      .mockResolvedValueOnce({
        data: {
          registered: true,
          registrationAvailable: true,
          available: true,
          address: "business@mail.example.com",
          localPart: "business",
          domain: "mail.example.com",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ...loaded().data,
          managedEmail: {
            registrationAvailable: true,
            available: null,
            localPart: "business",
            domain: "mail.example.com",
            address: "business@mail.example.com",
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({ error: null });
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await act(async () => {
      await latest.registerManagedEmail("business");
    });
    expect(state.rpc).toHaveBeenCalledWith(
      "register_solo_setup_managed_email",
      { _expected_tenant_id: "tenant-a", _local_part: "business" },
    );
    await act(async () => {
      await latest.dismissProposal("proposal-id");
    });
    expect(state.rpc).toHaveBeenLastCalledWith(
      "dismiss_solo_setup_context_proposal",
      { _expected_tenant_id: "tenant-a", _proposal_id: "proposal-id" },
    );
    await act(async () => root.unmount());
  });

  it.each([
    {
      registered: false,
      registrationAvailable: true,
      available: true,
      localPart: "business",
      domain: "mail.example.com",
      address: "business@mail.example.com",
    },
    {
      registered: true,
      registrationAvailable: true,
      available: true,
      localPart: "different",
      domain: "mail.example.com",
      address: "different@mail.example.com",
    },
    {
      registered: true,
      registrationAvailable: true,
      available: true,
      localPart: "business",
      domain: "wrong.example.com",
      address: "business@wrong.example.com",
    },
  ])(
    "rejects an unverified or mismatched registration response %#",
    async (response) => {
      state.rpc
        .mockResolvedValueOnce(loaded())
        .mockResolvedValueOnce({ data: response, error: null });
      const root = createRoot(document.createElement("div"));
      await act(async () => root.render(<Probe />));
      await act(async () => {
        await expect(latest.registerManagedEmail("business")).rejects.toThrow();
      });
      expect(latest.managedEmail?.address).toBe(
        "old-business@mail.example.com",
      );
      expect(latest.saving).toBe(false);
      await act(async () => root.unmount());
    },
  );
  it("reads back the registered sender without replacing the brief or its conflict revision", async () => {
    let loads = 0;
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "get_solo_business_context") {
        loads += 1;
        return loads === 1
          ? loaded()
          : {
              data: {
                ...loaded().data,
                brief: { publicName: "Newer other-session brief" },
                contextRevision: 99,
                managedEmail: {
                  registrationAvailable: true,
                  available: null,
                  localPart: "business",
                  domain: "mail.example.com",
                  address: "business@mail.example.com",
                },
              },
              error: null,
            };
      }
      if (name === "register_solo_setup_managed_email")
        return {
          data: {
            registered: true,
            registrationAvailable: true,
            available: true,
            localPart: "business",
            domain: "mail.example.com",
            address: "business@mail.example.com",
          },
          error: null,
        };
      return { data: null, error: { code: "40001" } };
    });
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    const initial = latest.brief;
    await act(async () => {
      await latest.registerManagedEmail("business");
    });
    expect(loads).toBe(2);
    expect(latest.managedEmail).toMatchObject({
      registrationAvailable: true,
      address: "business@mail.example.com",
    });
    expect(latest.brief).toBe(initial);
    await act(async () => {
      expect(await latest.save(currentDraft())).toMatchObject({
        ok: false,
        kind: "conflict",
      });
    });
    expect(state.rpc).toHaveBeenLastCalledWith(
      "save_solo_business_context",
      expect.objectContaining({ _expected_context_revision: 4 }),
    );
    await act(async () => root.unmount());
  });
  it("does not call registration successful when durable readback still resolves the old sender", async () => {
    state.rpc
      .mockResolvedValueOnce(loaded())
      .mockResolvedValueOnce({
        data: {
          registered: true,
          registrationAvailable: true,
          available: true,
          localPart: "business",
          domain: "mail.example.com",
          address: "business@mail.example.com",
        },
        error: null,
      })
      .mockResolvedValueOnce(loaded());
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await act(async () => {
      await expect(latest.registerManagedEmail("business")).rejects.toThrow();
    });
    expect(latest.managedEmail?.address).toBe("old-business@mail.example.com");
    await act(async () => root.unmount());
  });
  it("releases failed registration for retry and refuses duplicate concurrent mutations", async () => {
    let finish!: (value: unknown) => void;
    state.rpc
      .mockResolvedValueOnce(loaded())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "23505",
          message: "private conflicting connector detail",
        },
      });
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    let request!: Promise<unknown>;
    await act(async () => {
      request = latest.registerManagedEmail("business").catch((error) => error);
      await expect(latest.registerManagedEmail("other")).rejects.toThrow(
        "not available",
      );
      expect(await latest.save(currentDraft())).toMatchObject({ ok: false });
    });
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(latest.saving).toBe(true);
    await act(async () => {
      finish({
        data: null,
        error: { code: "XX000", message: "private endpoint detail" },
      });
      expect(((await request) as Error).message).not.toContain("private");
    });
    expect(latest.saving).toBe(false);
    await act(async () => {
      await expect(latest.registerManagedEmail("other")).rejects.toThrow(
        "no longer available",
      );
    });
    expect(state.rpc).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
  });
  it("rejects delayed managed-email availability after an account switch", async () => {
    let finish!: (value: unknown) => void;
    state.rpc
      .mockResolvedValueOnce(loaded())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(loaded("tenant-b"));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    let request!: Promise<unknown>;
    await act(async () => {
      request = latest.checkManagedEmail("business").catch((error) => error);
    });
    state.tenantId = "tenant-b";
    await act(async () => root.render(<Probe />));
    await act(async () => {
      finish({
        data: { available: true, address: "business@mail.example.com" },
        error: null,
      });
      expect(await request).toBeInstanceOf(Error);
    });
    expect(latest.brief.publicName).toBe("tenant-b");
    await act(async () => root.unmount());
  });
  it("drops a delayed managed registration and stale callback after account switch", async () => {
    let finish!: (value: unknown) => void;
    state.rpc
      .mockResolvedValueOnce(loaded())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(loaded("tenant-b"));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    const oldRegister = latest.registerManagedEmail;
    let request!: Promise<unknown>;
    await act(async () => {
      request = oldRegister("business").catch((error) => error);
    });
    state.tenantId = "tenant-b";
    await act(async () => root.render(<Probe />));
    await act(async () => {
      finish({
        data: {
          registered: true,
          registrationAvailable: true,
          available: true,
          localPart: "business",
          domain: "mail.example.com",
          address: "business@mail.example.com",
        },
        error: null,
      });
      expect(await request).toBeInstanceOf(Error);
      await expect(oldRegister("other")).rejects.toThrow("not available");
    });
    expect(latest.brief.publicName).toBe("tenant-b");
    expect(latest.managedEmail?.address).toBe("old-business@mail.example.com");
    expect(state.rpc).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
  });
  it("supports first-use registration when no sender address has been assigned yet", async () => {
    const identity = {
      registrationAvailable: true,
      available: true,
      localPart: "first-business",
      domain: "mail.example.com",
      address: "first-business@mail.example.com",
    };
    state.rpc
      .mockResolvedValueOnce({
        data: {
          ...loaded().data,
          managedEmail: {
            registrationAvailable: true,
            available: null,
            localPart: "",
            domain: "mail.example.com",
            address: "",
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ...identity, registered: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ...loaded().data, managedEmail: identity },
        error: null,
      });
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    expect(latest.managedEmail).toMatchObject({
      registrationAvailable: true,
      address: "",
    });
    await act(async () => {
      expect(await latest.registerManagedEmail("first-business")).toMatchObject(
        identity,
      );
    });
    expect(latest.managedEmail?.address).toBe(identity.address);
    await act(async () => root.unmount());
  });
  it("does not apply verified readback after the owner switches accounts during verification", async () => {
    const identity = {
      registered: true,
      registrationAvailable: true,
      available: true,
      localPart: "business",
      domain: "mail.example.com",
      address: "business@mail.example.com",
    };
    let finishReadback!: (value: unknown) => void;
    state.rpc
      .mockResolvedValueOnce(loaded())
      .mockResolvedValueOnce({ data: identity, error: null })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishReadback = resolve;
          }),
      )
      .mockResolvedValueOnce(loaded("tenant-b"));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    let request!: Promise<unknown>;
    await act(async () => {
      request = latest.registerManagedEmail("business").catch((error) => error);
    });
    expect(latest.saving).toBe(true);
    state.tenantId = "tenant-b";
    await act(async () => root.render(<Probe />));
    await act(async () => {
      finishReadback({
        data: { ...loaded().data, managedEmail: identity },
        error: null,
      });
      expect(await request).toBeInstanceOf(Error);
    });
    expect(latest.managedEmail?.address).toBe("old-business@mail.example.com");
    expect(latest.brief.publicName).toBe("tenant-b");
    expect(latest.saving).toBe(false);
    await act(async () => root.unmount());
  });
  it("refuses Member mutations without making a write request", async () => {
    state.rpc.mockResolvedValue(loaded("tenant-a", "read_only"));
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await act(async () => {
      expect((await latest.save(currentDraft())).ok).toBe(false);
      await expect(latest.registerManagedEmail("business")).rejects.toThrow(
        "not available",
      );
      expect((await latest.dismissProposal("proposal-id")).ok).toBe(false);
    });
    expect(state.rpc).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
