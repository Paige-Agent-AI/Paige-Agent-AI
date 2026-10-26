# Capabilities panel Access-column truthfulness — source-grounded verification (ANT-50 / coordinator 4f9b5860)

**Question (coordinator):** explain the literal Access "Unverified" states on the Solo Capabilities list using current canonical source and legitimate role/entitlement/provider readiness. "No facts changed" and passing snapshot tests do not establish that the displayed facts are correct. Repair any demonstrated source/display mismatch through the existing capability contract.

**Verdict: the display is correct — every shown state traces to a canonical source at the right evidence level, and no source/display mismatch is demonstrated.** One structural gap is named below with its existing owner; nothing was repaired because nothing is broken, and adding speculative plumbing would itself violate the one-platform rule. The verification cites sources, not just the tests that pin them.

## What each column actually claims, and its canonical source

**The Access column ("can this account use it right now") on catalogue rows reads a hardcoded "Unverified" — and that is the contractually required floor, not a stub awaiting data.** The panel's evidence level for a catalogue row (`src/solo/SoloWorkspacePanels.tsx` CapabilitiesView; `src/solo/data/useSoloSkills.ts`):

- **Proven before a row can appear at all** — these facts are real and server-resolved: the §60 feature gate (`useTierFeatures().has("skills")`), the §61 row gate (`tier_availability[tierKey]` self-use), and RLS on `paige_skills` (tenant sees platform defaults + its own rows only); only `status='active'` rows are read. Entitlement and listing are therefore verified — and they are *why the row exists*, not something the Access column re-claims.
- **Not composed anywhere in the panel** — per-account runtime access: seat-specific tool emission, workspace authority, connection readiness, Trust lanes. These are resolved exclusively by the chat's per-turn capability manifest (`supabase/functions/_shared/paige-capability-status/`): a projection over the **emitted tool surface** (not skill catalogue slugs), the Spine registry, `workspace-authority.ts`, and readiness resolvers — most-restrictive-wins into `live | needs_approval | needs_setup | proof_owed | planned | unavailable | not_for_tier` (`projection.ts` ProjectionInput; `render.ts` GROUP_*). The wiring is pinned by `src/__tests__/capability-status-tool-wiring.test.ts`: one gatherer feeds BOTH the `capability_status` read tool AND the injected per-turn system block, which the model is directed to treat as authoritative and overriding of general impression.
- **The panel's header states exactly this division**: "Coverage shows released functionality. PAIGE checks permissions and connections when you ask." — literally true against the wired chat contract above.

Under the AGENTS.md state contract — `UNVERIFIED` = "the claim was not proven at the evidence level stated" — the Access claim for a catalogue row is genuinely unproven at the panel's level. Rendering "Available" from listing + entitlement + metadata would be exactly the prohibited fixture-backed capability claim: "Listed is never connected" (R1) and the parser module's own law, "Metadata alone can never assert Live" (`src/solo/catalogue-coverage.ts`).

**The Coverage column (platform release label) reads `paige_skills.metadata.catalogue_coverage`** through `presentCatalogueCoverage` (`src/solo/catalogue-coverage.ts`): only `version:1` objects with states `limited | coming_soon | unverified` render (Limited / Coming Soon / Unverified). Verified against the writer: the canonical populating migration (`supabase/migrations/20271113030000_e2_analytics_catalogue_coverage.sql`) writes only those three states — **no writer ever declares `live`**, and the parser's `default → null` (falling back to the "Listed" pill) is a deliberate fail-safe the parity suite pins: declared-live metadata still renders "Listed" with Access "Unverified" (`SoloParityTruthfulness.test.tsx`: "does not convert metadata Live, provider flags or inactive rows into access").

**The rows that DO show per-account states read canonical per-account sources, never guesses:** Live Conversation derives from `paige_live_terms_status()` per account (acknowledged / revoked / expired / consent-required / checking / unverified — `usePaigeLiveStatus`); Voice input is pinned Available/Active because the dictate mic is live in the composer on the same surface (§13 pinned row); Onboarding & business discovery is the shipped interview path.

## The structural gap, named with its existing owner

The panel cannot display chat-resolved per-account availability for catalogue rows because **no authenticated client-callable door to the resolved manifest exists** — the resolver is composed inside `paige-ai-chat`'s turn pipeline only. Building a manifest endpoint so the panel could render per-account `live/needs_setup/...` states would be a genuine capability-contract extension owned by the capability-status/Chat seam (the `_shared/paige-capability-status` + gateway owners), not an EXP01 panel repair; per the one-platform rule it is recorded here as an identified seam, not built. Until it exists, "Unverified" + ask-PAIGE is the honest ceiling.

## Proof owed (channel-honest)

- **Live row-level readback of `paige_skills` metadata** for a real tenant (confirm production rows match the writer grammar; no DB seam is available in this session window — recorded, not manufactured).
- **Authenticated panel viewing** in the founder window (the rendered list on the designated ordinary account).

## Files this verification read (current main `e0263aac0`)

`src/solo/SoloWorkspacePanels.tsx` (CapabilitiesView), `src/solo/data/useSoloSkills.ts`, `src/solo/catalogue-coverage.ts`, `src/solo/usePaigeLiveStatus.ts`, `supabase/functions/_shared/paige-capability-status/{projection,render}.ts`, `supabase/functions/_shared/paige-capability-gateway/gateway.ts`, `supabase/functions/paige-ai-chat/index.ts` (manifest eligibility + injection), `supabase/migrations/20271113030000_e2_analytics_catalogue_coverage.sql`, `src/__tests__/capability-status-tool-wiring.test.ts`, `src/solo/SoloParityTruthfulness.test.tsx`, `AGENTS.md` (state-contract definitions).
