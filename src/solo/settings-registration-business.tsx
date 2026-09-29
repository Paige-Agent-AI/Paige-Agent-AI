import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Outcome, type WriteState } from "./settings-primitives";
import {
  REGISTRATION_BUSINESS_FIELDS,
  type RegistrationEditableField,
} from "./settings-registration-fields";
import { useSoloBusinessContext } from "./data/useSoloBusinessContext";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { RepresentativePhonePicker } from "./setup-representative-phone";

/**
 * Completing the carrier record from Registration — the SECOND EDITOR of ONE record.
 *
 * THE DEFECT. `comms-a2p-register` refuses to file a brand until `missing_profile_fields`
 * is empty, and Registration has always printed that list. What it offered against it was a
 * link to Setup. So the surface that knows exactly what is blocking the filing was the one
 * surface that could not unblock it — the owner read "Missing: tax or registration number,
 * regions of operation, authorized representative", left, hunted the same facts across a
 * five-subtab Setup surface, and came back to find out whether he had picked the right ones.
 * Naming a blocker is not resolving one (§70).
 *
 * WHY THIS IS NOT A SECOND WRITER. The temptation here is a small local save. That would
 * create two records that drift, which is the failure the owner named. Instead this mounts
 * the SAME adapter Setup mounts (`useSoloBusinessContext`) and submits through the SAME
 * canonical seam (`save_solo_business_context`) — server-derived tenant, expected-tenant
 * check, expected-revision check, Owner-only legal gate, one readback. Registration edits
 * Setup's record; it does not keep its own (§18/§57).
 *
 * THE DANGEROUS PART, STATED PLAINLY. For an Owner caller, `save_solo_business_context`
 * REPLACES the knowledge sources, Paige profile and voice examples it is given, and REFUSES
 * a save that omits them ("Complete business context is required for an Owner save"). A
 * registration screen that submitted its own idea of those collections would silently
 * delete the owner's knowledge bucket and brand voice — content this screen never mentions
 * and its user is not thinking about. So the loaded collections are passed through verbatim,
 * and the save is refused outright until the canonical record has actually been read. The
 * guard is not defensive coding; it is the difference between an edit and a deletion.
 */
export type BusinessContext = ReturnType<typeof useSoloBusinessContext>;

type Props = {
  account: string;
  /** The provider's own shortfall list. Its words, not ours — it is the filing's authority. */
  missing: string[];
  /** Whether the caller is a tenant admin at all. The Owner-only split is the server's answer. */
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Re-reads `comms-a2p-register` so the stage ladder stops showing a completed step as waiting. */
  onSaved: () => void;
};

const MISSING_HINT = "Tax and registration numbers stay sealed.";

/**
 * SPLIT ON PURPOSE. The summary below is hook-free, so the ordinary Registration view —
 * which for anyone who has not registered yet ALWAYS has a shortfall — gains no query, no
 * adapter and no realtime team-roster subscription. The editor, and only the editor, mounts
 * the canonical record. A surface should not pay for an editor nobody opened.
 */
export function RegistrationBusinessRecord(props: Props) {
  const { account, missing, canManage, open, onOpenChange } = props;
  const setupLink = <Link to={`/solo/${account}/settings/setup`}>Setup</Link>;

  if (open) return <RegistrationBusinessEditor {...props}/>;
  if (!missing.length) return null;

  return <div className="ss-next">
    <strong>Complete the business record first</strong>
    <p>Missing: {missing.join(", ")}.</p>
    <p>These are the facts carriers check. {MISSING_HINT}</p>
    <div className="ss-form-actions">
      {canManage && <button type="button" className="ss-btn" onClick={() => onOpenChange(true)}>Complete these here</button>}
      <span className="ss-note">
        {canManage ? "Or open " : "Ask the workspace Owner to complete these in "}{setupLink}
        {canManage ? ", where the same record lives alongside the rest of your business context." : "."}
      </span>
    </div>
  </div>;
}

