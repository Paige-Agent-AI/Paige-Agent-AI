// EXP08 Team Hub increment 3: the server half of attaching a file to a Team Hub message.
// Contract: docs/delivery/exp08-team-hub-increment3-attachments-contract.md §5.
//
// The browser uploads the bytes itself, straight to comms-attachments under the path
// team_hub_begin_file minted (the restrictive storage policy admits only that pending path).
// This function then checks what was uploaded:
//   finish  — read the row with the CALLER's JWT, read the bytes with the service role, check the
//             real type (_shared/team-hub-file-type.ts), record the verdict, remove refused bytes,
//             then sweep that caller's stale pending uploads.
//   discard — discard an unposted file with the caller's JWT, then remove its bytes.
// Authority is always the caller's JWT first: the service role touches an object only after a
// caller-scoped RPC has returned that exact path for that exact file. Files are not scanned for
// malware; the type check is what this increment ships instead (contract preamble).
// Logs carry reason codes only, never a file name or a byte.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { teamHubFileVerdict } from "../_shared/team-hub-file-type.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "comms-attachments";
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("TEAM_HUB_ALLOWED_ORIGINS") ?? "https://paigeagent.ai,https://app.paigeagent.ai")
    .split(",")
    .map((value) => value.trim()),
);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The only object names this function will ever ask the service role to remove.
const TEAM_HUB_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/team-hub\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type CheckFile = { id: string; path: string; mime: string; size: number; state: string };
type Rpc = { data: unknown; error: { code?: string; message?: string } | null };

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function checkFile(value: unknown): CheckFile | null {
  const file = record(value);
  if (!file || typeof file.id !== "string" || typeof file.path !== "string" || typeof file.mime !== "string" ||
      typeof file.size !== "number" || typeof file.state !== "string") return null;
  return { id: file.id, path: file.path, mime: file.mime, size: file.size, state: file.state };
}

/** The stale-sweep result may arrive as text[], {paths}, or rows; keep only canonical Team Hub paths. */
function stalePaths(value: unknown): string[] {
  const list = Array.isArray(value) ? value : (record(value)?.paths as unknown);
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => typeof item === "string" ? item : record(item)?.path ?? record(item)?.storage_path)
    .filter((path): path is string => typeof path === "string" && TEAM_HUB_PATH.test(path));
}

