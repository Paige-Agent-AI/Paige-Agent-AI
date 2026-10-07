/** The preview proposal remains authority. Its canonical card supplies only the
 * original request shape required by the existing CRM door's validation. */
export async function selectPinnedPreviewRequest(input: {
  tool: string;
  fingerprint: string;
  storedArgs: unknown;
  cards: unknown;
  capabilities: Readonly<Record<string, string>>;
  subject(command: Record<string, unknown>): Promise<string>;
}): Promise<{ command: Record<string, unknown>; idempotency_key: string } | null> {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!object(input.storedArgs) || !object(input.storedArgs.command) || !Array.isArray(input.cards)) return null;
  const stored = input.storedArgs.command;
  if (typeof stored.action !== "string" || input.capabilities[stored.action] !== input.tool
      || typeof stored.preview_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored.preview_id)
      || typeof input.storedArgs.idempotency_key !== "string" || !input.storedArgs.idempotency_key
      || typeof input.storedArgs.approval_subject !== "string") return null;
  const matching = input.cards.filter((card) => object(card) && card.tool === input.tool && card.fingerprint === input.fingerprint);
  if (matching.length !== 1) return null;
  const card = matching[0];
  if (!object(card) || !object(card.command) || card.command.action !== stored.action
      || card.idempotency_key !== input.storedArgs.idempotency_key
      || (card.command.preview_id !== undefined && card.command.preview_id !== stored.preview_id)) return null;
  if (await input.subject(card.command) !== input.storedArgs.approval_subject) return null;
  return { command: card.command, idempotency_key: input.storedArgs.idempotency_key };
}
