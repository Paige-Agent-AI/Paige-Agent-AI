set -euo pipefail

[[ "$FRONTEND_COMMIT" =~ ^[a-f0-9]{40}$ ]]
repo="Paige-Agent-AI/Paige-Agent-AI"
runs="repos/$repo/actions/workflows/paige-coolify.yml/runs?event=push&branch=main&head_sha=$FRONTEND_COMMIT&per_page=10"
source="$(
  gh api "$runs" | jq -r --arg repo "$repo" --arg commit "$FRONTEND_COMMIT" '
    first(.workflow_runs[] | select(
      .repository.full_name == $repo and .head_repository.full_name == $repo and
      .path == ".github/workflows/paige-coolify.yml" and .event == "push" and
      .head_branch == "main" and .head_sha == $commit and .conclusion == "success"
    ) | [.id, .run_attempt] | @tsv)
  '
)" || {
  echo "Early package lookup unavailable. Building the verified source in this run."
  exit 0
}
[[ -n "$source" ]] || exit 0
read -r run attempt <<< "$source"
[[ "$run" =~ ^[1-9][0-9]{0,14}$ && "$attempt" =~ ^[1-9][0-9]{0,8}$ ]]
work=$(mktemp -d)
trap 'rm -f "$work/paige-app-release.json"; rmdir "$work"' EXIT
if ! gh run download "$run" --repo "$repo" --name "paige-app-candidate-$attempt" --dir "$work"; then
  echo "Early package receipt unavailable. Building the verified source in this run."
  exit 0
fi
# Present receipts must match the exact source and build run before reusing an image.
run_url="https://github.com/$repo/actions/runs/$run"
digest=$(jq -er --arg commit "$FRONTEND_COMMIT" --arg image "$IMAGE_REPO@" --arg run "$run_url" '
  select(.cloudCommit == $commit and .frontendCommit == $commit and .run == $run and
    (.image | type == "string" and startswith($image))) |
  .image | ltrimstr($image) | select(test("^sha256:[a-f0-9]{64}$"))
' "$work/paige-app-release.json")
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]
printf 'digest=%s\nrun=%s\nattempt=%s\n' "$digest" "$run" "$attempt" >> "$GITHUB_OUTPUT"
