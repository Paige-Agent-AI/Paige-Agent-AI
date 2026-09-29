// Applies an approved `propose_client_update` proposal from the browser (Field Ingestion). Paige's
// MCP `confirm_proposal` applies the same proposal server-side (applyProposal in
// supabase/functions/paige-mcp/index.ts); this is the operator's twin of it and plans every address
// change with the same rules (src/lib/contact-method-intents.ts, pinned to the server's planner by
// src/lib/contact-method-intents.contract.test.ts).
//
// A contact's emails and phones are its contact methods, never columns on the contact row. A
// proposal records the address change that was ASKED for, as `payload.address_intent`, plus the
// list it was built on, `payload.contact_methods_built_on`:
//  - primary  "their email is X": X takes the current primary's place, planned against the list
//             held now. Refused when that list is no longer the one the proposal was built on, by
//             the database's own comparison — so what is written is the preview the approver saw.
//  - add      every address held is kept, including one added after the proposal; new ones append.
//  - replace  the complete list, refused if the stored list is no longer the one it was built on.
// An older proposal instead carries `updates.email` / `updates.phone` ("make this the primary"),
// planned against the list held now. The retired `payload.contact_methods` (a frozen copy of the
// whole resulting list) is refused, as the server refuses it: writing it back would undo any
// address added in between.
//
// All or nothing: the row patch is checked before anything is written; addresses are written
// first; if the row update then fails, the address change is put back (only if the list is still
// exactly what this write left). Any failure throws, so the caller never marks the proposal applied.
import { supabase } from "@/integrations/supabase/client";
import { CONTACT_METHODS_CHANGED_MESSAGE, readContactMethodRows, replaceContactMethods, type ContactMethodPayload } from "@/lib/contacts";
import {
  clientRowPatchProblem,
  heldInWriteOrder,
  planAddressWrite,
  storedAddressIntent,
  storedMethodList,
  withAddedMethods,
  type AddressIntent,
  type ContactMethodInput,
} from "@/lib/contact-method-intents";

export type ClientUpdateProposal = {
  client_id: string;
  /** The contact's workspace, recorded when the proposal was made. */
  tenant_id: string | null;
  payload: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
};

export const PROPOSAL_ADDRESSES_CHANGED =
  "This contact's emails or phones changed after Paige proposed this, so nothing was saved. Ask Paige to propose it again against the current list.";
export const PROPOSAL_FORMAT_RETIRED =
  "This proposal was made in an address format that is no longer applied, so nothing was saved. Ask Paige to propose it again.";
export const PROPOSAL_ADDRESS_UNREADABLE =
  "This proposal's address change could not be read, so nothing was saved. Ask Paige to propose it again.";

/** How many times an addition is rebuilt on a list that moved under it before it gives up. */
const ADD_RETRIES = 2;

const payloadOf = (methods: readonly ContactMethodInput[]): ContactMethodPayload[] =>
  methods.map((m) => ({ kind: m.kind, value: m.value, label: m.label ?? null, is_primary: m.is_primary === true }));

/** The address change a proposal asks for, and the list it was built on (null: plan on the list held now). */
function addressChangeOf(
  payload: Record<string, unknown>,
  legacy: { email?: unknown; phone?: unknown },
): { intent: AddressIntent; builtOn: ContactMethodInput[] | null } | null {
  const legacyKinds = (["email", "phone"] as const).filter((kind) => legacy[kind] !== undefined);
  if (payload.address_intent !== undefined) {
    const intent = storedAddressIntent(payload.address_intent);
    if (!intent || legacyKinds.length) throw new Error(PROPOSAL_ADDRESS_UNREADABLE);
    const builtOn = storedMethodList(payload.contact_methods_built_on);
    if (intent.op !== "add" && !builtOn) throw new Error(PROPOSAL_ADDRESS_UNREADABLE);
    return { intent, builtOn };
  }
  if (!legacyKinds.length) return null;
  const values: Partial<Record<"email" | "phone", string | null>> = {};
  for (const kind of legacyKinds) {
    const value = legacy[kind];
    if (value !== null && typeof value !== "string") throw new Error(PROPOSAL_ADDRESS_UNREADABLE);
    values[kind] = value as string | null;
  }
  return { intent: { op: "primary", values }, builtOn: null };
}

