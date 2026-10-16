// Neutral, platform-default service agreement.
//
// This is the coaching-generic default shown to a tenant's client when the tenant
// hasn't authored their own agreement (§2/§9): zero credit/funding/vertical wording,
// no platform (Paige) or any specific business named — the tenant's name and the
// client's name are substituted at render time. A tenant can replace this entirely
// with their own document (their attorney's language) via the agreement editor.
//
// PLAIN TEXT by design: what is shown is exactly what is signed and snapshotted
// (no markdown rendering layer), so a legal reader sees clean text, never raw
// "#"/"**" markup. Placeholders use {{double_braces}}: {{tenant_name}},
// {{client_full_legal_name}}, {{effective_date}}, {{signature_date}}. Unknown
// placeholders are LEFT INTACT (never silently deleted from a legal document).

export const DEFAULT_AGREEMENT_TITLE = "Client Services Agreement";
export const DEFAULT_AGREEMENT_VERSION = "default-v1";

/** Placeholder keys this renderer knows how to substitute. */
const KNOWN_KEYS = new Set(["tenant_name", "client_full_legal_name", "effective_date", "signature_date"]);

export const DEFAULT_AGREEMENT_TEMPLATE = `CLIENT SERVICES AGREEMENT

Effective Date: {{effective_date}}

This Client Services Agreement (the "Agreement") is entered into between {{tenant_name}} ("Provider," "we," "us") and {{client_full_legal_name}} ("Client," "you").


1. Services
Provider will deliver the professional services, guidance, and materials described to the Client as part of the Client's engagement ("Services"). The Services are provided by Provider; the technology platform this portal runs on is a service provider and is not a party to this Agreement.

2. Term
This Agreement begins on the Effective Date and continues for the duration of the Client's engagement with Provider, subject to the termination terms below.

3. Fees & Payment
Fees, payment amounts, and schedules are as agreed between Provider and Client. By signing below, the Client acknowledges the fee arrangement communicated by Provider. Payment terms, refunds, and cancellation are governed by Provider's stated policies.

4. Client Responsibilities
The Client agrees to provide accurate and complete information, participate in scheduled sessions, complete assigned tasks, and promptly notify Provider of any relevant changes in circumstances.

5. Confidentiality & Data Handling
Provider will treat Client information as confidential and handle it in accordance with Provider's privacy policy.

6. No Guarantee
Provider makes no guarantee of any specific outcome. Results depend on the Client's effort, third-party decisions, and factors outside Provider's control. Nothing in this Agreement constitutes legal, tax, accounting, or financial advice unless expressly stated by Provider.

7. Termination
Either party may terminate this Agreement on written notice. Fees earned and costs incurred through the termination date remain due and payable.

8. Limitation of Liability
Provider's total liability under this Agreement shall not exceed the fees the Client paid to Provider in the six (6) months preceding the claim. Provider is not liable for indirect, incidental, or consequential damages.

9. Electronic Signature (E-SIGN Act / UETA)
The Client agrees that electronic signatures and electronic records have the same legal force as handwritten signatures, and may withdraw consent to electronic records at any time by contacting Provider.

10. Governing Law
This Agreement is governed by the laws of the jurisdiction in which Provider operates, without regard to its conflict-of-laws principles.


Client: {{client_full_legal_name}}
Date of Signature: {{signature_date}}

Provider: {{tenant_name}}
`;

export interface AgreementValues {
  tenant_name?: string | null;
  client_full_legal_name?: string | null;
  effective_date?: string | null;
  signature_date?: string | null;
}

/**
 * Substitute {{placeholders}} in any agreement body (default OR a tenant's own).
 * Only KNOWN keys are substituted; an unrecognized {{token}} is left intact so a
 * mistyped placeholder is visible in the signed document rather than silently
 * vanishing (legal-integrity safeguard).
 */
export function renderAgreementBody(body: string, values: AgreementValues): string {
  return body.replace(/\{\{([a-z_]+)\}\}/gi, (match, key) => {
    const k = String(key).toLowerCase();
    if (!KNOWN_KEYS.has(k)) return match; // leave unknown tokens visible
    const v = (values as Record<string, string | null | undefined>)[k];
    return v == null ? "" : String(v);
  });
}
