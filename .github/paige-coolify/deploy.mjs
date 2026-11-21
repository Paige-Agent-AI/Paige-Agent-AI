import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { verifyRelease } from "./verify-release.mjs";

const appId = "qucl8euvl1vjcg1z3nryqadb";
const appPath = `/applications/${appId}`;
const historyPath = `/deployments/applications/${appId}`;
const image = "ghcr.io/paige-agent-ai/paige-agent-ai-web";
const previousPackage = "ghcr.io/paige-agent-ai/paige-cloud-preview";
const domains = ["https://app.paigeagent.ai", "https://paigeagent.ai", "https://www.paigeagent.ai"];
const token = process.env.PAIGE_COOLIFY_DEPLOY_TOKEN;
const [mode, frontendCommit, digest, ciRun] = process.argv.slice(2);
const cloudCommit = frontendCommit;
const digestTag = /^sha256-[a-f0-9]{64}$/;
const terminalStatuses = ["finished", "failed", "cancelled-by-user", "skipped"];
assert.ok(token, "Add the paige-full-app-only PAIGE_COOLIFY_DEPLOY_TOKEN Actions secret");
assert.ok(["--check", "--promote"].includes(mode));

async function coolify(path, { method = "GET", body, allowDenied = false } = {}) {
  const response = await fetch(`https://app.coolify.io/api/v1${path}`, {
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
}

async function currentApp() {
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

async function noActiveDeployment() {
  const { deployments } = await coolify(historyPath);
  assert.ok(Array.isArray(deployments));
  assert.ok(deployments.every(item => terminalStatuses.includes(item.status)),
    "An active or unknown Coolify deployment must be resolved before promotion");
  return deployments;
}

async function assertHealthyReleaseTag(tag, expectedImage = image) {
  const app = await currentApp();
  assert.equal(app.status, "running:healthy");
  assert.equal(app.docker_registry_image_name, expectedImage);
  assert.equal(app.docker_registry_image_tag, tag);
  return app;
}

async function liveRelease(expected) {
  const releaseIds = await Promise.all(domains.map(async domain => {
    const options = { redirect: "error", signal: AbortSignal.timeout(10000) };
    const [version, health, home, signup] = await Promise.all([
      fetch(`${domain}/release.json`, options), fetch(`${domain}/healthz`, options),
      fetch(`${domain}/`, options), fetch(`${domain}/auth?mode=signup`, options),
    ]);
    assert.equal(version.status, 200, `Release metadata unavailable on ${domain}`);
    assert.equal(health.status, 200, `Health check failed on ${domain}`);
    assert.equal((await health.text()).trim(), "ok");
    assert.equal(home.status, 200, `Public homepage unavailable on ${domain}`);
    assert.equal(signup.status, 200, `Signup entry unavailable on ${domain}`);
    await Promise.all([home.body?.cancel(), signup.body?.cancel()]);
    const { frontendCommit, cloudCommit } = await version.json();
    assert.match(frontendCommit, /^[a-f0-9]{40}$/);
    assert.match(cloudCommit, /^[a-f0-9]{40}$/);
    return { frontendCommit, cloudCommit };
  }));
  for (const release of releaseIds) assert.deepEqual(release, expected ?? releaseIds[0]);
  return releaseIds[0];
}

async function waitForDeployment(uuid) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const { status, deployment_uuid } = await coolify(`/deployments/${uuid}`);
    assert.equal(deployment_uuid, uuid);
    if (terminalStatuses.includes(status)) return status;
    assert.ok(["queued", "in_progress"].includes(status), `Unknown deployment status ${status}`);
    await setTimeout(5000);
  }
  throw new Error(`Deployment ${uuid} is unconfirmed. Reconcile in Coolify before retrying.`);
}

async function deployTag(tag) {
  await coolify(appPath, { method: "PATCH", body: { docker_registry_image_name: image, docker_registry_image_tag: tag } });
  const saved = await currentApp();
  assert.equal(saved.docker_registry_image_name, image);
  assert.equal(saved.docker_registry_image_tag, tag);
  const result = await coolify("/deploy", { method: "POST", body: { uuid: appId } });
  const deployment = result.deployments?.find(job => job.resource_uuid === appId)?.deployment_uuid;
  assert.match(deployment ?? "", /^[a-z0-9]{20,32}$/,
    "Deployment ID missing. Reconcile Coolify state before retrying.");
  console.log(JSON.stringify({ appId, deployment, tag, result: "queued" }));
  return { deployment, status: await waitForDeployment(deployment) };
}

async function verifyServingDeployment(deployment, tag, expected) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const { config_hash } = await assertHealthyReleaseTag(tag);
      const snapshot = await coolify(`/deployments/${deployment}`);
      assert.equal(snapshot.deployment_uuid, deployment);
      assert.ok(snapshot.configuration_hash && config_hash === snapshot.configuration_hash,
        "Coolify has not confirmed the applied configuration");
      await liveRelease(expected);
      return;
    } catch (error) {
      if (attempt === 11) throw new Error(`Deployment ${deployment} finished but live verification failed. Reconcile in Coolify.`, { cause: error });
      await setTimeout(5000);
    }
  }
}

