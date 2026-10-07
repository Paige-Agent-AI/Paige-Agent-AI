// INT-345 — workspace-switch security proof for the voice Device lifecycle.
// A workspace switch without a reload (the in-shell sub-account switch) must
// never carry the previous tenant's registered Device into the new workspace:
// no token reuse, no stale caller identity, no cross-tenant call state.
// The proof drives the REAL VoiceDeviceProvider with a fake Twilio SDK.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  tenantId: "tenant-a",
  holdRegister: false,
  registerGate: null as null | (() => void),
  mints: 0,
  devices: [] as Array<{ token: string; destroyed: boolean; instance: unknown }>,
}));

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: harness.tenantId }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async () => {
        harness.mints += 1;
        return { data: { token: `synthetic-token-${harness.mints}` }, error: null };
      }),
    },
  },
}));

vi.mock("@twilio/voice-sdk", () => {
  class FakeCall {
    handlers: Record<string, () => void> = {};
    disconnected = false;
    parameters: Record<string, string> = {};
    on(event: string, handler: () => void) {
      this.handlers[event] = handler;
    }
    disconnect() {
      this.disconnected = true;
      this.handlers.disconnect?.();
    }
  }
  class FakeDevice {
    token: string;
    destroyed = false;
    handlers: Record<string, () => void> = {};
    lastCall: InstanceType<typeof FakeCall> | null = null;
    constructor(token: string) {
      this.token = token;
      harness.devices.push({ token, destroyed: false, instance: this });
    }
    on(event: string, handler: () => void) {
      this.handlers[event] = handler;
    }
    async register() {
      if (harness.holdRegister) {
        await new Promise<void>((resolve) => {
          harness.registerGate = resolve;
        });
      }
      this.handlers.registered?.();
    }
    async connect() {
      this.lastCall = new FakeCall();
      return this.lastCall;
    }
    updateToken() { /* not exercised here */ }
    destroy() {
      const record = harness.devices.find((d) => d.instance === this);
      if (record) record.destroyed = true;
      this.destroyed = true;
    }
  }
  return { Device: FakeDevice };
});

vi.mock("./useLiveTranscript", () => ({
  useLiveTranscript: () => ({
    lines: [],
    state: "idle",
    intelligence: { whispers: [], commitments: [], atRisk: [], draftReady: null },
  }),
}));

import { VoiceDeviceProvider, useVoiceDevice } from "./VoiceDeviceProvider";

type VoiceValue = NonNullable<ReturnType<typeof useVoiceDevice>>;

let latestVoice: VoiceValue | null = null;

function Probe() {
  latestVoice = useVoiceDevice();
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  harness.tenantId = "tenant-a";
  harness.holdRegister = false;
  harness.registerGate = null;
  harness.mints = 0;
  harness.devices = [];
  latestVoice = null;
  // jsdom has no mediaDevices; call()'s mic probe needs a permissive stub.
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const renderProvider = () =>
  act(async () => {
    root.render(
      <VoiceDeviceProvider>
        <Probe />
      </VoiceDeviceProvider>,
    );
  });

describe("VoiceDeviceProvider workspace-scope teardown (INT-345)", () => {
  it("destroys the registered Device on tenant switch and re-mints under the new tenant", async () => {
    await renderProvider();
    await act(async () => {
      latestVoice?.warmUp();
    });

    // Booted + registered under tenant A.
    expect(harness.devices).toHaveLength(1);
    expect(harness.devices[0].token).toBe("synthetic-token-1");
    expect(latestVoice?.status).toBe("ready");
    expect(harness.devices[0].destroyed).toBe(false);

    // Switch the active workspace (no reload — the SPA in-shell switch path).
    await act(async () => {
      harness.tenantId = "tenant-b";
      await renderProvider();
    });

    // The tenant-A Device is destroyed; the surface resets to idle — tenant A's
    // registration, caller identity, and call state do not survive the switch.
    expect(harness.devices[0].destroyed).toBe(true);
    expect(latestVoice?.status).toBe("idle");

    // A new warm-up boots a FRESH device with a FRESH token under tenant B —
    // the previous token/Device is never reused.
    await act(async () => {
      latestVoice?.warmUp();
    });
    expect(harness.mints).toBe(2);
    expect(harness.devices).toHaveLength(2);
    expect(harness.devices[1].token).toBe("synthetic-token-2");
    expect(harness.devices[1].destroyed).toBe(false);
    expect(latestVoice?.status).toBe("ready");
  });

  it("discards a Device whose boot completed after the workspace already switched (mid-boot race)", async () => {
    harness.holdRegister = true;
    await renderProvider();

    await act(async () => {
      latestVoice?.warmUp();
    });

    // Register is held pending; switch the workspace while the boot is in flight.
    await act(async () => {
      harness.tenantId = "tenant-b";
      await renderProvider();
    });

    // Release the held registration — the boot finishes AFTER the switch.
    await act(async () => {
      harness.registerGate?.();
    });

    // The late Device was minted for tenant A and must be destroyed, never kept.
    expect(harness.devices).toHaveLength(1);
    expect(harness.devices[0].destroyed).toBe(true);
    expect(latestVoice?.status).toBe("idle");

    // The next boot is a fresh mint under tenant B.
    harness.holdRegister = false;
    await act(async () => {
      latestVoice?.warmUp();
    });
    expect(harness.mints).toBe(2);
    expect(harness.devices).toHaveLength(2);
    expect(harness.devices[1].token).toBe("synthetic-token-2");
  });

  it("ends a LIVE call and destroys the Device when the workspace switches mid-call", async () => {
    await renderProvider();
    await act(async () => {
      latestVoice?.warmUp();
    });
    const device = harness.devices[0].instance as unknown as {
      lastCall: { handlers: Record<string, () => void>; disconnected: boolean } | null;
    };

    // Dial and connect — the fake call fires accept once wired.
    await act(async () => {
      await latestVoice?.call("+15550001111");
    });
    const liveCall = device.lastCall;
    expect(liveCall).not.toBeNull();
    await act(async () => {
      liveCall?.handlers.accept?.();
    });
    expect(latestVoice?.status).toBe("in_call");
    expect(latestVoice?.activeCall?.number).toBe("+15550001111");

    // Switch workspace mid-call: the call belongs to the OLD tenant identity and
    // must be ended, the Device destroyed, and the call surface cleared — the new
    // workspace never shows the previous tenant's call.
    await act(async () => {
      harness.tenantId = "tenant-b";
      await renderProvider();
    });

    expect(liveCall?.disconnected).toBe(true);
    expect(harness.devices[0].destroyed).toBe(true);
    expect(latestVoice?.status).toBe("idle");
    expect(latestVoice?.activeCall).toBeNull();
  });

  it("keeps the Device when the tenant context merely resolves (no switch yet, nothing booted)", async () => {
    await renderProvider();
    await act(async () => {
      latestVoice?.warmUp();
    });
    expect(harness.devices).toHaveLength(1);

    // Re-render with the SAME tenant — must not tear anything down.
    await renderProvider();
    expect(harness.devices[0].destroyed).toBe(false);
    expect(latestVoice?.status).toBe("ready");
  });
});
