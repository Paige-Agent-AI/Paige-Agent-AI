import assert from "node:assert/strict";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { releaseMaintainer, verifyRelease } from "./verify-release.mjs";

const appId = "qucl8euvl1vjcg1z3nryqadb";
const appPath = `/applications/${appId}`;
const historyPath = `/deployments/applications/${appId}`;
const image = "ghcr.io/paige-agent-ai/paige-agent-ai-web";
const previousPackage = "ghcr.io/paige-agent-ai/paige-cloud-preview";
const domains = ["https://app.paigeagent.ai", "https://paigeagent.ai", "https://www.paigeagent.ai"];
const digestTag = /^sha256-[a-f0-9]{64}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const runPattern = /^[1-9][0-9]{0,14}$/;
const deploymentId = /^[a-z0-9]{20,32}$/;
const terminalStatuses = ["finished", "failed", "cancelled-by-user", "skipped"];

function makeCoolifyClient(token, fetchFrom) {
  return async (path, { method = "GET", body, allowDenied = false } = {}) => {
    const response = await fetchFrom(`https://app.coolify.io/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (allowDenied && [403, 404].includes(response.status)) return;
    assert.ok(!allowDenied, `Credential scope check failed at ${path} (HTTP ${response.status})`);
    assert.ok(response.ok, `Coolify ${method} ${path} returned HTTP ${response.status}`);
    return response.json();
  };
}

async function currentApp(coolify) {
  const app = await coolify(appPath);
  assert.equal(app.uuid, appId);
  assert.equal(app.name, "paige-full-app");
  assert.equal(app.build_pack, "dockerimage");
  assert.ok([image, previousPackage].includes(app.docker_registry_image_name));
  assert.equal(app.is_http_basic_auth_enabled, false);
  assert.equal(app.health_check_enabled, true);
  assert.equal(app.health_check_path, "/healthz");
  assert.deepEqual(app.fqdn.split(",").sort(), domains);
  assert.match(app.docker_registry_image_tag, digestTag);
  return app;
}

async function noActiveDeployment(coolify) {
  const { deployments } = await coolify(historyPath);
  assert.ok(Array.isArray(deployments));
  assert.ok(deployments.every(item => terminalStatuses.includes(item.status)),
    "An active or unknown Coolify deployment must be resolved before promotion");
  return deployments;
}

async function assertHealthyReleaseTag(coolify, tag, expectedImage = image) {
  const app = await currentApp(coolify);
  assert.equal(app.status, "running:healthy");
  assert.equal(app.docker_registry_image_name, expectedImage);
  assert.equal(app.docker_registry_image_tag, tag);
  return app;
}

async function liveRelease(fetchFrom, expected) {
  const releaseIds = await Promise.all(domains.map(async domain => {
    const options = { redirect: "error", signal: AbortSignal.timeout(10000) };
    const [version, health, home, signup] = await Promise.all([
      fetchFrom(`${domain}/release.json`, options), fetchFrom(`${domain}/healthz`, options),
      fetchFrom(`${domain}/`, options), fetchFrom(`${domain}/auth?mode=signup`, options),
    ]);
    assert.equal(version.status, 200, `Release metadata unavailable on ${domain}`);
    assert.equal(health.status, 200, `Health check failed on ${domain}`);
    assert.equal((await health.text()).trim(), "ok");
    assert.equal(home.status, 200, `Public homepage unavailable on ${domain}`);
    assert.equal(signup.status, 200, `Signup entry unavailable on ${domain}`);
    await Promise.all([home.body?.cancel(), signup.body?.cancel()]);
    const { frontendCommit, cloudCommit } = await version.json();
    assert.match(frontendCommit, commitPattern);
    assert.match(cloudCommit, commitPattern);
    return { frontendCommit, cloudCommit };
  }));
  for (const release of releaseIds) assert.deepEqual(release, expected ?? releaseIds[0]);
  return releaseIds[0];
}

async function waitForDeployment(coolify, pause, uuid) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const { status, deployment_uuid } = await coolify(`/deployments/${uuid}`);
    assert.equal(deployment_uuid, uuid);
    if (terminalStatuses.includes(status)) return status;
    assert.ok(["queued", "in_progress"].includes(status), `Unknown deployment status ${status}`);
    await pause(5000);
  }
  throw new Error(`Deployment ${uuid} is unconfirmed. Reconcile in Coolify before retrying.`);
}

async function deployTag(coolify, tag, checkpoint) {
  await coolify(appPath, { method: "PATCH", body: { docker_registry_image_name: image, docker_registry_image_tag: tag } });
  const saved = await currentApp(coolify);
  assert.equal(saved.docker_registry_image_name, image);
  assert.equal(saved.docker_registry_image_tag, tag);
  checkpoint("queue-request");
  const result = await coolify("/deploy", { method: "POST", body: { uuid: appId } });
  const deployment = result.deployments?.find(job => job.resource_uuid === appId)?.deployment_uuid;
  assert.match(deployment ?? "", deploymentId,
    "Deployment ID missing. Reconcile Coolify state before retrying.");
  return deployment;
}

async function assertAppliedDeployment(coolify, app, deployment) {
  assert.match(deployment ?? "", deploymentId);
  const snapshot = await coolify(`/deployments/${deployment}`);
  assert.equal(snapshot.deployment_uuid, deployment);
  assert.equal(snapshot.status, "finished");
  assert.ok(snapshot.configuration_hash && snapshot.configuration_hash === app.config_hash,
    "Coolify has not confirmed the applied configuration");
  const digest = app.docker_registry_image_tag.replace("-", ":");
  const expectedLine = `Image ${app.docker_registry_image_name}@${digest} Pulled`;
  const logs = typeof snapshot.logs === "string" ? JSON.parse(snapshot.logs) : snapshot.logs;
  assert.ok(Array.isArray(logs) && logs.some(entry =>
    typeof entry?.output === "string" && entry.output.split("\n").some(line => line.trim() === expectedLine)),
    "Coolify logs did not confirm that exact image pull");
  return { deployment, image: `${app.docker_registry_image_name}@${digest}` };
}

async function verifyServingDeployment(coolify, fetchFrom, pause, deployment, tag, expected) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const app = await assertHealthyReleaseTag(coolify, tag);
      const history = await noActiveDeployment(coolify);
      assert.equal(history[0]?.deployment_uuid, deployment, "A different deployment has taken precedence");
      await assertAppliedDeployment(coolify, app, deployment);
      await liveRelease(fetchFrom, expected);
      return;
    } catch (error) {
      if (attempt === 11) throw new Error(`Deployment ${deployment} finished but live verification failed. Reconcile in Coolify.`, { cause: error });
      await pause(5000);
    }
  }
}

export async function deploy(options, { fetchFrom = fetch, verify = verifyRelease, pause = setTimeout, save } = {}) {
  const { mode, token, frontendCommit, digest, ciRun, runId, runAttempt, actorId, planPath, planArtifactId } = options;
  assert.ok(["--check", "--prepare", "--promote"].includes(mode));
  const promote = mode === "--promote";
  const record = mode !== "--check";
  const candidate = digestPattern.test(digest ?? "") ? `${image}@${digest}` : null;
  const receipt = {
    schema: 1,
    repository: "Paige-Agent-AI/Paige-Agent-AI",
    environment: "paige-coolify-production",
    appId,
    domains,
    startedAt: new Date().toISOString(),
    candidate: { commit: commitPattern.test(frontendCommit ?? "") ? frontendCommit : null, image: candidate },
    approval: { ciRun: runPattern.test(ciRun ?? "") ? ciRun : null, pullRequest: null, mergerId: null },
    workflow: {
      runId: runPattern.test(runId ?? "") ? runId : null,
      attempt: runPattern.test(runAttempt ?? "") ? runAttempt : null,
      actorId: runPattern.test(actorId ?? "") ? actorId : null,
    },
    previous: null,
    preparation: null,
    planArtifactId: runPattern.test(planArtifactId ?? "") ? planArtifactId : null,
    deployment: null,
    providerStatus: null,
    stage: "input",
    result: "pending",
  };
  function checkpoint(stage) {
    receipt.stage = stage;
    if (record) save(receipt);
  }
  function finish(result) {
    receipt.result = result;
    receipt.finishedAt = new Date().toISOString();
    if (record) save(receipt);
    return receipt;
  }

  if (record) assert.equal(typeof save, "function", "Promotion requires a receipt writer");
  checkpoint("input");
  let mutationStarted = false;
  try {
    assert.ok(token, "Add the paige-full-app-only PAIGE_COOLIFY_DEPLOY_TOKEN Actions secret");
    if (record) {
      assert.ok(receipt.candidate.commit && candidate && receipt.approval.ciRun &&
        receipt.workflow.runId && receipt.workflow.attempt && receipt.workflow.actorId, "Invalid release provenance");
      checkpoint("approval");
      receipt.approval.pullRequest = await verify(frontendCommit, ciRun);
      receipt.approval.mergerId = releaseMaintainer;
    }
    checkpoint("credential-scope");
    const coolify = makeCoolifyClient(token, fetchFrom);
    const [app] = await Promise.all([
      currentApp(coolify),
      coolify("/team", { allowDenied: true }),
      coolify("/applications/vnh5vfaqnq0fkkgfalgda8gx", { allowDenied: true }),
      coolify("/applications/izwrky18u9ixdhstnulxpjs5", { allowDenied: true }),
    ]);
    const listed = await coolify("/applications");
    assert.ok(Array.isArray(listed) && listed.length === 1 && listed[0].uuid === appId,
      "Token must see only paige-full-app");
    checkpoint("previous-release");
    assert.equal(app.status, "running:healthy");
    const history = await noActiveDeployment(coolify);
    const prior = await assertAppliedDeployment(coolify, app,
      history.find(item => item.status === "finished")?.deployment_uuid);
    receipt.previous = { ...await liveRelease(fetchFrom), ...prior };
    if (!record) return finish("scope-and-live-check-passed");
    receipt.preparation = { configHash: app.config_hash, latestDeployment: history[0]?.deployment_uuid };
    assert.match(receipt.preparation.latestDeployment ?? "", deploymentId, "Invalid Coolify queue head");

    const actual = receipt.previous;
    const sameSource = actual.frontendCommit === frontendCommit && actual.cloudCommit === frontendCommit;
    const alreadyLive = sameSource && actual.image === candidate;
    checkpoint("candidate");
    assert.ok(alreadyLive || (!sameSource && actual.image !== candidate), "Candidate digest or source conflicts with the live release");
    if (promote) {
      assert.ok(receipt.planArtifactId && planPath, "Upload the same-run production plan before promoting");
      const plan = JSON.parse(readFileSync(planPath, "utf8"));
      assert.equal(plan.result, "ready", "Production plan has not passed preflight");
      for (const key of ["schema", "repository", "environment", "appId", "candidate", "approval", "workflow", "previous", "preparation"]) {
        assert.deepEqual(plan[key], receipt[key], `Production plan has changed at ${key}`);
      }
    }
    assert.equal(await verify(frontendCommit, ciRun), receipt.approval.pullRequest);
    const latestApp = await assertHealthyReleaseTag(coolify, app.docker_registry_image_tag, app.docker_registry_image_name);
    const latestHistory = await noActiveDeployment(coolify);
    assert.ok(latestApp.config_hash && latestApp.config_hash === app.config_hash &&
      latestHistory[0]?.deployment_uuid === history[0]?.deployment_uuid, "Production changed during preflight");
    if (!promote) return finish("ready");
    if (alreadyLive) {
      receipt.deployment = actual.deployment;
      receipt.providerStatus = "finished";
      return finish("already-live");
    }

    checkpoint("patch-request");
    mutationStarted = true;
    receipt.deployment = await deployTag(coolify, digest.replace(":", "-"), checkpoint);
    checkpoint("deployment-queued");
    receipt.providerStatus = await waitForDeployment(coolify, pause, receipt.deployment);
    if (receipt.providerStatus !== "finished") {
      finish("failed");
      throw new Error("The deployment did not finish. Reconcile Coolify before retrying.");
    }
    checkpoint("live-verification");
    await verifyServingDeployment(coolify, fetchFrom, pause, receipt.deployment, digest.replace(":", "-"),
      { frontendCommit, cloudCommit: frontendCommit });
    return finish("verified");
  } catch (error) {
    if (receipt.result === "pending") finish(mutationStarted ? "unconfirmed" : "blocked");
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, frontendCommit, digest, ciRun] = process.argv.slice(2);
  const path = process.env.PAIGE_RELEASE_RECEIPT;
  function save(receipt) {
    assert.ok(path, "Set PAIGE_RELEASE_RECEIPT to the workflow receipt path");
    const json = JSON.stringify(receipt, null, 2) + "\n";
    const pending = `${path}.tmp`;
    writeFileSync(pending, json, { flush: true, mode: 0o600 });
    renameSync(pending, path);
    if (receipt.result !== "pending") console.log(json);
  }
  const result = await deploy({
    mode, frontendCommit, digest, ciRun, token: process.env.PAIGE_COOLIFY_DEPLOY_TOKEN,
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    actorId: process.env.GITHUB_ACTOR_ID,
    planPath: process.env.PAIGE_RELEASE_PLAN,
    planArtifactId: process.env.PAIGE_RELEASE_PLAN_ARTIFACT,
  }, { save });
  if (mode === "--check") console.log(JSON.stringify(result));
}
