# PAIGE Agent AI deployment to PAIGE Cloud

PAIGE Agent AI owns its application source, pull requests and CI in this repository. This workflow is the application's integration with PAIGE Cloud. Other PAIGE Cloud projects can keep their own source, release policy and credentials.

The production workflow accepts a successful push run of the canonical `ci` workflow for the current `main` commit and rechecks the corresponding merge and release maintainer. The image build uses the exact Git checkout. Pull requests that touch the hosting integration run a separate image check with read-only permissions. They do not publish an image or run the production deploy job.

The `paige-coolify-production` GitHub environment accepts deployments from the `main` branch. Keep `PAIGE_COOLIFY_DEPLOY_TOKEN` there as an environment secret. It needs Coolify read, write and deploy permissions for only `paige-full-app`. Run the workflow with **Check the app-scoped Coolify token without deploying** before setting the repository variable `PAIGE_AUTO_DEPLOY_ENABLED` to `true`.

Coolify must be able to pull the canonical production package `ghcr.io/paige-agent-ai/paige-agent-ai-web`. Keep the previously verified image by digest. Before changing the image fields, the deploy job requires evidence that the applied Coolify configuration, actual image pull and source served on all three domains agree on the current release. This becomes the rollback target. Promotions serialize in the existing production concurrency group. Coordinate manual Coolify changes outside an active workflow run.

## Release receipts

Image publication produces `paige-app-release-<attempt>` with source, digest and CI provenance. Each production attempt records preflight in `paige-production-intent-<run-id>-<attempt>`. A successful upload and matching recheck are prerequisites to changing Coolify. This leaves a workflow artifact with the verified rollback target if the runner is lost later.

Find the promotion result in the Actions summary and the `paige-production-receipt-<run-id>-<attempt>` artifact under the repository's retention policy. It records the candidate, approved PR and merger, CI and workflow run, preflight artifact ID, previous verified release, provider deployment ID when known, and result.

| Receipt result | Meaning |
| --- | --- |
| `blocked` | A prerequisite failed before any Coolify mutation was attempted. |
| `ready` | Preflight passed. The uploaded intent alone does not establish that any deploy was requested. |
| `already-live` | Both source commits and the exact image digest match the applied release. No new deployment was queued. |
| `verified` | Coolify finished, its applied config and digest pull match, and all three public domains serve the approved commit. |
| `failed` | Coolify returned a terminal unsuccessful deployment status. Review the current live state before retry or recovery. |
| `unconfirmed` or `pending` | An operation may have been applied, or the runner was interrupted. Reconcile the receipt stage, Coolify queue, applied image and all public manifests before proceeding. Runner loss can also interrupt artifact upload. |

When recovery is needed, set `PAIGE_AUTO_DEPLOY_ENABLED` to `false` and let any active job settle. Select the previous image repository and its verified digest together, redeploy, and check all three public domains. Use the receipt's `previous.image` only when it was established by preflight. Keep automatic promotion disabled after an intentional rollback until a new approved commit supersedes the rolled-back commit on `main`. A rerun with the same source as the current live release and a different digest is blocked for reconciliation.

A manual build or retry accepts the run ID from the successful canonical `main` CI push. It uses the same exact-commit and health checks.
