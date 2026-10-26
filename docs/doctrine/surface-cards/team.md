# Surface card — Team (Solo)

## Current source and ownership — EXP08 receiving lead, 2026-10-23

**Owner-authorized:** one Claude Code lead owns EXP08 *Manage My Team / Team Hub*, with ZION as the
supervised product specialist. EXP05 keeps the canonical Work, tasks, assignments, Planning, Calendar
execution, ZION runtime, delegation lifecycle and receipts. A team request in Team Hub references
one EXP05 Work record and never becomes a second task. Its status comes from the original
Work, run or approval record, never from a chat message. The receiving acknowledgment is in ANT-161. Neither the
staffing nor this note is runtime proof, customer acceptance or a release.

What the code says today. These dated corrections supersede the matching historical statements
below. The originals stay where they are as history (§58).

- **Spine registry.** The "Team is NOT declared" paragraph below is superseded. `registry.ts`
  now spreads 11 `team.*` capability keys from `domains/team.ts`, `team_reads.ts`,
  `team_invitations.ts` and `c0b_existing_writes.ts`, plus the `team.authority_fact` signal kind.
  None of them declares a Rail outcome, so the reason this card is `PARTIAL` still stands.
- **High-risk tools.** Six access-changing tools are `high` (decision 1 below). The
  "propose or perform" table and the "four `high` tools" line further down predate
  `member_grant_role` and `member_revoke_role` and undercount them.
- **Activity feed.** It reads the tenant-wide `get_solo_rail_activity`, not `paige_client_events`
  (Master §5 records the correction).
- **Rail projection.** The workspace-level outcome record (SCR-2026-09-05, `capability_run`)
  exists, but Team actions are not wired to it. Decision 2 is therefore unbuilt for Team, not
  unbuilt platform-wide.
- **Live source.**
  - Settings → Team is the only live Team screen: `src/solo/settings.tsx` mounts
    `src/solo/team-workspace.tsx`.
  - `src/solo/team.tsx` is unmounted demo-data source.
  - `src/pages/admin/TeamHub.tsx` has no route.
  - Neither counts as evidence for Team Hub, and neither is revived.
  - `/solo/{n}/team` redirects to Settings → Team, so Team Hub needs its own path.
- **Recipient binding.** `20261200000300_solo_team_recipient_binding.sql` is on main. Its production
  persistence and a fresh-account acceptance drive were not re-read for this note, so they stay
  `UNVERIFIED` here.
