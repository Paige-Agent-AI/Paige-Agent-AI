// supabase/functions/finalize-agreement/index.ts
//
// Receives the signed BTF service agreement from the /onboard wizard.
// Generates a PDF using pdf-lib, uploads it to the private `btf-onboarding`
// storage bucket, writes a row to paige_signed_agreements, advances
// clients.onboarding_stage, and fires the bridge event.
//
// Request body (JSON):
//   {
//     client_id: string,                  // required, must match auth.uid()'s linked client
//     agreement_template_key: string,
//     agreement_version: string,
//     agreement_text_snapshot: string,    // exact text the user accepted
//     signature: {
//       typed_name: string,
//       signature_image_base64?: string,  // PNG dataURL OR raw base64; optional if typed_name present
//       e_sign_consent: boolean,
//       read_consent: boolean,
//     }
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function err(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message, error_code: code }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeBase64Image(input: string): Uint8Array | null {
  if (!input) return null;
  const cleaned = input.replace(/^data:image\/\w+;base64,/, "");
  try {
    const bin = atob(cleaned);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function buildPdf(
  agreementText: string,
  typedName: string,
  signatureImg: Uint8Array | null,
  signedAtIso: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  const width = 612; // US Letter
  const height = 792;
  const fontSize = 10;
  const lineHeight = 14;
  const maxWidth = width - margin * 2;

  // naive word-wrap
  function wrap(text: string): string[] {
    const out: string[] = [];
    for (const rawLine of text.split("\n")) {
      if (rawLine.trim() === "") { out.push(""); continue; }
      const words = rawLine.split(/\s+/);
      let line = "";
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (font.widthOfTextAtSize(test, fontSize) > maxWidth) {
          if (line) out.push(line);
          line = w;
        } else {
          line = test;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }

  const lines = wrap(agreementText);
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  for (const line of lines) {
    if (y < margin + 120) {
      page = pdf.addPage([width, height]);
      y = height - margin;
    }
    const isHeading = /^#{1,3}\s/.test(line);
    const clean = line.replace(/^#{1,3}\s/, "");
    page.drawText(clean, {
      x: margin,
      y,
      size: isHeading ? 12 : fontSize,
      font: isHeading ? fontBold : font,
      color: rgb(0.05, 0.08, 0.16),
    });
    y -= isHeading ? lineHeight + 2 : lineHeight;
  }

  // Signature block
  if (y < margin + 140) {
    page = pdf.addPage([width, height]);
    y = height - margin;
  }
  y -= 24;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= 22;
  page.drawText("Signed by:", { x: margin, y, size: 11, font: fontBold, color: rgb(0.05, 0.08, 0.16) });
  y -= 18;
  page.drawText(typedName, { x: margin, y, size: 14, font: fontBold, color: rgb(0.05, 0.08, 0.16) });
  y -= 18;
  page.drawText(`Signed at: ${signedAtIso}`, { x: margin, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });

  if (signatureImg) {
    try {
      const png = await pdf.embedPng(signatureImg);
      const sigW = 220;
      const ratio = png.height / png.width;
      const sigH = sigW * ratio;
      y -= sigH + 8;
      page.drawImage(png, { x: margin, y, width: sigW, height: sigH });
    } catch (e) {
      console.warn("[finalize-agreement] sig embed failed", String(e));
    }
  }

  return await pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err(405, "METHOD_NOT_ALLOWED", "POST required");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return err(401, "UNAUTHORIZED", "Missing credentials");
  const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userRes?.user) return err(401, "UNAUTHORIZED", "Invalid session");
  const userId = userRes.user.id;

  let body: any;
  try { body = await req.json(); } catch { return err(400, "INVALID_BODY", "Invalid JSON"); }

  const client_id: string = body?.client_id ?? "";
  const agreement_template_key: string = body?.agreement_template_key ?? "";
  const agreement_version: string = body?.agreement_version ?? "";
  const agreement_text_snapshot: string = body?.agreement_text_snapshot ?? "";
  const signature = body?.signature ?? {};
  const typed_name: string = (signature?.typed_name ?? "").trim();
  const signature_image_base64: string = signature?.signature_image_base64 ?? "";
  const e_sign_consent = !!signature?.e_sign_consent;
  const read_consent = !!signature?.read_consent;

  if (!client_id || !agreement_template_key || !agreement_version || !agreement_text_snapshot) {
    return err(400, "MISSING_FIELDS", "client_id, agreement_template_key, agreement_version, and agreement_text_snapshot are required");
  }
  if (!typed_name) return err(400, "MISSING_NAME", "Typed legal name required");
  if (!e_sign_consent || !read_consent) return err(400, "CONSENT_REQUIRED", "Both consent checkboxes must be accepted");

  // Authorize: must be the linked owner of this client record.
  const { data: client, error: cliErr } = await admin
    .from("clients")
    .select("id, linked_user_id, onboarding_stage, first_name, last_name")
    .eq("id", client_id)
    .maybeSingle();
  if (cliErr || !client) return err(404, "CLIENT_NOT_FOUND", "Client not found");
  // The ownership check is UNCONDITIONAL (#1354). It used to read
  // `if (client.linked_user_id && client.linked_user_id !== userId)`, so an UNLINKED record
  // failed the `&&` and fell straight past the 403 into a self-claim — any holder of any valid
  // Supabase JWT plus a victim's `clients.id` could bind that record to themselves and then
  // execute an agreement under it with attacker-supplied contract text and signer name.
  //
  // LINKING IS NOT THIS FUNCTION'S JOB. It belongs to `public.accept_tenant_invite`, by owner
  // ruling recorded in 20260803160000_hotfix_612_clients_linking_integrity.sql:20-22:
  // "linkage to the auth user happens ONLY through the existing invite-accept path". Precisely:
  // one other linker exists, in the BROWSER (`useOnboardingClient.ts`, match-by-email then bind),
  // but it runs as the USER rather than as service-role, and the only permissive SELECT a consumer
  // satisfies on `clients` is `clients_linked_self_read` (`linked_user_id = auth.uid()`), which by
  // definition cannot return an unlinked row — so it cannot claim one. This function was the only
  // path that could, because it reads with service-role and RLS never ran. That same
  // note records WHY a gate on tenant membership is the wrong repair here: an earlier draft
  // added a linking RPC validating "target is an active tenant_members row of the caller's
  // tenant", and the adversarial §9 verifier proved that oracle is itself admin-forgeable. A
  // membership gate would ALSO refuse every genuine signer — `accept_tenant_invite`'s
  // kind='consumer' branch writes no `tenant_members` row at all, so an external client signer
  // is never a member of the sponsoring tenant.
  //
  // `userId` is server-derived from the verified bearer at :151-153, never from the body. This
  // is byte-for-byte the predicate the database already enforces on this very table —
  // `client_insert_own_agreement WITH CHECK (is_program_client_owner(client_id))` — which the
  // SERVICE-ROLE client above bypasses. The edge function was routing around its own guard.
  //
  // Nothing legitimate is refused: on the real path the row is already linked before this runs
  // (accept_tenant_invite binds it at invite acceptance), so the removed branch was dead code
  // for genuine signers and reachable only by someone who had no business there.
  if (client.linked_user_id !== userId) {
    return err(403, "FORBIDDEN", "You may only sign your own agreement");
  }

  // Build & upload PDF.
  const signedAtIso = new Date().toISOString();
  const sigImg = decodeBase64Image(signature_image_base64);
  let signed_pdf_path: string | null = null;
  try {
    const pdfBytes = await buildPdf(agreement_text_snapshot, typed_name, sigImg, signedAtIso);
    const filename = `agreement-${agreement_version}-${Date.now()}.pdf`;
    const path = `${client_id}/agreements/${filename}`;
    const { error: upErr } = await admin.storage
      .from("btf-onboarding")
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
    if (upErr) {
      console.error("[finalize-agreement] storage upload failed", upErr.message);
    } else {
      signed_pdf_path = path;
    }
  } catch (e) {
    console.error("[finalize-agreement] pdf build failed", String(e));
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const user_agent = req.headers.get("user-agent") ?? null;

  const { data: row, error: insErr } = await admin
    .from("paige_signed_agreements")
    .insert({
      client_id,
      agreement_template_key,
      agreement_version,
      signed_pdf_path,
      signature_data: {
        typed_name,
        has_drawn_signature: !!sigImg,
        e_sign_consent,
        read_consent,
        timezone_offset_min: body?.client_meta?.tz_offset_min ?? null,
      },
      agreement_text_snapshot,
      ip,
      user_agent,
      signed_at: signedAtIso,
    })
    .select("id")
    .single();
  if (insErr || !row) return err(500, "PERSIST_FAILED", insErr?.message ?? "Could not save agreement");

  // Advance onboarding stage straight to `completed` — the consumer onboarding
  // flow is now just (personal info → agreement). Everything else (business
  // details, funding intake, doc uploads) happens inside the portal with Paige.
  await admin
    .from("clients")
    .update({
      onboarding_stage: "completed",
      agreement_signed_at: signedAtIso,
      onboarding_completed_at: signedAtIso,
      updated_at: signedAtIso,
    })
    .eq("id", client_id)
    .in("onboarding_stage", ["invited", "signing_agreement", "pre_invite"]);

  return new Response(
    JSON.stringify({ ok: true, agreement_id: row.id, signed_pdf_path }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
