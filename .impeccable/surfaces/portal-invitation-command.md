# Existing owner Portal — canonical invitation action

Mode: Operate. Ordinary interaction extension of the approved owner Portal and shared PaigeConfirmCard; inherit nt-relationships-ownerportaldashboard-tsx-2fff7d6a.md, PRODUCT.md and DESIGN.md. No new visual world, comp or system change.

User intent: the owner selects a CRM customer, reviews the exact server-resolved recipient, approves one stored invitation command and returns to canonical history. Dashboard, typed owner Chat and governed Live must use that same command. Private customer Chat receives no owner invitation capability.

Direction: keep Mineral/Obsidian, Schibsted UI, quiet warm surfaces, thin rules and gold on the actual approval. Preserve compact owner navigation, current native modal and scroll owner. Remove the redundant stale recipient field; the server card owns the recipient disclosure. No separate confirmation style or application shell.

Interaction: Review → canonical Needs your OK → Approve or Not now → non-repeatable report. Focus the card rather than Approve. Read-only Check status retrieves the original native result and never sends. Uncertainty requires explicit fresh review of the same operation. Known completed attempts permit an explicit fresh resend review. Retire late results on account/context changes; browser timeout is not proof of failed delivery.

Engineering packet/state map: docs/delivery/e09-dashboard-invitation-command.md. Existing owner approved design and subsequent Build → Ship → Owner Test direction control; no new manual approval gate. Preserve pending-token cancellation and the existing history's delivery/acceptance distinction.

Bounded hardening preserves that interaction and visual direction. An approved request whose control unmounts retains the existing per-contact lock through scoped history invalidation, including a lost response; it never retries sending. Retiring preparation alone changes no invitation/email history. When the preparing control retires, only fallback body/native-dialog focus moves to the existing review card. Another focused input is preserved and Approve is never auto-focused. The shared PaigeConfirmCard remains unchanged.

Prototype: docs/evidence/ui-delivery/assets/e09-invitation-command-prototype/result.json (23 controlled browser cases before production edits). Fresh finished actual UI binding: docs/evidence/ui-delivery/assets/e09-invitation-command/result.json (23 cases, zero errors, 27 PNGs; all 19 LF-normalized source hashes match). Command/Manager/Concurrency suites pass 49/49 for the bounded repair; the canonicalized pre-repair regression reproduced missing readback with 2 passes/1 failure. Network is blocked and SDK/Auth/provider records are synthetic; this proves no physical Safari/iPhone, real account, provider delivery or customer acceptance.

For this new bounded invitation UI increment the detector ran once on its three changed UI targets and returned an empty finding list; the prior Resources build's detector was not repeated. Finish handoffs must preserve DESIGN.md and .impeccable/design.json and report pre-existing drift rather than repairing it unasked.
