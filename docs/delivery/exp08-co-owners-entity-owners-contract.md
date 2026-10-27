# EXP08 co-owners and entity owners: delivery contract

Status: **CONTRACT, round 7 (2026-10-27): design APPROVED by the owner (§28 frozen), open questions §10.1, §10.2a, §10.11 and §10.13 owner-ruled (R12–R15); R16 (operator powers over Solo accounts kept as shipped) reverses B3, D-A, D-B. I1 built (branch `exp08-owners-i1`, migration `20271119020008`), round 2, 3, 4, 5, 6 and 7 review findings applied.** Round 5 text follows, amended only where those rulings change it; reversed text is kept struck through and marked (§58), never silently deleted. Grounded on **`origin/main` at `50468eec2`** (fetched
2026-10-26). **PR #2945 is merged, as squash `51ede67eb`, and applied on production:** the `db-live` tag, which
`deploy-migrations.yml` moves only after a persisted apply (§32), points at `51ede67eb` (`git ls-remote origin
refs/tags/db-live`, read 2026-10-26). Production itself was not queried in round 5. `supabase/migrations/20271116020008_exp08_co_owner_authority.sql` on `origin/main` is
**byte-identical** to its version at the PR head `8587262ea` that round 4 cited (`diff` empty), so every
`20271116020008:N` citation is re-cited from `origin/main` at the same lines. Between `8587262ea` and `50468eec2`, 28
files changed (`git diff --name-only`); none is a file cited here, and the diff adds an owner term only in two test fixtures
(`supabase/tests/email_campaign_sendgrid_lane.sql` inserts an owner seat as setup; a Vitest stub sets
`mailbox_owner_user_id`). Every `file:N` citation below is that file on `origin/main`.

Applies to **every** Solo account; a capability, not a fix for one account (§63). The design is the
prototype `settings-team-owners.html` (same folder). **Every on-screen string in §4 is the prototype's
string; the two must stay identical.** Examples use the prototype's fictional data: the business
*Northstar Studio*, the account holder *Morgan Hale*, the co-owner *Taylor Quinn*, the admin *Dana
Reyes*, the legal owner *Harbor Lane Holdings LLC* represented by *Jordan Ellis*, and *Cedar Row Trust*
(on record, no seat).

## 0. Owner rulings (Antonio, 2026-10-26, EXP08 session)

Recorded in `scratchpad/owner-ui-notes.md` (sections "~20:30Z", "~20:45Z", "~21:30Z"); owed to
`docs/brain/decision-log.md` in I5. Each row says where its words come from.

