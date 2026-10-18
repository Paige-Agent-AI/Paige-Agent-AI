# Customer Portal — per-tenant customer menu (E09 Slice M)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: actor-goal flows mapped before edit — a business owner chooses which menu entries their customers see, renames and reorders them within a group, previews the result and saves it with a confirmed read-back; a customer of one business sees that menu on phone and desktop; staff, a customer of several businesses and an unresolved relationship keep exactly the destinations they had; first use (no overlay), renamed, hidden, reordered, saving, saved and read-back-mismatch states included.
PAIGE_UI_DESIGN: PASS: Impeccable SKILL.md and reference/craft-floor.md read before the edit; the owner-approved mock (scratchpad/menu-mock: phone-drawer, desktop-bar, owner-editor) is the direction; the detector reports 0 anti-patterns on the changed files (3 advisories are pre-existing 10px badges in AppNav); measured findings from the first frames (4.15:1 drawer grey on the dark-theme violet, 4.3:1 preview text, a 21px switch target, gold active text on the nav) were fixed and re-rendered. Single critic (the integrating builder), not Impeccable's two-assessment critique.
MATERIAL_FLOW_CHANGE: YES: customers see a grouped menu (Home and Messages, then Your work, Paperwork and Learn); owners gain a "Customer portal menu" card in Clients → Portal → Customize experience that hides, renames and reorders entries; Paige can change the menu from chat (backend lane).
FLOW_PROTOTYPE: WAIVED: owner-decision=CLAUDE.md §4 pre-launch override 2026-09-05 and the owner's menu rulings 2026-10-18 (fixed and configurable entries, groups, Payments default name) against the approved mock; reason=no live customers and the owner fixed the design; the owner reviews the live surfaces after merge.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a business owner decides what their customers' portal menu offers and what each entry is called; a customer finds their business's surfaces under clear groups.
VISUAL_DIRECTION: PASS: incumbent tokens and shadcn/Radix primitives (DropdownMenu, Switch, Input, Button); the customer drawer keeps its brand fill, the preview uses the constant sidebar ink so it reads the same in every shell theme; gold only on Save menu; no new palette, typeface or shell.
AUTOMATED_EVIDENCE: PASS: Vitest — 73 new menu cases across portalMenu.assemble (44, including a per-preset per-viewer pin of the pre-Slice-M destinations captured from the real AppNav at 571ab923e), resolvePortalCatalog (4), normalizePortalConfig (3), AppNav.portal-menu (9), PortalStudio.menu (9), PortalSection (3) and the Client-visible home card (1), with the existing AppNav sessions/progress/help suites updated to the grouped structure; fail-first recorded 18 failures plus 2 files failing at import on the base; 10 mutants (overlay crossing a floor, slug-before-authored, label read dropped, non-live entry rendered, fixed entry renamed, saved claimed without read-back, partial array saved, PortalSection re-slug, customer catalog from usePlaybook, gold active) each caught. The full Vitest suite result and its base (16,036 passed, 0 failed, 8 skipped at 571ab923e) are reported with the PR. Backend pgTAP (customer_portal_menu.sql) and Deno tests are the backend lane's (commit 9177ff114); the Deno drift test against this registry passes 22/22.
STATIC_EVIDENCE: PASS: ESLint clean on the changed files (one pre-existing warning in PortalStudio); the tsc ratchet shows no new signature from the frontend files (its 5 new signatures are in supabase/functions/_shared/client-portal-menu.ts, backend lane); lint:tier-features, lint:solo-parity, lint:skeleton, lint:user-facing-admin-urls, lint:tool-catalogue, lint:binding-ledger and the other src lints pass; lint:gold fails identically on the base (BusinessCreditDashboard). Exact-head hosted CI is required before merge.
RENDERED_EVIDENCE: PASS: harness renders with the real AppNav and the real PortalStudio, real CSS, synthetic data and the network blocked (scripts/live-drive/harness/portal-menu-mount). 52 frames — customer default, renamed, hidden, reordered, staff and multi-business; owner default, renamed, hidden, reordered, saving, saved and mismatch; light and dark; 390x844 and 1440x900 — all pass measured AA contrast including placeholders, no horizontal overflow, no gold except Save menu, 44px targets in the menu, the drawer and the editor; the drive reads the menu off the page and checks it against the rulings. 6 negative controls (gold in the drawer, a 28px drawer target, a gold Reset, a 30%-opacity heading, a 1900px overflow, 24px move buttons) are each caught. The customer bar outside the menu (role badge in gold text, 28-40px brand, bell, account and Sign Out targets, 3.25-3.59:1 dark badge) predates Slice M and is reported as chrome findings, not graded.
BEHAVIORAL_EVIDENCE: PASS: component tests drive the desktop group menu from the keyboard (aria-haspopup, aria-expanded, aria-labelledby), aria-current on the current page and its group, rename/hide/reorder through the overlay, Messages refusing to hide, the customer catalog taken from the portal config, staff on their own Playbook, Payments never rendered, the drawer headings; the editor's full-array save, re-read match and mismatch, reset, counter, rename hint, in-group moves and preview parity with assemblePortalNav.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated owner save and no authenticated customer menu were driven on production; owed after merge with a seeded test business and a linked test customer.
KEYBOARD_FOCUS: PASS: group menus open from Enter and close with Escape (Radix), menu items take focus; move buttons and switches are buttons with labels; indigo focus rings. Physical assistive technology untested.
ZOOM_REFLOW: PASS: 390px frames reflow without horizontal overflow; browser 400% zoom not exercised.
REDUCED_MOTION: PASS: nav and drawer transitions carry motion-reduce variants; the save spinner has motion-reduce:animate-none; the dropdown keeps the primitive's reduced-motion classes.
STATE_COVERAGE: PASS: customer: default, renamed, hidden, reordered, staff, more than one business, relationship loading or unresolved (Vitest); owner: default, renamed, hidden, reordered, saving, saved, read-back mismatch, save error (Vitest), loading and load error (existing PortalStudio states).
TRUTHFUL_STATE_LABELS: PASS: "Menu saved" only after a re-read equals what was sent; a mismatch says the saved menu differs and keeps the draft; Payments is not offered while its page does not exist (no "Coming soon").
SOLO_UI: YES: the menu card lives in PortalStudio, reached in Solo through Clients → Portal → Customize experience for every eligible Solo business; no account-specific path.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: the owner harness rendered 1440x900 and 390x844 only; owed to an authenticated Solo drive.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: the owner harness mounts PortalStudio without the PAIGE dock; owed to an authenticated Solo drive.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
UNVERIFIED: authenticated owner save and customer menu on production; the Paige chat approval card for the menu tool; the editor inside OwnerPortalDashboard's wrapper and at Solo laptop widths with PAIGE open; screen reader; browser 400% zoom.

