import { Link } from "react-router-dom";
import { ArrowRight, FileSignature } from "lucide-react";
import { usePortalAgreementsGlance } from "@/hooks/useClientPortalAgreements";
import { useCustomerPortalNav } from "@/hooks/useCustomerPortalNav";
import { flattenPortalNav } from "@/lib/portal/portalMenu";

export const AGREEMENTS_HREF = "/app/agreements";

/**
 * The customer Home's one quiet line when an agreement waits for their signature (E09 Slice A, owner decision
 * D-A5). It appears only when the count is above zero AND Agreements is in THIS customer's menu — the same
 * sections AppNav renders (useCustomerPortalNav, §18/§57) — so an owner who hid Agreements never has it come
 * back through Home. Nothing at all while loading, on a failed read, or for anyone who is not a customer: a
 * missing line is honest, a "0 waiting" or a guessed count is not.
 */
export function AgreementsWaitingLine({ enabled }: { enabled: boolean }) {
  const { sections, ready } = useCustomerPortalNav();
  const entry = ready ? flattenPortalNav(sections).find((i) => i.href === AGREEMENTS_HREF) : undefined;
  const glance = usePortalAgreementsGlance(enabled && !!entry);
  if (!entry || glance.state !== "ready" || glance.awaitingYou < 1) return null;
  const n = glance.awaitingYou;
  return (
    <Link
      to={AGREEMENTS_HREF}
      data-testid="agreements-waiting-line"
      className="flex min-h-[44px] items-center gap-3 rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:col-span-2"
    >
      <FileSignature aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 font-medium">{n} agreement{n === 1 ? "" : "s"} waiting for your signature</span>
      <span className="inline-flex shrink-0 items-center gap-1 font-medium">
        Review <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </span>
    </Link>
  );
}
