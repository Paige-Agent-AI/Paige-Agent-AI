import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FIELD_TABS,
  PEOPLE_FOOT,
  PEOPLE_SEGMENTS,
  PERSON_PANELS,
  PERSON_TABS,
  RELATIONSHIPS_ABSENCE,
  inSegment,
  lifecycleTone,
  monogram,
  type PersonField,
  type PersonPanelRow,
  type PersonRecord,
  type PersonTab,
  type PeopleSegment,
} from "@/operator/surfaces/relationships/relationshipsContract";

/**
 * Relationships · People — the book.
 *
 * PORTED FROM `PAIGE Super Admin Shell v3.dc.html`: `peopleVals` L4854–L5157, markup L616–L736.
 * BUILD-ORDER Layer 3a.
 *
 * ─── WHAT THE SURFACE IS ─────────────────────────────────────────────────────────────────────
 *
 * A chip row over the book, then two panes: the LIST (a table whose columns thin at narrow
 * widths) and the RECORD (identity row · ten tabs · a body that is either fields or a panel).
 * It takes the viewport rather than sitting under a ladder — CD's note at L5102: *"Like the
 * console, the database takes the viewport."*
 *
 * THE FOLD IS A CHANGE OF GEOMETRY, NEVER A LOSS OF SURFACE (CD, L4864): below 720px the panes
 * do not shrink, they show ONE AT A TIME with a back step. That is the same fold Conversations
 * uses at its own floor, and porting it is what keeps a record reachable on a narrow window.
 *
 * ─── THE MARK ────────────────────────────────────────────────────────────────────────────────
 *
 * A company reads as a plate and a person as a disc, so the two are distinguishable before you
 * read a word; a record with no image gets a MONOGRAM derived from its own name — CD is explicit
 * that this is *"never a generated face or an invented logo."* The mark borrows the lifecycle
 * tone, so the row's state is legible from the mark alone.
 *
 * ─── A VALUE IS A CLAIM ABOUT SOMEONE ────────────────────────────────────────────────────────
 *
 * CD's comment at L5111 is the whole design of the field row: *"A value is a claim about someone,
 * so a change carries where it came from… Her edit is an act under her grant — Ask first lands it
 * as a proposal, Autonomous lands it and reports."* So a field carries three things beyond its
 * value: its SOURCE (a form submission, a correction taken on a call, a hand entry), a MASK on
 * anything sensitive whose reveal is recorded, and, where she has one, a PROPOSAL held for a
 * human word with Accept and Reject.
 *
 * THE MASK IS A DISPLAY STATE, NOT A SUBSTITUTE VALUE (CD, L5122). The record holds the real
 * value and the bullets are derived from it at render, so a reveal shows what is actually on
 * file rather than a number invented at render time.
 *
 * ─── STRUCTURE BEFORE DATA ───────────────────────────────────────────────────────────────────
 *
 * `records` arrives empty and that is the finished Layer 3 state. `P.PEOPLE` is CD's
 * illustration — seven records carrying EINs, SSNs, billing methods and signed agreements —
 * and shipping it would put invented people on an operator's screen (§13), while pointing it at
 * a real account would break §63. The pack sanitises its own fixtures ("AUTHORIZED TENANT ·
 * 0f3a", "fixture A") which says plainly that they illustrate a shape.
 *
 * With no records the chips read zero, the count reads honestly, the detail pane says what it is
 * waiting for, and the slot's authored absence explains why. Layer 6 hands this real rows and
 * nothing about the render changes.
 */

export type PeopleSurfaceProps = {
  readonly records?: readonly PersonRecord[];
  /** Rows for the six non-field faces, keyed by tab. A read supplies them; none are invented. */
  readonly panelRows?: Readonly<Partial<Record<PersonTab, readonly PersonPanelRow[]>>>;
  /** `pickedActs[0]` — the audited act-as. Absent renders it disabled rather than inert. */
  readonly onEnterScope?: (record: PersonRecord) => void;
  /** `pickedActs[1]` — opens the thread in Conversations. */
  readonly onMessage?: (record: PersonRecord) => void;
  readonly onAddRecord?: () => void;
  readonly onEditField?: (record: PersonRecord, tab: PersonTab, field: PersonField, next: string) => void;
  readonly onResolveProposal?: (
    record: PersonRecord,
    tab: PersonTab,
    field: PersonField,
    outcome: "accept" | "reject",
  ) => void;
  /** A reveal is an act on someone's data, so it is announced and — in Layer 6 — logged. */
  readonly onReveal?: (record: PersonRecord, tab: PersonTab, field: PersonField) => void;
  readonly onAnnounce?: (message: string) => void;
};

