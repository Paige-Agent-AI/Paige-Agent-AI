/**
 * THE ONE CONTRACT BETWEEN SHARED SHELL CHROME AND A SETTINGS SURFACE.
 *
 * The shell restores focus to the PAIGE command field on every route change while
 * the rail is folded. A Settings destination deliberately focuses the element that
 * scrolls it, and that focus has to survive the restore — otherwise End, PageDown
 * and Space do nothing until the human clicks or Tabs back into the page.
 *
 * This module owns the class and the predicate so the two sides are linked by the
 * compiler. The first version of the guard duplicated the class literal into the
 * shell with a test asserting the strings matched; an independent review showed
 * that assertion stayed green against an INVERTED guard, a guard moved after the
 * `focus()` call, and a guard moved into a function nobody called. A string
 * comparison cannot see any of that. A shared predicate can be tested directly.
 *
 * The dependency points the right way: shared chrome owns the contract and the
 * tier consumes it, so `src/solo` imports from here and never the reverse.
 */
export const SETTINGS_SCROLL_OWNER_CLASS = "tcs-main--settings-scrollbar-shown";

/**
 * True when focus is on the Settings scroll owner OR anywhere inside it.
 *
 * `closest`, not `classList.contains`. The reviewer drove the difference: with
 * focus one Tab into the content, a nav toggle (Ctrl+Alt+\) or a window resize
 * across 1080px re-runs the restore, and a `classList` check on the active element
 * does not match a CHILD of the owner — so the command field took focus and `End`
 * left `scrollTop` at 0 of 649. That is the exact symptom the guard exists to
 * remove, still reachable one Tab in.
 *
 * Widening to `closest` cannot widen the guard's REACH, because only `SoloSettings`
 * ever applies the class — it only stops the guard missing the subtree it already
 * meant to cover.
 */
export function holdsSettingsScrollFocus(element: Element | null): boolean {
  return !!element?.closest?.(`.${SETTINGS_SCROLL_OWNER_CLASS}`);
}

/**
 * WHICH SETTINGS DESTINATIONS DRAW A VISIBLE SCROLLBAR — the policy, as a value.
 *
 * Owner ruling, 2026-09-02: *a Settings surface may use a clearly visible,
 * accessible main-content scrollbar when real configuration content materially
 * exceeds the available viewport.* Setup is explicitly authorized; Connections
 * (with Calendars) and Integrations were already. Everything else in Settings —
 * and every surface outside it — keeps the Solo form-fit policy.
 *
 * This is a shared VALUE rather than an expression inside `SoloSettings` because
 * of how the defect it repairs stayed invisible. The policy used to be
 * `const visibleScroll = tab === "connections" || tab === "integrations"`, and the
 * only test of it asserted that exact source line. So Setup — which resolves
 * `overflow-y: auto` from the same shared exception and merely never received the
 * class that DRAWS the bar — overflowed its host by 3,282px at 1366x768 with no
 * affordance at all, and every guard stayed green, because a boolean expression
 * cannot be read as a policy by anything except the eye that wrote it.
 *
 * Two consumers now read this one declaration: `SoloSettings`, which toggles the
 * class, and `settings-scroll-drive.mjs`, which decides whether to assert a
 * scrollbar and a reachable end or to assert that nothing is clipped. When those
 * two disagreed the drive would fail a correct surface for the opposite reason.
 *
 * ADDING A DESTINATION HERE IS A PRODUCT DECISION, NOT A REPAIR. It widens an
 * exception the Solo shell contract deliberately keeps narrow
 * (`docs/doctrine/solo-shell-contract.md`), and it requires an owner ruling.
 * Nothing outside Settings may consult this: the surfaces held form-fitting by
 * `.paige-solo main{overflow:hidden!important}` are design-locked separately.
 */
export const SETTINGS_VISIBLE_SCROLL_DESTINATIONS: ReadonlySet<string> = new Set([
  "setup",
  "connections",
  "integrations",
  "analytics", // INT-340 owner-approved Settings child, 2026-10-07.
]);

/**
 * True when this Settings destination is authorized to draw its scrollbar.
 *
 * Fails CLOSED for anything unrecognised: a destination nobody has ruled on stays
 * form-fitting, which is the safe direction — a surface that should scroll and
 * does not is a visible defect, while one that scrolls and should not silently
 * changes a design-locked interaction policy.
 */
export function settingsDestinationShowsScrollbar(destination: string): boolean {
  return SETTINGS_VISIBLE_SCROLL_DESTINATIONS.has(destination);
}
