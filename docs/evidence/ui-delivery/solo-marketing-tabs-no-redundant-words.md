# UI delivery evidence: Solo Marketing tabs without redundant words, and the content library made readable

The owner reviewed Audience, Content, Email and Ads on the live app (2026-10-04): "I definitely don't like the
redundant words. Ads has the big word 'ads', and each one of them has the redundant words ... I don't like the
fact that it says 'planned' right next to it." This record covers removing each tab's header (name, Planned pill,
intro sentence), the Planned marker in the tab strip and the per-row "Not available" pill, and the owner-approved
grant that lets signed-in admins read the content library those tabs show (the owner's screenshots showed every
library panel failing). Frames: `node scripts/live-drive/marketing-views-drive.mjs`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding before editing - production read-only queries (marketing_content: 17 rows, all image/document drafts with no channel; clients.source: paige, manual, conversations); form submissions write source paige_form (growth-process-submission:413); Settings reads the sending identity through resolve_tenant_domain_identity and getManagedIdentityPresentation; no segment, broadcast, ad-account or spend table exists; the only other Solo greeting is Command Center's Business Game Plan (kept). Flows: reach each new tab by click, keyboard and deep link; read what exists for that job; follow the link to where the work lives (Clients, Settings › Connections, Lead capture, Vibe Studio); first use; failed read and retry
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode; each Planned tab leads with real records before the not-built list; "Planned" is a quiet dashed pill (a state, not an act: never gold, never the violet that asks for a review); impeccable detect exit 0 on the changed UI files
MATERIAL_FLOW_CHANGE: YES: the four tabs open straight on their content with their acts right-aligned; the strip shows tab names only; the saved library becomes readable for admins of the active workspace
FLOW_PROTOTYPE: PASS: the owner reviewed the live tabs and named the change; rendered frames are shown with this PR
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner sees, per marketing job, what their workspace already has and where to act on it; acts are links to the one home for each (Open Clients, Sending settings, Published work, Open Vibe Studio); no gold act is added
VISUAL_DIRECTION: PASS: existing Solo tokens and the Marketing primitives (mk-ledger, mo-panel, mo-rank, mk-flag); no hex; light and dark
AUTOMATED_EVIDENCE: PASS: marketing-planned.render.test.tsx 12 tests (now also asserts no header and no Planned text); tab order tests updated to plain names (growth2.render, growth2.contract, sales-ops.contract); 218 tests across Marketing, routing and Sales pass
STATIC_EVIDENCE: PASS: tsc ratchet no new errors (10/10); eslint 0 errors on changed files; impeccable detect exit 0; solo parity guard PASS after snapshot regeneration; gold-discipline lint reports one violation in src/components/dashboard/BusinessCreditDashboard.tsx:271, identical on the base commit and untouched here
RENDERED_EVIDENCE: PASS: marketing-views-drive 1756/1756 across Overview, Campaigns, Audience, Content, Email, Ads, Lead capture and Analytics x 4 viewports x 3 PAIGE postures x 2 themes plus states; campaigns-nav-fit-drive 216/216 for the nine plain tab names
BEHAVIORAL_EVIDENCE: PASS: render tests drive each tab's reads, links, retry and draft-first Ask PAIGE; production proof of the grant in a rolled-back transaction - an admin of a workspace with 1 of 17 library rows sees exactly 1 and 0 foreign rows, a user with no role sees 0, anon is refused (42501)
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login here; the owner's own live screenshots are the authenticated evidence for the defect, and the library panels must be re-checked live after the grant applies
KEYBOARD_FOCUS: PASS: the tab strip's roving tabindex and arrow keys cover all nine tabs; each tab's accessible name includes ", Planned" where it applies; every act is a native button with the existing focus ring
ZOOM_REFLOW: PASS: panels 3 to 2 to 1 columns by container width; ledgers 4 to 2 to 1; list rows stack below 460px; the tab strip scrolls with the selected tab kept in view
REDUCED_MOTION: PASS: no new motion; loading shimmer is the existing skeleton, already off under reduced motion
STATE_COVERAGE: PASS: loading (skeleton), error with retry, first use (no contacts, no library, no sending identity), populated, capped reads (counts marked +), published work loading or failed (shown as an ellipsis or a dash with retry, never 0), a team member who cannot read the saved library (told it is visible to owners and admins), a workspace switch mid-read
TRUTHFUL_STATE_LABELS: PASS: figures unchanged from the previous record; the honest not-built list stays under its own heading; nothing is estimated
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/{audience|content|email|ads} and /overview

SOLO_1536X770_PAIGE_CLOSED: PASS: all eight driven tabs, both themes, overflow 0
SOLO_1536X770_PAIGE_OPEN: PASS: docked 797px and expanded 521px, overflow 0
SOLO_1366X768_PAIGE_CLOSED: PASS: content column 1150px, overflow 0
SOLO_1366X768_PAIGE_OPEN: PASS: docked 685px and expanded 439px, overflow 0; the strip scrolls with the selected tab in view
SOLO_1024X768_PAIGE_CLOSED: PASS: content column 952px, overflow 0
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: content column 828px, overflow 0
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: no redundant words on Marketing's Audience, Content, Email and Ads, no Planned beside them, and their library panels working (owner, 2026-10-04)
MUST_NOT_HAPPEN: a write privilege on marketing_content granted to the browser; a foreign workspace's library visible; anon access; a tab losing its acts or its honest not-built list
MUST_PRESERVE: every tab's data, acts (Open Clients, Ask PAIGE, Open Vibe Studio, Sending settings, Open Integrations) and not-built list; the nine-tab order; Overview without a greeting
ACCEPTANCE_CRITERIA: on the live app the four tabs show no header and no Planned marker, and Content, Email and Ads list the saved library instead of could not load
MOTION_PURPOSE: NONE: no motion added
PROTECTED_SEAMS: tested - tab registry and order, the four views' reads and links; the grant is SELECT only, writes stay through save_marketing_content/delete_marketing_content; unaffected and named - Overview, Campaigns, Social, Lead capture, Analytics, Studio writes

INTERNAL_BUILD_IDENTITY: 318fe03b6ccda27a8ea3a2d63cc20b14359a88ef; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20270542000000 applied by deploy-migrations on merge, confirmed from schema_migrations afterwards); edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the owner ("Merge once CIS is green")
RELEASE_CLASSIFICATION: internal-only: copy removal on four Solo views and a read grant the owner approved
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: the views read only existing data; the library panels depend on the grant applying on merge; authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit for the frontend and reverse the grant with a forward REVOKE SELECT migration; reference=20270542000000_marketing_content_authenticated_read.sql
UNVERIFIED: authenticated production runtime: the library panels on a real Solo account after the grant applies
