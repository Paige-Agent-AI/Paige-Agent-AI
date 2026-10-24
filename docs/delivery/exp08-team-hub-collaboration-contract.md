# EXP08 Team Hub: increment 1 collaboration contract

**Status:** contract for development. Nothing here is built until its PR merges. A merge is still not
authenticated proof or owner acceptance.
**Authority:** owner approved the design (prototype v2, frozen under §28) and the collaboration
storage on 2026-10-24 (`docs/brain/decision-log.md`). Current Team source:
[surface card](../doctrine/surface-cards/team.md).
**Owner of this contract:** EXP08 lead. Builders consume it. They don't redefine it.

## 1. What increment 1 delivers

An active teammate opens **Team Hub**, its own SOLO main-menu item directly below Operations, and
can:

1. See the channels they can see, their DMs and their unread counts.
2. Create a channel that everyone on the team can see, or a private one limited to the people they
   add.
3. Join or leave a team-visible channel. Leave a private channel. Add active teammates to a private
   channel they're in.
4. Open a direct message with any active teammate.
5. Read the conversation, page back through older messages, and post a message.
6. Reply in a thread one level deep, and see each thread's reply count.
7. @mention active people who can see the conversation. Ambiguous names are told apart by title,
   and removed people can't be picked.
8. Search their own conversations by name.
9. Have messages survive reload. Offline and send-failure recovery never duplicates a message
   (every post carries a client request id).

**Not in increment 1.** Each is an explicit, honest later increment, not a hidden control:

- specialist mentions and `/PAIGE` commands (they need the EXP05 Work seam, increment 2);
- the Team work side panel (increment 2);
- attachments (increment 3);
- Knowledge/Memory indexing and Chat/Live answers (increment 4);
- realtime push. Increment 1 refreshes on focus, on reconnect and on a 15-second visible-tab
  interval, and says nothing about live delivery.

The UI must not show controls for any of these. An omitted control is honest. A dead or "coming
soon" control is not delivered (§70.1).

## 2. Who can do what

| Actor | Access |
|---|---|
| Active member of the active workspace (owner, admin or member, by `tenant_members.status='active'`) | Everything in §1, inside their own workspace only |
| Removed or suspended teammate, or a row that is not active | Nothing. Every function refuses with `not_member`. Existing channel rows grant nothing |
| Agency parent, platform admin or operator with no active seat in this workspace | Nothing. No blanket access, and `is_tenant_member` (which admits operators in company workspaces) is **not** used |
| Portal client, anonymous | Nothing. No grant to `anon`, and client accounts hold no `tenant_members` seat |
| Owner or admin of the workspace who is not in a private channel | Can't see that channel's name, members, messages or unread count. Workspace role doesn't open private channels |

Workspace resolution: `public.current_user_tenant_id()` plus an active `tenant_members` row for
`auth.uid()` in that workspace.

**SOLO only (amendment A1, 2026-10-24).** The resolved workspace must be a canonical SOLO account:
`account_type='standalone'` and `parent_tenant_id IS NULL`, the same rule as
`assert_canonical_solo_tenant`. Anything else returns `unavailable`. Agency and Sub-account are held,
and an agency manager's seat created by `agency_enter_subaccount` must not open Team Hub.

**Reactivation (amendment A2).** When a teammate's seat stops being active (row deleted, or status
changed from `active`), their `team_hub_channel_members` rows for private channels and DMs in that
workspace are deleted by a trigger on `tenant_members`. Re-inviting the person restores no private
channel. **Exception (amendment A9):** operator account archive (`status='archived'`, set by
`operator_archive_account`) is a lifecycle hold, not a removal. It keeps memberships so that
`operator_restore_archived_account` restores Team Hub intact. Archived seats are already refused
`not_member` by every function. Every function that inserts a membership locks the target's seat
row (`FOR SHARE`) first, so the trigger can't race it. Reopening a DM with them recreates their membership, and the DM's earlier messages are
visible to both people again; this is the stated behavior. Every function takes `p_expected_tenant uuid`. If it differs from
the resolved workspace, the function refuses with `scope_changed`. That fences a workspace switch
mid-request; it never selects the workspace.

## 3. Storage (one additive migration)

The file is `supabase/migrations/20271113850008_exp08_team_hub_collaboration.sql`. Recheck that
the version is still free before merge (`lint:migration-versions`).

Every table has RLS enabled with **no** policies, and `ALL` is revoked from `PUBLIC`, `anon` and
`authenticated`. All access goes through the `SECURITY DEFINER` functions in §4, which re-check the
caller in their bodies (§59).

