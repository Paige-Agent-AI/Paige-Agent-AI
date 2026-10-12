# INT-298 / INT-342 MBC 6a — a form-started process runs only for its form or campaign

SHELL: SOLO. Coordinator command "Marketing Backend Completion & Analytics Ownership" (owner-authorized
2026-10-10), slice 6, item 3: "the approved form-triggered process selection, limited to the intended form or
campaign rather than indiscriminately triggering unrelated processes". MBC 4a recorded the gap: a §67
process on `form.submitted` ran for every form in the workspace, because nothing wrote its `conditions`.

## Grounding

- **Processes:** `paige_automations` (20261022000000) holds `trigger_key`, `conditions` (a jsonb array),
  `granted_lane` and `state` (`draft | live | paused`). PAIGE's `automation_draft` creates one at `draft` and
  `confirm` with no conditions; `automation_set_state` switches it on. No surface wrote `conditions`.
- **Engine:** the dispatcher evaluates conditions with `evaluateConditions`
  (`supabase/functions/_shared/paige-orchestration/decide.ts`). Supported operators include `eq`, `in` and
  `contains` (array membership) over dotted `payload.*` fields. Malformed conditions fail closed.
- **Event:** `form.submitted` (MBC 4a) carried `form_id` but no campaign.
- **Production on 2026-10-12:** `paige_automations` held 0 rows, so a new rule changes no existing process.

## The contract

Migration `20271022100000_int298_process_scope_and_action_truth.sql`.

**The event names its campaigns.** `form.submitted` gains `campaign_brief_ids`. These are the non-archived
campaigns the submitted form is attached to (through `campaign_brief_asset_links`, MBC 3), read when the event
fires, so a form attached to a campaign later is covered without touching any process. The list is ids only.

**A scope is exactly one of:**

| Scope | Condition written |
|---|---|
| One form | `{field: "payload.form_id", op: "eq", value: <form>}` |
| Several forms (1–50) | `{field: "payload.form_id", op: "in", value: [<forms>]}` |
| A campaign | `{field: "payload.campaign_brief_ids", op: "contains", value: <campaign>}` |

Every form and campaign named must belong to the process's own workspace.

**The rule, on every write.** A trigger on `paige_automations`, `automation_form_scope_guard`, refuses:
- a `form.submitted` process becoming or being created `live` without a scope (`PROCESS_SCOPE_REQUIRED`);
- conditions with more than one scope or a malformed one (`PROCESS_SCOPE_INVALID`);
- a scope naming another workspace's form or campaign (`PROCESS_SCOPE_NOT_FOUND`).

A draft may stay unscoped while it is built. Processes on any other trigger are untouched.

**The seam.**
- `configure_process_scope(_automation_id, _scope, _actor_kind)`:
  - Accepts `_scope` as `{formId}`, `{formIds: [...]}` or `{briefId}`.
  - Requires the owner or an admin of the process's workspace, with the tenant taken from auth. It is audited
    (`process.scope`).
  - Replaces any earlier scope and keeps every other condition. It is idempotent by construction.
- `get_process_scope(_automation_id)` returns the scope with the form or campaign names, whether the process can
  go live, and its state.
- The screen and PAIGE's chat tools both call these two functions.

**The engine is unchanged.** The scope conditions use operators the dispatcher already evaluates. A campaign scope
does not match an event without `campaign_brief_ids`, such as one from before this slice; it fails closed.

## What this changes for PAIGE

`automation_set_state` switching an unscoped form process to `live` is refused by the guard. PAIGE reports the
failure, and the process stays as it was. Asking the owner which form or campaign, then setting the scope, is the
Chat work in slice 6c.

## Proof

`supabase/tests/process_scope_and_action_truth.sql`, in `database-contract`, rolled back:
- The event names a form's live campaign and not an archived one, and a form in no campaign names none.
- An unscoped form process cannot go live by update or insert. Other triggers are untouched.
- The owner/admin sets a form, a campaign, or several forms (each stored once). Each replaces the last, and
  other conditions are kept.
- Refusals:
  - another workspace's form, campaign or process;
  - a malformed id or an empty list;
  - a form and a campaign together;
  - a process on another trigger;
  - a member;
  - direct writes giving two scopes, naming a foreign form, or dropping the scope of a live process.
- Every scope change is audited once.

Run locally against a stub, the proof fails when each guard is mutated:
- the archived-campaign filter;
- the payload list;
- the live rule;
- the foreign form and foreign campaign checks;
- the single-scope rule;
- the replacement of an earlier scope;
- the admin gate;
- the trigger check;
- de-duplication;
- the audit.

`src/__tests__/process-scope-and-action-truth.test.ts` runs the dispatcher's own `evaluateConditions` over each
scope shape: a form, several forms, a campaign, an event without the campaign list, and a scope combined with
another condition. It also keeps the static contract.
