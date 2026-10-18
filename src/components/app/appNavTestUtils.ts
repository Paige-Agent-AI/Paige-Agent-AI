// Test helpers for the grouped customer portal menu (Slice M). Desktop groups with two or more entries are
// dropdown menus whose links only mount while open, so a test that needs every destination opens each group
// through the keyboard, exactly as a person on a keyboard would, reads it, and closes it with Escape.
import { act } from "react";

const press = (target: EventTarget, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

export const groupTriggers = (root: ParentNode = document) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-portal-group]"));

/** Open the desktop group whose trigger reads `name`, and return its menu items. */
export async function openGroup(name: string, root: ParentNode = document): Promise<HTMLElement[]> {
  const trigger = groupTriggers(root).find((b) => b.getAttribute("data-portal-group") === name);
  if (!trigger) throw new Error(`no desktop group named ${name}`);
  await act(async () => { press(trigger, "Enter"); });
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'));
}

export async function closeMenus() {
  await act(async () => { press(document.activeElement ?? document.body, "Escape"); });
}

/** Every /app destination in the desktop bar, in reading order, opening each group in turn. */
export async function desktopNavHrefs(root: ParentNode): Promise<string[]> {
  const nav = root.querySelector('nav[aria-label="Customer navigation"]');
  if (!nav) return [];
  const out: string[] = [];
  for (const el of Array.from(nav.querySelectorAll<HTMLElement>("a[href], button[data-portal-group]"))) {
    if (el.tagName === "A") { out.push(el.getAttribute("href") ?? ""); continue; }
    const items = await openGroup(el.getAttribute("data-portal-group") ?? "", root);
    out.push(...items.map((i) => i.getAttribute("href") ?? ""));
    await closeMenus();
  }
  return out.filter((h) => h.startsWith("/app"));
}
