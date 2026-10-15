// @vitest-environment node
// The Studio publish lifecycle (Migration E) is governed like every other write: each act is declared
// through the capability kit, classified in the one risk policy, and handed to the door through one
// lookup. A declaration whose risk contradicts action-risk.ts throws when its module first loads; pin
// it here so the mismatch fails in CI rather than at the door's first cold start.
import { describe, expect, it } from "vitest";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
import { getSpineCapability } from "../../supabase/functions/_shared/paige-spine/registry.ts";
import { STUDIO_PUBLISH_KIT_BY_ACTION } from "../../supabase/functions/_shared/paige-spine/domains/studio_publish.ts";
import { GROWTH_PAGE_UNPUBLISH_CAPABILITY } from "../../supabase/functions/_shared/paige-spine/domains/growth_page.ts";
import { GROWTH_FORM_UNPUBLISH_CAPABILITY } from "../../supabase/functions/_shared/paige-spine/domains/growth_form.ts";
import { GROWTH_FUNNEL_UNPUBLISH_CAPABILITY } from "../../supabase/functions/_shared/paige-spine/domains/growth_funnel.ts";
import {
  STUDIO_IMAGE_PUBLISH_CAPABILITY,
  STUDIO_IMAGE_UNPUBLISH_CAPABILITY,
} from "../../supabase/functions/_shared/paige-spine/domains/studio_image.ts";

const NEW_ACTS = [
  ["growth_page_unpublish", GROWTH_PAGE_UNPUBLISH_CAPABILITY, "growth_page.unpublish", "public.growth_page_unpublish", "page_id"],
  ["growth_form_unpublish", GROWTH_FORM_UNPUBLISH_CAPABILITY, "growth_form.unpublish", "public.growth_form_unpublish", "form_id"],
  ["growth_funnel_unpublish", GROWTH_FUNNEL_UNPUBLISH_CAPABILITY, "growth_funnel.unpublish", "public.growth_funnel_unpublish", "funnel_id"],
  ["studio_image_publish", STUDIO_IMAGE_PUBLISH_CAPABILITY, "studio_image.publish", "public.studio_image_publish", "image_id"],
  ["studio_image_unpublish", STUDIO_IMAGE_UNPUBLISH_CAPABILITY, "studio_image.unpublish", "public.studio_image_unpublish", "image_id"],
] as const;

describe("Studio publish lifecycle is governed", () => {
  it.each(NEW_ACTS)("%s is high, ask-first, on its canonical RPC, with a Rail receipt", (key, cap, id, rpc, idField) => {
    expect(classifyAction(key)).toBe("high");
    expect(cap.governance).toMatchObject({ actionRiskKey: key, risk: "high", approval: "confirm" });
    expect(cap.identity.id).toBe(id);
    expect(cap.effect).toBe("mutation");
    expect(cap.providerBinding).toMatchObject({ kind: "internal", operation: rpc });
    expect(cap.idempotency).toMatchObject({ mode: "required", readback: rpc });
    expect(cap.receipt).toMatchObject({ rail: true, recorder: "record_capability_run" });
    expect(cap.input.required).toEqual([idField]);
  });

  it("the door's lookup holds exactly the eight publish acts, each under its own key", () => {
    expect(Object.keys(STUDIO_PUBLISH_KIT_BY_ACTION).sort()).toEqual([
      "growth_form_publish", "growth_form_unpublish",
      "growth_funnel_publish", "growth_funnel_unpublish",
      "growth_page_publish", "growth_page_unpublish",
      "studio_image_publish", "studio_image_unpublish",
    ]);
    for (const [key, cap] of Object.entries(STUDIO_PUBLISH_KIT_BY_ACTION)) {
      // What decideDeclaredCapability requires of a governed mutation, checked here so the door's
      // first call cannot be the place it is discovered.
      expect(cap.governance.actionRiskKey).toBe(key);
      expect(classifyAction(key)).toBe(cap.governance.risk);
      expect([cap.governance.risk, cap.governance.approval, cap.receipt.recorder]).toEqual(["high", "confirm", "record_capability_run"]);
    }
  });

  it("door-only acts are NOT claimed as Chat-bound Spine capabilities (no chat tool carries them)", () => {
    for (const [, , id] of NEW_ACTS) expect(getSpineCapability(id)).toBeUndefined();
    // The three publish acts keep their existing Chat-bound Spine entries.
    for (const id of ["growth_page.publish", "growth_form.publish", "growth_funnel.publish"]) {
      expect(getSpineCapability(id)?.action).toMatchObject({ riskPolicyKey: "high", approvalAuthority: "chat-canonical" });
    }
  });
});
