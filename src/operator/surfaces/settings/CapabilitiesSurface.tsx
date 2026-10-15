import { useMemo, useState } from "react";
import { usePlatformTrust } from "@/operator/data/usePlatformTrust";
import {
  clampMode,
  useToolAutonomy,
  type ToolMode,
  type ToolAutonomyRow,
} from "@/operator/data/useToolAutonomy";

/**
 * `settings · Capabilities` — v3 `capsVals` L9945–L10052, markup L1194–L1243.
 *
 * THIS ONE IS WIRED, NOT STRUCTURE-ONLY, AND IT IS THE FIRST LAYER 3d SURFACE THAT IS. Every
 * other surface in this layer ports a shape and waits for Layer 6. Capabilities does not have to:
 * `list_tool_autonomy()` and `set_tool_autonomy()` both ship, and CD's own foot names them —
 * *"Modes are stored per tenant per tool in tenant_tool_autonomy and resolved by
 * resolve_tool_autonomy."* So the tools, their modes, the counts and the write are all real.
 *
 * THE CEILING CLAMPS; IT DOES NOT WRITE. `capOf` (L9954): at a ceiling of 0 everything reads
 * `off`, at 1 an `auto` tool reads `confirm`. Applied at render only — if lowering the ceiling
 * rewrote what each tool is SET to, raising it again would not give those settings back.
 *
 * AUTOPILOT IS NOT OFFERED WHERE THE SCHEMA FORBIDS IT. `canAuto` (L9951): a tool that reaches a
 * person cannot run unattended, because `send_via_approval ⇒ requires_approval` is a database
 * rule, not a preference. The control renders struck through and refuses with CD's own line
 * rather than being hidden — a forbidden state you can see and cannot pick teaches the rule; a
 * missing one just looks like an oversight.
 */

/** `P.TOOL_MODES` — `paige-ia.js` L2531–L2535, verbatim. */
const MODE = {
  auto: { label: "Autopilot", tone: "var(--pg-positive)", note: "She does it herself, no confirmation." },
  confirm: { label: "Ask first", tone: "var(--pg-gold-deep)", note: "She proposes it, echoes exactly what she will do, and waits." },
  off: { label: "Off", tone: "var(--pg-faint)", note: "Disabled here. She cannot run it at all." },
} as const;

const MODE_ORDER: readonly ToolMode[] = ["auto", "confirm", "off"];

/**
 * Catalogue keys whose action reaches a PERSON, so approval is structural and "act on its own" is
 * not offered. The authority is the runtime clamp in paige-ai-chat (`clampLaneByRisk`: a `high`
 * action set to auto runs as confirm), keyed on the class in `supabase/functions/_shared/action-risk.ts`
 * — there is no database constraint behind this list. It is a partial mirror: a key missing here
 * offers an auto setting the runtime overrides (a false affordance, §70.1), which is the failure
 * direction to fix by adding the key.
 */
const REACHES_A_PERSON = new Set([
  "growth_page_publish",
  "growth_funnel_publish",
  "growth_form_publish",
  "growth_page_unpublish",
  "growth_funnel_unpublish",
  "growth_form_unpublish",
  "studio_image_publish",
  "studio_image_unpublish",
  "member_grant_role",
  "member_revoke_role",
  "calendar_book_meeting",
]);

const canAuto = (key: string) => !REACHES_A_PERSON.has(key);

