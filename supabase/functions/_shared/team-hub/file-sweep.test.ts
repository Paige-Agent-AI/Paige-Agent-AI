// node --test supabase/functions/_shared/team-hub/file-sweep.test.ts
// EXP08 Team Hub: the scheduled stale-file sweep loop, driven through a fake service-role client that
// records exactly which RPCs and storage removals would reach Supabase. All ids are fictional.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runTeamHubFileSweep, SWEEP_REMOVE_BATCH, SWEEP_RUN_BUDGET_MS, uploaderIds, type TeamHubSweepClient } from "./file-sweep.ts";
import { stalePaths, TEAM_HUB_PATH } from "./file-paths.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const file = (n: number) => `${TENANT}/team-hub/${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

type Call = { kind: "rpc"; fn: string; args: Record<string, unknown> } | { kind: "remove"; bucket: string; paths: string[] };

function fake(opts: {
  list?: unknown; listError?: boolean;
  claims?: Record<string, unknown>; claimError?: string[];
  removeError?: (paths: string[]) => boolean;
  alreadyGone?: string[];
}) {
  const calls: Call[] = [];
  const client: TeamHubSweepClient = {
    rpc(fn, args) {
      calls.push({ kind: "rpc", fn, args });
      if (fn === "team_hub_stale_file_uploaders") {
        return Promise.resolve(opts.listError ? { data: null, error: { code: "boom" } } : { data: opts.list, error: null });
      }
      const who = String(args.p_uploader);
      if (opts.claimError?.includes(who)) return Promise.resolve({ data: null, error: { code: "boom" } });
      return Promise.resolve({ data: opts.claims?.[who] ?? { ok: true, paths: [] }, error: null });
    },
    storage: {
      from(bucket) {
        return {
          remove(paths) {
            calls.push({ kind: "remove", bucket, paths });
            if (opts.removeError?.(paths)) return Promise.resolve({ data: null, error: { message: "boom" } });
            // Storage answers with the objects it actually deleted; a path already gone is not in it.
            const deleted = paths.filter((path) => !opts.alreadyGone?.includes(path)).map((name) => ({ name }));
            return Promise.resolve({ data: deleted, error: null });
          },
        };
      },
    },
  };
  return { client, calls };
}

describe("team hub stale-file sweep", () => {
  it("claims each listed uploader through the unchanged per-uploader door and removes only what it returned", async () => {
    const { client, calls } = fake({
      list: { ok: true, uploaders: [A, B] },
      claims: { [A]: { ok: true, paths: [file(1), file(2)] }, [B]: { ok: true, paths: [] } },
    });
    const summary = await runTeamHubFileSweep(client);
    assert.deepEqual(calls, [
      { kind: "rpc", fn: "team_hub_stale_file_uploaders", args: { p_limit: 50 } },
      { kind: "rpc", fn: "team_hub_claim_stale_files", args: { p_uploader: A } },
      { kind: "remove", bucket: "comms-attachments", paths: [file(1), file(2)] },
      { kind: "rpc", fn: "team_hub_claim_stale_files", args: { p_uploader: B } },
    ]);
    assert.deepEqual(summary, { ok: true, uploaders: 2, swept: 2, removed: 2, failed_removals: 0, failed_claims: 0, deferred: 0 });
  });

  it("never asks storage to remove a path that is not a canonical Team Hub path", async () => {
    const { client, calls } = fake({
      list: { ok: true, uploaders: [A] },
      claims: { [A]: { ok: true, paths: [file(1), `${TENANT}/comms/x.pdf`, "../etc/passwd", `${TENANT}/team-hub/not-a-uuid`] } },
    });
    await runTeamHubFileSweep(client);
    const removed = calls.filter((c) => c.kind === "remove").flatMap((c) => c.kind === "remove" ? c.paths : []);
    assert.deepEqual(removed, [file(1)]);
  });

  it("counts only the objects storage says it deleted, not the paths it was asked about", async () => {
    const { client } = fake({
      list: { ok: true, uploaders: [A] },
      claims: { [A]: { ok: true, paths: [file(1), file(2), file(3)] } },
      alreadyGone: [file(2)],
    });
    const summary = await runTeamHubFileSweep(client);
    assert.equal(summary.removed, 2);
    assert.equal(summary.failed_removals, 0);
    assert.equal(summary.ok, true);
  });

  it("removes in batches of at most 100", async () => {
    const paths = Array.from({ length: SWEEP_REMOVE_BATCH + 7 }, (_, i) => file(i + 1));
    const { client, calls } = fake({ list: { ok: true, uploaders: [A] }, claims: { [A]: { ok: true, paths } } });
    const summary = await runTeamHubFileSweep(client);
    const batches = calls.filter((c) => c.kind === "remove").map((c) => c.kind === "remove" ? c.paths.length : 0);
    assert.deepEqual(batches, [100, 7]);
    assert.equal(summary.removed, 107);
  });

  it("reports a failed removal and a failed claim honestly and keeps going", async () => {
    const { client } = fake({
      list: { ok: true, uploaders: [A, B] },
      claims: { [B]: { ok: true, paths: [file(3)] } },
      claimError: [A],
      removeError: () => true,
    });
    const summary = await runTeamHubFileSweep(client);
    assert.deepEqual(summary, { ok: false, uploaders: 2, swept: 1, removed: 0, failed_removals: 1, failed_claims: 1, deferred: 0 });
  });

  it("a refused claim (not_allowed) is a failure, not a success with nothing to remove", async () => {
    const { client, calls } = fake({ list: { ok: true, uploaders: [A] }, claims: { [A]: { ok: false, code: "not_allowed" } } });
    const summary = await runTeamHubFileSweep(client);
    assert.equal(summary.ok, false);
    assert.equal(summary.failed_claims, 1);
    assert.equal(calls.some((c) => c.kind === "remove"), false);
  });

  it("does nothing when the list fails or is malformed", async () => {
    for (const opts of [{ listError: true }, { list: { ok: false, code: "not_allowed" } }, { list: { ok: true } }, { list: null }]) {
      const { client, calls } = fake(opts);
      const summary = await runTeamHubFileSweep(client);
      assert.equal(summary.ok, false);
      assert.equal(summary.code, "list_failed");
      assert.equal(calls.length, 1);
    }
  });

  it("stops starting new uploaders once the run budget is spent and says how many it deferred", async () => {
    let now = 0;
    const { client, calls } = fake({ list: { ok: true, uploaders: [A, B] } });
    const clock = () => {
      const t = now;
      now += SWEEP_RUN_BUDGET_MS; // the first claim spends the whole budget
      return t;
    };
    const summary = await runTeamHubFileSweep(client, clock);
    assert.equal(calls.filter((c) => c.kind === "rpc" && c.fn === "team_hub_claim_stale_files").length, 1);
    assert.equal(summary.deferred, 1);
    assert.equal(summary.ok, true);
  });

  it("drops anything in the uploader list that is not a uuid", () => {
    assert.deepEqual(uploaderIds({ ok: true, uploaders: [A, "x", 7, null, B] }), [A, B]);
    assert.equal(uploaderIds({ ok: false }), null);
  });

  it("the shared path rule is the one team-hub-file uses", () => {
    assert.equal(TEAM_HUB_PATH.test(file(1)), true);
    assert.deepEqual(stalePaths([file(1), { path: file(2) }, { storage_path: file(3) }, "nope"]), [file(1), file(2), file(3)]);
    assert.deepEqual(stalePaths({ paths: [file(4)] }), [file(4)]);
  });
});
