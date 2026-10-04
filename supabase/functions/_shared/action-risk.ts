/**
 * THE ACTION-RISK POLICY — the one place that decides how much proof an action needs.
 *
 * Every mutation Paige can perform is classified here, once, on the server. The classification is
 * a property of the ACTION, never of who is asking or how they asked, so nothing in a request can
 * move it: not the model's arguments, not the request body, not the calling surface, not a
 * hallucinated tool name. The only input is the tool's own name, and the only source of truth is
 * the table below.
 *
 * WHY THIS FILE EXISTS RATHER THAN A SET LITERAL INSIDE THE HANDLER. The split between an ordinary
 * action and a dangerous one first shipped as a `Set` and a comment beside the confirm gate. That
 * works exactly until someone adds the fifty-second write tool, at which point the new tool is
 * silently ordinary — because the permissive answer was the default. Mutation-testing found the
 * same shape from the other side: emptying three entries out of that set failed nothing, since the
 * checks drove one member and counted the rest. A policy that degrades quietly toward permissive is
 * not a policy.
 *
 * THE THREE RULES THIS FILE ENFORCES
 *
 *   1. FAIL CLOSED. An action that is not classified is not runnable. `classifyAction` answers
 *      "unclassified" for anything absent, and the caller must refuse rather than guess. Adding a
 *      write tool without classifying it makes that tool inert, loudly, instead of ungoverned,
 *      silently — and CI (`lint:action-risk`) fails the change before it can reach anyone.
 *   2. NOTHING FROM THE REQUEST CAN LOWER A CLASS. The lookup is by tool name against a frozen Map.
 *      A Map, specifically, and not an object literal: `({} as any)["constructor"]` is truthy, so an
 *      object lookup would classify a tool called `constructor` or `__proto__` as whatever the
 *      prototype chain happened to return. A Map has no prototype chain to walk.
 *   3. RAISING PAIGE'S OWN AUTONOMY IS NOT A CHAT ACTION AT ALL. `owner_only` is not "needs a
 *      stronger approval" — it is "this does not happen here, at any approval strength, however
 *      the operator words it." It belongs to the owner in Settings.
 */

/**
 * `ordinary`   — reversible, in-tenant, and its effects stay inside the workspace. A compact
 *                confirmation is enough: the person is read the exact stored action and answers.
 * `high`       — irreversible, changes who may do what, reaches outside the platform, spends
 *                money, or becomes visible to a client. Requires the rendered approval card, whose
 *                fingerprint travels in the request BODY and therefore cannot be produced by the
 *                model. The model reporting "they said yes" is not accepted for these.
 * `owner_only` — never performed from Chat, at any approval strength. Owner-controlled Settings.
 */
export type ActionRisk = "ordinary" | "high" | "owner_only";

/** What `classifyAction` can answer. "unclassified" is a refusal, not a permissive default. */
export type ActionRiskVerdict = ActionRisk | "unclassified";

/**
 * EVERY MUTATION PAIGE CAN PERFORM, AND WHY IT SITS WHERE IT SITS.
 *
 * The reason column is not decoration. When a later reader disagrees with a classification, the
 * reason is what they argue with — and when a new tool is added, the reasons are the rubric that
 * says where it goes. An entry with no defensible reason is an entry that should be `high`.
 */
