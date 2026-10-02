// Ingest an uploaded document or scan into a tenant's private Knowledge Base.
// The client uploads the file to the `tenant-knowledge` bucket under
// `<tenant_id>/<uuid>_<name>` (RLS-scoped), then calls this with the path. We
// download it (RLS-enforced via the caller's JWT), extract text — txt/md decoded
// directly, PDF + images via Claude's native document/image blocks (OCR for
// scans) — and hand off to kb-ingest-doc (source 'upload' | 'scan'), which
// chunks + embeds it. Keeping the chunk/embed pipeline single-sourced.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://esm.sh/zod@3.22.4";
import { callClaude } from "../_shared/claude.ts";
import { bindKnowledgeIngestScope, KnowledgeIngestScopeError } from "../_shared/knowledge-ingest-scope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  path: z.string().min(3).max(1024), // storage path: <tenant_id>/<uuid>_<name>
  mime: z.string().max(200).optional(),
  filename: z.string().max(300).optional(),
  title: z.string().min(1).max(300).optional(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  share_to_network: z.boolean().optional(),
  tenant_id: z.string().uuid().optional(), // equality precondition against the selected workspace
});

// kb-ingest-doc caps content at 500k; stay comfortably under after extraction.
const MAX_CONTENT = 480_000;

// Provider limits: Anthropic caps images ~5 MB and PDFs ~32 MB base64 (base64
// inflates ~1.34x, so a ~24 MB raw PDF is the practical ceiling). The bucket
// allows 25 MB, so enforce tighter, type-specific caps BEFORE calling Claude and
// return a clean message rather than a raw provider 400.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 24 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

const EXT_IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

// Media type for an image block — prefer the real mime, fall back to the file
// extension (browsers often send an empty type on drag-drop), never blind-png.
function imageMediaType(mime: string | undefined, ext: string): string {
  return IMAGE_MIME[(mime || "").toLowerCase()] ?? EXT_IMAGE_MIME[ext] ?? "image/png";
}

