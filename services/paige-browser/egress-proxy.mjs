// PC-1 — connect-time egress proxy: the enforceable closure for the DNS-rebinding window (#138).
//
// WHY THIS EXISTS (§13 honest history): the page.route fence validates a hostname by resolving it
// OURSELVES and then letting Chromium connect — but Chromium re-resolves independently, so a
// rebinding DNS answers the guard's lookup with a public address and the browser's lookup with an
// internal one (the documented #138 TOCTOU residual in both _shared/ssrfGuard.ts and
// ssrf-guard.mjs). The ONLY enforceable closure is to make the connection OURSELVES: browse
// contexts get `proxy: { server: http://127.0.0.1:<port> }`, Chromium stops resolving public DNS
// entirely, every connection is a CONNECT/absolute-form request to THIS proxy, the proxy resolves
// the target, numerically validates EVERY answered address, and dials ONE validated address
// directly (IP pinning — a later re-answer cannot redirect an established connection).
//
// SCOPE (PC-1): only /browse-public-url contexts route through the proxy. /pdf, /render and
// /self-verify keep their existing path and behavior (their targets are local HTML, Paige's own
// allowlisted origins, and paigeagent.ai respectively — §18 preserve consumers).
//
// FAIL-CLOSED: any resolution error, any private/loopback/metadata/NAT64/special-range answer in
// the answer set, any denylisted host, any malformed target, and any mid-tunnel error destroys the
// socket. The proxy binds 127.0.0.1 ONLY. If it fails to start, /browse-public-url answers 503
// egress_proxy_unavailable rather than browsing unprotected.
//
// LOGGING: hosts and reason codes only — never a full URL, never query strings (PC-1 redaction).
import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import { ipBlockReason, hostnameShapeBlockReason } from "./ssrf-guard.mjs";

const CONNECT_TIMEOUT_MS = 10_000;

// Resolve + validate a connect target. Returns { address } on success or { reason } fail-closed.
// Literal IPs skip DNS; hostnames require a FRESH lookup (no cache — pinning must see the answer
// we actually dial). If ANY answered address is blocked the target is refused: a resolver that
// mixes public and private answers is presumed hostile, not load-balancing.
export async function resolvePublicConnectTarget(host, { resolve } = {}) {
  const lookup = resolve ?? ((h) => dns.lookup(h, { all: true }));
  const shapeReason = hostnameShapeBlockReason(host);
  if (shapeReason) return { reason: shapeReason };
  if (net.isIP(host)) {
    const r = ipBlockReason(host);
    return r ? { reason: `ssrf:${r}` } : { address: host };
  }
  let addrs;
  try {
    addrs = await lookup(host);
  } catch {
    return { reason: "ssrf:unresolved" };
  }
  if (!Array.isArray(addrs) || addrs.length === 0) return { reason: "ssrf:unresolved" };
  let first = null;
  for (const a of addrs) {
    if (a.address === "0.0.0.0") return { reason: "denylist:cloudflare-families" };
    const r = ipBlockReason(a.address);
    if (r) return { reason: `ssrf:${r}` };
    if (!first) first = a.address;
  }
  return first ? { address: first } : { reason: "ssrf:unresolved" };
}

function refuse(socket, reason, hostForLog) {
  // Host only, never path/query — the reason code is what audits consume (PC-1 redaction).
  console.error(`[egress-proxy] refused ${String(hostForLog || "?")}: ${reason}`);
  try { socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); } catch { /* already gone */ }
  socket.destroy();
}

// Start the loopback egress proxy. `resolve` is injectable so the smoke exercises the REAL
// validation decisions without needing a hostile DNS server (§32 — test the code that ships).
export function startEgressProxy({ host = "127.0.0.1", port = 0, resolve } = {}) {
  const server = http.createServer(async (req, res) => {
    // Absolute-form plain-HTTP proxying (Chromium sends these for http:// through an HTTP proxy).
    // WebSocket upgrades over absolute-form are refused here fail-closed — the context-level
    // routeWebSocket fence closes WebSockets before the network; this is the second lock.
    try {
      if (req.headers.upgrade) { refuse(req.socket, "upgrade:not-permitted", req.headers.host); return; }
      const target = new URL(req.url);
      if (target.protocol !== "http:") { refuse(req.socket, "ssrf:scheme", target.hostname); return; }
      const port = Number(target.port) || 80;
      const verdict = await resolvePublicConnectTarget(target.hostname, { resolve });
      if (verdict.reason) { refuse(req.socket, verdict.reason, target.hostname); return; }
      const upstream = http.request({
        host: verdict.address, port, method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: { ...req.headers, host: target.host },
      });
      upstream.setTimeout(CONNECT_TIMEOUT_MS, () => upstream.destroy(new Error("upstream connect timeout")));
      upstream.on("error", () => { try { res.writeHead(502, { "Content-Length": "0" }); res.end(); } catch { /* gone */ } });
      upstream.on("response", (ur) => {
        res.writeHead(ur.statusCode || 502, ur.headers);
        ur.pipe(res);
        res.on("close", () => ur.destroy());
      });
      req.pipe(upstream);
    } catch (e) {
      refuse(req.socket, `proxy:error:${String(e?.message || e).slice(0, 60)}`, req.headers?.host);
    }
  });

  // CONNECT tunneling (https:// and wss://): validate, dial the pinned address, pipe bytes.
  server.on("connect", async (req, clientSocket, head) => {
    const [hostPart, portPart] = String(req.url || "").split(":");
    const port = Number(portPart);
    try {
      if (!hostPart || !Number.isInteger(port) || port < 1 || port > 65535) {
        refuse(clientSocket, "target:malformed", hostPart);
        return;
      }
      const verdict = await resolvePublicConnectTarget(hostPart, { resolve });
      if (verdict.reason) { refuse(clientSocket, verdict.reason, hostPart); return; }
      const upstream = net.connect({ host: verdict.address, port });
      upstream.setTimeout(CONNECT_TIMEOUT_MS, () => upstream.destroy(new Error("connect timeout")));
      const fail = () => {
        try { clientSocket.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"); } catch { /* gone */ }
        clientSocket.destroy();
      };
      upstream.on("error", fail);
      upstream.on("timeout", fail);
      upstream.on("connect", () => {
        try {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          upstream.write(head);
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
          clientSocket.on("error", () => upstream.destroy());
          upstream.on("error", () => clientSocket.destroy());
        } catch { fail(); }
      });
    } catch (e) {
      refuse(clientSocket, `proxy:error:${String(e?.message || e).slice(0, 60)}`, hostPart);
    }
  });

  return new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, host, () => {
      const { port: boundPort } = server.address();
      resolveStart({
        port: boundPort,
        serverUrl: `http://${host}:${boundPort}`,
        close: () => new Promise((done) => server.close(() => done())),
        unref: () => server.unref(),
      });
    });
  });
}
