# E03 Conversations lead-reply continuation — implementation in progress

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: existing nine-step E03 flow packet; original ANT-42/51/52/147 records and owner preservation contract dated2026-10-14
PAIGE_UI_DESIGN: PASS: project overlay and five modules read; incumbent Solo Conversations components and tokens retained
MATERIAL_FLOW_CHANGE: YES: existing form opt-in, canonical inquiry, contextual draft entry, exact-message approval and receipt-only unknown recovery
FLOW_PROTOTYPE: PASS: e03-conversations-flow-review.html reviewed in the existing coding conversation; owner2026-10-14 said Yes as long as we maintain what we already have; current Conversations screenshot is the preservation baseline, not prototype replacement chrome
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: owner opens a form inquiry in canonical Conversations, edits its PAIGE reply in the existing composer and approves its server-resolved exact envelope
VISUAL_DIRECTION: PASS: preserve Clients navigation, thread list/search/filters, history, operating bar, rich composer, People context and PAIGE panel; no shell redesign
AUTOMATED_EVIDENCE: PASS: six changed-flow suites108/108 at4437003; expanded actual Solo/admin inbox plus decline cases50/50 with only the existing HTML artifact generator skipped; incumbent lead-reply60/60; current-main C0b integrity152/152; native PostgreSQL canonical inquiry identity/ACL/idempotency/concurrent replay PASS
STATIC_EVIDENCE: PASS: final product source b14149befec29b2ecc2535f34888e1a694129b72 TypeScript baseline10/current10 and production build PASS (1m46s); changed-file lint zero errors and three incumbent growth2 warnings; migration version collision PASS (1296 migrations); Impeccable exit0 with one retained incumbent10px advisory; git diff --check PASS
RENDERED_EVIDENCE: UNVERIFIED: actual ClientsConversations tree loaded with fixture-only adapters; capture stalled and yielded a blank frame, explicitly invalidated; no eight-viewport actual UI matrix claimed
BEHAVIORAL_EVIDENCE: UNVERIFIED: actual component browser drive proved draft entry into existing composer, server-resolved preview, edit invalidation, Not now retaining words/restoring focus, accepted-not-delivered and unknown locked/status-read-only behavior with simulated boundaries; complete authenticated/provider flow remains owed
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated ordinary SOLO acceptance or provider send authorized/performed
KEYBOARD_FOCUS: UNVERIFIED: observed review-trigger defect reproduced by a failing regression then corrected; actual DOM focus lands on Needs your OK group (never Approve), Not now returns to Review reply; complete keyboard traversal owed
ZOOM_REFLOW: UNVERIFIED: actual UI reflow proof owed
REDUCED_MOTION: UNVERIFIED: no new product animation; actual UI preference proof owed
STATE_COVERAGE: UNVERIFIED: automated stale/expired/repeated approval, identity/content changes, unsupported attachments/schedule/signature, workspace A-B-A, refusal/unknown/accepted/delivered and read-only recovery pass; complete actual UI and provider states owed
TRUTHFUL_STATE_LABELS: PASS: provider acceptance is not delivery; missing send answer is unknown and blocks another attempt; status checks read canonical Messages only; unknown reason payloads never become customer copy
SOLO_UI: YES: existing Clients Conversations and Marketing form settings; all eight actual rendered records remain owed
UNVERIFIED: exact-head independent review/CI, full migration replay/managed RLS, rendered interaction and geometry, authenticated roles/tenants, production deployment/readback, SendGrid and Gmail privacy acceptance

