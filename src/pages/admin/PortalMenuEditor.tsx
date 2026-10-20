import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useFinanceEntitlement } from "@/hooks/useFinanceEntitlement";
import { normalizePortalConfig, PORTAL_MENU_LABEL_MAX, type PortalModuleOverlay } from "@/hooks/useClientPortalConfig";
import {
  PORTAL_CUSTOMER_PREVIEW_VIEWER, PORTAL_MENU_FIXED_TOP, PORTAL_MENU_GROUPS, assemblePortalNav, defaultPortalMenuLabel,
  portalMenuEditorEntries, type PortalMenuEditorEntry, type PortalMenuGroupId, type PortalNavSection,
} from "@/lib/portal/portalMenu";

/**
 * E09 Slice M — "Customer portal menu": the owner chooses which entries their customers see, in what order
 * within each group, and what each is called. Reached in Solo through Clients → Portal → "Open gated Portal
 * configuration"; on other workspaces, the Client Portal page.
 *
 * Writes go through the ONE existing seam, set_tenant_portal_config (§10; Paige reaches the same seam through
 * client.portal_menu_configure). That seam merges shallowly, so Save always sends the FULL modules array —
 * every row here, plus any stored entry this editor does not show — and then re-reads. "Menu saved" is
 * claimed only when the re-read equals what was sent (§70.1); anything else is an honest error with the draft
 * kept. The preview is assemblePortalNav() over the unsaved rows: the same function the live menu runs.
 *
 * Impeccable OPERATE surface: compact rows, no banner, token-only, gold on Save menu alone (§11).
 */

const KEY_PATTERN = /^[a-z0-9_-]{1,40}$/;
// The writer refuses a name carrying a control character (C0 or C1) or an invisible formatting character —
// zero-width characters, LRM/RLM, the bidi embedding/override/isolate controls, the word joiner, a BOM
// (set_tenant_portal_config and the chat executor, 22023). Mirrors LABEL_FORBIDDEN in
// supabase/functions/_shared/client-portal-menu.ts. A typed or pasted one is removed rather than refused.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;
// eslint-disable-next-line no-control-regex
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;
const COUNTER_FROM = 30;
const FIXED_KEYS = new Set(PORTAL_MENU_FIXED_TOP.map((e) => e.key));

/** A name as the writer stores it: control characters removed, trimmed, at most 40 characters. "" when empty. */
const cleanName = (label: string) => label.replace(CONTROL, "").trim().slice(0, PORTAL_MENU_LABEL_MAX);
/** A stored name the writer would accept as it is, or null (a bad row must never block the owner's save). */
const acceptableStoredName = (label: unknown) =>
  typeof label === "string" && label.trim() !== "" && label.trim().length <= PORTAL_MENU_LABEL_MAX && !HAS_CONTROL.test(label)
    ? label.trim() : null;

interface Row extends PortalMenuEditorEntry {
  /** What the name field holds: the entry's effective name (the owner's, else the default). */
  label: string;
  visible: boolean;
}

/** The name a row resolves to: what the owner typed, or the default when the field is empty. */
const effectiveName = (r: Pick<Row, "label" | "defaultLabel">) => cleanName(r.label) || r.defaultLabel;

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "mismatch" }
  | { kind: "error"; message: string };

/** Rows in the order a customer sees them: group order, then the stored order within the group. */
function seedRows(entries: PortalMenuEditorEntry[], overlay: readonly PortalModuleOverlay[] | undefined): Row[] {
  const byKey = new Map((overlay ?? []).map((o) => [o.key, o]));
  return PORTAL_MENU_GROUPS.flatMap(({ id }) => entries
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.group === id)
    .sort((a, b) => {
      const ao = byKey.get(a.e.key)?.order, bo = byKey.get(b.e.key)?.order;
      const ap = typeof ao === "number" ? ao : a.index, bp = typeof bo === "number" ? bo : b.index;
      return ap !== bp ? ap - bp : a.index - b.index;
    })
    .map(({ e }): Row => {
      const o = byKey.get(e.key);
      return { ...e, label: (o?.label && cleanName(o.label)) || e.defaultLabel, visible: o?.visible !== false };
    }));
}

