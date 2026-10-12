# INT-298 / INT-342 MBC 5 — the Marketing Action contract

SHELL: SOLO. Coordinator command "Marketing Backend Completion & Analytics Ownership" (owner-authorized
2026-10-10; INT-298, INT-342, Linear ANT-15), §4 M-A1, slice 5 of 6. Plan:
`docs/product/int342-marketing-convergence.md` §L.

Strategy → Campaign → Tactic → **Marketing Action** → Execution → Outcome → Learning.

## Where each part already lived (grounding)

| Part | Canonical home before this slice | Source |
|---|---|---|
| Strategy / mission | `business_missions` (title, lifecycle) | 20260905221203 |
| Campaign | `campaign_briefs` (objective, audience, offer, lifecycle); `mission_id` is a bare uuid the brief writer does not set | 20261225000000 |
| Tactic | none as a record ("tactic" was a UI label only; doctrine §67 makes a repeatable tactic a process) | `src/solo/campaign-desk.tsx`, CLAUDE.md §67 |
| Action and its kind | `paige_actions` + `paige_action_kinds`, moved only by `file_action`, `advance_action`, the approval trigger and the workflow-run trigger | 20260711140000, 20260714092000, 20260804140000 |
| Durable work | `paige_durable_work`, joined through `paige_workflow_runs.work_id` | 20270417000000 |
| Assets | `campaign_brief_asset_links` (MBC 3) and `paige_social_posts.campaign_brief_id` | 20271020000010 |
| Metrics | the INT-340 issuer and Marketing's `marketing.*` keys (MBC 2a) | 20270602000503 |

Searched migrations, functions and `src/` for `campaign_brief_id`, `brief_id`, `tactic` and `expected_result`
on the action bus: no action could name its campaign, its tactic, the result it was meant to produce, or what
happened afterwards. That is the gap, and it is the whole gap: everything else an action needs already exists
on the bus.

## The contract

Migration `20271021200000_int298_campaign_brief_actions.sql`.

**The action is the bus's own row.** A Marketing Action is a `paige_actions` row. This slice adds one link,
`campaign_brief_actions`, holding only what the bus cannot: the campaign (`brief_id`), the tactic (a short
name, and optionally the §67 process it runs as), the action family, a dependency on another step of the
same campaign, the expected result, the observed outcome and its evaluation. It has no status of its own. One
action serves one campaign.

| The coordinator's field | Where it comes from |
|---|---|
| Parent strategy / campaign / tactic | `business_missions` via the brief · `brief_id` · `tactic`, `automation_id` |
| Objective, audience / offer | the brief's `objective`, `audience`, `offer_id` |
| Action family | `family`: email, social, page, form, funnel, content, ads, event, outreach, sales_handoff, other |
| Authorized capabilities | the action's kind and its executor (`record_only`, `workflow`, …); execution stays with the bus and its owners |
| Lifecycle | derived on read from the action's status (below) |
| Role / agent ownership | the action's `to_department`, assigned specialist and assigned person |
| Scheduling / dependency | the action's `due_at`; `depends_on_action_id` within the campaign |
| Risk and approval | the action's autonomy lane, its kind's `requires_approval`, its approval |
| Source evidence | the workflow run and its durable work; what a finish rests on (`evidence.basis`) |
| Expected result | `expected_result`: a summary, optionally a metric key and target |
| Actual verified result | the action's own result and status; `observed_result` and `evaluation` once recorded |

### Lifecycle (derived, never stored)

| The bus says | Lifecycle |
|---|---|
| `filed`, `assigned` | planned |
| `drafting`, `drafted` | prepared |
| `pending_approval` | approval_required |
| `approved`, due time ahead | scheduled |
| `approved` | approved |
| `executing`, and its run's durable work is `outcome_unknown` | unknown |
| `executing` | executing |
| `done`, with a workflow run or an approval behind it | completed |
| `done`, with neither | recorded (moved to done without proof that it was carried out) |
| `failed` | failed |
| `blocked` | blocked |
| `dismissed`, `expired` | stopped |
| an outcome recorded, over a proven finish or a failure | outcome_observed |
| an evaluation recorded, over a proven finish or a failure | evaluated |

Since MBC 6a (migration `20271022100000`) a step that is only `recorded` takes no outcome
(`CAMPAIGN_ACTION_NOT_PROVEN`), and the read never shows an outcome or evaluation over one, however its row was
written: a recorded step cannot read as an evaluated success.

`evidence.basis` says what a completion rests on: `workflow_run` (a run the action started), `approval` (the
owner approved a record-only step) or `recorded` (the bus recorded it). A campaign is never shown as running
because its brief says `active`, and an action is never completed because text was generated for it.

### Writes

Only through `configure_campaign_brief_actions(_tenant_id, _command, _idempotency_key, _actor_kind)`, modelled
on the brief's other writers: tenant re-resolved from auth (§9/§59), owner or admin seat (§53), the brief's own
idempotency ledger, audited.

