# Focused failed-run recovery correction

Root's source audit identified that an event claim alone does not establish absence. The prototype's failed-run message, fixture and evidence now name verified **canonical act readback**, explicitly simulated, with **no committed observation and no live claim**. Both the retry affordance and any verified-absence wording require those recorded conditions. Unknown and uncertain outcomes retain their replay lock.

Current artifact SHA256: `C57AECBBA940ED11824C10EC4AF72B3A0460222004D5E31147388238B073526D`.
Focused evidence: `absence-final-browser-proof.json` — 13 checks PASS, three rendered failed-state captures, no page runtime errors or external requests.

The focused checks cover canonical absence fixture flags, exact simulation-only copy, evidence disclosure, same-reference retry, unknown lock, uncertain readback lock, unknown-to-failed reconciliation requiring absence proof, and a failed label without verified absence keeping retry locked and making no safety claim. The last case first failed and was corrected; its failing transcript is preserved as `absence-guard-before-browser-proof.json`. The reviewer requested that the disabled retry label also avoid a verification claim; it now says **Retry locked pending act readback**, and the third mobile capture shows this unproved branch.

The earlier 64/64 full browser run applies to artifact hash `F895DA7C1A56FAF3CDDDD5A9286404009C20351D2AF38A0515FE3D77BCC5FB4C`, not the current bytes. It remains prior regression evidence; the current focused run is not presented as a full suite on the changed artifact.

The same independent finish reviewer accepted the canonical-absence guard and required one conditional-label fix. Its final verdict scored that label fix **resolved**, disposition **ship**, on current hash `C57AECBB…73526D`, with the earlier verdicts preserved. The reviewer observed no regressions from that label change. This is a scored-fix verdict, not whole-surface or owner approval. Owner approval, authenticated canonical readback and production recovery remain UNVERIFIED.
