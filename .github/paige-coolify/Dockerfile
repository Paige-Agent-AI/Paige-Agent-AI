FROM node:22-bookworm@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb AS build
WORKDIR /src
ARG FRONTEND_COMMIT
COPY . .
RUN node .github/paige-coolify/prepare-frontend.mjs prepare \
    && npm ci --no-audit --no-fund \
    && GITHUB_SHA="$FRONTEND_COMMIT" NODE_OPTIONS=--max-old-space-size=4096 npm run build \
    && node .github/paige-coolify/prepare-frontend.mjs release "$FRONTEND_COMMIT" "$FRONTEND_COMMIT"

FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
ARG FRONTEND_COMMIT
LABEL org.opencontainers.image.source="https://github.com/Paige-Agent-AI/Paige-Agent-AI" \
      org.opencontainers.image.revision="$FRONTEND_COMMIT" \
      ai.paige.frontend.revision="$FRONTEND_COMMIT"
COPY .github/paige-coolify/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /src/dist/ /usr/share/nginx/html/
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
CMD []
