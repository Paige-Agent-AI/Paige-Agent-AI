# UI delivery evidence: EXP08 co-owners I1 — owner invitations (server change with a visible refusal on Agency Team)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow packet is docs/delivery/exp08-co-owners-entity-owners-contract.md (rulings R12–R15, §5.1–§5.5, the I1 row) and the tier-matrix ledger "EXP08 co-owners and entity owners, I1"; the visible flow this record covers is Agency (and Enterprise) Team → Invite → role "Owner" → Send, plus every other create_tenant_invite_token caller that asks for Owner
PAIGE_UI_DESIGN: PASS: no UI file changes in I1; Impeccable's reference/craft-floor.md and .agents/skills/paige-ui-design/SKILL.md read for the one visible consequence, which is copy in the existing Agency Team flash line (src/agency/team.tsx:277), unchanged in style, token and layout; the sentence follows §3 voice and says what the person CAN do
MATERIAL_FLOW_CHANGE: YES: on Agency Team, choosing Owner and sending used to report "Invite created — the join link is ready." for a token that, once accepted, seated the person as Admin (it never produced an owner); it now ends at the server's refusal, shown in the same flash line: "Agency accounts add Admins and Members. An owner is added by the account holder of a business account, from its Settings → Team." (Enterprise says "Enterprise accounts …"; a business account says "Owners are added only by this business's account holder, from Settings → Team. You can invite an Admin or Member here."; a company workspace says "Owner invitations aren't available for this account."), and no token is minted; a previously minted owner token is refused at accept by accept_tenant_invite instead of seating an Admin
FLOW_PROTOTYPE: PASS: the co-owners design, round 5, owner-approved 2026-10-27 ("Love the look.. It's approved", APPROVED-FROZEN §28), which routes every owner invitation through the account holder's Settings → Team; the Agency Team Owner option itself is unchanged and its removal is an OWNER DECISION OWED (contract I1 row, I3)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an agency or enterprise admin inviting someone to their own team; primary action is the existing Send on the invite form, unchanged; the refusal tells them where an owner is added instead
VISUAL_DIRECTION: PASS: unchanged — the existing flash line and its tokens; no new colour, no gold, no component change
AUTOMATED_EVIDENCE: PASS: supabase/tests/exp08_owner_invitations.sql on disposable PostgreSQL 16 — 184 cases (58 kept, 52 production holes closed, 74 new), 95/95 mutants killed, 4/4 controls survive; the create_tenant_invite_token Owner sentences are asserted verbatim for an agency account (cases 1.45, 1.59), a business account and a sub-account worked from its agency (1.26, 1.27, 1.46, 1.58) and a company workspace (1.47), each refusing with no token minted; the Enterprise wording ("Enterprise accounts …") is the same branch with the other noun and has no case of its own; accept_tenant_invite refusing an owner token is asserted; incumbent guard suite S2 passes (G1–G6, D, J, F; mutants M1–M5 killed)
STATIC_EVIDENCE: PASS: the client path traced by reading: src/agency/data/useAgencyPeople.ts:397-404 returns { ok:false, error: error.message } on an RPC error, and src/agency/team.tsx:275-277 flashes r.error, so the person sees the server sentence verbatim and the success line is not shown; lint:migration-versions and lint:definer-fns pass; ci:tsc no new errors
RENDERED_EVIDENCE: UNVERIFIED: the Agency Team screen was not rendered with the refusal; there is no agency harness in this branch and no credentials for a signed-in agency account; the sentence's appearance is the existing flash line, unchanged
BEHAVIORAL_EVIDENCE: PASS: database behaviour driven in the proof (the RPC refuses Owner for every kind and caller, the platform owner included, with the tier sentence and HINT OWNER_INVITE_SETTINGS_ONLY / OWNER_INVITE_UNAVAILABLE, and mints nothing); the screen side is the static trace above, not a browser drive
AUTHENTICATED_RUNTIME: UNVERIFIED: no credentials for an agency account or the owner-designated SOLO account (LIVE_DRIVE_EMAIL / LIVE_DRIVE_PASSWORD not set); owed: on Agency Team pick Owner, send, see the Agency sentence and no join link; pick Admin, send, see "Invite created — the join link is ready."
KEYBOARD_FOCUS: PASS: no control added, removed or reordered; the invite form's keyboard path is unchanged
ZOOM_REFLOW: PASS: no layout change; the flash line is the existing element and the sentence wraps as any flash message does
REDUCED_MOTION: PASS: no motion added or changed
STATE_COVERAGE: PASS: Owner refused (Agency, business account, sub-account from its agency, company workspace; Enterprise by the same branch, no own case); Admin and Member unchanged (proof keeps their mint cases); an existing owner token refused at accept; Send busy/idle unchanged
TRUTHFUL_STATE_LABELS: PASS: the screen no longer says "Invite created" for an owner invitation that never produced an owner (§13); the refusal names where an owner is actually added
SOLO_UI: NO: the visible change is on the Agency Team screen (src/agency/team.tsx), not a Solo surface; the Solo owner-invitation screens are I3
UNVERIFIED: the rendered and signed-in Agency Team drive named in AUTHENTICATED_RUNTIME; whether to remove the Owner option from Agency Team (owner decision owed, I3)