const RISK: ReadonlyArray<readonly [string, ActionRisk, string]> = [
  // ── owner_only ────────────────────────────────────────────────────────────────────────────
  // §67's red line. How much Paige may do unattended is the operator's decision about Paige, and
  // an assistant that can argue its way into more authority has no ceiling — the wording of the
  // request is exactly the thing that must not matter. Turning a process LIVE is the same decision
  // wearing different clothes: a dark process that starts firing is authority Paige did not have a
  // moment ago. Both move to Settings, where a person changes them deliberately rather than at the
  // end of a conversation Paige was steering.
  ["automation_set_grant", "owner_only", "changes how much Paige may do alone"],
  ["automation_set_state", "owner_only", "makes a process live, which is the same decision"],

  // ── high: cannot be undone ────────────────────────────────────────────────────────────────
  ["mission_create", "high", "commits an owner outcome and authority brief from a conversation"],
  ["mission_revise", "high", "changes the governed mission brief the owner will operate from"],
  ["mission_transition", "high", "changes a governed mission lifecycle or records its outcome"],
  // `crm_delete_contact` (the retired legacy edge tool) is deliberately absent:
  // the policy may not carry lines for tools the handler no longer declares
  // (action-risk-lint), and an unclassified action cannot run on purpose — so
  // any reintroduction fails closed until it is deliberately re-classified.
  ["crm_hard_delete_contact", "high", "permanently removes an unlinked dependency-free contact after a bound server preview"],
  ["crm_merge_contacts", "high", "reassigns supported dependencies and archives the losing contact after conflict review"],
  ["crm_bulk_update_contacts", "high", "changes an exact preview-bound set of contact records"],
  ["crm_delete_deal", "high", "permanently removes a deal and its dependent pipeline history after preview"],
  ["crm_close_deal", "high", "records a consequential won or lost pipeline outcome"],
  ["crm_reopen_deal", "high", "reverses a recorded pipeline outcome and resumes active work"],
  ["crm_cancel_task", "high", "cancels committed work and requires an explicit operator decision"],
  ["crm_delete_task", "high", "destroys a task with nothing left to restore it from"],
  ["comms_buy_number", "high", "commits the tenant to a recurring charge on a provider account"],
  ["comms_set_primary_number", "high", "changes the number every client sees when the tenant contacts them"],
  ["n8n_delete_workflow", "high", "permanently deletes an automation"],
  ["plan_remove_item", "high", "cancels a milestone, task or reminder"],

  // ── high: changes who may do what ─────────────────────────────────────────────────────────
  ["member_grant_role", "high", "grants a staff role"],
  ["member_revoke_role", "high", "removes a staff role"],
  ["crm_assign_coach", "high", "changes who can see a client"],
  ["crm_assign_contact", "high", "changes who owns and can see a client"],
  ["crm_assign_contact_owner", "high", "changes the accountable owner of a contact"],
  ["crm_assign_deal_owner", "high", "changes the accountable owner of an opportunity"],
  ["crm_assign_deal_contact", "high", "changes which customer record an opportunity belongs to"],
  ["crm_assign_task", "high", "moves work onto another workspace member's queue"],
  // Solo Team, added 2026-09-02. A permission change is the definition of this section: it is the
  // one act in the Team seam that moves authority rather than describing work. The database is
  // stricter than this file — `set_solo_team_member_permission` admits only the tenant OWNER, will
  // not accept `owner` as a target value, and refuses to touch the owner's own row — so a caller
  // cannot raise themselves through it. That is the DATABASE's guarantee, and it is exactly why
  // this entry does not lean on it: if the guard ever loosened, the class here would still be the
  // thing standing between a conversation and someone's access.
  ["team_set_permission", "high", "changes what a teammate is allowed to do"],
  // Revoking is safety-directional, and it is still `high` for the reason `n8n_deactivate_workflow`
  // is: the direction of a change is not its class. Pulling a pending invitation ends an access
  // grant somebody may already be acting on, and the person on the other end of that email finds
  // out by failing.
  ["team_invite_revoke", "high", "withdraws an access grant that is already in flight"],
  // Runs as service role against the orchestrator, so whatever the specialist then does is outside
  // this gate. Until that path is itself governed, delegating IS the authority decision.
  ["delegate_to_subagent", "high", "dispatches work that executes outside this gate"],

  // ── high: reaches outside the platform ────────────────────────────────────────────────────
  // Every provider action, including the brakes. Deactivating and archiving are safety-directional,
  // but they still act on the operator's own n8n account, and "which provider calls are safe" is a
  // judgement this file should not be making per-verb.
  ["n8n_activate_workflow", "high", "makes an external automation live"],
  ["n8n_deactivate_workflow", "high", "acts on the operator's provider account"],
  ["n8n_create_workflow", "high", "writes to the operator's provider account"],
  ["n8n_update_workflow", "high", "writes to the operator's provider account"],
  ["n8n_run_workflow", "high", "fires an external automation with real effects"],
  ["n8n_archive_workflow", "high", "acts on the operator's provider account"],
  ["zapier_run_action", "high", "runs an action in a third-party app"],
  ["ghl_run_action", "high", "runs a tool in the tenant's GoHighLevel CRM — reads contacts/conversations, writes can move real CRM records and send real messages"],
  ["calendar_book_meeting", "high", "books a real event with a real person"],
  ["social_connection_start", "high", "creates an external provider profile and begins authorization for a tenant Social identity"],
  ["social_connection_disconnect", "high", "revokes a tenant Social identity at the external provider"],
  ["social_account_select", "high", "changes the exact external account future Social actions may target"],
  // Solo Team invitations, added 2026-09-02. These are `high` twice over, and either reason alone
  // would be enough. They mint an access grant for a person who is not in the workspace yet, and
  // they put an email in a real stranger's inbox — which is the one effect in this whole file that
  // no undo inside the product can reach. Resending is not the smaller sibling of sending: it
  // revokes the live token and issues a new one, so it is a fresh grant plus a fresh email.
  ["team_invite_member", "high", "grants workspace access and emails a real person"],
  ["team_invite_resend", "high", "issues a new access grant and emails a real person again"],

  // ── high: becomes visible to a client, or goes public ─────────────────────────────────────
  ["growth_page_publish", "high", "puts a page live at a public URL"],
  ["growth_funnel_publish", "high", "puts a whole sequence live"],
  ["growth_form_publish", "high", "puts a form live at a public URL where strangers can submit to the workspace"],
  // The rest of the Studio publish lifecycle (Migration E, 2026-10-04). These are door-only keys:
  // the growth-publish-command door runs them for the Studio panel and the chat alike; no chat tool
  // carries these names. Taking work offline is `high` for the same reason putting it live is — it
  // changes what the public sees, and a visitor mid-way through a page or a link someone already
  // shared stops working. The runtime clamp keeps every one of them ask-first.
  ["growth_page_unpublish", "high", "takes a public page offline, so anyone with its address stops reaching it"],
  ["growth_funnel_unpublish", "high", "takes a public sequence offline mid-visit for anyone working through it"],
  ["growth_form_unpublish", "high", "takes a public form offline, so strangers can no longer submit to the workspace"],
  ["studio_image_publish", "high", "puts an image in the Catalog where anyone with its link can see it"],
  ["studio_image_unpublish", "high", "withdraws a published image from the Catalog that people may already be using"],
  // The evaluation loop's DECIDE leg (Runway 4 / #1123), the sign-off half of the `improvement_propose`
  // pair above. It records the owner's approve/reject on a `paige_improvement_proposals` row and
  // applies nothing (there is no auto-apply path — it flips status, decided_by, rationale only). It
  // is `high` for the same reason `approval_decide` is: a recorded sign-off is a governance act, and
  // this one governs whether Paige's own future behaviour changes (§67/§68). It was the live bypass
  // this repair closes: unclassified AND its verb `decide` was absent from MUTATION_VERB, so it read
  // as a query, skipped the `MUTATING_TOOLS` gate entirely, and ran from chat with no rendered card.
  // Classifying it `high` routes it through the gate (the body-borne approval fingerprint); adding
  // `decide` to MUTATION_VERB makes the runtime + CI backstops catch it too if the class were ever lost.
  ["improvement_decide", "high", "records the owner's approval or rejection of a self-improvement proposal; the governed sign-off, which must not run from chat without the rendered approval card"],
  // Filing a document is HIGH because one of its two outcomes hands a real document to a real
  // person outside the workspace, and that cannot be walked back — moving it to `internal`
  // afterwards does not unread it. The class is a property of the ACTION, so it does not soften
  // when the arguments happen to say `internal`: rule 2 of this file is that nothing in a request
  // may lower a classification, and splitting this into a share tool and a file tool purely to win
  // a cheaper gate for one path would be that same lowering wearing a second tool name.
  //
  // It also sits alongside `document_generate`, which is `ordinary` on the stated grounds that
  // "producing an artefact is not handing it to anyone, and giving it to a client is the separate
  // act where the visibility decision belongs." This IS that separate act. The two entries are the
  // two halves of one sentence, and they only stay coherent together.
  ["crm_file_document", "high", "can put a document in front of the client, which cannot be undone"],

  // ── high: spends money ────────────────────────────────────────────────────────────────────
  ["marketplace_install", "high", "installs a paid capability"],
  ["marketplace_uninstall", "high", "changes what the workspace is billed for"],

  // ── ordinary ──────────────────────────────────────────────────────────────────────────────
  // Reversible in-tenant record work. The operator sees the exact stored action before it runs and
  // can undo it afterwards; nothing leaves the workspace and nobody's permissions change.
  ["crm_create_contact", "ordinary", "adds a record the operator can edit or delete"],
  ["crm_update_contact", "ordinary", "edits fields on a record"],
  ["crm_archive_contact", "ordinary", "removes a contact from active work while preserving it for restoration"],
  ["crm_restore_contact", "ordinary", "returns an archived contact to active work"],
  ["crm_link_contact_company", "ordinary", "links a contact to an existing in-workspace company"],
  ["crm_unlink_contact_company", "ordinary", "removes a reversible in-workspace company association"],
  ["crm_create_company", "ordinary", "adds a tenant-owned company record"],
  ["crm_update_company", "ordinary", "edits a tenant-owned company record"],
  ["crm_archive_company", "ordinary", "archives a company while preserving it for restoration"],
  ["crm_restore_company", "ordinary", "restores an archived company"],
  ["crm_update_deal", "ordinary", "edits reversible opportunity fields"],
  ["crm_reschedule_task", "ordinary", "changes when a task is due"],
  ["crm_complete_task", "ordinary", "marks a task complete while retaining its history"],
  ["crm_reopen_task", "ordinary", "returns a completed task to active work"],
  ["crm_update_pipeline_stage", "ordinary", "moves a client between stages"],
  // AMENDED 2026-09-05. The reason used to read "files work on the operator's own queue", which is
  // true of Chat — it defaults the assignee to the caller — and false of the MCP tool, which
  // REQUIRES `owner_user_id` and writes it unvalidated. Same act, so the same key; the sentence a
  // person reads on the card now covers both rather than only the surface it was written for.
  ["crm_create_task", "ordinary", "files work on somebody's queue in this workspace"],
  ["crm_log_activity", "ordinary", "appends to a client's timeline"],
  // Staff-only by construction — `client_notes` has no client-facing read policy at all — and
  // deletable by its author or a tenant admin. The destination is constrained by the database
  // (20261031000000), so a wrong routing decision cannot land on another tenant's client.
  ["crm_add_note", "ordinary", "files a staff-only note on a client's record"],
  ["update_business_profile", "ordinary", "edits the workspace's own profile"],
  // Comms (merged from main 2026-09-01). Naming a number is a label; drafting a registration
  // prepares compliance copy and explicitly does NOT submit it. Buying a number and changing the
  // primary are high: one is a recurring charge against a provider account, the other changes the
  // number every client sees on their phone. Both fall squarely in the owner's high-risk coverage
  // of billing, connections, provider actions and client-visible changes.
  ["comms_name_number", "ordinary", "renames a number in the workspace's own list"],
  ["comms_draft_registration", "ordinary", "drafts carrier copy; submitting it is a separate act"],
  // `pipeline_create` / `pipeline_add_stage` were classified here historically and are now fully
  // retired (removed from the runtime surface). The tool that exists is `pipeline_configure`, and
  // it was once omitted, so
  // deriving the gated set from this policy silently UNGATED a previously-gated write (§58). The
  // lint could not see it: `configure` was not a mutation verb, so the backstop read it as a query.
  // Both halves are fixed — the entry below, and `configure` added to MUTATION_VERB.
  ["pipeline_configure", "ordinary", "saves a pipeline draft the operator reviews; activation is a separate act"],
  ["propose_business_brief_update", "ordinary", "stages a suggestion the operator approves before it applies"],
  // The evaluation loop's PROPOSE leg (Runway 4 / #1123). `improvement_propose` writes a row to
  // `paige_improvement_proposals` at status `proposed` and applies NOTHING — its whole contract is
  // "proposes only; nothing changes until the owner decides via improvement_decide". That is the
  // same shape as `propose_business_brief_update` / `crm_propose_contact_update` above: a reversible,
  // in-tenant staging write whose consequential act is a separate, gated decision. `ordinary` on
  // purpose, and only because its effect is provably a draft proposal with no application. The
  // decision that acts on it — `improvement_decide` — is `high` below, and the apply step does not
  // exist (the loop records the decision and never auto-applies).
  ["improvement_propose", "ordinary", "stages a self-improvement proposal the owner decides on later; it applies nothing"],
  // Campaign briefs, added 2026-09-06 (owner authority correction). A brief is an owner-authored
  // PLANNING record — reversible, in-tenant, and it launches, sends, publishes, and spends nothing.
  // `ordinary` on purpose: it is the class the runtime clamp leaves eligible for a standing `auto`
  // grant, which is exactly the point — a tenant owner may grant Paige autonomous authority to draft
  // and revise briefs within their approved scope, and `confirm` stays the escalation lane (the
  // platform default, and where the RPC itself refuses out-of-policy/ambiguous/unavailable-link/
  // version-conflict). Classifying these `high` would force a blanket confirm on every planning
  // write, which is the exact model the correction forbids. The honest boundary is not softened by
  // the class: a brief is intent, never proof — the "active" lifecycle state is a planning label the
  // owner sets, not evidence a campaign is running.
  ["campaign_brief_create", "ordinary", "saves a campaign PLANNING brief the operator can edit or archive; it launches, sends, and publishes nothing"],
  ["campaign_brief_revise", "ordinary", "edits a campaign PLANNING brief; nothing is launched, sent, or published"],
  // ── Calendar booking presets (E5, 2026-09-13). The SAME server-authorized RPCs the Settings ›
  // Connections › Calendars UI drives, adopted into Chat (no parallel model). Per-tool risk assumes
  // each tool's HIGHEST-impact use (the table is per-tool, not per-call): a tool that CAN change or
  // take down a LIVE, client-facing /book page is `high` and carries the rendered approval card; a
  // tool whose worst case is a reversible, in-tenant, nothing-public draft is `ordinary` — the class
  // a tenant owner MAY grant standing authority over. `booking_preset_list` is a read (not classified).
  ["booking_preset_publish", "high", "makes a booking preset's /book page PUBLIC and bookable by anyone with the link — outward-facing; the server revalidates and refuses an unbookable page, and this never sends, connects a provider, or books a meeting"],
  ["booking_preset_revise", "high", "edits a booking preset's configuration; the same tool can change a LIVE, client-facing booking page, so it assumes that use — it never publishes, pauses, or changes the public link"],
  ["booking_preset_archive", "high", "takes a booking preset OUT OF SERVICE — its /book page stops accepting bookings; outward-facing, reversible via restore"],
  ["booking_preset_create", "ordinary", "creates a PRIVATE DRAFT booking preset (enabled=false); nothing is public, no provider is connected, nothing is sent — publishing is the separate high-risk act"],
  ["booking_preset_pause", "ordinary", "takes a booking preset off the air (reversible by publishing again); removes visibility rather than exposing anything"],
  ["booking_preset_duplicate", "ordinary", "copies an existing preset into a new PRIVATE DRAFT (enabled=false); nothing public — the same draft-by-default class as create"],
  ["booking_preset_restore", "ordinary", "brings an archived preset back to Draft or Paused; it exposes nothing (restore never re-publishes)"],
  // ── Calendar-link SHARING (E7, 2026-09-13). Only the SEND is classified: sharing a published
  // calendar's public /book link to a real contact by email/SMS is outward-facing (a person
  // receives it), so it is `high` and carries the rendered approval card. `calendar_link_prepare`
  // and `calendar_link_social_copy` are READS (no mutation verb) — copy-ready previews that send
  // and post nothing — so they are intentionally NOT classified here.
  // ── INT-163 agreements (PAIGE-native e-signature) — CLASSIFICATIONS WITHHELD, and why ─────────
  // The intended entries are: agreement_draft + agreement_add_signer `ordinary` (a draft nobody
  // outside the workspace can see), and agreement_send / agreement_resend / agreement_void `high`,
  // so an act that reaches a real person outside the platform can never run unattended however the
  // request is worded. There is deliberately no `agreement_sign` key at any class: Paige does not
  // sign on anyone's behalf, and a signature only ever happens when a human uses their own token.
  //
  // INT-003 IS RESOLVED (2026-09-23, completed in #1383) — the guard no longer blocks a new
  // mutating tool, so this block is a note about sequencing, NOT about a deadlock. It is corrected
  // in place rather than left standing because this file auto-loads and an uncorrected note
  // asserting a fixed defect is the §13 failure it would otherwise cause in the next session. That
  // standard applied to this note itself: as first written it claimed resolution while the third
  // lock below still rejected `agreement_resend` and `agreement_void` — the two keys named four
  // lines above it — so it promised a contract while pointing at the keys that disproved it.
  //
  // What the deadlock WAS, and it had THREE locks, all measured:
  //   • `capability-kit-lint` reported `direct-risk-entry` for any symbol in this array that was
  //     not in its shrink-only baseline, and its own message forbade expanding that baseline.
  //   • Its stated remedy — declare the capability through `defineCapability()` — REQUIRED the
  //     entry it just forbade: `defineCapability` calls `classifyAction(actionRiskKey)` and throws
  //     "Mutation action-risk keys must exist in the canonical action-risk policy" when it is
  //     absent.
  //   • And even with both of those satisfied, `direct-tool-definition` then fired on the chat
  //     tool schema itself — `{name, description, parameters}` is the shape of every Paige tool —
  //     so resolving the risk rule alone would have left the deadlock half-standing.
  //   • And even with the entry, the declaration AND the schema all present, `defineCapability()`
  //     required `MUTATION_VERB.test(actionRiskKey)` in ADDITION to `classifyAction()`. So 32 of
  //     the 156 curated keys — 15 of them `high`, `agreement_resend` and `agreement_void` among
  //     them — were classified here and still threw on import, while CI reported the tool as
  //     complete and valid (Codex P1 on #1367; its self-test used `widget_send`, whose verb happens
  //     to pass, which is what masked it). Removed in #1383: this policy is the one gate on what
  //     may be declared, and the verb pattern keeps only its fail-safe floors over keys nobody
  //     classified.
  //
  // How it resolved: the LINT relaxed, and then the constructor's redundant verb precondition was
  // removed. A RISK entry is the capability kit's PRECONDITION, not a bypass of it, so neither rule
  // fires any more for a key that carries a governed `defineCapability()` declaration; both still
  // fire for one that does not. The contract for a new mutating tool is: classify it here, declare
  // it through `defineCapability()`, and ship its tool schema — in the same change. One caveat the
  // first version of this note lacked: a green `capability-kit-lint` means the declaration is
  // PRESENT and well-formed to the scanner, not that `defineCapability()` will accept it. The lint
  // still reads no `governance.risk`, so a declaration whose class contradicts the tuple here
  // passes CI and throws on import. Not filed as a tracked task; recorded at
  // `scripts/ci/capability-kit-lint.mjs`'s `direct-risk-entry` comment with its falsifying input.
  //
  // SEQUENCED, 2026-09-24; the send landed with the agreements PR. `agreement_draft` was the first
  // production `defineCapability()` declaration in this repository, and `agreement_send` is now
  // Spine-registered as an external_effect on public.issue_agreement_signing_link. The remaining
  // three (add_signer, resend, void) stay absent for the same reason the READ half shipped first:
  // each outward-facing key earns its own slice, its own confirm copy and its own proof.
  //
  // `agreement_draft` is `ordinary` on the reasoning already given above: a draft is visible to
  // nobody outside the workspace, the RPC re-proves tenant and membership in its own body, and the
  // tier trigger refuses a workspace whose plan does not carry agreement signing. It mints rather
  // than converges, which is a truthfulness problem for its idempotency sentence and not a risk one —
  // the confirm fingerprint is what stops a second draft, and that is stated where callers read it.
  // OUTWARD-FACING AND TERMINAL-ADJACENT. A send puts a signable document in a named person's inbox
  // and moves the agreement one way out of draft; the document it freezes becomes the integrity
  // record of what that person was shown. `high` means the model's own "they said yes" channel is
  // refused outright — only a fingerprint echoed from a rendered card runs it — which is the
  // correct floor for the one action in this domain that reaches someone outside the workspace.
  // Deliberately NOT accompanied by `agreement_resend` or `agreement_void`: each is its own slice.
  ["agreement_send", "high", "emails a signable link for this agreement to its signers — outward-facing, and it reaches a real person outside the platform; the send freezes the document as the integrity record of what the signer was shown, moves the agreement one way out of draft, and cannot be recalled once delivered, so it never runs on the model's word alone"],
  ["agreement_draft", "ordinary", "drafts or revises an agreement inside the workspace — nothing is sent, no signing link is minted, and nobody outside the tenant can see it; the RPC re-proves tenant and membership under the caller's own JWT, and a blind retry with no agreement id mints a second draft rather than converging, which the confirm card is what prevents"],
  ["calendar_link_send", "high", "sends a published calendar's public booking link to a real contact by email or SMS — outward-facing; the server refuses a non-public calendar and the comms seam refuses a cross-tenant, suppressed, or unconsented recipient, and it never posts to social or books a meeting"],
  ["deal_create", "ordinary", "adds an opportunity"],
  ["deal_move_stage", "ordinary", "moves a deal between stages"],
  // The client seat's ONLY write, and on the portal it is the client editing their own profile.
  // Reversible, in-tenant, and scoped to the client already in focus.
  ["update_client_data", "ordinary", "edits fields on the focused client's record"],
  ["generate_image", "ordinary", "produces an image nobody has published"],
  ["content_save", "ordinary", "saves to the workspace's own library"],
  ["growth_page_save", "ordinary", "saves a DRAFT; publishing is the separate high-risk act"],
  ["growth_funnel_build", "ordinary", "builds DRAFT rows; publishing is separate"],
  ["growth_form_save", "ordinary", "saves a form DRAFT (a live form's edits wait in its working copy); publishing is separate"],
  // Produces the artefact; it does not hand it to anyone. "A client might be given this one day"
  // is true of most things the workspace holds, and classifying on what MIGHT later happen to an
  // artefact would put half the library in `high`. Giving it to a client is the separate act, and
  // that act is where the visibility decision belongs.
  ["document_generate", "ordinary", "produces a document; sharing it is a separate act"],
  ["action_file", "ordinary", "files work between Paige's own departments"],
  ["action_advance", "ordinary", "moves a unit of work along its lifecycle"],
  ["save_to_knowledge_base", "ordinary", "stores tenant-private reference material"],
  // Proposes a specialist for approval — it does not run one. `delegate_to_subagent`, which does,
  // is high above.
  ["forge_subagent", "ordinary", "proposes a specialist; approval is a separate act"],
  // Targets the operator or a teammate, never a client or an outside address, so the email channel
  // is internal notification rather than outbound contact. If a reminder ever becomes addressable
  // to a client, this entry moves to `high`.
  ["plan_set_reminder", "ordinary", "notifies the operator or a teammate"],
  ["plan_create", "ordinary", "creates a plan the operator owns"],
  ["plan_add_milestone", "ordinary", "adds a dated checkpoint"],
  ["plan_assign_task", "ordinary", "assigns work to a teammate, routed to approval"],
  ["plan_update_item", "ordinary", "edits a plan item"],
  ["author_event_kind", "ordinary", "defines a kind of activity to track"],
  // Born at `confirm` + `draft` by construction, so it creates something that cannot act. Turning
  // it on is `automation_set_state`, which is owner_only.
  ["automation_draft", "ordinary", "writes down a process that cannot yet run"],
  // Solo Team work details, added 2026-09-02. A job title and a written set of responsibilities
  // describe what somebody does; they are not a claim about what that person may do. The product
  // makes that separation load-bearing in three places at once — the RPC writes only those two
  // columns and cannot reach `permission`, the Team surface says so on the editor, and the context
  // Paige reads marks tenant-authored work text as reference data that never confers authority.
  // So this is reversible in-tenant record work, and it belongs here rather than beside the
  // permission change it deliberately cannot become.
  ["team_set_work_profile", "ordinary", "edits how a teammate's work is described, never their access"],

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // THE INBOUND MCP DOOR'S ACTS, added 2026-09-05 when `paige-mcp` was first wired to this file.
  //
  // ONE NAMESPACE, NOT A SECOND ONE. `paige-mcp` registers 119 tools under its own names —
  // `create_contact` where Chat says `crm_create_contact`, `bulk_delete_contacts` where Chat said
  // `crm_delete_contact` before that legacy tool was retired (PR-A). The intersection with the
  // keys above was exactly ONE
  // (`delegate_to_subagent`), so running that surface through `classifyAction` unchanged answered
  // `unclassified` for 118 of 119 tools: refuse-by-design, correct as a default, and
  // indistinguishable from never having looked.
  //
  // Eleven MCP acts turned out to BE acts already named above and reuse those keys; the
  // fifty-two below had no twin and are named here, in this file, so there is still one
  // classifier and one vocabulary. `_shared/paige-mcp/capability-policy.ts` is the tool-name →
  // key mapping and holds no classification of its own.
  //
  // THE REUSES WERE CHECKED, NOT ASSUMED, and two candidates were REJECTED on evidence rather
  // than adopted for tidiness — each would have made an MCP act inherit a class whose stated
  // reason is false for it:
  //   · `add_contact_note` is NOT `crm_add_note`. That entry is ordinary because `client_notes`
  //     "has no client-facing read policy at all", which is true of `client_notes` and NOT of
  //     `clients.current_notes`, which is where the MCP tool writes and which
  //     `clients_linked_self_read` exposes to the client themselves.
  //   · `propose_subagent` is NOT `forge_subagent`. That entry is ordinary because "approval is a
  //     separate act", and on this tool's default path it is not: a `soft` proposal auto-ships and
  //     lands an enabled specialist.
  //
  // WHAT A CLASS HERE DOES AND DOES NOT DO TODAY. The MCP door refuses every mutation regardless
  // of class, because that channel carries no approval (see the capability policy's header). So
  // these classes are not currently what stops anything — they are what will decide how much
  // proof each act needs once an approval can reach that door. They are written to be right then.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ── owner_only: the operator's decision, in their settings ────────────────────────────────
  // create_tenant
  ["tenant_create", "owner_only", "stands up a whole new workspace and records who agreed to its terms"],

  // ── high: irreversible, moves authority, reaches outside, spends money, or reaches a client ─
  // add_contact_note
  // AN INCONSISTENCY THIS ENTRY CREATES, NAMED RATHER THAN LEFT TO BE REDISCOVERED (peer gate,
  // 2026-09-05). The limb that makes this `high` is "becomes visible to a client", because
  // `clients.current_notes` is exposed to the client by `clients_linked_self_read`. Three siblings
  // reach the same column and are `ordinary`: `crm_update_lifecycle_stage` and its deprecated twin
  // append a caller-supplied reason to it, and `crm_update_contact` accepts the field directly and
  // REPLACES it whole. The defensible line is that the act here IS writing into that column, while
  // for the others it is an audit trail alongside a different act — but `crm_update_contact` is a
  // genuinely weak case for it, and raising that key changes Chat's behaviour, which is a decision
  // for its own slice rather than a side effect of wiring MCP. Tracked; do not read the silence as
  // agreement.
  ["crm_append_contact_notes", "high", "writes into a notes field the client can read on their own record"],
  // delete_task
  // run_workflow
  ["workflow_run", "high", "fires a registered automation with real effects outside the platform"],
  // decide_pending_approval
  ["approval_decide", "high", "records a sign-off and emails everyone waiting on it"],
  // create_approval
  ["approval_create", "high", "files a review item that emails the reviewers"],
  // update_coach_profile
  ["coach_update_profile", "high", "edits another person's profile and whether new clients route to them"],
  // create_team_invitation
  ["team_invite_mint", "high", "mints workspace access and hands back a live invitation link"],
  // upsert_email_template
  ["comms_upsert_email_template", "high", "overwrites a shared template every future send renders from"],
  // send_btf_template_email, send_transactional_email, send_composed_email
  ["comms_send_email", "high", "puts an email in a real person's inbox"],
  // cancel_workflow_run
  ["workflow_cancel_run", "high", "acts on the operator's provider account to stop a run"],
  // register_workflow
  ["workflow_register", "high", "defines a new automation and where firing it points"],
  // send_invoice
  ["billing_send_invoice", "high", "emails a real person a bill and a link to pay it"],
  ["sales_publish_invoice", "high", "issues the business's reviewed customer invoice as an immutable obligation"],
  ["sales_save_collection_terms", "high", "changes agreement-backed customer repayment terms without executing a charge"],
  ["sales_stage_collection_import", "high", "stages tenant commercial records for explicit review without publishing or verifying payment"],
  ["sales_commit_collection_import", "high", "imports reviewed historical obligations and human-reported receipts into canonical customer records"],
  ["sales_record_manual_payment", "high", "records a human-reported customer payment and changes the invoice balance"],
  ["sales_reverse_manual_payment", "high", "reverses a recorded receipt while preserving the original financial history"],
  ["sales_void_invoice", "high", "withdraws an issued customer invoice and revokes its customer access"],
  ["sales_create_invoice_link", "high", "grants expiring access to a customer invoice document"],
  // run_skill
  ["skill_run", "high", "runs a recipe that can email, scrape and write on its own"],
  // verify_business
  ["business_verify", "high", "sends a company's details to outside registries and scrapers"],
  // nav_pull_business_credit (nav-pull-profile)
  ["nav_pull_business_credit", "high", "contacts a paid business-credit provider and persists sensitive credit data"],
  // smartcredit_pull_snapshot (smartcredit-pull-snapshot)
  ["smartcredit_pull_snapshot", "high", "contacts a paid consumer-credit provider and persists sensitive credit data"],
  // propose_subagent
  ["subagent_create", "high", "can put a new specialist live without a separate approval"],
  // approve_subagent_proposal
  ["subagent_approve_proposal", "high", "puts a specialist live with the prompt and code it was proposed with"],
  // create_subaccount
  ["agency_create_subaccount", "high", "provisions a whole new workspace under the agency"],
  // switch_into_subaccount
  ["agency_enter_subaccount", "high", "grants the caller admin standing inside a child workspace"],
  // create_stage_automation_rule
  ["automation_rule_create", "high", "can arm unattended sending on every future stage change"],
  // update_stage_automation_rule
  ["automation_rule_update", "high", "can arm or disarm unattended sending on an existing rule"],
  // delete_stage_automation_rule
  ["automation_rule_delete", "high", "permanently deletes an automation rule"],
  // handle_data_subject_request
  ["privacy_handle_request", "high", "erases or discloses a person's whole record, and erasure cannot be undone"],
  // approve_readiness_proposal
  ["readiness_approve_proposal", "high", "tells the client their readiness item was approved"],
  // suspend_tenant
  ["tenant_set_status", "high", "freezes or retires a whole workspace and everyone in it"],
  // update_tenant_features
  ["tenant_set_features", "high", "turns capabilities on or off for a whole workspace"],
  // add_email_domain
  ["comms_add_email_domain", "high", "registers a sending identity and can take over the address clients see"],
  // set_default_email_domain
  ["comms_set_primary_email_domain", "high", "changes the address every client sees when the tenant emails them"],
  // bulk_send_template_email
  ["comms_send_bulk_email", "high", "puts an email in up to a hundred real inboxes at once"],
  // send_btf_template_email
  //
  // Split out of `comms_send_email` because it can do one thing the other two senders cannot: the
  // caller picks `from_override`, `from_name` and `reply_to`, bounded only by which domains the
  // workspace has verified. A shared reason reading "puts an email in a real person's inbox" is
  // true and incomplete, and the missing half is who the recipient thinks it came from.
  ["comms_send_email_choosing_the_sender", "high", "sends an email and chooses which address it appears to come from"],

  // ── ordinary: reversible in-tenant record work ────────────────────────────────────────────
  // update_contact_stage, update_lifecycle_stage
  ["crm_update_lifecycle_stage", "ordinary", "moves a client between lifecycle stages on their own record"],
  // update_task, complete_task, reopen_task
  ["crm_update_task", "ordinary", "edits a task on the workspace's own queue"],
  // claim_approval
  ["approval_claim", "ordinary", "takes ownership of a review item somebody else could have handled"],
  // comment_on_approval
  ["approval_comment", "ordinary", "adds a comment to a review thread"],
  // create_admin_notification, broadcast_system_announcement
  ["platform_post_notification", "ordinary", "posts a notice on the operator's own alert surface"],
  // create_invoice
  ["billing_create_invoice", "ordinary", "raises a draft bill; sending it is the separate high-risk act"],
  // propose_client_update
  ["crm_propose_contact_update", "ordinary", "stages a change the operator approves before it applies"],
  // ingest_credit_scores
  ["ingest_credit_scores", "ordinary", "records credit figures on a person's record"],
  // ingest_banking_snapshot
  ["ingest_banking_snapshot", "ordinary", "stages banking figures for the operator to confirm"],
  // append_client_memory
  ["ingest_client_memory", "ordinary", "adds a remembered fact to a client's record"],
  // confirm_proposal
  ["ingest_confirm_proposal", "ordinary", "commits a staged change to a client's record"],
  // reject_proposal
  ["ingest_reject_proposal", "ordinary", "discards a staged change nobody committed"],
  // compose_email
  ["comms_draft_email", "ordinary", "asks one fixed specialist for a draft and sends nothing"],
  // exit_subaccount
  ["agency_exit_subaccount", "ordinary", "returns the caller to their own workspace"],
  // me_update_business
  ["business_update", "ordinary", "edits a business the caller owns"],
  // me_create_business
  ["business_create", "ordinary", "adds a business the caller owns"],
  // me_log_progress_update
  ["client_log_progress", "ordinary", "adds the caller's own progress note to their record"],
  // reject_readiness_proposal
  ["readiness_reject_proposal", "ordinary", "closes a readiness item without telling the client"],
  // record_social_accounts
  ["update_social_accounts", "ordinary", "records the accounts the workspace posts from, replacing the whole set"],
  // advance_contact_journey_stage
  ["crm_advance_journey_stage", "ordinary", "moves a client along their journey and records the step"],
];

