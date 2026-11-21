import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deploy } from "./deploy.mjs";

const appId = "qucl8euvl1vjcg1z3nryqadb";
const packageName = "ghcr.io/paige-agent-ai/paige-agent-ai-web";
const appPath = `/api/v1/applications/${appId}`;
const previousId = "eg7suvweem0o7ggcncrf3u1b";
const candidateId = "candidatedeployment123";
const previousCommit = "a".repeat(40);
const previousDigest = "sha256:" + "b".repeat(64);
const options = {
  mode: "--promote", token: "fixture-token",
  frontendCommit: "c".repeat(40), digest: "sha256:" + "d".repeat(64),
  ciRun: "123", runId: "456", runAttempt: "2", actorId: "789",
};
const domainNames = ["app.paigeagent.ai", "paigeagent.ai", "www.paigeagent.ai"];

function fixture({
  broadToken = false, staleApproval = false, previousProof = true, candidateProof = true,
  providerStatus = "finished", loseQueueResponse = false, readOnly = false,
} = {}) {
  const changes = [];
  const receipts = [];
  let checkedApproval = 0;
  let queued = false;
  let tag = previousDigest.replace(":", "-");
  const sendJSON = (value) => Response.json(value);
  const finished = () => queued && providerStatus === "finished";
  return {
    changes,
    receipts,
    dependencies: {
      verify: async (commit, ciRun) => {
        assert.match(commit, /^[a-f0-9]{40}$/);
        assert.equal(ciRun, options.ciRun);
        if (++checkedApproval === 2 && staleApproval) throw new Error("Superseded by main");
        return 12;
      },
      pause: async () => {},
      save: (value) => receipts.push(structuredClone(value)),
      fetchFrom: async (url, init = {}) => {
        const { origin, hostname, pathname, search } = new URL(url);
        if (init.method && init.method !== "GET") {
          assert.ok(!readOnly, "Unexpected provider write");
          assert.equal(receipts.at(-1).result, "pending");
          changes.push([init.method, pathname, JSON.parse(init.body)]);
        }
        if (origin !== "https://app.coolify.io") {
          assert.ok(domainNames.includes(hostname));
          assert.equal(init.headers?.Authorization, undefined);
          if (pathname === "/healthz") return new Response("ok");
          if (pathname === "/release.json") {
            const commit = finished() ? options.frontendCommit : previousCommit;
            return sendJSON({ frontendCommit: commit, cloudCommit: commit });
          }
          assert.ok(pathname === "/" || (pathname === "/auth" && search === "?mode=signup"));
          return new Response("public");
        }
        assert.equal(init.headers.Authorization, `Bearer ${options.token}`);
        if (pathname === appPath) {
          if (init.method === "PATCH") {
            assert.equal(receipts.at(-1).stage, "patch-request");
            assert.equal(receipts.at(-1).previous.image, `${packageName}@${previousDigest}`);
            tag = JSON.parse(init.body).docker_registry_image_tag;
            return sendJSON({});
          }
          return sendJSON({
            uuid: appId, name: "paige-full-app", build_pack: "dockerimage", status: "running:healthy",
            docker_registry_image_name: packageName, docker_registry_image_tag: tag,
            is_http_basic_auth_enabled: false, health_check_enabled: true, health_check_path: "/healthz",
            config_hash: tag, fqdn: domainNames.map((domain) => "https://" + domain).join(","),
          });
        }
        if (pathname === "/api/v1/applications") return sendJSON([{ uuid: appId }]);
        if (pathname === `/api/v1/deployments/applications/${appId}`) {
          const deployments = [{ status: "finished", deployment_uuid: previousId }];
          if (queued) deployments.unshift({ status: providerStatus, deployment_uuid: candidateId });
          return sendJSON({ deployments });
        }
        if (pathname === "/api/v1/deploy") {
          assert.equal(receipts.at(-1).stage, "queue-request");
          queued = true;
          if (loseQueueResponse) throw new Error("Connection lost after queue accepted");
          return sendJSON({ deployments: [{ resource_uuid: appId, deployment_uuid: candidateId }] });
        }
        if (pathname.startsWith("/api/v1/deployments/")) {
          const id = pathname.split("/").at(-1);
          assert.ok(id === previousId || id === candidateId);
          const isPrevious = id === previousId;
          const digest = isPrevious ? previousDigest : options.digest;
          return sendJSON({
            deployment_uuid: id, status: isPrevious ? "finished" : providerStatus, configuration_hash: digest.replace(":", "-"),
            logs: JSON.stringify([{ output: (isPrevious ? previousProof : candidateProof)
              ? `Other output\n Image ${packageName}@${digest} Pulled` : "Digest pull unavailable" }]),
          });
        }
        if (["/api/v1/team", "/api/v1/applications/vnh5vfaqnq0fkkgfalgda8gx",
          "/api/v1/applications/izwrky18u9ixdhstnulxpjs5"].includes(pathname)) {
          return new Response(null, { status: broadToken ? 200 : 404 });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    },
  };
}

async function prepared(t, request = options) {
  const directory = mkdtempSync(join(tmpdir(), "paige-production-plan-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const planPath = join(directory, "intent.json");
  const preflight = fixture({ readOnly: true });
  const plan = await deploy({ ...request, mode: "--prepare" }, preflight.dependencies);
  assert.equal(plan.result, "ready");
  assert.equal(preflight.changes.length, 0);
  writeFileSync(planPath, JSON.stringify(plan));
  return { ...request, planPath, planArtifactId: "654" };
}

test("approved promotion checkpoints before mutation and proves the artifact and rollback target", async (t) => {
  const input = await prepared(t);
  const { dependencies, changes, receipts } = fixture();
  const result = await deploy(input, dependencies);
  assert.equal(result.result, "verified");
  assert.equal(result.deployment, candidateId);
  assert.equal(result.candidate.image, `${packageName}@${options.digest}`);
  assert.deepEqual(result.previous, {
    frontendCommit: previousCommit, cloudCommit: previousCommit, deployment: previousId,
    image: `${packageName}@${previousDigest}`,
  });
  assert.deepEqual(changes, [
    ["PATCH", appPath, { docker_registry_image_name: packageName, docker_registry_image_tag: options.digest.replace(":", "-") }],
    ["POST", "/api/v1/deploy", { uuid: appId }],
  ]);
  assert.equal(result.approval.pullRequest, 12);
  assert.deepEqual(result.workflow, { runId: "456", attempt: "2", actorId: "789" });
  assert.equal(result.planArtifactId, "654");
  assert.equal(JSON.stringify(result).includes(options.token), false);
  assert.deepEqual(receipts.at(-1), result);
});

test("replay requires both the digest and source and does not queue a second deployment", async (t) => {
  const { dependencies, changes, receipts } = fixture({ readOnly: true });
  const current = await prepared(t, { ...options, frontendCommit: previousCommit, digest: previousDigest });
  const result = await deploy(current, dependencies);
  assert.equal(result.result, "already-live");
  assert.equal(result.deployment, previousId);
  await assert.rejects(deploy({ ...current, digest: options.digest }, dependencies), /conflicts/);
  assert.equal(receipts.at(-1).result, "blocked");
  assert.equal(changes.length, 0);
});

test("broad credentials, missing rollback evidence, or a superseded main block every mutation", async (t) => {
  const input = await prepared(t);
  for (const [scenario, stage] of [
    [{ broadToken: true }, "credential-scope"], [{ previousProof: false }, "previous-release"],
    [{ staleApproval: true }, "candidate"],
  ]) {
    const { dependencies, receipts, changes } = fixture(scenario);
    await assert.rejects(deploy(input, dependencies));
    assert.equal(receipts.at(-1).stage, stage);
    assert.equal(receipts.at(-1).result, "blocked");
    assert.equal(changes.length, 0);
  }
});

test("a failed, ambiguous, or unverifiable deployment writes an honest receipt and avoids blind retry", async (t) => {
  const input = await prepared(t);
  for (const [scenario, result, stage, id] of [
    [{ providerStatus: "failed" }, "failed", "deployment-queued", candidateId],
    [{ loseQueueResponse: true }, "unconfirmed", "queue-request", null],
    [{ candidateProof: false }, "unconfirmed", "live-verification", candidateId],
  ]) {
    const { dependencies, receipts, changes } = fixture(scenario);
    await assert.rejects(deploy(input, dependencies));
    const receipt = receipts.at(-1);
    assert.equal(receipt.result, result);
    assert.equal(receipt.stage, stage);
    assert.equal(receipt.deployment, id);
    assert.equal(receipt.previous.image, `${packageName}@${previousDigest}`);
    assert.equal(changes.length, 2);
  }
});

test("a receipt writer failure blocks promotion before changing the production image", async (t) => {
  const input = await prepared(t);
  const { dependencies, changes } = fixture();
  const { save } = dependencies;
  dependencies.save = (receipt) => {
    if (receipt.stage === "patch-request") throw new Error("Receipt write unavailable");
    save(receipt);
  };
  await assert.rejects(deploy(input, dependencies), /Receipt write unavailable/);
  assert.equal(changes.length, 0);
});

test("promotion requires an uploaded same-attempt preflight that still matches live state", async (t) => {
  const input = await prepared(t);
  const { dependencies, receipts, changes } = fixture({ readOnly: true });
  await assert.rejects(deploy({ ...input, planArtifactId: undefined }, dependencies), /Upload the same-run/);
  await assert.rejects(deploy({ ...input, runAttempt: "3" }, dependencies), /changed at workflow/);
  writeFileSync(input.planPath, JSON.stringify({ result: "blocked" }));
  await assert.rejects(deploy(input, dependencies), /not passed preflight/);
  assert.equal(receipts.at(-1).result, "blocked");
  assert.equal(changes.length, 0);
});
