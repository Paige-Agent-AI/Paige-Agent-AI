# Customer Portal — per-tenant customer menu (E09 Slice M)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: actor-goal flows mapped before edit — a business owner chooses which menu entries their customers see, renames and reorders them within a group, previews the result and saves it with a confirmed read-back, and after a reload the editor still holds it; a customer of one business sees that menu on phone and desktop; staff, a customer of several businesses and an unresolved relationship keep exactly the destinations they had (Agreements: staff only until Slice A); first use (no overlay), renamed, hidden, reordered, saving, saved, save-refused and read-back-mismatch states included. Round 2 re-ran the flows after the adversarial verifier and compliance findings.
PAIGE_UI_DESIGN: PASS: Impeccable SKILL.md and reference/craft-floor.md read before the edit; the owner-approved mock (scratchpad/menu-mock: phone-drawer, desktop-bar, owner-editor) is the direction; the detector reports 0 anti-patterns on the changed files (3 advisories are pre-existing 10px badges in AppNav). Round-2 craft fixes from the compliance pass: name fields hold the real name instead of grey placeholders, hidden rows are dimmed and labelled, rows stay one line at 390px, View as client is grouped, one gold act per page, Sign Out keeps a destructive cue in the dark drawer (4.7:1). Single critic (the integrating builder) plus the compliance officer, not Impeccable's two-assessment critique.
MATERIAL_FLOW_CHANGE: YES: customers see a grouped menu (Home and Messages, then Your work, Paperwork and Learn) built from their own business's catalog; owners gain a "Customer portal menu" card in Clients → Portal → "Open gated Portal configuration" that hides, renames and reorders entries; the PortalStudio header save is renamed "Save brand, greeting & agent"; Paige can change the menu from chat (backend lane).
FLOW_PROTOTYPE: WAIVED: owner-decision=CLAUDE.md §4 pre-launch override 2026-09-05 and the owner's menu rulings 2026-10-18 (fixed and configurable entries, groups, Payments default name) against the approved mock; reason=no live customers and the owner fixed the design; the owner reviews the live surfaces after merge.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a business owner decides what their customers' portal menu offers and what each entry is called; a customer finds their business's surfaces under clear groups.
VISUAL_DIRECTION: PASS: incumbent tokens and shadcn/Radix primitives (DropdownMenu, Switch, Input, Button); the customer drawer keeps its brand fill, the preview uses the constant sidebar ink so it reads the same in every shell theme; gold only on Save menu; no new palette, typeface or shell.
AUTOMATED_EVIDENCE: PASS: Vitest — the menu files (23 files, 336 tests, one run at load ~4: src/lib/portal, resolvePortalCatalog, useClientPortalConfig.menu, src/components/app, PortalStudio menu/assistant/brand-font, PortalSection, OwnerPortalDashboard, PortalInvitationConcurrency, PortalDashboardMount, TenantRelationshipsClientsWorkspace, Messages, c0b-read-registration, AppShell.client-refresh) all pass. Round 2 adds cases for the Agreements hold, fixed names against a Playbook label, the shared-route hide, the skeleton (no Resources flicker), the customer catalog deciding the Messages hint, the dashboard list from the registry, real-value name fields, clearing to default, hidden-row dimming, mapped save errors, dedupe of stored rows, Reset at default, one gold act per page, the header naming menu edits, and grouped View as client. Bite check: 12 reinstated defects (Agreements gate, fixed-name rule, alias hide, customer catalog source, skeleton, raw error text, dedupe, real-value seed, hidden dim, gold header, dashboard viewer, c0b exemption) each fail their test. Round 1: fail-first 18 failures plus 2 import failures on the base; 10 mutants caught. Under machine load 26 the PortalStudio assistant/brand-font files and one TenantRelationshipsClientsWorkspace case time out; serial reruns pass, and that workspace case also flakes on a clean origin/main worktree. A full Vitest run on an idle runner (hosted CI) is still required. Backend pgTAP and Deno are the backend lane's; the Deno file passes 31/31 against this registry.
STATIC_EVIDENCE: PASS: ESLint on the changed files: 0 errors, 1 pre-existing warning (PortalStudio `own` memo); tsc ratchet: no new type errors (baseline 10, current 6); every `npm run lint:*` passes except lint:gold (BusinessCreditDashboard) and lint:impeccable, which fail identically on the base. Exact-head hosted CI is required before merge.
RENDERED_EVIDENCE: PASS: harness renders with the real AppNav and the real PortalStudio, real CSS, synthetic data and the network blocked (scripts/live-drive/harness/portal-menu-mount). 52 state frames — customer default, renamed, hidden, reordered, staff and multi-business; owner default, renamed, hidden, reordered, saving, saved and mismatch; light and dark; 390x844 and 1440x900 — plus 4 persistence runs (8 frames: owner after reload, customer after the owner's save), all passing: measured AA contrast (owner minimum 5.32, customer minimum 4.53), no horizontal overflow, gold only on Save menu (and only one gold act on the whole owner page), 44px targets in the menu, the drawer and the editor, every editor row one line at 390px, View as client grouped and equal to the editor preview; the drive reads the menu off the page and checks it against the rulings. 9 negative controls (gold in the drawer, a 28px drawer target, a gold Reset, a 30%-opacity heading, a 1900px overflow, 24px move buttons, Sign Out on the plain destructive token in the dark drawer, a wrapping row at 390px, a store that does not survive reload) are each caught. The customer bar outside the menu (gold role badge, 28-40px brand, bell, account and desktop Sign Out targets, 3.25-3.59:1 dark badge and desktop Sign Out) predates Slice M and is reported as chrome findings, not graded.
BEHAVIORAL_EVIDENCE: PASS: component tests drive the desktop group menu from the keyboard (aria-haspopup, aria-expanded, aria-labelledby), aria-current on the current page and its group, rename/hide/reorder through the overlay, Messages refusing to hide, the customer catalog taken from the portal config, Agreements for staff only, staff on their own Playbook, Payments never rendered, the skeleton until the customer's config resolves, the drawer headings; the editor's full-array save, re-read match and mismatch, mapped refusals, reset, counter, rename hint, in-group moves and preview parity with assemblePortalNav. The harness persistence run saves through the real editor, reloads the page, reads "Coaching calls" and Documents off back, then opens the customer view in the same tab and reads the same menu — over a sessionStorage stub, not production.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated owner save and no authenticated customer menu were driven on production; owed after merge with a seeded test business and a linked test customer.
KEYBOARD_FOCUS: PASS: group menus open from Enter and close with Escape (Radix), menu items take focus; move buttons and switches are buttons with labels; indigo focus rings. Physical assistive technology untested.
ZOOM_REFLOW: PASS: 390px frames reflow without horizontal overflow; browser 400% zoom not exercised.
REDUCED_MOTION: PASS: nav and drawer transitions carry motion-reduce variants; the save spinner has motion-reduce:animate-none; the dropdown keeps the primitive's reduced-motion classes.
STATE_COVERAGE: PASS: customer: default, renamed, hidden, reordered, staff, more than one business, relationship or config still loading (skeleton), unresolved (Vitest); owner: default, renamed, hidden, reordered, saving, saved, saved-then-reloaded, read-back mismatch, refused (permission, invalid name, unknown error), loading and load error (existing PortalStudio states).
TRUTHFUL_STATE_LABELS: PASS: "Menu saved" only after a re-read equals what was sent; a mismatch says the saved menu differs and keeps the draft; a refusal is a plain sentence ("Couldn't save the menu. Try again." when unrecognised) with no backend wording; Payments and (for customers) Agreements are not offered while their pages are not the customer's (no "Coming soon"); the header names unsaved menu edits instead of reading as saved.
SOLO_UI: YES: the menu card lives in PortalStudio, reached in Solo through Clients → Portal → "Open gated Portal configuration" for every eligible Solo business; no account-specific path.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: the owner harness rendered 1440x900 and 390x844 only; owed to an authenticated Solo drive.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: the owner harness mounts PortalStudio without the PAIGE dock; owed to an authenticated Solo drive.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
UNVERIFIED: authenticated owner save and customer menu on production; the Paige chat approval card for the menu tool; the editor inside OwnerPortalDashboard's wrapper and at Solo laptop widths with PAIGE open; screen reader; browser 400% zoom; scripts/proof/e09-dashboard-ui and scripts/live-drive/brand-fonts-drive.mjs still look for "Save portal" and the dashboard proof adapter does not export usePortalCatalogInput (outside this lane; not run).

OWNER_INTENT: Every business decides which entries its customers' portal menu shows, in what order within each group and under what names; Home and Messages are always there; customers see their own business's menu, not a generic default; Agreements waits for Slice A.
MUST_NOT_HAPPEN: No entry crosses a floor (Messages, Sessions or Progress to staff or a customer of several businesses; a funding key a catalog does not list; Agreements to any customer before Slice A); Home or Messages hidden or renamed, by the overlay or a Playbook label; an entry whose page does not exist shown or offered; "saved" claimed when the stored menu differs; an owner's stored entries silently dropped by a save; backend wording shown to the owner.
MUST_PRESERVE: Every destination staff had before (pinned per Playbook preset), every destination a customer had except Agreements and except where the business's own catalog differs from the generic default (§58 below), Get help / Support / Account / Settings / Sign out, the welcome and assistant settings and their header save (renamed "Save brand, greeting & agent"), the PortalSection catalog editor.
ACCEPTANCE_CRITERIA: An owner renames Sessions to "Coaching calls", hides Documents and moves Sessions first, sees it in the preview, saves and sees "Menu saved"; their customer's drawer and bar show Home, Messages, then Your work with Coaching calls first and no Documents.
MOTION_PURPOSE: NONE: no new motion; the dropdown keeps the primitive's open/close.
PROTECTED_SEAMS: set_tenant_portal_config stays the one writer (can_manage_tenant_brand, shallow merge — the editor always sends the full array); get_client_portal_config adds _catalog server-side; the registry in portalMenu.ts is mirrored by the backend's PORTAL_MENU_KEYS under a drift test.

INTERNAL_BUILD_IDENTITY: 7a5f2438e8de939975fa4c893c4a0370cbdc9f35; deployment=NOT_DEPLOYED; environment=local; migrations=PROOF_OWED(the Slice M migration persisted apply on production after merge, backend lane); edge=PROOF_OWED(paige-ai-chat deploy readback after merge, backend lane); evidence=scripts/live-drive/harness/portal-menu-mount/menu-drive.mjs
RELEASE_CHANNEL: development: draft PR; production deployment, migration persisted-apply and edge readback are verified after merge.
RELEASE_CLASSIFICATION: internal-only: a Customer Portal slice; no customer release until all seven pillars and authenticated proof exist.
CUSTOMER_RELEASE_IDENTITY: none: pre-launch; no customer release named until the seven pillars and authenticated proof exist.
RELEASE_NOTE_REQUIRED: NO: pre-launch internal increment.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local automated and harness-rendered proof; authenticated runtime proof owed.
RELEASE_RECOVERY: position=forward-fix — the frontend change is a refactor behind one registry with the destination set pinned, and the overlay contract only gains an optional label; reference=src/lib/portal/portalMenu.ts

## §58 call-outs

Not presentation only. Before Slice M a customer could not read their business's Playbook (RLS), so every
customer's menu was built from the generic default catalog. Now each customer gets their own business's
catalog (the §57 fix), and that is a visible change for real customers today:

- Customers of a business whose own catalog omits Resources (production: two consultant-Playbook
  businesses with clients, catalog `home,engagement,deliverables,sessions,messages,billing`) no longer see
  Resources.
- Customers of a business that opted into the funding Playbook (production: one business with clients)
  now see that business's own funding entries (Funding Journey, Credit, Funding, Financial Profile,
  Business). They do NOT see Agreements: it is held back from customers until Slice A, because its route
  is still the platform-terms page. Staff keep Agreements exactly as before.

