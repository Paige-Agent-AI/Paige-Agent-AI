import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_SCROLLBAR_SHOWN } from "./settings-scroll-owner";
import {
  SETTINGS_SCROLL_OWNER_CLASS,
  SETTINGS_VISIBLE_SCROLL_DESTINATIONS,
  holdsSettingsScrollFocus,
  settingsDestinationShowsScrollbar,
} from "@/components/tenant-shell/settings-scroll-contract";

/**
 * THE TWO HALVES OF THE OWNER'S SCROLL POLICY, LOCKED (2026-08-31).
 *
 *   · Connections/Calendars and Integrations are the authorized visible-scroll
 *     Settings surfaces. Other destinations keep their prior non-visible policy.
 *   · Clients, Campaigns/Growth, Compass, Command Center, Mind and Analytics keep
 *     their form-fitting, design-locked interaction policy. They must NOT become
 *     document-scrollable as a side effect of repairing Settings.
 *
 * The second half is the one that needs a test. A repair that makes Settings work
 * by loosening a SHARED rule silently changes every other surface that rule was
 * holding, and nothing would have caught it: the locked surfaces have no failing
 * assertion of their own, they just quietly start scrolling. An earlier revision
 * of this branch did exactly that — it excluded `[data-solo-screen-host]` from the
 * blanket clip outright, which un-clipped the host on `clients`, `growth` and
 * `compass` too.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE. These are source-contract assertions: they
 * prove the SELECTOR cannot reach a non-Settings surface, which is a property of
 * the cascade and is decidable from the text. They do not prove rendered geometry.
 * That is `scripts/live-drive/calendar-settings-usable-drive.mjs` (Settings) and
 * `scripts/live-drive/solo-locked-surfaces-drive.mjs` (the locked surfaces), both
 * driven inside the real merged `SoloApp`. Neither substitutes for the other, and
 * neither is authenticated production proof.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
/** Rules only — the comments in these files discuss the very selectors under test. */
const rules = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

const tokens = rules(read("src/solo/solo-tokens.css"));
const settings = rules(read("src/solo/settings.css"));
const drive = read("scripts/live-drive/settings-scroll-drive.mjs");
// Comment-stripped like the stylesheets: these assertions look for CODE, and the
// file's own comments quote the very class names and helpers under test — which
// would satisfy a `toMatch` with no implementation behind it, and false-fail the
// adder count below.
const settingsTsx = rules(read("src/solo/settings.tsx"));

describe("locked surfaces keep their form-fitting policy", () => {
  it("leaves the blanket inner-main clip exactly as it was", () => {
    // Unqualified and unweakened. If a future repair adds a `:not(...)` here, it
    // stops being a Settings exception and becomes a platform-wide behaviour
    // change for clients, growth and compass.
    expect(tokens).toMatch(/(^|\n)\.paige-solo main\{overflow:hidden!important\}/);
    expect(tokens).not.toMatch(/\.paige-solo main:not\([^)]*\)\{overflow:hidden!important\}/);
  });

  it("scopes the overflow exception so it cannot match a non-Settings host", () => {
    // Two independent qualifiers, both required: it must be SoloApp's own screen
    // host, AND it must carry the class `SoloSettings` puts there. A clients or
    // growth host satisfies the first and never the second.
    //
    // matchAll, not match: a non-global `match` inspects only the FIRST such rule,
    // so a second, broader exception added later in the file would pass unseen.
    // EVERY rule that re-opens the host must carry both qualifiers.
    const reopeners = [...tokens.matchAll(/\.paige-solo[^{}]*main[^{}]*\{[^}]*overflow:\s*auto\s*!important[^}]*\}/g)];
    expect(reopeners.length, "no rule re-opens the Settings host").toBeGreaterThan(0);
    for (const rule of reopeners) {
      expect(rule[0]).toContain("[data-solo-screen-host]");
      expect(rule[0]).toContain(".tcs-main--settings-scrollbar-hidden");
    }
  });

  it("keys the exception on a marker only Settings ever applies — repo-wide", () => {
    // The whole scoping argument rests on this. Grepping only `settings.tsx`
    // would let a new adder anywhere else silently widen the exception with this
    // test still green, so the invariant is checked where it actually lives: the
    // whole source tree, tests and this file excluded.
    const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
    const adders: string[] = [];
    for (const f of files) {
      const body = rules(readFileSync(resolve(process.cwd(), f), "utf8"));
      if (/(classList\.add|classList\.toggle|setAttribute\([^)]*class)[^;]*tcs-main--settings-scrollbar-hidden/.test(body)
          || /["'`]tcs-main--settings-scrollbar-hidden["'`]/.test(body)) {
        adders.push(f);
      }
    }
    expect(adders, `unexpected reference(s) to the Settings marker class`).toEqual([
      "src/solo/settings.tsx",
    ]);
    expect(settingsTsx).toMatch(/classList\.remove\("tcs-main--settings-scrollbar-hidden"\)/);
  }, 15_000);
});

