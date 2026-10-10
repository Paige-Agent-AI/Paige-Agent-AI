// The Studio DOCUMENT canvas (#119/#292) — renders a design-agent-authored long-form document
// (guide, one-pager, ebook, checklist, worksheet) as a premium, book/one-pager-grade artifact, NOT a
// Word dump. It draws the block vocabulary the agent authors (cover → section-header → prose → callout
// → pull-quote → list → stat → cta) onto a "paper" sheet floating on the studio canvas well.
//
// Craft (§11/§22/§23): a designed COVER leads (never body paragraph one); a real modular type scale
// with tight negative tracking on the display title (the "expensive" tell); a hard reading measure so
// prose never becomes a wall; section rhythm (section gap >> paragraph gap); layered depth via a
// bordered, shadowed sheet, not a flat fill; token-only, AA in both themes, motion-safe. Gold is NOT
// spent here (§11 — gold is only the act/approve moment on the chrome); the document's own CTA renders
// on the neutral/indigo primary, and headings are ink/indigo.
//
// Robustness (§13 — "degrades, never throws"): a block that passed the server's type filter may still
// carry a mis-typed VALUE (a list whose items are objects, a prose whose markdown is a number). Every
// field is coerced to a safe primitive at render, react-markdown only ever receives a string, and the
// whole sheet is wrapped in an ErrorBoundary so even an unforeseen render error degrades to an honest
// empty state instead of crashing the studio canvas.
//
// "Print / Save as PDF" is HONEST (§13): it opens the browser's native print dialog (whose "Save as
// PDF" is a real, universal export) over a print-scoped view of just this sheet — it is NOT a
// server-rendered PDF binary (that, plus ebook pagination, is a tracked fast-follow). It's labeled for
// exactly what it does.
import {
  Component,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import ReactMarkdown from "react-markdown";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SectionCard, EmptyState } from "@/components/ui/page";
import { ArtifactStrip } from "./ArtifactStrip";
import { printStudioDocument } from "./studio-document";
import type { StudioDocBlock, StudioDocument } from "./studio-types";

// Coerce any model-authored value to a safe display string (§13 — a mis-typed field never crashes the
// render; it degrades to text or empty). Objects/arrays fold to "" rather than reaching React as a child.
function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

const CALLOUT_TONE: Record<string, { bar: string; tint: string; label: string }> = {
  tip: { bar: "--success", tint: "--success", label: "Tip" },
  "do-this": { bar: "--success", tint: "--success", label: "Do this" },
  warning: { bar: "--warning", tint: "--warning", label: "Heads up" },
  "key-insight": { bar: "--primary", tint: "--primary", label: "Key insight" },
  definition: { bar: "--primary", tint: "--primary", label: "Definition" },
  example: { bar: "--muted-foreground", tint: "--muted-foreground", label: "Example" },
};

/** Prose renders through react-markdown with token-styled elements. The input is ALWAYS coerced to a
 *  string first (react-markdown v10 throws on a truthy non-string), so a mis-typed markdown value
 *  degrades to an empty block instead of crashing the surface. */
