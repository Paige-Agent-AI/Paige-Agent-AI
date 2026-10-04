// @vitest-environment node
// Migration F (2026-10-04): every placeholder check reads each piece of copy, never the serialized
// JSON. Serialized, a block array's (or a string array's) own brackets enclosed ordinary copy, so
// "Get your weekends back" read as a placeholder. Two checks carried it outside the database: the
// publish door's readiness mirror, and the block-edit guard that refuses a revision introducing a
// NEW placeholder. Both are pinned here; the door's full flow is in growth-publish-door.test.ts and
// the server's in supabase/tests/migration_f_growth_placeholder_check.sql.
import { describe, expect, it } from "vitest";
import { hasPlaceholder } from "../../supabase/functions/_shared/growth-publish-command/contract.ts";
import { newPlaceholders, placeholderTokens } from "../../supabase/functions/_shared/growth-blocks.ts";

describe("the publish door's placeholder mirror reads strings, not JSON", () => {
  it.each([
    [[{ type: "hero", title: "Get your weekends back" }]],
    [[{ type: "pricing", tiers: [{ features: ["Your weekly call", "Add-on support"] }] }]],
    [{ title: "Spring offer", keywords: ["your spring guide"] }],
    [[{ type: "hero", title: "[ your", subtitle: "add ]" }]],
    [[{ type: "hero", "[your_key]": "Get the weekends back" }]],
    [[{ type: "hero", title: "[Free] Download" }]],
    [null], [undefined], [42], [true],
  ])("ordinary copy is not a placeholder: %j", (value) => {
    expect(hasPlaceholder(value)).toBe(false);
  });

  it.each([
    ["[ADD_DATE]"],
    [[{ type: "hero", title: "Signed, [Your name]" }]],
    [[{ type: "faq", items: [{ q: "When?", a: ["soon", "[Add the webinar date]"] }] }]],
    [{ og: { description: "[Your description here]" } }],
    [[{ type: "text", body: "Starts [TBD]" }]],
  ])("a real placeholder inside one string is found: %j", (value) => {
    expect(hasPlaceholder(value)).toBe(true);
  });
});

describe("the block-edit guard counts placeholders per string", () => {
  it("a string array of ordinary copy is not a new placeholder", () => {
    const before = { type: "pricing", tiers: [{ name: "Core", features: ["Weekly call"] }] };
    const after = { type: "pricing", tiers: [{ name: "Core", features: ["Your weekly call", "Add-on support"] }] };
    expect([...placeholderTokens(after)]).toEqual([]);
    expect(newPlaceholders(before, after)).toEqual([]);
  });

  it("a real placeholder introduced by a revision is still caught, normalized", () => {
    const before = { type: "hero", title: "Join us" };
    const after = { type: "hero", title: "Join us on [ADD_WEBINAR_DATE]", subtitle: "Hosted by [Your  Name]" };
    expect(newPlaceholders(before, after).sort()).toEqual(["[add_webinar_date]", "[your name]"]);
    expect(newPlaceholders(after, { ...after, title: "Join us on [add_webinar_date]" })).toEqual([]);
  });

  it("a cyclic value does not throw", () => {
    const v: Record<string, unknown> = { title: "[ADD_X]" };
    v.self = v;
    expect([...placeholderTokens(v)]).toEqual(["[add_x]"]);
  });
});
