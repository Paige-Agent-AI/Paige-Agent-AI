import type { ChannelType, DbThread, MessageRow } from "../inbox-shared";

export type CapabilityTruth = "LIVE" | "PARTIAL" | "UNAVAILABLE" | "PROPOSED";

export interface SoloConnectorEvidence {
  channel_type: ChannelType;
  active: boolean;
  status: string;
  from_address: string | null;
  provider?: string | null;
}

export interface SoloChannelTruth {
  id: string;
  label: string;
  availability: CapabilityTruth;
  identity: string;
  providerConnection: string;
  providerSource: string;
  sendPermission: string;
  inbound: string;
  webhookHealth: string;
  operationalHealth: string;
  a2p?: string;
  setupOwner: "Settings → Connections" | "Clients → Portal" | "Not available";
}

export function conversationNeedsAttention(
  thread: DbThread,
  messages: MessageRow[],
  nowMs = Date.now(),
): boolean {
  if (thread.archived_at) return false;
  if (thread.snoozed_until && new Date(thread.snoozed_until).getTime() > nowMs) return false;
  const hasDraft = messages.some((item) => item.direction === "outbound" && item.status === "draft");
  const overdueReply = thread.last_direction === "inbound"
    && !!thread.last_message_at
    && nowMs - new Date(thread.last_message_at).getTime() > 3 * 86_400_000;
  return thread.unread_count > 0 || hasDraft || overdueReply;
}

// 'portal' is a proven send seam too: comms_portal_reply writes into the client portal with no
// provider in the path (E09). Governed handling still fails every channel closed.
export function canSendInSolo(mode: "human" | "draft" | "governed", channel: string): boolean {
  return mode !== "governed" && (channel === "email" || channel === "sms" || channel === "portal");
}

export function buildSoloConversationLinks(account: string, contactId: string | null) {
  const safeAccount = encodeURIComponent(account);
  const base = `/solo/${safeAccount}`;
  const returnTo = `${base}/clients/conversations`;
  return {
    people: `${base}/clients/people${contactId ? `?person=${encodeURIComponent(contactId)}` : ""}`,
    portal: `${base}/clients/portal`,
    campaigns: `${base}/growth`,
    connections: `${base}/settings/connections?origin=conversations&returnTo=${encodeURIComponent(returnTo)}`,
  };
}

function connectorEvidence(connectors: SoloConnectorEvidence[], channel: ChannelType) {
  return connectors.find((item) => item.channel_type === channel && item.active && item.status === "active");
}

/**
 * The SMS half of the channel disclosure, from the ONE canonical resolver.
 *
 * Only the fields the resolver actually proves. Absent readiness leaves every
 * field exactly as it was — connector presence is still never upgraded into
 * A2P, webhook or operational proof, which is the contract
 * `soloConversationModel.test.ts` locks.
 */
export interface SoloCommsReadinessEvidence {
  /**
   * The workspace the RESOLVER resolved, server-side, for this answer.
   *
   * Carried so a container can prove the payload belongs to the account on screen before it
   * renders. Optional because it is only used for that binding check and an absent value is
   * treated as "cannot prove it" by the caller, never as a match.
   */
  tenant_id?: string | null;
  can_send_sms: boolean;
  a2p: "approved" | "submitted" | "prepared" | "absent";
  number_e164: string | null;
  /**
   * `awaiting_receipts` is the resolver's fifth state and was missing here.
   *
   * The RPC emits it when messages were SENT but not one delivery receipt has
   * landed (migration 20261002000000, `v_sms_delivered = 0` with no failures).
   * `ClientsConversations.tsx` casts the raw RPC row straight into this type, so
   * the value flowed through at runtime and fell into the final `else` of the
   * health ternary, rendering **"Messages are not arriving"** on an account where
   * zero messages had failed — a definite negative asserted from the ABSENCE of
   * receipts, which is the same class of untruth as the "No replies received"
   * repaired a few lines below it.
   */
  delivery: {
    state: "no_activity" | "delivering" | "awaiting_receipts" | "mixed" | "failing";
    last_inbound_at: string | null;
    /**
     * The resolver's OWN guard on whether replies can be reported at all.
     *
     * `tenant_comms_readiness()` emits `inbound_reporting: 'unavailable'` because
     * `last_inbound_at` reads `public.messages` filtered to inbound, and NOTHING
     * writes an inbound SMS row there — `handle-inbound-sms` inserts into
     * `paige_conversations`. The column is therefore structurally always null.
     *
     * NESTED INSIDE `delivery`, because that is where the resolver actually puts
     * it (migration 20261002000000, inside the `delivery` jsonb). It was declared
     * and read at the TOP level, so at runtime it was always `undefined` and the
     * guard could never take its `available` branch. The tenant-visible outcome
     * was still safe — absent reads as unavailable — but a guard that cannot be
     * entered is not a guard, and the test fixtures that "locked" it were built
     * in a shape the RPC cannot produce, so they could not have caught this.
     *
     * Optional so a caller with an older record still behaves: absent is treated
     * as unavailable, which is the safe direction.
     */
    inbound_reporting?: "available" | "unavailable";
  };
}

