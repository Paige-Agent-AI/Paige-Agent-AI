# Published Content in Mineral and Obsidian

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: The owner opens Content, finds published work, opens an item and returns to the same result. Compatible published media uses the existing Studio launcher. Studio owns saved drafts.
PAIGE_UI_DESIGN: PASS: Applied Impeccable color and contrast guidance and the Game UI/UX focus and reveal rules to the existing catalog.
MATERIAL_FLOW_CHANGE: YES: Content now has one published catalog. Legacy draft-library links resolve to that catalog.
FLOW_PROTOTYPE: PASS: Local rendering exercised the existing catalog with the owner-directed single-view layout and both themes. Render tests drove the detail, Studio handoff and return.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Owners and eligible Solo users can find their workspace's published work from Content.
VISUAL_DIRECTION: PASS: Mineral uses warm ivory, light panels and a deep violet action. Obsidian uses near-black plum, dark layers and a bright violet action. Native controls, selected items, artwork and focus use the corresponding palette.
AUTOMATED_EVIDENCE: PASS: 109 targeted tests cover the tenant and publication filters, exclusion of drafts and foreign data, native video controls, the original Studio event, route normalization and the existing return target.
STATIC_EVIDENCE: PASS: The catalog reads existing published Studio rows, live growth artifacts and original social receipts. Draft queries are absent from the catalog route.
RENDERED_EVIDENCE: PASS: Chromium checked both themes at 1536, 1366, 1024, 900 and 390 pixels using the real catalog stylesheet. Four fixture screenshots and the computed values are in outputs/exp07-published-content.
BEHAVIORAL_EVIDENCE: PASS: Render tests verify the published item opens, sends the original asset reference to Studio and restores the catalog focus. Older draft-library URLs resolve to the catalog.
AUTHENTICATED_RUNTIME: UNVERIFIED: Exact new source has not deployed. Existing Academy draft entry must be confirmed in Studio before retirement of the separate draft view.
KEYBOARD_FOCUS: PASS: Existing reveal returns focus to the same published card. Both palette focus rings passed their computed contrast check.
ZOOM_REFLOW: UNVERIFIED: Browser width and dock reflow passed. Actual 200 percent zoom remains unverified.
REDUCED_MOTION: PASS: The existing preference-aware reveal and CSS zero-duration rule are retained. Fixture renders use reduced motion.
STATE_COVERAGE: PASS: Published images and videos, empty catalog, filtered results, verified scope, unavailable media and independent read errors.
TRUTHFUL_STATE_LABELS: PASS: Studio publication state and timestamp distinguish catalog media. Social posts require their published record.
SOLO_UI: YES: Shared Solo Marketing Content for current and future eligible accounts.
SOLO_1536X770_PAIGE_CLOSED: PASS: Synthetic fixture reflow and both computed palettes. Signed-in proof remains open.
SOLO_1536X770_PAIGE_OPEN: PASS: Synthetic 390 px dock fixture and both computed palettes. Signed-in proof remains open.
SOLO_1366X768_PAIGE_CLOSED: PASS: Exact-size fixture and both computed palettes. Signed-in proof remains open.
SOLO_1366X768_PAIGE_OPEN: PASS: Fixture checked 1366 px with a simulated dock. Signed-in proof remains open.
SOLO_1024X768_PAIGE_CLOSED: PASS: Exact-size fixture and both computed palettes. Signed-in proof remains open.
SOLO_1024X768_PAIGE_OPEN: PASS: Fixture checked 1024 px with a simulated dock. Signed-in proof remains open.
SOLO_900X1000_PAIGE_CLOSED: PASS: Fixture checked 900 px reflow. Signed-in proof remains open.
SOLO_900X1000_PAIGE_OPEN: PASS: Fixture checked 900 px with a simulated dock. Signed-in proof remains open.
UNVERIFIED: Prior stored draft access through the exact Studio route, and signed-in production verification of the new catalog and both themes.

OWNER_INTENT: The Content tab shows published work only. Studio owns drafts. Mineral and Obsidian have distinct visuals.
ACCEPTANCE_CRITERIA: Each theme is visibly distinct and retains the compact title. Content displays genuine published entries from the active workspace. Original older drafts remain reachable from Studio.
MOTION_PURPOSE: The existing reveal carries the selected published artwork into detail. Keyboard and reduced motion use the immediate state change.
PROTECTED_SEAMS: Existing receipts, Studio publish markers, row access, same-account media identity and Studio handoff. No content writes or provider actions.
INTERNAL_BUILD_IDENTITY: 51345af2fd3bcc97d8624ccab94410cd6b15693f composition base; deployment=NOT_DEPLOYED; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=ANT-162
RELEASE_CHANNEL: development: Render tests, stylesheet proof and production read-only checks of existing record kinds.
RELEASE_CLASSIFICATION: internal-only: Refines the released Content experience around verified publication.
CUSTOMER_RELEASE_IDENTITY: none: Signed-in verification remains open.
RELEASE_NOTE_REQUIRED: no: Existing Solo rollout increment.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: The published-only Content experience and both themes await the exact hosted build and signed-in replay. The Studio dependency tracks pre-existing unattached drafts.
RELEASE_RECOVERY: position=revert the Content view and theme changes through the established release path; reference=ANT-162

[Owner clarification and readback](https://linear.app/paigeagentai/issue/ANT-162#comment-2b4b1e37-1735-4ec6-ac9a-9d721f9b1d5a)