/**
 * A Map, deliberately. An object literal would answer `classifyAction("constructor")` with a
 * function off the prototype chain, and any truthiness check downstream would then treat an
 * invented tool name as classified. A Map has no prototype to walk, so an unknown key is genuinely
 * unknown — which is the whole basis of rule 1.
 */
/**
 * A DUPLICATE KEY CAN RAISE A CLASS, NEVER LOWER ONE.
 *
 * `RISK` is a hand-maintained array and `new Map(...)` let the LAST tuple for a key win in silence,
 * so appending a second tuple for a key already present re-classified it with nothing to see. That
 * was not theoretical: `crm_update_task` carried two tuples until this change. Both said `ordinary`,
 * so nothing was actually mis-classified — but the crack was real, and it now sits under more weight
 * than it used to. `classifyAction()` decides what may be declared through the capability kit, and it
 * feeds `clampLaneByRisk()`, which forces `confirm` on an `auto` grant ONLY for `high`/`owner_only`.
 * A silent `high` -> `ordinary` downgrade would therefore leave a high-risk action running unattended
 * (§67/§68) while `direct-risk-entry` skipped the added tuple as already-declared and
 * `action-risk-lint` said nothing, because neither rejected duplicates.
 *
 * So the fold keeps the most restrictive class for a repeated key instead of the last one. With the
 * array deduplicated this is a no-op — it can only differ from `new Map(...)` when a duplicate
 * exists, and `capability-kit-lint` fails the build on one first. Deliberately fail-safe rather than
 * a load-time throw: this module is bundled into every governed edge function, so a throw would take
 * all of them down on a typo that CI already catches (§37).
 *
 * The reason string follows the winning tuple rather than the last one, so a person never reads a
 * rationale that belongs to a class the policy did not resolve.
 */
