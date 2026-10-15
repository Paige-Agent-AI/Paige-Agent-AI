# ANT-21 — native CRM acknowledgement and uncertain recovery

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: ordinary owner request -> existing CRM stored-command approval -> caller-JWT crm-command -> authoritative native result -> canonical outcome/receipt -> truthful Chat reply; uncertainty holds successor writes
PAIGE_UI_DESIGN: PASS: existing Chat approval, failure and unconfirmed states retained; project UI/protected-behavior guidance applied
MATERIAL_FLOW_CHANGE: NO: repair existing native outcome and recovery semantics only
FLOW_PROTOTYPE: NOT_REQUIRED: no new step, control, destination, layout or permission
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: all eligible current/future SOLO owners can distinguish a confirmed native CRM result from an unanswered action and avoid duplicate work
VISUAL_DIRECTION: PASS: existing shared Chat components and domain destinations
AUTOMATED_EVIDENCE: PASS: actual outcome statements reproduce10 failures among28 initial cases;30 current cases plus151 neighboring native/approval/receipt tests; four complete-handler modes. Final review correction requires refreshed validation
STATIC_EVIDENCE: UNVERIFIED: protected source review, any necessary narrowly scoped pin renewal and exact-head CI remain required
RENDERED_EVIDENCE: UNVERIFIED: authenticated changed-outcome card rendering remains blocked by INT346 secure activation
BEHAVIORAL_EVIDENCE: PASS: actual canonical CRM response statements and full handler against protected native-door doubles; no real provider or customer action
AUTHENTICATED_RUNTIME: UNVERIFIED: both ordinary sessions available, but positive CRM execution requires cessation, governed activation and protected paired business-record/receipt testing
KEYBOARD_FOCUS: UNVERIFIED: no focus/control implementation change; changed-card authenticated proof owed
ZOOM_REFLOW: UNVERIFIED: no geometry change; changed-result browser proof owed
REDUCED_MOTION: NOT_APPLICABLE: no motion introduced
STATE_COVERAGE: PASS: native success, native refusal, exact proposal, gateway refusal, timeout/server loss, empty/malformed envelope, contradictory ok/error, native uncertainty, successor held, native details retained
TRUTHFUL_STATE_LABELS: PASS: success requires explicit native ok=true; missing/contradictory acknowledgement is unknown and cannot claim non-application; logged activity is not an external message
SOLO_UI: NO: shared backend binding used by existing SOLO Chat, no frontend geometry/control changes
UNVERIFIED: final source review/pins/CI, production source readback, native positive business records, paired isolation and owner final acceptance
OWNER_INTENT: restore all18 historical capabilities and all50 parity rows through the existing platform; reference accounts never become product-specific conditions
EXPERIENCE_CONTRACT: PASS: retain CRM authorization, exact stored approvals, native idempotency and receipts; report truthful outcomes and safe recovery
PROTECTED_SEAMS: PASS: caller JWT/actor/workspace and native writers unchanged; current request shares the incumbent uncertainty brake; no provider, subscription, role, credential or admission mutation
INTERNAL_BUILD_IDENTITY: development source freeze recorded at exact final PR head; migrations=NOT_APPLICABLE; edge=PROOF_OWED
RELEASE_CHANNEL: development: isolated protected source proof only
RELEASE_CLASSIFICATION: internal-only: bounded CRM outcome restoration
CUSTOMER_RELEASE_IDENTITY: none: complete restored customer outcome not yet proven
RELEASE_NOTE_REQUIRED: no: no customer publication decision
RELEASE_TRUTH_BOUNDARY: PROOF OWED: real protected domain records, complete customer action/receipt/replay/isolation and owner acceptance
RELEASE_RECOVERY: retain inactive INT346 admission; guarded source forward fix/revert and native original-operation readback, never blind re-execution

The previous binding took an error-free response without `ok:false` as success. Null, array, primitive and malformed objects therefore became success. Its failure-body spread could override the local success=false or retain an unsupported not_applied=true. An error carrying ok=true also misreported non-application. Initial actual-source regression reproduced10 failures. The first correction exposed the spread override; the complete-handler negative then exposed a missing current-request successor brake. These failures are retained, not reclassified as test success.

Only native outcome interpretation changes. Require ok=true for success; preserve native failure details but keep the binding's failure/absence classification authoritative. Reuse invokeOutcomeUnknown and OUTCOME_UNKNOWN_NOTE, the existing requestExecutionState brake, canonical terminal settlement and receipt projection. Current-request unknown CRM writes prevent successor mutation; known refusal does not. No native command, stored proposal, original key, authorization, action-risk, confirmation, SQL, RLS or provider is changed.

Separate author review of2e01b847b found a remaining contradictory pre-dispatch flag in a malformed envelope. The new30th actual-statement case failed first: unknown cannot preserve refused_before_run=true. Clear that unsupported claim alongside not_applied=false; the full-handler malformed fixture now carries both contradictory flags. This is an accepted review finding, with final-head review/validation required after correction. No non-author identity is claimed.

`src/__tests__/crm-chat-acknowledgement.test.ts` selects the single real CRM branch by AST and executes its response statements. Its malformed responses cannot claim success or non-application; native successes, refusals, proposal identity, failure details and internal-activity semantics remain. The incumbent error-forwarding source assertion still requires spreading the whole native failure; only the order changes to keep success=false authoritative. The full-handler modes verify caller JWT, exactly one native CRM invocation, canonical effect/settlement and no successor effect or audit after uncertainty. No source-only fixture is customer execution proof.

Source ownership remains Contact/Company/Task/Pipeline for native systems; this BUG lead's bounded restoration lease covers only shared Chat bindings. Existing Spine keys and native CRM replay/Rail remain. Surface paige.workspace stays PARTIAL; clients.people remains UNAVAILABLE in the binding ledger, not promoted by this patch. Integration family crm_calendar_communications records these contacts/pipeline as native. No email-provider migration is involved. Impeccable checks: truthful saved/refused/unconfirmed states preserved; unchanged geometry, keyboard implementation, motion and tokens. Changed-state authenticated finish review remains owed.