export default function CapabilitiesSurface({
  onAnnounce,
}: {
  readonly onAnnounce?: (message: string) => void;
}) {
  const { rows, loading, error, setMode } = useToolAutonomy();
  const trust = usePlatformTrust();
  const [filter, setFilter] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const ceiling = trust.level;
  const effective = useMemo(
    () => new Map(rows.map((r) => [r.key, clampMode(r.mode, ceiling)] as const)),
    [rows, ceiling],
  );

  const count = (m: ToolMode) => rows.filter((r) => effective.get(r.key) === m).length;
  const noAuto = rows.filter((r) => !canAuto(r.key)).length;

  /** `stats` — L9964–L9968. Four counts, each a filter. */
  const stats = [
    { key: "confirm", n: count("confirm"), label: "Ask first", note: "The default — she proposes and waits", tone: MODE.confirm.tone },
    { key: "auto", n: count("auto"), label: "Autopilot", note: "She acts without asking", tone: MODE.auto.tone },
    { key: "off", n: count("off"), label: "Off", note: "She cannot run it at all", tone: MODE.off.tone },
    { key: "noauto", n: noAuto, label: "Cannot autopilot", note: "Reaches a person — the schema forbids it", tone: "var(--pg-negative)" },
  ];

  const keep = (r: ToolAutonomyRow) =>
    !filter || (filter === "noauto" ? !canAuto(r.key) : effective.get(r.key) === filter);

  const groups = useMemo(() => {
    const byCat = new Map<string, ToolAutonomyRow[]>();
    for (const r of rows) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }
    return [...byCat.entries()]
      .map(([title, all]) => ({ title, all, shown: all.filter(keep) }))
      .filter((g) => g.shown.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, effective]);

  const pick = async (row: ToolAutonomyRow, mode: ToolMode) => {
    if (mode === "auto" && !canAuto(row.key)) {
      onAnnounce?.(
        "Auto-send is unrepresentable. The schema requires approval on anything that reaches a person.",
      );
      return;
    }
    setPending(row.key);
    const ok = await setMode(row.key, mode);
    setPending(null);
    onAnnounce?.(
      ok
        ? `${row.label} → ${MODE[mode].label.toLowerCase()}.`
        : `${row.label} was not changed — the server refused it.`,
    );
  };

  if (loading) {
    return (
      <p className="text-[13px] text-[var(--pg-muted)]">Reading the capability catalogue…</p>
    );
  }

  /**
   * A FAILED READ SAYS SO. It does not render an empty catalogue that reads as "she can do
   * nothing" — which on a governance surface is the more dangerous of the two lies.
   */
  if (error && rows.length === 0) {
    return (
      <div className="max-w-[60ch]">
        <p className="text-[13px] text-[var(--pg-ink-2)]">
          The capability catalogue could not be read, so nothing here is being reported. This is
          not an empty catalogue — it is an unread one.
        </p>
        <p className="mt-2 font-mono text-[11px] text-[var(--pg-faint)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* STRIP · L1196–L1210. Four counts, each a filter, and the scope this applies to. */}
      <div className="flex flex-none flex-wrap items-center gap-x-[22px] gap-y-[9px] border-b border-[var(--pg-line)] pb-3.5">
        {stats.map((s) => {
          const on = filter === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setFilter(on ? null : s.key)}
              aria-pressed={on}
              className="flex min-w-0 items-center gap-[9px] border-0 bg-transparent px-0.5 pb-[5px] pt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ boxShadow: on ? `inset 0 -1px 0 ${s.tone}` : "none" }}
            >
              <b
                className="font-display text-[17px] font-normal tabular-nums tracking-[-0.01em]"
                style={{ color: on ? s.tone : "var(--pg-ink)" }}
              >
                {s.n}
              </b>
              <span className="flex min-w-0 flex-col text-left">
                <small
                  className="whitespace-nowrap text-[11.5px]"
                  style={{ color: on ? s.tone : "var(--pg-ink-2)", fontWeight: on ? 600 : 400 }}
                >
                  {s.label}
                </small>
                <small className="whitespace-nowrap text-[9.5px] text-[var(--pg-faint)]">
                  {s.note}
                </small>
              </span>
            </button>
          );
        })}
        {/*
          `capScope` — L1206–L1209. The pack cycles a scope label through four invented tenants.
          Ours is not a picker: the RPC resolves the CALLER's scope and the ScopeBand above the
          workspace already says which that is, so a second control here would be a way to claim a
          scope the read is not actually in.
        */}
        <span className="ml-auto flex items-center gap-1.5">
          <small className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--pg-faint)]">
            Applies to
          </small>
          <span className="min-h-[26px] whitespace-nowrap rounded-[var(--pg-r-pill)] border border-[var(--pg-line)] px-2.5 text-[11px] font-medium leading-[26px] text-[var(--pg-ink-2)]">
            The scope you are in
          </span>
        </span>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto pt-0.5">
        {groups.map((g) => {
          const autoN = g.all.filter((r) => effective.get(r.key) === "auto").length;
          const offN = g.all.filter((r) => effective.get(r.key) === "off").length;
          return (
            <div key={g.title} className="pb-0.5 pt-[15px]">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <b className="text-[12.5px] font-medium">{g.title}</b>
                <small className="font-mono text-[10px] tabular-nums text-[var(--pg-faint)]">
                  {autoN} on autopilot · {offN} off
                </small>
              </div>
              <div className="mt-2.5 grid gap-px bg-[var(--pg-line-soft)]">
                {g.shown.map((r) => {
                  const own = r.mode;
                  const eff = effective.get(r.key) ?? own;
                  const capped = eff !== own;
                  const why = capped
                    ? `The Trust Compass holds this at ${MODE[eff].label.toLowerCase()}.`
                    : !canAuto(r.key)
                      ? "Reaches a person, so autopilot is not offered."
                      : MODE[eff].note;
                  return (
                    <div
                      key={r.key}
                      className="flex min-w-0 flex-col bg-[var(--pg-workspace)] px-0.5 py-[9px]"
                    >
                      <span className="flex min-w-0 items-center gap-[9px]">
                        <i
                          aria-hidden
                          className="h-1.5 w-1.5 flex-none"
                          style={{ rotate: "45deg", background: MODE[eff].tone }}
                        />
                        <b className="min-w-0 truncate text-[12.5px] font-medium">{r.label}</b>
                        <small className="flex-none whitespace-nowrap font-mono text-[10px] text-[var(--pg-faint)]">
                          {r.key}
                        </small>
                        <small className="flex-none whitespace-nowrap text-[9.5px] text-[var(--pg-faint)]">
                          {r.inherited ? "inherited default" : "set for this scope"}
                        </small>
                      </span>
                      <span className="mt-[5px] flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[15px]">
                        {MODE_ORDER.map((m) => {
                          const legal = m !== "auto" || canAuto(r.key);
                          const on = own === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => void pick(r, m)}
                              disabled={pending === r.key}
                              aria-pressed={on}
                              title={
                                legal
                                  ? MODE[m].note
                                  : "Forbidden by the schema: a tool that reaches a person cannot run on autopilot."
                              }
                              className="min-h-[26px] flex-none whitespace-nowrap rounded-[var(--pg-r-pill)] border px-2.5 text-[11px] disabled:cursor-progress focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              style={{
                                borderColor: on ? MODE[m].tone : "var(--pg-line)",
                                background: on ? "var(--pg-lift)" : "transparent",
                                color: !legal ? "var(--pg-faint)" : on ? MODE[m].tone : "var(--pg-muted)",
                                fontWeight: on ? 600 : 400,
                                textDecoration: legal ? "none" : "line-through",
                                opacity: legal ? 1 : 0.5,
                              }}
                            >
                              {MODE[m].label}
                            </button>
                          );
                        })}
                        <small className="min-w-0 text-[10.5px] text-[var(--pg-faint)] [text-wrap:pretty]">
                          {why}
                        </small>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/*
          `capFoot` — L10050. CD's first two sentences are the rule and they port verbatim. Its
          last one stated a FIGURE about our own backend — a count of tools gated at runtime but
          missing from `list_tool_autonomy`. That gap is now ZERO: migration 20261020000000
          completed the catalogue, so every tool the runtime gates has a row the operator can see
          and turn off. A sentence describing a gap that no longer exists would be a false claim
          about the platform on the platform's own governance surface (§13), so it is removed
          rather than restated. `lint:tool-catalogue` now holds the gap AT zero and fails if a
          newly gated tool ever reopens one. OWED TO CD: this paragraph is shorter than the
          delivered `capFoot` by one sentence; whether anything replaces it is CD's call, not ours.
        */}
        <p className="mt-4 max-w-[66ch] border-t border-[var(--pg-line-soft)] pt-[13px] text-[10.5px] leading-[1.55] text-[var(--pg-faint)]">
          Modes are stored per tenant per tool and resolved before she acts — a tool with no row
          resolves to ask first, so nothing is ever on autopilot by accident. Two schema rules hold
          above any setting here: anything sent through approval must carry approval, and autopilot
          is only legal for a tool that records or runs a workflow. Auto-send cannot be expressed.
        </p>
      </div>
    </div>
  );
}
