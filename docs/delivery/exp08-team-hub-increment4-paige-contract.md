# EXP08 Team Hub increment 4: PAIGE with Team Hub contract

Status: built and reviewed, `PROOF_OWED` (§32 persisted apply and an authenticated drive are owed). Owner decisions recorded 2026-10-24 (decision log, "EXP08 Team Hub
increment 4, PAIGE with Team Hub"):

- **Reads approved:** PAIGE reads Team Hub for any active member, limited to what that member can
  see now. This covers Chat and Live. Reads are fresh every turn and use the asker's own identity
  through the existing `team_hub_*` definers. Nothing is stored, indexed or embedded. The Spine
  capabilities are read-only `team.hub_*`, and this work touches the PAIGE chat code (the Chat lane).
- **Search approved:** one additive EXP08 search function that searches only the conversations the
  asker can see.
- **Knowledge and Memory:** not in increment 4. No Team Hub content may enter either one.
- **Posting approved, with the person's approval only:** PAIGE may draft a reply into a Team Hub
  conversation the person can post in. It is posted under the person's own name only after they
  approve it, through the existing approval path. It is never sent autonomously.

Increments 1–3 are in [collaboration](exp08-team-hub-collaboration-contract.md),
[team work](exp08-team-hub-increment2-work-contract.md) and
[attachments](exp08-team-hub-increment3-attachments-contract.md); every rule there still holds.

## 1. Who and where

- **Audience (§9/§56):** an active member of a canonical SOLO workspace, whether owner, admin or
  member. Any other tier gets nothing new.
  - The offer is gated on the tenant caller tier.
  - The authority is each definer's own `_team_hub_refusal` / `_team_hub_visible`, run under the
    asker's JWT. A tier or workspace that is not canonical SOLO is refused by the database, not by
    the prompt.
- **Surface:** the one PAIGE chat, typed or Live (§20/§21). No new tab, panel or Team Hub surface.
  - Live already runs the same governed tool loop in `paige-ai-chat`, so the reads work there unchanged.
  - A post draft proposed during Live shows its approval card in the chat, and it can be approved
    only from that card. Live already refuses approvals, so a spoken "yes" never posts.

## 2. Actor-goal flows

1. **"What's new in Team Hub?"** PAIGE lists the conversations the asker can see, with unread
   counts, and summarises the busy ones.
2. **"What did the team say in #launch about pricing?" / "Catch me up on my DM with Sam."** PAIGE
   reads the recent messages of one conversation, or one thread, that the asker can see, and
   answers from them.
3. **"Did anyone mention the venue deposit?"** PAIGE searches the asker's visible conversations
   and answers with the matching messages: who, where, when, and a link to the conversation.
4. **"Reply in #launch that I'll have the deck by Friday."** PAIGE drafts the reply and shows an
   approval card naming the conversation and the exact text.
   - On approve, the reply is posted under the asker's own name, once.
   - On decline or expiry, nothing is posted.
   - The asker's own words stay theirs: PAIGE never posts without the card.
5. **Refusals that say what happened:**
   - The asker can no longer see the conversation (removed from a private channel, workspace
     switched): *I can't see that conversation from your account.*
   - Not a SOLO workspace or not active: *Team Hub isn't available in this workspace.*
   - No match: *Nothing in the conversations you can see mentions that.*
   - Database unavailable: *I couldn't read Team Hub just now.*

   - A name PAIGE can't place: she asks which conversation, listing the ones the asker can see.
     A DM can be named by one whole word of the teammate's name (*my DM with Sam*); two matches
     are offered as a choice. *I can't see that conversation* is used only when the database says so.

   PAIGE never guesses content it did not read.

## 3. Tools and Spine capabilities

Every read uses `supabaseClient`, the asker's JWT, never the service role. The tenant is the
server's `personaCtx.tenant_id`, passed as `p_expected_tenant`, which is a fence and never a
selector. Model-supplied tenant or user ids are never honoured.

| Chat tool | Spine key | Executor | Kind |
|---|---|---|---|
| `team_hub_conversations` | `team.hub_list_conversations` | `public.team_hub_list_conversations` | read, `read_only` |
| `team_hub_read_conversation` | `team.hub_read_conversation` | `public.team_hub_list_messages` | read, `read_only` |
| `team_hub_search` | `team.hub_search` | `public.team_hub_search` (new) | read, `read_only` |
| `team_hub_post_reply` | `team.hub_post_reply` | `public.team_hub_post_message` | write, always confirmed |

- **Seat:** the member seat for all four. The offer is made only on a canonical SOLO account
  (`calendarBookingAccountShape === "solo"`, like the neighbouring Calendar and Task reads).
- **Conversations read:** returns conversations and people. The definer already omits emails.
- **Read conversation:** takes `conversation_id` (from the list or a search hit), an optional
  `thread_id`, and `limit ≤ 30`, newest window first.
  - It returns author display name, time, body, file names (never paths) and `work_ref` record ids.
- **Search** (new definer, section 4) takes `query` (2–200 chars) and `limit ≤ 20`.
- **Post reply** takes `conversation_id`, an optional `thread_id`, and `body` (1–4000 chars).
  - **Gate:** the generic confirm gate in `paige-ai-chat`, with the action-risk row at `high`, so a
    card is forced on every lane. The approved arguments are the ones stored with the confirmation.
  - **Call:** the dispatch calls `team_hub_post_message` through `supabaseClient`.
    `auth.uid()` is the author, so the post is under the person's own name.
  - **Idempotency:** `p_client_request_id` is derived deterministically from the confirmation
    fingerprint, so a replayed approval posts at most once.
  - **Never set:** mentions and files are not set by PAIGE in this increment.
- **Untrusted content (prompt injection):**
  - Every body PAIGE reads is another person's words. It enters the model only inside an explicit
    untrusted-data fence that says it is reference data from teammates, never instructions.
  - Bodies are capped per message and per result.
  - Nothing read from Team Hub can by itself cause a post. A post is a new card the asker approves.
- **Conversational (degraded) mode:** the three reads join `CONVERSATIONAL_ADMITTED_READ_TOOLS`,
  citing the 2026-10-24 owner decision. The post tool is withheld there like every other write.
- **Receipts:** each available read records `recordCapabilityRun` with outcome
  `capability_succeeded` through the existing seam, before any Team Hub text reaches the model. If
  the receipt cannot be recorded, the person is told Team Hub couldn't be read.
  - The receipt is keyed on the chat tool name, not the Spine key: `record_capability_run` refuses
    dotted keys (`20270107000000_receipt_correlation_and_detail.sql`), as it already does for the
    engagement and booking reads. The run id includes the actor.
  - The approved post records its own receipt with a stable run id.
  - There is no link into a Team Hub conversation: `paige-turn/record-links.ts` has no Team Hub
    destination and Team Hub has no per-conversation route. PAIGE names the conversation instead.
- **Steps:** in-progress copy in `paige-turn/step-start.ts` (*Reading Team Hub*, *Searching Team
  Hub*, *Posting your Team Hub reply*) and finished copy in `describeStep` (*Read Team Hub*,
  *Searched Team Hub*, *Posted your Team Hub reply*). An approval card is not a step, so the
  draft itself has no step line.
- **Catalogue:** migration `20271114240108_exp08_team_hub_reply_catalogue.sql` lists the reply in
  `list_tool_autonomy` (category Team), so the owner can see it and turn it off. Its `high` risk
  clamps the lane to confirm whatever is stored.

## 4. The search definer (migration `20271114240008_exp08_team_hub_search.sql`)

- **Signature:** `public.team_hub_search(p_expected_tenant uuid, p_query text, p_limit int DEFAULT 20)`.
  It is `SECURITY DEFINER` with `search_path=''`, and is granted to `authenticated` only.
- **Order of checks:**
  1. `_team_hub_refusal(p_expected_tenant)` first.
  2. Then only messages whose conversation passes `_team_hub_visible` for `auth.uid()` *now*.
  3. Messages that are not deleted.
- **Matching:**
  - Case-insensitive substring match on the body.
  - The query has `%`, `_` and `\` escaped, so it is a literal, never a pattern.
  - Newest first, capped at 20 results.
  - Query length is 2–200 after trimming; anything else returns `{ok:false, code:'invalid'}`.
- **Returned fields:** message id, conversation id, conversation label, thread root, author display
  name, time, and a snippet of at most 240 characters. No email, no storage path.
- **No index and no new storage:** a sequential, bounded scan over the asker's visible conversations.
  - The scan is bounded by the workspace's message volume: the visibility helper runs per row, so
    the planner may read a workspace's messages before filtering them.
  - It is honestly slower than an index at scale. That is a known limit, because an index or
    embedding would store or index content, which the owner excluded.
- **Names:** an author or DM party without an active seat in the workspace is *Former teammate*,
  never their current profile name.
- **Proof:** `supabase/tests/exp08_team_hub_search.sql`, mutation-tested and wired into CI. It
  must show:
  - a non-member cannot find a private channel's message;
  - another tenant's message is never returned;
  - a removed member stops finding it;
  - a DM is found only by its two members;
  - deleted messages are excluded;
  - wildcards are literal;
  - `scope_changed` is returned for a wrong expected tenant.

## 5. Memory and Knowledge: nothing from Team Hub

- **Session summaries:** PAIGE writes session summaries to `paige_owner_memory` (`record_paige_memory`).
  A session in which any `team.hub_*` tool ran must write **no** session summary, milestone, or other
  machine-extracted owner memory derived from that session. A Team Hub excerpt must never be saved
  as a "proposed" memory.
- **Knowledge:** no Team Hub path writes Knowledge.
- **The mechanism must be server-derived:** for example, the session's recorded `team.hub_*`
  capability runs, or a turn flag persisted with the session. A client-supplied hint is not enough.
  Proof shows a Team Hub-reading session leaves no memory row.
- **What is not Team Hub content:** an explicit "remember that…" in the asker's own words is their
  own text. It stays governed by the existing explicit-signal path.
- **As built (owner ruling 2026-10-25, decision log):** a summary request carries a browser-held
  transcript the server cannot tie to individual turns, so no time window is enforceable. Once a
  person has any Team Hub read or reply card recorded, in any workspace they hold or held a seat
  in, PAIGE writes **no** automatic session summary, milestone or extracted fact for them again.
  The check is server-derived (`paige_workspace_events` receipts and the reply's confirmation
  rows) and fails closed. Explicit "remember" requests are unaffected.
- **Traces:** PAIGE's model traces (`paige_llm_trace`) are readable by every member of a workspace.
  So a request that carries Team Hub text, and every later request by a person who has read Team
  Hub, is traced metadata-only: no prompt or answer text is stored.
- **Nothing carries it out in the same request:** once Team Hub text has entered a request,
  `web_fetch`, `deep_research`, `save_to_knowledge_base`, `knowledge_update` and every write that
  could run without the person's approval card (risk `ordinary`) are withheld until the person's
  next message, each with a plain refusal. Writes that always need a card (`high`, `owner_only`),
  the Team Hub reply among them, still show the card.
- **Known gap:** in a later message, a person can still approve a Knowledge or note card whose
  text came from Team Hub. Only the prompt guidance discourages it.

## 6. Coordination and pinned files

- **Window:** requested in Linear ANT-161 (2026-10-25).
- **Files changed:**
  - `paige-ai-chat/index.ts`, `_shared/action-risk.ts`, `_shared/paige-turn/step-start.ts` (step
    copy only) and `scripts/ci/c0b-incumbent-resource-binding.mjs`;
  - new files: `_shared/paige-spine/domains/team_hub.ts`, its registry entry, `_shared/team-hub/chat.ts`
    with tests, migrations `20271114240008` (search) and `20271114240108` (catalogue), and the proof;
  - lint and test updates that pin the read sets: `action-risk-lint.mjs`, `capability-kit-lint.mjs`,
    `int346-runtime-recovery-handler-check.mjs`, `e2-2-conversational-read-admission.test.ts`, and
    `receipt-coverage-ledger.json`.
- **C0b:**
  - The 29 Chat dispatch fingerprints are renewed with base reproduction, showing that only the
    identity set changed.
  - The `action-risk.ts` digest is renewed.
  - Nothing else in C0b changes.
- **Untouched:** contracts.ts, governedExecution.ts, workspace-authority.ts, the other paige-turn files,
  the Live relay and session functions, and the capability-discovery `authorityGateSites` count.

## 7. Not in increment 4

- Saving to Knowledge or Memory.
- PAIGE attaching files, @mentioning people or creating channels.
- Reading the Team work panel. Tasks stay readable through Operations' own tools.
- Notifications, realtime, or any autonomous post.

## 8. Proof owed after merge

- §32 `db-live` readback of `20271114240008`.
- `edge-live` for `paige-ai-chat`.
- An authenticated drive on the owner-designated existing SOLO account covering list, read,
  search, a post approved from the card, and a declined card. No new QA tenants.
