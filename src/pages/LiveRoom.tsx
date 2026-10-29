// /live/:id — the live room page (EXP07 broadcast slice). One room implementation for
// everyone the broadcast belongs to: the host arriving from the Go Live panel, a host
// whose browser refreshed, or a teammate taking a seat — each gets their OWN pass minted
// through the governed door (join), and the RealtimeKit SDK is code-split to exactly this
// route so the Social tab never carries it.
//
// The page speaks the same truthful grammar as the panel: every state is the door's own
// answer rendered honestly — joining, live (the room itself), not-live, full, not-yours
// (another workspace's session), not signed in. Nothing is invented; a refusal names
// itself. External guests (the tenant's own clients, no PAIGE login) arrive with the
// guest-admission slice — named honestly below rather than promised.
import React from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import "./live-room.css";

const RtkMeeting = React.lazy(() => import("@cloudflare/realtimekit-react-ui").then((m) => ({ default: m.RtkMeeting })));

type JoinState =
  | { face: "joining" }
  | { face: "room"; meeting: unknown; title: string }
  | { face: "message"; heading: string; body: string; signIn?: boolean };

export default function LiveRoom() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = React.useState<JoinState>({ face: "joining" });

  React.useEffect(() => {
    let alive = true;
    (async () => {
      let data: Record<string, unknown> | null = null;
      let invoked: { error: unknown; data: unknown } | null = null;
      try {
        invoked = await supabase.functions.invoke("broadcast-command", { body: { action: "join", expected_tenant_id: null } });
        data = invoked.data as Record<string, unknown> | null;
      } catch {
        data = null;
      }
      if (!alive) return;
      const join = data?.ok ? (data.join as Record<string, unknown> | undefined) : undefined;
      const session = data?.ok ? (data.session as Record<string, unknown> | undefined) : undefined;
      if (data?.ok && join && typeof join.token === "string") {
        // The token carries its own routing; RealtimeKitClient.init is the SDK's whole
        // join contract (verified against @cloudflare/realtimekit 2.0.4's default export).
        const core = await import("@cloudflare/realtimekit");
        const meeting = await core.default.init({ authToken: join.token });
        if (!alive) return;
        setState({ face: "room", meeting, title: typeof session?.title === "string" ? session.title : "Live room" });
        void meeting.join();
        return;
      }
      const code = String((data as Record<string, unknown> | null)?.code ?? "");
      const errorBody = invoked ? await readFunctionErrorBody(invoked.error, invoked.data) : null;
      const sentence = typeof errorBody?.error === "string" && !/non-2xx/i.test(errorBody.error) ? errorBody.error : "";
      if (code === "NOT_AUTHENTICATED") {
        setState({ face: "message", heading: "Sign in to join", body: "This live room belongs to a PAIGE workspace — sign in and come back to this link.", signIn: true });
      } else if (code === "BROADCAST_NOT_LIVE" || (data === null && !sentence)) {
        setState({
          face: "message",
          heading: id ? "This broadcast isn’t live" : "No broadcast here",
          body: "The room may have ended, or this link doesn’t match a live broadcast in your workspace. The Social tab shows the real state.",
        });
      } else if (code === "BROADCAST_ROOM_FULL") {
        setState({ face: "message", heading: "This live room is full", body: sentence || "The room is at its cap right now. Try again in a moment." });
      } else {
        setState({ face: "message", heading: "Couldn’t join", body: sentence || "The room couldn’t be joined right now. Nothing changed — try again in a moment." });
      }
    })();
    return () => { alive = false; };
    // The room is joined once per arrival; the path id is display-truth, the workspace's
    // OWN live session is the join target (tenant isolation lives in the door).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="live-room-page">
      {state.face === "joining" && <p className="live-room-note" role="status">Opening the live room…</p>}
      {state.face === "message" && (
        <div className="live-room-message">
          <h1>{state.heading}</h1>
          <p>{state.body}</p>
          {state.signIn && <a className="btn btn-s btn-g" href="/auth">Sign in</a>}
          <a className="live-room-back" href="/">Back to PAIGE</a>
        </div>
      )}
      {state.face === "room" && (
        <>
          <h1 className="live-room-title">{state.title}</h1>
          <React.Suspense fallback={<p className="live-room-note" role="status">Loading the room…</p>}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SDK's meeting object is its own type; the page hands it straight through */}
            <RtkMeeting mode="fill" meeting={state.meeting as any} showSetupScreen={false} style={{ minHeight: "72vh" }} />
          </React.Suspense>
        </>
      )}
    </main>
  );
}