For staff, and for a viewer whose catalog is the one the capture used, the destination set is pinned
against a capture of the real AppNav at `571ab923e`. Other behaviour changes: entries are grouped (Home,
Messages, then Your work, Paperwork, Learn), which changes the reading order; Action items becomes
hideable by the owner (not hidden by default); Home is always shown even for an authored catalog that
omits it, and a Playbook label can no longer rename Home or Messages; the nav's selected entry loses its
gold text (a resting selection, §11); the drawer's resting text moves from the sidebar grey to the full
foreground (AA in the dark theme), and its dark-theme Sign Out moves from plain foreground back to a
destructive colour (`--destructive-on-ink`, 4.7:1). PortalStudio's "What they see" tab list is replaced by
the "Customer portal menu" card; the header "Save portal" is renamed "Save brand, greeting & agent", is
outline (one gold act per page) and no longer writes the menu. The owner dashboard's "Customer modules"
is renamed "Customer portal menu" and now lists the assembled menu (including Home and Messages). The
internal flat helpers in `src/lib/portal/moduleNav.ts` had no callers left and are removed.

## Known limits

- Outside this lane: `scripts/proof/e09-dashboard-ui/check.mjs` and `scripts/live-drive/brand-fonts-drive.mjs`
  select the header button by "Save portal", and the dashboard proof adapter does not export
  `usePortalCatalogInput`; both proofs need updating before they are re-run.
- The customer desktop bar outside the menu (gold role badge, desktop Sign Out at 3.59:1 in dark, sub-44px
  targets) predates Slice M and is unchanged.