export function getSoloChannelTruth(
  connectors: SoloConnectorEvidence[],
  connectorReadReported = true,
  readiness?: SoloCommsReadinessEvidence | null,
): SoloChannelTruth[] {
  const truth = (
    id: string,
    label: string,
    channel?: ChannelType,
    availability: CapabilityTruth = "UNAVAILABLE",
  ): SoloChannelTruth => {
    const evidence = channel ? connectorEvidence(connectors, channel) : undefined;
    return {
      id,
      label,
      availability: evidence ? "PARTIAL" : availability,
      identity: evidence?.from_address?.trim() || "Not assigned",
      providerConnection: evidence ? "Connected" : connectorReadReported ? "Not connected" : "Not reported",
      providerSource: evidence?.provider?.trim() || "Not reported",
      sendPermission: "Not reported",
      inbound: "Not reported",
      webhookHealth: "Not reported",
      operationalHealth: "Not reported",
      setupOwner: "Settings → Connections",
    };
  };

  return [
    {
      ...truth("portal", "Portal", undefined, "PARTIAL"),
      identity: "Not applicable",
      // E09: the portal now carries messages, but through no provider — say what it is, and keep
      // availability PARTIAL until an authenticated runtime proves it end to end.
      providerConnection: "No provider — messages stay inside the client portal",
      providerSource: "Portal access",
      sendPermission: "Business admins, to clients who joined the portal",
      inbound: "Client messages and help requests land in this inbox",
      webhookHealth: "Not applicable",
      setupOwner: "Clients → Portal",
    },
    truth("email", "Email", "email", "PARTIAL"),
    {
      ...truth("sms", "SMS", "sms", "PARTIAL"),
      // Readiness fills ONLY what it proves. Without it every field stays
      // "Not reported" — the disclosure never infers permission from a connector.
      ...(readiness
        ? {
            identity: readiness.number_e164 ?? "Not assigned",
            sendPermission: readiness.can_send_sms
              ? "Permitted to send"
              : "Not permitted — setup incomplete",
            a2p:
              readiness.a2p === "approved" ? "Approved"
              : readiness.a2p === "submitted" ? "Filed with carriers"
              : readiness.a2p === "prepared" ? "Prepared, not submitted"
              : "Not registered",
            // NOT "No replies received". That was a definite negative derived from a
            // column nothing can write, so every tenant — including one actually
            // receiving replies — was told the same false thing. It also
            // contradicted the sibling Settings ladder reading the SAME canonical
            // record (§57), which correctly says replies cannot be reported.
            // Honour the resolver's published guard; a missing guard reads as
            // unavailable (§13 — absence of proof is not proof of absence).
            inbound:
              readiness.delivery.inbound_reporting === "available"
                ? (readiness.delivery.last_inbound_at ? "Replies received" : "No replies received")
                : "Not reported",
            // Each arm names the state it is reading. `awaiting_receipts` says what
            // is actually known — messages went out, nothing has come back to
            // confirm either way — instead of reporting a failure nobody observed.
            operationalHealth:
              readiness.delivery.state === "delivering" ? "Delivering"
              : readiness.delivery.state === "no_activity" ? "Nothing sent yet"
              : readiness.delivery.state === "awaiting_receipts" ? "Sent, no delivery confirmations yet"
              : readiness.delivery.state === "mixed" ? "Some messages did not arrive"
              : readiness.delivery.state === "failing" ? "Messages are not arriving"
              // An unrecognised state is not evidence of anything. Naming a
              // failure here would re-create the defect this arm exists to fix.
              : "Not reported",
            // Deliberately still NOT reported: nothing in this repository records
            // webhook registration health, so claiming it would be a fabrication.
            webhookHealth: "Not reported",
          }
        : { a2p: "Not reported" }),
    },
    truth("voice", "Phone / outbound voice", "voice", "PARTIAL"),
    {
      ...truth("video", "Video calling", undefined, "UNAVAILABLE"),
      identity: "Not applicable",
      providerConnection: "Unavailable",
      providerSource: "Unavailable",
      sendPermission: "Not applicable",
      inbound: "Not applicable",
      webhookHealth: "Not applicable",
      operationalHealth: "Unavailable",
      setupOwner: "Not available",
    },
    truth("instagram", "Instagram", "instagram", "PARTIAL"),
    truth("facebook", "Facebook / Messenger", "facebook", "PARTIAL"),
    {
      ...truth("apple-business", "Apple Messages for Business", undefined, "UNAVAILABLE"),
      identity: "Not applicable",
      providerConnection: "Unavailable",
      providerSource: "Business channel only; ordinary consumer iMessage is not offered",
      sendPermission: "Not applicable",
      inbound: "Not applicable",
      webhookHealth: "Not applicable",
      operationalHealth: "Unavailable",
      setupOwner: "Not available",
    },
  ];
}

export interface AccountEpochToken { account: string | null; epoch: number }

export function createAccountEpochGuard(initialAccount: string | null) {
  let account = initialAccount;
  let epoch = 0;
  return {
    capture: (): AccountEpochToken => ({ account, epoch }),
    advance: (nextAccount: string | null) => { account = nextAccount; epoch += 1; },
    accept: (token: AccountEpochToken) => token.account === account && token.epoch === epoch,
  };
}
