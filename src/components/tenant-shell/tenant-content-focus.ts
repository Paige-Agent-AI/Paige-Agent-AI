/** A mounted destination that has deliberately taken focus keeps it after PAIGE folds.
 * Includes native fields and tabs; it grants no route, scroll or execution authority. */
export function holdsTenantContentFocus(element: Element | null): boolean {
  return !!element?.closest?.("#tenant-shell-main");
}
