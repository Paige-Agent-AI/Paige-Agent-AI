# Node 20 + Playwright Chromium + system deps. The base-image tag MUST match the EXACT playwright
# version pinned in package.json (both 1.62.1 — the ONE canonical version across the browser
# services AND the root live-drive devDep; §18 — do not introduce a second/third).
#
# WHY EXACT, NOT A CARET (Task #126 §32.c finding #2 — proven live): package.json previously used a
# CARET (`^1.48.0`), so the Fly build silently resolved the latest 1.x (1.62.x) while this base image
# stayed pinned at v1.48.0-jammy. Playwright 1.55+ launches Chromium via a `chromium-headless-shell`
# binary that the 1.48.0 image does not ship — so the drifted npm package could not find its browser
# and the launch failed (the honest infra-block Paige reported on three live-drives). The pin is now
# EXACT on both the npm and image sides at 1.62.1 (the version proven working live: 817 MB rebuild,
# healthz 200, real paigeagent.ai content returned). Keep it EXACT — a caret or a Dependabot bump that
# moves ONLY package.json will re-open this exact gap. Bump BOTH lines together, in lockstep, always.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# Slice 3a — Layer-2 content denylist (owner-ruled 2026-08-12): bake a StevenBlack/hosts snapshot into
# the image (fakenews-gambling-porn variant). NON-FATAL: a transient GitHub outage during build must
# NOT break the deploy — on failure we write an empty file and the server logs the no-op (the SSRF
# private-IP guard + Cloudflare Families still hold, §13/§32). HONEST REFRESH STATUS (§13/§64): this is
# a BUILD-TIME snapshot — it refreshes only when this image is rebuilt. Once the Fly-services deploy CI
# (PR #497, .github/workflows/deploy-fly-services.yml) lands, a `services/paige-browser/**` change
# rebuilds+redeploys and picks up a fresh snapshot. A SCHEDULED weekly refresh is a tracked follow-up
# (task #151), NOT yet built — do not claim it runs.
RUN curl -fsSL "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn/hosts" -o /app/blocklist.txt \
    || echo "# denylist fetch failed at build; Layer-2 content denylist is a no-op" > /app/blocklist.txt

COPY server.js ssrf-guard.mjs render.mjs ./

# Slice 3a — Layer-1 DNS denylist (owner-ruled 2026-08-12): point the container resolver at Cloudflare
# for Families (1.1.1.3 / 1.0.0.3), which sinkholes malware + adult domains to 0.0.0.0 — the guard's
# 0.0.0.0/8 rule then denies them (reason "denylist:cloudflare-families"). The entrypoint rewrites
# resolv.conf at start (best-effort: `|| true` so a read-only mount never bricks boot; the §39 LIVE
# peer-gate confirms Families is actually enforced on the deployed host — if it is not, the fix is a
# Node Families resolver, tracked as the documented fast-follow). Both Node's dns.lookup AND Chromium's
# own resolver use this file, so a blocked domain fails for the whole container, not just Node.
RUN printf '#!/bin/sh\nprintf "nameserver 1.1.1.3\\nnameserver 1.0.0.3\\n" > /etc/resolv.conf 2>/dev/null || true\nexec node server.js\n' > /app/entrypoint.sh \
    && chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
EXPOSE 8080
CMD ["/app/entrypoint.sh"]
