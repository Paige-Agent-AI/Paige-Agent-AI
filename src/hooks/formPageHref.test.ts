import { describe, expect, it } from "vitest";
import { formPageHref } from "@/hooks/useEmbedHeight";

describe("formPageHref", () => {
  it("is the form's own page, keeping the visit's campaign tags and dropping the embedded presentation", () => {
    expect(formPageHref("https://paigeagent.ai/form/f-1?embed=1&theme=dark&utm_campaign=spring&utm_source=news"))
      .toBe("https://paigeagent.ai/form/f-1?utm_campaign=spring&utm_source=news");
  });
});