const RISK_RANK: ReadonlyArray<ActionRisk> = ["ordinary", "high", "owner_only"];

const RISK_FOLD: ReadonlyMap<string, readonly [ActionRisk, string]> = RISK.reduce(
  (folded, [tool, risk, why]) => {
    const held = folded.get(tool);
    if (held === undefined || RISK_RANK.indexOf(risk) > RISK_RANK.indexOf(held[0])) {
      folded.set(tool, [risk, why]);
    }
    return folded;
  },
  new Map<string, readonly [ActionRisk, string]>(),
);

const RISK_BY_TOOL: ReadonlyMap<string, ActionRisk> = new Map(
  [...RISK_FOLD].map(([tool, [risk]]) => [tool, risk]),
);
const REASON_BY_TOOL: ReadonlyMap<string, string> = new Map(
  [...RISK_FOLD].map(([tool, [, why]]) => [tool, why]),
);

/**
 * Tools whose names read like a mutation but which persist nothing. Each needs a reason, so that
 * "this one is fine" is a decision on the record rather than an omission. `runtimeWriteGuard` uses
 * this list, and CI checks it has not grown silently.
 */
//
// TWO SHAPES QUALIFY, and the second was added 2026-09-01 when `propose_action` surfaced. The
// first is "persists nothing" — it drafts in memory and a named separate tool does the saving.
// The second is "persists ONLY a request for a human decision, and the act that carries the risk
// is separately gated." Those are different statements and the list would be lying if it made
// the second wear the first's words.
//
// `propose_action` is the second shape, and gating it would be actively wrong: its entire purpose
// is to route work to a person, so a confirm in front of it asks the operator to approve being
// asked. The send it proposes is what carries the risk, and the send is gated. Exempting it is a
// decision on the record — which is the point of this list existing at all.
const NON_MUTATING_EXEMPT: ReadonlyMap<string, string> = new Map([
  ["growth_page_generate", "drafts a page in memory and returns it; saving is growth_page_save"],
  ["growth_funnel_generate", "drafts a funnel in memory; building it is growth_funnel_build"],
  // ADDED 2026-10-04 by owner ruling ("Drafts skip approval is a go"). content-draft returns copy and
  // persists nothing; saving it is content_save, which stays gated. Production had one approval card
  // for a draft, never answered: the gate asked the owner to approve being shown words.
  ["draft_marketing_content", "drafts copy in memory and returns it; saving is content_save"],
  ["propose_action", "files a request for the operator's decision and sends nothing; the send it proposes is the gated act"],
  // ADDED 2026-09-02 with the Pipelines merge. It persists a row, so the verb backstop was right
  // to stop it — but the row is the archive's own binding: single-use, expiring, scoped to this
  // tenant and this requester, and it changes nothing anyone would notice. Its whole purpose is to
  // show the operator what archiving would cost BEFORE they answer. Gating it would demand an
  // approval to be shown the consequences, and would put a second approval in front of one act,
  // which is the duplication the merge removed. The archive itself stays gated, and additionally
  // cannot run unless this preview exists and predates the turn.
  ["pipeline_archive_preview", "mints the archive's own single-use binding and shows the consequence; the archive it prepares is the gated act"],
  // #718 added the folder twin. Same shape, same reason: a single-use, expiring, tenant- and
  // requester-scoped row whose only job is to show the owner what archiving the folder costs
  // before they answer. The archive it prepares is the gated act.
  ["pipeline_folder_archive_preview", "mints the folder archive's own single-use binding and shows the consequence; the archive it prepares is the gated act"],
]);