- **Team Hub collaboration substrate (channels, DMs, threads, mentions, read markers).** It does
  not exist.
  - Searched `supabase/migrations` and `supabase/functions` for `team_chat`, `staff_chat`,
    `team_channel`, `team_message`, `internal_message`, `channel_members`,
    `conversation_participants`, `direct_message`, `team_thread`, `message_mentions` and
    `team_hub`: zero hits.
  - The only `channel*` table is the provider `channel_connectors`.
  - `messages`/`threads` are the customer inbox and have no participant ACL.
  - `paige_chat_threads` is single-owner PAIGE chat.
  - Adding the substrate is a backend change (§00). The owner approved it on 2026-10-24 (below).
  - **Update, 2026-10-24:** increment 1 adds it (PR #2764, migration `20271113850008`,
    `team_hub_*` tables and functions, SOLO-only). The search above describes the state before
    that PR. It is `PROOF_OWED` until persisted-apply and an authenticated drive; see the
    [collaboration contract](../../delivery/exp08-team-hub-collaboration-contract.md).
  - **Update, 2026-10-24:** increment 2 adds team work (migration `20271113860008`, PR #2779):
    `/` commands, a task created in Operations through `plan_assign_task_scoped` with an
    exactly-once link in `team_hub_work_refs`, PAIGE prefill handoffs and the Team work panel.
    Also `PROOF_OWED`; see the
    [increment 2 work contract](../../delivery/exp08-team-hub-increment2-work-contract.md).
  - **Update, 2026-10-25:** increment 3 adds attachments (migrations `20271114160008` and
    `20271114160108`, merged PR #2839 and read back on production).
    - Limits: up to 5 files of 10 MB each per message or thread reply.
    - Storage: the private `comms-attachments` bucket at `<tenant>/team-hub/<file_id>`, recorded
      in `team_hub_files` behind four restrictive storage policies.
    - Checking: the new `team-hub-file` edge function checks each file's real bytes.
    - Download: a fresh 60-second attachment URL on every click.
    - Retirement: a `team_hub_files` provider.
    - Files are not malware-scanned, and the UI says so.
    - Not accepted: legacy `.doc`/`.xls` and PowerPoint. Word and Excel files with embedded
      objects, charts, external links or macros are refused.
    - Also `PROOF_OWED` until an authenticated drive. See the
      [increment 3 attachments contract](../../delivery/exp08-team-hub-increment3-attachments-contract.md).
  - **Update, 2026-10-25:** increment 4 adds PAIGE with Team Hub (migrations `20271114240008` and
    `20271114240108`).
    - Reads: in Chat and Live, PAIGE lists, reads and searches the conversations the asker can see,
      with the asker's own JWT, fresh every turn. Nothing is stored or indexed.
    - Reply: drafted by PAIGE, posted under the person's own name only from their approval card.
    - Memory: once a person has read Team Hub through PAIGE, their automatic memory summaries stop
      (owner ruling 2026-10-25) and their PAIGE traces carry no text.
    - Also `PROOF_OWED`. See the
      [increment 4 PAIGE contract](../../delivery/exp08-team-hub-increment4-paige-contract.md).
  - **Update, 2026-10-26:** team lifecycle (migration `20271115040008`, owner rulings that day).
    - Suspend and reinstate: a reversible hold. Owners and admins; an admin acts on members only.
    - Remove: an admin may now remove a member.
    - Team conversations switch, on by default: off keeps the person's own assigned work and is
      refused `conversations_off` by every Team Hub door. Contractors are members.
    - Arrival: a new teammate joins the open team channels unless switched off.
    - Departure review: a read-only list of what someone holds before they leave.
    - A suspension is lifted only by reinstatement (or billing); other role writes leave it suspended.
    - While someone is suspended, only the owner (or a platform owner) changes their role or ends
      their seat; an admin still reinstates, removes and switches Team conversations for a member.
    - The departure review returns item rows with the version each existing hand-over writer needs;
      the hand-over contract (approvals and mailboxes have no hand-over writer) is in
      `docs/doctrine/tier-matrix.md`. PAIGE's tools for these acts are task #7, not built.
    - Invitations can carry Team conversations off (`teamHubAccess` on the `solo-team-invitations`
      create body); the person then joins no team channel on arrival.
    - A DM to someone switched off is refused `recipient_conversations_off`, not stored as delivered.
    - Accepting an invitation (`/accept-invite`) never lifts or changes a held seat: a person whose
      seat here is suspended or otherwise not active is refused 409 before any write, and an active
      seat is never lowered by an invitation. A revoked or archived seat must be removed before the
      person can be invited back. The page still shows a generic error for every refusal (it does not
      read the reply's message on a non-2xx), which is owed to the page.
    - `PROOF_OWED`: not merged; no browser surface yet.
- **Owner decisions, 2026-10-24.** Answered by the owner in the EXP08 Claude Code session and
  logged in `docs/brain/decision-log.md`. They are approvals to build, not proof that anything
  works.
  - **Design and behavior: APPROVED.** The Team Hub interactive prototype v2 (private artifact,
    sample data, nothing saved or sent) is approved for production, and it is approved-frozen
    under §28.
    - Placement: its own SOLO menu item directly below Operations.
    - Layout: conversations, then the conversation, then Team work.
    - Collaboration: channels with public/private membership, DMs and threads.
    - Mentions: active people in the conversation plus the six specialists. Ambiguous or removed
      names are refused.
    - Commands: `/PAIGE` commands preview their scope and risk first.
    - Records: Operations-linked task, request and approval cards read their status from the
      original record.
    - Recovery: offline and send-failure handling never re-dispatches.
    - Access: a removed teammate loses Team Hub and PAIGE team answers.
  - **Collaboration storage: APPROVED.** Team channels, channel members, messages, threads,
    mentions and read markers may be added as reviewed, additive migrations with tenant and
    channel-membership enforcement. Isolation must be proven before release, and no Slack or Teams
    connection is involved.
  - Neither approval authorizes ownership transfer, an external send, or a provider connection.

**Truth label: `PARTIAL`.** The capability runs correctly and is governed correctly; the owner
cannot see what Paige did. See *Rail outcome* below — that is the whole reason this is not `LIVE`.

Written 2026-09-02 by applying the Alignment Standard's build path to the Team capability. Legs 1–5
pass. Legs 6–7 do not.

**The code this describes is already LIVE ON PRODUCTION**, merged in #728 (`76bb3bbca`) — the
tools, their risk classifications, the tenant-agreement guard, the autonomy clamp and the catalogue
migration. Verified 2026-09-02 against prod (`xygzykjyynhzqytbqnzu`), not inferred from the merge:
`schema_migrations` carries `20261039000000` and `20261040000000`, and `list_tool_autonomy()`
returns all five `team_*` rows under the `Team` category. This card is the department's record of a
shipped capability, not a proposal.

**That is why `PARTIAL` matters rather than being a paperwork nicety.** The capability is running
for tenants now, so the gap below — an owner cannot see what PAIGE did to their team — is running
too.

**Team is NOT declared in the Spine registry.** `supabase/functions/_shared/paige-spine/registry.ts`
declares exactly one capability today (`PIPELINE_DEAL_STAGE_EVIDENCE`). Team should be declared —
and the reason it cannot be declared *complete* is the same reason this card is `PARTIAL`: the
registry requires `outcome.railVisibility`, and Team has none.

## Owner decisions of record — 2026-09-02

Recorded exactly as ruled. **Decision 2 describes work that has not happened**; decisions 1 and 3
describe the platform as it already behaves. Nothing here is implemented by being written down.

### 1. The six access-changing Team actions stay in PAIGE, classified `high`

Invite · resend invitation · revoke invitation · change permission/access · grant role · revoke
role. Each requires the **canonical, server-verified owner approval card before execution**. PAIGE
may propose the action and explain it, and may carry it out only after the owner explicitly
approves that exact bounded action. She may never manufacture approval, raise autonomy, or bypass
the domain authorization check.

**This matches the live code.** All six are `high` in `_shared/action-risk.ts`; the gate accepts
only a fingerprint of the exact rendered card, carried in the request **body**, which the model
cannot write.

| Tool | Classification |
|---|---|
| `team_invite_member` | `high` |
| `team_invite_resend` | `high` |
| `team_invite_revoke` | `high` |
| `team_set_permission` | `high` |
| `member_grant_role` | `high` |
| `member_revoke_role` | `high` |
| `team_set_work_profile` | `ordinary` |

**A correction is recorded here rather than smoothed over.** The first version of this ruling said
every Team mutation was `owner_only`, and this card recorded it as a gap against the code. That
wording was wrong for the product, and the owner corrected it. The distinction is the reason it
mattered: **`owner_only` is not a stronger gate — it removes an action from Chat entirely, at any
approval strength.** Applying it here would not have hardened the Team tools, it would have
withdrawn PAIGE's ability to help an owner run their team, which is the opposite of the intent.
`high` is the setting that means *she can do it, and only after you approve this exact call*.

**`team_set_work_profile` stays `ordinary`**, because it changes only title and
responsibilities and cannot alter access. It still requires the normal compact confirmation and
ordinary domain authorization. **It must never be represented as a permission change** — the RPC
writes two text columns and cannot reach `permission`, and any copy suggesting otherwise is false.

### 2. A Team event is not a client event

**Do not emit a client Rail event with a null `contact_id`.** The future repair is a *distinct
tenant/workspace-level outcome projection* carrying: safe actor · action · target member or
invitation · approval binding · result · owner-visible evidence. It must be proposed as its own
**Spine Change Request** and implemented in its own coordinated workstream. Not started here.

### 3. `PARTIAL` is not lifted by documentation

Team stays `PARTIAL` until **both**: the owner can see a truthful, tenant-scoped outcome after PAIGE
acts, **and** the live authenticated flow is proven. Writing a card does not move a truth label.

### 4. Roles and titles (2026-09-26)

Tenant permissions are exactly **owner · admin · member**. **Coach is removed as a permission** and survives only as a title. The Team screen's permission options and the `member_grant_role` / `member_revoke_role` tools will stop offering it in their own slices. **Nothing is removed by writing this down.**

The *Title* field this card describes (labelled *Job title* until 2026-09-27; the owner made "title" the final word) is exactly the ruled **title**: descriptive only, never read by a permission decision. That matches the live code, which already writes it through a function that cannot reach `permission`. Authoritative: `docs/doctrine/role-taxonomy-and-matrix.md` §0.

### Related, and separately active: PR #728's post-merge follow-up

#728 is the merge that put this capability on production. Its post-merge review raised **four P1
findings and one P2**, and they are **an active hotfix in their own workstream — not repaired, and
not made irrelevant by anything in this card.** Two of them land on surfaces this card describes:

- **P1 · `src/hooks/useRailEvents.ts`** — when the tenant or contact changes mid-flight, an
  in-flight history query can merge the *previous scope's* events into the new feed. The Rail
  reading described below is therefore not simply "working"; it has an open cross-account staleness
  defect against it.
- **P1 · `src/solo/data/useSoloPendingActions.ts`** — pending action titles, summaries and drafts
  from the previous tenant persist on the Trust Compass after an account switch.
- P1 × 2 · `supabase/functions/paige-apply-extraction` — a partial sync counted as success, and an
  extraction claim not released when the transport rejects.
- P2 · `src/components/dashboard/PaigeAIChat.tsx` — a failed Skip leaves a proposal unretryable.

Nothing in this card should be read as evidence about those findings either way.

## Owner job and user flow

An owner or admin decides who is on their workspace and what each person may do: invite someone,
resend or withdraw an invitation, describe what a teammate owns, and change what a teammate can
access. Two entry points, one seam — the Team screen, and PAIGE in the rail beside it.

## Tenant data / domain owner

| | |
|---|---|
| Membership | `tenant_members` (role, `is_owner`, status, `job_title`, `responsibilities`) |
| Invitations | `tenant_invite_tokens` where `kind = 'team'` |
| Identity | `profiles` (display name), `auth.users` (email, last sign-in) |
| Read | `get_solo_team_workspace(_search,_permission,_limit,_offset)` · `get_paige_team_context()` |
| Write | `set_solo_team_member_work_profile` · `set_solo_team_member_permission` · `create_/resend_/revoke_solo_team_invite(_actor, _expected_tenant_id, …)` (create gains `_team_hub_access boolean DEFAULT true` in `20271115040008`; service-role only, behind the `solo-team-invitations` edge function; authority proved by `solo_team_invite_authority`) · `remove_solo_team_member` (Owner-only, **applied to production as `20261048000000`; owner drive owed**; owner **or admin on a member** once `20271115040008` is live) · `suspend_solo_team_member` · `reinstate_solo_team_member` · `set_solo_team_member_team_hub_access` · read-only `team_member_holdings` (all `20271115040008`, **not yet merged**) |

All are `SECURITY DEFINER` with the authority check **in the body**, so the same refusal applies
whether the request came from the screen or from a sentence.

## Solo shell placement

`/solo/{account}/settings/team` — Settings group, `SoloTeamWorkspace`. PAIGE reaches the same seam
from the expanding rail (`openPaige` → `expandRail`), beside whatever screen is open.

## States

| State | Behaviour |
|---|---|
| Empty (first use) | One member, the owner. "Your workspace starts with you" + invite the first teammate |
| Create | Invite dialog: address, access level, optional title/responsibilities, then a review step naming all four before anything sends |
| Edit | Member editor — work details and permission are separate controls with separate confirmations |
| Save | Reads back the **stored** values, not the submitted ones |
| Cancel | Modal dismiss restores focus to the invoking control |
| Retry | Invitation resend/revoke per row; roster retry on a failed load |
| Remove | Owner-only, last in the member editor: an armed confirmation naming the person and the workspace, then success / refusal / failure+retry / already-gone, announced in the roster after the dialog closes (**shipped; owner drive owed**) |
| Denied | "You don't have access to this team" — distinguished from a load failure |
| Suspend / reinstate / Team conversations / departure review | **Not built in the UI.** The server acts exist in `20271115040008` (not yet merged); the Team screen has no control for them yet |

## What PAIGE can read

`get_paige_team_context()` → a sanitised block with **two separately labelled facts per person**
(F1, 2026-09-26). The roster carries `user_id`, name, email, `platform_role` (owner, admin or
member, or an older value exactly as the server enforces it) and `title` (the business's own word,
always present, `null` when unset), plus responsibilities. Invitations carry `invitation_id`, address,
`proposed_platform_role`, `title` and lifecycle status. The old `enforced_permission`,
`proposed_permission` and `job_title` keys are gone. The block tells PAIGE to name people by name and
title, to describe access only as owner, admin or member, never to read a key name aloud, and to ask
once when an instruction could mean either (for example "make Sam a manager").

The word "title" comes from `_shared/team-vocabulary.ts` (`TITLE_WORD`). Control characters are
stripped, fields are length-capped, and **the invite token is never included**. The block is marked
`REFERENCE DATA ONLY`; tenant-authored work text confers no authority. It is suppressed entirely when
the block's tenant ≠ the conversation's tenant.

**Proof.** The unit test is `src/solo/paige-team-context.test.ts`. The real handler is driven in CI by
`scripts/client-memory-authz` section 27 (27.0–27.8). `npm run lint:title-authority` (with its
`--self-test`) fails CI when a policy, an authorization helper or a TypeScript gate reads a title. Whether
a live model actually speaks this way is **UNVERIFIED** until an authenticated drive; see decision 4.

## What PAIGE can propose or perform

| Tool | Seam | Risk |
|---|---|---|
| `team_set_work_profile` | `set_solo_team_member_work_profile` | `ordinary` |
| `team_set_permission` | `set_solo_team_member_permission` | `high` |
| `team_invite_member` | `solo-team-invitations` create | `high` |
| `team_invite_resend` | resend | `high` |
| `team_invite_revoke` | revoke | `high` |

Ids come from the context block only — never a name PAIGE resolved herself. Nobody can be made an
owner; the permission enum is `admin | member` and the database refuses `owner` besides.

## Required confirmation / approval

The four `high` tools require the rendered card's fingerprint, carried in the request **body** — a
channel the model cannot write. `confirm: true` from the model is refused for them. Cards name the
person and the consequence, not the enum, and a `high` card whose subject cannot be named is
refused rather than shown unnamed. A workspace `auto` setting does **not** lower this: as of
2026-09-02 the handler clamps `auto` → `confirm` for any `high` or `owner_only` action.

**This paragraph describes the platform as it runs today, and it is also the ruled end state**
(owner decision 1 above): the six access-changing Team tools stay in Chat at `high`, each behind
the canonical server-verified approval card, and `team_set_work_profile` stays `ordinary`.

`team_set_work_profile` is `ordinary` — reversible, in-tenant, and structurally unable to reach
`permission`.

## Removing someone — SHIPPED, with the owner drive still owed

**Truth label for this capability alone: `SHIPPED`.** PR #799 merged as `5ca7893d` and
`20261048000000` is applied to production — confirmed by live query, not by the merge having
happened: the `schema_migrations` row exists, `remove_solo_team_member(uuid,uuid)` resolves, and
`tenant_members` no longer grants INSERT/UPDATE/DELETE/TRUNCATE to `anon` or `authenticated` while
retaining `SELECT`. A control check (`public.tenants`, untouched, still grants `anon` TRUNCATE)
proves those withdrawals are this migration's effect rather than the environment's baseline.

**`Authenticated Runtime Proof Owed`.** No authenticated owner drive has been performed, so nobody
has yet watched a person complete this flow end to end. Applied is not driven. That proof is owed
and is not implied by anything above.

An Owner removes one **Admin or Member** from the workspace they are in (a suspended membership
included — see the tier matrix for why the lookup carries no status filter). A switched-in agency
manager is seated as an Admin by `agency_enter_subaccount` and is therefore refused. The act deletes exactly one
`tenant_members` row. It does not touch identity, profile, authored records or audit history, and it
does not reach another workspace — proven on production inside a rolled-back transaction with a
person who is a member of two workspaces (`docs/evidence/team-removal/`). Owners, co-owners, the
caller themselves, and legacy specialised permissions are all refused, so the sole Owner is
unreachable by construction rather than by a count.

**It is not a PAIGE capability.** No chat tool is added; `classifyAction("team_remove_member")`
remains deliberately `unclassified` and `_shared/action-risk.ts` is untouched. Removal from a
sentence is a separate, later decision.

**It emits no Rail event**, for the reason recorded below and under owner decision 2: a Team action
is not a client event, and the workspace-level projection is a separate Spine Change Request. The
attribution row is written to `audit_logs` exactly as its sibling Team writes are.

**What changed underneath.** The same migration revokes `INSERT, UPDATE, DELETE, TRUNCATE` on
`tenant_members` from `anon` and `authenticated`, because a guarded function is not a boundary while
a tenant Admin can delete any membership row — every Owner's included — directly through PostgREST,
and while both browser roles hold a `TRUNCATE` that row-level security does not gate.

## Rail outcome and follow-up — **THE GAP**

**A Team action emits no Rail event, and the owner has nowhere to see that it happened.**

- `emitRailForTool` returns early on `if (!contactId) return` — the Rail is per-client by
  construction. Team actions have no contact. Emitting one anyway would invent a client
  involvement, so the early return is *correct*; the Rail simply cannot carry a workspace-level
  outcome.
- An attribution row **is** written to `paige_audit_log`: tenant-stamped, naming the tool, the
  target table and id, the outcome, and which authority allowed it. It is durable and correct.
- **No Solo surface reads `paige_audit_log`.** The two owner-facing activity feeds — the Trust
  Compass panel and the Team hub's own *"What the team did"* — both read `paige_client_events`
  through `useSoloActivityFeed`. So **a permission change PAIGE makes on this very team does not
  appear in that team's own activity feed.**
  **AMENDED 2026-09-02 — the conclusion stands, and the reason is stronger than this bullet says.**
  Those feeds do not merely lack a Team event: **they cannot read the Rail at all.**
  `useSoloActivityFeed` selects `paige_client_events` directly as `authenticated`, and production has
  **no SELECT grant for that role on that table** (revoked by `20260712200000`, never re-granted;
  read-only catalog query, 2026-09-02). The read therefore fails before RLS.
  **Status of record: `UNAVAILABLE` — production Rail history cannot be read, and the current
  owner-facing consumer treatment is not reliable enough to distinguish denied history from empty
  history** (issue **#746**). ~~*The hook honestly renders an error rather than an empty feed.*~~
  **CORRECTED same day (§58):** the two shipped Context Rail consumers
  (`PaigeRailFeed.tsx:108`, `ClientActivityFeed.tsx:144`) read only `{ events, connected }`, and
  `historyError`/`historyLoaded` have no reader in `src/` — so a refused read renders as "nothing yet."
  The Solo Trust Compass consumer (`compass.tsx:377`) does distinguish, which is why the status is
  *not reliable enough* rather than *never*. So the destination this bullet points at is unavailable
  for **every** department, not only for Team's contact-less events, and it can present as absence
  rather than as failure. See `docs/brain/paige-spine-and-rail-state.md`. Nothing here is repaired by
  the amendment; Team stays `PARTIAL`.
- Because PAIGE is a rail *beside* the page, an owner sitting on Team with PAIGE open sees a stale
  roster after she acts: `useTeamWorkspace` refetches on mount and on its own mutations, and
  nothing signals it from the chat.

**This is a Spine Change Request, not self-service work — and the Spine foundation says so in its
own words.** `docs/architecture/paige-spine-foundation.md` opens by stating the foundation *"does
not create a second Rail, event bus, memory store, approval store, or PAIGE workspace"*, and the
registry requires either `NONE` or an approved Change Request identifier for a shared primitive. A
workspace-level (non-client) rail event is exactly such a primitive. The Chat workstream inventing a
second activity substrate to close its own visibility gap is the duplication the one-approval-gate
rule exists to prevent, in a different costume.

**The owner has since answered the half of this that was open (decision 2 above).** A Rail event may
NOT carry a null `contact_id` — a Team event is not a client event. The repair is a distinct
tenant/workspace-level outcome projection carrying safe actor, action, target member or invitation,
approval binding, result and owner-visible evidence. It is a separate Spine Change Request in its
own coordinated workstream, and it has not been started.

Note also that the feed named above is itself under an open P1 (`useRailEvents` cross-account
staleness, from #728's follow-up), so "the owner sees it in the Rail" is not yet a safe destination
even for the events that do carry a contact.

## Dependencies, collisions, and required browser proof

- **Depends on:** the action-risk policy, the confirmation/approval gate, `current_user_tenant_id()`,
  `get_paige_persona_context()`, the `solo-team-invitations` edge function, `send-portal-invite`.
- **Known collision, unresolved:** `crm_list_team` (`list_team_members`) and the Solo Team functions
  read the same `tenant_members` table but disagree on authorization source (global `user_roles` vs
  tenant membership), owner labelling, suspended members, and truncation. Two homes for "who is on
  the team".
- **Repaired (`20261047000000`, #815):** the three invitation RPCs used to resolve their workspace
  from `profiles.active_tenant_id` **raw**, while everything else COALESCEd through
  `current_user_tenant_id()`, so a sole owner with a null pointer was told they were not an owner —
  on the Team screen and, before PAIGE's workaround, in her voice. Invitation authority is now
  proved by `solo_team_invite_authority(_actor, _expected_tenant_id)` against a workspace the caller
  NAMES: the Team screen sends the `tenant_id` it rendered the roster from, PAIGE sends the tenant
  the conversation is about, and the resolver proves active owner/admin membership in that exact
  workspace. It is refusal-only — a named workspace can abort a call and can never select one.
  Nothing in the invitation path reads the raw pointer any more, so a stale pointer is structurally
  incapable of steering an invitation. PAIGE's `inviteSeamBlocked` workaround was DELETED rather
  than moved: leaving it would have relocated the same false refusal into TypeScript, where the
  database could no longer falsify it.
  - The `current_user_tenant_id()` fallback was deliberately **not** inherited. Its second arm picks
    the earliest active membership, which is fine for a roster read that self-corrects on screen and
    wrong for an invitation, which emails a live 7-day access token to a stranger. Owner ruling,
    2026-09-02: a guess is acceptable only where a harmless read can self-correct.
  - Still true and NOT repaired by this change: the null-pointer population itself. Provisioning
    never writes the column, the client computes a working value and declines to persist it, and
    removal clears it by design. The repair makes that harmless for invitations only; other raw
    readers of `active_tenant_id` were not audited.
- **Required browser proof, OWED ON A LIVE CAPABILITY — no leg of this has been driven on the live
  authenticated platform, and the code is already serving production.** The order of those two
  facts is the point: this is not proof owed before a release, it is proof owed on something
  already released. Needed: invite a real address from chat and from the screen; resend and revoke;
  change a permission and confirm the roster reflects it; edit work details and confirm the
  omitted field survived; drive the owner-only refusal as an admin; and confirm what the owner sees
  afterwards, which is the gap above.