/** The modules array this draft saves: every row, then the stored entries this editor does not show. */
function draftModules(rows: Row[], saved: readonly PortalModuleOverlay[] | undefined): PortalModuleOverlay[] {
  // A name is stored only when it differs from the default; an empty field means the default.
  const own = rows.map((r, order): PortalModuleOverlay => {
    const label = effectiveName(r);
    return { key: r.key, visible: r.visible, order, ...(label !== r.defaultLabel ? { label } : {}) };
  });
  const seen = new Set(own.map((m) => m.key));
  // Never drop what another writer stored (the seam merges shallowly), but only carry what the seam accepts:
  // one entry per key, a valid key, an in-range order and a name it would store — so an old bad row can never
  // make the whole save fail.
  const kept: PortalModuleOverlay[] = [];
  for (const m of saved ?? []) {
    if (!m || typeof m.key !== "string" || seen.has(m.key) || !KEY_PATTERN.test(m.key)) continue;
    seen.add(m.key);
    // Home and Messages are fixed: the seam refuses hiding or renaming them, and the menu ignores it anyway.
    const fixed = FIXED_KEYS.has(m.key);
    const label = fixed ? null : acceptableStoredName(m.label);
    kept.push({
      key: m.key,
      ...(typeof m.visible === "boolean" && !(fixed && !m.visible) ? { visible: m.visible } : {}),
      ...(typeof m.order === "number" && Number.isFinite(m.order) && m.order >= 0 && m.order <= 1000 ? { order: m.order } : {}),
      ...(label ? { label } : {}),
    });
  }
  return [...own, ...kept].slice(0, 40);
}

/**
 * A failed save, in a sentence the owner can act on. Backend wording (codes, function names, SQL text) never
 * reaches the page (§11); anything unrecognised says "Try again."
 */
