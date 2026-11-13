import { describe, expect, it } from "vitest";
import { normalizeFormFutureTags, parseFormFutureTagsInput } from "../../../supabase/functions/_shared/growth/form-intake-tags";

describe("future form tag setting grammar", () => {
  it("matches native space trimming and case-sensitive first occurrence order without editing its input", () => {
    const input = ["  VIP  ", "A, B", "VIP", "vip", " distinct "];
    expect(normalizeFormFutureTags(input)).toEqual({ ok: true, tags: ["VIP", "A, B", "vip", " distinct "] });
    expect(input[0]).toBe("  VIP  ");
  });
  it("counts Unicode characters consistently with native character length", () => {
    expect(normalizeFormFutureTags(["😀".repeat(80)]).ok).toBe(true);
    expect(normalizeFormFutureTags(["😀".repeat(81)]).ok).toBe(false);
  });
  it("allows 50 unique tags and repeated equivalents, refuses the 51st unique tag", () => {
    const tags = Array.from({ length: 50 }, (_, i) => `Tag ${i}`);
    expect(normalizeFormFutureTags([...tags, " Tag 0 "])).toEqual({ ok: true, tags });
    expect(normalizeFormFutureTags([...tags, "Additional"]).ok).toBe(false);
  });
  it.each([undefined, null, "VIP", [""], ["   "], [2], ["a\tb"], ["a\nb"], ["a\u007fb"], ["a\u0085b"]])("refuses malformed arrays or hidden controls %#", input => {
    expect(normalizeFormFutureTags(input).ok).toBe(false);
  });
  it("keeps commas inside a tag and accepts ordinary line endings and an explicit empty setting", () => {
    expect(parseFormFutureTagsInput("A, B\r\n VIP \r\n\n")).toEqual({ ok: true, tags: ["A, B", "VIP"] });
    expect(parseFormFutureTagsInput(" \n")).toEqual({ ok: true, tags: [] });
  });
  it("refuses excessive paste length rather than silently truncating it", () => {
    expect(parseFormFutureTagsInput(" ".repeat(8051)).ok).toBe(false);
  });
});