/**
 * Names that read as a mutation. Used ONLY to catch a write tool somebody forgot to classify — it
 * never lowers anything, and a classified tool never consults it. Calibrated against the 87 tool
 * names this handler declares: it matches every gated tool except `delegate_to_subagent` (which is
 * classified anyway) and exactly two non-persisting generators (exempted above).
 */
//
// EXTENDED 2026-09-01, after it failed to catch six ungoverned writes. `pipeline_configure` was a
// previously-gated tool this policy omitted, and `comms_buy_number` / `comms_name_number` arrived
// from main; none matched, so all three read as queries and would have dispatched with no gate at
// all. `configure`, `buy`, `name` and `propose` are added. A false POSITIVE here is harmless — it
// forces an explicit classification or a named exemption — while a false negative is an ungoverned
// write, so this list should err long. It remains a BACKSTOP, never the guard: the reconciliation
// that actually found those six compared the handler's declared tools against this policy, and
// that comparison is what `lint:action-risk` runs.
//
// EXTENDED 2026-09-12 with `decide`, after `improvement_decide` (the evaluation loop's sign-off,
// #1123) shipped with no class AND a verb this list did not name — so its name read as a query, it
// skipped the `MUTATING_TOOLS` gate entirely, and it ran from chat with no rendered approval card.
// Classifying it `high` above is the primary fix; `decide` is added here so the runtime backstop
// (`unclassifiedWriteReason`) and the CI lint would ALSO catch a future unclassified `*_decide`
// write, rather than relying on the classification alone. The lint keeps a byte-identical copy and
// `checkVerbParity` fails the build if the two ever diverge.
export const MUTATION_VERB = /(^|_)(create|update|delete|remove|save|send|publish|install|uninstall|grant|revoke|run|assign|enroll|book|set|draft|generate|file|advance|forge|archive|activate|deactivate|move|add|build|log|author|enable|disable|invite|upload|apply|approve|reject|decide|import|export|sync|write|post|schedule|cancel|start|stop|trigger|fire|configure|buy|purchase|pull|name|rename|propose|provision|claim|release)(_|$)/;