OWNER_INTENT: an Owner is invited only by the account holder of the business, from Settings → Team (owner rulings R1, R4); nobody else can mint an owner, and no screen reports an owner invitation that will not produce one
MUST_NOT_HAPPEN: an owner seat created by anyone but the account holder's invitation; "Invite created" shown for an Owner on Agency Team; Admin or Member invitations on Agency Team breaking
MUST_PRESERVE: Agency Team Admin and Member invitations; the Agency Team screen's design and copy outside the flash sentence; consumer, team and subaccount_owner token kinds for their existing callers
ACCEPTANCE_CRITERIA: on Agency Team an admin picks Owner, sends, and reads the Agency sentence with no join link; picking Admin still creates a join link
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: create_tenant_invite_token (Owner refused; other roles unchanged, proof), accept_tenant_invite (owner tokens refused), peek_tenant_invite, create_/resend_/revoke_/archive_/accept_solo_team_invite (byte-identical outside marked edits, proof case 13); Solo and Sub-account shells NONE_AFFECTED: no UI file changed

INTERNAL_BUILD_IDENTITY: 7bdbbb4e019060ed4a84f2bace5196421dc440f5; deployment=none (PR #3008 branch head; this record is the next commit, documentation only); environment=local; migrations=PROOF_OWED(20271119020008_exp08_owner_invitations applies on merge through deploy-migrations); edge=PROOF_OWED(paige-ai-chat redeploys on merge for _shared/team-hub/agent-turn.ts); evidence=this record and supabase/tests/exp08_owner_invitations.sql
RELEASE_CHANNEL: development: branch build; ships to production on merge to main per the pre-launch stance (§4)
RELEASE_CLASSIFICATION: internal-only: pre-launch platform with no live customers
CUSTOMER_RELEASE_IDENTITY: none: internal-only pre-launch work
RELEASE_NOTE_REQUIRED: NO: internal-only; no customer release
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the database refusals are proven on disposable PostgreSQL and go LIVE on merge; the Agency Team screen showing the sentence is a static trace until a signed-in drive
RELEASE_RECOVERY: position=forward migration re-emitting the 10 prior bodies, pinned by md5 in the proof; reference=supabase/tests/exp08_owner_invitations.sql and the contract I1 row

## Scope and collisions

- Classification: backend change with a visible consequence (`Visible-Flow-Impact: yes`).
- Affected flows: Agency/Enterprise Team invite with role Owner; accept of a previously minted owner token.
- Neighboring regressions: Admin and Member invites on Agency Team (unchanged, proof).
- Active-owner/file collisions: none; no file under src/ changes.
- Explicit exclusions: the Solo owner-invitation screens (I3); removing the Agency Owner option (owner decision owed).

## Evidence index

- Proof: `bash` run of `supabase/tests/exp08_owner_invitations.sql` on PostgreSQL 16, 2026-10-27, exit 0, counts above.
- Client trace: `src/agency/team.tsx:275-279`, `src/agency/data/useAgencyPeople.ts:385-408`.
- Server sentences: `supabase/migrations/20271119020008_exp08_owner_invitations.sql`, `create_tenant_invite_token` FIX-1 block.