describe("the shell hands Settings its focus back", () => {
  const shell = rules(read("src/components/tenant-shell/TenantCommandCenterShell.tsx"));

  // BEHAVIOURAL, not textual. The first version of these assertions compared the
  // shell's class literal against the surface's and nothing else. An independent
  // review executed them against an INVERTED guard, a guard moved AFTER the
  // `focus()` call, and a guard moved into a function nobody called — all three
  // stayed green. A string comparison cannot see any of that.
  it("matches the owner itself", () => {
    const el = document.createElement("main");
    el.className = SETTINGS_SCROLLBAR_SHOWN;
    expect(holdsSettingsScrollFocus(el)).toBe(true);
  });

  it("matches a control INSIDE the owner — the case `classList` missed", () => {
    // With focus one Tab into the content, a nav toggle or a resize across 1080px
    // re-runs the restore. A `classList` check on the active element does not match
    // a child, so the command field took focus and End left scrollTop at 0.
    const el = document.createElement("main");
    el.className = SETTINGS_SCROLLBAR_SHOWN;
    const button = document.createElement("button");
    el.appendChild(button);
    expect(holdsSettingsScrollFocus(button)).toBe(true);
  });

  it("does NOT match anything outside the owner", () => {
    // The other direction matters as much: too broad a guard would stop every
    // non-Settings route ever getting the command field back.
    const outside = document.createElement("button");
    outside.className = "tcs-command-field";
    expect(holdsSettingsScrollFocus(outside)).toBe(false);
    expect(holdsSettingsScrollFocus(null)).toBe(false);
  });

  it("is the SAME symbol the surface applies, not a copied literal", () => {
    // Compiler-checked rather than string-compared. The two used to be duplicated
    // literals kept in step by a test that could not detect the ways they break.
    expect(SETTINGS_SCROLLBAR_SHOWN).toBe(SETTINGS_SCROLL_OWNER_CLASS);
  });

  it("is called by the shell BEFORE it focuses the command field, and not negated", () => {
    // The residual textual check, narrowed to the two mutations a predicate test
    // cannot see: order, and negation.
    const restore = shell.slice(shell.indexOf("const restore = () => {"));
    const body = restore.slice(0, restore.indexOf("};"));
    const guardAt = body.indexOf("holdsSettingsScrollFocus(document.activeElement)");
    const focusAt = body.indexOf("data-tenant-paige-command");
    expect(guardAt, "the shell no longer calls the shared guard").toBeGreaterThan(-1);
    expect(focusAt, "the shell no longer restores the command field").toBeGreaterThan(-1);
    expect(guardAt, "the guard runs AFTER the focus call — it is dead code").toBeLessThan(focusAt);
    expect(body.slice(guardAt - 4, guardAt)).not.toContain("!");
    expect(body.slice(guardAt)).toMatch(/^holdsSettingsScrollFocus\(document\.activeElement\)\)\s*return;/);
  });
});

