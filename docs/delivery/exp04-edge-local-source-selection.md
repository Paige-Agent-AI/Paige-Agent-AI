# EXP04 — reuse the original vendor bundler before a large source upload

Status: implementation candidate, not deployment or customer acceptance. Original
ANT-51 O1–O12 and ANT-161/eff75565 govern. E04 owns the existing deployment helper;
this consumes E09's reviewed, UNAPPLIED aid9302f45c without taking over its Portal.

## Customer outcome and original architecture

MERIT's original commercial readers and the native agreement-signing repairs
need a verified current Chat deployment before authenticated integration proof.
E06's source-layout correction is merged as1d249df0648d003ffa3a3436987cdb978d970d38.
That fixes the source-root leg, not the separate upload or readback leg.

The original failed upload40806385308 returned413 with categoryOTHER. That is
still api_failed_no_retry; no broader retry predicate or historical replay is
introduced. The same edge-deploy.py now measures the original verifier's trusted
committed local graph and selects the existing vendor local route BEFORE its
first upload when that graph exceeds a4MiB routing budget. Smaller graphs keep
the original API-first route and exact explicit-size recovery predicate.

The4MiB value is headroom, not a measurement of the API request, compiled bundle,
remote dependencies or a promise that compilation fits. At actual main1d249df0,
the unchanged original graph has302 local files/5,124,355 raw bytes, no configured
import map and verify_jwt=true; it selects local_requested without provider I/O.
The [vendor size guidance](https://supabase.com/kb/troubleshooting/edge-function-bundle-size-issues)
and [pinned CLI source](https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/shared/functions/deploy.ts)
support the existing local-bundling route. Actual vendor execution remains owed.

Preserved: original certified baseline/project/config, dirty-source refusal,
committed graph resolver, import-map hold, Docker readiness, mutually exclusive
vendor flags, JWT setting,600-second total deadline, unknown-outcome refusal,
mandatory downloaded-source verifier and existing edge-live guard. Source is
checked again after Docker readiness, immediately before the sole local upload.
Local failure or uncertainty never falls back to an API upload. Raw vendor
payloads/credentials remain private. No new uploader, credential, source
rewriter, emission helper, lock, workflow, provider adapter or activation.

## Verification and review boundaries

Original source plus the11 proposed causal controls genuinely fails9 tests;
two pre-existing refusals already pass. Retained log:
outputs/e04-c114-selection-before-source.log. No production upload is used to
create the failure. The WHOLE original compiler/readback/deploy suite plus new controls passes141/141
in300.861seconds on the composed candidate, using the existing pinned Deno2.1.4.
This includes the actual frozen compiler and original credential/effect-permission
controls. Exact-head review and required hosted gates remain separate.

The tests use real immutable local Git fixtures and scripted vendor responses.
They do not prove Docker compilation, provider acceptance, a deployed source
identity or customer behavior. Original verifier/emitter/lock/workflow remain
unchanged; all existing assertions and strict413/unknown controls are retained.

## Release and recovery

Internal-only development. No migration, release name, announcement, new account,
role, send, signature, payment, provider activation or held Chat admission change.
Use the ONE existing reviewed pipeline on an eligible current main after the
required checks, then download its full source certificate. Acknowledged upload
alone is not verified release. Never manually advance edge-live or retry an
uncertain earlier operation to get a green status.

Functional source, exact review/CI, merge, web, selected Edge upload, full source
readback, activation, authenticated MERIT/signing behavior and final integrated
founder acceptance remain distinct. ALG-01/12 stayPARTIAL, ALG-02 incomplete,
ALG-13 UNVERIFIED and cataloguePROOF_OWED. This repairs deployment plumbing; it
does not create a commercial action, LayerC execution, business receipt or close
any of the original twelve customer outcomes by itself.