function Prose({ markdown }: { markdown: unknown }) {
  const text = str(markdown);
  if (!text) return null;
  return (
    <div className="max-w-[68ch] text-[1.0625rem] leading-[1.7] text-foreground/90 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_em]:italic [&_strong]:font-semibold [&_strong]:text-foreground [&_p]:mt-4 first:[&_p]:mt-0 [&_h3]:mt-6 [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:tracking-tight [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1.5">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

/** Clamp a model-authored number to a safe integer range (§13 — a NaN/absurd count never breaks the
 *  render; it falls back to `fallback`, then to [min,max]). */
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function Block({ block, allBlocks }: { block: StudioDocBlock; allBlocks: StudioDocBlock[] }) {
  switch (block.type) {
    case "cover":
      return (
        <header className="relative overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-gradient-to-br from-[hsl(var(--primary)/0.10)] via-[hsl(var(--card))] to-[hsl(var(--card))] px-8 py-12 md:px-12 md:py-16">
          {str(block.eyebrow) && (
            <p className="mb-4 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-primary">{str(block.eyebrow)}</p>
          )}
          <h1 className="font-display text-[clamp(2rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.02em] text-foreground">
            {str(block.title) || "Untitled"}
          </h1>
          {str(block.subhead) && (
            <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-muted-foreground">{str(block.subhead)}</p>
          )}
        </header>
      );
    case "section-header":
      return (
        <div className="mt-2">
          {str(block.kicker) && (
            <p className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-primary">{str(block.kicker)}</p>
          )}
          <h2 className="flex items-baseline gap-3 font-display text-2xl font-semibold tracking-tight text-foreground md:text-[1.7rem]">
            {typeof block.number === "number" && Number.isFinite(block.number) && (
              <span className="text-base font-semibold tabular-nums text-muted-foreground">{String(block.number).padStart(2, "0")}</span>
            )}
            <span>{str(block.title)}</span>
          </h2>
          <div className="mt-3 h-px w-full bg-[hsl(var(--border))]" aria-hidden />
        </div>
      );
    case "chapter-divider": {
      // The ebook signature: a chapter opens on its own, centered, on a fresh printed page. The big
      // numeral is an INDIGO tint, never gold (§11 — gold is only the act moment, which a document has none of).
      const title = str(block.title);
      if (!title) return null;
      const hasNumber = typeof block.number === "number" && Number.isFinite(block.number);
      return (
        <div className="break-before-page break-inside-avoid py-6 text-center md:py-10">
          <div className="mx-auto mb-6 h-px w-14 bg-[hsl(var(--primary)/0.45)]" aria-hidden />
          {str(block.kicker) && (
            <p className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-primary">{str(block.kicker)}</p>
          )}
          {hasNumber && (
            <div className="font-display text-[clamp(3rem,7vw,5rem)] font-bold leading-none tracking-[-0.03em] text-[hsl(var(--primary)/0.28)]">
              {String(block.number).padStart(2, "0")}
            </div>
          )}
          <h2 className="mt-3 font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em] text-foreground">{title}</h2>
          {str(block.subhead) && (
            <p className="mx-auto mt-4 max-w-[42ch] text-lg leading-relaxed text-muted-foreground">{str(block.subhead)}</p>
          )}
          <div className="mx-auto mt-6 h-px w-14 bg-[hsl(var(--primary)/0.45)]" aria-hidden />
        </div>
      );
    }
    case "toc": {
      // Explicit entries win; otherwise auto-build from the document's own section/chapter titles so the
      // agent never has to hand-maintain a contents list that can drift from the headings (§13).
      const explicit = (Array.isArray(block.entries) ? block.entries : []).map(str).filter(Boolean);
      const entries = explicit.length
        ? explicit
        : allBlocks
            .filter((b) => b.type === "section-header" || b.type === "chapter-divider")
            .map((b) => str((b as { title?: unknown }).title))
            .filter(Boolean);
      if (!entries.length) return null;
      return (
        <nav className="break-inside-avoid rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] px-6 py-5 md:px-7 md:py-6">
          <p className="mb-4 font-display text-lg font-semibold tracking-tight text-foreground">{str(block.title) || "Contents"}</p>
          <ol className="space-y-0">
            {entries.map((entry, i) => (
              <li key={i} className="flex items-baseline gap-3 border-b border-[hsl(var(--border)/0.6)] py-2.5 last:border-b-0">
                <span className="font-display text-sm font-semibold tabular-nums text-primary">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1 text-[0.975rem] leading-snug text-foreground/90">{entry}</span>
              </li>
            ))}
          </ol>
        </nav>
      );
    }
    case "prose":
      return <Prose markdown={block.markdown} />;
    case "callout": {
      const tone = CALLOUT_TONE[String(block.variant ?? "key-insight")] ?? CALLOUT_TONE["key-insight"];
      const body = str(block.body);
      if (!body) return null;
      return (
        <aside
          className="rounded-xl border border-l-4 p-5"
          style={{
            borderColor: `hsl(var(${tone.bar}) / 0.35)`,
            borderLeftColor: `hsl(var(${tone.bar}))`,
            background: `hsl(var(${tone.tint}) / 0.06)`,
          }}
        >
          {/* Label in foreground (AA-safe in both themes) with a colored dot carrying the semantic
              tone — amber/green-as-small-text would fail AA in light mode (§11/§23). */}
          <p className="mb-1.5 flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-foreground/80">
            <span className="h-2 w-2 rounded-full" style={{ background: `hsl(var(${tone.bar}))` }} aria-hidden />
            {str(block.title) || tone.label}
          </p>
          <p className="text-[0.975rem] leading-relaxed text-foreground/90">{body}</p>
        </aside>
      );
    }
    case "pull-quote": {
      const quote = str(block.quote);
      if (!quote) return null;
      return (
        <blockquote className="border-l-2 border-primary/50 py-1 pl-6">
          <p className="font-display text-xl font-medium italic leading-snug text-foreground md:text-2xl">“{quote}”</p>
          {str(block.attribution) && <footer className="mt-3 text-sm text-muted-foreground">— {str(block.attribution)}</footer>}
        </blockquote>
      );
    }
    case "stat":
      return (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] px-6 py-5">
          <div className="font-display text-4xl font-bold tabular-nums tracking-tight text-foreground">{str(block.value)}</div>
          <div className="mt-1 text-sm text-muted-foreground">{str(block.label)}</div>
        </div>
      );
    case "list": {
      // Coerce to an array of strings — a list whose items are objects/numbers degrades cleanly (§13).
      const items = (Array.isArray(block.items) ? block.items : []).map(str).filter(Boolean);
      if (!items.length) return null;
      if (block.style === "checklist") {
        return (
          <ul className="space-y-2.5">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-3 text-[1.0625rem] leading-relaxed text-foreground/90">
                <span className="mt-1 h-4 w-4 shrink-0 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.6)]" aria-hidden />
                <span>{it}</span>
              </li>
            ))}
          </ul>
        );
      }
      const Tag = block.style === "numbered" ? "ol" : "ul";
      return (
        <Tag className={cn("space-y-2 pl-5 text-[1.0625rem] leading-relaxed text-foreground/90", block.style === "numbered" ? "list-decimal" : "list-disc")}>
          {items.map((it, i) => <li key={i} className="pl-1">{it}</li>)}
        </Tag>
      );
    }
    case "worksheet-field": {
      // A REAL blank the user prints and fills in — never faked "sample" content (§13/§15). The prompt
      // sits above; the blank below is genuinely empty. break-inside-avoid keeps a field whole on a page.
      const label = str(block.label);
      if (!label) return null;
      const helper = str(block.helper);
      const kind = ["line", "lines", "box", "scale", "checkbox"].includes(String(block.field)) ? String(block.field) : "lines";
      const rule = "h-8 border-b border-[hsl(var(--border))]";
      let fill: ReactNode;
      if (kind === "line") {
        fill = <div className={rule} aria-hidden />;
      } else if (kind === "box") {
        fill = <div className="min-h-[7rem] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)]" aria-hidden />;
      } else if (kind === "checkbox") {
        fill = (
          <div className="flex items-center gap-3">
            <span className="h-5 w-5 shrink-0 rounded border-2 border-[hsl(var(--border))]" aria-hidden />
            <div className="h-8 flex-1 border-b border-[hsl(var(--border))]" aria-hidden />
          </div>
        );
      } else if (kind === "scale") {
        const lo = clampInt(block.scaleMin, 0, 9, 1);
        const hi = clampInt(block.scaleMax, lo + 1, lo + 10, Math.max(lo + 4, lo + 1));
        const ticks: number[] = [];
        for (let n = lo; n <= hi; n++) ticks.push(n);
        const minLabel = str(block.minLabel);
        const maxLabel = str(block.maxLabel);
        fill = (
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              {ticks.map((n) => (
                <span key={n} className="grid h-9 w-9 place-items-center rounded-full border border-[hsl(var(--border))] text-sm font-semibold tabular-nums text-foreground/70">{n}</span>
              ))}
            </div>
            {(minLabel || maxLabel) && (
              <div className="mt-2 flex justify-between text-[0.72rem] text-muted-foreground">
                <span>{minLabel}</span>
                <span>{maxLabel}</span>
              </div>
            )}
          </div>
        );
      } else {
        const n = clampInt(block.lines, 1, 12, 3);
        fill = (
          <div className="space-y-5">
            {Array.from({ length: n }).map((_, i) => <div key={i} className={rule} aria-hidden />)}
          </div>
        );
      }
      return (
        <div className="break-inside-avoid rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.12)] px-5 py-4">
          <div className="mb-3">
            <p className="text-[0.95rem] font-semibold leading-snug text-foreground">{label}</p>
            {helper && <p className="mt-1 text-[0.8rem] leading-relaxed text-muted-foreground">{helper}</p>}
          </div>
          {fill}
        </div>
      );
    }
    case "pricing-table": {
      // A proposal's line-item investment table. Coerce every cell to a string; drop empty rows (§13).
      const rows = (Array.isArray(block.rows) ? block.rows : [])
        .map((r) => ({ item: str((r as { item?: unknown })?.item), detail: str((r as { detail?: unknown })?.detail), amount: str((r as { amount?: unknown })?.amount) }))
        .filter((r) => r.item || r.amount);
      if (!rows.length) return null;
      const total = str(block.total);
      const caption = str(block.caption);
      return (
        <div className="break-inside-avoid overflow-hidden rounded-2xl border border-[hsl(var(--border))]">
          {caption && (
            <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-6 py-3">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{caption}</p>
            </div>
          )}
          {/* Scroll the table itself on a narrow phone so a long item + amount never pushes the whole
              sheet (and the page body) into horizontal scroll (§11 responsive). */}
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-[hsl(var(--border)/0.7)]">
                  <td className="px-6 py-4 align-top">
                    <div className="text-[0.975rem] font-medium text-foreground">{r.item}</div>
                    {r.detail && <div className="mt-0.5 text-[0.85rem] leading-relaxed text-muted-foreground">{r.detail}</div>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right align-top font-display text-[0.975rem] font-semibold tabular-nums text-foreground">{r.amount}</td>
                </tr>
              ))}
            </tbody>
            {total && (
              <tfoot>
                <tr className="bg-[hsl(var(--muted)/0.3)]">
                  <td className="px-6 py-4 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Total</td>
                  <td className="whitespace-nowrap px-6 py-4 text-right font-display text-lg font-bold tabular-nums text-foreground">{total}</td>
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        </div>
      );
    }
    case "cta": {
      const headline = str(block.headline);
      const action = str(block.action) || "Get started";
      const href = str(block.href);
      const actionCls = "mt-5 inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground";
      return (
        <div className="rounded-2xl border border-[hsl(var(--primary)/0.3)] bg-[hsl(var(--primary)/0.06)] px-8 py-9 text-center">
          {headline && <p className="font-display text-xl font-semibold tracking-tight text-foreground md:text-2xl">{headline}</p>}
          {/* Render a real link when the doc carries an href (§13 — don't persist what you ignore);
              otherwise a non-interactive chip so it reads as the document's call-to-action. */}
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className={actionCls}>{action}</a>
          ) : (
            <span className={actionCls}>{action}</span>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

/** Per-block boundary is impractical (they're siblings), so one boundary wraps the whole sheet: an
 *  unforeseen render error degrades to an honest empty state, never a crashed studio canvas (§13). */
class DocBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn("[studio] document render failed:", err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const DOC_EMPTY = (
  <div className="grid h-full place-items-center">
    <SectionCard className="max-w-md">
      <EmptyState icon={FileText} tone="brand" title="Your document is saved"
        description="It’s filed to this project. Ask your design agent to rebuild it and it appears here." />
    </SectionCard>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════════════
// Paged viewer (#331) — a long document (real page breaks / lots of content) switches from the
// single continuous sheet to a PAGE model: a left page-thumbnail rail + one page on screen, while
// ALL pages still render inside [data-paige-doc-sheet] for a full Save-as-PDF export (§13 — the paged
// view must NEVER shrink the print to just the current page). A short doc keeps today's single sheet
// (exactly 1 page — page count is derived from the real content, never fabricated).
// ═══════════════════════════════════════════════════════════════════════════════════════

/** One paginated page — a group of the document's own blocks. `status` is 'ready' today; 'building'
 *  exists for the OPTIONAL per-block stream (a not-yet-arrived page shows a skeleton) and is never
 *  set from fabricated data (§13). */
interface DocPage {
  index: number;
  blocks: StudioDocBlock[];
  status: "ready" | "building";
}

// Measurement + render must share these so a page's measured height matches what it draws.
const PAGE_CONTENT_W = 720; // px — the sheet's inner content width the paginator measures against
const PAGE_BUDGET_PX = 940; // px — a Letter-ish page height budget for the soft (height) break
const PAGE_GAP_PX = 32; // px — space-y-8 between blocks, added to accumulated height

/** Hard page-break groups — deterministic, no measurement. A new page starts at index 0, at every
 *  `chapter-divider` (it carries break-before-page), and at any later `cover`. Each group is a run of
 *  {block,i} whose i indexes back into the original blocks array (for measured height lookup). */
function splitHardGroups(blocks: StudioDocBlock[]): { items: { block: StudioDocBlock; i: number }[] }[] {
  const groups: { items: { block: StudioDocBlock; i: number }[] }[] = [];
  let cur: { block: StudioDocBlock; i: number }[] = [];
  blocks.forEach((block, i) => {
    const isHardBreak = block.type === "chapter-divider" || (block.type === "cover" && i > 0);
    if (isHardBreak && cur.length) {
      groups.push({ items: cur });
      cur = [];
    }
    cur.push({ block, i });
  });
  if (cur.length) groups.push({ items: cur });
  return groups.length ? groups : [{ items: [] }];
}

/** Group the document's blocks into pages. Hard breaks split first (cover/chapter-divider); within a
 *  hard group, soft-break by measured accumulated height against the page budget. Blocks are atomic
 *  (never split mid-block), which honors break-inside-avoid on toc/worksheet-field/pricing-table for
 *  free. Heights are read ONCE (useLayoutEffect, before paint — no flash) from the off-screen full
 *  tree at `measureRef`; until measured, pages are the hard groups (correct, just possibly tall). A
 *  short doc with no hard breaks and little content yields exactly 1 page (§13). */
function usePaginatedBlocks(blocks: StudioDocBlock[], measureRef: RefObject<HTMLElement>): DocPage[] {
  const hardGroups = useMemo(() => splitHardGroups(blocks), [blocks]);
  const [pages, setPages] = useState<DocPage[]>(() =>
    hardGroups.map((g, index) => ({ index, blocks: g.items.map((it) => it.block), status: "ready" as const })),
  );

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) {
      setPages(hardGroups.map((g, index) => ({ index, blocks: g.items.map((it) => it.block), status: "ready" as const })));
      return;
    }
    // Measure each block's rendered height off the off-screen full tree (keyed by data-block-index).
    const heights = new Map<number, number>();
    el.querySelectorAll<HTMLElement>("[data-block-index]").forEach((node) => {
      const idx = Number(node.getAttribute("data-block-index"));
      if (Number.isFinite(idx)) heights.set(idx, node.offsetHeight);
    });

    const next: DocPage[] = [];
    let pageIndex = 0;
    for (const group of hardGroups) {
      let acc = 0;
      let curBlocks: StudioDocBlock[] = [];
      for (const item of group.items) {
        const h = (heights.get(item.i) ?? 0) + PAGE_GAP_PX;
        // Start a fresh page when adding this block would overflow the budget — but never emit an
        // empty page (a single over-tall block gets its own page rather than being dropped).
        if (curBlocks.length && acc + h > PAGE_BUDGET_PX) {
          next.push({ index: pageIndex++, blocks: curBlocks, status: "ready" });
          curBlocks = [];
          acc = 0;
        }
        curBlocks.push(item.block);
        acc += h;
      }
      next.push({ index: pageIndex++, blocks: curBlocks, status: "ready" });
    }
    setPages(next.length ? next : [{ index: 0, blocks: [], status: "ready" }]);
  }, [hardGroups, measureRef]);

  return pages;
}

/** The paper-sheet styling, shared by the on-screen page, the single-sheet path, and the print tree,
 *  so every surface reads as the same document (§22 layered depth — border + soft shadow, never flat). */
const SHEET_CLS =
  "space-y-8 rounded-2xl border border-[hsl(var(--border))] bg-card shadow-[shadow:0_24px_60px_-28px_hsl(var(--studio-ink,var(--foreground))/0.5)]";

/** A single page's blocks, drawn on the paper sheet. Memoized: the rail renders one of these per page
 *  (scaled) and re-render churn on a 40-page doc would jank (a tracked virtualization fast-follow). */
function PageSheet({ blocks, allBlocks, className }: { blocks: StudioDocBlock[]; allBlocks: StudioDocBlock[]; className?: string }) {
  return (
    <article className={cn(SHEET_CLS, "px-6 py-8", className)}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} allBlocks={allBlocks} />
      ))}
    </article>
  );
}

