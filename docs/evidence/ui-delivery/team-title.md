# UI delivery evidence: the Team screen says "title"

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Quick-depth micro task (exact copy correction) inside one flow — an owner reads and sets a teammate's title on Settings → Team and approves PAIGE's work-details card; pre-edit packet and regression map are in the PR body; the containing flow and the adjacent approval-card seam were inspected before editing.
PAIGE_UI_DESIGN: PASS: read .agents/skills/paige-ui-design/SKILL.md, UPSTREAM.md, vendor/frontend-design/SKILL.md, vendor/frontend-design/references/accessibility-checklist.md, references/paige-quality-gates.md and references/review-and-testing.md; Impeccable context loaded for src/solo/team-workspace.tsx, clarify playbook and craft floor read before the edit; `impeccable detect --json src/solo/team-workspace.tsx` returned [] after it.
MATERIAL_FLOW_CHANGE: NO: exact copy correction — every control, state, exit, write and consequence is unchanged; only the words a person reads change ("job title" → "title"), plus one clarified sentence whose meaning is unchanged ("Renaming this person" → "Changing someone's title", because "renaming" read as changing their name).
FLOW_PROTOTYPE: NOT_REQUIRED: the paige-ui-design skill's exact-copy-correction clause — the change alters no action, state, exit or consequence, so there is no flow shape to prototype; the rendered before-and-after below shows the result instead.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner or admin managing their team reads, at every point they see or set what someone is called, the product's one word for it — "title" — so the screen never implies that what someone is called is a role that grants anything (owner ruling 2026-09-27).
VISUAL_DIRECTION: PASS: the incumbent Solo design system, unchanged — src/index.css tokens under [data-pg], src/solo/solo-tokens.css and src/solo/settings.css; no token, layout, color or motion change.
AUTOMATED_EVIDENCE: PASS: src/solo/team-title-copy.test.tsx drives the real SoloTeamWorkspace in jsdom across six states (roster with an untitled person, first-use with only the owner, member editor, permission-change confirmation, invitation form and its review step, Roles & access), every assertion built from TITLE_WORD — 6/6 on the change, 6/6 failing on main, and changing the constant turns all 6 red; src/solo/team-workspace-contract.test.ts passes with the new length message; scripts/client-memory-authz section 28 drives the real paige-ai-chat handler — 28.1 the approval card names the new title, 28.2 a cleared title reads "no title", 28.3 a 130-character title shows the first 120 with a cut marker, 28.4–28.6 the work-details, invitation and permission tool descriptions say "title", 28.7 the argument key stays job_title, 28.8 the executed work-details result carries the title under "title", 28.9 the executed access-change note says "title" — 378 passed / 0 failed, and every item but 28.7 fails against main's handler; whole suite (`npx vitest run`) 5,817 passed / 0 failed / 2 skipped at the code head below, and the same after merging main at 0bd5d67b0.
STATIC_EVIDENCE: PASS: ci:tsc ratchet 12/12 (no new errors); ESLint on the changed src and harness files exit 0; lint:tool-catalogue, lint:title-authority and its 53-mutation self-test, lint:binding-ledger and lint:legacy-mark exit 0; the handler parses (esbuild); ci:regression runs in CI on the committed diff.
RENDERED_EVIDENCE: PASS: docs/evidence/ui-delivery/team-title/ — the real Team components rendered in Chromium by scripts/live-drive/team-title-render.mjs on the shared team-mount harness (scripts/live-drive/harness/team-mount: the tenant shell's structure with PAIGE closed, the app and Solo stylesheets, both real themes; only the Supabase client and tenant context are stubbed with synthetic data): roster at 1536x770, 1366x768, 1024x768 and 900x1000 light and 1366x768 dark; first-use at 1366x768 light; member editor at 1366x768 light and dark; permission-change confirmation, invitation form, invitation review and Roles & access at 1366x768 light — each as before-*.png (main) and after-*.png (this change), plus before-copy.txt / after-copy.txt listing every visible line that contains "title". The script also fails on any sideways scroll; none occurred.
BEHAVIORAL_EVIDENCE: PASS: the real screen was driven in jsdom and in Chromium — roster load, opening a teammate's editor by clicking their row, choosing a new permission to reach its confirmation, opening the invitation form, typing an email and opening the review step, and switching to Roles & access; on the chat side the work-details and permission tools were executed through two-step approval (section 28.8–28.9). Saving a title from the screen was not exercised because the save path is unchanged.
AUTHENTICATED_RUNTIME: UNVERIFIED: this lane holds no authenticated Solo session; the claims owed after deploy are that the live Team screen reads "Title" in the editor, invitation form, review step and roster, and that a live PAIGE approval card for a work-details change reads `title "…"`.
KEYBOARD_FOCUS: PASS: structural — no control was added, removed or reordered; the existing <label> elements now name their fields "Title", so the accessible name follows the visible label (asserted by the test's label read). Manual keyboard route: UNVERIFIED with the authenticated pass.
ZOOM_REFLOW: PASS: structural — no dimension changed, and every changed string is shorter or the same length except the editor's separation note ("Changing someone’s title never changes their access.", 10 characters longer than "Renaming this person never changes access."), which still sits on one line in its callout in both 1366x768 editor frames; the editor was not rendered at other widths. The 900x1000 frame shows the roster reflowed exactly as before. Browser zoom to 200%: UNVERIFIED with the authenticated pass.
REDUCED_MOTION: PASS: no motion added or changed.
STATE_COVERAGE: PASS: populated roster, a person with no title ("Title not set"), first use with only the owner, member editor, permission-change confirmation, invitation form, invitation review, Roles & access; loading, error and retry states carry no title wording.
TRUTHFUL_STATE_LABELS: PASS: no capability label, truth label or state claim changed; Team remains PARTIAL on its surface card.
SOLO_UI: YES: Settings → Team, the canonical Solo team surface (SoloTeamWorkspace, mounted from src/solo/settings.tsx).
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: the authenticated Solo shell was not driven (no session held); harness frame at this width, PAIGE closed: team-title/after-roster-1536x770-light.png — owed: the Team roster and editor read "Title" with no clipping, PAIGE reachable.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: same boundary; the same checklist applies with PAIGE open.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: same boundary; harness frames at this width, PAIGE closed: team-title/after-roster-1366x768-light.png, after-roster-1366x768-dark.png, after-first-use-1366x768-light.png, after-editor-1366x768-light.png, after-editor-1366x768-dark.png, after-permission-confirm-1366x768-light.png, after-invite-1366x768-light.png, after-invite-review-1366x768-light.png, after-roles-1366x768-light.png.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: same boundary; the same checklist applies with PAIGE open.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: same boundary; harness frame at this width, PAIGE closed: team-title/after-roster-1024x768-light.png.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: same boundary; the same checklist applies with PAIGE open.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: same boundary; harness frame at this width, PAIGE closed: team-title/after-roster-900x1000-light.png.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: same boundary; the same checklist applies with PAIGE open.
UNVERIFIED: the authenticated Solo shell matrix above (eight viewports, PAIGE open and closed; the harness is the shell's structure, not the shell, and renders no PAIGE panel), a manual keyboard and 200% zoom pass, and a live approval card after deploy.

OWNER_INTENT: every place a person reads what someone is called says "title"; owner, admin and member remain the only roles (owner ruling 2026-09-27).
MUST_NOT_HAPPEN: no control, permission option, write, validation limit or approval behavior changes; the tool argument key job_title is not renamed (approvals already queued carry it); a CRM contact's title field is not touched.
MUST_PRESERVE: the Team screen's layout, states and controls; the 120-character title limit; the approval card's wording for everything but the word itself; the TEAM CONTEXT block from F1.
ACCEPTANCE_CRITERIA: on Settings → Team an owner sees "Title" as the editor label, the invitation-form label and the review-step row, "Title not set" for a teammate without one, "give them a title" on first use, "not the title" on a permission-change confirmation, and "Titles and responsibilities only describe work." on Roles & access; asking PAIGE to change a teammate's title shows a card reading `title "…"`, and every team tool she is offered says "title".
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: tested — the work-details approval card, the team tools' descriptions and their executed results (section 28) and the Team screen's roster, first-use, editor, permission-change, invitation and roles states (team-title-copy test); unaffected and named — set_solo_team_member_work_profile and the invitation RPCs (argument names unchanged), the permission change path, team removal, and the TEAM CONTEXT block (section 27 still 27.0–27.8 passing).

INTERNAL_BUILD_IDENTITY: a7621a8e9dffed43f1c8e7d0755015254bc37778; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-ai-chat redeploys through deploy-edge-functions on merge, and its deployed version and byte check are recorded in the delivery-log closeout); evidence=this-record-and-docs/evidence/ui-delivery/team-title/
RELEASE_CHANNEL: development: the identity above names the code head this record attests; the evidence and docs commits ride on top of it; the frontend deploys through Vercel and paige-ai-chat through deploy-edge-functions on merge
RELEASE_CLASSIFICATION: internal-only: a wording correction applying an owner ruling across existing surfaces; no capability, permission or data change
CUSTOMER_RELEASE_IDENTITY: none: an internal copy correction, not a customer release
RELEASE_NOTE_REQUIRED: NO: no flow, action or capability changed; the visible delta is one word on existing surfaces
RELEASE_TRUTH_BOUNDARY: PARTIAL: the wording is proven on the real components (jsdom and Chromium) and on the real chat handler; the authenticated shell matrix and a live approval card are owed after deploy
RELEASE_RECOVERY: position=forward-fix — a copy-only change with no data or schema effect, so any correction is a forward PR; reference=git revert of the squash commit plus team-title-copy.test.tsx and client-memory-authz section 28, which pin the wording

## Scope and collisions

- Classification: exact copy correction applying an owner ruling.
- Affected flows: an owner sets or reads a teammate's title on Settings → Team; an owner approves PAIGE's work-details change.
- Neighboring regressions: the TEAM CONTEXT block (F1, section 27), invitation create and resend, permission change, removal. All are unchanged, and section 27 still passes.
- Active-owner/file collisions: none found. The isolation lane's open work changes policies, not these files.
- Explicit exclusions: `src/solo/team-dir.tsx` ("Job title" in an older team directory that no production route imports; left for a separate cleanup), the CRM contact `title` field, and the tool argument key `job_title`.

## User job and state map

A Solo owner or admin decides what each teammate is called and what access they have. The screen keeps the two apart: permission is the access, title is the name for the work. States covered are listed under STATE_COVERAGE. The scroll owner is unchanged: the Settings content region, and the modal body for the editor and the invitation form.

## Evidence index

- `docs/evidence/ui-delivery/team-title/before-*.png`, `after-*.png`: rendered with `node scripts/live-drive/team-title-render.mjs before|after` on main's Team screen and on this change, headless Chromium, deviceScaleFactor 1, the harness's synthetic workspace "Northstar Studio".
- `docs/evidence/ui-delivery/team-title/before-copy.txt`, `after-copy.txt`: every visible line containing "title" in each captured state.
- `npx vitest run src/solo/team-title-copy.test.tsx`: 6/6, and 6/6 failing against main's `team-workspace.tsx`.
- `npm run test:client-memory-authz`: 378/0, and 28.1–28.6, 28.8 and 28.9 failing against main's handler (28.7, the unchanged argument key, passes on both).

## Review and limitations

An independent adversarial review of the diff ran before the PR opened; its findings and their disposition are recorded in the PR body. A pre-existing editor-avatar centring defect visible in these frames (before and after) is filed as #1503 and is not changed here.
