/**
 * Bind a mutating tool's `confirm:true` to a SERVER-HELD proposal, not to the model's own flag.
 *
 * THE DEFECT THIS EXISTS TO CLOSE
 * -------------------------------
 * The autonomy gate in `paige-ai-chat` refuses whenever `gateArgs.confirm !== true`, which is a
 * real gate against a caller that just invokes the tool. But `gateArgs` is
 * `JSON.parse(tc.function.arguments)` — the MODEL'S OWN OUTPUT. Nothing tied that flag to the
 * `needs_confirm` that preceded it, or to anything a human said. Two consequences, both reachable:
 *
 *   1. A model emitting `confirm:true` on its FIRST call executed immediately.
 *   2. Worse, the bypass needed no human turn. The tool loop dedupes rounds on the exact argument
 *      string, and `{…}` vs `{…,"confirm":true}` are different signatures — so a model could call,
 *      receive `needs_confirm`, and re-call with `confirm:true` inside the SAME HTTP turn.
 *
 * WHAT MAY AND MAY NOT BE BOUND — the constraint that shapes everything below
 * --------------------------------------------------------------------------
 * Conversation history is rebuilt as `{ role, content }` ONLY (`index.ts` ~4005). Tool calls and
 * tool results do NOT cross a turn boundary, and the Approve control sends just the words
 * "Approved — run it." So on the confirming turn the model has to REGENERATE its arguments from
 * prose alone.
 *
 * A first version of this module hashed the WHOLE argument object. That is unsatisfiable for any
 * tool whose arguments are authored content — `document_generate` requires `blocks`, the entire
 * document; two generations are never byte-equal. The result was a silent livelock: approve →
 * re-author → different hash → refuse → re-propose, forever, with nothing executing and no error.
 * The peer-gate caught it; neither the SQL proof (hashes passed as literals) nor the unit tests
 * (hand-written 1–2 key objects) could, because neither crosses a turn.
 *
 * So the rule is: **bind only on values the model can genuinely reproduce next turn** — which means
 * either a value the operator SAW in the summary (and can therefore be read back out of prose), or
 * a stable database id the model can look up again. A phone number, a role name, a contact id: all
 * recoverable. A twelve-block document: never. The two tiers are spelt out on TOOL_IDENTITY_FIELDS
 * below, because conflating them is exactly how the first version went wrong.
 *
 * Everything else is bound at TOOL level: a proposal for `document_generate` can only be spent on
 * `document_generate`. Combined with one-open-proposal-per-tool and single use, that gives one
 * approval → one execution, which is the property that actually matters.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT (§13 — the honest bound)
 * --------------------------------------------------------------
 * PROVES: the server proposed first; the operator's client took a turn in between; one approval
 * buys exactly one execution; and for the listed tools, the pinned identity of the approval is the
 * identity that runs.
 *
 * Note the wording: *the pinned identity*, not "the identity the human was shown". For tier 2 the
 * human was shown nothing identifying at all, and the pin buys less than it looks like — a
 * mismatch merely re-renders the SAME sentence, so a second yes executes on the new subject. It
 * costs a round-trip and closes an accidental swap; it does not let the operator tell two subjects
 * apart. Fixing that needs the summary to name its subject, which is filed separately.
 *
 * DOES NOT PROVE: that the human said *yes* — an intervening turn is a turn, not a grant. Nor,
 * for tools outside the identity list, that the CONTENT is unchanged from what was proposed;
 * only the tool and the fact of approval are bound. Binding to an authenticated approval CLICK is
 * the stronger step and needs per-surface UI work (only `PaigeAIChat` renders `PaigeConfirmCard`;
 * `useSoloChat` drops the confirm frame). Tracked separately rather than half-built here.
 *
 * KNOWN LIMIT — NO SESSION OR THREAD SCOPING
 * -------------------------------------------
 * A proposal is keyed on (requester, tenant, tool, identity) and nothing else. Six surfaces call
 * `paige-ai-chat`, so two open tabs — or the floating chatbot alongside the main console — will
 * silently supersede each other's pending approvals for the same tool. It FAILS CLOSED (the loser
 * is asked again rather than executing), so this is friction, not a hole, and it is stated here
 * rather than left to be rediscovered. The twin this generalizes avoids it by echoing an exact
 * token back through the CLIENT, which is the mechanism this one deliberately does not yet use.
 *
 * Switching active tenant between the proposing and confirming turn has the same effect and the
 * same failure direction, since `personaCtx.tenant_id` is part of the key.
 *
 * WHY A SECOND HOME WAS NOT BUILT (§18)
 * -------------------------------------
 * `pipeline_archive_confirmations` (#709) already implements this shape for ONE tool. This
 * generalizes it instead of forking a rival. That path keeps its own stricter checks on top — an
 * exact token echoed back through the CLIENT, which is the mechanism this one cannot yet use.
 *
 * Kept free of Deno globals on purpose so `src/**` vitest can exercise it directly.
 */