/** Every classified action. This is what the handler gates on — there is no second list. */
export function mutatingTools(): ReadonlySet<string> {
  return new Set(RISK_BY_TOOL.keys());
}

/**
 * The one classification call. Takes a tool name and nothing else, on purpose: an extra parameter
 * here is the seam through which a request would eventually be allowed to argue about its own risk.
 */
export function classifyAction(tool: string): ActionRiskVerdict {
  return RISK_BY_TOOL.get(tool) ?? "unclassified";
}

/**
 * THE ACTION-CLASS AUTONOMY CLAMP — the ONE home (§18) for the rule "a HIGH or owner-only action
 * never runs unattended, even on an `auto` grant." The trust-compass RPC (`resolve_tool_autonomy`,
 * §67/§68) clamps by the platform/tenant AUTONOMY RUNG; it does NOT look at the action's RISK class.
 * That second clamp lived only inline at the chat dispatch, so a HIGH tool on an `auto` grant at a
 * permissive rung resolved `auto` everywhere the dispatch did not run — e.g. the capability manifest,
 * which would then tell the owner a high-risk act needs "no approval" while the dispatch always forces
 * the card. Both the dispatch AND the manifest gatherer now resolve the effective lane through HERE,
 * so they cannot diverge. Pure; `auto` on high/owner_only → `confirm`, everything else passes through.
 */
