# Experience 05 connected weekly responsibility — independent source review, round 1

Status: **COMPLETE — FIX FIRST**

Reviewed immutable target: **5808be974fad9faf34082abb90c96ad94f833828**  
Compared base: **f2e2a0af6e667ea39f8135d9f2f53b719776e52a**  
Draft PR: [#2130](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2130)  
Review completed: 2026-10-14 UTC. Reviewer: separately assigned non-author agent; authored none of this candidate source, tests, or delivery evidence. This is independent agent review, not independent GitHub-account approval, owner design approval, authenticated acceptance, or merge permission.

## Scope and immutable evidence

Read the actual 35-file base-to-target diff, changed source and tests, canonical caller paths, AGENTS merge gate, Flow-by-Flow review/delivery contracts, Second Brain/domain records, and Paige UI review/accessibility/evidence rules. The immutable range has 1,365 insertions/57 deletions; its diff check passed. There is no migration, permission/RLS, canonical weekly writer, execution engine, tool-offer/admission, scheduler/cron, or provider activation change.

Source reads were pinned with `git show 5808be974fad9faf34082abb90c96ad94f833828:<path>`. The initial tracked candidate was unchanged; untracked native harness files were ordinary synthetic evidence preparation, not part of the candidate. I independently compared all 24 tracked product/token source hashes in `outputs/connected-weekly-rendered-review/current-native-complete/proof.json` against the reviewed Git objects: **24 matches, zero mismatches**. Four additional harness inputs are untracked synthetic setup and were not mislabeled as immutable Git source.

The associated A9D97C136CF551DFBA41EE3BF6678EFC2C857809F80D29B5C6F4204795CE0755 native artifact records 420/420 behavioral assertions and 103 captures, but its seam measurements and visual inspection establish the three failures below. Its disposition correctly remains **HISTORICAL / MATERIAL VISUAL FAIL**. Positive structural/behavioral assertions do not override those failures. I inspected the actual light primary-hover, native mobile Chat, and linked Operations frames. These are compiled native-component **synthetic** evidence, not an ordinary authenticated SOLO customer session or proof of the complete production shell.

## Consolidated actionable findings

### F1 — MAJOR / P2: primary button text loses contrast on hover

**Source:** `src/solo/weekly/weekly-responsibility.css:9`, `:12`, `:13`; primary actions at `src/solo/weekly/WeeklyResponsibilityPanel.tsx:72` and `:79`.

The generic `.e5-weekly-panel button:hover` rule has greater background specificity than the primary button's default rule. The primary hover rule changes only opacity, so hover uses `--pg-raised` while retaining the inverted `--pg-canvas` foreground. Both themes lose readable text on the primary review/handoff controls. The normal buttons pass; hover measures approximately **1.13:1 Obsidian and 1.03:1 Mineral**, with the Mineral “Put request in Chat” label nearly disappearing.

**Evidence:** `outputs/connected-weekly-rendered-review/current-native-complete/primary-hover-proof.json` (4 checks: 2 PASS/2 FAIL), `light-primary-hover.png`, `dark-primary-hover.png`; immutable source/token hashes match the native artifact.

**Required correction:** explicitly retain a contrasting primary background/foreground in its hover state. Keep the established theme tokens and existing local-only action semantics.

**Verification:** measure actual rendered normal/hover/focus primary controls in both themes, including “Prepare”, “Review proposal”, and “Put request in Chat”; normal-size text must retain at least 4.5:1 contrast after opacity compositing. Capture the corrected native states and rerun the affected interaction proof.

### F2 — MAJOR / P2: the additive weekly Chat entry overflows the fixed header at narrow widths

**Source:** new mount at `src/solo/SoloPaigeWorkspace.tsx:384`; entry at `src/solo/weekly/WeeklyResponsibilityEntry.tsx:26-28`; new styles at `src/solo/weekly/weekly-responsibility.css:37-39`. Incumbent `.spw-chat-head` in `src/solo/solo-paige-workspace.css:1` is a fixed 46px flex row.

Adding the weekly entry allows its label/button and account context to wrap taller than that row. At 320px its right edge also exceeds the clipped Chat pane; at 390px its approximately 61px height exceeds the 46px header. This clips or overlaps the owner's primary entry and account context. Document-wide overflow checks missed the nested clipped pane.

**Evidence:** `outputs/connected-weekly-rendered-review/current-native-complete/header-bounds-proof.json` (4 checks: 0 PASS/4 FAIL). At 320px dark, button right is 327.81px versus pane right 310.39px. Both 390px themes have a 61.375px button inside a 46px header. `mobile-light-native-chat.png` visibly shows the vertical overflow. These are native components with synthetic context, not production acceptance.

**Required correction:** make the additive entry fit its actual available width and allow an intentional header height/wrap layout without clipping context, hiding the action, or disturbing E1's existing header/composer/scope contract. Scope the repair to the weekly addition rather than changing general shell behavior.

**Verification:** actual native Chat at 320/390px and required desktop/tablet widths, both themes, PAIGE states and long account context. Assert entry/context rectangles lie inside their header/pane, do not intersect unrelated rows, remain keyboard reachable, and preserve the first-run/client/Mission/presence suppression and E1 composition.

### F3 — MAJOR / P2: linked Planning title overlaps the Operations inspector Close control

**Source:** weekly-linked inspector title at `src/solo/operations/OperationsWorkspace.tsx:284-287`; incumbent close positioning at `src/components/ui/sheet.tsx:62-65`, with inspector styling in `src/solo/operations/operations-workspace.css:16`.

The fresh linked record's title is rendered without reserving the corner occupied by the Sheet Close button. In the actual 390px source-navigation frame the text and X intersect. A normal long Planning title therefore obscures its close affordance and text during the new connected inspection flow.

**Evidence:** `outputs/connected-weekly-rendered-review/current-native-complete/ops-header-proof.json` (**FAIL**): title rect extends to 374.66px, while Close occupies 362–376px and overlaps vertically. `mobile-light-actual-operations-source.png` visibly confirms the collision.

**Required correction:** reserve the Close control's space in the Operations inspector header and allow long titles to wrap. Preserve the shared Sheet primitive and the editor's dirty/uncertain close guard.

**Verification:** linked and ordinary Operations inspector titles, narrow 320/390px and desktop, both themes, long/unbroken titles, zoom and keyboard close/focus return. Measure title/close nonintersection and retain guarded dirty/unknown exit behavior.

### F4 — MINOR / P2, required evidence correction: the distinct test/file summary is unsupported

**Source:** `docs/evidence/ui-delivery/experience-05-connected-weekly.md:10` and `docs/delivery/experience-05-weekly-commitment-check.md:43`; the same summary is repeated in the draft PR body.

The candidate asserts “240 distinct cases across21 files.” The reported safeguard run repeats `useBeforeUnloadGuard` and `accountSwitchGuard`, already included in the Operations group; the union is **19 files**. Some constituent counts are also stale against the current incumbent tests. This is a false evidence cardinality claim even though the underlying tests can pass.

**Evidence/correction:** the deduplicated 19-file working-checkout run returned **246/246 PASS**, JSON at `outputs/connected-weekly-source-round1-unsandboxed-tests.json`. It contains weekly/Chat67, Calendar86, Operations56, and remaining realtime/tenant safeguards37; the unload/account files are already in Operations. Replace the unsupported distinct summary everywhere current, preserve old per-run provenance as dated history, and derive any final total from one actual deduplicated exact-head report.

**Critical attribution limit:** root committed `e5700ed4aa9af003a90cdfde43e83cf83f232405` during this rerun, changing the entry/CSS/Operations header for F1–F3. Thus **246/19 is a working-checkout PASS and unique-count readback, not an exact-5808 attestation, final-head review, or release proof**. I have not reviewed or approved e570 as a final candidate. The previous sandbox attempt initialized zero assertions because all19 suites hit Windows EPERM on Vite temporary-cache rename; its `outputs/connected-weekly-source-round1-tests.json` is preserved as an infrastructure-blocked attempt, not a product assertion failure or PASS. The same bounded command was then run outside that sandbox, with no source edits or provider/production calls by this reviewer.

**Verification:** the final frozen head's actual deduplicated JSON plus source identity before/after; report its unique files/assertions accurately and retain separate automated/static/rendered/authenticated classes. Do not promote this reviewer working-tree rerun to the later exact head.

## Source contract dispositions — no additional material finding

- **Owner/session/tenant/persona:** `weekly-owner-read.ts:13-34` assigns an owner ContextIdentity only after the canonical predicate and independently checks the authenticated actor before/after the shared reader. The shared reader rechecks current tenant/active owner before/after, validates payload tenant/actor, and ignores changed epochs. `useWeeklyResponsibility.ts:11-17,25-58` suppresses staff/client personas, masks prior-scope state, invalidates pending requests, and clears private results on relevant auth/context changes. Entry and Calendar controller are keyed to that audience. Scope labels or routes do not supply authority.
- **Private evidence/correlation:** shared projection `weekly-commitment-projection.ts:34-73` admits at most50 typed UUID Planning references and 160 Unicode characters per title, copies an allowlist, and preserves tenant/owner/process/event/act/correlation/receipt checks. Invalid source items remove links rather than inventing identity. Its model serializer `:138-151` explicitly excludes source references/titles. No shared Rail/context tool was admitted or private observation serialized into the Chat proposal.
- **Truth/time:** snapshot parsing rejects executable-next contradictions. The UI separately displays canonical civil schedule/approved zone, actual next UTC instant formatted in the configured business zone, latest attempt, and older verified observation. Missing business zone is explicitly signaled; UTC fallback is labeled UTC rather than silently using browser/staff local time. ISO1–7 and Date/Intl formatting do not calculate recurrence or reserve Calendar time. Latest unknown remains unknown beside older verified history; disabled controls cannot replay it.
- **Calendar lifetime:** one audience-scoped reader and one Sheet live outside the repeated responsive rail. Inspection closes View-options in the same transition; the tested actual Calendar component has one dialog lifetime and returns Escape focus to the board. Booking CRUD, refresh/realtime and Agency routing remain incumbent paths.
- **Fresh personal Planning navigation:** `operations-weekly-source.ts:10-59` accepts one typed UUID, obtains a fresh caller-RLS exact tenant/id row under creator-or-assignee personal scope, and verifies session/current tenant/active membership before/after plus returned row identity/type/version. Loaded lists, CRM/Mission identity and query contents are not authority shortcuts. Selection epochs and keyed workspace remounts reject late results.
- **Existing correction/recovery:** the new point read joins existing source refresh and reuses the raw versioned writer. `OperationsWorkEditor.tsx:31-129` preserves raw CAS precision, disallows a new write while an outcome is uncertain/refused, and retains linked draft/submitted intent only in actor/tenant/item-scoped ephemeral presentation state. Interrupted requests become uncertain on remount, never auto-replay. Sheet/subtab/query guards, explicit draft discard, account/unload safeguards and cancellation inspect-only behavior are preserved. Source activity remains the existing reader.
- **Inert boundary/remaining work:** the local proposal only prefills existing unsent Chat text. Canonical draft/authorization binding and named weekly admission (A2), full bounded history/future controls (D2), and receipt-bound shared no-send notice producer/readback (E) remain expressly unavailable/owed. The code invokes no weekly human control RPC, scheduler, provider sender or trigger. Existing Planning editing is reused, not presented as a weekly execution action.

## Gates and limits

The formal source round is COMPLETE with the four findings above. Root has begun the one consolidated repair/artifact/evidence batch; this report does not approve that changed head. Under AGENTS.md:98-103, disposition the findings and perform the permitted **one final immutable-head recheck** after the source/artifact packet is frozen; stop/escalate if a further completed round would be needed.

Live PR metadata read during this review confirmed target5808, OPEN/DRAFT/mergeable, and no inline review threads. The exact5808 workflow snapshot had four applicable groups SUCCESS (UI evidence, migration lint, Security Audit, Finance proof) and primary CI/Spine IN_PROGRESS; those pending groups are not PASS. CI for a later head must be read independently. No full release verdict is supplied here.

Final native state/viewport/contrast/reflow evidence and fresh Impeccable finish disposition remain required. Old positive captures and structural assertions cannot settle F1–F3. Owner finished-design/permission/protected-fixture/activation ruling remains separate before the first live recurrence. Official-account E5-CV1–9 remain NOT_RUN, authenticated recurring acceptance UNVERIFIED. The committed OFF/zero/no-weekly-cron production baseline is dated existing-backend evidence, not deployment/readback of this UI candidate. No production query, effect, credential/account mutation, external message, source change, or extra reviewer was performed by this reviewer.