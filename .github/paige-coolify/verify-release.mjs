import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const repository = "Paige-Agent-AI/Paige-Agent-AI";
const api = `https://api.github.com/repos/${repository}`;
// GitHub user ID of the existing organization release maintainer (mrmogulmaker-bot).
export const releaseMaintainer = 232259757;

async function github(path) {
  const response = await fetch(`${api}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, `GitHub ${path} returned HTTP ${response.status}`);
  return response.json();
}

async function verifyMain(commit, number) {
  assert.match(commit ?? "", /^[a-f0-9]{40}$/);
  assert.match(number ?? "", /^[1-9][0-9]{0,8}$/);
  const [main, pr] = await Promise.all([
    github("/branches/main"), github(`/pulls/${number}`),
  ]);
  assert.equal(main.commit.sha, commit, "Requested release was superseded by canonical main");
  assert.equal(pr.base?.repo?.full_name, repository);
  assert.equal(pr.base.ref, "main");
  assert.ok(pr.merged && pr.merged_at && pr.merge_commit_sha === commit,
    "The exact main commit must be the result of this merged pull request");

  assert.equal(pr.merged_by?.id, releaseMaintainer,
    "The merge must be performed by the designated repository release maintainer");
}

export async function verifyRelease(commit, runId) {
  assert.match(commit ?? "", /^[a-f0-9]{40}$/);
  assert.match(runId ?? "", /^[1-9][0-9]{0,14}$/);
  const [run, pulls] = await Promise.all([
    github(`/actions/runs/${runId}`), github(`/commits/${commit}/pulls?per_page=100`),
  ]);
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.path, ".github/workflows/ci.yml");
  assert.equal(run.event, "push");
  assert.equal(run.head_branch, "main");
  assert.equal(run.head_sha, commit);
  assert.equal(run.conclusion, "success", "Canonical main CI must pass before deploying");
  const exact = pulls.filter(pr => pr.base?.ref === "main" && pr.merged_at && pr.merge_commit_sha === commit);
  assert.equal(exact.length, 1, "The current main must identify one exact merged pull request");
  await verifyMain(commit, String(exact[0].number));
  return exact[0].number;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const number = await verifyRelease(process.argv[2], process.argv[3]);
  console.log(`Canonical main and authorized merger verified for #${number}.`);
}
