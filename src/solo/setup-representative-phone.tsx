import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { useUserContactMethods } from "@/components/contact-methods/useUserContactMethods";
import { e164Of, methodsOfKind } from "@/lib/contact-methods";
import "@/components/contact-methods/contact-methods.css";

/**
 * Setup → the A2P representative's phone, picked from that person's own numbers instead of typed a
 * second time (approved design, comp A, "Setup · representative"). What is stored is unchanged: the
 * chosen number, in E.164, in the legal profile. A number without its country code is shown but
 * cannot be picked, because carriers would refuse it; it is fixed where it lives, under Team.
 */
export function RepresentativePhonePicker({
  account,
  userId,
  personName,
  value,
  onChange,
  locked = false,
  error,
  idPrefix = "setup-rep-phone",
  className = "setup-field setup-field--wide",
  labelClassName = "setup-field__label",
  titleClassName = "setup-field__title",
  badge,
  sourceActions,
}: {
  account: string;
  userId: string;
  personName: string | null;
  value: string;
  onChange: (next: string) => void;
  /** The value came from a connection and the owner has not chosen to override it. */
  locked?: boolean;
  error?: string;
  /** Ids and the radio group name; distinct per mounted picker. */
  idPrefix?: string;
  /** The host form's own field wrapper and label classes. */
  className?: string;
  labelClassName?: string;
  titleClassName?: string;
  /** The host's provenance badge for this value, shown beside the heading. */
  badge?: ReactNode;
  /** The host's Adopt / Override choice for a value that came from a connection. */
  sourceActions?: ReactNode;
}) {
  const named = (personName || "").trim().split(/\s+/)[0];
  const first = named || "the representative";
  const First = named || "The representative";
  const errorId = `${idPrefix}-error`;
  const stored = useUserContactMethods(userId || null);
  const phones = methodsOfKind(stored.methods, "phone");
  const current = e164Of(value) ?? (value.trim() || null);
  const matched = phones.some((phone) => e164Of(phone.value) === current);
  const teamLink = <Link to={`/solo/${account}/settings/team`}>Team</Link>;

  return (
    <div className={className}>
      <div className={labelClassName}>
        <span id={`${idPrefix}-h`} className={titleClassName || undefined}>Representative phone</span>
        {badge}
      </div>
      {!userId ? (
        <p className="ctm-cap-plain">Choose the A2P authorized representative above; their phone numbers appear here.</p>
      ) : stored.loading ? (
        <p className="ctm-cap-plain" role="status"><RefreshCw className="ss-spin" aria-hidden /> Loading {first}'s numbers…</p>
      ) : stored.error ? (
        <p className="ctm-cap-plain" role="alert">Couldn't load {first}'s numbers. <button type="button" className="ctm-link" onClick={() => void stored.refresh()}>Retry</button></p>
      ) : (
        <div className="ctm-editor is-readonly is-choices">
          <p className="ctm-cap-plain">Picked from {first}'s own numbers — nothing to retype.</p>
          {phones.length === 0 && !current ? (
            <p className="ctm-cap-plain">{First} has no phone number yet. Add one under {teamLink}, then pick it here.</p>
          ) : (
            <div className="ctm-list" role="radiogroup" aria-labelledby={`${idPrefix}-h`} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}>
              {current && !matched && (
                <div className="ctm-row is-choice is-chosen">
                  <input className="sr-only" type="radio" name={idPrefix} id={`${idPrefix}-saved`} checked readOnly disabled={locked} />
                  <label htmlFor={`${idPrefix}-saved`} className="ctm-choice">
                    <span className="ctm-mark"><span className="ctm-orb" aria-hidden /></span>
                    <span className="ctm-body"><span className="ctm-val is-mono">{current}</span><span className="ctm-meta">Saved earlier · not one of {first}'s numbers</span></span>
                  </label>
                </div>
              )}
              {phones.map((phone) => {
                const e164 = e164Of(phone.value);
                const chosen = Boolean(e164) && e164 === current;
                const id = `${idPrefix}-${phone.id}`;
                return (
                  <div key={phone.id} className={`ctm-row is-choice${chosen ? " is-chosen" : ""}${e164 ? "" : " is-unusable"}`}>
                    <input className="sr-only" type="radio" name={idPrefix} id={id} checked={chosen} disabled={locked || !e164}
                      aria-describedby={e164 ? undefined : `${id}-why`}
                      // Click as well as change: re-choosing the checked number (stored with spaces) must still store it in E.164.
                      onChange={() => e164 && onChange(e164)} onClick={() => e164 && onChange(e164)} />
                    <label htmlFor={id} className="ctm-choice">
                      <span className="ctm-mark">{chosen ? <span className="ctm-orb" aria-hidden /> : <span className="ctm-ring0" aria-hidden />}</span>
                      <span className="ctm-body">
                        <span className="ctm-val is-mono">{phone.value}</span>
                        {e164 ? (phone.isPrimary && <span className="ctm-meta"><b>Primary</b> · {first}'s main number</span>)
                          : <span className="ctm-meta" id={`${id}-why`}>Needs + and the country code. Update it under Team to use it.</span>}
                      </span>
                      <span className="ctm-label">{phone.label && <span className="ctm-tag">{phone.label}</span>}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          )}
          {phones.length > 0
            ? <p className="ctm-cap-plain">To use a different number, add it to {first}'s details under {teamLink} first.</p>
            : current && <p className="ctm-cap-plain">{First} has no phone number yet. Add one under {teamLink}, then pick it here.</p>}
        </div>
      )}
      {sourceActions}
      {error && <small role="alert" id={errorId}>{error}</small>}
    </div>
  );
}
