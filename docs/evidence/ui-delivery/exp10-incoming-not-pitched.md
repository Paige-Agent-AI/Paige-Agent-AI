# UI delivery evidence: EXP10 — outbound connection drawers stop pitching incoming-contacts setup

Owner direction 2026-11-05 (verbatim: "I am wondering why the card is still asking me to Set Up
Incoming Contacts. That should not be on this card but rather just an option I can have PAIGE do
if the tools are already connected."). This changeset removes the PITCH, not the capability: on an
outbound-capable connection drawer (address on file — e.g. HighLevel) the incoming-contacts
section renders only when a grant is ALREADY configured, keeping its manage affordances (Replace
sync credential / Review and enable again / Revoke incoming access / View sender setup). A
never-configured grant offers NOTHING on that drawer — no heading, no consent checkbox, no "Set
up incoming contacts" button — including while the first settings read is pending, so a fresh
connection drawer carries no incoming anything. A FAILED settings read (no record, an error)
still renders its error state — an unavailable-settings message is truth, not a pitch. The
incoming-ONLY surface (no outbound address — where setup IS the surface's purpose) keeps the
offer unchanged. The owner-named future home of the offer — PAIGE setting up incoming contacts in
chat once tools are connected — is recorded on ANT-164 as direction, not built here.
Files: settings-integrations-incoming.tsx (offerSetup prop + hide predicate),
settings-integrations-gateway.tsx (passes offerSetup = no outbound address), + the incoming test
suite (two new outbound-drawer tests).

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: affected flow — the connection detail drawer's incoming-contacts section on outbound-capable rows (original owner EXP10). Steps for a CONFIGURED grant are unchanged (view → replace/revoke/instructions). The never-configured state's step ("read the pitch → Set up incoming contacts → consent") no longer exists on outbound drawers; the incoming-only surface keeps it byte-identical. Dependencies (gw.readContactSync/setContactSync, tenant context) untouched.
PAIGE_UI_DESIGN: PASS: Impeccable context carried from this session's standing load; this is a render-condition change only — zero new components, classes or tokens; the section's incumbent structure renders exactly as before wherever it still renders.
MATERIAL_FLOW_CHANGE: YES: a section that used to render on every connection drawer now renders only for already-configured grants on outbound drawers — a visible flow delta the owner explicitly directed.
FLOW_PROTOTYPE: UNVERIFIED: no dedicated prototype — no new screen exists; the remaining render is the incumbent structure prior records evidenced — but the change IS material (a section vanishes from a state), so a rendered capture of a never-configured outbound drawer showing no incoming anything (and a configured one keeping manage) is owed and named here.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an owner connecting HighLevel sees the connection truth (status, check, tools) with NO setup homework he never asked for; incoming contacts becomes something PAIGE can be asked to do later, per his words.
VISUAL_DIRECTION: PASS: incumbent visual language only; removal of a section, no additions.
AUTOMATED_EVIDENCE: PASS: two new tests drive the outbound drawer through the real gateway section — never-configured renders no incoming section and no setup button; configured keeps Replace/Revoke with no setup button — plus the incumbent incoming-only suite (offer unchanged) stays green in CI; changed-file typecheck clean locally.
STATIC_EVIDENCE: PASS: tsc on the changed files reports zero findings.
RENDERED_EVIDENCE: UNVERIFIED: no local browser render this slice (local vitest/browser environment is the known-broken workstation state); owed and named.
BEHAVIORAL_EVIDENCE: PASS: both the hidden and retained states are driven through real drawer opens in the automated tests; the failed-read error path is reasoned in the predicate (record null + read finished ⇒ renders) and covered by the incumbent error rendering.
AUTHENTICATED_RUNTIME: UNVERIFIED: the owed proof is the owner's own GoHighLevel drawer on the deployed surface showing no incoming pitch; named here.
KEYBOARD_FOCUS: PASS: no focus behavior touched; the hidden state removes controls that were never the drawer's focus owner (the section focus logic applies only when it renders).
ZOOM_REFLOW: NOT_APPLICABLE: removal only; no layout structure added.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: never-configured (hidden on outbound, offered on incoming-only), configured (manage everywhere), pending first read (hidden on outbound), failed read (error still renders), uncertain generation (recovery UI still renders — the hide predicate yields to it).
TRUTHFUL_STATE_LABELS: PASS: the drawer no longer implies setup homework the owner never started; a configured grant's manage affordances and a failed read's error remain truthful.
SOLO_UI: YES: src/solo/settings-integrations-incoming.tsx + settings-integrations-gateway.tsx are the Solo Integrations surfaces.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: removal-only change inside the incumbent drawer structure; no rendering structure added.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: same.
UNVERIFIED: rendered captures (never-configured outbound drawer with no incoming section; configured drawer keeping manage) and the owner's authenticated drawer view are owed and named above; hidden/retained states are automated-test-covered.

MUST_PRESERVE: the incoming-ONLY surface's setup offer is byte-identical (its tests unchanged and green); a CONFIGURED grant keeps every manage affordance on every drawer; a failed settings read still surfaces its error; the uncertain-generation recovery UI always renders (the hide predicate yields to it); the consent + credential handling for actual setup flows is untouched.
ACCEPTANCE_CRITERIA: on the deployed surface, the owner opens a connected HighLevel drawer and sees NO incoming-contacts section or "Set up incoming contacts" action anywhere; a tenant who already enabled incoming on some connection still sees Replace/Revoke for it.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: contact-sync writers, consent flow and the gateway drawer's own machinery untouched; this delta is a render condition and its wiring.

INTERNAL_BUILD_IDENTITY: 045eb09041220a0defc0ae16a15d5e583b75ff81 (exp10-incoming-not-pitched changeset off origin/main 61b0c10e4); deployment=vercel-main-on-merge; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-incoming-not-pitched.md
RELEASE_CHANNEL: preview: unmerged branch; frontend ships with the next Vercel main deploy (Vercel prod deploys currently pending re-auth — #3279 and the connect-consent sentence ride the same unblock)
RELEASE_CLASSIFICATION: internal-only: authenticated Solo Integrations drawer truth; no customer release identity until the owner's own drawer view exercises it
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only
RELEASE_TRUTH_BOUNDARY: PROOF OWED: ships on merge; the owner's own HighLevel drawer showing no incoming pitch is the owed live proof (after the pending Vercel deploy unblock)
RELEASE_RECOVERY: position=revert-restores-the-never-configured-pitch-on-outbound-drawers; reference=this record plus the revert commit
