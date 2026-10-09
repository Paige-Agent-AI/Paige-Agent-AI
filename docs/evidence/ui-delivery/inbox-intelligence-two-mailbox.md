# UI delivery evidence: #1140 two-mailbox inbox intelligence — chat capability substrate

A backend and chat-capability change with no rendered-screen change. One migration, two new edge
functions, one extended webhook, two extended OAuth functions, one spine domain, one chat-handler
wiring, one CI workflow listing.

- **Personal Gmail mailbox (new):** the owner grants incremental inbox consent (purpose=inbox →
  gmail.modify + gmail.labels; the sending flow keeps its original gmail.send consent). The sync
  engine (gmail-mailbox-sync, cron-token gated) reads a bounded 14-day/200-message initial window,
  reconciles incrementally via history ids, falls back to bounded re-reconcile when the history
  window expires, classifies each inbound through the model router's classify job kind, applies
  auto labels, and NEVER issues a Gmail write — organization is the door's alone.
- **Shared support mailbox (new on the existing inbound rail):** handle-inbound-email now calls the
  one shared engine RPC (record_inbound_message_intelligence): case upsert per thread, follow-up
  cancellation on every customer reply, classification + risk tier recorded, elevated intents
  (billing, refund, account access, security, legal) surfaced to a person by construction.
- **Chat verbs (new, Spine-registered):** read_message_content (the separately-authorized body
  read — comms.messages_read stays envelope-only), read_support_cases, and gmail_organize through
  the comms-mailbox-command door (canonical approval card; label/unlabel/archive/unarchive/
  trash/untrash/unsubscribe_propose/unsubscribe_send; every kind reversible; no delete kind exists).
- **Private/shared boundary:** channel_connectors gains mailbox_class + mailbox_owner_user_id +
  mailbox_scopes. messages RLS hides personal-mailbox rows from every non-owner staff seat; the
  envelope reader (list_inbox_messages) re-emits with the same predicate; the labels and
  classifications tables carry it too. An inactive connector refuses both read and organize.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: both mailbox flows inventoried producer-and-consumer first — personal: consent (gmail-oauth-start/callback) then sync (gmail-mailbox-sync) then read (read_message_content) then organize (comms-mailbox-command door); shared: inbound (handle-inbound-email) then engine RPC then case/follow-up reads (read_support_cases) then draft (existing comms-draft-reply action + email-composer) then send (existing comms.email_send door, untouched); actor=workspace owner or admin for consent and organize, tenant staff for reads, service cron for sync; goal=one engine, two server-enforced policies
