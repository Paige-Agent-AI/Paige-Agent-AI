import { useId, useMemo, useState } from "react";

/**
 * The stack calculator: the visitor names what they pay for, in their own numbers, and sees it
 * beside $74.50. No defaults, no example prices, no claim that Paige replaces any one of these —
 * the figures are the visitor's, and they never leave the browser. Category names only; no
 * competitor is ever named.
 */
const PAIGE_MONTHLY = 74.5;

const CATEGORIES = [
  "Your CRM",
  "Your scheduler",
  "Your proposal tool",
  "Your email marketing tool",
  "Your forms tool",
  "Your project manager",
  "Your client portal",
  "Assistant hours",
];

/** Digits and one decimal point; a comma decimal ("12,50") reads as a point. Capped at 8 characters. */
function cleanAmount(raw: string) {
  const [whole, ...rest] = raw.replace(/,/g, ".").replace(/[^0-9.]/g, "").split(".");
  return (rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole).slice(0, 8);
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export function StackCalculator() {
  const baseId = useId();
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const total = useMemo(
    () =>
      CATEGORIES.reduce((sum, c) => {
        if (!on[c]) return sum;
        const v = Number.parseFloat(amounts[c] ?? "");
        return Number.isFinite(v) && v > 0 ? sum + v : sum;
      }, 0),
    [on, amounts],
  );
  const picked = CATEGORIES.filter((c) => on[c]).length;
  const hasTotal = total > 0;
  const max = Math.max(total, PAIGE_MONTHLY);

  return (
    <div className="pa-calc">
      <fieldset className="pa-calc__list">
        <legend className="pa-calc__legend">Tap what you pay for, then add what it costs you each month.</legend>
        {CATEGORIES.map((c, i) => {
          const id = `${baseId}-${i}`;
          const active = !!on[c];
          return (
            <div key={c} className="pa-calc__row" data-on={active}>
              <button
                type="button"
                className="pa-calc__toggle"
                aria-pressed={active}
                onClick={() => setOn((s) => ({ ...s, [c]: !s[c] }))}
              >
                <span className="pa-calc__tick" aria-hidden="true" />
                {c}
              </button>
              {active ? (
                <label className="pa-calc__amount" htmlFor={id}>
                  <span className="pa-sr">{c}, monthly cost in dollars</span>
                  <span aria-hidden="true">$</span>
                  <input
                    id={id}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={amounts[c] ?? ""}
                    onChange={(e) => setAmounts((s) => ({ ...s, [c]: cleanAmount(e.target.value) }))}
                  />
                  <span aria-hidden="true" className="pa-calc__per">/mo</span>
                </label>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <div className="pa-calc__result">
        <div className="pa-calc__bars">
          <div className="pa-calc__bar">
            <span className="pa-calc__bar-label">Your stack{picked ? `, ${picked} ${picked === 1 ? "tool" : "tools"}` : ""}</span>
            <span className="pa-calc__bar-value pa-num">{hasTotal ? money(total) : "Add yours"}</span>
            <span className="pa-calc__track">
              <span className="pa-calc__fill pa-calc__fill--stack" style={{ transform: `scaleX(${hasTotal ? total / max : 0})` }} />
            </span>
          </div>
          <div className="pa-calc__bar">
            <span className="pa-calc__bar-label">Paige Solo</span>
            <span className="pa-calc__bar-value pa-num">{money(PAIGE_MONTHLY)}</span>
            <span className="pa-calc__track">
              <span className="pa-calc__fill pa-calc__fill--paige" style={{ transform: `scaleX(${PAIGE_MONTHLY / max})` }} />
            </span>
          </div>
        </div>
        <p className="pa-calc__verdict" aria-live="polite">
          {hasTotal
            ? `You pay ${money(total)} a month for the seats. Paige is ${money(PAIGE_MONTHLY)} for the one who works between them.`
            : "Your numbers, your call. Nothing you type leaves this page."}
        </p>
        <p className="pa-small">
          Paige doesn't replace every tool on this list today, and keeping the ones you love is fine. The map
          below shows exactly what she does now.
        </p>
      </div>
    </div>
  );
}
