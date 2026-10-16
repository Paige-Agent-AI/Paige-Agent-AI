import {DEFAULT_AGREEMENT_TEMPLATE,DEFAULT_AGREEMENT_VERSION,renderAgreementBody} from "./client-service-agreement-template.ts";

/** Exact-content binding for the incumbent service agreement. No signing effect. */
export function clientServiceAgreementMatches(
  profile:{id:string;first_name:string|null;last_name:string|null},
  source:{tenant_name?:string|null;agreement_body?:string|null},
  submission:{client_id:string;agreement_template_key:string;agreement_version:string;agreement_text_snapshot:string},
  now=new Date(),
):boolean {
  if(!source.tenant_name?.trim()||profile.id!==submission.client_id)return false;
  const custom=source.agreement_body;
  const today=now.toISOString().slice(0,10);
  const expected=renderAgreementBody(custom||DEFAULT_AGREEMENT_TEMPLATE,{
    tenant_name:source.tenant_name,
    client_full_legal_name:[profile.first_name,profile.last_name].filter(Boolean).join(" ").trim()||"Client",
    effective_date:today,signature_date:today,
  });
  return submission.agreement_template_key===(custom?"tenant_custom":"platform_default")
    &&submission.agreement_version===(custom?"tenant-v1":DEFAULT_AGREEMENT_VERSION)
    &&submission.agreement_text_snapshot===expected;
}