/** The left page-thumbnail rail — reuses the shared ArtifactStrip (vertical), with REAL CSS-scaled page
 *  renders as thumbnails (§22 — never a glyph-in-a-box). A not-yet-ready page (optional per-block stream)
 *  shows a skeleton shimmer. Token-only, indigo active ring (never gold, §11). */
function PageThumbRail({
  pages,
  allBlocks,
  currentPage,
  onSelect,
  reduceMotion,
}: {
  pages: DocPage[];
  allBlocks: StudioDocBlock[];
  currentPage: number;
  onSelect: (index: number) => void;
  reduceMotion: boolean;
}) {
  const items = pages.map((p) => ({ id: String(p.index), label: `Page ${p.index + 1}`, caption: String(p.index + 1), page: p }));
  const scale = 60 / PAGE_CONTENT_W; // tile inner width ≈ 60px
  return (
    <div className="h-full min-h-0 shrink-0">
      <ArtifactStrip
        orientation="vertical"
        className="h-full min-h-0"
        ariaLabel="Pages"
        thumbClassName="h-[5.25rem] w-[3.75rem] bg-card"
        items={items}
        activeId={String(currentPage)}
        reduceMotion={reduceMotion}
        onSelect={(it) => onSelect(it.page.index)}
        renderThumb={(it) =>
          it.page.status === "building" ? (
            <Skeleton className="h-full w-full rounded-none motion-reduce:animate-none" />
          ) : (
            // A REAL scaled render of the page — the document's own blocks, shrunk. pointer-events-none
            // so the tile stays one click target; overflow-hidden crops to the tile.
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="origin-top-left"
                style={{ width: PAGE_CONTENT_W, transform: `scale(${scale})` }}
                aria-hidden
              >
                <div className="space-y-8 px-6 py-8">
                  {it.page.blocks.map((b, i) => (
                    <Block key={i} block={b} allBlocks={allBlocks} />
                  ))}
                </div>
              </div>
            </div>
          )
        }
      />
    </div>
  );
}

