# Customer Portal — Messages and Contact your team (E09 Slice 1)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: actor-goal flows mapped before edit — customer writes to their business, customer asks for help, owner reads and replies in the canonical inbox, customer sees the reply; first-use, failure, retry, refusal, multi-business and identity-switch states included.
PAIGE_UI_DESIGN: PASS: Impeccable SKILL.md, reference/craft-floor.md and reference/operate.md read before the design critique; the critique's slice findings (two competing accents, duplicate top-bar control, non-growing composer, help-request treatment both sides, blocked-state dead ends, Portal default for unjoined contacts, Portal channel icon) were fixed and re-rendered. Single critic pass, not Impeccable's two-assessment critique; detector not run.
MATERIAL_FLOW_CHANGE: YES: customers gain /app/messages, and Contact your team (?topic=help) replaces Paige platform Support and the feature board for customers; owners gain a Portal channel in the existing inbox.
FLOW_PROTOTYPE: WAIVED: owner-decision=CLAUDE.md §4 pre-launch override 2026-09-05 and the owner's E09 portal decisions 2026-10-17; reason=no live customers, and the owner fixed the flow (portal messages only, help goes to the business, platform support replaced for customers); the owner reviews the live surfaces after merge.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a business's customer sends a message or help request to that business and reads its replies; a business admin replies from the inbox the business already uses.
VISUAL_DIRECTION: PASS: incumbent tokens, shadcn primitives and tenant accent (only on the customer's own bubble and send act, contrast-checked via readableTextOn); no new palette, typeface or shell.
AUTOMATED_EVIDENCE: PASS: 388 component/hook tests across the 28 neighbouring files (src/pages/app, src/components/app, src/hooks/useClientPortal*, src/pages/admin/conversations, ClientsConversations*, Support*) pass, 1 skipped; 63 pgTAP cases (supabase/tests/customer_portal_messages.sql, registered in paige-spine-contract) pass on the local stack; every regression test added in the fix rounds was confirmed to fail against the previous code.
STATIC_EVIDENCE: PASS: tsc baseline guard did not grow (10 → 10 signatures); ESLint clean on every changed TS/TSX file; shadow-var, binding-ledger and UI-evidence linters pass. Exact-head hosted CI is required before merge.
RENDERED_EVIDENCE: PASS: harness renders with the real components, real CSS and synthetic data, network blocked (scripts/live-drive/harness/portal-messages-customer-mount and e09-portal-owner-inbox-mount). Customer: 28 frames (9 states × light/dark at 1440x900, 4 states × light/dark at 390x844, populated at 1024x768) all pass measured AA contrast, no overflow, newest message and Retry clear of the composer, no gold on the page, 44px phone targets. Owner: 24 frames (Solo matrix plus help, not-joined, error and phone) pass every portal-scope check; the remaining owner failures are pre-existing inbox issues (Sent pill 3.69:1 light, You: prefix, Solo LIVE labels, side-panel gold, name collapse, no phone layout) filed as a separate task. Frames were viewed by the integrator, a design critic and an adversarial verifier.
BEHAVIORAL_EVIDENCE: PASS: component tests drive send, Enter/Shift+Enter, coarse-pointer Enter, retry with the same request id, edit-and-resend keeping help kind, rate limit, multi-business, identity switch, owner reply success and every refusal code; pgTAP drives the RPCs as customer, staff, other-business admin and anonymous.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated customer or owner session was driven on production; QA relationship send/read/reply is owed after merge.
KEYBOARD_FOCUS: PASS: composer receives focus in help mode once usable and after send; Edit and resend returns focus to the composer; role=log with aria-live off plus a separate polite status for new incoming replies. Physical assistive technology untested.
ZOOM_REFLOW: PASS: phone 390px frames reflow without horizontal overflow and keep 44px targets on the customer page; browser 400% zoom and a real phone keyboard (AppShell's useClientViewportHeight is not reproduced by the harness) were not exercised.
REDUCED_MOTION: PASS: no new animation; spinners and skeletons carry motion-reduce:animate-none.
STATE_COVERAGE: PASS: loading, empty first use, populated, help, sending, unconfirmed, failed, rate limited, read error, no relationship, more than one business, identity switch; owner: portal thread, help request, not joined, unconfirmed reply, workspace inactive, signed out.
TRUTHFUL_STATE_LABELS: PASS: a message shows as sent only after the server returned its id; no read receipts are claimed on either side; an unconfirmed send says retrying will not duplicate it.
SOLO_UI: YES: the owner Portal channel lives in the shared Solo conversations inbox for every eligible Solo/Sub-account business; no account-specific path.
SOLO_1536X770_PAIGE_CLOSED: PASS: e09-inbox-matrix-closed light/dark: portal thread, help request and Portal composer render; portal-scope checks pass.
SOLO_1536X770_PAIGE_OPEN: PASS: e09-inbox-matrix-open light/dark: portal thread, help request and Portal composer render; portal-scope checks pass.
SOLO_1366X768_PAIGE_CLOSED: PASS: e09-inbox-matrix-closed light/dark: portal thread, help request and Portal composer render; portal-scope checks pass.
SOLO_1366X768_PAIGE_OPEN: PASS: e09-inbox-matrix-open light/dark: portal thread, help request and Portal composer render; portal-scope checks pass.
SOLO_1024X768_PAIGE_CLOSED: PASS: e09-inbox-matrix-closed light/dark: portal thread, help request and Portal composer render; portal-scope checks pass.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: the harness PAIGE dock is a placeholder that covers the composer's Send and the right panel at this width, so the docked inbox layout is owed to an authenticated Solo drive; the portal-scope element checks in e09-inbox-matrix-open light/dark pass.
SOLO_900X1000_PAIGE_CLOSED: PASS: e09-inbox-matrix-closed light/dark: portal thread, help request and Portal composer render; portal-scope checks pass.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: the harness PAIGE dock is a placeholder that covers the composer's Send and the right panel at this width, so the docked inbox layout is owed to an authenticated Solo drive; the portal-scope element checks in e09-inbox-matrix-open light/dark pass.
UNVERIFIED: authenticated customer and owner send/read/reply on production; physical Safari/iOS keyboard behaviour; screen reader; browser 400% zoom; the owner inbox's phone layout (pre-existing, separate task).

OWNER_INTENT: A customer can talk to the business they are a customer of, inside that business's portal, and ask that business for help; the business answers from its own inbox.
MUST_NOT_HAPPEN: No email/SMS history shown to customers, no provider send for a portal message, no cross-business read or reply, no staff identity or email exposed to customers, no duplicate on retry, no read receipt claims, no finance categories in platform support defaults.
MUST_PRESERVE: Platform Support for staff/owners without a customer relationship, existing email/SMS inbox behavior, the customer AppShell and Solo shell, invitation and resource flows.
ACCEPTANCE_CRITERIA: Customer sends, owner sees it in the contact's thread and replies on Portal, customer sees the reply and a notification; help requests arrive titled Help request; refusals explain themselves.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: client_portal_send_message / client_portal_conversation / comms_portal_reply are SECURITY DEFINER with in-body scope (§59); messages_portal_shape CHECK and the request-id unique index enforce the channel's shape.

INTERNAL_BUILD_IDENTITY: d497c52077f6936c8afcbbd09d532bed5c0b9e1b; deployment=NOT_DEPLOYED; environment=local; migrations=PROOF_OWED(20271110010000 persisted apply on production after merge); edge=NOT_APPLICABLE; evidence=supabase/tests/customer_portal_messages.sql
RELEASE_CHANNEL: development: draft PR #2320; production deployment and migration persisted-apply are verified after merge.
RELEASE_CLASSIFICATION: internal-only: first slice of the Customer Portal communications pillar; no customer release until all seven pillars and authenticated proof exist.
CUSTOMER_RELEASE_IDENTITY: none: pre-launch; no customer release named until the seven pillars and authenticated proof exist.
RELEASE_NOTE_REQUIRED: NO: pre-launch internal increment.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local automated and database proof; rendered and authenticated runtime proof owed.
RELEASE_RECOVERY: position=forward-fix — the migration is additive (CHECK widening, new SECURITY DEFINER functions, a unique index on portal rows) and the UI routes revert with the merge commit; reference=supabase/migrations/20271110010000_e09_customer_portal_messages.sql

## §58 call-outs — what customers no longer see

Customers no longer reach Paige's platform Support desk or feature board; /app/support redirects them to Contact your team. This removes a previously shipped capability for one audience, by owner decision on 2026-10-17. Production check at decision time: support_tickets has 0 rows in total and 0 from users with a customer relationship, and feature_requests has 0 from customers, so no existing ticket is stranded. Platform ticket emails still link to /app/support; for a customer that now lands on Contact your team. Staff and owners keep the desk unchanged.

Customers of exactly one business also lose the top-bar "Contact Advisor" button, which opened /app (the Paige chat home). Messages and Get help replace it as their routes to the business, and Home still opens the Paige chat. Customers of more than one business keep Contact Advisor and the platform Support desk unchanged until choosing a business ships (Slice 8).

## Migration ordering

Production applies only migrations newer than its newest recorded version. Another workstream has unapplied Calendar migrations numbered 20271109030000–20271109045000 (PR #2318 and bounded preparation). If this PR's 20271110010000 reaches production first, those files must be renamed above it before they can deploy; their integrator named that renumbering as an accepted path on this PR.
