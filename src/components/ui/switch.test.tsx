import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Switch } from "./switch";

// WCAG 1.4.11: an enabled switch that is OFF must still be identifiable at 3:1 against its background.
// The shared track used to be the --input fill only (1.53:1 light, 1.27:1 dark, measured in the E09 Slice 6
// harness). The off state now draws its edge and its thumb in --muted-foreground, which the token set holds
// at text contrast in both themes; the harness measures the composited ratio on every frame.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Switch primitive", () => {
  it("draws the off state's edge and thumb in the muted-foreground token, and keeps the indigo primary when on", () => {
    act(() => root.render(<Switch aria-label="Example" />));
    const track = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    const thumb = track.querySelector("span")!;
    expect(track.className).toContain("data-[state=unchecked]:border-muted-foreground");
    expect(thumb.className).toContain("data-[state=unchecked]:bg-muted-foreground");
    expect(track.className).toContain("data-[state=checked]:bg-primary");
    expect(track.className).not.toMatch(/gold|accent/);
  });
});
