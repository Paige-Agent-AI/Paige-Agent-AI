import { describe, expect, it, vi } from "vitest";

describe("unit environment isolation (#1486)", () => {
  it("never inherits a real backend address or credential from the committed env", () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBe("https://unit-test.invalid");
    expect(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe("unit-test-public-key");
  });

  it("the real Supabase consumer resolves only the test address", async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL) => new Response("[]", {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", transport);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.from("clients").select("id");
      expect(transport).toHaveBeenCalledOnce();
      // Observe the attempted destination through a fake transport; never contact a backend.
      expect(new URL(String(transport.mock.calls[0][0])).hostname).toBe("unit-test.invalid");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
