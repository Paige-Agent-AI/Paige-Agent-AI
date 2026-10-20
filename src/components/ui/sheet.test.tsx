import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SheetContent close button", () => {
  it("is a 44px touch target around the same 16px icon (the AppNav drawer pattern)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <Sheet open>
          <SheetContent aria-describedby={undefined}>
            <SheetTitle>Panel</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
    });
    const close = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Close"))!;
    // A real 44px box at top-1/right-1 (px, not rem: the Solo shell scales rem) keeps the 16px icon where top-4/right-4 drew it (within 2px).
    expect(close.className).toContain("h-[44px]");
    expect(close.className).toContain("w-[44px]");
    expect(close.className).toContain("top-1");
    expect(close.className).toContain("right-1");
    expect(close.querySelector("svg")!.getAttribute("class")).toContain("h-4 w-4");
    await act(async () => root.unmount());
    host.remove();
  });
});