function menuSaveErrorText(error: unknown): string {
  const e = (error && typeof error === "object" ? error : {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : error instanceof Error ? error.message : "";
  if (code === "42501" || /forbidden|permission/i.test(message)) return "Your account can't change this menu. Ask the business owner to make the change.";
  if (code === "22023" || /invalid_portal_config/i.test(message)) return "One of the names isn't accepted. Use plain text of 40 characters or fewer.";
  if (code === "P0002") return "This business couldn't be found. Refresh the page and try again.";
  if (/failed to fetch|network|load failed|offline/i.test(message)) return "Your connection dropped. Check it and try again.";
  return "Try again.";
}

const sameModules = (a: readonly PortalModuleOverlay[] | undefined, b: readonly PortalModuleOverlay[] | undefined) => {
  const norm = (list: readonly PortalModuleOverlay[] | undefined) =>
    JSON.stringify((normalizePortalConfig({ modules: list ?? [] }).modules ?? [])
      .map((m) => [m.key, m.visible ?? null, m.order ?? null, m.label ?? null])
      .sort((x, y) => String(x[0]).localeCompare(String(y[0]))));
  return norm(a) === norm(b);
};

export interface PortalMenuEditorProps {
  catalog: readonly { key: string; label: string }[];
  /** The stored overlay (`portal_config.modules`). */
  saved: readonly PortalModuleOverlay[] | undefined;
  /** Writes `{ modules }` through set_tenant_portal_config. */
  save: (modules: PortalModuleOverlay[]) => Promise<unknown>;
  /** Re-reads the stored overlay after a save. */
  reread: () => Promise<readonly PortalModuleOverlay[] | undefined>;
  onDirtyChange?: (dirty: boolean) => void;
  /** The unsaved overlay, so PortalStudio's "View as client" follows the draft too. */
  onDraftChange?: (modules: PortalModuleOverlay[]) => void;
}

export function PortalMenuEditor({ catalog, saved, save, reread, onDirtyChange, onDraftChange }: PortalMenuEditorProps) {
  const headingId = useId();
  // E09 F2: funding/credit rows exist only for a finance-entitled business — the owner's current one.
  const { entitled: finance } = useFinanceEntitlement();
  const entries = useMemo(() => portalMenuEditorEntries(catalog, { finance }), [catalog, finance]);
  const savedKey = JSON.stringify({ saved: saved ?? [], keys: entries.map((e) => [e.key, e.defaultLabel]) });
  const [baseline, setBaseline] = useState<Row[]>(() => seedRows(entries, saved));
  const [rows, setRows] = useState<Row[]>(baseline);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const rowsKey = (list: Row[]) => JSON.stringify(list.map((r) => [r.key, r.visible, effectiveName(r)]));
  const dirty = rowsKey(rows) !== rowsKey(baseline);
  const defaults = useMemo(() => seedRows(entries, undefined), [entries]);
  const atDefault = rowsKey(rows) === rowsKey(defaults);
  const saving = status.kind === "saving";

  // A newer stored menu (another tab, Paige) replaces a clean editor; a draft is never overwritten.
  useEffect(() => {
    if (dirty || saving) return;
    const next = seedRows(entries, saved);
    setBaseline(next); setRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const modules = useMemo(() => draftModules(rows, saved), [rows, saved]);
  useEffect(() => { onDirtyChange?.(dirty || saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => { onDraftChange?.(modules); }, [modules, onDraftChange]);

  const preview = useMemo(
    () => assemblePortalNav({ catalog, overlay: modules, viewer: PORTAL_CUSTOMER_PREVIEW_VIEWER, entitlements: { finance } }),
    [catalog, modules, finance],
  );

  const edit = (key: string, change: Partial<Row>) => {
    setStatus({ kind: "idle" });
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)));
  };
  const move = (key: string, delta: -1 | 1) => {
    setStatus({ kind: "idle" });
    setRows((prev) => {
      const i = prev.findIndex((r) => r.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length || prev[j].group !== prev[i].group) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const reset = () => { setStatus({ kind: "idle" }); setRows(defaults); };

  const handleSave = async () => {
    const sent = modules;
    setStatus({ kind: "saving" });
    try {
      await save(sent);
      const back = await reread();
      if (!sameModules(sent, back)) { setStatus({ kind: "mismatch" }); return; }
      setBaseline(rows);
      setStatus({ kind: "saved" });
    } catch (e) {
      setStatus({ kind: "error", message: menuSaveErrorText(e) });
    }
  };

  const fixedTop = PORTAL_MENU_FIXED_TOP.filter((e) => e.floor !== "staff");
  const groupRows = (group: PortalMenuGroupId) => rows.filter((r) => r.group === group);

  return (
    <section aria-labelledby={headingId} data-testid="portal-menu-editor" className="space-y-4">
      <div className="space-y-1">
        <h2 id={headingId} className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-foreground">Customer portal menu</h2>
        <p className="max-w-[680px] text-[14px] leading-5 text-muted-foreground">
          Choose what your clients see, in what order, and what each item is called. Changes apply the next time they open the portal.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="min-w-0 space-y-3">
          <fieldset disabled={saving} aria-label="Customer portal menu items" className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <GroupHeading>Always shown</GroupHeading>
            {fixedTop.map((e) => {
              const Icon = e.icon;
              return (
                <div key={e.key} data-menu-row={e.key} className="flex min-h-[56px] items-center gap-2 border-t border-border/60 px-3 py-2 first-of-type:border-t-0 sm:gap-3 sm:px-5">
                  <Icon aria-hidden className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                  <span className="flex h-[44px] min-w-0 flex-1 items-center truncate rounded-md border border-border/70 bg-muted/40 px-3 text-[14px] text-foreground">
                    {defaultPortalMenuLabel(e, catalog)}
                  </span>
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                    <Lock aria-hidden className="h-[14px] w-[14px]" /> Always on
                  </span>
                </div>
              );
            })}
            {PORTAL_MENU_GROUPS.map(({ id, label: groupLabel }) => {
              const list = groupRows(id);
              if (list.length === 0) return null;
              return (
                <div key={id} role="group" aria-label={groupLabel}>
                  <GroupHeading>{groupLabel}</GroupHeading>
                  {list.map((row, i) => (
                    <MenuRow
                      key={row.key}
                      row={row}
                      first={i === 0}
                      last={i === list.length - 1}
                      onLabel={(label) => edit(row.key, { label: label.slice(0, PORTAL_MENU_LABEL_MAX) })}
                      onVisible={(visible) => edit(row.key, { visible })}
                      onMove={(delta) => move(row.key, delta)}
                    />
                  ))}
                </div>
              );
            })}
            <p className="border-t border-border/60 px-4 py-3 text-[13px] leading-5 text-muted-foreground sm:px-5">
              Get help, Account, Settings and Sign out are always at the bottom. Or tell Paige: “hide Resources from my clients' portal.”
            </p>
          </fieldset>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <StatusLine status={status} />
            <Button type="button" variant="outline" className="h-[44px]" onClick={reset} disabled={saving || atDefault}>Reset to default</Button>
            <Button type="button" variant="gold" className="h-[44px]" onClick={() => void handleSave()} disabled={!dirty || saving}>
              {saving ? <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
              Save menu
            </Button>
          </div>
        </div>

        <aside aria-label="What your clients see" className="min-w-0 self-start rounded-xl border border-border bg-card p-4 shadow-card xl:sticky xl:top-4">
          <p className="pb-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.08em] text-muted-foreground">What your clients see</p>
          <PortalMenuPreview sections={preview} testId="portal-menu-preview" />
          <p className="pt-3 text-[12px] leading-4 text-muted-foreground">A customer of this business, before saving. Not live client data.</p>
        </aside>
      </div>
    </section>
  );
}

/**
 * The customer's menu as a customer of this business sees it — the drawer's grouped, deep-ink panel. Shared by
 * the editor's "What your clients see" and PortalStudio's "View as client", both fed by assemblePortalNav(), so
 * neither preview can tell a different story from the live menu (§13/§18).
 */
export function PortalMenuPreview({ sections, testId, dense = false }: { sections: readonly PortalNavSection[]; testId?: string; dense?: boolean }) {
  return (
    // The sidebar tokens hold the same ink in every shell theme; the primary pair does not (in the tenant shell's
    // dark theme it measured 3.4:1).
    <div data-testid={testId} role="presentation" className="rounded-xl bg-sidebar p-2 text-sidebar-foreground">
      {sections.map((section) => (
        <div key={section.id} className={cn(section.label && "pt-2")}>
          {section.label && (
            <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-sidebar-foreground">{section.label}</p>
          )}
          {section.items.map((item, i) => {
            const Icon = item.icon;
            const current = section.id === "top" && i === 0;
            return (
              <div key={item.href} className={cn("flex items-center gap-3 rounded-md px-3", dense ? "min-h-[32px] text-[13px]" : "min-h-[40px] text-[14px]", current ? "bg-sidebar-foreground/15 font-medium text-sidebar-foreground" : "text-sidebar-foreground")}>
                <Icon aria-hidden className="h-4 w-4 shrink-0" />
                <span data-portal-label className="truncate">{item.label}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function GroupHeading({ children }: { children: string }) {
  return (
    <p data-menu-heading className="border-t border-border/60 px-4 pb-2 pt-4 text-[12px] font-semibold uppercase leading-4 tracking-[0.08em] text-muted-foreground first:border-t-0 sm:px-5">
      {children}
    </p>
  );
}

function MenuRow({ row, first, last, onLabel, onVisible, onMove }: {
  row: Row; first: boolean; last: boolean;
  onLabel: (label: string) => void; onVisible: (visible: boolean) => void; onMove: (delta: -1 | 1) => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const Icon = row.icon;
  const length = row.label.length;
  const name = effectiveName(row);
  const renamed = name !== row.defaultLabel;
  const hint = renamed ? `Renamed from ${row.defaultLabel}` : row.editorHint;
  // 44px targets, one line at 390px: the controls never wrap under the name; the hint sits under the field.
  const moveButton = "inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div data-menu-row={row.key} data-hidden={row.visible ? undefined : "true"} className={cn("flex min-h-[56px] items-center gap-2 border-t border-border/60 px-3 py-2 transition-colors motion-reduce:transition-none sm:gap-3 sm:px-5", !row.visible && "bg-muted/40")}>
      <Icon aria-hidden className={cn("h-[18px] w-[18px] shrink-0", row.visible ? "text-muted-foreground" : "text-muted-foreground/60")} />
      <div className="min-w-0 flex-1">
        <div className="relative">
          <Input
            id={inputId}
            aria-label={`Name for ${row.defaultLabel}`}
            aria-describedby={hint ? hintId : undefined}
            value={row.label}
            maxLength={PORTAL_MENU_LABEL_MAX}
            onChange={(e) => onLabel(e.target.value)}
            // Clearing the field returns the entry to its default name.
            onBlur={() => { if (!cleanName(row.label)) onLabel(row.defaultLabel); }}
            className={cn(
              "h-[44px] text-[14px] md:text-[14px]",
              length >= COUNTER_FROM && "pr-14",
              row.visible ? "text-foreground" : "border-dashed bg-transparent text-muted-foreground",
            )}
          />
          {length >= COUNTER_FROM && (
            <span data-testid="label-counter" aria-live="polite" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] tabular-nums text-muted-foreground">
              {length}/{PORTAL_MENU_LABEL_MAX}
            </span>
          )}
        </div>
        {(hint || !row.visible) && (
          <p id={hintId} className="truncate pt-1 text-[12px] leading-4 text-muted-foreground">
            {[!row.visible ? "Hidden from clients" : null, hint].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        <button type="button" className={moveButton} aria-label={`Move ${row.defaultLabel} up`} disabled={first} onClick={() => onMove(-1)}>
          <ChevronUp aria-hidden className="h-4 w-4" />
        </button>
        <button type="button" className={moveButton} aria-label={`Move ${row.defaultLabel} down`} disabled={last} onClick={() => onMove(1)}>
          <ChevronDown aria-hidden className="h-4 w-4" />
        </button>
        <span className="inline-flex h-[44px] w-[48px] shrink-0 items-center justify-end">
          {/* The switch track is small; its hit area extends to 44px (the Solo shell scales rem, so px). */}
          <Switch checked={row.visible} onCheckedChange={onVisible} aria-label={`Show ${row.defaultLabel}`} className="relative after:absolute after:-inset-x-[4px] after:-inset-y-[12px] after:content-['']" />
        </span>
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  if (status.kind === "saving") return <p data-testid="portal-menu-status" role="status" className="text-[13px] text-muted-foreground">Saving…</p>;
  if (status.kind === "saved") {
    return <p data-testid="portal-menu-status" role="status" className="text-[13px] text-muted-foreground">Menu saved. Your clients see it the next time they open the portal.</p>;
  }
  const text = status.kind === "mismatch"
    ? "The saved menu doesn't match what you set, so your clients may see something different. Your changes are still here. Try saving again."
    : `Couldn't save the menu. ${status.message} Your changes are still here.`;
  return <p data-testid="portal-menu-status" role="alert" className="max-w-[460px] text-[13px] font-medium text-destructive">{text}</p>;
}