/**
 * Writes the address change against the list held now, through `upsert_contact`'s checked replace.
 * The browser has no unchecked "add": an addition is merged onto the list read now and written
 * checked against it, and rebuilt on the new list if another save lands in between — the same
 * outcome as the server's _add_client_contact_methods. A primary or replace is never rebuilt: the
 * approver saw the list it was built on, not the new one.
 */
async function writeAddressChange(
  clientId: string,
  tenantId: string | null,
  { intent, builtOn }: { intent: AddressIntent; builtOn: ContactMethodInput[] | null },
): Promise<{ before: ContactMethodInput[]; after: ContactMethodPayload[] }> {
  for (let attempt = 0; ; attempt += 1) {
    const before = heldInWriteOrder(await readContactMethodRows(clientId));
    const plan = planAddressWrite(intent, builtOn, before);
    if ("stale" in plan) throw new Error(PROPOSAL_ADDRESSES_CHANGED);
    const after = payloadOf(plan.rpc === "_add_client_contact_methods" ? withAddedMethods(before, plan.methods) : plan.methods);
    const expected = plan.rpc === "_add_client_contact_methods" ? before : plan.expected;
    try {
      await replaceContactMethods(clientId, after, { expected, tenantId });
      return { before, after };
    } catch (error) {
      const stale = error instanceof Error && error.message === CONTACT_METHODS_CHANGED_MESSAGE;
      if (stale && intent.op === "add" && attempt < ADD_RETRIES) continue;
      throw stale ? new Error(PROPOSAL_ADDRESSES_CHANGED) : error;
    }
  }
}

export async function applyClientUpdateProposal(proposal: ClientUpdateProposal): Promise<void> {
  const payload = proposal.payload ?? {};
  const updates = (payload.updates ?? {}) as Record<string, unknown>;
  const { email, phone, ...fields } = updates;
  const tenantId = proposal.tenant_id ?? null;

  if (Array.isArray(payload.contact_methods)) throw new Error(PROPOSAL_FORMAT_RETIRED);
  const change = addressChangeOf(payload, { email, phone });
  // Checked before anything is written: a patch the row would refuse (or an address key this
  // helper does not apply) sends the whole proposal back, rather than failing after its addresses
  // have landed.
  const rowProblem = clientRowPatchProblem(fields);
  if (rowProblem) throw new Error(rowProblem);

  // Addresses first: they are the part that can still be refused now, and a refusal there writes
  // nothing at all.
  const written = change ? await writeAddressChange(proposal.client_id, tenantId, change) : null;

  if (Object.keys(fields).length) {
    let update = supabase.from("clients").update(fields as never).eq("id", proposal.client_id);
    if (tenantId) update = update.eq("tenant_id", tenantId);
    const { data, error } = await update.select("id");
    // No row back means nothing was updated (the contact is gone, or not this workspace's): a
    // failure like any other, never "applied".
    const failure = error?.message ?? (Array.isArray(data) && data.length ? null : "The contact could not be updated.");
    if (failure) {
      if (written) {
        try {
          // Put the addresses back so the proposal is all-or-nothing — only if the list is still
          // exactly what this write left; if someone changed it since, the undo is refused.
          await replaceContactMethods(proposal.client_id, payloadOf(written.before), { expected: written.after, tenantId });
        } catch (undo) {
          throw new Error(
            `The address change was saved but the other fields were not (${failure}), and the address change could not be undone (${undo instanceof Error ? undo.message : String(undo)}).`,
          );
        }
      }
      throw new Error(failure);
    }
  }
}