PAIGE_UI_DESIGN: PASS: paige-ui-design router considered; no layout, token, motion or component change — the owner-facing experience is conversational over the existing Solo Conversations surface and the existing approval-card component; no screen is added or altered
MATERIAL_FLOW_CHANGE: YES: the owner can now assign two inbox responsibilities through normal language and approve mailbox organization on the existing Needs-your-OK card; the flow is new at the capability level and renders entirely through the existing conversation and approval-card surfaces — no new screen, modal, drawer or component
FLOW_PROTOTYPE: WAIVED: owner-decision=the 2026-10-08 owner-approved two-mailbox pilot directive fixing chat as the primary command surface over the existing Solo Conversations and Settings surfaces; reason=no new screen, modal, drawer or component exists to prototype — every new flow renders through the existing conversation surface and the existing approval card
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience = the workspace owner (personal mailbox consent, organize approvals, support-case triage) and tenant staff (support case reads); purpose = Paige reads, classifies, labels and organizes both mailbox types under separate server-enforced authorization while the private mailbox stays invisible to every other seat; the owner's primary action is a plain-language request answered with a card or a read result
VISUAL_DIRECTION: NOT_APPLICABLE: no visual surface changed; existing chat surfaces render the new tools' results
AUTOMATED_EVIDENCE: PASS: supabase/functions/_shared/inbox-intelligence 4 suites 31/31 — all four failed before the modules existed (failing-first captured in the build log); policy gates prove owner-only personal read, same-tenant staff refusal, foreign-tenant refusal, inactive-connector refusal, scope gates; the classifier refuses injected instructions, unknown intents, extra keys and out-of-range confidence; the sync planner proves the bounded window, idempotent replay keys, soft-removal, expired-history fallback; the organize contract proves closed-union parsing, per-kind undo, https-only unsubscribe targets; comms suites 105/105 and registry consumers 49/49 stay green; the migration executed BEGIN-to-ROLLBACK against the live schema with zero errors
STATIC_EVIDENCE: PASS: deno check clean on gmail-mailbox-sync, comms-mailbox-command, gmail-oauth-start, gmail-oauth-callback, handle-inbound-email, paige-ai-chat; deno edge ratchet no new or increased diagnostics across all six; tsc ratchet 10 to 10; action-risk, capability-kit, capability-declaration, chat-tool-registry and migration-version-collision lints green
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered surface changed; the new tools' results render through the existing conversation component tree
BEHAVIORAL_EVIDENCE: PASS: pure-module gate behavior proven headless (policy gates, classification parsing, sync planning, command parsing); door replies are a closed set with honest not-applied and unconfirmed-outcome notes; live provider round-trips are named under the release truth boundary
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in QA session and no live Gmail inbox consent exist in this environment, so the end-to-end chat drives (list then read then organize with an approval round-trip) are owed to post-deploy acceptance; the reason is the external Google OAuth verification dependency named in the PR body
KEYBOARD_FOCUS: NOT_APPLICABLE: no rendered control changed
ZOOM_REFLOW: NOT_APPLICABLE: no rendered surface changed
REDUCED_MOTION: NOT_APPLICABLE: no motion involved
STATE_COVERAGE: PASS: server outcomes covered at contract level — personal not-owner, workspace role required, mailbox inactive, scope revoked, message not in workspace, approval required, applied with undo kind, provider refused, provider unanswered, unsubscribe target absent, malformed command; each maps to an honest chat note that never claims an act it did not verify
TRUTHFUL_STATE_LABELS: PASS: tool notes distinguish not-applied refusals from unconfirmed outcomes; gmail_organize states the mailbox was not changed before approval and names the exact undo after; the sync engine records its own last status and error for inspection
SOLO_UI: NO: no src/solo, tenant-shell, growth or public-site path changed; the experience is the existing Solo Conversations surface for every tenant identically
UNVERIFIED: the authenticated chat drives on production, the live Gmail consent round-trip, the cron tick's first real sync, and the door's provider round-trip — all owed to the post-deploy acceptance the PR names; blocked on the owner-side Google console activation noted in the PR body

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: 7e85978eb19ad588584aa61baba28e9e4192d3a3; deployment=none-pre-merge; environment=development; migrations=APPLIED(20270602000201_inbox_intelligence_two_mailbox); edge=PROOF_OWED(edge-deploy-on-merge-gmail-mailbox-sync-and-comms-mailbox-command-plus-touched); evidence=inbox-intelligence-suites-and-lints
RELEASE_CHANNEL: development: code on branch inbox-intelligence-two-mailbox; migrations and edge functions deploy to production on merge via the standing workflows
RELEASE_CLASSIFICATION: internal-only: a new governed capability substrate with no customer-visible screen change; activation needs owner-side Google console work and consent
CUSTOMER_RELEASE_IDENTITY: none: no owner-decided customer release; the capability is dormant until a mailbox is connected
RELEASE_NOTE_REQUIRED: NO: internal capability substrate; nothing existing changes for any current user
RELEASE_TRUTH_BOUNDARY: PROOF OWED: policy gates, classification refusal behavior, sync planning, command contracts and the SQL itself are proven in CI and the begin-rollback validation; the live consent, first cron sync, chat drives and door provider round-trip are the post-deploy acceptance owed and are blocked on the named Google activation dependency
RELEASE_RECOVERY: position=revert the PR merge commit and the migration is forward-only-safe because it only adds tables columns and functions — reverting code leaves inert substrate no caller reaches; reference=git revert of the PR merge commit on branch inbox-intelligence-two-mailbox

## Scope and collisions

- Classification: governed comms capability substrate (Spine domain, one migration, two new edge functions, webhook + OAuth extensions, chat wiring, CI listing).
- Affected flows: Gmail connection settings flow gains a purpose=inbox variant (no UI change); inbound email gains the intelligence engine call (non-blocking); chat gains three tools.
- Neighboring regressions: comms.email_send, email-composer, send-message untouched; the envelope reader keeps its exact projection plus the personal predicate; the legacy dual-write bridge untouched.
- Active-owner/file collisions: no open PR touches these files at time of writing (checked via REST before branch).
- Explicit exclusions: the canonical-label chat verb without a door (dropped for lint-architecture honesty — labeling rides the approval-gated door or the owner-correction RPC this slice); bounded acknowledgement automation (shipped as the follow-up state machine's refusal, never an auto-send); learned-candidate promotion (memory-lane contract owns it — no second memory engine built).

## User job and state map

Purpose: the owner runs two mailboxes through one Paige — she reads and organizes the private one
only for the person who granted it, and runs the shared support one for the team with follow-ups
that never loop. State: connector mailbox policy (class, owner, scopes, active) decides every
gate; sync state records what the engine last did; cases and labels are tenant-scoped records.

## Evidence index

- Failing-first: all 4 inbox-intelligence suites red before the modules existed (build log), green after — 31/31.
- `psql <migration> BEGIN..ROLLBACK` against the live schema: exit 0, zero errors.
- deno check + deno edge ratchet (6 functions): clean; tsc ratchet 10→10; five CI lints green; comms 105/105; registry consumers 49/49.
