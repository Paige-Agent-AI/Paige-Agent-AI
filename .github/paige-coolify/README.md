# PAIGE Agent AI deployment to PAIGE Cloud

PAIGE Agent AI owns its application source, pull requests and CI in this repository. This workflow is the application's integration with PAIGE Cloud. Other PAIGE Cloud projects can keep their own source, release policy and credentials.

The production workflow accepts a successful push run of the canonical `ci` workflow for the current `main` commit and rechecks the corresponding merge and release maintainer. The image build uses the exact Git checkout. Pull requests that touch the hosting integration run a separate image check with read-only permissions. They do not publish an image or run the production deploy job.

The `paige-coolify-production` GitHub environment accepts deployments from the `main` branch. Keep `PAIGE_COOLIFY_DEPLOY_TOKEN` there as an environment secret. It needs Coolify read, write and deploy permissions for only `paige-full-app`. Run the workflow with **Check the app-scoped Coolify token without deploying** before setting the repository variable `PAIGE_AUTO_DEPLOY_ENABLED` to `true`.

Coolify must be able to pull the canonical production package `ghcr.io/paige-agent-ai/paige-agent-ai-web`. Retain the previously verified package and digest until the first canonical image is live and healthy. The job records the prior image configuration and public source before it changes Coolify's image fields. If an API call or deployment fails, check Coolify's queue and public `/release.json` before retrying. When recovery is needed, select the previous image repository and its verified `sha256-...` tag together, redeploy, and check all three public domains. Set `PAIGE_AUTO_DEPLOY_ENABLED` to `false` before manual recovery and let any active job settle first.

A manual build or retry accepts the run ID from the successful canonical `main` CI push. It uses the same exact-commit and health checks.
