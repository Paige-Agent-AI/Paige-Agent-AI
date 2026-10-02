# UI delivery evidence: the realtime pipeline board

Production grounding (2026-09-30, owner live report): a deal Paige created appeared only
after a manual page refresh. The board's data hook owned one canonical fetch and nothing
told it a governed change had landed. This repair adds one tenant-keyed realtime
subscription over the same records that fetch reads — deals, pipelines and their stages —
whose events and (re)subscriptions resolve through the existing canonical reload. No
second cache, no polling loop, no event bus: every notification is a full reload of
current truth under whatever tenant is active.

UI_DELIVERY_EVIDENCE_VERSION: 1
SOLO_UI: YES: the recognized UI data map src/solo/useSoloCampaigns.ts changed; no rendered component, layout, copy or control changed
FLOW_BY_FLOW: WAIVED: owner-decision=INT-083 go-live ruling 2026-09-20; reason=the Flow-by-Flow skill is not installed at the account level in this environment, whose account-level skill directory holds impeccable alone, so a flow-by-flow pass is genuinely unavailable here; the affected surface is grounded from source in STATIC_EVIDENCE
PAIGE_UI_DESIGN: PASS: the repository paige-ui-design skill body and its routed references were read completely; the board's presentation, cards, columns and tokens are unchanged — only the freshness of the data behind them
IMPECCABLE: PASS: the installed Impeccable skill and its craft floor were read; no visual artifact is in scope
MATERIAL_FLOW_CHANGE: NO: no user goal, step, state, transition, confirmation, exit or side effect changes; the same board shows the same records sooner
FLOW_PROTOTYPE: NOT_REQUIRED: bounded data-freshness addition behind an unchanged surface and flow
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner watching the pipeline board sees a deal Paige created, moved or archived appear without refreshing
VISUAL_DIRECTION: PASS: existing board presentation, tokens and layout unchanged
AUTOMATED_EVIDENCE: PASS: the suite failed 4 of 5 on unchanged main and passes 5 of 5; removing the channel teardown turns its pin red (mutate-run-restore); the delete suite carries two new behavioral lifecycle tests — the tenant-keyed channel exists while mounted and is removed on unmount — and passes 8 of 8
STATIC_EVIDENCE: PASS: one channel keyed solo-pipeline-board plus the tenant id subscribes to deals, pipelines and pipeline_stages filtered tenant_id eq the active tenant; events and a SUBSCRIBED status resolve through the existing retry reload; the effect keys on tenant and loading identity so a workspace switch tears the old channel down before a new one opens; a late event can only trigger a reload scoped to the current tenant, so the previous workspace cannot mutate the new board; TypeScript reports zero errors in touched files
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered surface changed; the existing board presents fresher data
BEHAVIORAL_EVIDENCE: PASS: the component harness proves the channel lifecycle — created tenant-keyed while mounted, removed on unmount — against a recording stub
AUTHENTICATED_RUNTIME: UNVERIFIED: the remaining behavior is a deal created by Paige appearing on the live board without refresh under a real session, owed after merge
KEYBOARD_FOCUS: NOT_APPLICABLE: no control or focus path changed
ZOOM_REFLOW: NOT_APPLICABLE: no layout, content geometry or responsive behavior changed
REDUCED_MOTION: NOT_APPLICABLE: no motion or reduced-motion behavior changed
STATE_COVERAGE: PASS: covered states are event-then-reload, reconnect-then-reload (SUBSCRIBED refetches current truth), workspace switch (old channel removed, new channel keyed to the new tenant), unmount teardown, and a late pre-teardown event (guarded by the disposed flag and re-scoped by the canonical reload)
TRUTHFUL_STATE_LABELS: PASS: no visible label changed; the board never renders patched or partial state — every notification reads a full reload of canonical records
UNVERIFIED: the deployed bundle identity and one authenticated Paige-created deal appearing on the live board without refresh remain unverified until post-merge production acceptance
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed; the existing board presents fresher data
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed; the existing board presents fresher data
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed; the existing board presents fresher data
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed; the existing board presents fresher data
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed; the existing board presents fresher data
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed; the existing board presents fresher data
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed; the existing board presents fresher data
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed; the existing board presents fresher data
OWNER_INTENT: the pipeline board reflects governed deal changes in real time without a manual refresh, per the repair-train assignment stage 3
MUST_NOT_HAPPEN: no polling loop, event bus, websocket service or second deal cache; no cross-tenant leakage; no patched partial state on the board; no customer content in committed evidence
MUST_PRESERVE: the canonical board fetch and its records; the existing board presentation and wording; tenant scoping and account-switch safety of every existing surface consuming the hook
ACCEPTANCE_CRITERIA: a deal created, updated, moved or archived through an authorized path updates the active tenant board without refresh; another tenant's board does not change; no duplicate deal appears; stale events cannot overwrite fresher state; account switch rebinds the subscription safely; teardown removes the old subscription; an event after unmount or switch cannot mutate the new board
MOTION_PURPOSE: NONE: no motion was added or changed
PROTECTED_SEAMS: affected and tested = the board data hook's subscription lifecycle and its delete-action suite fixture; explicitly unaffected = the canonical fetch queries, pipeline actions, the governed door, approval machinery, Mind/Memory and Knowledge
RELEASE_NOTE_REQUIRED: NO: bounded data-freshness addition behind an unchanged surface
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the failing-first wiring proof, mutation proof and lifecycle behavior are proven offline; authenticated realtime appearance and deployed bundle lineage are not yet proven
RELEASE_RECOVERY: position=revert this bounded subscription if the board churns or leaks across tenants, restoring the fetch-only hook from the merge parent before any forward fix; reference=PR-REALTIME-BOARD

INTERNAL_BUILD_IDENTITY: product=8baa5f80cad14928b535988a5688c6fd45b2ca17; current-main-sync=6d411df1ebb261b9741eacfcfa5972136c25b546; base=6d411df1ebb261b9741eacfcfa5972136c25b546; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=failing-first-mutation-and-lifecycle-harness
RELEASE_CHANNEL: development: exact product-code head on the draft branch; production promotion remains merge automation only
RELEASE_CLASSIFICATION: patch: data-freshness addition behind an unchanged surface and flow
CUSTOMER_RELEASE_IDENTITY: none: no owner-approved customer release identity was assigned to this bounded repair