function storageMissing(error: unknown): boolean {
  const failure = record(error);
  if (!failure) return false;
  const status = Number(failure.status ?? failure.statusCode ?? record(failure.originalError)?.status);
  return status === 404 || /not.?found/i.test(String(failure.message ?? ""));
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const cors = {
    "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const refuse = (code: string, status = 200) => json({ ok: false, code }, status);

  if (request.method === "OPTIONS") return new Response(null, { status: origin && ALLOWED_ORIGINS.has(origin) ? 204 : 403, headers: cors });
  if (request.method !== "POST") return refuse("method_not_allowed", 405);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return refuse("origin_refused", 403);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return refuse("unavailable", 503);
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return refuse("invalid", 413);

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return refuse("session_required", 401);
  const scoped = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
  });
  const { data: userData, error: userError } = await scoped.auth.getUser();
  if (userError || !userData.user) return refuse("session_required", 401);
  const actor = userData.user.id;

  let input: Record<string, unknown> | null;
  try {
    const text = await request.text();
    if (text.length > 4096) return refuse("invalid", 413);
    input = record(JSON.parse(text));
  } catch {
    return refuse("invalid", 400);
  }
  if (!input || Object.keys(input).some((key) => !["action", "expected_tenant", "file_id"].includes(key)) ||
      !["finish", "discard"].includes(String(input.action)) ||
      typeof input.expected_tenant !== "string" || !UUID.test(input.expected_tenant) ||
      typeof input.file_id !== "string" || !UUID.test(input.file_id)) {
    return refuse("invalid", 400);
  }
  const tenant = input.expected_tenant.toLowerCase();
  const fileId = input.file_id.toLowerCase();
  // The one path a caller-scoped answer may name for this file; anything else never reaches storage.
  const expectedPath = `${tenant}/team-hub/${fileId}`;
  const removeObjects = async (paths: string[], stage: string) => {
    const safe = paths.filter((path) => TEAM_HUB_PATH.test(path));
    if (safe.length === 0) return true;
    try {
      const { error } = await admin.storage.from(BUCKET).remove(safe);
      if (!error) return true;
    } catch { /* reported below */ }
    console.warn("team_hub_file_remove_failed", { stage, count: safe.length });
    return false;
  };
  const sweepStale = async () => {
    try {
      const swept = await admin.rpc("team_hub_claim_stale_files", { p_uploader: actor }) as Rpc;
      if (swept.error) {
        console.warn("team_hub_file_sweep_failed", { code: swept.error.code ?? "rpc_error" });
        return;
      }
      await removeObjects(stalePaths(swept.data), "sweep");
    } catch {
      console.warn("team_hub_file_sweep_failed", { code: "unexpected" });
    }
  };

  if (input.action === "discard") {
    const discarded = await scoped.rpc("team_hub_discard_file", { p_expected_tenant: tenant, p_file_id: fileId }) as Rpc;
    if (discarded.error) {
      console.warn("team_hub_file_discard_failed", { code: discarded.error.code ?? "rpc_error" });
      return refuse("unavailable", 503);
    }
    const result = record(discarded.data);
    if (result?.ok !== true) return refuse(typeof result?.code === "string" ? result.code : "unavailable", result ? 200 : 503);
    if (result.path !== expectedPath) {
      console.warn("team_hub_file_discard_failed", { code: "path_mismatch" });
      return refuse("unavailable", 503);
    }
    const removed = await removeObjects([expectedPath], "discard");
    return json({ ok: true, removed });
  }

  // finish
  const checked = await scoped.rpc("team_hub_file_for_check", { p_expected_tenant: tenant, p_file_id: fileId }) as Rpc;
  if (checked.error) {
    console.warn("team_hub_file_check_failed", { code: checked.error.code ?? "rpc_error" });
    return refuse("unavailable", 503);
  }
  const answer = record(checked.data);
  if (answer?.ok !== true) return refuse(typeof answer?.code === "string" ? answer.code : "unavailable", answer ? 200 : 503);
  const file = checkFile(answer.file);
  if (!file || file.id.toLowerCase() !== fileId || file.path !== expectedPath) {
    console.warn("team_hub_file_check_failed", { code: "shape_mismatch" });
    return refuse("unavailable", 503);
  }
  if (file.state === "ready") {
    await sweepStale();
    return json({ ok: true, file });
  }
  if (file.state !== "pending") return refuse("invalid");

  let bytes: Uint8Array;
  try {
    const { data: object, error: downloadError } = await admin.storage.from(BUCKET).download(file.path);
    if (downloadError || !object) {
      if (storageMissing(downloadError) || !object) return refuse("not_uploaded");
      console.warn("team_hub_file_download_failed", { code: "storage_error" });
      return refuse("unavailable", 503);
    }
    bytes = new Uint8Array(await object.arrayBuffer());
  } catch {
    console.warn("team_hub_file_download_failed", { code: "unexpected" });
    return refuse("unavailable", 503);
  }

  const sniffed = teamHubFileVerdict(bytes, file.mime);
  // The declared size was fixed at begin; bytes of any other length are not the file that was declared.
  const sizeMatches = bytes.byteLength === file.size;
  const accept = sniffed.accept && sizeMatches;
  const reason = sniffed.accept ? (sizeMatches ? null : "size_mismatch") : sniffed.reason;
  const judged = await admin.rpc("team_hub_file_verdict", {
    p_file_id: fileId,
    p_uploader: actor,
    p_detected_mime: sniffed.detectedMime,
    p_accept: accept,
    p_reason: reason,
  }) as Rpc;
  if (judged.error) {
    console.warn("team_hub_file_verdict_failed", { code: judged.error.code ?? "rpc_error" });
    return refuse("unavailable", 503);
  }
  const verdict = record(judged.data);
  if (verdict?.ok !== true) return refuse(typeof verdict?.code === "string" ? verdict.code : "unavailable", verdict ? 200 : 503);

  if (verdict.state === "ready") {
    await sweepStale();
    return json({ ok: true, file: { ...file, state: "ready" } });
  }
  if (verdict.state !== "rejected") {
    console.warn("team_hub_file_verdict_failed", { code: "unexpected_state" });
    return refuse("unavailable", 503);
  }
  // Rejected: by the bytes here, or by the database when the stored object's owner, size or MIME
  // metadata disagree with the row. Either way the bytes go, so nobody can ever read them.
  const finalReason = typeof verdict.reason === "string" ? verdict.reason : reason ?? "metadata_mismatch";
  console.warn("team_hub_file_rejected", { reason: finalReason });
  await removeObjects([file.path], "reject");
  await sweepStale();
  return json({ ok: false, code: "rejected", reason: finalReason });
});
