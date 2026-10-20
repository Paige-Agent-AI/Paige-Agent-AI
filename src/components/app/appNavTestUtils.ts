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
  // Read only THIS trigger's menu, and give it a few ticks to mount: reading every open menu at once can pick
  // up the group just closed, or none at all, and the destinations then come back short.
  const selector = `[role="menu"][aria-labelledby="${trigger.id}"] [role="menuitem"]`;
  for (let tick = 0; tick < 20; tick++) {
    const items = Array.from(document.querySelectorAll<HTMLElement>(selector));
    if (items.length) return items;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  return [];
}

export async function closeMenus() {
  await act(async () => { press(document.activeElement ?? document.body, "Escape"); });
  // Wait until the menu has really closed and returned focus to its trigger. That focus lands a tick after the
  // menu unmounts; arriving while the next group's menu is open, it reads as a click outside and shuts it.
  for (let tick = 0; tick < 20 && document.querySelector('[role="menu"]'); tick++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
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