/**
 * Fields a confirming call must reproduce. Adding a tool here makes its approval stricter; adding
 * the WRONG field re-creates the livelock above, so membership has a test — and the two tiers below
 * exist because that test has two honest answers, not one.
 *
 * TIER 1 — the value is rendered in `describeConfirm`, so the operator SEES it and the model can
 * read it straight back out of its own visible prose. Reproduction is essentially certain.
 *     comms_buy_number.phone_number   "Buy +1555…"
 *     member_grant_role.role          'Grant the "admin" role…'
 *     n8n_*_workflow.workflow_id      "…the n8n automation w_123"
 *     zapier_run_action.tool_name     'Run the Zapier action "send_email"'
 *
 * TIER 2 — a stable database id that is NOT in the summary (the summary says "the contact", "a team
 * member", "that number"). The model must re-derive it by looking the subject up again. For a
 * stable row keyed on a name the operator just used, that re-lookup is deterministic in practice —
 * but it is not guaranteed, so the worst case is ONE EXTRA APPROVAL, never an impossibility.
 *     member_grant_role.user_id · member_revoke_role.user_id
 *     crm_delete_contact.contact_id · comms_set_primary_number.number_id
 *
 * That is the whole distinction that matters: a looked-up id can be re-derived; AUTHORED CONTENT
 * cannot. `document_generate`'s `blocks` is a fresh generation every time, which is why pinning it
 * livelocked and why no tier-2 entry may ever be content.
 *
 * These four are pinned anyway because each guards an irreversible or privilege-changing act, where
 * an extra ask costs far less than the wrong subject. (`role` is tier 1 and carries the escalation
 * direction on its own, so even a failed `user_id` match cannot turn a coach grant into an admin
 * one.) That the summaries do not name their subject is a real §13/§36 gap in copy the operator is
 * asked to approve — it is filed separately, not silently fixed here.
 *
 * A tool absent from this map binds at tool level. That is the safe default, not an oversight.
 */
export const TOOL_IDENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Money. The number is in the sentence; the amount is separately guarded by the quote check
  // ahead of the gate and re-verified server-side against platform_number_pricing.
  comms_buy_number: ["phone_number"],
  // Authority.
  member_grant_role: ["user_id", "role"],
  member_revoke_role: ["user_id", "role"],
  // Destruction.
  crm_delete_contact: ["contact_id"],
  // Contact edits are fully rendered in describeConfirm. Pin both the opaque tenant-scoped
  // subject and every allowlisted writable value so an approval cannot be replayed for another
  // client or a substituted patch. Emails and phones are the contact's address list — the
  // replacement, the addition, and the list a replacement was built on — so an approval can
  // neither be spent on a different list nor carried over to one that changed since.
  crm_update_contact: [
    "client_ref", "first_name", "last_name", "contact_methods", "add_contact_methods", "expected_contact_methods",
    "entity_name", "entity_type",
    "title", "website", "linkedin_url", "street_address", "city", "state", "zip_code",
    "lifecycle_stage", "source", "tags", "primary_offer", "notes", "status",
    "assigned_coach_user_id", "do_not_contact",
  ],
  n8n_delete_workflow: ["workflow_id"],
  n8n_archive_workflow: ["workflow_id"],
  // External side effects through the tenant's own connected apps.
  zapier_run_action: ["tool_name"],
  comms_set_primary_number: ["number_id"],
  // Running or publishing something LIVE. describeConfirm renders each of these ids verbatim
  // ("…the n8n automation w_123", "…goes LIVE at its public URL"), so they are tier 1.
  n8n_run_workflow: ["workflow_id"],
  n8n_activate_workflow: ["workflow_id"],
  n8n_deactivate_workflow: ["workflow_id"],
  n8n_update_workflow: ["workflow_id"],
  growth_page_publish: ["page_id"],
  growth_funnel_publish: ["funnel_id"],
  // pipeline_configure MULTIPLEXES eleven command types behind one tool name — archive-pipeline,
  // archive-stage, move-deal, update-pipeline and more. Unpinned, they all hashed identically, so
  // an approval for "Archive Sales Q3 (PPL-7) with 41 deals" could be spent on archive-stage: the
  // strict token check above only fires for `archive-pipeline`, so the sibling commands were
  // executing on credit the archive path had minted. command.type is rendered in the summary.
  pipeline_configure: ["command.type"],
});

