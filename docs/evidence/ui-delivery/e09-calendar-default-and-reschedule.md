# E09: Calendar default and original session rescheduling

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: The bounded flow packet below traces customer booking, native owner projection, permitted move and reload; the owner added Monthly default and personal view preference to this same Calendar outcome on November 4.
PAIGE_UI_DESIGN: PASS: Read the repository PAIGE UI Design skill, upstream frontend guidance, accessibility checklist and five quality modules; used existing calendar controls, tokens, drawers and focus recovery. Impeccable hardening guidance applied to denied browser storage and scoped preferences.
MATERIAL_FLOW_CHANGE: YES: Month becomes the initial Calendar view; View options saves the person's default for this business/browser. Customer rescheduling now uses the same calendar default-hours parser as booking creation.
FLOW_PROTOTYPE: UNVERIFIED: Changed rendered UI and successful move must be inspected after normal release. Current production customer creation and owner readback passed, while moving an offered time reproduced the default-hours refusal. No browser proof is inferred from handler tests.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: SOLO owners see their month immediately, can temporarily switch Week/Agenda, and choose a reopening default. Ordinary customers can move their original session within the existing calendar policy.
VISUAL_DIRECTION: PASS: Preserve the original SOLO calendar composition and --pg tokens. A labeled native radio group lives in the existing View options rail/drawer; each placement has distinct radio names and hint IDs.
AUTOMATED_EVIDENCE: PASS: 140 original handler/provider-boundary tests and 105 Calendar preference/rendering/adapter tests pass locally. New positives cover missing/default calendar hours; negatives retain explicit host closure and off-hours refusal. Exact-head hosted CI remains separately required.
STATIC_EVIDENCE: PASS: Changed UI files pass eslint; same native booking writer/admission and unchanged provider gates; parser extracted without changing public-booking fallback semantics. No migration, Auth change, role or policy mutation. Local build is UNVERIFIED because the inherited shared node_modules lacks the incumbent @cloudflare/realtimekit-react-ui dependency; normal clean-install hosted CI must pass before merge.
RENDERED_EVIDENCE: UNVERIFIED: Changed Month/default control needs actual rendered desktop and narrow inspection after deployment. Private baseline screenshots are outputs/e09-booking-customer-confirmed-20261104.jpg, outputs/e09-booking-owner-created-20261104.jpg and outputs/e09-booking-reschedule-refusal-20261104.jpg.
BEHAVIORAL_EVIDENCE: UNVERIFIED: Final customer move, both-side reload, approved cancellation and saved-default reopening remain owed on the deployed revision.
AUTHENTICATED_RUNTIME: UNVERIFIED: Ordinary customer and owner separately verified initial creation/readback. Successful reschedule and changed default preference are not yet production-verified.
KEYBOARD_FOCUS: UNVERIFIED: Native radio semantics and incumbent drawer Escape/return-focus tests retained; rendered keyboard exercise still owed.
ZOOM_REFLOW: UNVERIFIED: Existing responsive rail/drawer reused; changed view control still requires rendered narrow inspection.
REDUCED_MOTION: PASS: No animation added or changed.
STATE_COVERAGE: PASS: Tests cover missing/invalid/denied preference storage, user/business isolation, temporary versus saved modes, unavailable actor, successful and refused reschedules, original customer admission, replay and conflicts. Live outcome remains separately unverified.
TRUTHFUL_STATE_LABELS: PASS: Failed preference persistence reports failure, not saved success. Booking completion remains based on original server response; no delivery, video-room or provider success is inferred.
SOLO_UI: YES: Original Clients Calendar plus existing Customer Portal Sessions.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: Rendered changed control not exercised yet.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: Rendered changed control not exercised yet.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: Rendered changed control not exercised yet.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: Rendered changed control not exercised yet.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: Rendered changed control not exercised yet.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: Rendered changed control not exercised yet.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: Rendered changed control not exercised yet.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: Rendered changed control not exercised yet.
UNVERIFIED: Final exact-head CI/review, deployment, rendered checks, successful actual move and both-side returning/cancellation readback remain owed. Full EXP09 and founder acceptance remain open.

OWNER_INTENT: Finish ONE owner-approved customer booking-to-original SOLO Calendar outcome, now including Monthly default with user-selectable default options.
MUST_NOT_HAPPEN: No second scheduler, provider/sender, booking copy, login change, lifted permission, extra test booking or silent retry after uncertain execution.
MUST_PRESERVE: Week and Agenda, original Work responsibility slot, canonical booking identity, client relationship checks, host-specific empty availability, notice/horizon/buffers/date overrides, provider floor, audit and conditional update guards.
ACCEPTANCE_CRITERIA: Original customer booking appears to original owner; a permitted move updates that same appointment; both reopen to its accurate state; normal cancellation remains visible. Calendar first opens Month, a selected default reopens correctly, temporary view changes do not overwrite it.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: Customer booking admission and original conditional native update tested; existing provider execution gate retained. Auth/Knowledge/Chat/Live/Work writers and calendar policy configuration are unaffected.
INTERNAL_BUILD_IDENTITY: development branch fix/e09-session-default-hours-20261104; deployment=not deployed; environment=development; migrations=NOT_APPLICABLE; edge=not deployed; evidence=this record and exact-head PR checks.
RELEASE_CHANNEL: development: ordinary reviewed prelaunch production release intended; no staged eligibility or activation change.
RELEASE_CLASSIFICATION: Internal Calendar reliability repair and owner-requested presentation preference.
CUSTOMER_RELEASE_IDENTITY: none: no new public version or announcement requested.
RELEASE_NOTE_REQUIRED: no: bounded prelaunch repair reported to owner and original coordination records.
RELEASE_TRUTH_BOUNDARY: PARTIAL source implementation; PROOF OWED deployment and authenticated move/default persistence. No full Experience acceptance claim.
RELEASE_RECOVERY: position=normal forward fix or revert the bounded PR; reference=original ANT-163 selected Calendar outcome and actual production record reconciliation before retry.

## Bounded flow and original contracts

- Entry: existing Portal Sessions and SOLO Clients Calendar. Original actor resolves through ordinary SDK session and `client_portal_session_change_admit`; no client use of owner-only Spine booking authority.
- Request: customer chooses an offered time and confirms once. Existing `booking-manage` rechecks current original booking and calendar rules before a conditional update; original `internal_bookings` identity and audit remain authoritative.
- Change: extract the existing public-booking calendar default normalizer into existing shared slot rules and consume it from both handlers. Host overrides keep their separate NULL-inherit / empty-closed semantics.
- Preference: a browser display preference scoped to signed-in subject and tenant. It neither resolves authorization nor changes calendar data. Missing identity disables save; invalid/unavailable storage falls back to Month and failed writes are visible.
- Native records, receipts and recovery: original booking, conditional-update/audit and original provider/communication path. Unknown outcomes require original-record reconciliation; no new scheduler, Layer C engine, ledger or provider activation.
- Ownership: E09 consumes Calendar and E03 Communications contracts. The finite parser/UI source window was sent to the existing Coordinator; no active overlapping source edit was identified. Weekly Work responsibility, protected Auth/Knowledge and peer Chat work are excluded.
- Universal scope: all eligible SOLO users receive the same display default; calendar fallback is identical for all affected calendars. No business/account-specific source branch.
- Algorithm boundary: ALG-01 original conditional/reconciled booking recovery preserved; no algorithm maturity or full capability closure inferred.
