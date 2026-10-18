# Customer Portal — Progress (E09 Slice 3)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: actor-goal flows mapped before edit — owner adds work for a client and shares chosen items, owner sees exactly what the client will see, client sees how far along they are and what is next, client sees nothing that was not shared; first use (nothing shared), all done, past due, cancelled, refused share, stale version, client not yet joined, multi-business and identity-switch states included.
PAIGE_UI_DESIGN: PASS: Impeccable SKILL.md and reference/craft-floor.md read before each of three critiques; every P1/P2 raised (no "next" for the client, owner not seeing the client's words, success copy contradicting the not-joined banner, tile layouts and icons, 36px/42px phone targets, phone rows, refresh-failed wording, Done past the cutoff, cancelled row with a live switch, creator not saying work stays private) was fixed and re-rendered. Single critic per round, not Impeccable's two-assessment critique; detector run on the changed files only.
MATERIAL_FLOW_CHANGE: YES: customers gain /app/progress and a Home progress tile; owners gain "Shared with {client}" and "Add work for {client}" on the Solo client record; Paige gains a confirm-gated share tool.
FLOW_PROTOTYPE: WAIVED: owner-decision=CLAUDE.md §4 pre-launch override 2026-09-05 and the owner's E09 portal decision 2026-10-17 (show only items the business shares); reason=no live customers and the owner fixed the flow; the owner reviews the live surfaces after merge.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a business's client sees what the business has shared about their work and what is next; a business owner chooses, item by item, what the client sees.
VISUAL_DIRECTION: PASS: incumbent tokens and shadcn primitives on the customer side, the Solo record stylesheet with the house Switch on the owner side; no gold in slice code, no new palette, typeface or shell.
AUTOMATED_EVIDENCE: PASS: 110 pgTAP cases (supabase/tests/customer_portal_progress.sql, registered in paige-spine-contract) plus Sessions 93 and Messages 63 pass on the local stack, and exp04_client_engagement_status passes unchanged; the full Vitest suite passes 15,927 tests with 0 failures against a base of 15,795 (the verifier's full run), and the integrator's final touched-folder run passes 1,593; every behaviour test added was confirmed to fail with its defect reinstated, including 8 plan mutants and 13 verifier mutants on the SQL.
STATIC_EVIDENCE: PASS: tsc baseline guard did not grow (10 → 10 signatures; 7 → 7 whole-tree errors); ESLint clean on the changed src files; lint:definer-fns, lint:views, lint:migration-versions, lint:tool-catalogue, lint:chat-tool-registry, lint:action-risk, lint:receipt-coverage, lint:capability-declaration and the Spine registry lint pass; the Spine review pins were renewed after a recorded source review that found the chat changes additive only. Exact-head hosted CI is required before merge.
RENDERED_EVIDENCE: PASS: harness renders with the real components, real CSS and synthetic data, network blocked (scripts/live-drive/harness/portal-progress-customer-mount and owner-shared-work). Customer: 54 frames (8 page states, Done unfolded, hover and 3 Home states in light/dark at 1440x900, 390x844, 1366x768 and 1536x770) all pass measured AA contrast (lowest 5.43 light, 7.27 dark), no overflow or clipped text, no gold on the page, 44px phone targets, nothing unshared or private visible. Owner: 46 frames (13 states) pass (lowest 5.37), gold none, 44px targets including the creator sheet's Close. The shared nav's gold active item and 3.59:1 dark inactive items are pre-existing and filed separately. Frames were viewed by the integrator, the renderer and the design critic.
BEHAVIORAL_EVIDENCE: PASS: component tests drive share, unshare, the re-read before success, ITEM_CHANGED re-read, every refusal code, the not-joined copy, the creator's client chip and contactId, the progress read's exact-key refusal, business pin and identity reset, Next up ordering and the Home tile states; pgTAP drives the writer as owner, plain member, member with a global admin role, other business, agency, God and customer, and the reader as customer, other customer, other business, staff and anonymous; the chat tool's forged tenant is ignored.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated owner share and no authenticated customer read were driven on production; owed after merge with a test client linked to a shared item.
KEYBOARD_FOCUS: PASS: the share switch and filter are keyboard operable with indigo focus rings; Done is a disclosure with aria-expanded; the creator sheet returns focus on close. Physical assistive technology untested.
ZOOM_REFLOW: PASS: 390px frames reflow without horizontal overflow; browser 400% zoom not exercised.
REDUCED_MOTION: PASS: skeletons carry motion-reduce:animate-none; switches and disclosures have reduced-motion fallbacks.
STATE_COVERAGE: PASS: customer: loading, nothing shared, populated, past due, all done, more than 100 open, refresh failed with the list kept, unavailable, more than one business; owner: loading, empty with Add work, populated, pending, confirmed (joined and not joined), ITEM_CHANGED, refused, error, filter private, cancelled.
TRUTHFUL_STATE_LABELS: PASS: a share shows as done only after a fresh read shows it; the owner sees the client's exact words; a client who has not joined is told so; a failed read is never shown as zero.
SOLO_UI: YES: "Shared with {client}" lives on the shared Solo client record for every eligible Solo business behind the existing client_standing gate; no account-specific path.
SOLO_1536X770_PAIGE_CLOSED: PASS: e09-shared-populated light/dark wide-1536x770 pass every section check.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: the owner harness mounts the record without the PAIGE dock; owed to an authenticated Solo drive with PAIGE open.
SOLO_1366X768_PAIGE_CLOSED: PASS: e09-shared-populated light/dark laptop-1366x768 pass every section check.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: the owner harness mounts the record without the PAIGE dock; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
UNVERIFIED: authenticated owner share and customer read on production; the chat approval card for the share tool; the record at 1024 and 900 widths and with PAIGE open; screen reader; browser 400% zoom; the writer's profile lock under real concurrency.

OWNER_INTENT: A client sees the work the business chose to share with them and what is next; the business decides item by item and knows exactly what the client will see.
MUST_NOT_HAPPEN: No unshared, cancelled, reminder, other-client or other-business item reaches a client; no internal note, priority, assignee or staff identity reaches a client; no share by a plain member, another business or an agency; no share applied from a stale view; a cancelled item never reappears to the client without a new share; no completion control for the client.
MUST_PRESERVE: Customer action items /app/actions and Mark complete, the work creator without a client, ClientStanding, Slice 2's Next session tile and Book a session, Operations work flows.
ACCEPTANCE_CRITERIA: An owner adds work for a client, shares two items and sees "Jordan sees: …" on each; the client opens Progress and sees exactly those two with the right state and due date, past-due first in Next up; unsharing removes an item from the client's view.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: plan_item_set_client_share and client_portal_progress are SECURITY DEFINER with in-body scope (§59); plan_items keeps no direct write grant (plan_items_no_write); the client_share CHECK and trigger guard every writer; list_tool_autonomy is wrapped, never forked.

INTERNAL_BUILD_IDENTITY: 16f77e04734a52ee2de05e84bbb585dea782128f; deployment=NOT_DEPLOYED; environment=local; migrations=PROOF_OWED(20271110030000 persisted apply on production after merge); edge=PROOF_OWED(paige-ai-chat deploy readback after merge); evidence=supabase/tests/customer_portal_progress.sql
RELEASE_CHANNEL: development: draft PR; production deployment, migration persisted-apply and edge readback are verified after merge.
RELEASE_CLASSIFICATION: internal-only: third slice of the Customer Portal; no customer release until all seven pillars and authenticated proof exist.
CUSTOMER_RELEASE_IDENTITY: none: pre-launch; no customer release named until the seven pillars and authenticated proof exist.
RELEASE_NOTE_REQUIRED: NO: pre-launch internal increment.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local automated, database and harness-rendered proof; authenticated runtime proof owed.
RELEASE_RECOVERY: position=forward-fix — the migration is additive (two nullable columns, a CHECK, a partial index, a trigger, two RPCs, a restated read with added fields, a catalogue wrap and a narrower column grant on paige_customer_actions); reference=supabase/migrations/20271110030000_e09_customer_portal_progress.sql

## §58 call-outs

Nothing previously shipped is removed for anyone who used it. Customers lose table-level SELECT on two `paige_customer_actions` columns (`initiated_by_admin_id`, `payload_json`) and anon loses SELECT on the table; no reader used them (inventory in the PR). The broken "Your next steps" count on the customer Home (it queried a `tasks.assigned_to` column that does not exist, so it was always empty) now counts open action items. The shared sheet's Close button becomes a 44×44 box at top-1/right-1 on every sheet; the icon moves by about 2px.

## Known limits

- Sub-account and Enterprise businesses can share through the server but have no screen (D1).
- Sharing from Paige needs the item id from `plan_list`; the client-status summary lists counts only.
- A cancel-driven unshare writes no `plan_item.client_unshare` audit row; the cancellation itself is the recorded act.
