# Customer Portal — funding and credit follow the business's entitlement (E09 F2)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: actor-goal flows mapped before edit — a customer of a business that never chose funding opens Home, the menu, the bell and any funding/credit address and meets no funding or credit surface (redirected to /app from a direct URL); a customer of the one entitled business keeps every funding/credit surface they had; staff of any business keep theirs (owner ruling Q5, option a); a freshly provisioned Solo business is not entitled; a customer uploads their first document on /app/documents and Getting Started's document step ticks. States: entitled, not entitled, config silent, viewer still being checked, staff, no active access, outside the shell, failed entitlement read.
PAIGE_UI_DESIGN: PASS: Impeccable SKILL.md and reference/craft-floor.md read before the edit; this slice removes surfaces rather than designing new ones, so the direction is the incumbent Home, bell and checklist. `npx impeccable@4.1.0 detect` on the eight changed UI source files exits 0 with 0 anti-patterns and, after this slice's fixes, 0 advisories (the bell's 10px bureau/time and the factor grid's 10px weight moved onto the type ramp). Harden fixes in touched files: the bell's icon-only trigger now has an accessible name ("Notifications", with the unread count), and its menu is capped to the viewport (`min(400px, 100vw - 2rem)`, collision padding 16) — at 390px it ran 10px off the right edge on main. Single critic (the builder).
MATERIAL_FLOW_CHANGE: YES: for customers of a business that is not finance-entitled, the seven funding/credit pages, menu entries, Home credit/funding tiles and factor grid, and the bell's credit alerts and link are gone; Getting Started's document step now completes from the customer's own saved upload.
FLOW_PROTOTYPE: WAIVED: owner-decision=CLAUDE.md §4 pre-launch override 2026-09-05 and the owner ruling 2026-10-19 "funding/credit leaves the customer portal and the Solo default" plus the owner approval 2026-10-19 ("I approve it all"); reason=a removal behind an entitlement, no new design; the owner reviews live after merge.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a customer of a business that never chose funding sees only that business's own services; the business that chose funding keeps its funding portal.
VISUAL_DIRECTION: PASS: incumbent tokens and primitives; nothing added except the route guard's two-line Skeleton; no gold anywhere in the change (gold-discipline lint passes on the changed files).
AUTOMATED_EVIDENCE: PASS: Vitest new: CustomerFinanceRoute.test.tsx (51: 7 paths × 6 viewers, the loading skeleton, a failed read, and App.tsx mounting all 7 behind the guard), useFinanceEntitlement.test.tsx (7), OnboardingChecklist.test.tsx (6), NotificationBell.finance.test.tsx (2), AppShell.finance-entitlement.test.tsx (4, incl. the no-expansion proof); extended: portalMenu.assemble.test.ts (54, incl. the default proof over every starter Playbook), ClientHomeTiles.test.tsx (36). Deno client-portal-menu.test.ts 38/38 (entitlement drift field, `not_entitled`, read rows, the caller-session read). pgTAP e09_finance_portal_entitlement.sql 17/17 (fail-first 5 not ok before the migration), e09_finance_entitlement.sql 66/66. test:client-memory-authz 1238/1238 (10.6 and 30.12–30.38 new or rewritten; reinstating the client credit path fails 5, removing the persona gate fails 30.38). Full-suite counts and the base comparison are in the PR body.
STATIC_EVIDENCE: PASS: ESLint on changed src: 0 errors (3 pre-existing warnings; useCreditAlerts.ts carries the repo's legacy-debt header for its existing `any`s, no new ones); tsc ratchet: no new type errors (baseline 10, current 6); every `npm run lint:*` CI runs exits 0 (63); Impeccable 0 anti-patterns; gold-discipline passes on the changed files.
RENDERED_EVIDENCE: PASS: harness renders (scripts/live-drive/harness/portal-finance-entitlement-mount, real AppNav + NotificationBell, real AppDashboardHome, real useFinancePortal, real frame parser; synthetic data, network blocked): a fresh Solo business, a funding Playbook without the entitlement, and the entitled business; light and dark; 1440x900 and 390x844; Home (viewport and full) and the bell opened — 36 frames. The drive measures, per frame: which finance tables and RPCs were read (none for the two non-entitled states, all four for the entitled), funding/credit links and words on the page (none / present), the bell's credit section, the bell menu inside the viewport, no horizontal overflow, the harness label on screen. The customer has credit reports, applications, alerts and factor scores on file in every state, so only the entitlement differs.
BEHAVIORAL_EVIDENCE: PASS: route guard driven through MemoryRouter for every path and viewer; the checklist's document step driven to /app/documents and ticked from a counted upload; pgTAP drives the customer's real upload through client_portal_begin_file_upload, storage, and client_portal_finish_file_upload and reads the checklist's exact query going 0 → 1 as that customer.
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in customer or staff session was driven; owed after merge with a test customer of a non-entitled business and of an entitled one.
KEYBOARD_FOCUS: PASS: no new interactive control; the bell trigger gains an accessible name. Physical assistive technology untested.
ZOOM_REFLOW: PASS: 390px frames without horizontal overflow, bell menu within the viewport; browser 400% zoom not exercised.
REDUCED_MOTION: PASS: no new motion; the route skeleton uses the primitive's pulse.
STATE_COVERAGE: PASS: entitled, not entitled, config without entitlements, viewer checking (skeleton), staff (Q5), no active access, outside the shell, failed read (fail closed), funding_readiness × entitlement four ways.
TRUTHFUL_STATE_LABELS: PASS: nothing claims a capability the business lacks; a refused menu change says "That is not an entry in this business's customer portal" without naming funding; the document step ticks only from a saved upload.
SOLO_UI: YES: the owner's menu editor, PortalStudio preview and owner dashboard (src/components/tenant-relationships) read the entitlement for their funding rows; for every Solo business they read it from the owner's active workspace.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: the owner surfaces were not rendered in this slice (their only change is whether funding rows appear); owed to an authenticated Solo drive.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: not rendered with the PAIGE dock; owed to an authenticated Solo drive.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
UNVERIFIED: authenticated customer and staff sessions on production; the migration's persisted apply and the paige-ai-chat deploy readback (after merge); owner surfaces at Solo laptop widths; screen reader; browser 400% zoom.

OWNER_INTENT: Funding and credit are not standard; no customer portal shows them unless the business deliberately installed them, and the one business that did keeps them; existing data is untouched.
MUST_NOT_HAPPEN: A funding/credit page, menu entry, tile, alert, prompt word or chat credit path for a customer of a non-entitled business; any `funding_readiness` surface lighting up without it (nothing dark becomes visible); staff losing a surface they use (Q5); data deleted or rewritten.
MUST_PRESERVE: The entitled business's funding portal; staff funding/credit surfaces and chat credit path; every non-finance menu entry, tile and checklist step; stored overlays and Playbook modules.
ACCEPTANCE_CRITERIA: A customer of a freshly provisioned Solo business opens /app/credit and lands on /app; Home shows no Credit or Funding tile though they have reports on file; the bell has no credit section; uploading a document ticks Getting Started.
MOTION_PURPOSE: NONE: no new motion.
PROTECTED_SEAMS: `_tenant_finance_entitled` stays the one predicate (read server-side into get_client_portal_config; staff through current_tenant_finance_entitled); get_paige_persona_context is not replaced; set_tenant_portal_config stays the one menu writer.

INTERNAL_BUILD_IDENTITY: parent 661f08d46ac64ee1827671ae3b58d494e19d2e86 (F1b) + the e09-funding-f2 commit that carries this record (a record cannot name its own SHA); deployment=NOT_DEPLOYED; environment=local; migrations=PROOF_OWED(20271111040000 persisted apply on production after merge, after 20271111030000); edge=PROOF_OWED(paige-ai-chat deploy readback after merge); evidence=scripts/live-drive/harness/portal-finance-entitlement-mount/finance-drive.mjs
RELEASE_CHANNEL: development: local branch; production deployment, migration persisted-apply and edge readback are verified after merge.
RELEASE_CLASSIFICATION: internal-only: a Customer Portal entitlement correction; no customer release.
CUSTOMER_RELEASE_IDENTITY: none: pre-launch; no customer release named.
RELEASE_NOTE_REQUIRED: NO: pre-launch internal correction.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local automated, database and harness-rendered proof; authenticated runtime proof owed.
RELEASE_RECOVERY: position=forward-fix — every gate reads one predicate, and reverting the frontend restores the surfaces without any data change; reference=src/hooks/useFinanceEntitlement.ts

## §58 call-outs

Removed, for customers (and anyone without active access) of a business that is not finance-entitled — 11 of 12
production businesses, every new Solo business:
- the pages `/app/credit`, `/app/funding`, `/app/funding-journey`, `/app/disputes`, `/app/business`,
  `/app/business-profile`, `/app/financial-profile` (direct URL → /app);
- the menu entries Funding Journey, Credit, Funding, Financial Profile and Business (both key spellings), and their
  rows in the owner's editor, the previews and Paige's portal-menu read and configure;
- the Credit and Funding Home tiles and the credit-factor grid; the bell's credit alerts and its `/app/credit` link;
- for every client-tier caller: the chat credit-report path (read-check, upload row, sync) and the funding persona.

Unchanged: the entitled business (all of it); staff everywhere (Q5); the `funding_readiness` surfaces, which stay
dark for all 12 businesses; stored modules and overlays (inert, not deleted).