/** Deeply order object keys so a re-emitted payload with a different key order still matches. */
export function canonicalizeToolArgs(args: unknown): unknown {
  if (Array.isArray(args)) return args.map(canonicalizeToolArgs);
  if (args && typeof args === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(args as Record<string, unknown>).sort()) {
      out[key] = canonicalizeToolArgs((args as Record<string, unknown>)[key]);
    }
    return out;
  }
  return args;
}

/**
 * The identity subset for one call: the listed fields and nothing else.
 *
 * Note what this does NOT do. It does not strip `confirm`, or `confirm_new`, or any other flag —
 * it never sees them, because it only ever reads an allowlist. That is why a legitimate second-call
 * field (`crm_create_contact`'s `confirm_new` on a dedup retry) cannot silently invalidate an
 * approval, which a whole-object hash did.
 */
export function toolIdentity(toolKey: string, args: unknown): Record<string, unknown> {
  const fields = TOOL_IDENTITY_FIELDS[toolKey];
  if (!fields) return {};
  const src = (args && typeof args === "object" && !Array.isArray(args))
    ? args as Record<string, unknown>
    : {};
  const out: Record<string, unknown> = {};
  for (const f of [...fields].sort()) {
    // A dotted name walks one nested path (`command.type`). Anything missing along the way is
    // simply omitted, never recorded as undefined — an absent field must not create a distinct
    // identity from a field that was never named.
    let cur: unknown = src;
    for (const seg of f.split(".")) {
      if (cur && typeof cur === "object" && !Array.isArray(cur)) {
        cur = (cur as Record<string, unknown>)[seg];
      } else {
        cur = undefined;
        break;
      }
    }
    if (cur !== undefined) out[f] = canonicalizeToolArgs(cur);
  }
  return out;
}

/** Stable identity for "this exact approvable thing". Tool-level unless the tool is listed above. */
export async function toolIdentityHash(toolKey: string, args: unknown): Promise<string> {
  const payload = JSON.stringify({ t: toolKey, i: toolIdentity(toolKey, args) });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the caller reports back from the atomic DB claim. */
export type ConfirmationClaim = {
  ok: boolean;
  /** Advisory only — every failure resolves the same way, so this must never become a branch. */
  reason?: "no_open_confirmation" | "same_turn" | "expired" | "already_used" | "error";
};

export type ConfirmDecision =
  /** Run it: the workspace granted `auto`, or a real server-held proposal was consumed. */
  | { kind: "execute" }
  /** Do not run. Mint a proposal and return needs_confirm. `revalidate` = an approval was
   *  asserted but nothing backed it, so the operator is asked again. */
  | { kind: "propose"; revalidate: boolean }
  /** Turned off for this workspace. */
  | { kind: "disabled" };

/**
 * The whole gate decision, as one pure function so it can be tested without booting the runtime.
 *
 * The critical property: `claim` is the ONLY thing that can turn a `confirm` lane into `execute`.
 * `confirmFlag` alone never can — that is the defect. It only selects which branch runs.
 */
export function decideToolConfirmation(input: {
  autoMode: "auto" | "confirm" | "off" | string;
  /** `gateArgs.confirm` — the model's own output. Never trusted on its own. */
  confirmFlag: unknown;
  /** Result of the atomic server-side claim. Undefined when no claim was attempted. */
  claim?: ConfirmationClaim;
}): ConfirmDecision {
  if (input.autoMode === "off") return { kind: "disabled" };
  if (input.autoMode !== "confirm") return { kind: "execute" };

  if (input.confirmFlag !== true) return { kind: "propose", revalidate: false };

  // The model asserts approval. That assertion is worth nothing by itself: it is only a request
  // to spend a server-held proposal, and the server decides whether one exists.
  if (input.claim?.ok === true) return { kind: "execute" };

  // Fail CLOSED, but never into a dead end: ask again about the action as it now stands.
  return { kind: "propose", revalidate: true };
}
