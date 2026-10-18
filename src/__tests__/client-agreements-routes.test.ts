import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// E09 Slice A — /app/agreements is the customer's own agreements (the page falls back to MyAgreements for anyone who
// is not a customer), and /app/agreements/platform keeps every customer's path to the PaigeAgent terms they accepted
// (§58). The signing page stays the frozen /sign/:token route (§28).
const app = readFileSync(resolve("src/App.tsx"), "utf8");
const lazyTarget = (name: string) => new RegExp(`const ${name} = lazyWithReload\\(\\(\\) => import\\("([^"]+)"\\)\\)`).exec(app)?.[1];
const routeElement = (path: string) => new RegExp(`<Route path="${path.replace(/[/:]/g, (c) => `\\${c}`)}" element={<PageSuspense><(\\w+) /></PageSuspense>} />`).exec(app)?.[1];

describe("customer agreements routes", () => {
  it("mounts the customer's agreements at /app/agreements and the platform terms at /app/agreements/platform", () => {
    expect(lazyTarget(routeElement("agreements")!)).toBe("./pages/app/Agreements");
    expect(lazyTarget(routeElement("agreements/platform")!)).toBe("./pages/MyAgreements");
  });

  it("leaves the frozen signing route alone", () => {
    expect(lazyTarget(routeElement("/sign/:token")!)).toBe("./pages/sign/AgreementSigning");
  });

  it("falls back to MyAgreements, unchanged, for anyone who is not a customer of a business", () => {
    const page = readFileSync(resolve("src/pages/app/Agreements.tsx"), "utf8");
    expect(page).toContain('const MyAgreements = lazy(() => import("@/pages/MyAgreements"));');
    expect(page).toMatch(/if \(view\.unavailable\) \{[\s\S]{0,200}<MyAgreements \/>/);
  });
});
