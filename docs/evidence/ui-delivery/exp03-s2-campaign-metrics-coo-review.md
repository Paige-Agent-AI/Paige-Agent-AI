# UI delivery evidence: exp03-s2-campaign-metrics-coo-review

S2 (the owner's resumption directive item 3): campaign results reach the COO business review. The marketing-intake adapter — the same Campaigns domain snapshot Chat and the Executive surface read — now derives two label-free headline figures from the EXISTING `marketing.leads.by_campaign_tag` canonical metric read: `campaigns.leads_credited_to_campaigns` (leads the producer grouped to a campaign, including its rank-fold `_other` tail) and `campaigns.busiest_campaign_leads` (the largest single named campaign). No new metric key, no producer change, no conversion/revenue/ROI arithmetic — the existing linked-to-opportunity count remains the only conversion figure.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: WAIVED: owner-decision=AGENTS.md mandatory routing with the #1280 waiver grammar; reason=the Flow-by-Flow skill is not installed in this agent environment, and the incumbent-surface grounding below carries the flow reading instead
PAIGE_UI_DESIGN: PASS: Impeccable skill read fully this session — craft-floor applied: the change rides the COO review's existing headline-figure idiom (same SnapshotMetric shape, same render path, two more rows), no new surface, no chrome, no motion; copy names what the number is without claiming attribution causality
MATERIAL_FLOW_CHANGE: NO: the review's Campaigns domain gains two truthful figures in its existing headline list — no new flow, state, transition or exit
FLOW_PROTOTYPE: NOT_REQUIRED: MATERIAL_FLOW_CHANGE is NO and no flow shape changed
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the Solo owner reads the COO review (Chat answer or Executive surface) and sees what their campaigns actually brought in — leads credited to a campaign and the busiest campaign's count — alongside the existing intake health figures
VISUAL_DIRECTION: PASS: incumbent design system unchanged — the figures render through the existing headline machinery
AUTOMATED_EVIDENCE: PASS: 19 tests green in the adapter suite — seven campaign-result cases (durable-grouping credited and busiest, the _other rank-fold counting as credited but never as one campaign, visitor naming never in projections, empty grouping reading zero, refused vocabulary withholding the set, partial-without-untagged withholding the set, partial-WITH-untagged also withholding the aggregates) plus the strengthened incumbent pins (9-headline length, the extended deep-equal map, the privacy pin now asserting the two new keys and the note text)
STATIC_EVIDENCE: PASS: deno check clean on the adapter — the figures derive only from the producer's own grouping (filter, sum, max), the aggregates are withheld on any partial read, and no new metric key or meta path is read
RENDERED_EVIDENCE: UNVERIFIED: no browser session in this environment — the figures ride the review's existing rendered surfaces (Executive, Chat business-review answer), with the browser matrix owed below
BEHAVIORAL_EVIDENCE: PASS: the adapter suite drives the real snapshot through composeBusinessReview and validateDomainSnapshot with the new keys present — plus a read-only live verification this session: the canonical metric engine on the designated account returns exactly the fixture truth these figures surface (leads received 2 — both grouped under the campaign brief by the durable S1a attribution — converted 2)
AUTHENTICATED_RUNTIME: UNVERIFIED: a signed-in owner viewing the COO review with the fixture data is owed at the next authenticated pass
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive element added
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: complete, empty, partial (both shapes), refused-vocabulary and rank-fold states covered by the suite — the aggregates withhold wherever an exact-seeming total would be untrustworthy
TRUTHFUL_STATE_LABELS: PASS: "credited to a campaign" is the producer's own grouping word — the standing note now also says which campaign each lead is credited to lives in Campaigns, not this summary — no causal attribution, conversion, revenue or ROI vocabulary anywhere
SOLO_UI: YES: the four-viewport Solo bar is owed with the rendered/browser pass above — no responsive surface changed in this delta
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
UNVERIFIED: the rendered/browser matrix including the four Solo viewports, the authenticated owner view of the review, and founder acceptance — none claimed complete by this record

OWNER_INTENT: The owner's resumption directive names this exactly — "integrate campaign metrics into EXP02's COO review… without inventing conversion, revenue or ROI." Target actor: the Solo owner reading the COO review. Required outcome: campaign results as honest counts.
MUST_NOT_HAPPEN: No conversion, revenue, ROI or causal-attribution claim — no visitor-supplied campaign naming in any projection — no new metric key, producer or registry — no exact-seeming aggregate on a partial read — no change to any other EXP02 adapter or the snapshot schema
MUST_PRESERVE: The producer's own grouping semantics — the untagged health figure and its withhold rules — the privacy pins — the standing honesty notes — every sibling adapter
ACCEPTANCE_CRITERIA: A signed-in owner's COO review shows leads credited to a campaign and the busiest campaign's count alongside the existing figures — the counts match the Campaigns dossier — an empty campaign grouping reads zero — a partial read withholds the campaign figures rather than guessing
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: affected: truthful state labels (aggregates withheld on partial, the rank-fold counted honestly) — unaffected: the metric producer and registry, every other domain adapter, the snapshot validator, Rail, Memory and Mind

INTERNAL_BUILD_IDENTITY: deb294945eb061e71e01871171e7c54b43f01f47; deployment=local-and-PR-preview; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp03-s2-campaign-metrics-coo-review.md
RELEASE_CHANNEL: development: source release, no activation
RELEASE_CLASSIFICATION: internal-only: two honest figures on an internal review surface, no coherent owner-visible customer outcome boundary crossed
CUSTOMER_RELEASE_IDENTITY: none: acceptance and release authority not established
RELEASE_NOTE_REQUIRED: no: no customer release at this increment
RELEASE_TRUTH_BOUNDARY: PROOF OWED: local source, behavioral and suite proof complete plus the live metric readback — the rendered matrix, authenticated runtime and founder acceptance remain separately owed
RELEASE_RECOVERY: position=reviewed forward release on green CI with normal deployment readback and no rollback-specific machinery beyond the standing release-governance policy; reference=docs/doctrine/release-governance-and-customer-update-policy.md