function RegistrationBusinessEditor({ account, missing, open: _open, onOpenChange, onSaved }: Props) {
  const context = useSoloBusinessContext();
  const { brief } = context;
  const [edits, setEdits] = useState<Partial<Record<RegistrationEditableField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<WriteState>(null);

  const setupLink = <Link to={`/solo/${account}/settings/setup`}>Setup</Link>;

  // The record has to be READ before it can be written, because the save replaces
  // collections this screen does not show. Loading, a failed read, and an unresolved
  // workspace are three different reasons and none of them is "no changes to make".
  const readable =
    !context.loading &&
    !context.error &&
    Boolean(context.activeTenantId) &&
    context.resolvedTenantId === context.activeTenantId;

  const value = (key: RegistrationEditableField): string => {
    const edited = edits[key];
    if (edited !== undefined) return edited;
    // The stored tax number never comes back to the browser; the box starts empty and a
    // save that leaves it empty keeps what the Vault already holds.
    if (key === "businessRegistrationNumber") return "";
    return brief[key as keyof typeof brief] as string ?? "";
  };

  const change = (key: RegistrationEditableField, next: string) =>
    setEdits((now) => {
      // The representative's phone is that person's own number: choosing a different person
      // starts with none chosen rather than carrying the previous person's number across.
      if (key === "authorizedRepresentativeUserId") {
        const current = now.authorizedRepresentativeUserId ?? brief.authorizedRepresentativeUserId;
        if (next !== current) return { ...now, [key]: next, authorizedRepresentativePhone: "" };
      }
      return { ...now, [key]: next };
    });

  const dirty = useMemo(
    () => Object.entries(edits).some(([key, v]) =>
      v !== undefined && v !== (key === "businessRegistrationNumber" ? "" : (brief[key as keyof typeof brief] as string ?? ""))),
    [edits, brief],
  );

  useBeforeUnloadGuard(dirty || saving);

  const close = () => { onOpenChange(false); setEdits({}); setOutcome(null); };

  const save = async () => {
    if (!readable || saving) return;
    setSaving(true); setOutcome(null);
    const next = { ...brief, ...edits } as typeof brief;
    // Never echo the masked last four back as if it were the number itself.
    next.businessRegistrationNumber = edits.businessRegistrationNumber ?? "";
    // The save REFUSES an authorized representative who is not also in the confirmed
    // representative list — `save_solo_setup_identity` raises "must also be a confirmed
    // business representative". The picker offers the active Team, so choosing someone new
    // would otherwise fail on a rule this screen never showed. Naming a person as THE
    // authorized representative is what confirming them means, so it is recorded here. The
    // server still re-checks active membership independently, and this editor is Owner-only,
    // which is the authority that list requires. It creates no Team role and no access.
    const chosen = next.authorizedRepresentativeUserId;
    if (chosen && !next.representativeUserIds.includes(chosen)) {
      next.representativeUserIds = [...next.representativeUserIds, chosen];
    }
    const result = await context.save({
      brief: next,
      businessOwners: context.businessOwners,
      primaryBusinessEmail: context.primaryBusinessEmail,
      // Passed through, not reconstructed. See the header.
      knowledgeSources: context.knowledgeSources,
      paigeProfile: context.paigeProfile,
      voiceExamples: context.voiceExamples,
      proposalId: null,
    });
    setSaving(false);
    if (result.ok === false) {
      setOutcome({ tone: "bad", message: result.error });
      // A conflict means the stored record moved on, and the adapter deliberately does NOT
      // adopt the server's answer on a refusal — so the revision this editor holds stays
      // stale and every retry would fail the same way. Re-read, keeping the typing on screen.
      if (result.kind === "conflict") context.refresh();
      return;
    }
    setEdits({});
    setOutcome({ tone: "ok", message: "Saved to your business record. Setup shows the same values." });
    // The shortfall list and every stage above it are the provider's answer, not ours.
    onSaved();
  };

  // A FAILED READ IS NOT A LACK OF AUTHORITY, and this branch order is the whole reason
  // that distinction survives. `canEditLegal` is false whenever the read errored, because
  // the adapter derives it from a scope it never received — so testing authority first
  // would tell an Owner whose read failed that the record belongs to someone else. That is
  // a confident claim made out of ignorance, and it is the same failure the two unknown
  // states upstream in this panel exist to prevent. Unreadable is handled below, first.
  if (!readable && !context.loading) {
    return <div className="ss-next" role="status">
      <strong>Your business record could not be read</strong>
      <p>Nothing is being claimed about who may change it until that read succeeds.</p>
      <div className="ss-form-actions">
        <button type="button" className="ss-retry" onClick={context.refresh}>Try again</button>
        <button type="button" className="ss-btn ss-btn--quiet" onClick={close}>Close</button>
      </div>
    </div>;
  }

  // Setup's server split, asked of the server rather than guessed: an Admin may keep the
  // operating brief current, but the legal identity is the Owner's. Rendering boxes an
  // Admin can type into that the server will then refuse is the same lie as a read-only
  // value rendered as an input. This resolves after the read, because authority is the
  // record's answer, not something a button could have known.
  if (!context.loading && (!context.canEditLegal || !context.activeTenantId)) {
    return <div className="ss-next">
      <strong>Complete the business record first</strong>
      <p>Missing: {missing.join(", ")}.</p>
      <p>Only the workspace Owner can change the legal business record. Ask them to complete
        these in {setupLink}. {MISSING_HINT}</p>
      <div className="ss-form-actions">
        <button type="button" className="ss-btn ss-btn--quiet" onClick={close}>Close</button>
      </div>
    </div>;
  }

  return <div className="ss-reg-draft">
    <div className="ss-next">
      <strong>Your business record</strong>
      <p>These save to the one business record. {setupLink} shows the same values, and
        carriers compare them against your registration — so a mismatch there is what gets
        one rejected.</p>
      {missing.length > 0 && <p>Still missing: {missing.join(", ")}.</p>}
    </div>

    {!readable && <div className="ss-next" role="status">
      <strong>Loading your business record</strong>
      <p>Nothing is saved until it loads, because saving over a record we have not read is
        how the rest of your business context would get lost.</p>
    </div>}

    <div className="ss-fields">
      {/* The representative phone is picked from that person's own numbers, below the representative. */}
      {REGISTRATION_BUSINESS_FIELDS.filter((f) => f.key !== "authorizedRepresentativePhone").map((f) => {
        const id = `reg-${f.key}`;
        const last4 = f.secret ? brief.businessRegistrationNumberLast4 : "";
        return <label key={f.key} className="ss-field-block" htmlFor={id}>
          <span>{f.label}{f.optional ? " (optional)" : ""}</span>
          {f.options
            ? <select id={id} name={id} value={value(f.key)} disabled={!readable || saving}
                onChange={(e) => change(f.key, e.target.value)}>
                {f.options.map((o) => {
                  const v = typeof o === "string" ? o : o.value;
                  const label = typeof o === "string" ? (o || "Choose") : (o.label || "Choose");
                  return <option key={v || "blank"} value={v}>{label}</option>;
                })}
              </select>
            : <input id={id} name={id} type={f.secret ? "password" : "text"}
                autoComplete={f.secret ? "off" : undefined}
                value={value(f.key)} disabled={!readable || saving}
                onChange={(e) => change(f.key, e.target.value)}/>}
          {last4 && <small className="ss-note">Stored securely · ending in {last4}. Leave this blank to keep it.</small>}
          {f.hint && !last4 && <small className="ss-note">{f.hint}</small>}
        </label>;
      })}

      <label className="ss-field-block" htmlFor="reg-authorizedRepresentativeUserId">
        <span>Authorized representative</span>
        <select id="reg-authorizedRepresentativeUserId" name="reg-authorizedRepresentativeUserId"
          value={value("authorizedRepresentativeUserId")}
          disabled={!readable || saving || context.representativesLoading}
          onChange={(e) => change("authorizedRepresentativeUserId", e.target.value)}>
          <option value="">Choose</option>
          {context.representatives.map((person) =>
            <option key={person.id} value={person.id}>{person.name || person.email || person.id}</option>)}
        </select>
        <small className="ss-note">
          The carrier record names a real person. Their name, email and title come from your
          Team, so they stay correct when the Team changes.
        </small>
        {context.representativesError && <small className="ss-note" role="alert">{context.representativesError}</small>}
      </label>
      <RepresentativePhonePicker
        account={account}
        userId={value("authorizedRepresentativeUserId")}
        personName={context.representatives.find((person) => person.id === value("authorizedRepresentativeUserId"))?.name ?? null}
        value={value("authorizedRepresentativePhone")}
        onChange={(next) => change("authorizedRepresentativePhone", next)}
        locked={!readable || saving}
        idPrefix="reg-rep-phone"
        className="ss-field-block"
        labelClassName=""
        titleClassName=""
      />
    </div>

    <div className="ss-form-actions">
      <button type="button" className="ss-btn" disabled={!readable || saving || context.saving || !dirty}
        onClick={() => void save()}>
        {saving || context.saving ? <RefreshCw className="ss-spin" aria-hidden/> : null}
        {saving || context.saving ? "Saving…" : "Save business record"}
      </button>
      <button type="button" className="ss-btn ss-btn--quiet" disabled={saving} onClick={close}>Cancel</button>
      {!dirty && <span className="ss-note">Change something above to save.</span>}
    </div>

    <Outcome state={outcome}/>
    {outcome?.tone === "bad" && <p className="ss-note">
      <button type="button" className="ss-retry" onClick={context.refresh}>Load the stored version</button>
    </p>}
  </div>;
}