const [app] = await Promise.all([
  currentApp(),
  coolify("/team", { allowDenied: true }),
  coolify("/applications/vnh5vfaqnq0fkkgfalgda8gx", { allowDenied: true }),
  coolify("/applications/izwrky18u9ixdhstnulxpjs5", { allowDenied: true }),
]);
const listed = await coolify("/applications");
assert.deepEqual(listed.map(resource => resource.uuid), [appId], "Token must see only paige-full-app");
assert.equal(app.status, "running:healthy");
const previous = await liveRelease();
const history = await noActiveDeployment();
if (mode === "--check") {
  const priorDeployment = history.find(deployment => deployment.status === "finished")?.deployment_uuid;
  assert.match(priorDeployment ?? "", /^[a-z0-9]{20,32}$/);
  const snapshot = await coolify(`/deployments/${priorDeployment}`);
  assert.equal(snapshot.deployment_uuid, priorDeployment);
  assert.ok(snapshot.configuration_hash && snapshot.configuration_hash === app.config_hash,
    "The token must be able to read the finished deployment's applied configuration");
  console.log(JSON.stringify({ appId, domains, previous, result: "scope-and-live-check-passed" }));
} else {
  assert.match(digest ?? "", /^sha256:[a-f0-9]{64}$/);
  const tag = digest.replace(":", "-");
  assert.match(cloudCommit ?? "", /^[a-f0-9]{40}$/);
  await verifyRelease(frontendCommit, ciRun);
  const previousConfiguredTag = app.docker_registry_image_tag;
  const previousConfiguredImage = app.docker_registry_image_name;
  if (previous.frontendCommit === frontendCommit && previousConfiguredImage === image) {
    console.log(JSON.stringify({ appId, frontendCommit, result: "already-live" }));
  } else {
    assert.ok(previousConfiguredImage !== image || tag !== previousConfiguredTag,
      "The candidate is already configured with different live source");
    await assertHealthyReleaseTag(previousConfiguredTag, previousConfiguredImage);
    await noActiveDeployment();
    await verifyRelease(frontendCommit, ciRun);
    console.log(JSON.stringify({ appId, frontendCommit, cloudCommit, image: `${image}@${digest}`, previous, previousConfiguredImage, previousConfiguredTag }));
    const result = await deployTag(tag);
    assert.equal(result.status, "finished", `Deployment ${result.deployment} failed. Reconcile the release in Coolify.`);
    await verifyServingDeployment(result.deployment, tag, { frontendCommit, cloudCommit });
    console.log(JSON.stringify({ ...result, frontendCommit, cloudCommit, verified: true }));
  }
}
