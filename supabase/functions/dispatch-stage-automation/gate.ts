// The send gate in front of a stage automation, which hands one contact to an OUTSIDE sender (n8n, Zapier,
// Make, a custom endpoint) that never sees the business's suppression list. Pure over an injected client
// so the whole decision is testable without Deno.serve (gate.test.ts).
//
// Two rules, in order:
//   1. Opt-outs (E09 Slice 6, §37). A contact who turned a channel off THEMSELVES (portal choice, STOP,
//      unsubscribe click, complaint) is skipped for EVERY intent, transactional included: the outside
//      sender could message them on that channel and nothing downstream would stop it. A pause the
//      business holds does not skip the automation, but the payload names the paused channels
//      (`contact_opted_out_channels`) so the sender can honor them. A ledger that cannot be read holds.
//      §58 call-out: an automation that used to fire for a contact who opted out now skips.
//   2. Marketing consent (unchanged): marketing/nurture intents need the business's own recorded consent
//      for the contact's primary email (tenantConsent, default-deny).
import { CLIENT_CONTACT_METHODS_EMBED, clientAddresses } from "../_shared/contact-methods.ts";
import { tenantConsent } from "../_shared/tenant-consent.ts";
import { contactOptOuts, type OptOutChannel } from "../_shared/contact-opt-outs.ts";

export type ComposeIntent = "transactional" | "marketing" | "nurture" | "notification";

export const INTENT_TO_CONSENT: Record<ComposeIntent, "transactional" | "marketing"> = {
  transactional: "transactional",
  notification: "transactional",
  marketing: "marketing",
  nurture: "marketing",
};

export type StageGateDecision =
  | { kind: "skip"; status: "skipped_no_consent"; error: string; reason: "contact_opted_out" | "opt_outs_unknown" | "marketing_consent_missing" | "marketing_consent_unknown" }
  | { kind: "send"; optedOutChannels: OptOutChannel[] };

// deno-lint-ignore no-explicit-any
type Admin = { from: (table: string) => any };

export async function stageAutomationGate(
  admin: Admin,
  body: { tenant_id: string; contact_id: string | null; rule: { compose_intent: ComposeIntent } },
): Promise<StageGateDecision> {
  let email: string | null = null;
  let phone: string | null = null;
  let contactInTenant = false;
  if (body.contact_id) {
    const { data: client, error: clientErr } = await admin
      .from("clients")
      .select(`tenant_id, linked_user_id, ${CLIENT_CONTACT_METHODS_EMBED}`)
      .eq("id", body.contact_id)
      .maybeSingle();
    // The contact must belong to the business the event names.
    if (!clientErr && client && client.tenant_id === body.tenant_id) {
      contactInTenant = true;
      const addresses = clientAddresses(client);
      // Checked against the PRIMARY addresses — the ones a send goes to.
      email = addresses.email?.toLowerCase().trim() || null;
      phone = addresses.phone?.trim() || null;
    }
  }

  let optedOutChannels: OptOutChannel[] = [];
  if (body.contact_id && contactInTenant) {
    const optOuts = await contactOptOuts(admin, { tenantId: body.tenant_id, contactId: body.contact_id, email, phone });
    if (optOuts.status === "unknown") {
      return { kind: "skip", status: "skipped_no_consent", reason: "opt_outs_unknown", error: "contact opt-outs could not be checked" };
    }
    if (optOuts.customerHeld.length > 0) {
      return {
        kind: "skip", status: "skipped_no_consent", reason: "contact_opted_out",
        error: `contact opted out: ${optOuts.customerHeld.join(", ")}`,
      };
    }
    optedOutChannels = optOuts.channels;
  }

  if (INTENT_TO_CONSENT[body.rule.compose_intent] === "marketing") {
    const consent = email
      ? await tenantConsent(admin, { tenantId: body.tenant_id, channel: "email", contactId: body.contact_id, address: email })
      : "none";
    if (consent !== "granted") {
      return consent === "unknown"
        ? { kind: "skip", status: "skipped_no_consent", reason: "marketing_consent_unknown", error: "marketing consent could not be checked" }
        : { kind: "skip", status: "skipped_no_consent", reason: "marketing_consent_missing", error: "marketing consent missing" };
    }
  }
  return { kind: "send", optedOutChannels };
}