| # | Ruling | Source |
|---|---|---|
| R1 | **The account holder can choose any role on an invitation, including Owner. Nobody but the account holder chooses Owner; admins (and co-owners) keep inviting admins and members (R14).** | Integrator wording (round 5, D-E) of "On the invite **I** should always be able to choose their roles" (20:30Z). "Nobody else can choose Owner" follows from "only the account holder adds/removes owners" (20:45Z, 1; R4) |
| R2 | A workspace can have several owners. The **account holder** is the user in `tenants.owner_user_id` who also holds an active owner seat. | **Implicit:** "Defaults confirmed implicitly" (20:45Z) |
| R3 | An owner can be an **entity** (company, trust, partnership or another legal person). An individual signs in and acts for it. | 20:30Z |
| R4 | Co-owners run the business, not the ownership: admins and members, invitations, permissions and billing as today. **Only the account holder adds or removes owners.** | 20:45Z, 1 |
| R5 | Removing a co-owner: the account holder chooses each time, keep them as an Admin or remove them entirely after the departure review. A co-owner can step down to Admin. | 20:45Z, 2 |
| R6 | If an entity's representative leaves, its owner seat is **held vacant** until the account holder names a new representative. Nobody inherits it. | 20:45Z, 3 |
| R7 | PAIGE may invite an Owner from chat, for the account holder only. The approval card says the person gets full control; nothing is sent before approval. | 20:45Z, 4 |
| R8 | Existing co-owners stay as they are. | **Implicit:** "existing co-owner stays as is" (20:45Z). "No backfill" is CC's reading of it |
| R9 | **Platform recovery only.** A platform super admin may add or remove an owner **only when the business has no working account holder**. Every use is audited and the account holder is told. Otherwise refused. *(CC addition, not ruled: every use carries a written reason, §5.4a.)* | 21:30Z, 5. The owner's word is "audited"; "with a reason" is CC's |
| R10 | The account holder can make an existing admin or member an Owner from their details, as a person or for a legal owner, with the same full-control confirmation. *(CC addition, not ruled: the same act is how an existing teammate becomes a legal owner's representative, §4.8.)* | 21:30Z, 6. The representative sentence is CC's |
| R11 | A legal owner with no representative is **held only**. No way to end or close the seat; changing ownership is a later, separate step. | 21:30Z, 7 |
| R12 | **`set_account_holder`: YES, recovery only.** A platform super admin may set the account holder only when the business has no working account holder, to a user who already holds an **active** owner seat, with a written reason, audited, the person notified, Solo accounts only. | Owner-ruled 2026-10-27 (AskUserQuestion, §10.1); `owner-ui-notes.md` "Co-owner open questions answered" |
| R13 | **A billing-paused account holder is still the account holder.** Recovery is refused while the holder's seat is paused for billing. | Owner-ruled 2026-10-27 (§10.2a) |
| R14 | **Admins may invite admins or members: KEEP AS TODAY.** Nobody but the account holder chooses Owner (R1); admins keep inviting admins and members, and co-owners invite admins and members. | Owner-ruled 2026-10-27 (§10.11) |
| R15 | **Billing/promotional restoration of the holder's own seat: YES.** Subscription provisioning and the promotional grant may restore the account holder of record's own owner seat, audited and with a notice; never seats anyone else. | Owner-ruled 2026-10-27 (§10.13). The archived-account sub-question was not asked: per the owner's "go with the contract's defaults", it stays **named, not changed** (§5.4d) |
| R16 | **Platform operators keep their shipped powers over Solo accounts.** Platform super_admin AND platform_admin keep archive (`operator_archive_account`), restore, delete (`operator_delete_archived_account`), `revoke_platform_access` and `admin-delete-user` on Solo accounts exactly as shipped, gated as shipped (`operator_may` / `is_platform_admin()` / `is_platform_owner()`). No refusal is added to these paths. The co-owner rules still govern who OWNS a live business (grant/revoke co-owner, `set_account_holder` recovery, owner invitations). **Reverses B3, D-A, D-B (below) and the round-5 restore/archive gating.** | Owner-ruled 2026-10-27, verbatim: *"Platform Operator Owner and Admin should have the power to remove, Archive and Delete a Solo Account. That was created already and I want to keep it that way."* (`owner-ui-notes.md`, "Operator powers over Solo accounts: KEEP AS SHIPPED") |

**Owner, 2026-10-27, on every §10 item not asked:** *go with the contract's stated defaults/recommendations* (`owner-ui-notes.md`): Enterprise out (§10.3); owner work profiles holder-or-self, still a proposal built in I2 (§10.5); owners can't be suspended (§10.8); the agency path kept as shipped (§10.9); ~~operators can't remove Solo owners (§10.10)~~ **REVERSED 2026-10-27 by R16**; the never-owned backfill list is shown to the owner before I2 merges (§10.12). Recorded as defaults the owner accepted, not as separate rulings.

**Not rulings, and nothing below relies on them as rulings:**
- *"Co-owners cannot act on each other or on the account holder."* This was the **earlier provisional
  default** (20:30Z: "Provisional defaults (show in design for confirmation)"). The 20:45Z answer ruled only
  that the account holder adds and removes owners. Where the design keeps co-owners off each other, it is
  because changing someone's owner access **is** adding or removing an owner (R4). The one place that goes
  further, owners' work profiles (§4.11), is a proposal and is asked (§10.5).
- *"Admins may invite admins."* **Now ruled (R14, 2026-10-27): keep as today.** Shipped
  (`team-workspace.invite-workspace.test.tsx:338`) and kept by this design (§4.11; prototype §28 table). Round 4's
  restatement "others choose roles below their own", which would have stopped it, stays withdrawn (D-E).
- *"The managing agency may seat an owner on its own sub-account"* (§2, §5.4b). Kept as shipped. That this is the
  Agency tier's job under §51 is **CC's reading, not a ruling** (D-D). Asked (§10.9).

R9 does **not** cover moving the account holder. One more recovery act does, `set_account_holder` (§5.4a), because
adding owners can never produce a working account holder while `tenants.owner_user_id` is NULL or points at a deleted
user. **Owner-ruled YES, recovery only (R12, 2026-10-27);** built in I2 with the rest of recovery.

**Integrator decisions, round 4 (binding for this contract, recorded so they are not silent):** B1 step-down
stays as shipped on PR #2945 (§4.7, §5.4); B2 the platform's `subaccount_owner` path on Solo-shell tenants is
limited to never-owned tenants (§5.4b); ~~B3 `revoke_platform_access` refuses Solo owner seats (§5.4c)~~ **B3 REVERSED
2026-10-27 by R16: `revoke_platform_access` stays as shipped.** B2 changes what an operator sees and is listed for the owner
(§10.9).

**Integrator decisions, round 5 (binding, recorded):** ~~D-A `admin-delete-user` refuses, with an authored operator
message, while the target holds an owner seat on a Solo business; the operator must first use recovery `revoke_owner`,
so a working account holder can never be deleted by an operator (§5.4c). D-B that refusal, and B3's, cover only
`active` or `suspended` owner seats on **non-archived** Solo-shell tenants (§5.4c).~~ **D-A and D-B REVERSED 2026-10-27 by
R16: `admin-delete-user` stays as shipped, and with no refusal there is nothing for D-B to scope.** D-C `platform_grant_promotional_solo`
and `provision_tenant_as` are **holder-of-record restoration**: allowed, audited and notified (§5.4d). D-D the agency
path stays as shipped and is asked (§2, §10.9). D-E the R1 wording above. D-F the prototype's open questions are this
contract's §10, word for word. D-G the lock tip covers no control at any width (§5.10). D-H the §4 strings below are
complete. ~~D-A and~~ D-C changes what account holders see and was asked (§10.13); D-A was asked (§10.10) and reversed (R16).

Out of scope: ownership transfer by the account holder.

## 1. What this changes and reverses (§58: each item named, owner-ruled above)

| Shipped today | Where | Becomes |
|---|---|---|
| "team invitations may grant only Admin or Member" | `20271115040008_exp08_team_lifecycle.sql:1256-1258`; `solo-team-invitations/index.ts:64` | Owner allowed, account holder only (R1, R4) |
| Acceptance refuses `owner` | `20271115040008:1369-1371` | Accepts after the accept-time re-check (§5.3) |
| `accept_tenant_invite` silently turns an `owner` token into `admin` | `20271115040008:1609-1612` | **Refuses** it (§13: a downgrade reported as success) |
| `create_tenant_invite_token` lets any owner mint an owner token | `20260824000000_enterprise_hybrid_consumer_invite.sql:81-86` | Refuses `owner` for every kind, with a sentence true for the account it is asked on (agency/enterprise, company workspace, any other; §4.10). Its `kind = 'team'` mints for an address with a live owner invitation are refused too (§5.2 token guard) |
| `create_tenant_invite_token(_kind='subaccount_owner')`: `is_platform_owner()` may mint for **any** tenant; `accept_tenant_invite` then seats the invitee as an **active owner** whenever the tenant has no active owner and the minter is the platform, and sets `owner_user_id` if it is NULL | `20260824000000:74-79`; `20271115040008:1513-1546` | On a **Solo-shell** tenant the platform branch works only on a **never-owned** tenant; every other platform owner-add on a Solo account goes through recovery (B2, §5.4b). Agency managers on their own sub-accounts: unchanged (§2) |
| `revoke_platform_access`, both overloads, executable by `authenticated`, gated `is_platform_admin() OR is_platform_owner()`: deletes **every** `tenant_members` row of the user, owner and account-holder seats included | `20270511000000:56-92` (gate `:64`, delete `:81`), `:94-118` (gate `:101`, delete `:113`); flagged at `20271116020008:63-66` | **REVERSED 2026-10-27 (R16): unchanged, as shipped.** ~~Refuses, with an authored message pointing to owner recovery, while the user holds an **`active` or `suspended`** owner seat on a **non-archived** Solo-shell tenant (B3, D-B, §5.4c). Non-owner seats, and owner seats on archived tenants, unchanged~~ |
| `admin-delete-user` (Platform Operator: super_admin **or** platform_admin) deletes **every** `tenant_members` row of the user, owner and account-holder seats included, then the Auth user | `supabase/functions/admin-delete-user/index.ts:18-21` (operator gate), `:86-98,110-112` (seat delete), `:120` (Auth delete) | **REVERSED 2026-10-27 (R16): unchanged, as shipped.** ~~**Refuses**, HTTP 409 with an authored operator message and nothing written, while the user holds an `active` or `suspended` owner seat on a non-archived Solo-shell tenant (D-A, D-B, §5.4c). The operator first uses recovery `revoke_owner` (state `none` only), so a working or paused account holder can never be deleted by an operator. Every other account deletion unchanged~~ I1 keeps it working: the representative's legal-owner record is not stamped with the invitee as `updated_by` (FK without ON DELETE), so accepting an owner invitation never blocks deleting that account (case 2.14) |
| `platform_grant_promotional_solo` re-seats the user in `owner_user_id` as an active owner of their existing standalone tenant, silently (its one audit row is per recipient, `ON CONFLICT DO NOTHING`); `provision_tenant_as` inserts that user's owner seat when it is missing | `20270201000000_platform_promotional_solo_grant_recovery.sql:88-99` (tenant by `owner_user_id`), `:180-184` (seat upsert), `:303-316` (audit); `20270325000000_canonical_solo_provisioning_contract.sql:280-291` (seat insert, `on conflict do nothing`), called at `stripe-webhook/index.ts:964` | Kept, classified **holder-of-record restoration** (D-C): each also writes `tenant:owner_holder_restored` with its source and notifies the holder whenever it actually changes the seat (§5.4d). Neither can seat anyone but the user already in `owner_user_id` (verified, §5.4d) |
| PAIGE: "Nobody can be made an owner from a conversation" | `tier-matrix.md:2938-2943`; `paige-ai-chat/index.ts:7770,7775,12551-12560` | `team_invite_member` takes `owner`, account holder only (R7) |
| "Remove an Owner or co-Owner: ✗ on every tier" | `tier-matrix.md:2865` | Solo/Sub-account: ✓ for the account holder on a co-owner; ✗ on the account holder |
| Lifecycle rule "nobody on an owner" | `tier-matrix.md:460`; `team_member_holdings` `20271115040008:1098-1099` | Exception: the account holder may review, demote or remove a co-owner. Owners still can't be suspended |
| `grant_co_owner`: the account holder **or any platform owner (super_admin), on any tenant**. `revoke_co_owner`: the same, **plus a step-down branch** (`_user = _caller` holding an active owner seat), limited only by the last-active-owner floor | `20271116020008:137-140` (grant gate); `:193-200` (revoke gate, step-down `:196-197`); `:208-214` (holder refusal); `:231-234` (floor) | Account holder only, **plus the step-down branch kept byte-identical** (B1); the platform acts only through recovery (R9, §5.4a) |
| `guard_tenant_owner_only_columns` (SECURITY DEFINER) returns early for `auth.uid() IS NULL OR is_platform_owner()`; carve-out NULL → `auth.uid()` only for the sole active owner | `20271116020008:266-308` (`:270-272` exemption, `:274-298` carve-out); prod body before it `20260804020000:347-382` | Re-emitted SECURITY INVOKER. Platform may still change billing/hierarchy; **`owner_user_id` changes only through the carve-out inside a definer function (`accept_tenant_invite`) or recovery**, keeping the `auth.uid()` equality; every change audited (§5.2) |
| `remove_solo_team_member` on the user the platform protects as its owner shows the raw trigger text *"Cannot remove admin role from platform owner"* | `20251020145501:112` (`prevent_owner_admin_removal`) | Authored refusal before any write (§4.10, §5.4) |
| `set_solo_team_member_work_profile`: any owner or admin edits anyone's title and responsibilities, owners included | `20260901001520:140-189` (`:158` `is_tenant_admin`) | **Proposed, not ruled (§4.11, §10.5):** on an owner's seat, only the account holder or that owner |
| `tenant_business_owners` "never create Team members, invitations, roles, or workspace authority" | `20261046000000:928-929` | A record may **label** an owner seat; authority stays `tenant_members.is_owner` |
| `tenants.owner_user_id` "display-only" | `20271115040008:1536`; `20260804020000:389` | Account-holder pointer, holder status **only with** an active owner seat |
| Agency `INVITE_ROLES` includes `owner` (the mounted Agency Team screen; `src/agency/data/useAgencyPeople.ts` sends `_default_role: 'owner'` to `create_tenant_invite_token`) | `src/agency/team.tsx:81` | **I1: kept**, and its Owner choice is refused with a plain, tier-correct sentence (§4.10) instead of "Invite created". Before I1 it never produced an owner (the join page refused it as an unsupported permission; the legacy accept refused it on an agency account and silently seated an Admin on a sub-account). **Removing the option is an owner decision (§58), owed for I3** |

**Alignment with the in-flight §58 note (round 4, B1).** PR #2945 keeps co-owner step-down inside
`revoke_co_owner` per the owner ruling ("A co-owner can step down to Admin themselves"), limited only by the
last-active-owner floor; its §58 block says so (`20271116020008:53-61`, and `:41-47` for why the earlier
self-revocation refusal was dropped). Round 3 of this contract had moved step-down into a separate
`step_down_as_co_owner` that refused it while the account holder was paused or missing. **That is withdrawn.**
The contract adopts the shipped behaviour: step-down is allowed in every account-holder state (working, paused,
none), because it only ever reduces the caller's own authority, and the floor keeps at least one active owner.

**Approved Settings → Team design (§28).** Changed only for the additions in §4 and the changes in the
prototype's "Changes to approved elements" table, which this list mirrors:
Workspace permissions note (new wording; measured: 2 lines in the 1280px frame, 8 at 390) · Roles &
access split into Account holder + Owner cards, Admin card "the owner" → "an owner" · Admin card enabled
for an admin inviter (matches shipped, `team-workspace.invite-workspace.test.tsx:338`) · invite dialog
keeps its opening top and grows downward · filter "Owner" → "Owners" · Paige panel line (§7) ·
departure review also opened on a co-owner (it says the person stops being an owner, or, for a
representative, stops acting for the company) · member editor owner reasons (§4.4a), including the floor reason,
and **Make an Owner…** (Cancel returns to the details, edits kept) · member editor reason for an admin viewer
"Only the owner changes permissions." → "Only an owner changes permissions." · member editor: an owner's
details read-only for anyone but the holder and that owner, opening with focus on the name (proposed, §4.11) ·
gold on **Send owner invitation** and **Make owner** (the working brief allowed gold only on "Send
invitation") · the "No account holder" note (§4.8a) · the "Account holder paused" note and the holder's
**Paused** status (§4.8b) · the held-seat menu opens from its button's left edge · the approved notes'
"Authority rules shown", "Can an admin invite another admin?" (now open question 11), the working brief's gold line
and "The other side" row brought into line · prototype-only: a Member viewer in the dev bar (no invite button, plain
names) and `sizeFrame` placing the lock tip · Paused-access/Team Hub
"ask" lists now include co-owners, shown as "Owner" only (§3).

**Deviations and proposals needing owner sign-off (§10):**
- the billing refusal (§5.8) narrows R5's step-down;
- Enterprise is excluded (§2);
- ~~`set_account_holder` (§5.4a) goes beyond R9~~ **owner-ruled YES, recovery only (R12)**. The "No account holder"
  note keeps its approved copy, "Contact the Paige team." (§4.8a), which is now accurate: the Paige team can restore one;
- ~~recovery treats a billing-paused account holder as still present~~ **owner-ruled (R13): a billing-paused holder is
  still the account holder**, so recovery refuses while paused (§5.4a); recovery also refuses an **archived** account;
- an owner's work profile becomes holder-or-self (§4.11): a proposal, not derived from a ruling;
- ~~admins inviting admins is kept as shipped, but no ruling covers it~~ **owner-ruled keep as today (R14)**;
- **B2:** the platform's first-owner invitation on a Solo-shell tenant works only on a never-owned tenant
  (§5.4b, §10.9);
- ~~**B3:** `revoke_platform_access` refuses while the user holds a Solo owner seat (§5.4c, §10.10);~~ **REVERSED 2026-10-27 (R16)**;
- ~~**D-A:** `admin-delete-user` refuses likewise, so no operator can delete a working or paused account holder, or a
  co-owner, until the seat is removed by the holder or (state `none` only) by recovery (§5.4c, §10.10);~~ **REVERSED 2026-10-27 (R16)**;
- ~~**D-B:** both refusals count only `active` or `suspended` owner seats on non-archived Solo-shell tenants (§5.4c);~~ **REVERSED 2026-10-27 (R16)**;
- ~~round 5's restore/archive gating~~ **REVERSED 2026-10-27 (R16)**: operator archive and restore of a Solo account stay as shipped;
- **D-C:** subscription provisioning and the promotional grant re-seat the account holder of record without
  recovery, audited and notified (§5.4d): **owner-ruled YES (R15)**;
- **D-D:** the managing agency can still seat an owner on its own sub-account whenever no owner is active, including
  when the only owner is paused or gone, without the account holder (`20271115040008:1513-1534`). Kept as shipped;
  "§51-intended" is CC's reading, not a ruling (§2, §10.9).

Withdrawn since round 3: "step-down also needs a working account holder" (B1, above).

## 2. Who and where (§9/§51/§56/§60/§61)

Follows the Settings → Team footprint (`tier-matrix.md:535-542`). Every owner act, **platform recovery
included**, checks `_solo_shell_tenant(t)`: `account_type IN ('standalone','sub_account')` and not a
company workspace. The owner's rulings are for Solo accounts, so recovery does not reach Agency or
Enterprise tenants either.

| Tier | Invite an Owner / make an Owner | Make Admin, remove a co-owner, name a representative | Step down | Notes |
|---|---|---|---|---|
| God / Operator | Recovery only (R9), Solo-shell tenants only. The `subaccount_owner` first-owner invitation only on a **never-owned** Solo-shell tenant (§5.4b). Holder-of-record restoration by the promotional grant (§5.4d) | Recovery only (R9), Solo-shell tenants only. ~~`revoke_platform_access` and `admin-delete-user` refuse while the user holds an active or suspended owner seat on a non-archived Solo-shell tenant (§5.4c)~~ **REVERSED 2026-10-27 (R16): super_admin and platform_admin keep archive, restore, delete, `revoke_platform_access` and `admin-delete-user` on Solo accounts as shipped** | ✗ | `platform_owner_recovery` (§5.4a): super_admin, Solo-shell tenant, not archived, no account holder of record, reason, audit, notice |
| Agency / Enterprise | ✗ | ✗ | ✗ | No recovery either (shell gate). **§61 exception, stated:** inherited from the Settings → Team footprint (`tier-matrix.md:535-542`); Enterprise's §61 default YES is not taken here |
| Standalone (Solo) | ✓ account holder | ✓ account holder | ✓ co-owner, while another owner is active | Ruled scope |
| Sub-account | ✓ account holder | ✓ account holder | ✓ co-owner, while another owner is active | §61 default. A switched-in agency manager is seated as Admin (`agency_enter_subaccount`) and is refused, **unless they hold the sub-account's owner seat** (an accepted `subaccount_owner` invitation keeps `owner`, `20260713030000`), in which case they are the account holder. Tested (case 8). See the agency note below |
| Client | ✗ | ✗ | ✗ | No team seat |
| Anonymous | ✗ | ✗ | ✗ | `peek_tenant_invite` shows the legal owner's name to the token holder (§5.5) |

**§51 tier distinction for the `subaccount_owner` path (B2).** Two different tiers reach the same function:
- **Agency tier, on its own child.** `agency_can_manage_child(child, actor)` is true only for an active owner of
  the child's **parent** agency or enterprise, or an active agency team member with a managing role or a scoped
  specialist role (`20260714051416:44-71`, its newest definition). Minting a `subaccount_owner` invitation on that child, and the
  invitee becoming its owner (`accept_tenant_invite`, `20271115040008:1513-1534`), **CC reads** as the agency
  provisioning its own sub-account, the Agency tier's job in §51's matrix rather than a Solo owner change. **That is
  CC's reading, not a ruling** (D-D). It is **unchanged**, including after the sub-account has had owners: the managing
  agency can seat a new owner on a sub-account whose only owner is paused or gone, without the account holder.
  Asked (§10.9).
- **God tier, on any tenant.** `is_platform_owner()` needs no relationship to the tenant. On a Solo-shell tenant
  that is a platform owner-add, which R9 limits to recovery, so it now works only where no owner has ever
  existed (the first owner of a fresh shell, which recovery cannot produce) (§5.4b).
- A standalone Solo account has no `parent_tenant_id`, so only the God-tier branch can ever apply to it.

## 3. Words used on screen

- **Owner**: the permission label for every owner seat.
- **Account holder**: under the holder's Owner pill, on the Team roster and Roles tab only, where it decides who can do what.
- **for {legal owner}**: secondary line on a representative's row, shown to owners and admins. Members, and the "ask" lists on the Paused-access and Team Hub screens, show "Owner" only.
- **owner seat held** / **No representative**: a vacant seat (R6, R11).
- **No account holder**: the note owners and admins see while the business has no account holder (§4.8a).
- **Account holder paused** / **Paused**: the note owners and admins see, and the holder's Status, while the holder's seat is paused for billing (§4.8b).
- Legal owner types: Company, Trust, Partnership or other legal person (`owner_kind` `company`/`trust`/`other_legal_person`).
- Capitals: the permission is capitalised when it names what a person gets or an action ("Make Admin…", "Step down to Admin", "is now an Owner"); plural nouns in prose stay lower case ("owners", "admins").

## 4. Actor-goal flows with exact copy (identical to the prototype)

The server decides every act; the UI offers a control only where the server will allow it. Refusals
are authored server messages added to `AUTHORED_REFUSALS` (`solo-team-invitations/index.ts:57-80`) and
mapped in `team-workspace-contract.ts` (as `removalRefusal`, `:157`).

### 4.1 The account holder invites an Owner as a person (frames 07, 11)
1. **Invite someone** → Permission shows a third card, **Owner**, hint *"Full control: people,
   permissions, billing and settings."* Co-owners and admins see Member and Admin only (both still offered to an admin inviter, R14). The dialog
   description is the approved one, unchanged.
2. Choosing Owner shows, below the cards (nothing above moves; the Owner card is `aria-describedby` it):
   **Full control of Northstar Studio:** *people, permissions, billing and settings. Only you can add or
   remove owners, and an owner can step down to Admin.*
3. **Owner for**: ( • ) *Themselves* — *"An owner in their own right."* ( ) *A company, trust or other
   legal owner* — *"They sign in as themselves and act for it."*
4. Title placeholder *"e.g. Partner, Trustee"*. Team conversations is fixed: *"Owners always take part
   in team conversations."* · **On** (an owner seat's switch can't change later, `20271115040008:979-980`).
5. Review rows: Workspace · Send to · Permission **"Owner: full control of Northstar Studio"** · Owner
   for **"Themselves"** · Team conversations **"On: owners always take part in team conversations"** ·
   Title · Responsibilities. Then (the dialog's description): **riley.chen@example.com will have full
   control of Northstar Studio:** *people, permissions, billing and settings. Only you can remove them as
   an owner, and they can step down to Admin.* Button **Send owner invitation** (gold, the only gold).
6. Notice: *"Owner invitation sent to riley.chen@example.com. They'll be an owner of Northstar Studio
   once they accept."* The Invitations row shows the Owner pill.

### 4.2 … for a legal owner (frames 08–11)
- **Legal owner** picker, placeholder *"Choose one from Setup, or add one"*. Options, from this business's
  non-individual `tenant_business_owners`:
  - *"Cedar Row Trust"* · *"Trust · no owner seat"*; a held seat: *"Company · owner seat held"*;
  - disabled: *"Represented by Jordan Ellis"* or *"Invitation pending to {email}"*;
  - **Add a legal owner** → Legal name (required, ≤500) + Type (Company / Trust / Partnership or other
    legal person); hint *"Saved to Settings → Setup → Business ownership, where you can add the rest."*
    Otherwise the hint reads *"From Settings → Setup → Business ownership. Each legal owner has one
    representative at a time."* Errors: *"Choose the legal owner they represent."* / *"Enter the legal name."*
- The consequence becomes **Full control of Northstar Studio for Cedar Row Trust:** … Review row Owner
  for **"Cedar Row Trust (Trust)"** (new record: *"… . Saved to Settings → Setup when you send."*);
  warning **avi@cedarrow.example will have full control of Northstar Studio for Cedar Row Trust:** …
- Notice *"… They'll be an owner of Northstar Studio for Cedar Row Trust once they accept."* The row
  shows *"for Cedar Row Trust"* under the address.

### 4.3 The invitee accepts (not drawn; JoinWorkspace and email)
- `JoinWorkspace` (`src/pages/JoinWorkspace.tsx:254`): *"You've been invited to be an Owner of
  Northstar Studio for Cedar Row Trust. Owners have full control of the business: people, permissions,
  billing and settings. Accept to join."* ("for …" omitted for a person.)
- Email (`send-portal-invite/index.ts:48-55`, owner variant): subject *"Northstar Studio invited you to
  be an owner"*; lead *"Northstar Studio invited you to be an owner of the business for Cedar Row Trust.
  Owners have full control: people, permissions, billing and settings. Set up or sign in to your account
  to accept."*; CTA *"Join as an owner"*.
- Toast *"Welcome to Northstar Studio. You're an owner."*

### 4.4 The account holder makes an existing teammate an Owner (R10; frames 25, 26)
In an **active** admin's or member's details (holder only), under Permission: **Make an Owner…**. Dialog
*"Make Dana Reyes an Owner?"* · *"dana@northstar.example · Admin"*:
- **Dana gets full control of Northstar Studio:** *people, permissions, billing and settings. Only you
  can remove them as an owner, and they can step down to Admin.* (+ *"Team conversations turn on for
  Dana: owners always take part."* when theirs is off.) With a legal owner: *"…of Northstar Studio for
  Cedar Row Trust:"*.
- **Owner for**: *Themselves* / *A company, trust or other legal owner* (*"They act for it."*) → Legal
  owner picker (existing records only, same options and hints as 4.2, no inline add).
- Cancel · **Make owner** (gold). Cancel, Escape or the scrim return to the teammate's details with
  their unsaved edits kept, focus on **Make an Owner…**. Notice: *"Dana Reyes is now an Owner of Northstar Studio [for Cedar Row Trust]."*
- Runs `grant_co_owner` (§5.4).

### 4.4a The details dialog's Permission reason, per viewer (frames 25, 31, 36)
Under **Permission**, where the control is not offered, the dialog says why. Exactly one applies, first match wins:

| Whose details | Viewer | Reason |
|---|---|---|
| The account holder's | anyone, the holder included | *"The account holder's access is protected."* |
| An owner's own | that owner, while another owner is active | *"To step down to Admin, use ⋯ on your row."* |
| An owner's own | that owner, as the only active owner (the floor) | *"You're the only active owner of Northstar Studio right now, so you can't step down."* |
| Another owner's | anyone, while there is no account holder | *"Owner access can't change until Northstar Studio has an account holder again."* |
| Another owner's | the account holder | *"Make Taylor an Admin, or remove them, from the ⋯ menu."* |
| Another owner's | a co-owner or admin (holder working or paused) | *"Only Morgan Hale, the account holder, changes an owner."* |
| An admin's or member's own | that person | *"You can't change your own permission."* |
| An admin's or member's | an admin | *"Only an owner changes permissions."* |

The title and responsibilities notes for an owner's details are in §4.11 and §4.8a.

### 4.5 The account holder makes a co-owner an Admin (frames 13–15)
Co-owner row menu (holder only): **Edit details** · **Make Admin…** · ─ · **Remove from business…**
(nothing preselected; the holder picks the act, R5). Dialog *"Make Taylor Quinn an Admin?"* — *"Taylor
stops being an owner of Northstar Studio and stays on the team as an Admin."*
- *"As an Admin, Taylor manages members and invitations. Taylor can't manage admins, permissions or billing."*
- *"Taylor keeps their work, clients and team conversations."*
- billing contact: *"Taylor stops receiving billing notices as a billing contact."*
- representative: *"Harbor Lane Holdings LLC keeps its owner seat. It's held, with no representative,
  until you name a new one. Nobody inherits it."*
- *"Only you, as account holder, decide who is an owner."*
- Cancel · **Make Admin**. Notice: *"Taylor Quinn is now an Admin. They keep their work and team
  conversations."* (+ *" Harbor Lane Holdings LLC's owner seat is held until you name a new
  representative."* with action **Name a representative**.)
- Billing refusal (server): *"Taylor is the primary billing contact for a paid plan. Make another owner
  the billing contact in Settings → Billing first. Nothing changed."* Button becomes **Close**.

### 4.6 The account holder removes a co-owner (frames 16–18)
**Remove from business…** (row menu, or the details link of that name) opens the approved departure
review (`DepartureReview`, `team-departure.tsx:123`) directly. Hand-overs work as for members. The
final step *"Remove Taylor Quinn from Northstar Studio?"*:
- billing contact: **Billing contact** — *"Taylor stops receiving billing notices."*
- **Remove Taylor Quinn** — *"Taylor loses all access now and stops being an owner of Northstar Studio.
  Their Team Hub messages stay, shown as from a former teammate. Their Paige account isn't deleted; to
  bring them back, send a new invitation."*
- A representative (frame 18): **Remove Jordan Ellis** — *"Jordan loses all access now and stops acting
  for Harbor Lane Holdings LLC. Their Team Hub messages stay, …"* + *"Harbor Lane Holdings LLC keeps its
  owner seat, held until you name a new representative."* The legal owner's seat is never ended (R11).
- Button **Remove Taylor Quinn** (destructive). If Taylor is the account the platform protects as its
  owner (`protect_owner_admin`), the server refuses (§4.10, §5.4); Make Admin still works. Notice *"Taylor Quinn is no longer on the team."* (+ the
  held-seat sentence and action). The billing refusal shows in the drawer with *"… Taylor is still on the team."*

### 4.7 A co-owner steps down to Admin (frames 19, 34–36)
Own row ⋯ → **Step down to Admin…** (own details say *"To step down to Admin, use ⋯ on your row."*).
*"Step down to Admin?"* — *"You stop being an owner of Northstar Studio and stay on the team as an
Admin."* Facts: *"You'll manage members and invitations. You won't manage admins, permissions or
billing."* · *"You keep your work, clients and team conversations."* · (billing line) · (representative:
*"…until Morgan Hale names a new one."*) · *"Becoming an owner again is up to Morgan Hale, the account
holder."* Button **Step down to Admin**. Notice *"You're now an Admin of Northstar Studio."*
- **Offered in every account-holder state** (working, paused or none) **while another owner is active**:
  the server's only limit is the last-active-owner floor (`20271116020008:231-234`; B1, as shipped). Paused
  (frame 34): the same copy as working, since Morgan is still the account holder. No account holder (frame
  35): the last fact reads *"Becoming an owner again needs an account holder, and Northstar Studio doesn't
  have one right now."*; a representative's line reads *"…until an account holder names a new one."*, and so
  does the held-seat sentence in the notice.
- **The floor** (frame 36): when the co-owner is the only active owner, their row has no ⋯ and their details
  say *"You're the only active owner of Northstar Studio right now, so you can't step down."* The server
  refuses the same case (§4.10).

### 4.8 The seat is held (R6, R11; frames 20–24)
Whatever caused it (removal, Make Admin, step-down, account deletion), owners and admins see a roster
row in the person-row columns: **Harbor Lane Holdings LLC** · *"Company · owner seat held"* · Work
*"Jordan Ellis left Oct 22"* / *"Nobody inherits the seat."* · Owner · Status **No representative**
(warning dot). The Work line names the cause, with the representative's name and the date. The rows are patterns
shown with Jordan's name: the prototype draws the first two for Jordan (frame 20; Make Admin on Jordan), and the
step-down line only for whichever representative steps down (its dev bar has no representative viewer, so it renders as
*"Taylor Quinn stepped down Oct 26"* when Taylor represents a legal owner; `r5/copy5.mjs` drives it):

| Cause | Work line |
|---|---|
| Removed from the business (§4.6), or their Paige account was deleted | *"Jordan Ellis left Oct 22"* |
| Made an Admin by the account holder (§4.5) | *"Jordan Ellis is now an Admin"* |
| Stepped down to Admin (§4.7) | *"Jordan Ellis stepped down Oct 26"* |

Count line ends *". 1 owner seat has no representative."*
- Account holder: **Name a representative** (`aria-label` *"Name a representative for Harbor Lane
  Holdings LLC"*) opens a menu: **Someone already on the team…** → *"Name a representative for Harbor
  Lane Holdings LLC"*, Teammate picker (active admins and members), the 4.4 consequence, **Make owner**;
  **Invite someone new…** → the invite form titled *"Name a representative"*, permission fixed to
  *"Owner, for Harbor Lane Holdings LLC"*.
- Others: *"Only Morgan Hale, the account holder, can name one."*
- There is no way to end the seat (R11). The last-owner floor never counts a vacant seat.

### 4.8a No account holder (R9's case; frames 30, 35)
State `none` (§5.4a): `owner_user_id` is NULL, points at no `auth.users` row, or that user has no owner seat
here. A billing pause is **not** this case (§4.8b), and neither is an archived business. Owners and admins see,
under Workspace permissions, a note:
**No account holder** *"Nobody holds Northstar Studio's account right now, so no one can add owners or change
another owner's access. Owners still run the business. Contact the Paige team."*
Members don't see it (frame 37). **It names no route and promises no timing** (D-F, §10.6). With R12 a restoration
path now exists, through the Paige team's recovery `set_account_holder` (§5.4a), so "Contact the Paige team." is
true as approved; the copy is §28-frozen and unchanged.
- No "Account holder" marker and no lock row (the holder has no seat). No owner actions: no Owner card on
  invite, no Make an Owner…, no Make Admin or removal on an owner. **A co-owner's own Step down to Admin… stays**,
  subject to the floor (§4.7, B1).
- Co-owners and admins keep every act on admins and members (§4.11).
- Paige panel: *"Inviting an Owner needs an account holder, and Northstar Studio doesn't have one right now."*
- A held seat: *"Naming one needs an account holder."*
- Owner details: another owner's permission reason *"Owner access can't change until Northstar Studio has an
  account holder again."*; their title and responsibilities read-only with *"Only Taylor can edit these
  details right now."* Your own: the step-down hint, or the floor reason (§4.7).
- Read: `get_solo_team_workspace.account_holder_state` (§5.5).

### 4.8b The account holder's access is paused for billing (frames 32–34, 36)
State `paused` (§5.4a): Morgan's owner seat is `suspended`, which in code only billing does. Morgan is still
the account holder. Owners and admins see, under Workspace permissions:
**Account holder paused** *"Morgan Hale's access is paused for billing, so no one can add owners or change
another owner's access until it's back. Owners still run the business."* Members don't see it (frame 38).
- Morgan's row keeps **Owner** · *Account holder* and the lock. Status **Paused** (warning dot) ·
  *"Paused for billing since Oct 24"*. The lock tip (frame 33): **Morgan Hale holds this account** *"Morgan's
  access is paused for billing. No one can change or remove Morgan's access here. Only Morgan adds or removes
  owners, once it's back."*
- Nobody adds owners or changes another owner while paused: `is_tenant_account_holder` needs an **active** seat,
  so the holder's own gate is closed too, and the server refuses with the paused messages (§4.10). The co-owner
  and admin screens are otherwise the working-state screens (the Paige panel line, held-seat line and editor
  reasons name Morgan as account holder).
- **Step down to Admin… stays** while another owner is active (frame 34), and the floor applies (frame 36:
  Morgan's seat isn't active, so with Jordan gone Taylor is the only active owner).
- Morgan's own view while paused is the billing-paused flow, not this screen; it is not drawn here.

### 4.9 PAIGE — see §7.

### 4.10 Refusals
| Situation | Message |
|---|---|
| A co-owner or admin invites or makes an Owner (direct call) | *"Only the account holder can add owners to this business."* |
| Anyone acts on the account holder | *"Nobody can change the account holder's access here."* |
| The account holder steps down or demotes themselves (`revoke_co_owner(_tenant, auth.uid())` by the holder; refused at `20271116020008:211-214`) or removes themselves | *"The account holder can't step down. Moving the account to someone else isn't available yet."* |
| A co-owner removes themselves (`remove_solo_team_co_owner` on their own seat) | *"You can't remove yourself. To stop being an owner, use Step down to Admin."* |
| A co-owner acts on another co-owner | *"Only the account holder can change another owner's access."* |
| Step-down by the only active owner (`CO_OWNER_LAST`, `20271116020008:231-234`), in any account-holder state | *"You're the only active owner of Northstar Studio right now, so you can't step down. Nothing changed."* |
| Any owner act other than a co-owner's own step-down (Make Admin, remove, invite or make an Owner, name a representative) while there is no account holder | *"Northstar Studio has no account holder right now, so no one can add owners or change another owner's access. Contact the Paige team."* (promises no restoration, §4.8a) |
| The same acts while the account holder's access is paused for billing, by a co-owner or admin | *"Morgan Hale's access is paused for billing, so no one can add owners or change another owner's access until it's back. Nothing changed."* |
| … by the paused account holder themselves (a direct call) | *"Your access to Northstar Studio is paused for billing, so you can't add or change owners until it's back. Nothing changed."* |
| Remove the account the platform protects as its owner (`protect_owner_admin`) as a co-owner (`remove_solo_team_co_owner`) | *"Taylor's Paige account is protected, so they can't be removed from the business here. You can make them an Admin instead. Nothing changed."* |
| Remove that account as an Admin (`remove_solo_team_member`; today the raw *"Cannot remove admin role from platform owner"*, `20251020145501:112`) | *"Taylor's Paige account is protected, so they can't be removed from the business here. Nothing changed."* |
| Edit an owner's title or responsibilities when not the account holder or that owner (proposed) | *"Only the account holder or the owner themselves can edit an owner's details."* |
| Owner invitation with Team conversations off | *"Owners always take part in team conversations."* |
| A non-holder invites an address with a live owner invitation (Settings → Team) | *"There's already an owner invitation for this address. Only the account holder can change it."* |
| … through `create_tenant_invite_token` or a direct token INSERT of any kind that seats a person (every kind but `consumer` and `agency_team`), by anyone under a JWT (I1 round 2, S6; round 3, S-A) | *"There's already an owner invitation for this address. Only the account holder can change it, from Settings → Team."* |
| Owner chosen on the Agency Team screen on an agency (enterprise) account (`create_tenant_invite_token`) | *"Agency accounts add Admins and Members. An owner is added by the account holder of a business account, from its Settings → Team."* (*"Enterprise accounts …"*) |
| … while working inside a sub-account, or `create_tenant_invite_token(owner)` on any other account | *"Owners are added only by this business's account holder, from Settings → Team. You can invite an Admin or Member here."* |
| … in a platform company workspace | *"Owner invitations aren't available for this account."* |
| A non-holder resends, withdraws or clears an owner invitation (incl. `send-portal-invite`, direct writes) | *"Only the account holder can change an owner invitation."* |
| Not a Solo-shell account | *"Owner invitations aren't available for this account."* |
| Accept: sender no longer the account holder | *"This owner invitation can't be used any more: the person who sent it can no longer add owners to Northstar Studio. Ask the account holder for a new one."* |
| Accept: the legal owner became an individual or its seat was filled | *"This owner invitation was for Cedar Row Trust, and that owner seat has changed since it was sent. Ask the account holder for a new invitation."* (A deleted record revokes its tokens, §5.1, so accept shows the existing revoked message.) |
| Accept: expired, revoked, wrong email | Existing messages (`20271115040008:1352-1367`) |
| Setup deletes (explicitly **or by leaving it out of the saved list**), retypes or re-represents a record that is seated, held, or has a live owner invitation | *"Harbor Lane Holdings LLC holds an owner seat on the team, so it can't be removed or changed here yet."* |
| Make Admin / step down / remove the last primary billing contact of a paid plan | *"Taylor is the primary billing contact for a paid plan. Make another owner the billing contact in Settings → Billing first."* (self: *"You're …"*) |
| Platform recovery while an account holder of record exists (including one paused for billing), on a non-Solo account, or on an archived account (operator-facing) | *"Northstar Studio has an account holder. Owner changes are theirs to make."* / *"Owner recovery isn't available for this account."* / *"Owner recovery isn't available for an archived account."* |
| A platform `subaccount_owner` invitation on a Solo-shell business that has had an owner: mint (operator-facing) | *"Northstar Studio has had an owner, so a new owner can only be added by its account holder or through owner recovery. Nothing changed."* |
| … accept, for a platform-minted token issued before the change (invitee-facing) | *"This invitation can't be used. Owners of Northstar Studio are added by its account holder. Ask them for a new invitation."* |
| ~~`revoke_platform_access` on someone who holds an active or suspended owner seat on a non-archived Solo business (operator-facing)~~ **WITHDRAWN 2026-10-27 (R16)** | ~~*"taylor@northstar.example is an owner of Northstar Studio. Owner seats on a Solo business change only through its account holder or owner recovery, so platform access wasn't revoked. Nothing changed."*~~ |
| ~~`admin-delete-user` on the same (operator-facing, HTTP 409, code `SOLO_OWNER_SEAT`)~~ **WITHDRAWN 2026-10-27 (R16)** | ~~*"taylor@northstar.example is an owner of Northstar Studio. Owner seats on a Solo business change only through its account holder or owner recovery, so their account wasn't deleted. Nothing changed."*~~ |
| ~~… either of the two, when the person owns more than one such business~~ **WITHDRAWN 2026-10-27 (R16)** | ~~the business clause reads *"is an owner of Northstar Studio and 1 other Solo business."* / *"… and 2 other Solo businesses."* (the first by name, alphabetical)~~ |
| ~~`admin-delete-user` cannot read the person's owner seats (operator-facing, HTTP 503)~~ **WITHDRAWN 2026-10-27 (R16)** | ~~*"Couldn't check whether this person owns a Solo business, so nothing was deleted. Try again."*~~ |

### 4.11 Unchanged, and one proposed change (owners' work profiles)
Admins and co-owners keep every act on admins and members: suspend, reinstate, remove, the
conversations switch, the review, invitations of Admin or Member (an admin may invite an admin, as
shipped; owner-ruled keep as today, R14), permissions, billing (R4). Owner is the account holder's alone (R1).

**Proposed by CC, not derived from a ruling; needs sign-off (§10.5).** Today
`set_solo_team_member_work_profile` (`20260901001520:140-189`) lets anyone who passes `is_tenant_admin`
(`:158`) edit **any** seat's title and responsibilities, the account holder's and co-owners' included. No
ruling covers this: R4 rules that only the account holder adds or removes owners, and a title is neither. The
proposal comes from the earlier provisional default (not ruled, §0) that co-owners don't act on each other or
on the account holder. Proposed: on a seat with `is_owner`, only the **account holder** or **that owner** edits
it; admins and members are unchanged. If the owner declines, the editor keeps today's behaviour and the
read-only state below is dropped.
- **Seam:** re-emit `set_solo_team_member_work_profile` (I2) with, after the `is_tenant_admin` check and
  under the target row's `FOR UPDATE`: if the target `is_owner` and `_member_user_id <> _actor` and
  `NOT is_tenant_account_holder(_actor, _tenant)` (called as the function owner), refuse (§4.10). Body
  otherwise byte-identical (case 13). An owner editing their own seat still needs `is_tenant_admin`,
  which every active owner passes.
- **Screen (frame 31):** the details dialog shows those fields read-only (dashed border), with *"Only
  Morgan Hale, the account holder, or Taylor can edit these details."* on a co-owner's details, and *"Only
  Morgan Hale edits the account holder's details."* on the holder's own (frame 31 shows the holder's). **Close**
  replaces Cancel / Save changes, and the dialog opens with focus on the name heading, so the dashed cue is not
  hidden under a focus ring.
- Callers (§37, grepped at `8587262ea` in round 4; unchanged on `origin/main`, header): `src/solo/team-workspace.tsx:151` (editor); PAIGE
  `team_set_work_profile` → `paige-ai-chat/index.ts:15640` under the caller's client
  (`_shared/paige-spine/domains/c0b_existing_writes.ts:48`), which surfaces the new refusal as a
  §4.10 message; `scripts/ci/title-authority-baseline.json:59` (re-baselined with the new prosrc);
  stubs in `scripts/client-memory-authz/check.mjs:4014,4138` and
  `scripts/live-drive/harness/team-mount/supabase-stub.ts:47` (unchanged shape).

### 4.12 Roles & access (`team-workspace.tsx:751`)
- **Account holder**: *"Everything an owner can do, plus adding and removing owners. Can't be suspended, removed or made an Admin here."*
- **Owner**: *"Runs the business: people, permissions, invitations and billing. Can be a person, or act for a company, trust or other legal owner. Can't add or remove owners, and can step down to Admin."*
- **Admin**: approved text, "or the owner" → "or an owner". **Member**: unchanged. Four columns from 1180px, two below, one at phone width.

## 5. Data and backend (§00: named, because the design needs them)

Migrations `20271119020008_exp08_owner_invitations.sql` (I1; the contract first named `20271116030008`, which sorts before main's `20271116100008` and is drafted by `exp08-hub-agents-a1`; the branch then used `20271116110008`, renamed 2026-10-27 to `20271116130008` because production's newest applied version was then `20271116110009` and another EXP08 branch reserved `20271116120008` and `20271116120108`; renamed again 2026-10-27 to `20271117020008` because production's newest applied version became `20271117000000` (ledger re-read 2026-10-27), another EXP08 branch holds `20271117010008` and `20271117010108`, and EXP04 holds `202711171200xx`; renamed again in round 5, 2026-10-27, to `20271117170008` because production's newest applied version became `20271117150002` (ledger re-read 2026-10-27) and E02 holds `20271117160002`; renamed again in round 6, 2026-10-27, to `20271118200008` because production's newest applied version became `20271118100000`, so `20271117170008` no longer sorted after it, and remote branches hold versions up to `20271118110009` (ledger and every `origin/*` ref re-read 2026-10-27) (final re-check before handing over: production's newest applied `20271118110000`, remote branches still at most `20271118110009`; `20271118200008` sorts after both); renamed again in round 7, 2026-10-27, to `20271119020008` because the remote branch `claude/great-heisenberg-u7kyd9` now carries `20271119000000` and the deploy refuses an out-of-order version (production's newest applied `20271118110009`, re-read 2026-10-27; `20271119020008` sorts after both)) and `20271116040008_exp08_co_owner_lifecycle.sql`
(I2). Each re-emits production's body verbatim except marked lines (precedent `20271115040008`).

### 5.1 Schema
- `tenant_business_owners`: `UNIQUE (tenant_id, id)`; `owner_seat_vacant_since timestamptz NULL` (the
  vacancy marker; `ownership_status` is the **legal** fact and is never written by team flows).
- `tenant_members.business_owner_id uuid NULL`, FK `(tenant_id, business_owner_id) →
  tenant_business_owners(tenant_id, id)` **ON DELETE NO ACTION** (checked at statement end, so a tenant
  cascade that deletes both sides succeeds); CHECK null unless `is_owner`; partial unique index
  `(tenant_id, business_owner_id) WHERE business_owner_id IS NOT NULL`.
- `tenant_invite_tokens.business_owner_id uuid NULL`, same composite FK **ON DELETE SET NULL
  (business_owner_id)** (PG15 column list, so `tenant_id` is kept); CHECK null unless `kind='team' AND
  default_role='owner'`; partial unique index on live owner invitations per record (`uses = 0 AND
  revoked_at IS NULL`).
- **BEFORE DELETE on `tenant_business_owners`**: sets `revoked_at = coalesce(revoked_at, now())` on its
  tokens, so a token whose link is nulled is always revoked and can never become a person-owner
  invitation. The trigger function is **SECURITY DEFINER, owned by `postgres`**, so its token UPDATE runs with
  `current_user = 'postgres'` and the token guard (§5.2) exempts it; it is never refused, whoever deletes the
  record. Only live tokens block a Setup delete, and that check is in the function (§5.4).
- `tenants.first_owner_seated_at timestamptz NULL`: a one-way marker for B2 (§5.4b), set by trigger, never cleared.
  **DEFERRED from I1 to I2 (stated in the I1 migration):** its only reader (`_tenant_never_owned`) and its backfill are
  I2, and its trigger would add a `tenants` UPDATE to every provisioning path for a marker nothing reads yet.
- Trigger: a linked record's `owner_kind <> 'individual'`. No new table. No backfill of co-owners (R8); the
  only backfill is `first_owner_seated_at` (§5.4b).

### 5.2 Guards
- `is_tenant_account_holder` from `20271116020008:92-105` as is: `owner_user_id = _user AND
  is_tenant_owner(_user, _tenant)`, **EXECUTE for `service_role` only** (`:115-116`). Every caller below is
  either a SECURITY DEFINER function (runs as its owner) or the service-role client.
  `_solo_shell_tenant(_tenant)` (no client EXECUTE).
- `guard_tenant_member_owner_flag` (`20260803190000:192-231`) also refuses a direct write of `business_owner_id`.
- **New `guard_tenant_invite_token_identity`** (BEFORE INSERT/UPDATE/DELETE, **SECURITY INVOKER** so it
  sees `current_user`). Exempt **exactly** like `guard_tenant_owner_only_columns`'s service-role rule,
  `auth.uid() IS NULL`, plus the definer context `current_user = 'postgres'`. **No platform exemption.**
  For every other (authenticated) writer, closing the `FOR ALL` policy *"Tenant admins manage invite
  tokens"* (`20260629175341:191-194`):
  - INSERT: no `default_role='owner'`, no `business_owner_id`, and `created_by = auth.uid()`;
  - UPDATE: **every column is frozen except `revoked_at`**: `to_jsonb(NEW) - 'revoked_at' - 'updated_at'`
    must equal the same for `OLD`. That covers today's columns and any added later, including `agency_role`,
    `contact_id`, `portal_operation_id`, `portal_proposal_hash`, `portal_receipt_id`, `team_hub_access`,
    `business_owner_id`, `uses`, `max_uses`, `expires_at`, `token`, `email`, `kind`, `default_role`,
    `created_by`, `tenant_id` (a tenant admin can no longer rewrite `agency_role` on a pending agency
    invitation). `updated_at` is left out only because `trg_tenant_invite_tokens_updated_at` rewrites it on every
    update (`20260629175341:109-111`); no other BEFORE **UPDATE** trigger on the table writes `NEW`
    (`client_portal_invitation_binding_guard`, `20271108233000:29-48`; `trg_guard_company_workspace_invitation`,
    `20270521000000:214`). On **INSERT**, `trg_stamp_tier_send_invite` (`20260714142748:56-68`, BEFORE INSERT) does
    write `NEW`: `origin_account_id`, `target_tier`, `actor_tier`. The INSERT rule above reads none of those columns,
    so the order of the two BEFORE INSERT triggers does not matter;
  - UPDATE of `revoked_at` is **one-way: NULL → a value, once.** Value → NULL is refused. Value → a
    different value is never stored: the guard keeps the first timestamp (`NEW.revoked_at :=
    OLD.revoked_at`). That is what makes `WorkspaceSettingsPanel.tsx:186-191` safe: `revokeInvite` updates
    `revoked_at` by `id` with no `revoked_at IS NULL` filter (its button shows only while `!inv.revoked_at`,
    `:415`, but a stale list or a second tab can still send it). A second revoke of a non-owner token therefore
    succeeds as a no-op, the toast "Invite revoked" stays true, and the first revoke time is kept for audit;
  - UPDATE or DELETE of any row with `OLD.default_role = 'owner'` → refused (owner tokens change only
    through the holder-gated functions), including a repeat revoke from that panel.
  - Also closes the pre-existing forged-`created_by` `subaccount_owner` insert feeding
    `accept_tenant_invite`'s minter check (`20271115040008:1520-1522`).
  - **I1 round 2 (S6): the address of a live owner invitation is the account holder's.** Under any JWT, postgres-owned
    code included (so `create_tenant_invite_token` too), no token of a kind that seats a person in `tenant_members`
    is inserted for an address that has a live (unused, unrevoked, unexpired) owner invitation in the same business;
    HINT `OWNER_INVITE_EXISTS_FOR_ADDRESS` (§4.10). **Round 3 (S-A):** "a kind that seats a person" is every kind
    but `consumer` (links a contact, no seat) and `agency_team` (an `agency_team_members` row): `team`
    (`accept_solo_team_invite`, and `accept_tenant_invite`'s generic branch), `subaccount_owner`
    (`accept_tenant_invite`'s owner-or-Admin path) and any other text (the column has no CHECK on `kind`, and the
    generic branch seats it); round 2 checked `team` only. The address is compared `lower(btrim(...))` on both
    sides. **Round 3 (S-C):** such an INSERT under a JWT must store its address trimmed and in lower case
    (`INVITE_GUARD`), as both postgres-owned writers already do (production 2026-10-27: 0 tokens of any kind with an
    untrimmed or mixed-case address); otherwise a padded member invitation, inserted before the owner invitation,
    survives `create_solo_team_invite`'s withdraw (which matches `lower(email)` without trimming) and is accepted
    first (accept trims), pre-empting the owner invitation (case 1.52 drives exactly that chain under the mutant).
    The service role stays exempt. The holder's own Settings → Team invitation withdraws the owner invitation
    before inserting, so it never trips this (case 1.44). The token guard alone does not stop an invitation
    that already existed BEFORE the owner invitation, one inserted by the service role (exempt), or one with no
    address or another address; those can still be **created**, and since round 4 none of them can be **used**
    by that person (next bullet). Each of the rule's conditions is pinned by a kept case and a mutant (round 4,
    S1: another business's owner invitation, a used one, a withdrawn one and a live non-owner team invitation
    do not block; a service-role INSERT is exempt; cases 4.30-4.34, mutants X01-X05).
  - **I1 round 4 (B1): the seat-side rule.** `_tenant_member_owner_invitation_waiting` (new, SECURITY DEFINER,
    owned by postgres, no client EXECUTE), trigger `trg_tenant_members_owner_invitation_waiting` BEFORE INSERT ON
    `tenant_members` FOR EACH ROW: a **new non-owner seat** is refused for a person whose stored address
    (`lower(btrim(...))`, confirmed or not) has a live owner invitation in that business (kind `team`, role Owner,
    `uses = 0`, not revoked, not expired, not archived), **whoever writes it**: the browser, postgres-owned code
    and the service role alike. Why at the seat and not only in `accept_tenant_invite`: the address rule above
    compared addresses only when an invitation was created, `accept_tenant_invite`'s generic branch never
    compares the accepting person's address, and its `subaccount_owner` branch compares it only when one is
    stored, so an admin's `staff` (or any other kind) invitation with no or a made-up address, or a
    `subaccount_owner` invitation with no address on a Solo account, could be accepted through `/join` by the
    owner invitee, who then held a seat and whose owner invitation failed *"this account already belongs to the
    workspace"* (V1, V1b, V2). One trigger covers every path that creates that seat: `accept_tenant_invite` (generic
    branch and the `subaccount_owner` Admin fallback), `accept_solo_team_invite` for a non-owner invitation,
    `accept_invitation` and the `accept-invite` edge function's service-role seat write (`public.invitations`),
    `grant_tenant_member_role` and `agency_enter_subaccount`, including invitations created before the owner
    invitation or by the service role. **Not refused:** an owner seat (the owner invitation's own acceptance; and
    `accept_tenant_invite`'s first owner of a shell, which needs a business with no active owner, where no owner
    invitation can be accepted because its sender is no longer the account holder) and a write onto a seat the
    person already has (an `INSERT … ON CONFLICT` re-accept, which a BEFORE INSERT trigger also sees; such a
    person's owner invitation could not seat them anyway). The person reads *"You have an owner invitation to
    Northstar Studio waiting. Open that invitation to join as an owner. Nothing changed."*; someone granting them
    a seat reads *"This person has an owner invitation to Northstar Studio waiting, so they join by accepting it.
    Only the account holder can change it, from Settings → Team. Nothing changed."* (HINT `OWNER_INVITE_WAITING`,
    409 in `solo-team-invitations` and `accept-invite`; `/join` shows the database sentence). Cases 4.01-4.28,
    mutants S01-S11.
  - **I1 round 5: the seat-side rule counts only an owner invitation accept would still honour, and fires on
    UPDATE too.** "Waiting" now mirrors `accept_solo_team_invite`'s own checks, not just the token's state: kind
    `team`, role Owner, `uses = 0` and under `max_uses`, not revoked, expired or archived, **and** the business
    still a Solo account (`_solo_shell_tenant`), the sender **still the account holder**
    (`is_tenant_account_holder`: so not while the holder's own seat is paused for billing, R13, nor after the
    holder of record moved), and, when it names a legal owner, that record still in the business, not an
    individual, with its owner seat still open. An owner invitation accept would refuse no longer blocks the person
    from other seats with "Open that invitation" (round 4 verifier, should-fix 1). If such an invitation becomes
    usable again later (billing resumes) after the person took a seat, it then refuses *"this account already
    belongs to the workspace"*, as any invitation does for someone already seated. The trigger is now BEFORE
    INSERT OR UPDATE OF `tenant_id`, `user_id`: an UPDATE that moves a seat to the person is refused the same way
    (production 2026-10-27: no function, edge or browser path updates those columns; authenticated has SELECT
    only), and one that keeps the same person and business passes. Both sentences assert HINT
    `OWNER_INVITE_WAITING` in the proof (cases 4.08, 4.09, 5.06, 5.10). A write with no JWT reads the first-person
    sentence: its one producer is the `accept-invite` edge seating the person themselves; a service-role write
    made for someone else would read it too (no such producer today; stated). Cases 5.01-5.13, mutants S12-S20
    and T01 (the trigger back to INSERT only).
  - **I1 round 6 (N1): only a confirmed address.** `accept_solo_team_invite` refuses a person whose address is
    not confirmed, so an owner invitation waiting on an unconfirmed account is not one accept would honour; the
    seat-side rule now also requires `auth.users.email_confirmed_at IS NOT NULL` and leaves that person's other
    seats alone (case 5.14; once the address is confirmed the same invitation stops the seat, case 5.15;
    mutant S21 drops the condition and fails 5.14).
  - **Residual (stated, round 7).** An address-less staff invitation (`accept_tenant_invite`'s generic branch: a
    token that is neither `team` nor `consumer` and names no address) seats whoever accepts it, confirmed or not,
    and the seat-side rule above leaves an unconfirmed account alone, so such an invitation can seat an
    unconfirmed account that has an owner invitation waiting. Theoretical today: production `auth.users` on
    2026-10-27 has 0 of 25 accounts unconfirmed (read-only count). Not changed in I1.
  - **#227 residual (stated, round 5).** Owner seats are never refused by the seat-side rule, and
    `accept_tenant_invite`'s `subaccount_owner` first-owner path keys on **"no active owner"**, not on "no account
    holder". A business whose holder of record is paused for billing and has no other active owner qualifies, so
    an agency's (or the platform's) `subaccount_owner` token seats a **new owner beside the paused holder**, while
    owner ruling R13 says that paused holder is still the account holder. The holder's own waiting owner
    invitation is not what is pre-empted there (accept refuses it while its sender is paused), but the new owner
    is seated without the holder. Round 4's wording ("which needs a business with no active owner, where no owner
    invitation can be accepted") was true about the invitation and silent about this; the shell-gate is #227's
    shipped behaviour (D-D, kept as shipped) and is not changed in I1. Owner decision owed with I2 (whether the
    first-owner path must also require `owner_user_id IS NULL`).
  - **DELETE of a non-owner token stays allowed** to tenant admins through the `FOR ALL` policy, **named, not
    changed:** that includes used tokens (it erases invitation history) and pending `subaccount_owner` and
    `agency_team` tokens (it withdraws an agency's or the platform's pending invitation). Every such DELETE only
    removes authority; none grants any.
- `guard_tenant_owner_only_columns`: re-emitted from its **`20271116020008:266-308`** body (SECURITY
  DEFINER; exemption `auth.uid() IS NULL OR is_platform_owner()` at `:270-272`; carve-out at `:274-298` =
  `OLD.owner_user_id IS NULL AND NEW.owner_user_id = auth.uid()`, the other guarded columns unchanged, the new
  holder an active owner and **no other** active owner). Changes, and only these:
  - **SECURITY INVOKER.** Inside a SECURITY DEFINER trigger function `current_user` is always the
    function's owner, so the `current_user` tests below only mean something if the guard runs as
    invoker. Its reads are `is_platform_owner()`, `is_super_admin()` (definer helpers) and the
    carve-out's two `tenant_members` EXISTS, which are only reached when `current_user = 'postgres'`
    (RLS does not apply to the owner).
  - `auth.uid() IS NULL` stays a full exemption (service role, migrations), as today.
  - `is_platform_owner()` keeps its exemption for `platform_fee_bps`, `parent_tenant_id`,
    `stripe_customer_id`, `stripe_subscription_id` but **not** for `owner_user_id`.
  - `owner_user_id` may change for an authenticated caller only when `current_user = 'postgres'` **and**
    either (a) the `:274-298` carve-out holds **unchanged, including `NEW.owner_user_id = auth.uid()`**
    and the sole-active-owner test (in practice: `accept_tenant_invite`'s `subaccount_owner` path, itself
    now limited by §5.4b), or (b) `current_setting('paige.owner_recovery', true) = 'on'` **and**
    `is_super_admin(auth.uid())`.
  - **The `paige.owner_recovery` flag is safe only together with `current_user = 'postgres'`.** It is a
    custom setting, and any role can `set_config` it, so on its own it is not a credential. It only
    counts while code owned by `postgres` is running, which a client cannot fake, and
    `platform_owner_recovery` sets it transaction-local immediately before its one UPDATE and resets it to
    `'off'` immediately after. (b) also requires the caller to be super_admin, so a flag set by a client
    before calling another postgres-owned function (e.g. `accept_tenant_invite`) gains nothing: that
    function still has to pass (a) or the caller must already be super_admin acting through recovery.
  - **new AFTER UPDATE OF owner_user_id** trigger (SECURITY DEFINER) writes a `paige_audit_log` row
    (`tenant:account_holder_changed`, old/new, actor or `service`) for every change by any writer, so no
    move is unaudited.
  - **§37 writers of an owner seat outside the team flows** (`tenant_members` with `is_owner = true`, round 5):
    `accept_tenant_invite`'s `subaccount_owner` branch (`20271115040008:1527-1534`; §5.4b), `grant_co_owner` and
    recovery (§5.4, §5.4a), and the two **holder-of-record restoration** writers, `platform_grant_promotional_solo`
    (`20270201000000:180-184`) and `provision_tenant_as` (`20270325000000:288-290`, `:332-334`) (§5.4d), and the two
    new-tenant-only provisioning writers, `provision_tenant` (`20270325000000:190-191`) and `operator_provision_tenant`
    (`:454-456`), which seat only the first owner of a tenant they have just inserted (§5.4d). Every one
    either seats the user already in `owner_user_id`, or goes through a gate in this contract.
  - §37 writers of `owner_user_id`: `accept_tenant_invite` (`20271115040008:1538-1540`; the only function on
    production that UPDATEs it, `pg_proc` read 2026-10-27), `platform_owner_recovery` (`set_account_holder`, R12),
    tenant provisioning inserts (INSERT, not guarded), the #227 data fix (`20260804020000:258-265`, already applied),
    service-role edge functions (exempt, now audited). **Also on production (I1 round 2, read 2026-10-27), service-role
    only, exempt, each leaving its own record:** `platform_grant_promotional_solo` (INSERT INTO `tenants` with
    `owner_user_id` for a new tenant; `paige_audit_log` row) and `solo_beta_fulfill_checkout` (through
    `provision_tenant_as`, which inserts the tenant; `solo_beta_fulfillment_receipts` row). Both are INSERTs, so the
    AFTER UPDATE audit trigger does not fire for them; their own rows are the record (§5.4d).

### 5.3 The invite family (I1)
- **`create_solo_team_invite`** gains `_business_owner_id uuid DEFAULT NULL` and `_new_business_owner
  jsonb DEFAULT NULL` (`{ownerKind, legalName}`); the 7-argument form is DROPPED. For `owner`:
  `is_tenant_account_holder(actor)`, `_solo_shell_tenant`, `_team_hub_access = true`, at most one entity
  argument, record in this tenant, non-individual, no active seat, no other live owner invitation.
  **Before inserting, it revokes every expired, unused owner token for that record, whatever its
  email** (`business_owner_id = _record AND uses = 0 AND revoked_at IS NULL AND expires_at <= now()`).
  The live-invitation index is per record, so an expired invitation to a@ would otherwise block a new one
  to b@ with a raw unique-index error. A person-owner invitation (no record) has no such index. Inline records are inserted in the same transaction with
  `setup_provenance = {"source":"team_invite"}`. A non-holder inviting an address with a live owner
  invitation is refused. Audit records `business_owner_id`.
- **I1 round 2:** the migration runs in one transaction (`SET LOCAL lock_timeout = '2s'`) behind an incumbent guard:
  a fingerprint of each of the 10 production functions it replaces (md5 of `prosrc` with LINE BREAKS KEPT, every
  other run of blanks collapsed to one space, the blanks around each line break and empty lines dropped, and the
  ends trimmed; comments KEPT, so a marker such as `E09_CONSUMER_INVITE_PEEK_V1` counts) must equal the fingerprint
  of the body it was written against (production, read 2026-10-27), or it refuses, naming EVERY drifted function in
  one error. Re-indenting, trailing blanks and CRLF pass; any added, removed or changed token, a comment included,
  is refused, and so is a line re-wrapped onto two (proof S2: production's bodies and all 10 re-formatted pass; a
  changed identifier, a removed AND clause and a comment added to each of the 10 are refused and named; two drifts
  in one error; `archive_solo_team_invite`'s authority check joined onto the comment line above it is refused and
  named; guard mutants for no normalisation, no comparison, stop-at-first and line breaks collapsed are killed).
  Line breaks are kept because the round-7 guard collapsed them with everything else, and the review found that
  made `-- note` + line break + `stmt;` fingerprint the same as `-- note stmt;`: two statements could be silently
  commented out, one of them that authority check. `peek_tenant_invite` accepts
  a second fingerprint, the repository replay's: production never ran `20260713050000` (recorded as
  `git_ledger_reconciliation`), whose body carries three comment lines production's lacks, and `20271108120100`
  patches whichever it finds; with comments removed the two are identical (read 2026-10-27). The other nine
  replay to production's exact md5(prosrc). Found when PR #3008's database-contract job, which replays every
  migration, refused on that one body. **The guard compares body text only**
  (`prosrc`): a drifted signature default, owner, SECURITY DEFINER flag, `search_path`, volatility or ACL with an
  unchanged body passes it. The proof checks those separately on the migrated functions; the guard does not.
- **I1 round 3 (S-B):** `tenant_invite_tokens.business_owner_removed_at` (nullable). Deleting a legal owner revokes
  **and marks** every invitation that names it, live or already withdrawn, before the FK nulls the link;
  `resend_solo_team_invite` refuses a marked owner invitation (*"This owner invitation was for a legal owner that has
  since been removed, so it can't be sent again. Send a new owner invitation instead."*, HINT
  `OWNER_INVITE_RECORD_REMOVED`, 409 at `solo-team-invitations`), so it is never reissued as an owner invitation for
  the person in their own right (cases 2.16, 2.17).
- **I1 round 3 (S-D):** `accept_solo_team_invite` locks the tenant row and the sender's seat `FOR SHARE` before
  re-checking `is_tenant_account_holder(created_by)`, so a concurrent billing suspension (which rewrites that seat)
  or holder move waits for the acceptance. The proof asserts the two lock statements and their order on the body
  (case 2.18, killed by removing either); **the race itself is not driven** (the proof is one session).
- **`resend_solo_team_invite`**, **`revoke_`/`archive_solo_team_invite`**: owner tokens holder-only;
  resend repeats every check and the expired-token revoke (per record, any email).
- Every holder-gated function in §5.3 and §5.4 picks its refusal from `_tenant_account_holder_state`
  (§5.4a): `none` → the §4.10 no-holder message; `paused` → the paused message (the holder's own text when the
  caller is the holder of record); `working` → the generic holder message.
- **`send-portal-invite`** (`index.ts`, `origin/main`):
  - the token select (`:139-141`) adds **`default_role`** (it reads `id, tenant_id, contact_id,
    revoked_at, expires_at, email, kind, uses, max_uses, last_used_at` today, so the owner branch could
    not tell an owner token apart);
  - `authorized()` (`:149-169`): **first**, when `tok.default_role === "owner"`, return exactly
    `admin.rpc("is_tenant_account_holder", { _user: actorUserId, _tenant: tok.tenant_id })` →
    `!error && data === true`, through the **service-role** client `admin` (`:133`), because since
    `20271116020008` the helper is not executable by `authenticated` (`:115-116`) and the `caller` client would get a
    permission error. For an owner token no other branch (platform owner, tenant admin, agency manager,
    `solo_team_invite_authority`) can authorize; the existing branches run unchanged for every other token.
- **`accept_solo_team_invite`**: `owner` allowed. Under the token's `FOR UPDATE` it re-checks
  `is_tenant_account_holder(created_by)`, `_solo_shell_tenant`, and the record (exists, non-individual,
  unseated, this is its live invitation). Inserts `is_owner = true, role = 'owner', team_hub_access =
  true, business_owner_id`; clears `owner_seat_vacant_since`; **sets the record's
  `representative_user_id` to the accepting user**, overwriting any earlier value and auditing the
  previous one. The seat is the only source of "Represented by …". **It does not write the record's `updated_by`**
  (I1 round 2, S1): that column references `auth.users` with no ON DELETE action, so stamping the invitee would
  block deleting their account (`admin-delete-user`, which operators keep, R16). The audit row records the actor.
  (An inline record created on the invitation carries the account holder in `created_by`/`updated_by`, as every
  Setup-created record already does; that pre-existing FK on the holder is named for I2, not changed.)
- **`accept_tenant_invite`**: an `owner` token in the generic branch is refused (*"this invitation can't
  be accepted here"*); the `subaccount_owner` branch is untouched. Callers: `JoinWorkspace`, legacy
  `/join` routes; pre-merge production count reported.
- **`create_tenant_invite_token`**: refuses `owner` for every kind, with a sentence true for the account it is asked on
  (agency/enterprise, company workspace, any other; §4.10), because the mounted Agency Team screen still offers Owner
  and shows this sentence verbatim. Producers (§37):
  `WorkspaceSettingsPanel.tsx:164`, `ContactPortalPanel.tsx:166`, `ClientManagementDashboard.tsx:470`,
  `ContactCardRail.tsx:389`, `ContactDetail.tsx:223`, `AgencyBoard.tsx:300`, `useAgencyPeople.ts:397`.
  Pre-merge: production count of unexpired, unused `owner` tokens.

### 5.4 Co-owner lifecycle (I2)
Actor from `auth.uid()`. The lifecycle functions take the workspace from `current_user_tenant_id()`;
**`grant_co_owner` and `revoke_co_owner` take `_tenant` as an argument, which must equal
`current_user_tenant_id()` except on the recovery path.** Callers are authorised before the target is
looked up (no membership oracle). Each locks the tenant's active owner rows `FOR UPDATE`.
- **`grant_co_owner(_tenant, _user, _business_owner_id uuid DEFAULT NULL)`** (2-arg form DROPPED; callers:
  tests and a comment at `team-workspace-contract.ts:146`). Re-emitted from `20271116020008:120-170`: the gate
  (`:137-140`) loses its `_is_platform` disjunct; holder gate, `_solo_shell_tenant`, §5.3 entity checks,
  target an active admin/member; sets `team_hub_access = true`, links the record, sets
  `representative_user_id`, clears the vacancy.
- **`revoke_co_owner(_tenant, _user)`**: "Make Admin" **and step-down** (signature unchanged, so no DROP).
  Re-emitted from its merged body (`51ede67eb`, `20271116020008:175-252`) with only these changes:
  - the gate (`:195-200`) becomes `is_tenant_account_holder(_caller, _tenant) OR (_user = _caller AND <active
    owner seat>)`: the `_is_platform` disjunct goes (the platform acts through `platform_owner_recovery`,
    §5.4a), and **the step-down disjunct `:196-197` stays byte-identical**;
  - `business_owner_id := NULL` in the demoting UPDATE (`:236-240`), so the seat-ended trigger holds an
    entity's seat;
  - the billing step (§5.8) before the UPDATE;
  - the owner-row lock (`:202-206`), the tenant `FOR SHARE` and holder refusal (`:208-214`), the floor
    (`:231-234`) and the audit (`:242-250`, actor role now always `owner`) unchanged.
  So **step-down runs in every account-holder state** (working, `paused`, `none`), limited only by the floor,
  exactly as PR #2945 ships it (B1). Because the floor counts active owners including the caller and refuses at
  `<= 1`, at least one active owner remains after any step-down. **Withdrawn from round 3:** the separate
  `step_down_as_co_owner` and its paused/none refusals, and the claim that only a working holder keeps
  "zero active owners" from re-opening the `subaccount_owner` path; that path is now closed for platform
  minters by §5.4b, and the agency path is kept as shipped ("§51-intended" is CC's reading, not a ruling; §2,
  §10.9).
  Refusal mapping (`team-workspace-contract.ts` `removalRefusal`, `AUTHORED_REFUSALS`): `CO_OWNER_FORBIDDEN:
  only the account holder…` → by `_tenant_account_holder_state`: `none` → the no-holder message, `paused` →
  the paused message (the holder's own text when the caller is the holder of record), `working` → the generic
  holder message; `… the account holder's ownership cannot be revoked here` → *"The account holder can't step
  down…"* for the holder, *"Nobody can change the account holder's access here."* for anyone else;
  `CO_OWNER_LAST` → the floor message (§4.10).
- **`remove_solo_team_co_owner(_member_user_id, _expected_tenant_id)`**: holder only; target an owner,
  not the holder, not the caller; billing step; **protected-account refusal** (below); deletes the seat.
  `remove_solo_team_member` gets **no** owner branch, only the same protected-account pre-check (below).
- **`team_member_holdings`**: owner branch for the holder reviewing a co-owner, adding `billing_contacts`
  to `holdings` and `counts`; admin/member output byte-identical.
- **Seat-ended trigger `_business_owner_seat_ended`** (AFTER DELETE, or UPDATE OF `is_owner`,
  `business_owner_id`, `status`): sets `owner_seat_vacant_since = now()` and clears
  `representative_user_id` where it equals the leaving user. **Account deletion (corrected in round 4):**
  `tenant_members.user_id` has **no** foreign key to `auth.users` (`20260629175341:49-60`; the only FK in
  `docs/sprints/bootstrap-byo-schema.sql:4370` is the tenant one), so nothing cascades. The platform's
  deletion path, `admin-delete-user`, deletes the user's `tenant_members` rows itself through the service role
  (`supabase/functions/admin-delete-user/index.ts:86-98,110-112`) before deleting the Auth user (`:120`), and
  those DELETEs fire this trigger. A user deleted any other way leaves an orphaned seat; §5.4a counts a pointer
  at a missing `auth.users` row as `none` regardless. There is no close option (R11).
- **`save_solo_setup_context`** (`20261046000000:535-826`): for a record that is seated, vacant, or has a
  live owner token, refuses delete — **including the implicit delete of ids missing from `v_keep`
  (`:767`)** — and changes of `owner_kind` or `representative_user_id`, with the authored message (never
  a raw FK error). Revoked/used tokens don't block (SET NULL + revoke, §5.1).
  **I1 residual until this lands (stated, review round 4, S2):** today `save_solo_setup_context` is unchanged, so
  anyone whose Setup access is `owner_full` (every owner seat, a co-owner included, `solo_setup_access_scope`
  `20261046000000:200`) can withdraw or disable the account holder's invitation for a **legal owner** through
  Setup: deleting that record, or saving the owners list without it (the implicit delete, `:767`), revokes the
  invitation (§5.1's revoke trigger); retyping the record to an individual makes the invitation refuse at
  accept (*"that owner seat has changed"*). It grants nobody anything, and a person-owner invitation is
  untouched, but it changes an owner invitation without the account holder. Closed by I2's refusal here.
- **Global role sync / `protect_owner_admin`.** The live `sync_tenant_member_to_user_roles`
  (`20271115040008:76-149`) has **no** super_admin skip. `map_tenant_role_to_app_role` maps both `owner` and
  `admin` to global `admin` (`20270509000000:61-65`), so Make Admin and step-down change nothing global; but
  deleting a seat (its DELETE branch, `:133-145`) deletes the user's global `admin` whenever no other **active**
  seat still maps to it, for every user, super_admin included (the `super_admin` role row itself is never
  touched: the sync maps no tenant role to it, `:88-91`). `protect_owner_admin` → `prevent_owner_admin_removal`
  (`20251020145501:92-117`, trigger `:119-130`, never redefined) refuses that DELETE **only** for the user whose
  email is `app_settings_owner.owner_email`, with the raw message *"Cannot remove admin role from platform
  owner"* (`:112`). Chosen fix (smaller than re-emitting the sync): **`remove_solo_team_co_owner` and
  `remove_solo_team_member` refuse** with the authored §4.10 messages, before any write, when the target is that
  user (`auth.users` joined to `app_settings_owner` on email) **and** no other active seat of theirs maps to
  `admin`. Make Admin stays available for them. Every other super_admin removed loses global `admin` unless
  another seat grants it, exactly as any removed admin does today; their `super_admin` is untouched. Case 9.
- **`set_solo_team_member_work_profile`** (`20260901001520:140-189`): re-emitted per §4.11 (proposed):
  an owner's seat is edited only by the account holder or that owner.

### 5.4a Platform recovery (R9)
**`platform_owner_recovery(_tenant uuid, _act text, _user uuid, _reason text)`**, SECURITY DEFINER,
EXECUTE to `authenticated`. `_act IN ('grant_owner','revoke_owner')` is R9.
**`'set_account_holder'` is owner-ruled YES, recovery only (R12, 2026-10-27)**: adding owners never yields a
working account holder while `owner_user_id` is NULL or dangling, because `is_tenant_account_holder`
needs the pointer. The function accepts all three acts; `set_account_holder` names a user who already holds an
**active** owner seat here (R12's words), under the same predicate as the R9 acts.

- **Account-holder state** (one SQL helper, `_tenant_account_holder_state(_tenant)`, no client EXECUTE;
  also read by §5.5 and the §5.3/§5.4 refusals), evaluated **in this order**:
  1. `archived`: `tenants.archived_at IS NOT NULL` (`20270602000203:5`; set by the operator archive at
     `:193`, which also moves active seats to `status = 'archived'`, `:194`). Without this step an archived
     Solo account would read as `none` and be open to recovery;
  2. `none`: `owner_user_id` is NULL, or points at no `auth.users` row (no FK, `20260629175341:35`; checked
     before `working` because a deleted user can leave an orphaned seat, §5.4);
  3. `working`: `is_tenant_account_holder(owner_user_id, _tenant)`;
  4. `paused`: `owner_user_id` has an owner seat here with `status = 'suspended'`. In code an owner seat
     becomes `suspended` **only** through `solo_beta_sync_subscription` (`20270129000000:315-318`: on a Stripe
     status other than `trialing`/`active` it suspends exactly the subscriber's `is_owner` seat), because
     `suspend_solo_team_member` refuses owners (`20271115040008:653-654`) and no other function writes
     `suspended` onto a seat. So `paused` **is** a billing pause, and the holder stays the account holder;
  5. `none`: anything else (that user has no `is_owner` seat here in `active` or `suspended`).
- **Predicate:** `is_super_admin(auth.uid())` **and** `_solo_shell_tenant(_tenant)` (Standalone and
  Sub-account only; the rulings are for Solo accounts, §2) **and** state `none`. `paused` and `archived` are
  excluded: a super admin cannot reassign owners away from someone who missed a payment (owner-ruled R13: a
  billing-paused holder is still the account holder), and an archived account is restored, not recovered. `_reason` 10–500 characters.
  Otherwise refused (§4.10). Super_admin only, not `platform_admin` (§53: God-tier).
- **Acts:** `grant_owner` / `revoke_owner` run the same bodies as grant/revoke (entity checks, billing
  step, floor). `set_account_holder` (R12): sets `owner_user_id` to a user who **already** holds an
  active owner seat here (refused otherwise; the operator runs `grant_owner` first), through the §5.2 recovery branch, with the
  `paige.owner_recovery` flag set transaction-local just before that one UPDATE and reset just after.
  The platform branch is **removed** from `grant_co_owner` / `revoke_co_owner`.
- **Audit:** one `paige_audit_log` row per call (`actor_role = 'super_admin'`, `action =
  'tenant:owner_recovery.<act>'`, `payload = {reason, target, previous_owner_user_id, notified}`,
  `tenant_id` explicit), plus the §5.2 owner_user_id audit when the pointer moves.
- **Notice:** the existing in-app seam `public.notifications` (precedent
  `20271111010000_e09_customer_portal_access.sql:1184`) for the account holder of record (the user in
  `owner_user_id`, if one exists) and every active owner; email through `fire_team_event(jsonb)` →
  `notify-team-event` with a new `owner_recovery` event (I3 edge change). Copy: *"A Paige administrator
  changed the owners of Northstar Studio: {what}. Reason: {reason}."* If nobody can be notified, the audit
  row records `notified: []` (§13).
- **Transitions that are not recovery (round 5, D-C).** Holder-of-record restoration (§5.4d) can move a tenant from
  `none` to `working` when `owner_user_id` still names a live user whose owner seat was deleted (both writers) or
  demoted (the promotional grant only). It never changes **who** the account holder is, and it is audited and
  notified. It is not expected to touch `paused` (§5.4d). Nothing else outside recovery moves a tenant between states,
  except the team flows themselves (step-down, removal, Make Admin) and billing (`working` ↔ `paused`).
- Production read in I2: tenants by state (`20271116020008:38-40` notes 4 without a pointer and 1 holder
  without an active seat, which may be `paused` or `none`). In state `none`, owners and admins see the
  §4.8a note, no Account holder and no owner actions except a co-owner's own step-down; co-owners keep running
  the business; recovery is the only way back.

### 5.4b The platform's `subaccount_owner` path on Solo-shell tenants (B2, I2)
**Today.** `create_tenant_invite_token` lets `is_platform_owner()` **or** `agency_can_manage_child(_tenant_id,
auth.uid())` mint a `subaccount_owner` invitation for a tenant (`20260824000000:74-79`); the FIX-1 owner-role
gate (`:81-86`) does not apply, because these invitations carry `default_role = 'admin'`
(`src/pages/admin/AgencyBoard.tsx:300-308`). On accept, `accept_tenant_invite`'s `subaccount_owner` branch
(`20271115040008:1507-1560`) checks whether the tenant has any active owner (`:1515-1518`) and whether the
minter is still the platform or the managing agency (`:1520-1522`). With no active owner and the minter
accepted, it seats the invitee as an **active owner** (`:1527-1534`), sets `owner_user_id` when it is NULL
(`:1538-1540`, through the §5.2 carve-out) and audits `tenant:subaccount_owner_established` (`:1542-1546`);
otherwise it seats an admin (`:1547-1560`). On a Solo account whose only owner is billing-paused, or whose
owner is gone, a platform-minted invitation therefore adds an owner, and with a NULL pointer makes the invitee
the account holder: an owner change outside R9, with no reason, recovery audit or notice.

**Never-owned, from real data.** `_tenant_never_owned(_tenant)` (no client EXECUTE) is true iff **all** of:
1. `tenants.owner_user_id IS NULL` (fresh sub-accounts are created this way: `create_subaccount`,
   `20271111030000_e09_finance_entitlement.sql:357-363`, its newest body; a standalone signup sets the pointer at
   provisioning);
2. no `tenant_members` row of the tenant, **in any status**, has `is_owner = true` or `role = 'owner'`;
3. `tenants.first_owner_seated_at IS NULL` (§5.1). An AFTER INSERT OR UPDATE OF `is_owner`, `role` trigger on
   `tenant_members` (SECURITY DEFINER) sets it to `now()` the first time any row of the tenant becomes an owner,
   and nothing ever clears it.

Why the marker: (1) and (2) forget a tenant whose only owner seat was deleted (`remove`, `admin-delete-user`)
while its pointer was never set; and the audit log cannot be the runtime source, because `paige_audit_log` is
not trigger-immutable and the service role keeps UPDATE/DELETE on it (`20270330000000:118`). **Backfill (I2,
the one backfill in this work):** `first_owner_seated_at` is set, per tenant, to the earliest of: any
`paige_audit_log` row with that `tenant_id` and `action IN ('tenant:subaccount_owner_established',
'tenant:grant_co_owner', 'tenant:revoke_co_owner', 'tenant:backfill_owner', 'tenant:fix_owner_user_id',
'tenant:owner_holder_restored')` (each writer sets `tenant_id`: `20271115040008:1542-1546`,
`20271116020008:160-168,242-250`, `20260804020000:121-126,267-272`; the last is new, §5.4d, and has no rows before
I2). **`tenant:deleted_injected_owner` is excluded** (`20260804020000:206-222`): it records deleting a parent agency's
owner that was wrongly injected into a child (#227), which is no evidence the child ever had an owner of its own, and
counting it would make such children refuse their first platform owner invitation. Or `tenants.created_at` when (1) or (2)
fails today. **Honest residual (§13):** a tenant whose only owner seat was deleted before any of those audit
actions existed, and whose pointer was never set, reads as never-owned. I2 reports, pre-merge, every Solo-shell
tenant the backfill leaves never-owned, with its creation date and member count, for the owner to check (§10.12).

**Gate.** For a `_solo_shell_tenant`:
- `create_tenant_invite_token(_kind='subaccount_owner')`: when the caller passes **only** through
  `is_platform_owner()` (not `agency_can_manage_child(_tenant_id, auth.uid())`), refuse unless
  `_tenant_never_owned(_tenant_id)` (§4.10, operator-facing). The agency branch is unchanged.
- `accept_tenant_invite`, `subaccount_owner` branch: under the token's `FOR UPDATE` and a `FOR UPDATE` on the
  tenant row, `_minter_ok` counts `is_platform_owner(created_by)` only when the minter is not also
  `agency_can_manage_child(tenant, created_by)` **and** `_tenant_never_owned(tenant)`. A platform-only token on a
  tenant that is not never-owned is **refused** (§4.10, invitee-facing), not turned into an admin seat (§13: a
  silent downgrade would report success). Every other branch is byte-identical (re-emit precedent
  `20271115040008`; case 13).
- Every other platform owner-add on a Solo account goes through `platform_owner_recovery` (§5.4a). Non-shell
  tenants (Agency, Enterprise, company workspaces) are unchanged.
- **§58, named:** a platform super admin could mint a `subaccount_owner` invitation on any owned Solo-shell
  tenant (the invitee got an owner seat if no owner was active, an admin seat otherwise). Both now refuse.
  Pre-merge production read: live (unused, unrevoked, unexpired) `subaccount_owner` tokens whose minter is
  platform-only on a Solo-shell tenant that is not never-owned.

**§37 producer and consumer inventory, `subaccount_owner` (grepped at `8587262ea` in round 4, unchanged on `origin/main`, across `src`,
`supabase/functions`, `supabase/tests`, `scripts`):**
| Class | Producer / consumer | Effect of §5.4b |
|---|---|---|
| Browser mint | `src/pages/admin/AgencyBoard.tsx:300-308` (`_kind: "subaccount_owner"`, `_default_role: "admin"`), mounted at `src/components/admin/AgencyLayout.tsx:294` | Agency managers pass `agency_can_manage_child`: unchanged. A super admin using the board on a child they don't manage: refused unless never-owned |
| Direct table insert | Policy *"Tenant admins manage invite tokens"* (`20260629175341:191-194`) admits `is_platform_owner()` | Closed by the token guard: `created_by = auth.uid()` and no platform exemption (§5.2) |
| Edge | `send-portal-invite/index.ts:56` (owner-of-sub-account email copy; resend of an existing token) | Unchanged; a resend creates no authority, and accept re-checks |
| Accept | `accept_tenant_invite` `20271115040008:1507-1560`; browser `src/pages/JoinWorkspace.tsx:80` (kind detection), `:133` (`rpc("accept_tenant_invite")`), route `/join/:token` (`src/App.tsx:257`) | New refusal shown through the existing JoinWorkspace error path |
| pgTAP | `supabase/tests/exp08_co_owner_authority.sql:24,406` (double of the establishment statements), `supabase/tests/exp08_team_lifecycle_production_functions.sql:628,665` (byte copy of the branch), `supabase/tests/operator_company_workspace_authority.sql:192` | Re-baselined with the new prosrc; new cases 15 |
| Scripts | `scripts/proof/e09-consumer-invite.mjs:173,199,401` (byte-preservation of the branches after `subaccount_owner`), `scripts/proof/e09-owner-invitation-history.mjs:142` (fixture) | The proof's expected slice is re-taken from the new body |
| Service role, MCP, n8n, cron, CI | None found | — |

### 5.4c Platform removal of Solo owners: `revoke_platform_access` (B3, I2) and `admin-delete-user` (D-A, I3)

> **REVERSED 2026-10-27 by owner ruling R16 (§0): nothing in this section is built.** Platform super_admin and
> platform_admin keep `revoke_platform_access`, `admin-delete-user`, archive, restore and delete on Solo accounts
> exactly as shipped. The text below is kept, struck through, as the record of what was proposed and withdrawn (§58); no
> `_solo_owner_seats_blocking_removal` helper, no 409/503 bodies, no caller changes. What still holds from it: the
> **today** descriptions of both functions, and the fact that `admin-delete-user`'s seat DELETEs fire the seat-ended
> trigger (§5.4), so a removed representative leaves the legal owner's seat held.
> The two **today** descriptions are left unstruck because they still describe production.

**Today.** Both overloads, `(uuid, text)` at `20270511000000:56-92` and `(uuid)` at `:94-118`, are SECURITY
DEFINER, gated `is_platform_admin() OR is_platform_owner()` (`:64`, `:101`), so `platform_admin` as well as
super_admin; they protect only the `app_settings_owner` user (`:67-72`, `:104-109`) and run `DELETE FROM
public.tenant_members WHERE user_id = _user_id` (`:81`, `:113`) across every tenant, owner and account-holder
seats included. That bypasses `revoke_co_owner`'s floor and holder refusal, and removing a holder's seat flips the
tenant to `none` and opens recovery. The fix migration flags it as a follow-up (`20271116020008:63-66`).
`authenticated` holds EXECUTE (per the generated schema, `docs/sprints/bootstrap-byo-schema.sql:22456,22459`; I2
confirms on prod with `has_function_privilege`).

~~**One predicate, one home.** New `_solo_owner_seats_blocking_removal(_user uuid) RETURNS TABLE (tenant_id uuid,
tenant_name text)`, SECURITY DEFINER, `STABLE`, **EXECUTE for `service_role` only** (definer callers run as its
owner). It returns every tenant where the user's `tenant_members` row has `is_owner = true` **and `status IN
('active','suspended')`**, the tenant passes `_solo_shell_tenant`, **and `tenants.archived_at IS NULL`** (D-B). So an
owner seat on an archived account (archiving sets `status = 'archived'` and keeps `is_owner`,
`20270602000203:193-194`), or an owner seat in any other status, never blocks: round 4's "in any status" would have
locked an operator out of every former owner of an archived Solo account, because recovery refuses archived accounts.~~

~~**Gate, `revoke_platform_access`.** Both overloads re-emitted verbatim except one pre-write check after the existing
ones: if `_solo_owner_seats_blocking_removal(_user_id)` returns a row, refuse with the authored operator message
(§4.10), for **every** caller, super_admin included. Nothing is deleted. The only
platform-side way to take an owner seat off a Solo business is `platform_owner_recovery('revoke_owner', …)`
(super_admin, state `none`, reason, audit, notice), which demotes the seat; after that the user's remaining
seats are non-owner and `revoke_platform_access` proceeds as today. Recovery never calls
`revoke_platform_access`, so no flag or bypass is needed. Non-owner seats, and owner seats on Agency, Enterprise
or company-workspace tenants, are unchanged. **Owner-visible consequence:** while a Solo business has a working
or paused account holder, no operator can revoke the platform access of its account holder or of any co-owner;
the holder removes co-owners, and the holder's own access can't be revoked this way at all (§10.10).~~

~~**§37 callers of `revoke_platform_access` (grepped at `8587262ea` in round 4, unchanged on `origin/main`, across `src`, `supabase/functions`, `scripts`, `.github`, `supabase/tests`,
`docs`):**~~
| ~~Class~~ | ~~Caller~~ | ~~Effect~~ |
|---|---|---|
| ~~Browser~~ | ~~`src/components/team/MembersRolesPanel.tsx:236` (one-argument overload; the error is shown as `toast.error(error.message)`, `:237`, so the operator reads the authored message), from the row menu "Revoke platform access" (`:484`) and dialog (`:563-576`)~~ | ~~Refused for Solo owners. **Reachability (§71):** `MembersRolesPanel` is imported only by `src/pages/admin/TeamHub.tsx:36,99`, and no route or component imports `src/pages/admin/TeamHub.tsx` (only `src/lib/auth/titleRoleRetiredFromClientScreens.test.ts:19` names it); import graph only, no built bundle was checked~~ |
| ~~Direct RPC~~ | ~~Any `platform_admin` or super_admin JWT~~ | ~~Refused for Solo owners~~ |
| ~~Manual proof script~~ | ~~`docs/security/move2_stage1_isolation_proof.sql:49,81`~~ | ~~Its victim must not hold a Solo owner seat, or the positive control now refuses~~ |
| ~~Types~~ | ~~`src/integrations/supabase/types.ts:22042`~~ | ~~Unchanged signature~~ |
| ~~Edge, scripts, CI, pgTAP~~ | ~~None found~~ | ~~New case 16~~ |

~~**Gate, `admin-delete-user` (D-A).**~~ Today the function admits the Platform Operator (super_admin or
platform_admin) from the verified JWT (`requireOperator`, `supabase/functions/admin-delete-user/index.ts:18-21`), refuses
self-deletion (`:30`), a platform_admin deleting a super_admin (`:32-46`) and the `app_settings_owner` user
(`:48-61`), then deletes the user's per-user rows, **`tenant_members` included** (`:86-98`, `:110-112`), and the
Auth user (`:120`).
~~Change, and only this: after `:61` and **before the first write** (the unlink at `:75-77`), call
`admin.rpc("_solo_owner_seats_blocking_removal", { _user: user_id })` through the service-role client (`admin`):~~
- ~~RPC error → **HTTP 503** `{ error: "Couldn't check whether this person owns a Solo business, so nothing was deleted. Try again.", code: "OWNER_SEAT_CHECK_FAILED" }`. Fail closed.~~
- ~~one or more rows → **HTTP 409** `{ error: <the §4.10 message>, code: "SOLO_OWNER_SEAT", tenants: [names] }`, the email
  read with `admin.auth.admin.getUserById` (already called at `:56` when an owner row exists; read once). Nothing is
  written: no unlink, no delete, no audit row.~~
- ~~no rows → exactly today's behaviour.~~

~~So **a working or paused account holder can never be deleted by an operator**: their own seat blocks it, and
recovery's `revoke_owner` needs state `none`. A co-owner with an active or suspended seat can be deleted only after
the account holder removes or demotes them, or, with no account holder, after recovery revokes the seat. **The last
active owner of a holder-less business can't be deleted either**, because recovery's revoke keeps the floor: the
operator grants another owner first. A **platform_admin** can never delete a Solo owner at all (recovery is
super_admin only). Owner seats on Agency, Enterprise, company-workspace or archived tenants, and every non-owner seat,
are unchanged. **Honest residual:** a user removed from Auth by any path other than this function (the Supabase
dashboard, the Auth admin API directly) is not stopped; §5.4a then reads that tenant as `none`.~~

~~**Response contract (§37 consumers).** A non-2xx reply reaches `supabase.functions.invoke` callers as a
`FunctionsHttpError` whose `message` is generic, so each caller reads the body from `error.context` (precedent
`src/components/admin/contacts/BusinessVerificationCard.tsx:79-81`) and shows its `error`:~~

| ~~Class~~ | ~~Caller~~ | ~~Effect~~ |
|---|---|---|
| ~~Browser~~ | ~~`src/components/team/MembersRolesPanel.tsx:251-253` (shows `error.message`, then `data.error`)~~ | ~~Reads the 409/503 body; the authored message is shown, the dialog stays open, nothing is refreshed. **Reachability (§71):** imported only by `src/pages/admin/TeamHub.tsx`, which nothing imports; import graph only~~ |
| ~~Browser~~ | ~~`src/pages/admin/ContactsAdmin.tsx:433-438` ("also delete platform account")~~ | ~~Same; the contact itself is **not** deleted when the account deletion is refused (today the contact row is removed only in the non-account branch, `:439-441`, so nothing else changes). **Reachability:** no route or component imports `ContactsAdmin.tsx` (named only by `src/lib/auth/titleRoleRetiredFromAssigneePickers.test.ts:15`); import graph only~~ |
| ~~Browser~~ | ~~`src/components/dashboard/ClientManagementDashboard.tsx:347-357` (`toast.error(err.message)`)~~ | ~~Same. **Reachability:** no importer (named only by tests, e.g. `src/__tests__/portal-direct-invitation.test.ts:7`); import graph only~~ |
| ~~Direct HTTP~~ | ~~Any super_admin or platform_admin JWT~~ | ~~Refused for Solo owners, with the body above~~ |
| ~~Deno / Vitest~~ | ~~`supabase/functions/_shared/operatorAuth.test.ts:138,164-165` (reads the source), `src/__tests__/customer-private-chat-deletion.test.ts:5` (reads the source), `src/__tests__/security-data-adoption.test.tsx:66`~~ | ~~Source assertions unchanged in meaning; new case 17~~ |
| ~~Other seat deleters (swept on `origin/main`)~~ | ~~`supabase/functions/accept-invite/team-seat.ts:201` deletes only the admin/member seat it inserted moments earlier, when its own role write fails; `process-data-deletion` deletes no seat and no Auth user~~ | ~~Not affected~~ |

### 5.4d Holder-of-record restoration: the promotional grant and subscription provisioning (D-C, I2)
**Classification (integrator D-C).** Two service-role functions outside the team flows seat an owner. They are allowed
without recovery **because they only ever (re)seat the user already in `tenants.owner_user_id`**, never a new person;
each must leave an audit row and tell the holder.

**Verified from the real bodies (`origin/main`), not assumed:**

| | `platform_grant_promotional_solo` (`20270201000000_platform_promotional_solo_grant_recovery.sql`, newest body; EXECUTE `service_role` only, `:323-326`; must name a platform owner as operator, `:55-57`) | `provision_tenant_as` (`20270325000000_canonical_solo_provisioning_contract.sql:238-375`; EXECUTE `service_role` only, `:487-488`; called by `stripe-webhook/index.ts:964` with `_owner: actorUserId`) |
|---|---|---|
| Which tenant | `WHERE t.owner_user_id = _recipient_user_id AND t.parent_tenant_id IS NULL`, oldest first (`:88-94`); refuses unless `standalone` (`:96-99`) | `where t.owner_user_id = _owner and t.parent_tenant_id is null`, oldest first (`:280-284`) |
| Who is seated | `_recipient_user_id`, the same user (`:180-184`) | `_owner`, the same user (`:288-290`) |
| New tenant instead | inserted with `owner_user_id = _recipient_user_id` (`:137-142`): provisioning, not restoration | inserted with `owner_user_id = _owner` (`:310-319`), seat `:332-334`: provisioning, not restoration |
| What it does to an existing seat | `ON CONFLICT … DO UPDATE SET role = 'owner', status = 'active', is_owner = true` (`:182-184`): a deleted seat comes back, a demoted seat becomes owner again, a `suspended` or `archived` seat becomes `active` | `on conflict (tenant_id, user_id) do nothing` (`:290`): only a **missing** seat is inserted; an existing row is never changed |
| Can it seat anyone else? | **No.** The seated user and the tenant's `owner_user_id` are the same value in both branches | **No.** Same |

So neither can add an owner who is not the account holder of record, and neither changes `owner_user_id` on an existing
tenant.

**The other two provisioning writers, checked (round 5) and not restoration:** both only seat the first owner of a tenant
they have just inserted, so neither is an owner change on an existing Solo account and neither is gated here.
- `provision_tenant` (same file, `:106`; EXECUTE `service_role` only, `:485-486`): when the caller already has a
  top-level tenant it returns it **without writing a seat** (`:136-145`, and the `unique_violation` fallback); otherwise it
  inserts the tenant with `owner_user_id = auth.uid()` (`:168-177`) and seats that same user (`:190-191`).
- `operator_provision_tenant` (same file, `:377`; gated `is_platform_owner()` at `:391`; EXECUTE `authenticated`,
  `service_role`, `:490`): always inserts a **new** standalone tenant with `owner_user_id = _owner_user_id`
  (`:427-438`) and seats that user (`:454-456`, `on conflict do nothing`). It has no existing-tenant branch, so a
  platform operator cannot use it to seat anyone on a Solo account that already exists.

Two limits on the two restoration writers, stated:
- **Paused.** The promotional grant refuses a recipient with a live or Stripe-linked enrollment or any Stripe
  subscription (`:71-86`) and a tenant with provider bindings (`:110-124`). A billing pause comes only from
  `solo_beta_sync_subscription` on a Stripe subscription (§5.4a), so **CC reads** that it never reaches a paused
  holder; that is a source reading, not proven against production data (I2 reads it). `provision_tenant_as` never
  changes an existing row, so it never un-pauses anyone.
- **Archived.** Neither checks `tenants.archived_at`. The promotional grant would set an `archived` seat back to
  `active` and `tenants.status = 'active'` (`:148-150`) while `archived_at` stays set. **Named, not changed here**;
  asked (§10.13); the owner accepted the default (named, not changed), R15 note.

**Change (I2), both functions re-emitted verbatim except these lines.** On the existing-tenant path only, before the
seat write, read the user's seat `SELECT role, status, is_owner … FOR UPDATE` (absent = NULL). After the write, when the
seat was absent or was not (`is_owner AND role = 'owner' AND status = 'active'`), and now is:
- one `paige_audit_log` row: `actor_user_id` = `_operator_user_id` (promotional) or NULL (provisioning), `actor_role` =
  `'super_admin'` or `'service'`, `action = 'tenant:owner_holder_restored'`, `target_type = 'tenant_member'`,
  `target_id` = the user, `tenant_id` explicit, `payload = {source: 'platform_grant_promotional_solo' |
  'provision_tenant_as', previous: {role, status, is_owner} | null, reason: _comp_reason (promotional only)}`. Not
  deduplicated: today the promotional grant's own audit row is unique per recipient and `ON CONFLICT DO NOTHING`
  (`20270201000000:21-23`, `:303-316`), so a second grant that restores a seat leaves no trace;
- one `public.notifications` row for that user (precedent `20271111010000:1184-1188`), `type = 'system'`,
  `action_url` = the Solo team settings route, `/solo/{account}/settings/team` (as linked at `src/solo/setup-representative-phone.tsx:56`), `metadata = {kind: 'owner_holder_restored', tenant_id, source}`:
  - title *"Your owner access to Northstar Studio is back"*;
  - message, promotional: *"A Paige administrator restored your owner access as the account holder of Northstar
    Studio while granting promotional Solo access."*; provisioning: *"Your owner access as the account holder of
    Northstar Studio was restored when your subscription was set up."*
A seat that was already an active owner writes neither. A new tenant writes neither (its first owner sets
`first_owner_seated_at`, §5.4b). The `first_owner_seated_at` trigger also fires on a restoration, harmlessly (already
set). Neither function goes through recovery or `_tenant_account_holder_state`, by decision D-C, owner-ruled YES (R15).

**§37 callers.** Promotional grant: no caller in `src`, `supabase/functions`, `scripts` or `.github`; run by the
service role as an operator procedure (`docs/brain/config-registry.md`, `docs/evidence/ui-delivery/solo-beta-acquisition.md`
name it); tests `src/lib/auth/promotionalSoloGrant.test.ts:21,48` (source assertions) and
`supabase/tests/promotional_solo_grant.sql`. Provisioning: `supabase/functions/stripe-webhook/index.ts:964` (reads only
the returned tenant row, `:974-986`, unchanged); `supabase/functions/platform-subscription-checkout/index.ts:27,317`
(comments, no call); `scripts/proof/layer-c-native-vertical.mjs:923`; `supabase/tests/canonical_solo_provisioning.sql:30,217`;
`src/__tests__/canonical-provisioning-contract.test.ts:26,34` (slices the source; re-baselined). Return shapes unchanged.

### 5.5 Reads
- **`get_solo_team_workspace`** adds `viewer_is_account_holder` and `account_holder_state`
  (`working`/`paused`/`none`/`archived`, §5.4a; owners and admins only, members get NULL); per member `is_account_holder`,
  `business_owner` (`{id, kind, display_name}`, owners/admins only) and `billing_contact` boolean (to the
  holder and the person only); `owner_seats_held` (record, kind, who left and when; owners/admins);
  `business_owner_options` (non-individual records with seat state, **holder only**); per invitation
  `business_owner`. Never `ownership_interest` or legal-profile fields. Consumers `team-workspace.tsx`,
  `team-workspace-contract.ts` and their tests.
- **`get_paige_team_context`**: same facts. Consumers (§37): `_shared/paige-spine/domains/team.ts`,
  `scripts/ci/title-authority-guard.mjs` + baseline, `scripts/client-memory-authz/check.mjs`.
- **`peek_tenant_invite`** (granted to anon): adds `business_owner_display` for owner tokens, **only while the
  invitation is valid** (I1 round 2). **Deliberate exposure, stated:** anyone holding a live link sees the legal
  owner's name; never the interest or representative.

### 5.6 Rename `viewer_is_legal_owner` → `viewer_is_owner`, add `viewer_is_account_holder`
`get_team_authority_readiness` (`20261150000000:16,89,98,111,120,126`). Consumers changed in I2:
`paige-spine/domains/team.ts:43-44`; `teamAuthorityChatEvidence.ts:17,110,115` ("Legal ownership:" →
"Owner seat:" + "Account holder:"); `src/__tests__/paige-spine-team-authority.test.ts`;
`supabase/tests/team_authority_readiness.sql`; `spine-integration-packet-team.md`;
`docs/brain/paige-spine-and-rail-state.md:261`; **`docs/binding-ledger/surface-binding-ledger.json`**.
Stored receipt/Rail rows may hold the old key: grep production in I2; `viewer_is_legal_owner` stays as a
read-only alias for one release.

### 5.7 `owner_user_id` readers that grant authority (I2)
| Reader | Change |
|---|---|
| `solo_setup_access_scope` (`20261046000000:200`) | `is_tenant_owner` instead of the bare pointer. Consumers (§37): `src/solo/SoloApp.tsx`, `src/solo/shell-role.ts`, `scripts/ci/solo-parity-guard.mjs`, `scripts/solo-setup-db-proof*`; a seatless holder no longer gets `owner_full` |
| `solo_setup_can_read` (`:181`), `tenant_legal_profile` SELECT (`:840`) | Require an active seat |
| `get_/save_tenant_legal_profile_owner` (`:856`, `:887`) | Drop the bare-pointer branch |
| `assign_pipeline_identity`, `configure_pipeline_folder_core`, `configure_tenant_pipeline_core_identity` | `is_tenant_owner` for the attribution label only |
| `solo_beta_fulfill_checkout`, `solo-beta-subscription-checkout/index.ts:56` | Unchanged (a co-owner can't start checkout, as today) |

### 5.8 Billing (no schema change)
Before a seat stops being an owner (Make Admin, step down, remove, recovery revoke), the function revokes
that person's `platform_billing_contacts` designations in the same transaction under
`platform_billing_contact_revoke`'s rules; the last primary contact of a Stripe-backed subscription is
**refused** (§4.10). Closes the "no auto-revoke on role change" residual for owners. Platform Billing reviews.

### 5.9 Agreements (E04, dependency only)
`paige_agreement_signers` (`20270401000000:150-172`) has no on-behalf-of field; a representative signs as
an individual until E04 adds `signing_for_business_owner_id`.

### 5.10 Edge, email, pages (I3)
`solo-team-invitations` (`create` takes `businessOwnerId` / `newBusinessOwner`; new refusals);
`send-portal-invite` (owner copy, owner resend gate §5.3); `notify-team-event` (`owner_recovery`);
~~**`admin-delete-user`** (the Solo-owner refusal, §5.4c, D-A) and its three browser callers reading the refusal body
(`MembersRolesPanel.tsx`, `ContactsAdmin.tsx`, `ClientManagementDashboard.tsx`)~~ **withdrawn (R16)**;
`JoinWorkspace.tsx:254`; `team-controls.tsx` `PermissionCards` third option for the holder;
`team-workspace.tsx` (invite, review, roster tags, held-seat row and menu, row menus, Make Admin / step
down / make-owner dialogs (Cancel back to details), editor additions incl. read-only owner details, the
"No account holder" and "Account holder paused" notes, the holder's Paused status, the floor reason, Roles tab,
dialog top anchoring, the held-seat menu opened from its button's left edge, read-only details focused on the
heading, the lock tooltip (D-G: it covers no control at any width; from 641px it floats left of the holder's
Status cell, top-aligned with the lock, with a transparent bridge across that cell; at 640px and below it is an inline
disclosure in its own grid row under the holder's name line; Escape-dismissable, hoverable, un-dismissed when pointer
or focus arrives, kept open when its own text is tapped; instant under reduced motion));
`team-workspace-contract.ts` (`canActOnOwner`, `canStepDown` = another active owner exists, refusal mappers); `src/agency/team.tsx:81`
(**owner decision owed**: remove the Agency Team screen's Owner option, which never produced an owner; until then I1's
tier-correct refusal is what that screen shows). **Recorded with that decision (pre-existing, not changed in I1):** the
Agency Team screen creates its `kind = 'team'` tokens with **no email** (`useAgencyPeople.ts` passes none), and both
team accept paths refuse a team invitation without an address (*"team invitation belongs to a different email
address"*), so its Admin and Member invitations can never be accepted either. `solo-team-invitations` already maps the owner refusals by HINT code
(I1 round 2, S5: `owner-refusals.ts`, 403 / 400 / 409, instead of a 500).

### 5.11 §37 producer and consumer inventory (proved per increment)
| Change | Producers / consumers |
|---|---|
| Token guard | **browser** (authenticated, guarded): `WorkspaceSettingsPanel.tsx:90,189`, `ContactPortalPanel.tsx:109,209`, `PortalInvitationManager.tsx:36` (each sets only `revoked_at` NULL→now; an owner row is now refused, e.g. revoking an owner token from the legacy workspace panel). **Service role** (exempt by `auth.uid() IS NULL`): `send-portal-invite/index.ts:137,190,253`, **`agency-invite-member/index.ts:171-182`** (`kind='agency_team'`, `default_role='member'`, `agency_role` set, `created_by` = the caller; proven in I1). **Postgres-owned definer functions** (exempt by `current_user = 'postgres'`; I1 proves each one's `pg_proc.proowner` is `postgres`): `create_tenant_invite_token` INSERT (`20260824000000:100-106`); `create_solo_team_invite` (`20271115040008:1280,1287`); `resend_solo_team_invite` (`:1329`); `accept_solo_team_invite` (`:1389`); `accept_tenant_invite` uses (`:1504,1627`); `set_client_portal_access` revoke (`20271111010000:441`); `create_client_portal_invitation` stamps `portal_operation_id`, `portal_proposal_hash`, `portal_receipt_id` (`20271108233000:162`); the new `tenant_business_owners` BEFORE DELETE trigger (§5.1); `revoke_solo_team_invite` (`20261047000000:210`) and `archive_solo_team_invite` (`20261105000000:87`) |
| CHECK `business_owner_id` null unless `is_owner` | every writer that clears `is_owner` must clear it in the same statement: `20260803190000`, `20260804020000`, `20261150000000`, `20271113630009`, `20271115040008`, `20271116020008` (re-emitted where needed; proven by case 7). **I1 re-emits none of them: DEFERRED to I2** (with `revoke_co_owner`). Interim: such a demotion fails closed on the CHECK, nothing changes (case 7.13); no seat that names a legal owner exists or can be created from a shipped surface before I3 |
| Token guard, address of a live owner invitation (I1 round 2, S6; round 3, S-A/S-C every seat-creating kind, normalised address) | producers of seat-creating tokens (every kind but `consumer`, `agency_team`) under a JWT; production's only postgres-owned token INSERTers are `create_solo_team_invite` and `create_tenant_invite_token` (pg_proc read 2026-10-27), both storing `lower(trim(email))`; no browser or edge code inserts tokens under a person's JWT: `create_tenant_invite_token` callers (`WorkspaceSettingsPanel.tsx`, `ContactPortalPanel.tsx`, `ClientManagementDashboard.tsx`, `ContactCardRail.tsx`, `ContactDetail.tsx`, `AgencyBoard.tsx`, `useAgencyPeople.ts`) and direct INSERTs; `create_solo_team_invite` (holder replace path withdraws first; non-holders already refused); service role exempt |
| Seat-side rule, owner invitation waiting (I1 round 4, B1; round 5 also UPDATE OF `tenant_id`, `user_id`: no production function sets either column (pg_proc prosrc read 2026-10-27), authenticated has SELECT only, `accept-invite/team-seat.ts` updates `role` only) | producers of a new `tenant_members` row on production (pg_proc read 2026-10-27, prosrc `INSERT INTO tenant_members`): `accept_tenant_invite`, `accept_solo_team_invite`, `accept_invitation` (authenticated), `grant_tenant_member_role`, `change_user_role` (operator path; it catches its own seat-write error and audits `role:change:mirror_failed`), `agency_enter_subaccount` (both forms), `operator_provision_tenant`, `provision_tenant`, `provision_tenant_as`, `platform_grant_promotional_solo` (new tenants: no invitation can exist), the trigger `sync_user_role_to_tenant_member`; edge: `accept-invite` (`team-seat.ts`, service role; maps the HINT to 409 `owner_invite_waiting`). Owner seats and existing seats are never refused (cases 2.01, 4.26) |
| `solo-team-invitations` owner refusals by HINT (S5) | consumers: Settings → Team (`team-workspace.tsx` shows `error`), PAIGE team tools through the same edge; statuses 403/400/409 replace 500 for these refusals only |
| `create_tenant_invite_token` Owner sentence per account type | consumer: Agency Team screen `doInvite` → `flash(r.error)` (shown verbatim); `operator_company_workspace_authority.sql` re-pinned |
| `team_member_holdings` `billing_contacts` | `team-departure.tsx`, `team-workspace.tsx` tolerate the new key (Vitest) |
| `grant_co_owner` signature | callers: tests only, plus `team-workspace-contract.ts:146` comment |
| `revoke_co_owner` platform disjunct removed, step-down kept | callers: `team-workspace` Make Admin and step-down, PAIGE none (§7), pgTAP `supabase/tests/exp08_co_owner_authority.sql` (re-run green against the re-emit) |
| `accept_tenant_invite` refusal | `JoinWorkspace`, legacy `/join` routes |
| `subaccount_owner` never-owned gate | §5.4b table |
| ~~`revoke_platform_access` Solo-owner refusal~~ | **withdrawn (R16)** |
| ~~`_solo_owner_seats_blocking_removal` (new helper)~~ | **withdrawn (R16)** |
| ~~`admin-delete-user` Solo-owner refusal (409/503 body)~~ | **withdrawn (R16)** |
| Holder-of-record restoration audit + notice | §5.4d callers; `paige_audit_log` and `notifications` readers are unaffected (new action and `metadata.kind` only) |
| `tenants.first_owner_seated_at` | written only by its trigger and the I2 backfill; read only by `_tenant_never_owned`. **Not in I1 (deferred to I2, §5.1)** |
| `remove_solo_team_member` / `remove_solo_team_co_owner` protected-account refusal | `team-workspace-contract.ts` refusal mapper; `AUTHORED_REFUSALS` |
| `solo_setup_access_scope`, `get_paige_team_context`, readiness rename | §5.5–§5.7 |
| `send-portal-invite` owner branch | token select adds `default_role` (`index.ts:139-141`); holder check through `admin` (`:133`); callers of the function: `solo-team-invitations` resend, `WorkspaceSettingsPanel`, `ContactPortalPanel` (unchanged request shape) |
| `set_solo_team_member_work_profile` (proposed) | §4.11 caller list |

### 5.12 Lane ownership
EXP08 Team DB (migrations, pgTAP) · Setup (`save_solo_setup_context`, reviewed by Setup) · Platform
Billing (§5.8) · Spine (rename) · Chat (`paige-ai-chat`, `action-risk.ts`; lands after and rebases on
`exp08-paige-team-tools`, ANT-161 window) · Settings → Team UI · E04 (dependency).

## 6. Security cases (pgTAP, real roles via `request.jwt.claims` + `SET LOCAL ROLE`; each mutation-tested)
1. **Escalation:** co-owner/admin/member `create_solo_team_invite(owner)` → refused; admin direct INSERT of an
   owner token or forged `created_by` (including a platform owner's direct insert) → refused; admin UPDATE of
   **any column other than `revoked_at`** (`default_role`, `business_owner_id`, `agency_role` on a pending agency
   invitation, `contact_id`, `portal_operation_id`, `portal_proposal_hash`, `portal_receipt_id`, `uses`,
   `expires_at`) → refused; **admin UPDATE setting `revoked_at = NULL`, `uses = 0` or a later `expires_at` on a
   withdrawn or used owner token → refused; admin DELETE or revoke of an owner token → refused**; on a non-owner
   token, `revoked_at` value → NULL refused, value → later value leaves the first value stored; every
   postgres-owned writer in §5.11 still succeeds; `send-portal-invite` resend of an owner token by an
   admin/co-owner → refused, and by the holder → allowed (the check runs through the service-role client; a
   `caller`-client call would fail closed); `create_tenant_invite_token(owner)` → refused; legacy owner token via
   `accept_tenant_invite` → refused; agency-invite-member insert still succeeds.
2. **Accept-time:** holder seat suspended → refused; pointer moved by recovery → refused; record made
   individual or seated → refused; record deleted → token revoked, refused; replay → no second seat;
   accept sets `representative_user_id`; an expired owner token **to another email** for the same record is
   revoked by the next invite, which succeeds (no unique-index error).
3. **Co-owner vs holder:** co-owner → grant/revoke/remove on anyone else → refused; co-owner →
   `revoke_co_owner(_tenant, auth.uid())` → **allowed** (step-down) while another owner is active; anyone → the
   holder → refused; holder → self (step-down, demote, remove) → refused; co-owner → `remove_solo_team_co_owner`
   on self → refused; co-owner A → B → refused; a platform super admin → `grant_co_owner`/`revoke_co_owner` on a
   tenant where they hold no seat → refused (the platform disjunct is gone).
4. **Floor and step-down (B1):** step-down succeeds with the holder `working`, with the holder `paused`, and in
   state `none`, whenever another owner is active; in every state, the only active owner's step-down → refused
   `CO_OWNER_LAST`, nothing changed; concurrent demote + step-down serialise on the lock and never leave zero
   active owners; the re-emitted `revoke_co_owner` keeps `:196-197` byte-identical (case 13).
5. **Held seat:** delete, Make Admin, step-down and `admin-delete-user`'s seat DELETE each set the vacancy and
   clear `representative_user_id`; nobody gains `business_owner_id`; `ownership_status` untouched; no close path
   exists.
6. **Cross-tenant / shape:** tenant B's record from tenant A → refused; individual record → refused; two
   seats or two live invitations per record → refused; **deleting a tenant with seats, tokens and records succeeds**.
7. **Direct DML:** UPDATE `business_owner_id`/`is_owner` → refused; co-owner claims `owner_user_id` on a
   holder-less tenant → refused; a super_admin direct UPDATE of `owner_user_id` → refused; every
   `owner_user_id` change writes an audit row; `tenant_business_owners` not client-writable; Setup
   implicit drop of a seated/held record → authored refusal, no FK error; the `tenant_business_owners` BEFORE
   DELETE trigger's token update succeeds whoever deletes the record.
8. **Agency switch:** switched-in admin → refused; **agency user holding the sub-account's owner seat →
   is the account holder**; Agency/Enterprise fail the shell gate.
9. **Role sync:** Make Admin and step-down keep global `admin`; removal revokes it unless another active
   seat grants it, super_admin included (their `super_admin` row untouched); removing the
   `app_settings_owner` user with no other admin-granting seat → the authored refusal, nothing changed, no
   raw "Cannot remove admin role from platform owner", **both as a co-owner (`remove_solo_team_co_owner`) and as
   an Admin (`remove_solo_team_member`)**; Make Admin on that user succeeds.
10. **Billing:** last primary contact on a paid plan → refused for Make Admin, step-down, remove; otherwise revoked in the same transaction.
11. **Recovery (R9):** super_admin with state `working` → refused; with state `paused` (holder seat
    suspended by `solo_beta_sync_subscription`) → refused; on an **archived** Solo tenant (`archived_at` set, seats
    `archived`) → refused; a pointer at a deleted user with an orphaned active seat → state `none`; on an Agency or
    Enterprise tenant → refused; `platform_admin` → refused; missing/short reason → refused;
    `set_account_holder` (R12) → refused unless state `none` and the target holds an active owner seat here, then
    moves `owner_user_id` with the recovery audit and the §5.2 audit; with state `none` → `grant_owner`/`revoke_owner` succeed, one
    audit row with the reason, a `notifications` row for each active owner (and the holder of record if one
    exists); a client that `set_config`s `paige.owner_recovery` and then calls `accept_tenant_invite` or a direct
    UPDATE gains nothing.
12. **Membership oracle:** a non-holder's refusal is identical whether or not the target exists.
13. **Byte-identity:** each re-emitted prosrc matches production except the marked lines
    (`grant_co_owner`, `revoke_co_owner` and `guard_tenant_owner_only_columns` against their merged `51ede67eb`
    bodies; `accept_tenant_invite`, `create_tenant_invite_token`, both `revoke_platform_access` overloads,
    `platform_grant_promotional_solo` and `provision_tenant_as` against their newest repo bodies).
14. **Owner work profiles (if §10.5 is approved):** co-owner → holder's or another co-owner's profile →
    refused; admin → an owner's profile → refused; owner → own profile → allowed; holder → any → allowed;
    admin/member targets unchanged; PAIGE `team_set_work_profile` surfaces the same refusal.
15. **Platform `subaccount_owner` on Solo-shell tenants (B2):** super_admin mint on a never-owned standalone and a
    never-owned sub-account → allowed, and accept seats the first owner and sets the pointer; mint on a tenant
    that fails any of the three never-owned tests (pointer set; any owner row in any status, including a
    `suspended` holder; `first_owner_seated_at` set after its only owner was removed) → refused; accept of a
    platform-only token minted before the change on such a tenant → refused, no owner seat, no admin seat, no
    pointer change; the managing agency's owner or manager on its own sub-account → unchanged (owner seat when no
    owner is active, admin seat otherwise), **including when the only owner is paused**; a super admin who is
    also the parent agency's owner passes through the agency branch; Agency/Enterprise tenants → unchanged;
    `first_owner_seated_at` is set by grant, accept and provisioning and never cleared; the I2 backfill sets it
    for every tenant with an owner audit row, pointer or owner row, **and not** for a child whose only owner audit row
    is `tenant:deleted_injected_owner` (that child still accepts its first platform owner invitation).
16. **WITHDRAWN 2026-10-27 (R16), kept for the record:** ~~**`revoke_platform_access` (B3, D-B), both overloads:** `platform_admin` and super_admin on a user holding an owner
    seat (`active`, and separately `suspended`) on a non-archived Solo-shell tenant → refused with the authored
    message; `user_roles` and every `tenant_members` row unchanged; after `platform_owner_recovery('revoke_owner')` in
    state `none` → succeeds; a user whose only owner seat is on an **archived** Solo tenant (`archived_at` set, seat
    `archived`) → **succeeds** (D-B); a user with only non-owner seats → unchanged behaviour; an owner seat on an Agency
    tenant only → unchanged; the `app_settings_owner` refusal still fires first; the multi-business message names
    the first business alphabetically and counts the rest.~~ Replaced by: operators' `revoke_platform_access` on a Solo
    owner behaves exactly as shipped (I2 keeps its body untouched).
17. **WITHDRAWN 2026-10-27 (R16), kept for the record:** ~~**`admin-delete-user` (D-A, D-B), Deno with a stubbed service-role client:** super_admin and platform_admin on a
    user holding an active, and separately a suspended, owner seat on a non-archived Solo-shell tenant → HTTP 409,
    code `SOLO_OWNER_SEAT`, the authored message, and **no** `.update()`, `.delete()`, `auth.admin.deleteUser` or
    `audit_logs` call (the refusal precedes the first write); the seat check's RPC erroring → HTTP 503, nothing
    written; owner seat only on an archived Solo tenant, on an Agency tenant, or no owner seat → today's behaviour;
    the earlier refusals (self, super_admin by platform_admin, `app_settings_owner`) unchanged and still first. pgTAP
    for the helper: active/suspended × archived/non-archived × Solo-shell/Agency, and `authenticated` cannot execute it.
    Vitest: each of the three browser callers shows the 409 body's `error`, not the generic invoke message.~~ Replaced
    by I1 case 2.14: accepting an owner invitation never blocks deleting the invitee's account.
18. **Holder-of-record restoration (D-C):** the promotional grant on a standalone tenant whose holder of record has
    no seat, a demoted seat, or an active owner seat → seat active owner in all three; exactly one
    `tenant:owner_holder_restored` row and one `notifications` row in the first two, none in the third; a second
    identical grant → no new row; `provision_tenant_as` with the holder's seat missing → inserted, one audit row
    (`actor_role = 'service'`) and one notice; with any existing seat → nothing changed, nothing written; a new tenant
    from either → no restoration row; neither function seats any user other than `owner_user_id` (a second active
    member of the tenant is untouched in every case).

## 7. PAIGE (I4)
- **`team_invite_member`** (`paige-ai-chat/index.ts:7769-7783`): enum `["admin","member","owner"]`, optional
  `business_owner_id` from the team context; Owner is account-holder only and means full control. No
  inline records from chat; PAIGE points to Settings → Team or Setup.
- **Gate** (`:12551-12560`): `owner` only for `team_invite_member` and only when server-derived
  `viewer_is_account_holder` (from `get_paige_team_context` under the caller's JWT) is true; else *"Only
  the account holder can add owners to this business."* `team_set_permission` stays admin|member.
- **Card** (`:10222-10237`): *"Email an invitation to riley.chen@example.com, making them an Owner of
  Northstar Studio [for Cedar Row Trust]. They get full control of the business: people, permissions,
  billing and settings, and only you can remove them as an owner. Nothing is sent until you approve. This
  sends a real email and cannot be unsent."* **The legal owner's name comes from the server read of
  `business_owner_id` under the caller's JWT, never from the model's arguments**; a mismatch or unreadable
  id refuses the card.
- **Settings → Team Paige panel** (prototype): holder *"She can invite an Owner for you, and nothing is
  sent until you approve it."*; others *"Only Morgan Hale, the account holder, can have her invite an Owner."*
- **Risk** `action-risk.ts:138` stays `high` (clamps `auto` → `confirm`). **Dispatch** (`:15688-15695`)
  passes `permission` and `businessOwnerId`; edge and DB re-check. No PAIGE demote/remove/step-down/recovery.
- Tests: enum pin, gate (holder, co-owner, admin), card copy incl. a forged entity id, dispatch args; C0b renewed.

## 8. Increments and proof
| Inc | Contents | Proof |
|---|---|---|
| I0 | **Merged and applied (`51ede67eb`).** `20271116020008` (PR #2945) is on `origin/main` as squash `51ede67eb`, byte-identical to `8587262ea`, and `db-live` = `51ede67eb` (read 2026-10-26) | Done for merge and apply. **Still owed, as I1's first production read (not run in round 5; no production query was made):** `is_tenant_account_holder` exists and `authenticated` cannot execute it, and md5(prosrc) of `grant_co_owner`, `revoke_co_owner` and `guard_tenant_owner_only_columns` equals the `51ede67eb` bodies |
| I1 | `20271119020008` (was `20271116030008`, then `20271116110008`, then `20271116130008`, then `20271117020008`, then `20271117170008`, then `20271118200008`; see §5): §5.1, §5.2, §5.3, `peek_tenant_invite`; round 2 (2026-10-27): one transaction + md5 incumbent guard on the 10 replaced bodies, no invitee `updated_by` stamp, the live-owner-invitation address rule (S6), the tier-correct `create_tenant_invite_token` Owner sentence, `solo-team-invitations` owner refusals by HINT (S5), peek only while valid; round 3 (2026-10-27): the address rule on every seat-creating kind (S-A) with normalised addresses (S-C), no resend after the legal owner is deleted (S-B), accept locks before the sender check (S-D), cases for V5/V15/V16/V21/V24 (S-E); round 4 (2026-10-27): the seat-side rule (B1), the address rule's conditions pinned (S1); round 5 (2026-10-27): renamed `20271117170008`, the seat-side rule counts only an owner invitation accept would still honour and fires on UPDATE OF `tenant_id`, `user_id`, HINT asserted, #227 residual stated; round 6 (2026-10-27): renamed `20271118200008`, the seat-side rule counts an owner invitation only for a person whose address is confirmed (N1: accept refuses an unconfirmed one) | pgTAP cases 1, 2, 6, 7, 12, 13 failing first then mutants: **184 cases (58 kept, 52 production holes, 74 new); 95/95 mutants killed (incl. T01, the trigger back to INSERT only, and S21, the confirmed-address condition dropped), 4/4 controls survive; incumbent guard refuses each of 10 drifted bodies** (round 7, CI fix: whitespace-normalised fingerprints, every drift named in one error, the repository replay's `peek_tenant_invite` accepted; review fix: line breaks kept, so a statement joined onto a comment is refused) (round 3 read 144 / 68; round 4 169 / 84; round 5 182 / 94); Vitest for S5 (mutant-checked); §5.11 sweep incl. `proowner` of every postgres-owned token writer; pre-merge owner-token count (0 on 2026-10-27); `db-live`. **Deferred to I2, stated:** `tenants.first_owner_seated_at` (§5.1); re-emitting the CHECK writers that clear `is_owner` (§5.11; interim case 7.13). **Unchanged in I1, I2 scope:** a super admin can still seat the first owner of a holderless Solo standalone account through a `subaccount_owner` token, which skips R9's reason, recovery audit and notice (§5.4b gates it); and (#227 residual, round 5) that path keys on "no active owner", so on a business whose holder is paused for billing with no other active owner an agency's or the platform's token seats a new owner beside the paused holder (§5.3, "#227 residual"). **OWNER DECISION OWED: remove Agency Team's Owner option (I3) — it never produced an owner** |
| I2 | `20271116040008`: §5.4, §5.4a, §5.4b, ~~§5.4c (database part)~~ (withdrawn, R16), §5.4d, §5.5–§5.8, Setup guards, the I1 deferrals (`first_owner_seated_at`; the CHECK writers) | cases 3, 4, 5, 8, 9, 10, 11, 14, 15, 18 (~~16, 17~~ withdrawn, R16); renamed-fact consumers; whole-suite baseline in a base worktree (§71.3); production reads: tenants by holder state, the `first_owner_seated_at` backfill result (§10.12), live platform-minted `subaccount_owner` tokens on owned Solo-shell tenants, and whether any billing-paused holder could reach the promotional grant (§5.4d); `db-live`. **Recorded, to lock in I2 (S4, not built in I1):** Setup's `save_solo_setup_context` can rename, delete (including by leaving the id out of the saved list) or reset the representative of a legal-owner record that has a pending owner invitation or a seat; I2 must refuse those with the §4.10 Setup sentence. **Also I2 scope:** the platform's `subaccount_owner` first-owner path on a holderless Solo standalone skips R9's reason and notice (§5.4b); and the inline record's `created_by`/`updated_by` FK on the account holder (§5.3) |
| I3 | §5.10 (~~including `admin-delete-user` (§5.4c)~~ withdrawn, R16), and the Agency Team Owner option if the owner rules to remove it | Vitest; **rendered frames of every §4 screen, light and dark, 1366 and 390, shown to the owner before merge (§00)**; the prototype keyboard probe re-run against the built screens; `edge-live` |
| I4 | §7 | chat tests, C0b, `edge-live` |
| I5 | tier matrix, master reference §4/§10, decision log R1–R16 with the §58 reversals (including R16 reversing B3, D-A, D-B), B1–B3 and D-A–D-H, brain | same commit (§66). **Owed:** authenticated drive on a **purpose-built Solo test tenant** (§63; never the owner's real accounts) with a second test account: invite an owner (person, legal owner), accept, Make an Owner, Make Admin, step down (holder working, paused, none; and the floor), held seat, name a representative both ways, PAIGE card approved and declined, a recovery call on a holder-less test tenant, a platform `subaccount_owner` mint on a never-owned and an owned test tenant, ~~`revoke_platform_access` and `admin-delete-user` on a test co-owner (refused) and on the same account after recovery on a holder-less test tenant~~ (withdrawn, R16; instead: `admin-delete-user` on a test representative after acceptance succeeds and leaves the legal owner's seat held), the Agency Team screen's Owner choice showing the agency sentence, and the promotional grant restoring a test holder's deleted seat. `UNVERIFIED` until then |

Each increment: spec-compliance review, then the adversarial peer-gate on the real diff (§39).

## 9. Not in this work
Ownership transfer by the account holder; the holder's own seat representing an entity; PAIGE
demote/remove/step-down/naming/records/recovery; entity signing (E04); Agency/Enterprise owner seats
and recovery; ending a held seat (R11); stopping the deletion of an owner's account by any path
(`admin-delete-user`, which operators keep as shipped under R16, the Supabase dashboard, the Auth admin API
directly: none of them is gated by owner seats, §5.4c); refusing the
promotional grant on archived accounts (named, §5.4d, §10.13); limiting the managing agency's owner path (kept as
shipped, §10.9).

**In this work although operator-side, listed because the owner will see its effects:** the never-owned limit
on the platform's `subaccount_owner` invitations (§5.4b); ~~the `revoke_platform_access` **and `admin-delete-user`**
refusals on active or suspended Solo owner seats on non-archived accounts (§5.4c, D-A, D-B)~~ (withdrawn, R16: operators
keep those powers as shipped); the audit row and notice when the promotional grant or subscription provisioning restores
the account holder's seat (§5.4d, D-C).

**Not in this work (R16):** any change to `operator_archive_account`, restore, `operator_delete_archived_account`,
`revoke_platform_access` or `admin-delete-user`.

## 10. Open questions
1. **CLOSED 2026-10-27: YES, recovery only (R12).** ~~`set_account_holder` (proposed, not ruled).~~ R9 lets a super admin add or remove owners when there is
   no account holder, but that never restores one: `is_tenant_account_holder` needs `owner_user_id`.
   Approve a recovery act that sets the account holder to an existing active owner (audited, reasoned,
   notified, Solo-shell only)? Without it, a holder-less business stays without one, and the "No account holder"
   note says only "Contact the Paige team." (§4.8a).
2. **Billing refusal narrows R5.** A co-owner who is the last primary billing contact of a paid plan can't
   step down (or be made Admin/removed) until another owner takes billing. Accept?
   - 2a. **CLOSED 2026-10-27: still the account holder; recovery refused while paused (R13).** ~~A billing-paused account holder is still the account holder~~, so recovery is refused while their
     seat is suspended by a missed payment, and the paused design (§4.8b) depends on it. Should any case differ
     (e.g. paused for a long time)?
3. **Enterprise** stays out (§2 exception), and recovery is Solo-shell only and refuses archived accounts. Confirm.
4. *Closed in round 4 (B1):* step-down no longer needs a working account holder; it follows PR #2945 (§4.7).
5. **Owners' work profiles** become holder-or-self (§4.11), changing what shipped for admins and co-owners. A
   proposal, not derived from a ruling. Approve?
6. **How co-owners ask for an account holder to be restored.** The note says "Contact the Paige team." and promises
   no restoration, because restoring one needs question 1. No route is named, because none exists on this screen.
   Name one (a support contact, a form), or keep the note as is?
7. **Ownership records with no seat.** Any owner seat gets `owner_full` and edits every record in Setup.
   Should all records become account-holder-only? (Kept as today; only seated/held/invited records lock.)
8. **Suspending an owner** stays impossible. Confirm.
9. **Who else can seat an owner on a sub-account (B2, D-D).** A platform super admin can no longer seat the first
   owner of a Solo account that has ever had one, except through recovery. The **managing agency** still can, on its
   own sub-accounts, whenever no owner is active, including when the only owner is paused or gone, and without the
   account holder (`accept_tenant_invite`, `20271115040008:1513-1534`). That is kept as shipped. CC reads it as the
   agency provisioning its own sub-account (§51), but that is CC's reading, not a ruling. Keep it, or limit the agency
   the same way as the platform (only a sub-account that has never had an owner)?
10. **CLOSED 2026-10-27: REVERSED (R16). Operators keep archive, restore, delete, `revoke_platform_access` and `admin-delete-user` on Solo accounts as shipped.** ~~**Operators can't remove Solo owners (B3, D-A, D-B).** `revoke_platform_access` and `admin-delete-user` refuse
    while the person holds an active or suspended owner seat on a Solo business that isn't archived. So no operator
    can revoke the platform access of, or delete the Paige account of, an account holder (working or paused) or a
    co-owner, until the account holder removes the co-owner or, when there is no account holder, owner recovery
    revokes the seat. The last active owner can't be removed this way at all (the floor). Confirm.~~
11. **CLOSED 2026-10-27: KEEP AS TODAY, admins may invite admins or members (R14).** ~~Admins inviting admins.~~ R1 covers the account holder and Owner only. Today an admin can invite another
    admin (`team-workspace.invite-workspace.test.tsx:338`), and this design keeps that. Keep it, or should admins
    invite members only?
12. **Never-owned backfill.** I2 lists every Solo-shell tenant the `first_owner_seated_at` backfill leaves
    never-owned (a tenant whose only owner was deleted before any owner audit existed can't be told apart). Review
    that list before I2 merges.
13. **CLOSED 2026-10-27: YES, audited and with a notice, never seats anyone else (R15); archived sub-question left at the default, named not changed.** ~~Billing and promotional restoration (D-C).~~ When a subscription is set up, or a Paige administrator grants
    promotional Solo access, the account holder of record automatically gets their owner seat back, without owner
    recovery. It is audited and they are notified, and it never seats anyone else (§5.4d). OK? And the promotional
    grant would also reactivate the seat on an archived account: should it refuse there instead?