| Table | Columns (all `NOT NULL` unless marked) | Constraints |
|---|---|---|
| `team_hub_channels` | `id uuid pk default gen_random_uuid()`, `tenant_id uuid → tenants(id) on delete cascade`, `kind text` (`channel`/`dm`), `name text` (nullable; required for `channel`), `visibility text` (`team`/`private`), `dm_key text` (nullable; required for `dm`), `created_by uuid`, `created_at timestamptz default now()`, `archived_at timestamptz` (nullable) | A channel needs a name matching `^[a-z0-9][a-z0-9-]{1,29}$`. A DM has no name, has `visibility='private'` and has a `dm_key`. Unique `(tenant_id, name)` among unarchived **team-visible** channels only (amendment A3). Private channel names are not unique, so creating one can never reveal that another private channel exists Unique `(tenant_id, dm_key)` |
| `team_hub_channel_members` | `channel_id uuid → team_hub_channels on delete cascade`, `tenant_id uuid`, `user_id uuid`, `added_by uuid`, `added_at timestamptz default now()`, `last_read_at timestamptz` (nullable) | PK `(channel_id, user_id)`. A trigger requires `tenant_id` to equal the channel's `tenant_id` |
| `team_hub_messages` | `id uuid pk`, `tenant_id uuid`, `channel_id uuid → team_hub_channels on delete cascade`, `author_user_id uuid`, `body text` (1–8000 characters after trim), `parent_message_id uuid` (nullable → `team_hub_messages(id)`), `client_request_id uuid`, `created_at timestamptz default now()`, `edited_at`, `deleted_at` (both nullable, unused in increment 1) | Unique `(author_user_id, client_request_id)`. A trigger requires the parent, if set, to be in the same channel and to have no parent itself (one level). `tenant_id` must match the channel |
| `team_hub_message_mentions` | `message_id uuid → team_hub_messages on delete cascade`, `tenant_id uuid`, `channel_id uuid`, `mentioned_user_id uuid` | PK `(message_id, mentioned_user_id)` |

Indexes:
- `team_hub_messages(channel_id, parent_message_id, created_at desc)`;
- `team_hub_messages(parent_message_id)` where `parent_message_id is not null`;
- `team_hub_channel_members(user_id, tenant_id)`.

DM key: the two user ids sorted, joined by `:`.

**Account retirement (amendment A10).** All four tables are registered as `delete` in the
canonical operator retirement disposition, using the guarded body patch the `public_visits`
retirement migration uses, so permanent deletion of an account that used Team Hub isn't blocked.
The SQL proof asserts the disposition.

## 4. Functions (the callable seam, §10)

All functions share these rules:
- `LANGUAGE plpgsql SECURITY DEFINER SET search_path=''`.
- `REVOKE ALL … FROM PUBLIC, anon`; `GRANT EXECUTE … TO authenticated`.
- They return `jsonb`.
- Refusals are `{"ok": false, "code": "<code>"}`. Nothing raises to the client for an expected
  refusal.
- Success is `{"ok": true, …}`.
- They never return another workspace's or an invisible channel's ids, names, counts or text.

Codes:
`not_member` · `scope_changed` · `unavailable` (not a canonical SOLO workspace, A1) · `not_found` (also returned for a channel the caller can't see, so
its existence is never confirmed) · `invalid` · `name_taken` · `not_allowed` · `too_long`.

`see(channel)` means the channel is in the caller's workspace, is not archived, and either has
`visibility='team'` or has a `team_hub_channel_members` row for the caller.

