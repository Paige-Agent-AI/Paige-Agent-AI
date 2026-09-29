// Create + send a DocuSign envelope from a template, then record it.
// Body: { contact_id?, envelope_type, template_id, prefill?: { email, name, role? }, email_subject?, email_blurb? }
import { adminClient, corsHeaders, jsonResponse, requireAdmin } from "../_shared/adminAuth.ts";
import { getDocuSignAccess } from "../_shared/docusignJwt.ts";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses } from "../_shared/contact-methods.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const {
    contact_id = null,
    envelope_type = "other",
    template_id,
    prefill,
    email_subject,
    email_blurb,
  } = body ?? {};

  if (!template_id) return jsonResponse({ error: "missing_template_id" }, 400);

  // Resolve recipient. Either prefill provided, or look up contact.
  let toEmail = prefill?.email as string | undefined;
  let toName = prefill?.name as string | undefined;
  const roleName = (prefill?.role as string | undefined) || "Signer";

  if (contact_id && (!toEmail || !toName)) {
    // The signer is the contact at their PRIMARY email.
    const { data: row } = await guard.admin
      .from("clients")
      .select(`first_name, last_name, ${CLIENT_CONTACT_METHODS_EMBED}`)
      .eq("id", contact_id)
      .maybeSingle();
    const contact = withPrimaryAddresses(row);
    if (contact) {
      toEmail ||= contact.email ?? undefined;
      toName ||= `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || contact.email || undefined;
    }
  }

  if (!toEmail) return jsonResponse({ error: "missing_recipient_email" }, 400);

  const access = await getDocuSignAccess();
  if (!access.ok) return jsonResponse({ error: access.error }, 500);

  const url = `${access.baseUri}/restapi/v2.1/accounts/${access.accountId}/envelopes`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      templateId: template_id,
      emailSubject: email_subject ?? "Please sign this document",
      emailBlurb: email_blurb,
      status: "sent",
      templateRoles: [
        { email: toEmail, name: toName ?? toEmail, roleName },
      ],
    }),
  });
  const respText = await res.text();
  if (!res.ok) {
    return jsonResponse({ error: `docusign_${res.status}`, detail: respText.slice(0, 500) }, 502);
  }
  const json = JSON.parse(respText);

  await guard.admin.from("paige_signature_envelopes").insert({
    envelope_id: json.envelopeId,
    contact_id,
    envelope_type,
    template_id,
    status: "sent",
    sent_at: new Date().toISOString(),
    metadata: { recipient: { email: toEmail, name: toName, role: roleName } },
    created_by: guard.userId,
  });

  return jsonResponse({ ok: true, envelopeId: json.envelopeId });
});