describe("Settings gets one visible, usable scroll owner", () => {
  it("resolves the owner through the one shared helper, never a local copy", () => {
    // `SoloSettings` and any surface inside it must agree on WHICH element
    // scrolls. When they drifted, the surface dressed an element with no scroll
    // extent while the real owner kept none.
    expect(settingsTsx).toMatch(/settingsScrollOwner/);
    expect(settingsTsx).not.toMatch(/closest<HTMLElement>\("\[data-solo-screen-host\]"\)/);
  });

  it("makes the owner focusable and takes focus only when nothing else holds it", () => {
    expect(settingsTsx).toMatch(/setAttribute\("tabindex", "-1"\)/);
    expect(settingsTsx).toMatch(/document\.activeElement === document\.body/);
    expect(settingsTsx).toMatch(/focus\(\{ preventScroll: true \}\)/);
  });

  it("restores the shell on unmount, blurring before the attribute goes", () => {
    const cleanup = settingsTsx.slice(settingsTsx.indexOf("return () => {"));
    const blurAt = cleanup.indexOf("scrollOwner.blur()");
    const removeAt = cleanup.indexOf('removeAttribute("tabindex")');
    expect(blurAt).toBeGreaterThan(-1);
    expect(removeAt).toBeGreaterThan(-1);
    // Removing `tabindex` does not itself blur, and once the element is not
    // focusable `blur()` is not reliably honoured.
    expect(blurAt).toBeLessThan(removeAt);
  });

  it("undoes BOTH scrollbar suppression lanes — declarations, not just selectors", () => {
    // Undoing one lane leaves the bar hidden in the other. And a single-class
    // override ties on specificity, leaving source order to decide — which it
    // loses, because `settings.css` is imported after the surfaces it dresses.
    //
    // The DECLARATIONS are asserted, not merely that a selector exists followed
    // by a brace: an earlier version of this test passed against a rule whose body
    // said `scrollbar-width: none`, which is the exact behaviour it is named for.
    const both = "\\.tcs-main--settings-scrollbar-hidden\\.tcs-main--settings-scrollbar-shown";
    const standard = settings.match(new RegExp(both + "\\s*\\{([^}]*)\\}"));
    expect(standard, "no standard-property override").toBeTruthy();
    expect(standard![1]).toMatch(/scrollbar-width:\s*auto/);
    expect(standard![1]).not.toMatch(/scrollbar-width:\s*none/);

    const webkit = settings.match(new RegExp(both + "::-webkit-scrollbar\\s*\\{([^}]*)\\}"));
    expect(webkit, "no pseudo-element override").toBeTruthy();
    expect(webkit![1]).toMatch(/display:\s*block/);
    expect(webkit![1]).toMatch(/width:\s*[1-9]/);
  });

  it("defeats the Solo form-fit overflow law only for Settings and reserves the gutter", () => {
    const scoped = settings.match(
      /\.paige-solo main\[data-solo-screen-host\]\.tcs-main--settings-scrollbar-hidden\.tcs-main--settings-scrollbar-shown\s*\{([^}]*)\}/,
    );
    expect(scoped, "no Settings-scoped overflow override").toBeTruthy();
    expect(scoped![1]).toMatch(/overflow-y:\s*auto\s*!important/);
    expect(scoped![1]).toMatch(/overflow-x:\s*hidden\s*!important/);

    const both = settings.match(
      /\.tcs-main--settings-scrollbar-hidden\.tcs-main--settings-scrollbar-shown\s*\{([^}]*)\}/,
    );
    expect(both, "no visible scrollbar contract").toBeTruthy();
    expect(both![1]).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("resets the shared owner when an in-page Connections segment changes", () => {
    expect(settingsTsx).toMatch(/function ConnectionsView\(\{ initialSegment, onSegmentChange \}/);
    expect(settingsTsx).toMatch(/const changeView = useCallback[\s\S]*setView\(nextView\);[\s\S]*useEffect\(\(\) => \{[\s\S]*onSegmentChange\?\.\(\)[\s\S]*\}, \[view, onSegmentChange\]\)/);
    expect(settingsTsx).toMatch(/onClick=\{\(\) => changeView\(key\)\}/);
    expect(settingsTsx).toMatch(/view === "registration"/);
    expect(settingsTsx).toMatch(/<ConnectionsView initialSegment=\{segment\} onSegmentChange=\{resetSettingsScroll\}/);
    expect(settingsTsx).toMatch(/scrollOwner\.scrollTop = 0/);
  });

  it("keeps executable failure injections inside the cleanup boundary", () => {
    expect(drive).toMatch(/FLOW_FORCE_VITE_FAILURE/);
    expect(drive).toMatch(/FLOW_FORCE_BROWSER_FAILURE/);
    expect(drive).toMatch(/FLOW_FORCE_ASSERTION_FAILURE/);
    expect(drive).toMatch(/finally\s*\{[\s\S]*stopProcessTree\(vite\)/);
    expect(drive).toMatch(/viewports:\s*RUN_VIEWPORTS/);
    expect(drive).toMatch(/expectedScreenshots = RUN_VIEWPORTS\.length \* RUN_THEMES\.length \* 3/);
    expect(drive).toMatch(/PAIGE opens once beside Setup/);
    expect(drive).toMatch(/folding PAIGE restores Setup End/);
    expect(drive).toMatch(/PAIGE opens once beside overflowing Connections/);
    expect(drive).toMatch(/second PAIGE fold restores Connections PageDown/);
  });

  it("scores that the theme axis reaches the rendered shell, not just the loop", () => {
    // The drive iterated light and dark for weeks while the shell rendered one
    // palette both times. An axis is covered only when something rendered
    // changes with it, so this asserts a computed token, per environment.
    expect(drive).toMatch(/theme actually reaches the rendered shell/);
    expect(drive).toMatch(/#100e14/);
    expect(drive).toMatch(/#fbf9f5/);
    // And the harness must not go back to the prop that broke it.
    const harness = read("scripts/live-drive/harness/settings-mount/main.tsx");
    expect(harness).toMatch(/defaultTheme=\{theme\}/);
    expect(rules(harness)).not.toMatch(/forcedTheme/);
  });
  it("decides the visible scrollbar through the one shared policy, never an inline list", () => {
    // The destination list used to be an inline `tab === "a" || tab === "b"` here.
    // That is how Setup ended up with `overflow-y: auto` and no scrollbar for
    // weeks: the surface silently overflowed, and the only place the policy was
    // written was a boolean expression no test could read as a policy. It now
    // lives in the shared shell contract, where it is a value with its own tests.
    expect(settingsTsx).toMatch(/settingsDestinationShowsScrollbar\(tab\)/);
    expect(settingsTsx).toMatch(/classList\.toggle\(SETTINGS_SCROLLBAR_SHOWN, visibleScroll\)/);
    expect(settingsTsx).not.toMatch(/const visibleScroll = tab === /);
    expect(settingsTsx).not.toMatch(/EVERY Settings destination/);
    expect(settings).not.toMatch(/:has\(> \.solo-settings\)/);
  });

  it("authorizes visible scroll only for Setup, Connections, Integrations and approved Analytics", () => {
    // Owner ruling 2026-09-02: Setup joins the authorized visible-scroll set,
    // because its real configuration content materially exceeds the viewport at
    // every supported Solo height. Measured before the ruling: 3,973-4,174px of
    // content in a 702-934px host, 78-82% below the fold, no scrollbar drawn.
    expect([...SETTINGS_VISIBLE_SCROLL_DESTINATIONS].sort())
      .toEqual(["analytics", "connections", "integrations", "setup"]);
    for (const dest of ["setup", "connections", "integrations", "analytics"]) {
      expect(settingsDestinationShowsScrollbar(dest), `${dest} must show its scrollbar`).toBe(true);
    }
  });

  it("leaves every SHORT Settings destination form-fitting", () => {
    // The exception does not widen to the destinations that genuinely fit. Each
    // of these was measured at exactly its host height, at all four viewports.
    for (const dest of ["team", "security-data", "vault", "billing"]) {
      expect(settingsDestinationShowsScrollbar(dest), `${dest} must stay form-fitting`).toBe(false);
    }
    // And it is not a default-open policy: an unknown destination stays clipped.
    expect(settingsDestinationShowsScrollbar("clients")).toBe(false);
    expect(settingsDestinationShowsScrollbar("")).toBe(false);
  });

  it("keeps the drive's authorized set identical to the product's", () => {
    // Two lists that must agree, previously kept in step by nobody. If the drive
    // still classified Setup as form-fitting it would assert `canvasH <= clientH`
    // on a surface the product now scrolls, and fail for the opposite reason.
    const driveSet = drive.match(/VISIBLE_SCROLL_DESTINATIONS = new Set\(\[([^\]]*)\]\)/);
    expect(driveSet, "the drive no longer declares its authorized set").toBeTruthy();
    const declared = [...driveSet![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(declared).toEqual([...SETTINGS_VISIBLE_SCROLL_DESTINATIONS].sort());
  });
});
