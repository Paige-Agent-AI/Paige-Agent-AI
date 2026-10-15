import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useTierFeatures } from "@/hooks/useTierFeatures";
import type { RelationshipPerson } from "./useTenantRelationshipsData";
import type { PortalInvitation } from "./portalDashboardModel";
import { CLIENT_CONTACT_METHODS_EMBED } from "@/lib/contact-methods";

// This canonical relation postdates generated SDK types. Widen only this select
// and check the response before considering any invitation action.
const invitationContactSelect: string = `id,status,merged_into_contact_id,do_not_contact,linked_user_id,${CLIENT_CONTACT_METHODS_EMBED}`;
type InvitationContact = { id?: unknown; status?: unknown; merged_into_contact_id?: unknown; do_not_contact?: unknown; linked_user_id?: unknown; client_contact_methods?: Array<{ kind?: unknown; is_primary?: unknown; value?: unknown }> };

export type PortalInvitationActionLock = {
  pending: ReadonlySet<string>;
  acquire: (key: string) => (() => void) | null;
};

/** Explicit, recipient-bound use of the incumbent invitation contracts. No identity administration. */
export function PortalInvitationManager({
  tenantId,
  person,
  latest,
  onReadback,
  actionLock,
}: {
  tenantId: string;
  person: RelationshipPerson;
  latest: PortalInvitation | undefined;
  onReadback: () => Promise<unknown>;
  actionLock?: PortalInvitationActionLock;
}) {
  const {
    activeUserId,
    activeTenantId,
    accountContextStatus,
    accountContextLoading,
  } = useTenantContext();
  const { has } = useTierFeatures();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error: boolean; text: string } | null>(
    null,
  );
  const alive = useRef(true);
  const inFlight = useRef(false);
  const actionKey = JSON.stringify([activeUserId, tenantId, person.id]);
  const actionBusy = busy || !!actionLock?.pending.has(actionKey);
  const scope = `${activeUserId}:${activeTenantId}:${person.id}:${accountContextStatus}:${accountContextLoading}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const ready =
    !accountContextLoading &&
    accountContextStatus === "ready" &&
    activeTenantId === tenantId &&
    !!activeUserId &&
    has("customer_portal_invite");
  const pending =
    latest &&
    !latest.revoked_at &&
    !latest.last_used_at &&
    Date.parse(latest.expires_at) > Date.now();
  const eligible =
    ready &&
    !!person.email &&
    !person.doNotContact &&
    !person.linkedUserId &&
    person.status === "active";

  const act = async (cancel: boolean) => {
    if (
      inFlight.current ||
      !ready ||
      (!cancel && !eligible) ||
      (cancel && !pending)
    )
      return;
    // The owner dashboard can mount this control inline and in a dialog. Its
    // synchronous lock outlives either instance and remains held through readback.
    const release = actionLock?.acquire(actionKey);
    if (actionLock && !release) return;
    inFlight.current = true;
    const startingScope = scope;
    const current = () =>
      alive.current && currentScope.current === startingScope;
    let created = false;
    setBusy(true);
    setResult(null);
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (!current()) return;
      if (authError || user?.id !== activeUserId)
        throw new Error("Sign in again before managing this invitation.");
      if (cancel && latest) {
        const { data, error } = await supabase
          .from("tenant_invite_tokens")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", latest.id)
          .eq("tenant_id", tenantId)
          .eq("contact_id", person.id)
          .eq("kind", "consumer")
          .is("revoked_at", null)
          .is("last_used_at", null)
          .select("id");
        if (error) throw error;
        if (!current()) return;
        if (data?.length !== 1)
          throw new Error(
            "The invitation changed. Refresh its status before trying again.",
          );
        setResult({
          error: false,
          text: "Invitation canceled. The pending invitation link has been revoked.",
        });
      } else {
        // Re-read the canonical contact before a send; stale preferences/archived or merged
        // records must not turn a previously visible control into a current send instruction.
        const { data: rawContact, error: contactError } = await supabase
          .from("clients")
          .select(invitationContactSelect)
          .eq("id", person.id)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (!current()) return;
        if (contactError) throw contactError;
        const contact = rawContact as unknown as InvitationContact | null;
        if (
          !contact ||
          contact.id !== person.id ||
          contact.status !== "active" ||
          contact.merged_into_contact_id !== null ||
          contact.do_not_contact !== false ||
          contact.linked_user_id !== null
        )
          throw new Error(
            "This client’s access or preferences changed. Open their record before inviting them.",
          );
        const methods = Array.isArray(contact.client_contact_methods) ? contact.client_contact_methods.filter((method) => method?.kind === "email" && method.is_primary === true) : [];
        const value = methods.length === 1 ? methods[0].value : null;
        if (
          typeof value !== "string" || !value.trim() ||
          value.trim().toLowerCase() !==
            person.email?.trim().toLowerCase()
        )
          throw new Error(
            "The client’s email changed. Refresh their record before sending.",
          );
        const beforeMint = await supabase.auth.getUser();
        if (!current()) return;
        if (beforeMint.error || beforeMint.data.user?.id !== activeUserId)
          throw new Error(
            "Your signed-in account changed. Reopen this invitation before continuing.",
          );
        let token: string | undefined;
        if (
          pending &&
          latest &&
          latest.email?.trim().toLowerCase() ===
            value.trim().toLowerCase()
        ) {
          const { data, error } = await supabase
            .from("tenant_invite_tokens")
            .select("token")
            .eq("id", latest.id)
            .eq("tenant_id", tenantId)
            .eq("contact_id", person.id)
            .eq("kind", "consumer")
            .is("revoked_at", null)
            .is("last_used_at", null)
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();
          if (error) throw error;
          token = data?.token;
        } else {
          const { data, error } = await supabase.rpc(
            "create_tenant_invite_token",
            {
              _tenant_id: tenantId,
              _kind: "consumer",
              _default_role: "member",
              _expires_in_days: 30,
              _max_uses: 1,
              _contact_id: person.id,
              _email: value,
            },
          );
          if (error) throw error;
          const row = Array.isArray(data) ? data[0] : data;
          token = row?.token;
          created = !!token;
        }
        if (!current()) return;
        if (!token)
          throw new Error(
            "The invitation could not be retrieved. Refresh its status before retrying.",
          );
        const beforeSend = await supabase.auth.getUser();
        if (!current()) return;
        if (beforeSend.error || beforeSend.data.user?.id !== activeUserId)
          throw new Error(
            "Your signed-in account changed. Email sending was not started.",
          );
        const { data: sent, error: sendError } =
          await supabase.functions.invoke("send-portal-invite", {
            body: { token, email: value },
          });
        if (!current()) return;
        if (sendError || sent?.ok !== true || sent?.emailed !== true)
          throw new Error(
            created
              ? "Invitation created. Email sending was not confirmed; refresh its status before retrying."
              : "Email sending was not confirmed. The invitation has not been marked delivered.",
          );
        setResult({
          error: false,
          text: "The email provider accepted the invitation for sending. Customer delivery and sign-in are not yet confirmed.",
        });
      }
    } catch (error) {
      if (current())
        setResult({
          error: true,
          text:
            error instanceof Error
              ? error.message
              : "The invitation action could not be confirmed. Refresh its status before retrying.",
        });
    } finally {
      {
        try {
          await onReadback();
        } catch {
          if (current())
            setResult((previous) => ({
              error: true,
              text: `${previous?.text || "The action finished."} The latest invitation status could not be reloaded. Refresh before retrying.`,
            }));
        } finally {
          release?.();
          inFlight.current = false;
          if (current()) {
            setBusy(false);
          }
        }
      }
    }
  };

  return (
    <section
      className="opd-invitation"
      aria-label={`Invitation for ${person.name}`}
    >
      <h3>{person.name}</h3>
      <p>
        {person.email ||
          "Add an email address on the client record before inviting them."}
      </p>
      {person.doNotContact && (
        <p>This client’s contact preferences prevent an invitation email.</p>
      )}
      {person.status !== "active" && <p>Only active client records can receive invitations. Review this client’s status in People.</p>}
      {person.linkedUserId && (
        <p>
          An account is linked to this contact. That does not confirm a portal
          visit.
        </p>
      )}
      {latest && (
        <p>
          Latest invitation:{" "}
          {latest.last_used_at
            ? "accepted"
            : latest.revoked_at
              ? "canceled"
              : pending
                ? "pending"
                : "expired"}
          . Expires {new Date(latest.expires_at).toLocaleDateString()}.
        </p>
      )}
      <div>
        <button
          className="opd-button opd-primary"
          type="button"
          disabled={actionBusy || !eligible}
          onClick={() => void act(false)}
        >
          {actionBusy
            ? "Checking invitation…"
            : pending
              ? "Resend invitation email"
              : "Send invitation email"}
        </button>
        {pending && (
          <button
            className="opd-button"
            type="button"
            disabled={actionBusy || !ready}
            onClick={() => void act(true)}
          >
            Cancel pending invitation
          </button>
        )}
      </div>
      <p className="opd-footnote">
        Email goes to the saved address above. No customer account is deleted,
        signed out or impersonated here.
      </p>
      {result && <p role={result.error ? "alert" : "status"}>{result.text}</p>}
    </section>
  );
}