const HEAD_CELL =
  "whitespace-nowrap text-[8.5px] font-semibold uppercase tracking-[0.14em] text-[var(--pg-faint)]";

export default function PeopleSurface({
  records = [],
  panelRows = {},
  onEnterScope,
  onMessage,
  onAddRecord,
  onEditField,
  onResolveProposal,
  onReveal,
  onAnnounce,
}: PeopleSurfaceProps) {
  const [seg, setSeg] = useState<PeopleSegment>("All");
  const [personId, setPersonId] = useState<string | null>(null);
  const [tab, setTab] = useState<PersonTab>("Identity");
  /** `s.pSolo` — which pane the narrow fold is showing. */
  const [solo, setSolo] = useState<"list" | "detail">("list");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const list = useMemo(() => records.filter((r) => inSegment(r, seg)), [records, seg]);
  const picked = useMemo(
    () => records.find((r) => r.id === personId) ?? list[0] ?? records[0] ?? null,
    [records, list, personId],
  );

  /** `peopleVals` L4881 — each chip counts the whole book, not the filtered view. */
  const countIn = (k: PeopleSegment) => records.filter((r) => inSegment(r, k)).length;

  const isFields = (FIELD_TABS as readonly string[]).includes(tab);
  const fields: readonly PersonField[] = !picked
    ? []
    : tab === "Identity"
      ? (picked.identity ?? [])
      : tab === "Business"
        ? (picked.business ?? [])
        : tab === "Documents"
          ? (picked.docs ?? [])
          : tab === "Billing"
            ? (picked.billing ?? [])
            : [];
  const panel = PERSON_PANELS[tab];
  const rows = panelRows[tab] ?? [];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* ── THE CHIP ROW · v3 L617–L624 ─────────────────────────────────────────────────────── */}
      <div className="flex flex-none flex-wrap items-center gap-[5px] border-b border-[var(--pg-line-soft)] pb-[9px]">
        {PEOPLE_SEGMENTS.map((k) => {
          const on = seg === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setSeg(k)}
              className={cn(
                "inline-flex min-h-[28px] flex-none items-center gap-1.5 whitespace-nowrap border-0 bg-transparent px-0.5 text-[11.5px]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on
                  ? "font-semibold text-foreground shadow-[shadow:inset_0_-1px_0_var(--pg-gold)]"
                  : "font-normal text-[var(--pg-muted)]",
              )}
            >
              {k}
              <small className="font-mono text-[9.5px] text-[var(--pg-faint)]">{countIn(k)}</small>
            </button>
          );
        })}
        <span className="min-w-[12px] flex-1" />
        <span className="font-mono text-[10.5px] text-[var(--pg-faint)]">
          {list.length} of {records.length}
        </span>
        <button
          type="button"
          onClick={onAddRecord}
          disabled={!onAddRecord}
          className="min-h-[26px] flex-none whitespace-nowrap rounded-[var(--pg-r-chip)] border border-[var(--pg-line)] bg-transparent px-2.5 text-[11px] text-[var(--pg-muted)] disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Add record
        </button>
      </div>

      {/* ── THE TWO PANES · v3 L626–L734 ────────────────────────────────────────────────────────
          The pack derives the fold from a measured canvas width; a CSS container query would be
          the same test one layer down, but the panes also need to swap on a BACK PRESS, which is
          state. So the fold is a media query on the grid and the solo state drives which pane
          shows below it — `lg:` is 1024px against the pack's 720px canvas, which is the same
          floor once the rail and spine outside this surface are accounted for. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 border-t border-[var(--pg-line-soft)] lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,1fr)]">
        {/* the list */}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-col lg:flex lg:shadow-[shadow:inset_-1px_0_0_var(--pg-line-soft)]",
            solo === "list" ? "flex" : "hidden",
          )}
        >
          <div className="grid min-h-[26px] flex-none grid-cols-[3px_24px_minmax(0,1fr)_62px_84px] items-center gap-[9px] border-b border-[var(--pg-line)] pr-2.5 xl:grid-cols-[3px_24px_minmax(0,1.5fr)_62px_92px_58px_40px]">
            <span />
            <span className={HEAD_CELL} />
            <span className={HEAD_CELL}>Name</span>
            <span className={HEAD_CELL}>Type</span>
            <span className={HEAD_CELL}>Lifecycle</span>
            <span className={cn(HEAD_CELL, "hidden xl:block")}>Owner</span>
            <span className={cn(HEAD_CELL, "hidden xl:block")}>Touch</span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {list.map((r) => {
              const tone = lifecycleTone(r.life);
              const on = picked?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setPersonId(r.id);
                    setSolo("detail");
                  }}
                  className={cn(
                    "grid min-h-[46px] w-full grid-cols-[3px_24px_minmax(0,1fr)_62px_84px] items-center gap-[9px] border-0 border-b border-[var(--pg-line-soft)] py-1.5 pl-0 pr-2.5 text-left",
                    "xl:grid-cols-[3px_24px_minmax(0,1.5fr)_62px_92px_58px_40px]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    on ? "bg-[var(--pg-lift)]" : "bg-transparent",
                  )}
                >
                  <i
                    aria-hidden
                    className="self-stretch"
                    style={{ background: on ? "var(--pg-gold)" : "transparent" }}
                  />
                  <RecordMark record={r} px={22} />
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate text-[12.5px] font-medium text-foreground">{r.name}</b>
                    <small className="mt-0.5 truncate text-[10.5px] text-[var(--pg-faint)]">{r.sub}</small>
                  </span>
                  <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--pg-faint)]">
                    {r.kind}
                  </span>
                  <span
                    className="truncate text-[9.5px] font-semibold tracking-[0.06em]"
                    style={{ color: tone }}
                  >
                    {r.life}
                  </span>
                  <span className="hidden truncate font-mono text-[10.5px] text-[var(--pg-faint)] xl:block">
                    {r.owner}
                  </span>
                  <span className="hidden truncate font-mono text-[10.5px] text-[var(--pg-faint)] xl:block">
                    {r.touch}
                  </span>
                </button>
              );
            })}

            {/* Nothing read yet. The slot's own absence, rather than an empty table that reads
                as a bug — the failure this console was rejected for twice. */}
            {records.length === 0 && (
              <div className="max-w-[62ch] px-1 py-5">
                <b className="block text-[12px] font-semibold text-foreground">
                  {RELATIONSHIPS_ABSENCE.title}
                </b>
                <p className="mt-2 text-[12px] leading-[1.6] text-muted-foreground [text-wrap:pretty]">
                  {RELATIONSHIPS_ABSENCE.body}
                </p>
              </div>
            )}
            {records.length > 0 && list.length === 0 && (
              <p className="px-1 py-4 text-[11.5px] text-[var(--pg-faint)]">
                No record in the book matches this filter.
              </p>
            )}
          </div>

          <p className="max-w-[74ch] flex-none border-t border-[var(--pg-line-soft)] py-2.5 text-[11px] leading-[1.6] text-muted-foreground [text-wrap:pretty]">
            {PEOPLE_FOOT}
          </p>
        </div>

        {/* the record */}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-col lg:flex",
            solo === "detail" ? "flex" : "hidden",
          )}
        >
          {!picked ? (
            <p className="px-3.5 py-4 text-[11.5px] leading-[1.6] text-[var(--pg-faint)]">
              No record is selected because none is read yet. The pane is the record — identity,
              its ten faces, and every field with where the value came from.
            </p>
          ) : (
            <>
              <div className="flex-none border-b border-[var(--pg-line-soft)] px-3.5 pb-[9px] pt-[11px]">
                <div className="flex items-center gap-[9px]">
                  <button
                    type="button"
                    onClick={() => setSolo("list")}
                    className="min-h-[24px] flex-none whitespace-nowrap border-0 bg-transparent pl-0 pr-2 text-[11px] text-[var(--pg-muted)] lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    ‹ All records
                  </button>
                  <RecordMark record={picked} px={34} />
                  <span className="flex min-w-0 flex-col">
                    <b className="truncate text-[13px] font-medium text-foreground">{picked.name}</b>
                    <small className="mt-0.5 truncate text-[10.5px] text-[var(--pg-faint)]">
                      {picked.sub}
                    </small>
                  </span>
                  <span className="ml-auto flex gap-1">
                    <RecordAct
                      label="Enter scope"
                      title="Audited act-as"
                      onClick={onEnterScope && (() => onEnterScope(picked))}
                    />
                    <RecordAct
                      label="Message"
                      title="Open the thread"
                      gold
                      onClick={onMessage && (() => onMessage(picked))}
                    />
                  </span>
                </div>

                {/* The tab row scrolls and fades at its edge rather than showing a scrollbar —
                    CD, L5127: *"a native scrollbar under them is chrome the design never asked
                    for… the overflow reads as more, not as UI."* */}
                <div
                  className="mt-2.5 flex gap-[3px] overflow-x-auto pb-0.5 [scrollbar-width:none]"
                  style={{
                    maskImage: "linear-gradient(90deg,#000 calc(100% - 26px),transparent)",
                    WebkitMaskImage: "linear-gradient(90deg,#000 calc(100% - 26px),transparent)",
                  }}
                >
                  {PERSON_TABS.map((t) => {
                    const on = tab === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTab(t)}
                        className={cn(
                          "min-h-[24px] flex-none whitespace-nowrap border-0 bg-transparent px-[7px] text-[10.5px]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          on
                            ? "font-semibold text-foreground shadow-[shadow:inset_0_-1px_0_var(--pg-gold)]"
                            : "font-normal text-[var(--pg-faint)]",
                        )}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-3.5 pb-4 pt-3">
                {isFields ? (
                  fields.length === 0 ? (
                    <p className="text-[11.5px] leading-[1.6] text-[var(--pg-faint)]">
                      No field on this face is read yet. Each one carries its value, where the
                      value came from, and a mask on anything sensitive whose reveal is recorded.
                    </p>
                  ) : (
                    <dl className="grid grid-cols-[minmax(84px,auto)_minmax(0,1fr)] gap-x-3 gap-y-0">
                      {fields.map((f, i) => {
                        const key = `${picked.id}${tab}${i}`;
                        const open = !!revealed[key];
                        const editing = editKey === key;
                        // The record holds the value; the bullets are derived from it, so a
                        // reveal shows what is on file (CD, L5122).
                        const isMask = !!f.masked && !/^—/.test(f.v);
                        const shown = isMask && !open ? f.v.replace(/[0-9]/g, "•") : f.v;
                        return (
                          <FieldRow
                            key={key}
                            index={i}
                            field={f}
                            shown={shown}
                            isMask={isMask}
                            open={open}
                            editing={editing}
                            draft={draft}
                            onDraft={setDraft}
                            onReveal={() => {
                              setRevealed((x) => ({ ...x, [key]: !open }));
                              if (!open) {
                                onReveal?.(picked, tab, f);
                                onAnnounce?.(`${f.k} revealed. The reveal is recorded.`);
                              }
                            }}
                            onEdit={() => {
                              setEditKey(key);
                              setDraft(f.v);
                              if (isMask) setRevealed((x) => ({ ...x, [key]: true }));
                              onAnnounce?.(
                                `Editing ${f.k}. The change is recorded with your name on it.`,
                              );
                            }}
                            canEdit={!!onEditField}
                            onSave={() => {
                              setEditKey(null);
                              onEditField?.(picked, tab, f, draft);
                              onAnnounce?.(`${f.k} updated. Recorded against your name in Activity.`);
                            }}
                            onCancel={() => {
                              setEditKey(null);
                              onAnnounce?.("");
                            }}
                            canResolve={!!onResolveProposal}
                            onAccept={() => {
                              onResolveProposal?.(picked, tab, f, "accept");
                              onAnnounce?.(
                                `${f.k} updated from her proposal. Recorded as accepted.`,
                              );
                            }}
                            onReject={() => {
                              onResolveProposal?.(picked, tab, f, "reject");
                              onAnnounce?.(
                                "Proposal rejected. The value stands and she is told why it was refused.",
                              );
                            }}
                          />
                        );
                      })}
                    </dl>
                  )
                ) : (
                  <div>
                    <p className="max-w-[52ch] font-[var(--pg-font-editorial)] text-[12px] italic leading-[1.6] text-[var(--pg-muted)] [text-wrap:pretty]">
                      {panel?.deck}
                    </p>
                    <div className="mt-3 border-t border-[var(--pg-line-soft)]">
                      {rows.map((r) => (
                        <div
                          key={r.name}
                          className="grid min-h-[42px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-[var(--pg-line-soft)] px-0.5 py-[5px] text-left"
                        >
                          <span className="flex min-w-0 flex-col">
                            <b className="truncate text-[11.5px] font-medium text-foreground">
                              {r.name}
                            </b>
                            <small className="mt-0.5 truncate text-[10.5px] text-[var(--pg-faint)]">
                              {r.detail}
                            </small>
                          </span>
                          <span
                            className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.09em]"
                            style={{ color: r.tone ?? "var(--pg-faint)" }}
                          >
                            {r.status}
                          </span>
                        </div>
                      ))}
                      {rows.length === 0 && (
                        <p className="py-3 text-[11.5px] leading-[1.6] text-[var(--pg-faint)]">
                          Nothing on this face is read yet.
                        </p>
                      )}
                    </div>
                    <p className="mt-[11px] text-[10.5px] leading-[1.5] text-[var(--pg-faint)]">
                      {panel?.foot}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The identity mark. A company is a plate, a person a disc; a record with no image on file gets
 * a monogram from its own name, and the mark borrows the lifecycle tone so the row's state is
 * legible before a word is read. `peopleVals` L4899–L4923.
 */
function RecordMark({ record, px }: { record: PersonRecord; px: number }) {
  const isCo = record.kind === "Company";
  const tone = lifecycleTone(record.life);
  const has = !!record.image;
  return (
    <span
      title={
        has
          ? record.name
          : `${isCo ? "No logo on file" : "No photo on file"} — monogram from the record`
      }
      className="relative grid flex-none place-items-center overflow-hidden"
      style={{
        width: `${px}px`,
        height: `${px}px`,
        borderRadius: isCo ? "var(--pg-r-chip)" : "999px",
        background: has ? "transparent" : "var(--pg-surface)",
        boxShadow: `inset 0 0 0 1px ${tone}${has ? "" : "55"}`,
      }}
    >
      {has ? (
        <i
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${record.image}")` }}
        />
      ) : (
        <span
          style={{
            color: tone,
            font: `600 ${Math.round(px * 0.42)}px var(--pg-font-display)`,
            letterSpacing: ".02em",
          }}
        >
          {monogram(record.name)}
        </span>
      )}
    </span>
  );
}

/** `peopleVals` L5099 `act()`. Gold is spent on the one act that opens a thread (§11). */
function RecordAct({
  label,
  title,
  gold,
  onClick,
}: {
  label: string;
  title: string;
  gold?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={onClick ? title : `${title} — not wired yet`}
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "min-h-[26px] flex-none whitespace-nowrap rounded-[var(--pg-r-chip)] px-[9px] text-[11px] disabled:opacity-45",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        gold
          ? "border border-[var(--pg-gold)] bg-[var(--pg-gold)] text-[#17120c]"
          : "border border-[var(--pg-line)] bg-transparent text-[var(--pg-muted)]",
      )}
    >
      {label}
    </button>
  );
}

function FieldRow({
  index,
  field,
  shown,
  isMask,
  open,
  editing,
  draft,
  onDraft,
  onReveal,
  onEdit,
  canEdit,
  onSave,
  onCancel,
  canResolve,
  onAccept,
  onReject,
}: {
  index: number;
  field: PersonField;
  shown: string;
  isMask: boolean;
  open: boolean;
  editing: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onReveal: () => void;
  onEdit: () => void;
  canEdit: boolean;
  onSave: () => void;
  onCancel: () => void;
  canResolve: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const rule = index ? "border-t border-[var(--pg-line-soft)]" : "";
  const absent = /^—/.test(field.v);
  return (
    <>
      <dt
        className={cn(
          "py-[7px] font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--pg-faint)]",
          rule,
        )}
      >
        {field.k}
      </dt>
      <dd className={cn("m-0 flex min-w-0 flex-col gap-[3px] py-[7px]", rule)}>
        <div className="flex min-w-0 items-baseline gap-[7px]">
          {editing ? (
            <>
              <input
                value={draft}
                aria-label={field.k}
                onChange={(e) => onDraft(e.target.value)}
                className={cn(
                  "min-h-[26px] min-w-0 flex-1 rounded-[var(--pg-r-chip)] border border-[var(--pg-line-strong)] bg-[var(--pg-raised)] px-2 text-[11.5px] text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isMask && "font-mono",
                )}
              />
              <button
                type="button"
                onClick={onSave}
                className="min-h-[26px] flex-none rounded-[var(--pg-r-chip)] border border-[var(--pg-gold)] bg-[var(--pg-gold)] px-[9px] text-[10px] font-semibold text-[#17120c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Save
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="min-h-[26px] flex-none border-0 bg-transparent px-[7px] text-[10px] text-[var(--pg-faint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={isMask ? onReveal : undefined}
                disabled={!isMask}
                className={cn(
                  "min-w-0 truncate border-0 bg-transparent p-0 text-left text-[11.5px] disabled:cursor-default",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isMask && "font-mono",
                  absent ? "text-[var(--pg-faint)]" : "text-[var(--pg-ink-2)]",
                )}
              >
                {shown}
              </button>
              {isMask && (
                <small
                  className="flex-none font-mono text-[9px] tracking-[0.04em]"
                  style={{ color: open ? "var(--pg-gold-deep)" : "var(--pg-faint)" }}
                >
                  {open ? "revealed · logged" : "click to reveal"}
                </small>
              )}
              <button
                type="button"
                onClick={onEdit}
                disabled={!canEdit}
                title={canEdit ? "Edit this field" : "Editing a field has no write path yet"}
                className="ml-auto min-h-[20px] flex-none rounded-[var(--pg-r-chip)] border-0 bg-transparent px-1.5 text-[9.5px] text-[var(--pg-faint)] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Edit
              </button>
            </>
          )}
        </div>

        {/* Her proposal, held for a word. Ask first lands it as this; Autonomous would have
            landed it and reported (CD, L5111). */}
        {field.proposal && (
          <div
            className="mt-0.5 flex items-center gap-2 rounded-[var(--pg-r-chip)] bg-[var(--pg-surface)] px-[7px] py-[5px]"
            style={{ boxShadow: "inset 0 0 0 1px var(--pg-line-authority)" }}
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-[var(--pg-gold-deep)]">
              PAIGE proposes {field.proposal.to}
            </span>
            <span className="flex gap-1">
              <button
                type="button"
                onClick={onAccept}
                disabled={!canResolve}
                className="min-h-[22px] rounded-[var(--pg-r-chip)] border border-[var(--pg-gold)] bg-[var(--pg-gold)] px-2 text-[9.5px] font-semibold text-[#17120c] disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={onReject}
                disabled={!canResolve}
                className="min-h-[22px] rounded-[var(--pg-r-chip)] border border-[var(--pg-line)] bg-transparent px-[7px] text-[9.5px] text-[var(--pg-muted)] disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Reject
              </button>
            </span>
          </div>
        )}

        {field.source && (
          <small className="text-[9.5px] tracking-[0.005em] text-[var(--pg-faint)]">
            {field.source}
          </small>
        )}
      </dd>
    </>
  );
}
