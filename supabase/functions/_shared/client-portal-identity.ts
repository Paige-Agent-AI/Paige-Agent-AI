/** Presentation only. Cura is the existing Client Success identity; PAIGE is
 * reserved for the owner's COO. Custom business names grant no authority.
 */
export function customerAgentName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return !name || /^paige$/i.test(name) ? "Cura" : name;
}
