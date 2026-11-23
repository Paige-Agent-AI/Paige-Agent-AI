set -euo pipefail
frontend="${1:?frontend commit required}"
[[ "$frontend" =~ ^[a-f0-9]{40}$ ]]
test "$(git rev-parse HEAD)" = "$frontend"
image="${2:?image tag required}"
case "${3:-}" in
  "") git archive HEAD | docker build --platform linux/amd64 -f .github/paige-coolify/Dockerfile \
    --build-arg "FRONTEND_COMMIT=$frontend" --tag "$image" - ;;
  --verify-existing)
    [[ "$image" =~ ^ghcr\.io/paige-agent-ai/paige-agent-ai-web@sha256:[a-f0-9]{64}$ ]]
    test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$image")" = "https://github.com/Paige-Agent-AI/Paige-Agent-AI"
    test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$frontend"
    test "$(docker image inspect --format '{{index .Config.Labels "ai.paige.frontend.revision"}}' "$image")" = "$frontend"
    ;;
  *) printf 'Invalid image verification mode.\n' >&2; exit 1 ;;
esac
work=$(mktemp -d)
container=$(docker run -d -p 127.0.0.1::8080 "$image")
trap 'docker logs "$container"; docker rm -f "$container"; rm -f "$work/route.html" "$work/entry.html"; rmdir "$work"' EXIT
base="http://$(docker port "$container" 8080/tcp)"
curl -fsS --max-time 3 --retry 10 --retry-delay 1 --retry-all-errors "$base/healthz"
curl -fsS "$base/release.json" | jq -e --arg cloud "$frontend" --arg frontend "$frontend" \
  '.cloudCommit == $cloud and .frontendCommit == $frontend'
for pair in ':index.html' 'auth?mode=login:auth.html' 'auth?mode=signup:auth.html' 'signup:index.html' \
             'privacy:privacy.html' 'sms-terms:sms-terms.html' 'operator/workspaces:index.html'; do
  curl -fsS "$base/${pair%:*}" -o "$work/route.html"
  curl -fsS "$base/${pair#*:}" -o "$work/entry.html"
  test -s "$work/entry.html"
  cmp "$work/route.html" "$work/entry.html"
done
curl -fsSI "$base/sw.js" | grep -qi '^Cache-Control: no-cache, no-store'
curl -fsSI "$base/embed.js" | grep -qi '^Cache-Control: public, max-age=300'
test "$(curl -s -o /dev/null -w '%{http_code}' "$base/assets/missing.js")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/auth")" = 405
