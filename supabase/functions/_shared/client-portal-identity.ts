/** Presentation only. Cura is the Client Success agent PAIGE assigns to a business's customers;
 * PAIGE is the owner's COO and is never the name a customer reads (owner ruling, 2026-10-19).
 * A business may rename its agent, but a name that is PAIGE, or wraps it ("Paige AI", "Ask Paige",
 * "PaigeAgent"), falls back to Cura. Custom business names grant no authority.
 */
const PAIGE_NAME = /(^|[^a-z])paige($|[^a-z]|agent)/i;

export function customerAgentName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return !name || PAIGE_NAME.test(name) ? "Cura" : name;
}

const SELF_NAMED_PAIGE = /\b(You are|you are|You're|you're|I'm|I am)\s+(?:PAIGE|Paige)\b/g;

/**
 * A client seat's prompt, re-voiced as the customer's agent. The owner's prompt blocks introduce the
 * model as PAIGE ("You are Paige.", "you're Paige, an AI assistant", "I'm Paige —"); a client of the
 * business is never told that. Only the self-introduction changes; every other word is kept, so the
 * instructions themselves are not rewritten. The native Customer Portal branch builds its own persona
 * (client-portal-persona.ts) and never needs this.
 */
export function customerSeatIdentity(text: string, name: string = customerAgentName(undefined)): string {
  return text.replace(SELF_NAMED_PAIGE, (_match, lead: string) => `${lead} ${name}`);
}