/** The paged view: rail + one page on screen + prev/next. Print-hidden — the full print tree lives in
 *  DocumentPreview so Save-as-PDF always captures the whole document (§13). */
function DocumentPager({
  pages,
  allBlocks,
  reduceMotion,
}: {
  pages: DocPage[];
  allBlocks: StudioDocBlock[];
  reduceMotion: boolean;
}) {
  const [currentPage, setCurrentPage] = useState(0);
  // Repagination (re-measure) can shrink the page count — never point past the end.
  useLayoutEffect(() => {
    setCurrentPage((p) => Math.min(p, pages.length - 1));
  }, [pages.length]);
  const safePage = Math.min(currentPage, pages.length - 1);
  const page = pages[safePage] ?? pages[0];

  const pageView = (
    <div className="mx-auto w-[720px] max-w-full">
      <PageSheet blocks={page.blocks} allBlocks={allBlocks} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 gap-4 print:hidden">
      <PageThumbRail pages={pages} allBlocks={allBlocks} currentPage={safePage} onSelect={setCurrentPage} reduceMotion={reduceMotion} />
      {/* min-w-0: the page column may shrink below the 720px sheet in a narrow host instead of overflowing it. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
          {reduceMotion ? (
            pageView
          ) : (
            // A light crossfade on page change — reuses opacity, no new keyframes (§22). Motion-safe
            // mirror is the branch above.
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={safePage} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                {pageView}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        {/* Page nav — neutral, no gold (§11). tabular-nums so the counter doesn't jitter. */}
        <div className="flex shrink-0 items-center justify-center gap-3 py-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Previous page"
            disabled={safePage <= 0}
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            Page {safePage + 1} / {pages.length}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Next page"
            disabled={safePage >= pages.length - 1}
            onClick={() => setCurrentPage((p) => Math.min(pages.length - 1, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** `toolbar={false}` leaves the Print / Save as PDF button to the host, which calls printStudioDocument
 *  (the Marketing library puts it beside its other actions). */
export function DocumentPreview({ document, className, toolbar = true }: { document: StudioDocument; className?: string; toolbar?: boolean }) {
  // Print / Save as PDF — the browser's native dialog over a print-scoped view of just this sheet.
  const onPrint = useCallback(() => printStudioDocument(), []);

  const reduceMotion = !!useReducedMotion();
  const blocks = useMemo(() => (Array.isArray(document.blocks) ? document.blocks : []), [document.blocks]);

  // The paginator measures block heights off a MEASUREMENT tree (below): `fixed`, zero-footprint
  // (h-0 w-0 overflow-hidden), so its 720px content lays out and is measurable but contributes NOTHING
  // to scroll or flow and is never seen/printed. Measured ONCE per blocks change (§ risk: no per-page
  // re-measure). Kept separate from the print tree so neither a horizontal-scroll edge nor a clipping
  // ancestor can break the other.
  const measureRef = useRef<HTMLDivElement>(null);
  const pages = usePaginatedBlocks(blocks, measureRef);
  const paged = pages.length > 1;

  return (
    <div className={cn("h-full", paged ? "flex flex-col overflow-hidden" : "overflow-y-auto", className)}>
      {/* Measurement tree — fixed + clipped to 0×0 so it never scrolls, shows, or prints; the inner
          720px column still lays out (real offsetHeights). aria-hidden: a measurement twin only. */}
      <div aria-hidden className="pointer-events-none fixed left-0 top-0 -z-50 h-0 w-0 overflow-hidden print:hidden">
        <div ref={measureRef} className="w-[720px] space-y-8 px-6 py-8">
          {blocks.map((b, i) => (
            <div key={i} data-block-index={i}>
              <Block block={b} allBlocks={blocks} />
            </div>
          ))}
        </div>
      </div>

      {/* Print-only FULL document (paged mode only) — display:none on screen, block for print, carrying
          data-paige-doc-sheet so the browser's Save-as-PDF captures the WHOLE document even though only
          one page is on screen (§13 — the paged view must never shrink the export). In single-sheet mode
          the visible sheet below already carries data-paige-doc-sheet, so this isn't rendered (no dup). */}
      {paged && (
        <article
          data-paige-doc-sheet
          className="hidden space-y-8 rounded-2xl border border-[hsl(var(--border))] bg-card px-6 py-8 print:block"
        >
          {blocks.map((b, i) => <Block key={i} block={b} allBlocks={blocks} />)}
        </article>
      )}

      <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-3 px-1 py-1", paged && "h-full min-h-0")}>
        {/* Toolbar — neutral, no gold (§11). Honest label: it's the browser's Save-as-PDF. */}
        {toolbar && (
          <div className="flex shrink-0 items-center justify-end print:hidden">
            <Button variant="outline" size="sm" onClick={onPrint} className="gap-2">
              <Printer className="h-4 w-4" aria-hidden />
              Print / Save as PDF
            </Button>
          </div>
        )}
        <DocBoundary fallback={DOC_EMPTY}>
          {paged ? (
            // Long document → the paged view (rail + one page). The whole document still prints via the
            // off-screen data-paige-doc-sheet tree above.
            <div className="min-h-0 flex-1">
              <DocumentPager pages={pages} allBlocks={blocks} reduceMotion={reduceMotion} />
            </div>
          ) : (
            // Short document → today's single continuous sheet, unchanged (this one carries
            // data-paige-doc-sheet and prints directly). Layered depth via border + soft shadow (§22).
            <article
              data-paige-doc-sheet
              className="space-y-8 rounded-2xl border border-[hsl(var(--border))] bg-card px-6 py-8 shadow-[shadow:0_24px_60px_-28px_hsl(var(--studio-ink,var(--foreground))/0.5)] md:px-12 md:py-12"
            >
              {blocks.map((b, i) => <Block key={i} block={b} allBlocks={blocks} />)}
            </article>
          )}
        </DocBoundary>
      </div>
    </div>
  );
}

export default DocumentPreview;