OWNER_INTENT: Every business decides which entries its customers' portal menu shows, in what order within each group and under what names; Home and Messages are always there; customers see their own business's menu, not a generic default.
MUST_NOT_HAPPEN: No entry crosses a floor (Messages, Sessions or Progress to staff or a customer of several businesses; a funding key a catalog does not list); Home or Messages hidden or renamed; an entry whose page does not exist shown or offered; "saved" claimed when the stored menu differs; an owner's stored entries silently dropped by a save.
MUST_PRESERVE: Every destination each viewer kind had before (pinned per Playbook preset), Get help / Support / Account / Settings / Sign out, the welcome and assistant settings and their Save portal, the PortalSection catalog editor.
ACCEPTANCE_CRITERIA: An owner renames Sessions to "Coaching calls", hides Documents and moves Sessions first, sees it in the preview, saves and sees "Menu saved"; their customer's drawer and bar show Home, Messages, then Your work with Coaching calls first and no Documents.
MOTION_PURPOSE: NONE: no new motion; the dropdown keeps the primitive's open/close.
PROTECTED_SEAMS: set_tenant_portal_config stays the one writer (can_manage_tenant_brand, shallow merge — the editor always sends the full array); get_client_portal_config adds _catalog server-side; the registry in portalMenu.ts is mirrored by the backend's PORTAL_MENU_KEYS under a drift test.

INTERNAL_BUILD_IDENTITY: 04e819e09b818d6868acb89dce63631c7830d3d2; deployment=NOT_DEPLOYED; environment=local; migrations=PROOF_OWED(the Slice M migration persisted apply on production after merge, backend lane); edge=PROOF_OWED(paige-ai-chat deploy readback after merge, backend lane); evidence=scripts/live-drive/harness/portal-menu-mount/menu-drive.mjs
RELEASE_CHANNEL: development: draft PR; production deployment, migration persisted-apply and edge readback are verified after merge.
RELEASE_CLASSIFICATION: internal-only: a Customer Portal slice; no customer release until all seven pillars and authenticated proof exist.
CUSTOMER_RELEASE_IDENTITY: none: pre-launch; no customer release named until the seven pillars and authenticated proof exist.
RELEASE_NOTE_REQUIRED: NO: pre-launch internal increment.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local automated and harness-rendered proof; authenticated runtime proof owed.
RELEASE_RECOVERY: position=forward-fix — the frontend change is a refactor behind one registry with the destination set pinned, and the overlay contract only gains an optional label; reference=src/lib/portal/portalMenu.ts

## §58 call-outs

Presentation only, nothing removed: the destinations each viewer kind sees are unchanged for every Playbook
preset (pinned against a capture of the real AppNav at `571ab923e`). The reading order changes because
entries are grouped (Home, Messages, then Your work, Paperwork, Learn). Action items becomes hideable by
the owner; it is not hidden by default. Home is now always shown even for an authored catalog that omits
it. The customer catalog now comes from the business's own Playbook (the §57 fix), so a business that
authored a different catalog shows its customers that catalog for the first time. The nav's selected entry
loses its gold text (a resting selection, §11) and the drawer's resting text moves from the sidebar grey to
the full foreground (AA in the dark theme). PortalStudio's "What they see" tab list is replaced by the
"Customer portal menu" card; "Save portal" no longer writes the menu.

## Known limits

- The non-embedded PortalStudio (non-Solo PortalView) keeps its gold "Save portal" header next to the new
  gold "Save menu": two act buttons on one page there. The Solo embedded path has one.
- OwnerPortalDashboard's "Customer modules" summary and Messages' Resources hint still use the flat
  catalog helpers (exports kept), so they do not show the grouped menu or the server catalog.
- On a 390px owner screen each row's controls sit on a second line.
