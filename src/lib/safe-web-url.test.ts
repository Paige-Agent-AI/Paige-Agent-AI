import { describe, expect, it } from "vitest";
import { safeWebUrl } from "./safe-web-url";

describe("safeWebUrl (#2090)", () => {
  it.each(["https://example.com", "http://example.com/a?b=1#c", "https://example.com:8443/x", "HTTPS://Example.com/Path"])(
    "keeps %s", (u) => expect(safeWebUrl(u)).not.toBeNull());
  it.each([
    "javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x",
    "//evil.example", "/thanks", "example.com/thanks", "ftp://example.com", "mailto:a@b.c", "https://", "https://a.com/ b",
    "https://a.com\\@evil.example", "http:\\\\evil.example", `https://a.com/${"a".repeat(2048)}`, "", null, undefined, 42, { href: "https://a.com" },
  ])("drops %s", (u) => expect(safeWebUrl(u)).toBeNull());
});
