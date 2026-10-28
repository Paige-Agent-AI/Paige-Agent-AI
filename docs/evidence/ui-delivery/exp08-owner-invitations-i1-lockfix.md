# UI delivery evidence: EXP08 co-owners I1 lock fix (#3016) — the same visible flow, landed on production

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow packet is docs/delivery/exp08-co-owners-entity-owners-contract.md (rulings R12–R15, §5.1–§5.5, the I1 row) and the tier-matrix ledger "EXP08 co-owners and entity owners, I1"; the visible flow this record covers is Agency (and Enterprise) Team → Invite → role "Owner" → Send, plus every other create_tenant_invite_token caller that asks for Owner
PAIGE_UI_DESIGN: PASS: no UI file changes in I1; Impeccable's reference/craft-floor.md and .agents/skills/paige-ui-design/SKILL.md read for the one visible consequence, which is copy in the existing Agency Team flash line (src/agency/team.tsx:277), unchanged in style, token and layout; the sentence follows §3 voice and says what the person CAN do
MATERIAL_FLOW_CHANGE: NO: #3016 changes how the I1 migration takes its table locks so it can apply on production; the visible flow is exactly the one recorded in exp08-owner-invitations-i1.md (#3008), which goes live with this deploy
FLOW_PROTOTYPE: NOT_REQUIRED: no flow change in this PR; the co-owners design approved 2026-10-27 is unchanged
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an agency or enterprise admin inviting someone to their own team; primary action is the existing Send on the invite form, unchanged; the refusal tells them where an owner is added instead
VISUAL_DIRECTION: PASS: unchanged — the existing flash line and its tokens; no new colour, no gold, no component change
AUTOMATED_EVIDENCE: PASS: behavioural lock test on disposable PostgreSQL 16 — a reader holds a share lock on tenant_members for 5 s; the block waits it out and ends holding ACCESS EXCLUSIVE (5.08 s) while a new reader arriving mid-wait still gets in within 0.05 s; mutant with NOWAIT removed: that reader is blocked (canceled at 200 ms). I1 proof re-run on this head: 184 cases (production 58 pass / 126 fail as expected; migrated 184/0), 95/95 mutants killed, 4/4 controls
STATIC_EVIDENCE: PASS: lint:migration-versions and lint:definer-fns pass; the diff adds SET LOCAL statement_timeout and one DO block before the incumbent guard, nothing else in the migration changes
RENDERED_EVIDENCE: UNVERIFIED: the Agency Team screen was not rendered with the refusal; there is no agency harness in this branch and no credentials for a signed-in agency account; the sentence's appearance is the existing flash line, unchanged
BEHAVIORAL_EVIDENCE: PASS: database behaviour driven in the proof (the RPC refuses Owner for every kind and caller, the platform owner included, with the tier sentence and HINT OWNER_INVITE_SETTINGS_ONLY / OWNER_INVITE_UNAVAILABLE, and mints nothing); the screen side is the static trace above, not a browser drive
AUTHENTICATED_RUNTIME: UNVERIFIED: no credentials for an agency account or the owner-designated SOLO account (LIVE_DRIVE_EMAIL / LIVE_DRIVE_PASSWORD not set); owed: on Agency Team pick Owner, send, see the Agency sentence and no join link; pick Admin, send, see "Invite created — the join link is ready."
KEYBOARD_FOCUS: PASS: no control added, removed or reordered; the invite form's keyboard path is unchanged
ZOOM_REFLOW: PASS: no layout change; the flash line is the existing element and the sentence wraps as any flash message does
REDUCED_MOTION: PASS: no motion added or changed
STATE_COVERAGE: PASS: locks free (first attempt), locks held by a reader (waits without queueing, then takes them), locks never free (600 tries, then a stated refusal with nothing applied)
TRUTHFUL_STATE_LABELS: PASS: the I1 record now says the migration is not live until this deploy reads back
SOLO_UI: NO: the visible change is on the Agency Team screen (src/agency/team.tsx), not a Solo surface; the Solo owner-invitation screens are I3
UNVERIFIED: the production apply and its read-back (owed right after merge); the signed-in Agency Team drive, as in exp08-owner-invitations-i1.md

OWNER_INTENT: an Owner is invited only by the account holder of the business, from Settings → Team (owner rulings R1, R4); nobody else can mint an owner, and no screen reports an owner invitation that will not produce one
MUST_NOT_HAPPEN: an owner seat created by anyone but the account holder's invitation; "Invite created" shown for an Owner on Agency Team; Admin or Member invitations on Agency Team breaking
MUST_PRESERVE: Agency Team Admin and Member invitations; the Agency Team screen's design and copy outside the flash sentence; consumer, team and subaccount_owner token kinds for their existing callers
ACCEPTANCE_CRITERIA: on Agency Team an admin picks Owner, sends, and reads the Agency sentence with no join link; picking Admin still creates a join link
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: create_tenant_invite_token (Owner refused; other roles unchanged, proof), accept_tenant_invite (owner tokens refused), peek_tenant_invite, create_/resend_/revoke_/archive_/accept_solo_team_invite (byte-identical outside marked edits, proof case 13); Solo and Sub-account shells NONE_AFFECTED: no UI file changed

INTERNAL_BUILD_IDENTITY: 06d95f0274a9a35aba970774896a76774425752c; deployment=none (PR 3016 branch, the lock fix on top of the 3008 merge ccb14485c); environment=local; migrations=PROOF_OWED(20271120010008_exp08_owner_invitations applies on merge through deploy-migrations, after two timed-out applies of the 3008 version rolled back with production unchanged); edge=APPLIED(paige-ai-chat@ccb14485c, accept-invite@ccb14485c, send-portal-invite@ccb14485c, solo-team-invitations@ccb14485c); evidence=this record and supabase/tests/exp08_owner_invitations.sql
RELEASE_CHANNEL: development: branch build; ships to production on merge to main per the pre-launch stance (§4)
RELEASE_CLASSIFICATION: internal-only: pre-launch platform with no live customers
CUSTOMER_RELEASE_IDENTITY: none: internal-only pre-launch work
RELEASE_NOTE_REQUIRED: NO: internal-only; no customer release
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the database refusals are proven on disposable PostgreSQL and are NOT yet live (the migration is unapplied until #3016's deploy reads back); the edge functions shipped with #3008 are live and degrade safely without it (send-portal-invite's new account-holder check runs only for owner tokens, of which production had none); the Agency Team screen showing the sentence stays a static trace until a signed-in drive
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
- Server sentences: `supabase/migrations/20271120010008_exp08_owner_invitations.sql`, `create_tenant_invite_token` FIX-1 block.
