import { Link, useInRouterContext } from "react-router-dom";
import { ArrowRight } from "lucide-react";

// Moved verbatim from PaigeAIChat.tsx (E4-S3 PR-0) so the approval card's check links and the read
// links beside an answer share ONE renderer. The classes encode the approved approval-card design
// (§28 frozen): do not restyle them here — spacing for a new row lives in that row's own wrapper.

/**
 * Where to check an action that may have gone through. An in-app link inside the app's router; a
 * plain link anywhere without one, so the chat never starts depending on a router to render.
 */
export function CheckLinks({ links }: { links: Array<{ label: string; to: string }> }) {
  const inRouter = useInRouterContext();
  // Ink with an underline at rest, as the approved design draws it. The Solo shell paints every
  // link gold (`[data-pg] a`), and gold is spent on Approve alone, so the colour is set firmly here.
  const className = "inline-flex items-center gap-1 text-[13px] font-semibold !text-foreground";
  const label = (text: string) => (
    <span className="underline decoration-[color:var(--pg-line-strong,hsl(var(--border)))] underline-offset-[3px] hover:decoration-current">
      {text}
    </span>
  );
  return (
    <>
      {links.map((link) => inRouter ? (
        <Link key={link.to} to={link.to} className={className}>
          {label(link.label)}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : (
        <a key={link.to} href={link.to} className={className}>
          {label(link.label)}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      ))}
    </>
  );
}
