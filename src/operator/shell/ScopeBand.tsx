/**
 * The scope band — the strip ABOVE the shell, spanning its full width.
 *
 * Geometry is the pack's (`PAIGE Super Admin Shell v3.dc.html` L73-L84, `bandStyle` L10730):
 * `flex:none`, `min-height:36px` (a FLOOR, not a fixed height — the band grows if its content
 * wraps rather than clipping it), `padding:0 16px`, `gap:12px`, `align-items:center`, and a tone
 * that repaints the whole strip when scope changes.
 *
 * WHY IT SITS ABOVE THE SHELL, not inside a header: scope is the value of one column
 * (`tenant_id`), not a place you travel to, so it frames every column at once — rail, canvas and
 * spine alike. The pack's own `exitScope` announcement is the tell: "active_tenant_id returned
 * to NULL" (§9, and the guard in `scopeIsNotNavigation.test.ts`).
 *
 * THE BAND IS DRAWN, NOT DECIDED HERE. `LiveScopeBand` reads the session's scope and hands this
 * component a state; when an act-as is open it also hands an `exit` — the pack's `exitScope`
 * control (Shell v3 L78-L82). There is still no cross-window broadcast and no cycle control:
 * those are session behaviours this band does not own.
 */
import { cn } from "@/lib/utils";
import type { ScopeState, ScopeTone } from "@/operator/shell/scopeStates";

/** Ruling A — each tone paints on its named token, never on a shadcn alias. */
const GROUND: Record<ScopeTone, string> = {
  none: "bg-[var(--pg-surface)] border-border",
  read: "bg-[var(--pg-workspace)] border-border-strong",
  // Acting as a tenant must be unmissable at a glance: a raised ground, the authority line, and a
  // caution rule on the leading edge (§23 — you are inside someone else's workspace). Gold stays
  // on the exit act alone (§11).
  act: "bg-[var(--pg-raised)] border-[var(--pg-line-authority)] shadow-[inset_3px_0_0_var(--pg-warning)]",
};

const KICKER: Record<ScopeTone, string> = {
  none: "text-muted-foreground",
  read: "text-foreground",
  act: "text-foreground",
};

export type ScopeBandProps = Omit<ScopeState, "tone"> & {
  readonly tone?: ScopeTone;
  /**
   * Ruling B — the band is the LAST thing the collapse touches. At the rail's breakpoint it
   * THINS; it never disappears, because it is the thing that says what scope you are in. 32px is
   * the thinned height in CD's own reference implementation of the order
   * (`scripts/live-drive/harness/fixtures/_shell.css`); 36px is the pack's rest floor.
   */
  readonly compact?: boolean;
  /**
   * Leaving the tenant, offered only while acting. The act moment on this band, so it carries the
   * authority line and gold ink (§11: gold on the act, never at rest). `busy` disables it while
   * the audited exit is in flight so one press is one exit.
   */
  readonly exit?: { readonly label: string; readonly onExit: () => void; readonly busy: boolean };
};

export default function ScopeBand({ tone = "none", kicker, scope, audit, compact = false, exit }: ScopeBandProps) {
  return (
    <div
      data-scope-band={tone}
      data-scope-band-compact={compact ? "" : undefined}
      className={cn(
        // min-h, never h: the pack's band is a floor so a wrapping scope line grows the strip
        // instead of clipping it. flex-none keeps it out of the shell's height budget.
        "flex min-w-0 flex-none flex-wrap items-center gap-3 border-b px-4",
        compact ? "min-h-[32px]" : "min-h-[36px]",
        "transition-colors duration-200",
        GROUND[tone],
      )}
    >
      <span className={cn("min-w-0 flex-none truncate text-[11px] font-medium", KICKER[tone])}>
        {kicker}
      </span>
      <b className="min-w-0 truncate text-[11px] font-medium tracking-[0.02em] text-foreground">
        {scope}
      </b>
      <span className="min-w-0 flex-none truncate text-[11px] text-muted-foreground">
        {audit}
      </span>
      {exit && (
        <button
          type="button"
          data-scope-exit=""
          onClick={exit.onExit}
          disabled={exit.busy}
          aria-busy={exit.busy || undefined}
          className="ml-auto min-h-[24px] flex-none rounded-[3px] border border-[var(--pg-line-authority)] bg-transparent px-2.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--pg-gold-core)] disabled:opacity-60"
        >
          {exit.busy ? "Leaving…" : exit.label}
        </button>
      )}
    </div>
  );
}
