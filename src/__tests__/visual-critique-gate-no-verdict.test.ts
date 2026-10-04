// @vitest-environment node
// The design agent's critique loop (paige-ai-chat's image path) must treat a NO_VERDICT answer as
// "no review": keep the image it already has, never regenerate from it, and attach no verdict.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => undefined } };
});
afterAll(() => { delete (globalThis as unknown as { Deno?: unknown }).Deno; });

async function loop(answer: Record<string, unknown>) {
  // A computed specifier keeps the app's tsc (which has no Deno types) out of the Deno module graph;
  // vitest still loads the real file.
  const gatePath = "../../supabase/functions/_shared/visual-critique-gate.ts";
  type GeneratedImage = { url?: string };
  const { critiqueImageAndIterate } = (await import(/* @vite-ignore */ gatePath)) as {
    critiqueImageAndIterate: (opts: {
      client: { functions: { invoke: (name: string, args: { body: unknown }) => Promise<{ data: unknown; error: unknown }> } };
      image: GeneratedImage; brief: string; regenerate: (p: string) => Promise<GeneratedImage | null>;
    }) => Promise<{ image: GeneratedImage; critique: { ok: boolean; verdict?: string } | null }>;
  };
  const invoke = vi.fn(async () => ({ data: answer, error: null }));
  const regenerate = vi.fn(async () => ({ url: "https://img.test/regenerated.png" }));
  const original = { url: "https://img.test/original.png" };
  const out = await critiqueImageAndIterate({ client: { functions: { invoke } }, image: original, brief: "hero", regenerate });
  return { out, invoke, regenerate, original };
}

describe("visual-critique-gate and NO_VERDICT", () => {
  it.each(["critique_failed", "critique_unavailable", "image_unavailable", "screenshot_service_unavailable"])(
    "%s → keeps the original image, no regeneration, no verdict attached", async (reason) => {
      const { out, invoke, regenerate, original } = await loop({ ok: false, verdict: "NO_VERDICT", reason, message: "no review" });
      expect(invoke).toHaveBeenCalledOnce();
      expect(regenerate).not.toHaveBeenCalled();
      expect(out.image).toBe(original);
      expect(out.critique?.ok).toBe(false);
      // paige-ai-chat attaches a verdict only when critique.ok — so nothing is shown as reviewed.
      expect(out.critique?.ok ? out.critique.verdict : undefined).toBeUndefined();
    });

  it("a disabled answer (the edge flag is off) is no review: original kept, nothing regenerated", async () => {
    const { out, regenerate, original } = await loop({ ok: false, status: "disabled", message: "Image critique is switched off" });
    expect(regenerate).not.toHaveBeenCalled();
    expect(out.image).toBe(original);
    expect(out.critique?.ok).toBe(false);
  });

  it("an ITERATE verdict still regenerates (the loop itself is unchanged)", async () => {
    const { regenerate } = await loop({ ok: true, verdict: "ITERATE", refined_prompt: "bolder headline", spent_usd: 0.01 });
    expect(regenerate).toHaveBeenCalledWith("bolder headline");
  });
});