OWNER_INTENT: owner completes capture -> inquiry -> same Conversations -> draft/edit -> exact identity/content approval -> truthful status -> People -> same durable history
MUST_NOT_HAPPEN: replacement shell, duplicate inbox/CRM/sender/approval engine; silent attachment/schedule/signature dropping; repeated unknown send; personal mailbox content copied to shared history; fixture claims presented as production
MUST_PRESERVE: all existing Conversations navigation, controls, history, context and PAIGE panel; existing five/six-argument settings RPCs; reviewed frozen PRs and source fingerprints; canonical sending/pre-send/drain
ACCEPTANCE_CRITERIA: ordinary owner/admin completes the nine-step flow on the released app; member/foreign tenant refused; exact revision/identity bound; provider outcome and return history proven separately
MOTION_PURPOSE: NONE: no product animation added
PROTECTED_SEAMS: affected isolation/authority/approval/canonical write/readback/provider state/retry/idempotency/privacy/geometry/accessibility; fixture regression and native SQL prove subsets only. Authentication/account choice, signup/paywall/billing/provisioning, Spine registry/executor, Rail/Memory engine, Chat transcript/popout/stream, Live Conversation and Secure Browser/Vault implementations not modified. Existing native processor and retry lifecycle reused; no new queue.

INTERNAL_BUILD_IDENTITY: b14149befec29b2ecc2535f34888e1a694129b72; deployment=none-local; environment=development; migrations=PROOF_OWED(20271101143000_e03_form_inquiry_conversations production unapplied); edge=PROOF_OWED(growth-process-submission source not deployed); evidence=docs/evidence/ui-delivery/e03-conversations-lead-reply-continuation.md and scripts/proof/e03-form-inquiry-postgres.mjs
RELEASE_CHANNEL: development: source continuation only, no activation; automatic Git branch preview is a separate evidence leg
RELEASE_CLASSIFICATION: internal-only: unfinished customer journey source, no customer release
CUSTOMER_RELEASE_IDENTITY: none: acceptance and release authority not established
RELEASE_NOTE_REQUIRED: no: no customer release
RELEASE_TRUTH_BOUNDARY: PROOF OWED: local source and focused proof only
RELEASE_RECOVERY: position=unreleased continuation branch; reference=original frozen PRs and current main remain separate

SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: actual source capture owed
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: actual source capture owed
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: actual source capture owed
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: actual source capture owed
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: actual source capture owed
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: actual source capture owed
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: actual source capture owed
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: actual source capture owed

## Source and release boundaries

Preserved PRs:2131=60bc59d95ab94e76b54788476908651df08a9399;2150=feb0e10da2d0217dd43db23fd2d1975b2fb884c1;2152=e0c9aa30e3831edea28726af6ce3a5bc72f83fb3. Their spent review allowances do not reset. Owner forbids other agents; none used for this continuation. This record is author evidence, not an independent review or SHIP verdict.

The new migration was CLI-created as20261014223525, then renamed before application above verified production frontier20271101142133. It adds one logical source ID and an inbound-only Form value to existing Messages. A service-only SECURITY INVOKER RPC derives scope from the claimed submission, gates current opt-in and exact primary email, and inserts once; existing tenant/thread triggers retain ownership. Old inquiries are not backfilled. The source is not deployed and no migration applied outside a task-owned disposable local PostgreSQL cluster.

S3 UI round7 and G1 round13 original complete bytes/review reports/pins are still unavailable. This is explicit reconstruction against the released S3 backend, not invented recovery. G1 L1-L6 and issue2135 remain open. SendGrid-only cutover, credentials/DNS/Auth/inbound/provider receipts and final go-live are separate owner/external gates.

The continuation is rebased cleanly onto mainbf0a8b60bee8d3a83c17c214655ea6425fc168d4. Original local preservation commita9045b2e1120c5d42c7d4092b98e3596edd1e65f remains on codex/e03-preserved-20261014-a9045b2e1. No overlap with E2-6 product files, no shared pin helper modification. The same-thread composer selection guard now keeps unsent words/review identity through canonical message readback; a real thread/workspace change still resets them.

Legacy client.followup and held email approvals expose the existing decline exit and canonical Conversations link, with generic execution refused. Decline readback must match exact row, tenant filter, pending predicate and rejected status; an empty/foreign/stale answer never collapses the row. The frozen execute-approval source in2150 is untouched.

Durable governed-email history now distinguishes Accepted from Delivered using the existing six-scalar projection. An inbox read marker does not create recipient delivery evidence. The real mounted Solo and admin inbox tests prove sent/read -> Accepted, delivered -> Delivered, failed -> Failed, without restoring approval controls. No sending or receipt producer changed.
