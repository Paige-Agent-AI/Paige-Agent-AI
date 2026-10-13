import { afterEach, describe, expect, it, vi } from "vitest";
import { isFormOnBusinessSite } from "./useEmbedHeight";

// Which page loads stay clear of Paige's own product analytics: a form shown on a business's own website.
describe("isFormOnBusinessSite", () => {
  const at = (path: string, framed = false) => {
    window.history.replaceState(null, "", path);
    vi.spyOn(window, "parent", "get").mockReturnValue((framed ? {} : window) as Window);
  };
  afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

  it("is true for a form framed on another site, or asked for with ?embed=1", () => {
    at("/form/f-1", true); expect(isFormOnBusinessSite()).toBe(true);
    at("/form/f-1?embed=1"); expect(isFormOnBusinessSite()).toBe(true);
  });
  it("is false for the form's own page and for every other page, framed or not", () => {
    at("/form/f-1"); expect(isFormOnBusinessSite()).toBe(false);
    at("/book/discovery-call", true); expect(isFormOnBusinessSite()).toBe(false);
    at("/solo/1?embed=1"); expect(isFormOnBusinessSite()).toBe(false);
  });
});