- `plan_action` files a new action of kind `marketing.campaign_action` through the bus's own `file_action`,
  asking for `confirm` whatever the kind's default. The kind is record-only, needs approval and has no
  drafting specialist, so the action-bus worker never drafts it and planning drafts, sends and publishes
  nothing. From there the step moves only through the bus: when it is prepared (`advance_action` to
  `drafted`) the bus opens its approval, and approving it records the step. `advance_action` can also move a
  step on without an approval; the read then says so (`recorded`, below) rather than calling it completed.
  `file_action` keeps its own checks (kind available, the caller's global admin or coach role, the
  archived-workspace guard) and its own audit. The membership sync gives every active tenant owner and
  admin that global role (`map_tenant_role_to_app_role`); on production on 2026-10-12, 9 of 9 held it.
- `link_action` adds an action that already exists in the workspace, so a step Paige filed for a real
  execution path shows its true lifecycle under the campaign. Linking what is linked says so; an action linked
  to another campaign is refused.
- `unlink_action` removes the link and clears any dependency on it; the action itself is unchanged.
- `record_outcome` is accepted only once the action has finished (`done` or `failed`) and not yet evaluated.
- `evaluate_outcome` (`met`, `partly_met`, `not_met`, optional note) is accepted only after an outcome.

An outcome and an evaluation each record who made them (`human` or `paige`). They are statements, never
measured figures; a metric key on them names where the figure lives, it does not create one.

There is no send, publish, approve or advance command here: those stay with the bus, Approvals and the owning
department.

### Integrity

A trigger checks every insert and update, whoever writes: the brief (not archived), the action, the process
and the dependency all belong to the link's workspace; a dependency is part of the same campaign; a link never
moves to another campaign, workspace or action. On an update only a changed process or dependency is
re-checked, so deleting a process or an action (its link's `ON DELETE SET NULL`) is never refused because the
campaign has since been archived. Every foreign key leads an index. Direct writes from the browser have no
grant. The table is
registered `delete` for account retirement, like the briefs.

### Read

`get_campaign_brief_actions(_tenant_id, _brief_id default null)` returns each non-archived campaign with its
strategy (mission title and state, when the mission is in this workspace), and each linked action with its
lifecycle, family, tactic, approval, owner, due time, dependency (and whether it is still waiting on it),
expected result, outcome, evaluation and evidence. A member, who cannot read the action bus, sees the plan and
lifecycle without titles, summaries, approval ids or errors, and cannot change anything.

## Admission (MBC 6a)

Marketing admits the caller on the tenant policy: `is_tenant_admin` of the workspace resolved from auth. The
action bus keeps its own authority unchanged: `file_action` additionally requires the global admin or coach
role, which the membership sync gives every active owner and admin. If the bus ever refuses a caller Marketing
admitted, the writer reports `CAMPAIGN_ACTION_BUS_REFUSED` (42501), never the bus's raw error and never a planned
step. Bringing `file_action` onto the tenant policy is the bus owner's change, not Marketing's.

Two concurrent links of one action to the same campaign now answer `already_linked`; to another campaign,
`CAMPAIGN_ACTION_IN_OTHER_CAMPAIGN`.

## Other consumers (§37)

The Trust Compass (`useSoloTrust`, `useCompass`, `useAgencyCompass`) counts enabled `paige_action_kinds` by
department and lane, so Marketing now shows a second act, "Carry out a campaign step" at `confirm`; its
derived level is unchanged (every Marketing act is `confirm`). The chat `file_action` tool can file this kind
without a campaign link; such an action simply has no campaign until it is linked.

## Not in this slice

- A Campaigns dossier view of the actions (slice 6b).
- Chat/Live tools over `plan_action` and the read (slice 6c, with INT-346 gating for effectful paths).
- Writing `campaign_briefs.mission_id`: the brief writer still does not set it, so the strategy shows only
  where a mission is already attached.

## Proof

`supabase/tests/campaign_brief_actions.sql`, in the `database-contract` job on the production-schema clone,
rolled back: planning files a real bus row at `confirm` even when the kind's default is `auto`, for an admin
and for a tenant owner, each named on the row; replay and key
conflict; every bus status maps to its lifecycle, including `unknown` from a run's durable work; evidence
basis, and `recorded` for a step done with neither a run nor an approval; the strategy; outcomes only after a finish and evaluation only after an outcome; dependencies within
one campaign, kept honest on unlink; refusals for another workspace's action, campaign or process, an archived
campaign, bad input and a send command; the server role cannot move a link or link across workspaces; a member
reads without titles and cannot write; deleting a process or an action after its campaign is archived leaves
the links behind cleanly; every write audited and in the ledger once.

Run locally against a stub schema with the real `file_action`, each guard mutated: dropping the requested
`confirm`, the admin gate, the finish check, `scheduled`, `unknown`, member redaction, the cross-workspace
action, process and dependency checks, link immutability, the unlink dependency clear, the evaluated lock,
the evidence basis, `recorded`, the update-only re-check, the strategy join, the verdict check or the audit
each fails the proof.

`src/__tests__/campaign-brief-actions.test.ts` keeps the static contract.
