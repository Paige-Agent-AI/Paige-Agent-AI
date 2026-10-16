# Pipeline readback after Chat completion

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: ordinary SOLO Chat approved deal/contact change -> native record and Rail -> existing turn-settled event -> current-tenant canonical pipeline reader -> updated Sales board
PAIGE_UI_DESIGN: PASS: retain existing Sales list/board, reader, realtime subscription, completion event and coalescing timer; no new destination, controls or visual design
MATERIAL_FLOW_CHANGE: NO: restore already intended automatic readback after an accepted Chat request
FLOW_PROTOTYPE: NOT_REQUIRED: no new interaction, geometry, navigation or visual states
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: every eligible existing/future SOLO customer sees current pipeline records after Chat settles without a manual browser reload
VISUAL_DIRECTION: NOT_APPLICABLE: existing Sales presentation unchanged
AUTOMATED_EVIDENCE: PASS: actual-hook failing-first 2 PASS / 3 FAIL; corrected 5/5 hook cases and 23/23 assertions across four existing hook/realtime/route/delete suites
STATIC_EVIDENCE: PASS: reuse existing paige:turn-settled producer and get_pipeline_workspace reader; scoped event listener is retired with the existing tenant-keyed effect
RENDERED_EVIDENCE: UNVERIFIED: no new visual rendering or viewport claim; existing route tests exercise unchanged Sales rendering
BEHAVIORAL_EVIDENCE: PASS: completion without realtime, burst coalescing, canonical contact readback, old-workspace event/timer retirement, no selected/resolving identity, unmount cleanup and refused current read
AUTHENTICATED_RUNTIME: PROOF_OWED: source correction not deployed; protected ordinary production QA proved native association and receipt while the board stayed stale until reload, then showed the correct association
KEYBOARD_FOCUS: NOT_APPLICABLE: no control/focus changes
ZOOM_REFLOW: NOT_APPLICABLE: no geometry changes
REDUCED_MOTION: NOT_APPLICABLE: no animation changes
STATE_COVERAGE: PASS: ready, completion, delayed/coalesced read, workspace change, resolving/missing identity, read refusal and teardown; no optimistic success projection
TRUTHFUL_STATE_LABELS: PASS: the notification triggers a canonical authorized read only; its payload cannot select a workspace, write data, grant access or certify an action
SOLO_UI: NO: shared data-hook correction only, no account-specific behavior or visual alteration
UNVERIFIED: distinct final review, exact-head hosted CI, production web identity, ordinary no-reload positive/negative QA, cross-device realtime restoration, Live and owner acceptance
OWNER_INTENT: after PAIGE changes a deal in Chat, Sales must show the actual saved result without requiring the owner to refresh the browser
MUST_NOT_HAPPEN: stale previous-tenant data, effect execution from an event, duplicated business writes, a second cache/event bus/poller, or a claimed successful update when its canonical read is refused
MUST_PRESERVE: existing actor/tenant/role authorization, canonical reader/writer, realtime channel lifecycle, 200ms coalescing, current-load disposal fence and existing Sales layout
ACCEPTANCE_CRITERIA: Chat completion refetches current authorized pipeline truth once per burst; retired workspace/unmounted listeners cannot refresh old data; resolving/missing identity does not read; refusal does not preserve a successful-looking pipeline
PROTECTED_SEAMS: existing pipeline reader and lifecycle only; no Chat/Spine/Harness/Rail/SQL/provider/activation or permission edits
INTERNAL_BUILD_IDENTITY: base=c87735e28391dbb88466621bbc28ca6ad80c7398; candidate=commit containing this record; branch=fix/ant21-pipeline-chat-refresh; deployment=NOT_APPLICABLE; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/ant21-pipeline-chat-refresh.md
RELEASE_CHANNEL: development: production-target internal correctness repair
RELEASE_CLASSIFICATION: internal-only: shared pipeline current-read restoration
CUSTOMER_RELEASE_IDENTITY: none: no customer version or publication
RELEASE_NOTE_REQUIRED: no: report the bounded verified outcome to the owner after release
RELEASE_TRUTH_BOUNDARY: PROOF OWED: exact-head review/CI, production web readback and authenticated no-reload behavior; no all-account manual test or full18/50/Live claim
RELEASE_RECOVERY: position=ordinary reviewed forward correction; reference=src/solo/useSoloCampaigns.ts; canonical records remain unchanged

## Reproduction and cause

Protected ordinary-owner Chat in production created separate zero-value QA deals and linked each to its own QA contact. Canonical records, CRM command results, capability Rails, issued FINAL turns and Chat reload agree. On the open Sales board the contact still appeared unavailable/unlinked after the successful association; browser reload displayed the saved association. This is a display refresh failure, not evidence that the native write failed.

Read-only production `pg_publication_tables` inspection returned no publication for `deals`, `pipelines` or `pipeline_stages`. The existing tenant-keyed realtime subscription therefore cannot supply these changes in this observed configuration. The hook also had no listener for the existing `paige:turn-settled` event that Chat already emits after an accepted request settles. This source correction attaches that event to the same coalesced canonical reload used by realtime and removes it on the same cleanup. It does not change publication configuration or promise cross-device realtime delivery.

No event data is trusted as a record, selected workspace, authorization, receipt or outcome. The current tenant and identity still come from the existing tenant context; the existing reader evaluates its permissions and the existing load fence rejects retired results. Failed/refused reads retain the established error state. No optimistic patch, business mutation, provider request, polling loop, second cache or new event system is introduced.

## Tests and limits

The incumbent actual-hook Sales-scope fixture was extended, retaining its original Marketing-independence and failed-read checks. Before implementation, three new assertions failed because completion never reloaded. The two existing/identity-negative cases passed. After the two lifecycle bindings were added, all five actual-hook cases passed. Existing pipeline realtime source controls, Sales List/Board route tests and native-delete adapter tests also pass: four files, 23 assertions, zero failures.

The tests exercise real React effects and the unchanged data-hook code with protected tenant-context/Supabase ports. They prove no production Auth/JWT/RLS, native business effect, cross-device delivery or UI viewport claim. The QA reproduction and saved association remain protected evidence; no actual customer identities or raw account records enter committed fixtures.

Independent final review, required exact-head CI, web deployment/aliases and ordinary same-session no-reload verification follow. The existing Master Shipped Delivery Log receives the observed release identity in its normal closeout; no duplicate registry or customer announcement is created.