| Function | Behavior |
|---|---|
| `team_hub_list_conversations(p_expected_tenant uuid)` | `{ok, tenant_id, me:{user_id}, people:[{user_id, display_name, title, permission}], conversations:[…]}`. **people** is the active roster only. **conversations** has one entry per visible channel: `{id, kind, name, visibility, joined, member_count, member_ids, dm_user_id, unread, last_message_at}`. `member_count` and `member_ids` (amendment A4: the caller is a member, so it may see who else is) are for private channels and DMs only, and list only members still active in the workspace; `dm_user_id` is the other person in a DM; `unread` counts top-level messages by others after `last_read_at` (null means none read), and only for joined conversations. `display_name` comes from `profiles.full_name`, falling back to `"Teammate"`; never an email. Agency, operator and removed people are never listed |
| `team_hub_create_channel(p_expected_tenant uuid, p_name text, p_visibility text, p_member_ids uuid[], p_client_request_id uuid)` | Name normalized with lower/trim. `invalid` if it doesn't match, or if visibility is not `team`/`private`. `name_taken` only if an unarchived **team-visible** channel has the name and the new channel is team-visible (A3). For `private`, every `p_member_ids` entry must be an active member of the workspace, otherwise `invalid`. The creator is always a member. Returns `{ok, channel_id}`. Idempotent: a retry with the same creator and name within 60 seconds returns the same channel |
| `team_hub_open_dm(p_expected_tenant uuid, p_user_id uuid)` | The target must be an active member and not the caller, otherwise `invalid`. Creates the DM and both member rows, or returns the existing one. `{ok, channel_id}` |
| `team_hub_join_channel(p_expected_tenant uuid, p_channel_id uuid)` | Only `visibility='team'` channels can be joined (`not_found` otherwise). Idempotent |
| `team_hub_leave_channel(p_expected_tenant uuid, p_channel_id uuid)` | Removes the caller's row. A DM can't be left (`not_allowed`). Leaving a private channel removes access. When the last member leaves a private channel, the channel is archived in the same transaction (amendment A5) |
| `team_hub_add_members(p_expected_tenant uuid, p_channel_id uuid, p_user_ids uuid[])` | Private channels only, and only by a current member of the channel. Every id must be an active member of the workspace. Idempotent. `{ok, added:int}` |
| `team_hub_list_messages(p_expected_tenant uuid, p_channel_id uuid, p_thread_root uuid default null, p_before timestamptz default null, p_before_id uuid default null, p_limit int default 50)` | Requires `see`. `p_limit` is clamped to 1–100. The cursor is the compound `(created_at, id) < (p_before, p_before_id)` (amendment A6); `p_before` without `p_before_id` is `invalid`. With no `p_thread_root`, returns top-level messages newest-first. With one, returns `{root, messages}`, where `messages` are that root's replies newest-first under the same cursor, and `has_more` means older replies exist (amendment A7). The client reverses for display and offers "Show earlier replies". Each message is `{id, author_user_id, body, created_at, parent_message_id, reply_count, last_reply_at, mentions:[user_id]}`. The result also carries `{ok, channel:{id, kind, name, visibility, joined}, has_more}` |
| `team_hub_post_message(p_expected_tenant uuid, p_channel_id uuid, p_body text, p_client_request_id uuid, p_parent_message_id uuid default null, p_mention_ids uuid[] default '{}')` | Requires `see`. The body is trimmed and must be 1–8000 characters (`invalid` or `too_long`). Posting to a `team` channel joins the caller automatically. Each mention must be an active member who can see the channel (the channel's members for private channels and DMs), otherwise `invalid` and nothing is stored. Idempotent on `(author, client_request_id)`: a retry returns the original message, `{ok, message, duplicate:true}`. Returns `{ok, message}` |
| `team_hub_mark_read(p_expected_tenant uuid, p_channel_id uuid, p_through_message_id uuid)` | Requires a member row (`not_allowed` otherwise). The message must be a top-level message in this channel (`invalid` otherwise). Sets `last_read_at = greatest(coalesce(last_read_at,'-infinity'), that message's created_at)`, so a message the client never displayed is never marked read (amendment A8). `{ok}` |

### Ratified build choices (2026-10-24)

- Any active seat counts, whatever its `tenant_role`. Authorization never reads titles.
- `mark_read` on a team channel the caller hasn't joined returns `not_allowed`.
- `unread` is `0` for conversations the caller hasn't joined.
- `p_member_ids` is ignored for team channels.
- Reusing a `client_request_id` in another conversation returns `invalid`.
- A `NULL` `p_expected_tenant` returns `scope_changed`.
- Refusal order: `not_member`, then `unavailable`, then `scope_changed`.
- Channel creation is idempotent per creator, name and visibility within 60 seconds; a request
  id is required but not stored.
- An author no longer on the roster shows as "Former teammate". An email is never shown.
- The SQL proof runs in its own disposable database (the migration commits), drops that database
  at the end, and reproduces Supabase's default privileges for new tables and functions, so the
  grant assertions can fail.

## 5. Interface (approved prototype v2, increment-1 subset)

- **Navigation.** Destination id `teamhub` with label **Team Hub**, the `MessagesSquare` (lucide)
  icon and slug `team-hub`. It goes in `SOLO_SHELL_DESTINATIONS` directly after `operations`, and
  in `SOLO_BRANCHES` as key `teamhub` with no subtabs. `/solo/{n}/team` keeps redirecting to
  Settings → Team; nothing is removed. The non-SOLO tenant shells are untouched (Agency and
  Sub-account are held).
- **Screen.** `src/solo/team-hub/TeamHubWorkspace.tsx`, mounted from `SoloApp.tsx` `screens` as
  `teamhub`. Layout:
  - a conversations column (search, Channels with an inline create form, Direct messages with an
    inline person picker);
  - the conversation (header, stream with a "new" divider and day separator, composer with an @
    picker);
  - a thread drawer that opens on the right.
  
  The drawer overlays when the hub itself is narrower than 1150 px (1366 px minus the 216 px
  expanded rail); below 760 px of hub width the screen shows one column at a time with a back
  button. Both are container queries on the hub, not viewport widths.
- **Tokens and styling.** Tokens are `--pg-*` only, styled in `team-hub.css` next to the workspace.
  Gold (`--pg-gold-fill`, with `--pg-env` text as `client-portal-access.css` does) is used only for
  the act buttons: the Create channel submit and the Add people submit. Disclosure toggles stay
  neutral. Layout breakpoints are container queries on the hub's own width (`container-type:
  inline-size`), never viewport media queries, because the PAIGE panel narrows the hub at any viewport. Send is
  ink, not gold. The page has no banner.
- **States.**
  - Loading: skeleton.
  - First use: one empty conversation list with "Create a channel" and a DM picker. An owner or
    admin sees a link to Settings → Team to invite people. Nobody is invented.
  - Empty conversation; not found or no access (one message that never says why).
  - Offline: draft kept, Send disabled, no queue.
  - Send failed: Retry reuses the same client request id, plus a Delete option.
  - `not_member`: the whole hub shows "You're no longer on this team".
  - `scope_changed`: reload for the current workspace.
- **Unread integrity.** A conversation is marked read only while its stream is actually on screen:
  wide layout, or the phone conversation view. The list view never marks anything read, and neither
  does a background refresh of a conversation the person isn't looking at.
- **Phone first use.** At phone width the first-use explanation and its actions show in the list
  view, so they can be reached.
- **Accessibility.** The composer is a `role=combobox` with `aria-activedescendant` over the
  mention listbox. Arrow keys, Enter and Esc work. Focus is restored after every action, and the
  live region announces sends and refusals. Reduced motion is honored. Targets are at least 40 px, including Retry, Delete, "N replies" and notice buttons. A refusal
  is announced once (either `role=alert` or the live region, never both). Unread counts are visible
  digits plus screen-reader text, not `aria-label` on a span.
- **Data hook.** `src/solo/team-hub/useTeamHub.ts`. Every call passes `p_expected_tenant` from
  `useTenantContext().activeTenant.id`. A workspace switch clears all state. Responses are
  validated, and anything unexpected is treated as `unavailable`.

## 6. Proof owed by the increment-1 PRs

- **SQL.** `supabase/tests/exp08_team_hub_collaboration.sql` runs on a disposable database with
  minimal fixture tables (`tenants`, `tenant_members`, `profiles`) and the `auth.uid()` claim
  plumbing used by sibling tests. It loads the migration with `\ir` and asserts under
  `SET ROLE authenticated` with JWT claims:
  - an active member can create, post, read, reply, mention and mark read;
  - a non-member of a private channel gets `not_found` on list, read and post, and the
    conversation list doesn't contain the channel or its count;
  - another workspace gets `not_found`, and the expected-tenant mismatch gets `scope_changed`;
  - a removed or suspended member gets `not_member` everywhere;
  - an agency, operator or anonymous caller is refused;
  - a duplicate client request id returns the original message, with no second row;
  - invalid mentions store nothing;
  - thread depth is limited to one;
  - direct table reads by `authenticated` are refused.

  The test is wired into `.github/workflows/ci.yml` beside the other `supabase/tests` psql steps.
  It also runs a migration replay (applied twice must fail cleanly or no-op, as the repo
  convention requires).
- **Frontend.** Vitest:
  - nav order tests updated so Team Hub sits directly after Operations;
  - `tierBranches` invariants;
  - workspace states and mention refusal against a mocked RPC layer, labelled as mocked.
- **Evidence.**
  - `docs/evidence/ui-delivery/exp08-team-hub-increment1.md`, with 8 viewport records (four
    sizes, PAIGE closed and open) and both themes.
  - Authenticated runtime stays `UNVERIFIED` until the drive on the owner-designated existing
    account.
- **Release.**
  - Master §4.0 row after merge.
  - `db-live` persisted-apply confirmation (§32).
  - Surface binding ledger row for `teamhub`.
  - Tier matrix ledger row (§66).

## 7. Routing answers (AGENTS.md pre-edit gate)

1. **Outcome.** Teammates coordinate in channels, DMs and threads inside their workspace.
2. **Domain owner.** EXP08 Team. EXP05 owns Work, which increment 1 doesn't touch.
3. **Harness and Gateway.** None for increment 1. These are human-to-human messages with no
   Paige act.
4. **Spine.** `UNAVAILABLE` in increment 1. The functions are the callable seam, and a Spine
   registration (`team.hub_*`) comes with increment 2 when Paige reads or acts on Team Hub.
5. **Provider.** None. Native only; Slack and Teams belong to EXP10.
6. **Approval and risk.** Messages are ordinary, workspace-internal writes. Nothing goes outside
   the business, so no approval card is needed.
7. **Durable job.** None.
8. **Readback.** Every post returns the stored row, and the UI renders only what the server
   returned.
9. **Surface.** New `teamhub` row in the binding ledger at `PROOF_OWED`.
10. **Proof.** SQL isolation proof plus Vitest at merge. Authenticated drive owed.
