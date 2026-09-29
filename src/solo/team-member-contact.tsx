import { useEffect, useRef, useState } from "react";
import { Lock, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ContactMethodsEditor, ContactMethodsList } from "@/components/contact-methods/ContactMethodsEditor";
import { useContactMethodsDraft, useUserContactMethods } from "@/components/contact-methods/useUserContactMethods";
import { contactAccess, type TeamMemberRecord, type TeamWorkspaceRecord } from "./team-workspace-contract";

/**
 * Team → a person → how the team reaches them (approved design, comp A, 2026-09-28): the sign-in
 * address stays separate and read-only, every other email and phone is edited on the same editor as
 * a client's. It saves on its own, because it is a different write with a different authority from
 * the work details beside it.
 */
export function TeamMemberContact({ member, workspace, onDirtyChange }: { member: TeamMemberRecord; workspace: TeamWorkspaceRecord; onDirtyChange?: (dirty: boolean) => void }) {
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerKnown, setViewerKnown] = useState(false);
  useEffect(() => {
    let live = true;
    // Unknown viewer offers nothing: the section stays hidden rather than guess at authority.
    void supabase.auth.getUser()
      .then(({ data }) => { if (live) { setViewerId(data.user?.id ?? null); setViewerKnown(true); } })
      .catch(() => { if (live) setViewerKnown(false); });
    return () => { live = false; };
  }, []);
  const access = viewerKnown ? contactAccess(member, workspace, viewerId) : "hidden";
  const self = Boolean(viewerId) && viewerId === member.user_id;
  const firstName = (member.full_name || "").trim().split(/\s+/)[0] || "this person";

  const stored = useUserContactMethods(access === "hidden" ? null : member.user_id);
  const edit = useContactMethodsDraft(stored, access === "edit");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => { onDirtyChange?.(edit.dirty); }, [edit.dirty, onDirtyChange]);

  const messageRef = useRef<HTMLParagraphElement | null>(null);
  const save = async () => {
    setMessage(null);
    const result = await edit.submit();
    const next = result.error ? { tone: "bad" as const, text: result.error }
      : result.ok ? { tone: "ok" as const, text: self ? "Your contact details are saved." : `${firstName === "this person" ? "Their" : `${firstName}'s`} contact details are saved.` }
      : null;
    if (!next) return;
    setMessage(next);
    setAnnouncement(next.text);
    // The save button leaves once nothing is unsaved; focus lands on the outcome instead of the page.
    window.setTimeout(() => messageRef.current?.focus(), 0);
  };

  if (access === "hidden") return null;

  return (
    <section className="stw-contact" aria-labelledby="stw-contact-h">
      <header className="stw-contact-h">
        <h3 id="stw-contact-h">{self ? "Your contact details" : `${firstName === "this person" ? "Their" : `${firstName}'s`} contact details`}</h3>
        <p>{self ? "The emails and phones your team can reach you at. The primary of each comes first." : "The emails and phones the team can reach them at. The primary of each comes first."}</p>
      </header>
      {member.email && (
        <div className="stw-signin">
          <span className="k">Sign-in email</span>
          <span className="v">{member.email}</span>
          <span className="h">Used to sign in. Nothing on this screen changes it.</span>
        </div>
      )}
      {access === "read" && (
        <div className="stw-contact-lock" role="note"><Lock aria-hidden /><span>Only the owner can change the owner's contact details.</span></div>
      )}
      {stored.loading ? (
        <div className="stw-state" role="status"><RefreshCw className="ss-spin" aria-hidden />Loading contact details…</div>
      ) : stored.error ? (
        <div className="stw-state error" role="alert"><strong>Contact details unavailable</strong><span>{stored.error}</span><button type="button" onClick={() => void stored.refresh()}>Retry</button></div>
      ) : access === "read" ? (
        <ContactMethodsList methods={stored.methods} headingLevel={4} audience="person" />
      ) : (
        <>
          <ContactMethodsEditor
            methods={edit.draft}
            onChange={(next) => { edit.setDraft(next); setMessage(null); }}
            errors={edit.errors}
            disabled={stored.saving}
            announce={setAnnouncement}
            firstPersonNoun={self ? "your" : "their"}
            audience="person"
            copy={{
              email: { empty: self ? "Add the address your team and Paige should use." : "Add the address the team and Paige should use." },
              phone: { empty: self ? "Add a number so the team can reach you." : "Add a number so the team can reach them." },
            }}
          />
          <div className="stw-contact-actions">
            {message && <p ref={messageRef} tabIndex={-1} className={message.tone === "bad" ? "stw-contact-msg is-bad" : "stw-contact-msg"}>{message.text}</p>}
            {edit.dirty && <button type="button" className="stw-btn secondary" disabled={stored.saving} onClick={() => { edit.reset(); setMessage(null); }}>Discard changes</button>}
            {/* Offered once there is something to save, so no act-coloured control sits at rest (§11). */}
            {(edit.dirty || stored.saving) && <button type="button" className="stw-btn" disabled={stored.saving} onClick={() => void save()}>{stored.saving ? "Saving…" : "Save contact details"}</button>}
          </div>
        </>
      )}
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </section>
  );
}
