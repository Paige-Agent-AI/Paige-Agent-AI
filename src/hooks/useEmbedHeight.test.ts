import { afterEach, describe, expect, it } from "vitest";
import { embeddedFormTheme } from "./useEmbedHeight";

const at = (url: string) => window.history.replaceState(null, "", url);

describe("embeddedFormTheme", () => {
  afterEach(() => at("/"));
  it("leaves the app's own theme alone everywhere but an embedded form", () => {
    at("/form/abc"); expect(embeddedFormTheme()).toBeUndefined();
    at("/book/discovery?embed=1"); expect(embeddedFormTheme()).toBeUndefined();
    at("/solo/12?embed=1"); expect(embeddedFormTheme()).toBeUndefined();
  });
  it("draws an embedded form light unless the embed code asked for dark or auto", () => {
    at("/form/abc?embed=1"); expect(embeddedFormTheme()).toBe("light");
    at("/form/abc?embed=1&theme=dark"); expect(embeddedFormTheme()).toBe("dark");
    at("/form/abc?embed=1&theme=auto"); expect(embeddedFormTheme()).toBeUndefined();
    at("/form/abc?embed=1&theme=neon"); expect(embeddedFormTheme()).toBe("light");
  });
});