export function clampLaneByRisk(
  lane: "auto" | "confirm" | "off",
  tool: string,
): "auto" | "confirm" | "off" {
  if (lane === "auto") {
    const cls = classifyAction(tool);
    if (cls === "high" || cls === "owner_only") return "confirm";
  }
  return lane;
}

/** Why an action carries its class, for a message a person will read. Never a tool name. */
export function riskReason(tool: string): string | null {
  return REASON_BY_TOOL.get(tool) ?? null;
}

/**
 * THE LAST LINE, at runtime rather than in CI. A tool that is not classified but whose name reads
 * as a write is refused before it can execute. CI catches this case first and should always catch
 * it — but CI catches it in the repository, and this catches it in production, which is where a
 * missed classification would otherwise become an ungoverned write.
 *
 * Returns null when the tool may proceed as read-only.
 */
export function unclassifiedWriteReason(tool: string): string | null {
  if (RISK_BY_TOOL.has(tool)) return null;          // classified: the gate handles it
  if (NON_MUTATING_EXEMPT.has(tool)) return null;    // named, with a reason, as persisting nothing
  if (!MUTATION_VERB.test(tool)) return null;        // reads as a query
  return "this action has no risk classification, so it cannot run";
}

/** Exposed for the CI guard so the lint and the runtime cannot disagree about the exempt list. */
export function nonMutatingExemptions(): ReadonlyMap<string, string> {
  return NON_MUTATING_EXEMPT;
}
