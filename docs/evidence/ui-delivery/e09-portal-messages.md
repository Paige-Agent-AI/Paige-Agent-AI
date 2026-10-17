# Customer Portal — Messages and Contact your team (E09 Slice 1)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: actor-goal flows mapped before edit — customer writes to their business, customer asks for help, owner reads and replies in the canonical inbox, customer sees the reply; first-use, failure, retry, refusal, multi-business and identity-switch states included.
PAIGE_UI_DESIGN: PASS: Impeccable craft floor applied to the customer conversation and the owner Portal composer mode; incumbent customer AppShell/AppNav and Solo inbox primitives reused; design critique of rendered frames recorded below.
MATERIAL_FLOW_CHANGE: YES: customers gain /app/messages, and Contact your team (?topic=help) replaces Paige platform Support and the feature board for customers; owners gain a Portal channel in the existing inbox.
FLOW_PROTOTYPE: WAIVED: owner-decision=CLAUDE.md §4 pre-launch override 2026-09-05 and the owner's E09 portal decisions 2026-10-17; reason=no live customers, and the owner fixed the flow (portal messages only, help goes to the business, platform support replaced for customers); the owner reviews the live surfaces after merge.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a business's customer sends a message or help request to that business and reads its replies; a business admin replies from the inbox the business already uses.
VISUAL_DIRECTION: PASS: incumbent tokens, shadcn primitives and tenant accent (only on the customer's own bubble and send act, contrast-checked via readableTextOn); no new palette, typeface or shell.
AUTOMATED_EVIDENCE: PASS: 129 component/hook tests across 10 files and 46 pgTAP cases (supabase/tests/customer_portal_messages.sql, registered in paige-spine-contract) pass locally; every regression test added in the fix rounds was confirmed to fail against the previous code.
STATIC_EVIDENCE: PASS: tsc baseline guard did not grow (10 → 10 signatures); scoped ESLint clean; binding-ledger lint clean. Exact-head hosted CI is required before merge.
RENDERED_EVIDENCE: UNVERIFIED: harness renders of the customer page and owner inbox are in progress (scripts/live-drive/harness, synthetic data, network blocked); this field is updated when the frames and their measurements are reviewed.
BEHAVIORAL_EVIDENCE: PASS: component tests drive send, Enter/Shift+Enter, coarse-pointer Enter, retry with the same request id, edit-and-resend keeping help kind, rate limit, multi-business, identity switch, owner reply success and every refusal code; pgTAP drives the RPCs as customer, staff, other-business admin and anonymous.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated customer or owner session was driven on production; QA relationship send/read/reply is owed after merge.
KEYBOARD_FOCUS: PASS: composer receives focus in help mode once usable and after send; Edit and resend returns focus to the composer; role=log with aria-live off plus a separate polite status for new incoming replies. Physical assistive technology untested.
ZOOM_REFLOW: UNVERIFIED: phone-width harness frames pending; browser 400% zoom not exercised.
REDUCED_MOTION: PASS: no new animation; spinners and skeletons carry motion-reduce:animate-none.
STATE_COVERAGE: PASS: loading, empty first use, populated, help, sending, unconfirmed, failed, rate limited, read error, no relationship, more than one business, identity switch; owner: portal thread, help request, not joined, unconfirmed reply, workspace inactive, signed out.
TRUTHFUL_STATE_LABELS: PASS: a message shows as sent only after the server returned its id; no read receipts are claimed on either side; an unconfirmed send says retrying will not duplicate it.
SOLO_UI: YES: the owner Portal channel lives in the shared Solo conversations inbox for every eligible Solo/Sub-account business; no account-specific path.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: harness frame pending
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: harness frame pending
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: harness frame pending
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: harness frame pending
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: harness frame pending
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: harness frame pending
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: harness frame pending
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: harness frame pending
UNVERIFIED: authenticated customer and owner send/read/reply on production, harness frames, physical Safari/iOS keyboard, screen reader and 400% zoom.

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

## §58 call-out — platform Support for customers

Customers no longer reach Paige's platform Support desk or feature board; /app/support redirects them to Contact your team. This removes a previously shipped capability for one audience, by owner decision on 2026-10-17. Production check at decision time: support_tickets has 0 rows in total and 0 from users with a customer relationship, and feature_requests has 0 from customers, so no existing ticket is stranded. Platform ticket emails still link to /app/support; for a customer that now lands on Contact your team. Staff and owners keep the desk unchanged.
