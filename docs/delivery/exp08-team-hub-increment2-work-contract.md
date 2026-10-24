# EXP08 Team Hub increment 2: team work contract

Status: building. Owner decisions recorded 2026-10-24 (decision log, "EXP08 Team Hub increment 2"):

- **Approved:** one additive EXP08 link table, with each Team Hub message pointing to one EXP05 Work record.
- **Ruled:** no automatic link-back from PAIGE chat in this increment.

The design follows the approved, frozen prototype v2 (§28). Increment 1 is in
[the collaboration contract](exp08-team-hub-collaboration-contract.md); every rule there still holds.

## 1. Scope

A teammate in a canonical SOLO workspace can:

1. **Type `/` in the composer** to open a command menu with four commands: *Draft a task*, *Ask a specialist*, *Request approval* and *Schedule a meeting*.
   - The menu works like the @ list: arrow keys move, Enter picks, Esc closes, and it is announced as a listbox.
   - It is the only `/` affordance. `/PAIGE` typed as text opens the same menu.
2. **Draft a task**, which creates one real task in Operations.
   - **Preview:** before anything is created, an inline preview shows:
     - the title, prefilled from the draft;
     - the assignee: anyone active, if the caller is an owner or admin, otherwise only themselves (Operations' own rule);
     - an optional due date;
     - a risk line: *Creates a task in Operations*.
   - **Create Task**, one gold act button, posts a command message in the conversation and creates the task through Operations' existing writer. Both happen in one transaction.
   - The message then carries a **task card**: record id, title, assignee and due date, plus the status read from the Operations record, with the time it was read.
   - **Cancel** keeps the draft.
3. **Ask a specialist**, or send a message that @mentions one of the six specialists (ZION, CURA, MERIT, NEXUS, MENTOR, VERA).
   - **Preview:** *Continue in PAIGE*. Nothing is created in Team Hub.
   - **Confirm:** hands a prefilled draft to PAIGE (`handOffPaigePrompt` plus the shell's `openPaige`). The draft is addressed to the specialist and carries the Team Hub reference as data, and the person presses send there.
   - **Authority stays in PAIGE chat:**
     - PAIGE chat keeps the approval card and the owner/admin delegation check.
     - Members see before continuing that only an owner or admin can hand work to a specialist.
     - If the person also wants their message in the conversation, it is posted. The specialist name stays plain text, never a stored mention.
4. **Request approval** and **Schedule a meeting**: the same PAIGE handoff with a prefilled draft.
   - They do not write to the approval queue or the calendar from Team Hub (EXP05 owns both).
   - The preview says where the request goes and that PAIGE will show the approval or slot there.
5. **Open the Team work panel**, the third column, or an overlay below 1366 px of viewport, like the thread drawer's breakpoints.
   - It lists the tasks started from conversations the caller can see, newest first, each with:
     - its conversation;
     - its record id;
     - the status read from Operations;
     - the time that status was read.
   - Opening a row jumps to its message.
   - A row whose record the caller cannot read says *You can't see this task in Operations*. No status is guessed.
   - Empty state: *No team work yet. Tasks you start here show with their status from Operations.*

**Not in increment 2** (each is stated, not stubbed):
- attachments;
- linking specialist runs, approvals and meetings back to their message (a separate EXP05/Chat change, not requested yet);
- realtime;
- Knowledge and Chat/Live continuity.

## 2. Authority and data

Team Hub creates no task store, scheduler, approval inbox, action bus, specialist runtime or ledger.

- **Write.** `team_hub_request_task` is the only new writer. It:
  - re-runs increment 1's door checks (seat, SOLO, fence, conversation visibility);
  - posts the command message;
  - calls `public.plan_assign_task_scoped` (EXP05 Operations' existing writer, unchanged) with the caller's own identity;
  - inserts one `team_hub_work_refs` row.

  These steps happen in one transaction. Any refusal from Operations rolls back the message and the link, and returns a mapped code.
- **Idempotent on `(author, client_request_id)`.** A retry returns the original message and its reference, and never creates a second task. Operations' writer is not idempotent, so this function is what makes the request exactly-once.
- **Read.** Status always comes from the original record:
  - The client reads `plan_items` (`id, title, status, assigned_to_user_id, due_at, updated_at`) by id through the caller's own RLS, as Operations' `createOperationsWork` already does.
  - A row the caller cannot read is reported as unreadable.
  - The link table stores no status, title copy, assignee or due date.

## 3. Storage (EXP08, additive)

`team_hub_work_refs`:

| Column | Notes |
|---|---|
| `message_id uuid` | Primary key, references `team_hub_messages`, cascades on delete |
| `tenant_id uuid` | |
| `channel_id uuid` | |
| `work_source text` | `check (work_source = 'planning')`. The check is widened only by a later owner-approved increment. |
| `work_id uuid` | Unique per `(tenant_id, work_source, work_id)` |
| `created_by uuid` | |
| `created_at timestamptz` | |

- A trigger requires `tenant_id` and `channel_id` to match the message.
- RLS is on with no policies, and there are no browser grants.
- Registered `delete` in the retirement disposition, like the increment-1 tables (A10).

## 4. Functions

All functions are SECURITY DEFINER with `search_path=''`, granted to `authenticated` only, and return `{ok, code}` with the increment-1 codes.

- **`team_hub_request_task(p_expected_tenant, p_channel_id, p_title, p_assignee, p_due_at, p_client_request_id, p_parent_message_id default null)`**
  - Returns `{ok, message}`, where the message carries `work_ref: {source:'planning', id}`.
  - **Body:** `/PAIGE draft a task`, a fixed command text. The title lives in Operations, not in the message.
  - **Refusals:**

    | Code | When |
    |---|---|
    | `invalid` | Bad title, past or invalid due date, or no request id |
    | `not_allowed` | Operations refused the assignment (`PLAN_ASSIGNMENT_FORBIDDEN`) |
    | `scope_changed` | Operations raised `PLAN_SCOPE_CHANGED` |
    | `unavailable` | Operations raised `PLAN_FORBIDDEN` |
    | `failed` | Any other Operations error. Nothing is stored. |
- **`team_hub_list_work(p_expected_tenant, p_limit default 50)`**
  - Returns `{ok, items:[{message_id, channel_id, source, work_id, created_by, created_at}]}`.
  - Covers conversations the caller can see now, newest first.
  - Returns no status.
- **`_team_hub_message_json`** gains `work_ref` (null when there is none). It is redefined by `CREATE OR REPLACE` in the new migration.

## 5. Interface

- Container queries on the hub's own width, as in increment 1.
- The Team work panel is the third column when the hub is at least 1440 px wide. Narrower, it is an overlay drawer that shares the thread drawer's slot, and only one is open at a time.
- On phones it takes one column at a time, with Back.
- Gold appears only on *Create task*. *Continue in PAIGE* is neutral, because PAIGE holds the act.
- One announcer. Command and preview are both keyboard-complete, and Esc closes the innermost layer first.

## 6. Proof owed

**SQL proof (disposable PG16):**
- creates the task and the link atomically;
- a retry returns the same task, with no second `plan_items` row;
- Operations refusals roll everything back;
- a non-member gets `not_found`;
- `list_work` shows only visible conversations;
- a non-admin cannot assign others;
- the A10 disposition and grants hold.

The proof uses a fixture double of `plan_assign_task_scoped` that has the same signature and the same raise codes. The real function is not in the disposable database. This is stated in the proof header.

**Vitest, mocked RPC:**
- command menu keyboard behaviour;
- task preview and create;
- retry idempotency;
- refusal kept in the draft;
- specialist handoff calls `handOffPaigePrompt` and `openPaige` with the reference, and never calls any delegation API;
- work panel statuses and the unreadable row.

**Rendered harness:** the four viewports with PAIGE closed and open, both themes, plus the phone.

**Authenticated drive** on the owner-designated SOLO account: owed.
