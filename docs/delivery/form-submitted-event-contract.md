# INT-298 / INT-342 MBC 4a — `form.submitted` on the native event bus

SHELL: SOLO. Coordinator command "Marketing Backend Completion & Analytics Ownership" (owner-authorized
2026-10-11; INT-298, INT-342, Linear ANT-15), slice 4 of 6. Plan: `docs/product/int342-marketing-convergence.md`
§L.4 ("A `form.submitted` native event and §67 trigger"); `docs/delivery/harness-completion-map.md` (forms, next
phase: "promote the forms on-submit spine onto the `paige_native_events` bus as a `form_submitted` producer").

## Why

Before this slice the native event bus had one producer, `contact.created` (20270119000000). A form's own
on-submit automations ran through `growth-process-submission` and its own dispatch ledger, separate from the bus,
so a §67 process could not start from "someone fills in my form". Production's trigger catalogue held five keys
(`contact.created`, `conversation.call_ended`, `manual.run_now`, `pipeline.stage_changed`,
`record.lifecycle_moved`); searched migrations, functions and `src/` for `form.submitted` and `form_submitted`:
no producer, no row.

## The event

Migration `20271020000030_int298_form_submitted_native_event.sql`:

- **Catalogue row:** `form.submitted`, "Someone fills in a form", category `forms`, live. Paige's
  `automation_triggers_list` reads the catalogue, so it offers this trigger as soon as the row exists.
- **When it fires:** once per submission, when the submission is matched to a contact. That is either on
  insert with a contact (external intake) or when `growth-process-submission` pins one in its `contact_upsert`
  step (a form's own "create contact" intake and the legacy `auto_create_contact` fallback both run through
  that step). A submission that never names a person fires nothing, because a process has nobody to act on.
- **Producer:** `trg_growth_submission_emit_form_submitted`, `AFTER INSERT OR UPDATE OF contact_id` on
  `growth_form_submissions`. SECURITY DEFINER with a fixed search path; no app role may execute it.
- **Subject:** the contact (`clients`), as for `contact.created`, so the existing dispatcher, its subject-tenant
  integrity check and the act engine run unchanged.
- **Workspace check:** a contact that is not in the submission's workspace fires nothing.
- **Payload:** `submission_id`, `form_id`, `contact_id`, `source`, `utm_source`, `utm_campaign`,
  `funnel_session_id`, `submitted_at`. Never the form's answers, consent, IP, user agent or referrer. A process
  reads more by id, inside the workspace.
- **Once only:** the dedup key is `form.submitted:<submission id>`. A later re-pin to another contact (a merge)
  is the same submission and never a second event.
- **Outbox:** the event row is written in the same statement as the insert or the pin, and a failure is not
  swallowed; the processor's pin then fails and retries. Only the dispatch HTTP fire is best-effort, with the
  sweeper as its backstop (as `contact.created`).

The update guard (`OLD.contact_id IS NOT NULL`) and the null-contact guard are cheap early exits. The dedup key
and the workspace check already enforce the same outcomes, so removing either guard alone does not change the
result; the proof was run against both mutants and records this.

## What a process can do with it

- A tenant asks Paige for a process starting on "Someone fills in a form"; it is filed at `confirm` like any
  other (§67).
- The dispatcher evaluates a process's `conditions` against the payload, so `{field: "payload.form_id", op:
  "eq", value: <form id>}` would limit a process to one form, and `payload.utm_campaign` to one campaign tag.
- **Not yet:** no surface writes `conditions` today (Paige's `automation_create` sets none, and no screen edits
  them). Until then a process on this trigger runs for every matched form submission in the workspace. Narrowing
  to a form or campaign is slice 6 (Chat), which adds conditions to process authoring.

## Not in this slice

- Funnel session events and a public page-view producer (S4 later parts).
- Moving a form's own on-submit automations onto the bus. They keep running through `growth-process-submission`;
  this event is an addition, never a replacement, so no existing form changes behaviour.
- Nothing is sent by this migration. With no live process on the trigger, the dispatcher records the event as
  having no subscriber.

## Proof

`supabase/tests/form_submitted_native_event.sql`, in the `database-contract` job on the production-schema clone,
rolled back:

1. A submission inserted with its contact fires exactly once; the subject is that contact in its workspace; the
   payload carries the ids, source and both tags, and neither the answer text nor the email.
2. A submission with no contact fires nothing; pinning the contact fires once; a later state update and a re-pin
   to another contact never fire again.
3. A contact from another workspace fires nothing.

Run locally against a stub schema with each guard mutated: removing the workspace check, dropping the update
event, adding the answers to the payload, dropping the campaign tag, or keying dedup per contact each fails the
proof. The two early-exit guards survive alone, as above.

`src/__tests__/form-submitted-native-event.test.ts` keeps the static contract: the catalogue row, the trigger
events, the dedup key, the workspace check, the payload allowlist, no swallowed write, the revoke, the
processor's single pin, and the CI step.
