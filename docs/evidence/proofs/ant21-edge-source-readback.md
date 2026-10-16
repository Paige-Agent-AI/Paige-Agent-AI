# ANT-21 — bounded Edge release source verification

## Intended usable outcome and flow

An authorized ordinary release of PAIGE's shared implementation must establish
which selected Edge source actually reached production before recording
`edge-live`. Customers must receive the reviewed repair rather than only a
successful upload message. This patch adds source verification to the existing
release workflow; it does not add a product capability or an execution engine.

Actor: the existing GitHub release job. Entry: its existing main push or manual
dispatch. Flow: incumbent baseline/import selection → incumbent deployment and
retirement → isolated source download/configuration readback → exact selected
source verification → existing release tag. A failed readback keeps successful
partial deployments live and withholds certification. Recovery uses the existing
manual dispatch and targeted authorized release procedure.

## Grounding and ownership

- Isolated branch `fix/ant21-edge-release-source-readback`, based on reviewed
  Knowledge composition `b26c7ffdea4dc5601a4186ed470e14b7c595248a`.
- Fresh main during grounding: `922787c67e425e75f0f723bd3bee0b77f2f2dc54`.
  The 30 most recently updated open PR file lists and ANT-6 ownership record were
  inspected; no active writer of this deployment workflow/import helper was
  found. Knowledge's separate `ci.yml` change and all other source leases remain
  untouched. The existing import-graph helper is reused byte-for-byte.
- Existing #2236 workflow run38863175296/job116849912505 checked out922787,
  selected Chat, bundled it06:48:29UTC, uploaded2.3MB06:48:31, reported deployed
  06:48:34, then advanced `edge-live`06:49:20. Subsequent authoritative source
  readback required an authorized targeted correction. The underlying provider
  or CLI cause is **UNVERIFIED**; Docker, a version bug, caching, or an overwrite
  is not inferred from those logs.

## Routing and preserved contracts

This is internal release housekeeping owned by the active restoration lead.
Harness/Spine/Trust/domain writers, approvals, actor/tenant authority, durable
jobs and Rail contracts are unchanged. No new Spine key, action-risk class,
MUTATION_VERB, business confirmation, account provisioner, registry, store or
provider connection is introduced. Supabase Management reads use the release
job's existing authenticated CLI; the helper never reads, prints or rotates a
token. No secret/configuration/provider activation or business effect is run by
the fixture tests. No UI or Binding Ledger state changes; no visual design
approval or browser matrix is applicable to this internal workflow.

The change is shared and account-independent. It does not select customers,
alter eligibility/entitlements, or claim authenticated parity/new-account proof.
The exact18-capability/50-row registers and their acceptance scope remain intact.

## Implementation and failure behavior

- Match the immutable checked-out commit, configured entrypoint/JWT posture,
  ACTIVE metadata and downloaded source. A version increase is not required and
  cannot substitute for source verification.
- Reuse `.github/scripts/edge-affected.py` for transitive relative imports.
  Require every expected local source and check every downloaded local file
  against the exact commit, including known additional files. Check configured
  and automatically discovered import-map bytes; unexpected maps are refused.
- Reuse incumbent archive normalization: UTF-8, CRLF→LF, ensure a terminal LF
  without trimming other whitespace. Do not compare rewritten implementation
  bytes or renew protected source fingerprints.
- Download each selected function into a fresh isolated temporary project with
  explicit project/workdir arguments. Never copy authentication state, follow a
  download symlink or overwrite the checkout. Capture and discard CLI raw output
  and exceptions; expose only fixed failure reasons and bounded source hashes.
- Re-observe metadata after downloads. Identity changes invalidate the proof.
  Preserve a good function across retries only while its identity remains equal.
  At most3attempts,5seconds between attempts,60seconds per CLI call and a
  600-second provider-readback budget. No automatic redeploy, rollback or
  business action is added.
- Preserve deployment-loop continuation, retirement-before-deploy and
  `always()` retirement handling. Explicit zero selected/retired outputs avoid
  treating skipped empty outputs as work on workflow-only releases.
- The existing tag requires successful readback. Its actual shell guard also
  checks that an earlier unverified source/configuration gap cannot be skipped
  by a later narrow push. Compare source trees, not commit equality, so ordinary
  frontend-only commits do not cause a hold. Existing manual dispatch uses
  `edge-live` as its recovery baseline.

Explicit proof limits: this thin local-source checker does not certify external
dependency contents or perform business-runtime tests. Nonstandard nested
entrypoint layouts, local import-map aliases, nested map references, JSONC that
requires parsing extensions, and configured static assets are explicitly refused
rather than silently claiming full coverage. Current checked source uses no
configured static assets or local import-map aliases. Extending those layouts
requires their own bounded executable coverage, not a bypass switch.

## Official CLI grounding

Pinned CLI2.116.0's `functions download --help` and `functions list --help` were
executed locally without project calls: `--use-api`, `--project-ref`, `--workdir`
and `-o json` are supported. Official docs and exact tagged source were read:

- [Download reference](https://supabase.com/docs/reference/cli/supabase-functions-download).
- [List reference](https://supabase.com/docs/reference/cli/supabase-functions-list).
- [Pinned downloader and destination containment](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/shared/functions/download.ts).
- [Pinned list JSON fields](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/legacy/commands/functions/list/list.encoders.ts).
- [Pinned entrypoint/import-map discovery](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/shared/functions/deploy.ts).

## Verification and remaining gates

Failing-first proof: the actual original workflow fails the missing-readback
regression. The actual tag-step shell also initially returned success for a
prior unverified-source gap; the negative fixture failed before its repair.

Protected tests execute the actual helper and actual tag-guard shell with neutral
Git/source/CLI fixtures, covering stale Chat plus good CRM; missing transitive
dependencies; zero-exit/empty download; download/list failure; wrong JWT,
entrypoint, import map, archive identity or inactive metadata; before/after races;
unchanged valid source/version; bounded recovery; complete byte comparison;
unknown extra files; checkout mismatch; malformed selection; CLI secret-output
suppression; temporary-workdir/symlink safety; deadline exhaustion; generic new
function behavior; and skipped-prior-release/normal/manual-recovery tag behavior.

Local results: **PASS**41stdlib fixture tests, the existing-unit-job Vitest
wrapper1/1 with a minimum41-test collection guard and no skipped fixtures,
focused lint, Python syntax, workflow YAML,10actual Bash block syntax checks and
whitespace. These are protected local source/CLI-adapter fixtures, not provider
or production download proof.

Commands:

```text
python -B -m unittest discover -s .github/scripts -p test_edge_source_readback.py -v
node node_modules/vitest/vitest.mjs run src/__tests__/edge-release-source-readback.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/edge-release-source-readback.test.ts
git diff --check
```

The Vitest wrapper makes the same stdlib contract part of the existing required
unit-test job; its Node environment avoids a browser-URL test harness mismatch
found and corrected during implementation. No global CI workflow change or
dependency change is required. Local immutable-source manifest checks cover
Chat228files, CRM14, Knowledge ingestion6 and the existing explicitly mapped
business-mission entrypoint9; this is local-source proof only.

Independent non-author review, final exact-head hosted CI, merge, production
workflow/selected-source readback and owner acceptance remain **PROOF OWED**.
This candidate has not been pushed or deployed and makes no customer release
announcement. Current Chat421/CRM106, governed activation, prior releases and
Stripe Connect13 are preserved. Recovery is a reviewed workflow forward fix;
never re-enable a vulnerable executor or fabricate a source proof to move a tag.