function json(body: unknown, status = 200) {
  const result = body && typeof body === "object" && "error" in body && !("ok" in body) ? { ...body, ingestion_started: false } : body;
  return new Response(JSON.stringify(result), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Chunked base64 — spreading a big Uint8Array into btoa blows the call stack.
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function extFromPath(p: string): string {
  const base = p.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

// Resolve (source, kind) from mime + extension. kind drives extraction.
function classify(mime: string | undefined, ext: string): { kind: "text" | "pdf" | "image"; source: "upload" | "scan" } | null {
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf" || ext === "pdf") return { kind: "pdf", source: "upload" };
  if (IMAGE_MIME[m] || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return { kind: "image", source: "scan" };
  if (m.startsWith("text/") || ["txt", "md", "markdown", "csv", "json"].includes(ext)) return { kind: "text", source: "upload" };
  return null;
}

const EXTRACT_PROMPT =
  "Extract the full text content of this document verbatim as clean plain text. " +
  "Preserve headings, lists, and paragraph structure. Do not summarize, add commentary, " +
  "or omit anything. If it's a scan or image, transcribe all legible text. Output only the extracted text.";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let ingestionStarted = false;
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { path, mime, filename, title, category, tags, share_to_network, tenant_id } = parsed.data;

    const ext = extFromPath(filename ?? path);
    const cls = classify(mime, ext);
    if (!cls) {
      return json({ error: "Unsupported file type. Upload a PDF, image (png/jpg/webp), or text/markdown file." }, 400);
    }

    // Plain-function adapter for the shared scope port: relating supabase-js's generic
    // from()/rpc() signatures to a structural caller trips TS2345 under deno check.
    const scopeCaller = {
      auth: supabase.auth,
      readActiveTenant: (userId: string) => supabase.from("profiles").select("active_tenant_id").eq("user_id", userId).maybeSingle(),
      rpc: (name: string, args?: Record<string, unknown>) => supabase.rpc(name, args as never),
    };
    const scope = await bindKnowledgeIngestScope(scopeCaller, tenant_id, path);

    // Download via the caller's JWT so bucket RLS enforces tenant ownership —
    // a caller can only read files under their own tenant's folder.
    const { data: blob, error: dlErr } = await supabase.storage.from("tenant-knowledge").download(path);
    if (dlErr || !blob) {
      return json({ error: "Couldn't read that file — it may have failed to upload." }, 400);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length === 0) return json({ error: "That file was empty." }, 400);

    // Type-specific size guards BEFORE calling Claude (provider limits).
    if (cls.kind === "image" && bytes.length > MAX_IMAGE_BYTES) {
      return json({ error: "That image is too large to read (max 5 MB). Try a smaller or compressed scan." }, 400);
    }
    if (cls.kind === "pdf" && bytes.length > MAX_PDF_BYTES) {
      return json({ error: "That PDF is too large to read (max ~24 MB). Split it into smaller files." }, 400);
    }

    // Extract text.
    let content = "";
    let truncated = false;
    if (cls.kind === "text") {
      content = new TextDecoder().decode(bytes).trim();
    } else {
      const b64 = toBase64(bytes);
      const block = cls.kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: imageMediaType(mime, ext), data: b64 } };
      await scope.assert();
      let result;
      try {
        result = await callClaude({
          maxTokens: 32000,
          messages: [{ role: "user", content: [block, { type: "text", text: EXTRACT_PROMPT }] }],
          trace: { tenant_id: scope.tenantId, agent_id: "kb-ingest-file", job_kind: "extract" },
        });
      } catch (e) {
        // Don't leak the raw provider error to the tenant UI; log the detail.
        console.error("[kb-ingest-file] extraction failed:", (e as Error).message);
        return json({ error: "Paige couldn't read that file. It may be corrupt, password-protected, or an unsupported format." }, 400);
      }
      content = (result.text || "").trim();
      // Honest truncation signal: if the model hit the output cap, we only have a
      // prefix of a long document.
      truncated = result.stopReason === "max_tokens";
    }

    if (!content || content.length < 10) {
      return json({ error: "We couldn't pull any readable text out of that file." }, 400);
    }
    if (content.length > MAX_CONTENT) { content = content.slice(0, MAX_CONTENT); truncated = true; }

    const derivedTitle = (title?.trim() || filename?.replace(/\.[^.]+$/, "") || path.split("/").pop() || "Uploaded document").slice(0, 300);

    // Hand off to kb-ingest-doc, forwarding the caller's JWT so the doc is
    // created + chunked + embedded under the SAME tenant via RLS.
    await scope.assert();
    ingestionStarted = true;
    const ingestRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")!}/functions/v1/kb-ingest-doc`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
          apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
        },
        body: JSON.stringify({
          title: derivedTitle,
          content,
          // category is string | undefined in kb-ingest-doc's schema — omit if absent.
          ...(category ? { category } : {}),
          tags: tags ?? [],
          source: cls.source,
          share_to_network: share_to_network ?? false,
          tenant_id: scope.tenantId,
        }),
      },
    );
    const ingestBody = await ingestRes.json();
    await scope.assert();
    if (!ingestBody || typeof ingestBody !== "object" || Array.isArray(ingestBody)) throw new Error("Invalid ingestion response");
    return json({ ...ingestBody, source: cls.source, truncated }, ingestRes.status);
  } catch (error) {
    if (error instanceof KnowledgeIngestScopeError && !ingestionStarted) return json({ ok: false, error: error.message, ingestion_started: false }, error.status);
    // Never surface raw provider/internal error text to the tenant UI; log it.
    console.error("[kb-ingest-file] error:", error);
    return json({ ok: false, error: ingestionStarted ? "persistence_unverified" : "ingestion_not_started", detail: ingestionStarted ? "The save could not be verified. Keep the uploaded file and check your knowledge before retrying." : "The file could not be read. Nothing was indexed." }, 500);
  }
});
